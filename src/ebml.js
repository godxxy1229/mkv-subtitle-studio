/** Minimal EBML reader/writer for Matroska. No media is decoded. */
const textEncoder = new TextEncoder();
export const ID = Object.freeze({
  EBML: 0x1A45DFA3, DocType: 0x4282, DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285, EBMLReadVersion: 0x42F7, EBMLMaxIDLength: 0x42F2, EBMLMaxSizeLength: 0x42F3, Segment: 0x18538067, SeekHead: 0x114D9B74,
  Seek: 0x4DBB, SeekID: 0x53AB, SeekPosition: 0x53AC,
  Info: 0x1549A966, TimestampScale: 0x2AD7B1,
  Tracks: 0x1654AE6B, TrackEntry: 0xAE, TrackNumber: 0xD7,
  TrackUID: 0x73C5, TrackType: 0x83, FlagDefault: 0x88,
  FlagForced: 0x55AA, Language: 0x22B59C, LanguageIETF: 0x22B59D,
  Name: 0x536E, CodecID: 0x86,
  Cluster: 0x1F43B675, SimpleBlock: 0xA3, Timestamp: 0xE7, BlockGroup: 0xA0,
  Block: 0xA1, BlockDuration: 0x9B,
  Cues: 0x1C53BB6B, CuePoint: 0xBB, CueTime: 0xB3,
  CueTrackPositions: 0xB7, CueTrack: 0xF7,
  CueClusterPosition: 0xF1, CueRelativePosition: 0xF0, CueCodecState: 0xEA, CueReference: 0xDB,
  Attachments: 0x1941A469, Chapters: 0x1043A770, Tags: 0x1254C367,
  CRC32: 0xBF, Void: 0xEC, Position: 0xA7, PrevSize: 0xAB,
});

const safe = n => {
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('This file is too large for the browser to handle safely.');
  return Number(n);
};
const vintWidth = b => {
  if (!b) throw new Error('Invalid EBML VINT.');
  let width = 1, bit = 0x80;
  while (!(b & bit) && width < 8) { bit >>= 1; width++; }
  if (!(b & bit)) throw new Error('Invalid EBML VINT leading byte.');
  return width;
};

/** Read an element header from a Uint8Array, with offsets relative to the array. */
export function parseHeader(bytes, at = 0) {
  if (at >= bytes.length) throw new Error('Truncated EBML header.');
  const idWidth = vintWidth(bytes[at]);
  if (idWidth > 4 || at + idWidth >= bytes.length) throw new Error('Invalid EBML element ID.');
  let id = 0;
  for (let i = 0; i < idWidth; i++) id = id * 256 + bytes[at + i];
  const sizeWidth = vintWidth(bytes[at + idWidth]);
  if (at + idWidth + sizeWidth > bytes.length) throw new Error('Truncated EBML size header.');
  const mask = 0xff >>> sizeWidth;
  let value = BigInt(bytes[at + idWidth] & mask);
  for (let i = 1; i < sizeWidth; i++) value = (value << 8n) | BigInt(bytes[at + idWidth + i]);
  const unknown = value === ((1n << BigInt(7 * sizeWidth)) - 1n);
  const headerSize = idWidth + sizeWidth;
  return { id, size: unknown ? null : safe(value), unknown, headerSize, dataStart: at + headerSize, end: unknown ? null : at + headerSize + safe(value) };
}

/** Only for bounded metadata buffers (never whole videos). */
export function parseChildren(data, start = 0, end = data.length) {
  const result = [];
  let pos = start;
  while (pos < end) {
    const e = parseHeader(data, pos);
    if (e.unknown || e.end > end) throw new Error('MKV metadata is damaged or has an unsupported size.');
    result.push({ ...e, start: pos });
    pos = e.end;
  }
  if (pos !== end) throw new Error('Invalid MKV metadata boundary.');
  return result;
}

export async function fileHeader(file, offset) {
  const bytes = new Uint8Array(await file.slice(offset, Math.min(offset + 16, file.size)).arrayBuffer());
  const e = parseHeader(bytes);
  return { ...e, start: offset, dataStart: offset + e.dataStart, end: e.unknown ? null : offset + e.end };
}

export function readUInt(bytes) {
  if (bytes.length > 8) throw new Error('Integer is too long.');
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return safe(n);
}
export function encodeUInt(n, width = 0) {
  let v = BigInt(n);
  if (v < 0n) throw new Error('Negative numbers cannot be stored as unsigned.');
  let needed = 1;
  while (v >> BigInt(needed * 8)) needed++;
  const len = width || needed;
  if (len < needed || len > 8) throw new Error('Invalid unsigned integer length.');
  const bytes = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) { bytes[i] = Number(v & 255n); v >>= 8n; }
  return bytes;
}
export function encodeId(id) {
  const v = BigInt(id);
  let n = 1;
  while (v >= (1n << BigInt(n * 8))) n++;
  return encodeUInt(v, n);
}
export function encodeVint(n, minWidth = 1) {
  const value = BigInt(n);
  if (value < 0n) throw new Error('Negative sizes are not supported.');
  let width = minWidth;
  while (width <= 8 && value >= (1n << BigInt(width * 7)) - 1n) width++;
  if (width > 8) throw new Error('EBML size cannot be represented.');
  let v = value | (1n << BigInt(width * 7));
  const bytes = new Uint8Array(width);
  for (let i = width - 1; i >= 0; i--) { bytes[i] = Number(v & 255n); v >>= 8n; }
  return bytes;
}
export function concat(...parts) {
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}
export const bytes = v => textEncoder.encode(v);
export const element = (id, body) => concat(encodeId(id), encodeVint(body.byteLength), body);
export const uintElement = (id, value, width = 0) => element(id, encodeUInt(value, width));
export const textElement = (id, value) => element(id, bytes(value));
export const master = (id, ...children) => element(id, concat(...children));
export const rawChild = (bytes, header) => bytes.subarray(header.start, header.end);
export function segmentHeader() {
  // Matroska streaming-compatible 8-byte unknown-length Segment VINT.
  return concat(encodeId(ID.Segment), Uint8Array.of(1,255,255,255,255,255,255,255));
}
