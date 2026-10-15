/** Three-hour LOW-BITRATE fixture. This validates timestamps, not multi-GB performance. */
import {mkdtemp,readFile,open,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {File} from 'node:buffer';
import assert from 'node:assert/strict';
import {inspectMkv,planMux,writeMux} from '../src/mux.js';
import {parseSrt} from '../src/subrip.js';
function run(bin,args){const r=spawnSync(bin,args,{encoding:'utf8',maxBuffer:10000000,timeout:60000});if(r.status!==0)throw new Error(`${bin}: ${r.stderr||r.error}`);return r.stdout;}
const temp=await mkdtemp(join(tmpdir(),'mkv-studio-long-'));
try{
  const source=join(temp,'three-hours.mkv'),out=join(temp,'subtitled.mkv');
  run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=black:s=16x16:r=1','-t','10800','-c:v','mpeg4','-g','60','-an',source]);
  const captions=parseSrt('1\n00:00:01,000 --> 00:00:03,000\n시작\n\n2\n01:30:00,700 --> 01:30:03,100\n중간\n\n3\n02:59:56,500 --> 02:59:58,500\n마지막');
  const structure=await inspectMkv(new File([await readFile(source)],'three-hours.mkv'));
  const plan=planMux(structure,captions,{isDefault:true});
  const h=await open(out,'w');
  await writeMux(structure,plan,{write:async data=>{let offset=0;while(offset<data.length){const {bytesWritten}=await h.write(data,offset,data.length-offset);assert.ok(bytesWritten>0);offset+=bytesWritten;}},close:()=>h.close(),abort:()=>h.close()});
  const duration=Number(run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',out]).trim());
  assert.ok(duration>=10800 && duration<10802);
  const extracted=run('ffmpeg',['-v','error','-i',out,'-map','0:s:0','-f','srt','-']);
  assert.deepEqual(parseSrt(extracted),captions);
  run('ffmpeg',['-v','error','-ss','10795','-i',out,'-t','3','-f','null','-']);
  console.log(`PASS: duration=${duration}s, input=${(await stat(source)).size} bytes; exact SRT timings at start/middle/end; seek near end. NOT a large-file benchmark.`);
}finally{await rm(temp,{recursive:true,force:true});}
