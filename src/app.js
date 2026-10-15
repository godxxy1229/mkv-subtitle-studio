import { parseSrt, decodeSrt } from './subrip.js';
import { inspectMkv, planMux, writeMux } from './mux.js';
import { assertNewOutput } from './safety.js';

const $=id=>document.getElementById(id);
const el={video:$('video-file'),subtitle:$('subtitle-file'),videoZone:$('video-zone'),subtitleZone:$('subtitle-zone'),videoDisplay:$('video-display'),subtitleDisplay:$('subtitle-display'),status:$('status'),start:$('start'),startLabel:$('start-label'),progress:$('progress-wrap'),bar:$('progress-fill'),percent:$('progress-number'),cancel:$('cancel'),language:$('language'),trackName:$('track-name'),browserNote:$('browser-note'),browserWarning:$('browser-warning')};
let mediaFile=null,subtitleFile=null,busy=false,controller=null;
const MEMORY_LIMIT=256*1024*1024;
const PAGE_TITLE=document.title;
const TRACK_LABELS={kor:'한국어 자막',eng:'English subtitles',jpn:'日本語字幕',und:'자막'};
const slots={video:{extension:'.mkv',zone:el.videoZone,display:el.videoDisplay},subtitle:{extension:'.srt',zone:el.subtitleZone,display:el.subtitleDisplay}};
const supportsDisk=window.isSecureContext && typeof window.showSaveFilePicker==='function';
const prettyBytes=n=>n<1024*1024?`${(n/1024).toFixed(1)} KiB`:n<1024*1024*1024?`${(n/1024/1024).toFixed(1)} MiB`:`${(n/1024/1024/1024).toFixed(2)} GiB`;
function status(text,type=''){el.status.textContent=text;el.status.className=`status ${type}`;}
function refresh(){el.start.disabled=busy||!mediaFile||!subtitleFile;}
function setBusy(value){
  busy=value;
  for(const input of document.querySelectorAll('.workbench input,.workbench select')) input.disabled=value;
  el.startLabel.textContent=value?'작업 진행 중…':'자막 추가 후 MKV 저장';
  el.cancel.hidden=!value;el.cancel.disabled=false;refresh();
  if(!value)document.title=PAGE_TITLE;
}
function progress(percent){
  el.bar.style.width=percent+'%';el.percent.textContent=percent+'%';
  el.progress.setAttribute('aria-valuenow',String(percent));
  document.title=`${percent}% · MKV Subtitle Studio`;
}
const typeOf=file=>file.name.toLowerCase().endsWith('.mkv')?'video':file.name.toLowerCase().endsWith('.srt')?'subtitle':null;
function chosen(type,file){
  if(busy||!file)return;
  const slot=slots[type],valid=typeOf(file)===type;
  if(type==='video')mediaFile=valid?file:null;else subtitleFile=valid?file:null;
  slot.display.textContent=valid?`${file.name} · ${prettyBytes(file.size)}`:`${slot.extension} 파일이 아닙니다 · ${file.name}`;
  slot.zone.classList.toggle('chosen',valid);slot.zone.classList.toggle('invalid',!valid);
  el.progress.hidden=true;refresh();
  if(!valid)status(`${slot.extension} 파일을 선택해주세요.`,'error');
  else status(mediaFile&&subtitleFile?'준비 완료. 새 MKV 파일의 저장 위치를 선택해주세요.':'두 파일을 선택하면 시작할 수 있습니다.');
}
// Dropped files are sorted by extension, so both can be dropped at once on either zone or the page.
function route(files,fallback){
  if(busy||!files.length)return;
  const picked={};
  for(const file of files){const type=typeOf(file);if(type&&!picked[type])picked[type]=file;}
  if(!picked.video&&!picked.subtitle){if(fallback)chosen(fallback,files[0]);else status('MKV 또는 SRT 파일을 놓아주세요.','error');return;}
  for(const type of ['video','subtitle'])if(picked[type])chosen(type,picked[type]);
}
for(const [type,input,zone] of [['video',el.video,el.videoZone],['subtitle',el.subtitle,el.subtitleZone]]){
  // Clear the input after reading so picking the same file again still fires change.
  input.addEventListener('change',()=>{const file=input.files?.[0]||null;input.value='';chosen(type,file);});
  zone.addEventListener('keydown',event=>{if(!busy&&(event.key==='Enter'||event.key===' ')){event.preventDefault();input.click();}});
  zone.addEventListener('dragover',()=>{if(!busy)zone.classList.add('dragover');});
  zone.addEventListener('dragleave',event=>{if(!zone.contains(event.relatedTarget))zone.classList.remove('dragover');});
}
// Without this, a file dropped outside the zones would make the browser leave the page to open it.
window.addEventListener('dragover',event=>{if(event.dataTransfer?.types?.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect=busy?'none':'copy';}});
window.addEventListener('drop',event=>{
  const files=[...(event.dataTransfer?.files||[])];
  if(!files.length)return;
  event.preventDefault();
  for(const {zone} of Object.values(slots))zone.classList.remove('dragover');
  const zone=event.target.closest?.('.dropzone');
  route(files,zone===el.videoZone?'video':zone===el.subtitleZone?'subtitle':null);
});
el.language.addEventListener('change',()=>{
  const current=el.trackName.value.trim();
  if(!current||Object.values(TRACK_LABELS).includes(current))el.trackName.value=TRACK_LABELS[el.language.value]||'자막';
});

