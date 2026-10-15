/** Fail closed: this application creates a new MKV, never overwrites an existing non-empty file. */
export function assertDifferentFilename(inputName, outputName) {
  const normalize = name => String(name).normalize('NFC').replace(/[ .]+$/g,'').toLowerCase();
  if (normalize(inputName)===normalize(outputName))
    throw new Error('Cannot save with the same name as the source file. Please choose a new name.');
  if (!/\.mkv$/i.test(outputName)) throw new Error('The output file extension must be .mkv.');
}
export async function assertNewOutput(handle,inputName) {
  assertDifferentFilename(inputName,handle.name);
  const existing=await handle.getFile();
  if (existing.size>0) throw new Error('Existing files are never overwritten. Please choose a new, unused file name.');
}
