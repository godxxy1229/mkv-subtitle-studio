/** Strict SubRip parser. Reject malformed blocks rather than silently losing captions. */
export function parseSrt(source) {
  if (typeof source !== 'string') throw new TypeError('SRT 내용은 문자열이어야 합니다.');
  const content = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!content) throw new Error('자막 파일이 비어 있습니다.');
  if (content.includes('\0')) throw new Error('자막에 NUL 문자가 있습니다. 인코딩을 확인해주세요.');
  const time = '(\\d{1,3}):(\\d{2}):(\\d{2})[,.](\\d{1,3})';
  const pattern = new RegExp(`^\\s*${time}\\s*-->\\s*${time}(?:\\s+.*)?$`);
  const toMs = (h,m,s,f) => Number(h)*3600000+Number(m)*60000+Number(s)*1000+Number(f.padEnd(3,'0'));
  const cues = [];
  const blocks = content.split(/\n[ \t]*\n(?:[ \t]*\n)*/);
  if (blocks.length > 50000) throw new Error('자막 구간은 최대 50,000개까지 지원합니다.');
  for (let i=0; i<blocks.length; i++) {
    const lines = blocks[i].split('\n');
    const at = /^\s*\d+\s*$/.test(lines[0]) ? 1 : 0;
    const m = lines[at]?.match(pattern);
    if (!m) throw new Error(`${i+1}번째 구간에 유효한 SRT 시간 정보가 없습니다.`);
    const startMs = toMs(...m.slice(1,5)), endMs = toMs(...m.slice(5,9));
    if ([m[2],m[3],m[6],m[7]].some(x=>Number(x)>59) || startMs>=endMs)
      throw new Error(`SRT 시간 정보가 잘못되었습니다: ${lines[at]}`);
    const text = lines.slice(at+1).join('\n').trimEnd();
    if (!text.trim()) throw new Error(`${i+1}번째 자막 구간의 내용이 비어 있습니다.`);
    if (new TextEncoder().encode(text).length > 256*1024) throw new Error('자막 한 구간이 지나치게 큽니다.');
    cues.push({startMs,endMs,text});
  }
  return cues.sort((a,b)=>a.startMs-b.startMs || a.endMs-b.endMs);
}

/** BOM detection, strict UTF-8, then Windows Korean/EUC-KR fallback. */
export function decodeSrt(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length > 16*1024*1024) throw new Error('SRT 파일은 최대 16 MiB까지 지원합니다.');
  let encoding = 'utf-8';
  if (bytes[0]===0xff && bytes[1]===0xfe) encoding='utf-16le';
  else if (bytes[0]===0xfe && bytes[1]===0xff) encoding='utf-16be';
  else if (!(bytes[0]===0xef && bytes[1]===0xbb && bytes[2]===0xbf)) {
    try { return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes), encoding:'UTF-8'}; }
    catch { encoding='euc-kr'; }
  }
  try { return {text:new TextDecoder(encoding,{fatal:true}).decode(bytes), encoding:encoding.toUpperCase()}; }
  catch { throw new Error('자막 인코딩을 읽지 못했습니다. UTF-8로 저장한 SRT 파일을 선택해주세요.'); }
}
