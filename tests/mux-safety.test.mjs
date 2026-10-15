import test from 'node:test';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {ID,element,master,uintElement,textElement,concat,encodeId,encodeVint,segmentHeader} from '../src/ebml.js';
import {inspectMkv,planMux,writeMux} from '../src/mux.js';
const ebml=master(ID.EBML,textElement(ID.DocType,'matroska'),uintElement(ID.DocTypeVersion,2));
const info=master(ID.Info,uintElement(ID.TimestampScale,1000000));
const tracks=master(ID.Tracks,master(ID.TrackEntry,uintElement(ID.TrackNumber,1),uintElement(ID.TrackUID,1),uintElement(ID.TrackType,1),textElement(ID.CodecID,'V_MPEG4/ISO/ASP')));
const cluster=master(ID.Cluster,uintElement(ID.Timestamp,0),element(ID.SimpleBlock,Uint8Array.of(0x81,0,0,0x80,1,2,3)));
const cues=[{startMs:500,endMs:1800,text:'test'}];
const fixture=(cl=cluster,tail=new Uint8Array())=>new File([ebml,master(ID.Segment,info,tracks,cl),tail],'fixture.mkv');
test('rejects truncation instead of truncating declared Segment size',async()=>{
  const bytes=await fixture().arrayBuffer();
  await assert.rejects(()=>inspectMkv(new File([bytes.slice(0,-2)],'broken.mkv')),/truncated|Segment/i);
});
test('rejects a second Segment or bytes after the first',async()=>{
  await assert.rejects(()=>inspectMkv(fixture(cluster,master(ID.Segment,info))),/Segment/);
});
test('rejects Position found AFTER encoded media',async()=>{
  const cl=master(ID.Cluster,uintElement(ID.Timestamp,0),element(ID.SimpleBlock,Uint8Array.of(0x81,0,0,0x80,42)),uintElement(ID.Position,999));
  await assert.rejects(()=>inspectMkv(fixture(cl)),/Position/);
});
test('rejects WebM even with an MKV extension',async()=>{
  const file=new File([master(ID.EBML,textElement(ID.DocType,'webm')),master(ID.Segment,info,tracks,cluster)],'renamed.mkv');
  await assert.rejects(()=>inspectMkv(file),/WebM/);
});
test('cancellation and disk errors abort the writer without closing it',async()=>{
  const structure=await inspectMkv(fixture()),plan=planMux(structure,cues);
  let aborted=0,closed=0;const ctl=new AbortController();
  await assert.rejects(()=>writeMux(structure,plan,{write:async()=>ctl.abort(),close:async()=>closed++,abort:async()=>aborted++},{signal:ctl.signal}),{name:'AbortError'});
  assert.equal(aborted,1);assert.equal(closed,0);
  await assert.rejects(()=>writeMux(structure,plan,{write:async()=>{throw Error('disk full');},abort:async()=>aborted++}),/disk full/);
  assert.equal(aborted,2);
});
test('pre-aborted scan stops',async()=>{
  const ctl=new AbortController();ctl.abort();
  await assert.rejects(()=>inspectMkv(fixture(),{signal:ctl.signal}),{name:'AbortError'});
});
test('virtual >5 GiB MKV offsets: only bounded reads, correctly rebuilt cues',async()=>{
  // A virtual sparse fixture, not a 5 GiB disk/performance benchmark.
  const padding=5*1024**3;
  const voidHeader=concat(encodeId(ID.Void),encodeVint(padding));
  const prefix=concat(ebml,segmentHeader(),info,tracks,voidHeader);
  const oldClusterPosition=info.length+tracks.length+voidHeader.length+padding;
  const cueData=master(ID.Cues,master(ID.CuePoint,uintElement(ID.CueTime,0),master(ID.CueTrackPositions,uintElement(ID.CueTrack,1),uintElement(ID.CueClusterPosition,oldClusterPosition))));
  const suffix=concat(cluster,cueData),size=prefix.length+padding+suffix.length;
  let maxRead=0;
  const file={size,name:'sparse.mkv',slice(start,end){maxRead=Math.max(maxRead,end-start);assert.ok(end-start<=4*1024**2);return {async arrayBuffer(){const out=new Uint8Array(end-start);for(const [at,data] of [[0,prefix],[prefix.length+padding,suffix]]){const lo=Math.max(start,at),hi=Math.min(end,at+data.length);if(hi>lo)out.set(data.subarray(lo-at,hi-at),lo-start);}return out.buffer;}};}};
  const structure=await inspectMkv(file),plan=planMux(structure,cues);
  const chunks=[];await writeMux(structure,plan,{write:async b=>chunks.push(b),close:async()=>{}});
  const output=new File(chunks,'output.mkv');
  assert.ok(output.size<10000);assert.equal((await inspectMkv(output)).clusters.length,2);assert.ok(maxRead<=4*1024**2);
});
