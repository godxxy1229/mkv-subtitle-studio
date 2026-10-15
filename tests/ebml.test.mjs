import test from 'node:test';
import assert from 'node:assert/strict';
import { ID, encodeVint, encodeUInt, encodeId, parseHeader, parseChildren, uintElement, textElement, master, readUInt } from '../src/ebml.js';
import { parseSrt } from '../src/subrip.js';

test('VINT round-trip at size boundaries including >4 GiB', () => {
  for (const value of [0,1,5,125,126,127,128,16382,16383,16384,70000,4294967296,8589934593]) {
    const e=uintElement(ID.Timestamp,value);
    const head=parseHeader(e);
    assert.equal(head.id,ID.Timestamp);
    assert.equal(readUInt(e.subarray(head.dataStart,head.end)),value);
  }
});

test('EBML master tree can be parsed with nested track data', () => {
  const entry=master(ID.TrackEntry,uintElement(ID.TrackNumber,3),textElement(ID.CodecID,'S_TEXT/UTF8'));
  const tracks=master(ID.Tracks,entry);
  const outer=parseHeader(tracks);
  const children=parseChildren(tracks,outer.dataStart,outer.end);
  assert.equal(children.length,1);
  assert.equal(children[0].id,ID.TrackEntry);
  const entries=parseChildren(tracks,children[0].dataStart,children[0].end);
  assert.equal(readUInt(tracks.subarray(entries[0].dataStart,entries[0].end)),3);
});

test('SRT parse: BOM, multiline, two cues, optional decimal point, sorting', () => {
  const cues=parseSrt('\ufeff2\r\n00:00:04.000 --> 00:00:05.002 align:start\r\n뒤 자막\r\n\r\n1\r\n00:00:00,800 --> 00:00:03,700\r\n첫 줄\r\n둘째 줄\r\n');
  assert.equal(cues.length,2);
  assert.deepEqual(cues.map(c=>[c.startMs,c.endMs]),[[800,3700],[4000,5002]]);
  assert.equal(cues[0].text,'첫 줄\n둘째 줄');
});

test('SRT parse: empty, no times, invalid ranges', () => {
  assert.throws(()=>parseSrt(''),/비어/);
  assert.throws(()=>parseSrt('hello world'),/유효한/);
  assert.throws(()=>parseSrt('1\n00:00:03,000 --> 00:00:02,000\nHi'),/잘못/);
});

test('reject malformed EBML headers', () => {
  assert.throws(()=>parseHeader(new Uint8Array([0])),/VINT/);
  assert.throws(()=>parseHeader(new Uint8Array([0x1F,0x43,0xB6,0x75])),/ID|헤더/);
});