function memorySink(filename){
  const chunks=[];let total=0;
  return {
    async write(data){total+=data.byteLength;if(total>MEMORY_LIMIT)throw new Error('이 브라우저의 안전 다운로드 한도(256 MiB)를 초과합니다. 데스크톱 Chrome/Edge를 사용해주세요.');chunks.push(data);},
    async close(){const url=URL.createObjectURL(new Blob(chunks,{type:'video/x-matroska'}));chunks.length=0;const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);},
    async abort(){chunks.length=0;total=0;},
  };
}
function checkCancelled(){if(controller.signal.aborted)throw new DOMException('작업이 취소되었습니다.','AbortError');}

el.start.addEventListener('click',async()=>{
  if(busy||!mediaFile||!subtitleFile)return;
  // Freeze inputs before opening the asynchronous picker. No media reads precede
  // the picker call, keeping the browser's transient user activation intact.
  const input=mediaFile,srt=subtitleFile;
  const options={language:el.language.value,trackName:el.trackName.value.trim(),isDefault:$('make-default').checked};
  const filename=input.name.replace(/\.mkv$/i,'')+'-subtitled.mkv';
  controller=new AbortController();setBusy(true);el.progress.hidden=false;progress(0);
  let handle=null,createdOutput=false;
  try{
    if(srt.size>16*1024*1024)throw new Error('SRT 파일은 최대 16 MiB까지 지원합니다.');
    if(supportsDisk){
      handle=await window.showSaveFilePicker({suggestedName:filename,id:'mkv-subtitle-output',excludeAcceptAllOption:true,types:[{description:'Matroska Video',accept:{'video/x-matroska':['.mkv']}}]});
      await assertNewOutput(handle,input.name);
      createdOutput=true; // The picker may have left an empty file at the chosen path.
    }else if(input.size>MEMORY_LIMIT)throw new Error('대용량 저장을 지원하지 않는 브라우저입니다. 데스크톱 Chrome/Edge에서 HTTPS 페이지를 열어주세요.');
    checkCancelled();status('자막 파일을 확인하고 있습니다…');
    const decoded=decodeSrt(await srt.arrayBuffer()), cues=parseSrt(decoded.text);
    checkCancelled();status(`MKV 구조 분석 중… · 자막 ${cues.length.toLocaleString()}개 · ${decoded.encoding}`);
    const structure=await inspectMkv(input,{signal:controller.signal,onStatus:text=>status(text)});
    checkCancelled();
    const plan=planMux(structure,cues,options);
    if(!handle&&plan.total>MEMORY_LIMIT)throw new Error('예상 출력이 256 MiB를 초과합니다. 데스크톱 Chrome/Edge를 사용해주세요.');
    checkCancelled();
    if(handle)await assertNewOutput(handle,input.name); // Recheck immediately before opening a writer.
    checkCancelled();
    const sink=handle?await handle.createWritable():memorySink(filename);
    status('영상·음성을 재인코딩하지 않고 새 MKV를 저장하고 있습니다…');
    await writeMux(structure,plan,sink,{signal:controller.signal,onProgress:(percent,done,total)=>{progress(percent);status(`새 MKV 저장 중… ${prettyBytes(done)} / ${prettyBytes(total)}`);}});
    const saved=handle?`${handle.name}에 저장했습니다`:`${filename} 다운로드를 시작했습니다`;
    status(`완료! SRT 자막 트랙(${cues.length.toLocaleString()}구간)을 추가해 ${saved}. 플레이어에서 자막 트랙을 켜서 확인해보세요.`,'success');
  }catch(error){
    const leftover=createdOutput?' 선택한 위치에 빈 파일이 남았다면 삭제해도 됩니다.':'';
    status(error.name==='AbortError'?`작업이 취소되었습니다. 원본 파일은 변경하지 않았습니다.${leftover}`:`처리 실패: ${error.message}${leftover}`,'error');
  }
  finally{controller=null;setBusy(false);}
});
el.cancel.addEventListener('click',()=>{controller?.abort();el.cancel.disabled=true;status('작업을 중단하고 있습니다…');});
window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
if(supportsDisk)el.browserNote.textContent='이 브라우저는 대용량 파일도 디스크에 바로 저장합니다.';
else{el.browserWarning.hidden=false;el.browserNote.hidden=true;}
