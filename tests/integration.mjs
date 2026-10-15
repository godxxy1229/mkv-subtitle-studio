/** Optional integration test: creates an actual MPEG4+AAC MKV and checks tracks, subtitle extraction and seeking. */
import {mkdtemp,readFile,writeFile,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {File} from 'node:buffer';
import assert from 'node:assert/strict';
import {inspectMkv,planMux,writeMux} from '../src/mux.js';
import {parseSrt} from '../src/subrip.js';
function run(bin,args){const r=spawnSync(bin,args,{encoding:'utf8',maxBuffer:10000000});if(r.status!==0)throw new Error(`${bin}: ${r.stderr||r.error}`);return r.stdout;}
const temp=await mkdtemp(join(tmpdir(),'mkv-subtitle-studio-'));
try{
  const original=join(temp,'original.mkv'),first=join(temp,'first.mkv'),second=join(temp,'second.mkv'),extracted=join(temp,'extracted.srt');
  run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=25','-f','lavfi','-i','sine=frequency=300:sample_rate=44100','-t','5','-c:v','mpeg4','-q:v','4','-c:a','aac',original]);
  const cues=parseSrt('1\n00:00:00,700 --> 00:00:02,100\n한글 자막\n\n2\n00:00:03,000 --> 00:00:04,400\n다음 자막');
  async function remux(input,out,isDefault){
    const file=new File([await readFile(input)],'sample.mkv');
    const structure=await inspectMkv(file);
    const plan=planMux(structure,cues,{language:'kor',trackName:'Subtitle Korean',isDefault});
    const handle=await open(out,'w');
    await writeMux(structure,plan,{write:async x=>{let offset=0;while(offset<x.length){const {bytesWritten}=await handle.write(x,offset,x.length-offset);assert.ok(bytesWritten>0);offset+=bytesWritten;}},close:()=>handle.close(),abort:()=>handle.close()});
    return plan;
  }
  await remux(original,first,true);
  await remux(first,second,true);
  const info=JSON.parse(run('ffprobe',['-v','error','-show_entries','stream=index,codec_name,codec_type:stream_tags=language,title:stream_disposition=default','-of','json',second]));
  assert.deepEqual(info.streams.map(s=>s.codec_type),['video','audio','subtitle','subtitle']);
  assert.equal(info.streams[2].tags.language,'kor');
  assert.equal(info.streams[2].disposition.default,0);
  assert.equal(info.streams[3].disposition.default,1);
  for(const kind of ['v','a']){
    const hash=path=>run('ffmpeg',['-v','error','-i',path,'-map',`0:${kind}:0`,'-c','copy','-f','hash','-hash','sha256','-']).trim();
    assert.equal(hash(second),hash(original),`${kind}: encoded stream changed`);
  }
  // Inspect stored packet timestamps independently. FFmpeg's default extraction
  // shifts them by the format start_time (AAC priming may be negative).
  const packets=JSON.parse(run('ffprobe',['-v','error','-select_streams','s:0','-show_packets','-show_entries','packet=pts_time,duration_time','-of','json',second])).packets;
  assert.deepEqual(packets.map(p=>({startMs:Math.round(Number(p.pts_time)*1000),endMs:Math.round((Number(p.pts_time)+Number(p.duration_time))*1000)})),cues.map(({startMs,endMs})=>({startMs,endMs})));
  run('ffmpeg',['-hide_banner','-loglevel','error','-y','-copyts','-i',second,'-map','0:s:0','-f','srt',extracted]);
  const extractedText=await readFile(extracted,'utf8');
  assert.deepEqual(parseSrt(extractedText),cues);
  assert.match(extractedText,/한글 자막/);assert.match(extractedText,/다음 자막/);
  run('ffmpeg',['-hide_banner','-loglevel','error','-ss','3.0','-i',second,'-t','0.5','-f','null','-']);
  console.log('PASS: MKV playable; two sequential subtitle additions; exclusive subtitle default flag; exact SRT times; identical video/audio SHA-256; seeking works');
}finally{await rm(temp,{recursive:true,force:true});}
