/** Strict SubRip parser. Reject malformed blocks rather than silently losing captions. */
export function parseSrt(source) {
  if (typeof source !== 'string') throw new TypeError('SRT content must be a string.');
  const content = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!content) throw new Error('The subtitle file is empty.');
  if (content.includes('\0')) throw new Error('The subtitles contain NUL characters. Please check the encoding.');
  const time = '(\\d{1,3}):(\\d{2}):(\\d{2})[,.](\\d{1,3})';
  const pattern = new RegExp(`^\\s*${time}\\s*-->\\s*${time}(?:\\s+.*)?$`);
  const toMs = (h,m,s,f) => Number(h)*3600000+Number(m)*60000+Number(s)*1000+Number(f.padEnd(3,'0'));
  const cues = [];
  const blocks = content.split(/\n[ \t]*\n(?:[ \t]*\n)*/);
  if (blocks.length > 50000) throw new Error('Up to 50,000 subtitle cues are supported.');
  for (let i=0; i<blocks.length; i++) {
    const lines = blocks[i].split('\n');
    const at = /^\s*\d+\s*$/.test(lines[0]) ? 1 : 0;
    const m = lines[at]?.match(pattern);
    if (!m) throw new Error(`Cue ${i+1} has no valid SRT timestamp.`);
    const startMs = toMs(...m.slice(1,5)), endMs = toMs(...m.slice(5,9));
    if ([m[2],m[3],m[6],m[7]].some(x=>Number(x)>59) || startMs>=endMs)
      throw new Error(`Invalid SRT timestamp: ${lines[at]}`);
    const text = lines.slice(at+1).join('\n').trimEnd();
    if (!text.trim()) throw new Error(`Cue ${i+1} is empty.`);
    if (new TextEncoder().encode(text).length > 256*1024) throw new Error('A subtitle cue is too large.');
    cues.push({startMs,endMs,text});
  }
  return cues.sort((a,b)=>a.startMs-b.startMs || a.endMs-b.endMs);
}

/** BOM detection, strict UTF-8, then Windows Korean/EUC-KR fallback. */
export function decodeSrt(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length > 16*1024*1024) throw new Error('SRT files up to 16 MiB are supported.');
  let encoding = 'utf-8';
  if (bytes[0]===0xff && bytes[1]===0xfe) encoding='utf-16le';
  else if (bytes[0]===0xfe && bytes[1]===0xff) encoding='utf-16be';
  else if (!(bytes[0]===0xef && bytes[1]===0xbb && bytes[2]===0xbf)) {
    try { return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes), encoding:'UTF-8'}; }
    catch { encoding='euc-kr'; }
  }
  try { return {text:new TextDecoder(encoding,{fatal:true}).decode(bytes), encoding:encoding.toUpperCase()}; }
  catch { throw new Error('Could not read the subtitle encoding. Please use an SRT file saved as UTF-8.'); }
}
