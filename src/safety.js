/** Fail closed: this application creates a new MKV, never overwrites an existing non-empty file. */
export function assertDifferentFilename(inputName, outputName) {
  const normalize = name => String(name).normalize('NFC').replace(/[ .]+$/g,'').toLowerCase();
  if (normalize(inputName)===normalize(outputName))
    throw new Error('원본과 같은 파일명으로 저장할 수 없습니다. 새 파일명을 지정해주세요.');
  if (!/\.mkv$/i.test(outputName)) throw new Error('출력 파일의 확장자는 .mkv여야 합니다.');
}
export async function assertNewOutput(handle,inputName) {
  assertDifferentFilename(inputName,handle.name);
  const existing=await handle.getFile();
  if (existing.size>0) throw new Error('기존 파일은 덮어쓰지 않습니다. 사용하지 않는 새 파일명을 지정해주세요.');
}
