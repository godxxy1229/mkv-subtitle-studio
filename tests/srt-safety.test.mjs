import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSrt,decodeSrt} from '../src/subrip.js';
import {assertDifferentFilename,assertNewOutput} from '../src/safety.js';
import {concat,encodeId,encodeVint,parseHeader,ID} from '../src/ebml.js';
const one='1\n00:00:00,500 --> 00:00:01,700\n한글 자막';
test('BOM UTF-8 and UTF-16 decoding',()=>{
  assert.equal(decodeSrt(new TextEncoder().encode('\ufeff'+one)).text,one);
  const data=Buffer.concat([Buffer.from([255,254]),Buffer.from(one,'utf16le')]);
  assert.equal(decodeSrt(data).text,one);
  const be=Buffer.from(data);be.swap16();assert.equal(decodeSrt(be).text,one);
});
test('EUC-KR fallback decodes Korean bytes',()=>{
  assert.equal(decodeSrt(Uint8Array.from([0xc7,0xd1,0xb1,0xdb])).text,'한글');
});
test('malformed SRT block is not silently dropped',()=>{
  assert.throws(()=>parseSrt(one+'\n\n2\ninvalid time\nDo not lose me'),/2번째/);
});
test('empty subtitle payload and invalid minutes are rejected',()=>{
  assert.throws(()=>parseSrt('1\n00:00:00,000 --> 00:00:01,000'),/비어/);
  assert.throws(()=>parseSrt('1\n00:75:00,000 --> 01:00:00,000\nX'),/잘못/);
});
test('unindexed SRT, overlapping cues and 3 hour timestamps',()=>{
  const result=parseSrt('03:00:00,000 --> 03:00:03,000\nEnd\n\n00:00:00,000 --> 00:00:02,000\nA\n\n00:00:01,000 --> 00:00:03,000\nB');
  assert.equal(result.length,3);assert.equal(result[2].startMs,10800000);
});
test('NUL bytes are rejected, markup is kept as plain cue text',()=>{
  assert.throws(()=>parseSrt(one+'\0'),/NUL/);
  assert.match(parseSrt(one+'<script>never executed</script>')[0].text,/<script>/);
});
test('output name guard is case-insensitive and normalized',()=>{
  assert.throws(()=>assertDifferentFilename('movie.mkv','MOVIE.MKV'),/원본/);
  assert.throws(()=>assertDifferentFilename('movie.mkv','movie.mkv. '),/원본/);
  assert.throws(()=>assertDifferentFilename('movie.mkv','output.mp4'),/확장자/);
  assert.doesNotThrow(()=>assertDifferentFilename('movie.mkv','movie-subtitled.mkv'));
});
test('non-empty output files cannot be overwritten',async()=>{
  await assert.rejects(()=>assertNewOutput({name:'output.mkv',getFile:async()=>({size:100})},'movie.mkv'),/덮어쓰지/);
  await assertNewOutput({name:'output.mkv',getFile:async()=>({size:0})},'movie.mkv');
});
test('EBML SIZE VINT handles >4 GiB without truncation',()=>{
  for(const n of [0,126,127,16382,16383,2**32+1,30*1024**3]){
    const header=parseHeader(concat(encodeId(ID.Void),encodeVint(n)));
    assert.equal(header.size,n);assert.equal(header.unknown,false);
  }
});
