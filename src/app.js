import { parseSrt, decodeSrt } from './subrip.js';
import { inspectMkv, planMux, writeMux } from './mux.js';
import { assertNewOutput } from './safety.js';
import { STRINGS, localizeMessage } from './i18n.js';

const $=id=>document.getElementById(id);
const el={video:$('video-file'),subtitle:$('subtitle-file'),videoZone:$('video-zone'),subtitleZone:$('subtitle-zone'),videoDisplay:$('video-display'),subtitleDisplay:$('subtitle-display'),status:$('status'),start:$('start'),progress:$('progress-wrap'),bar:$('progress-fill'),percent:$('progress-number'),cancel:$('cancel'),language:$('language'),trackName:$('track-name'),browserWarning:$('browser-warning'),langSwitch:$('lang-switch')};
const MEMORY_LIMIT=256*1024*1024;
const TRACK_LABELS={kor:'한국어',eng:'English',jpn:'日本語',und:'Subtitles'};
const SUBTITLE_LANG={en:'eng',ko:'kor'};
const supportsDisk=window.isSecureContext && typeof window.showSaveFilePicker==='function';
const prettyBytes=n=>n<1024*1024?`${(n/1024).toFixed(1)} KiB`:n<1024*1024*1024?`${(n/1024/1024).toFixed(1)} MiB`:`${(n/1024/1024/1024).toFixed(2)} GiB`;
const slots={video:{extension:'.mkv',zone:el.videoZone,display:el.videoDisplay,file:null,rejected:null},subtitle:{extension:'.srt',zone:el.subtitleZone,display:el.subtitleDisplay,file:null,rejected:null}};
let lang='en',busy=false,controller=null,languageTouched=false,lastStatus={key:'pickBoth'};

// Strings with {name} placeholders; core messages passed as `message` are translated at render time.
function t(key,params={}){return (STRINGS[lang][key]??STRINGS.en[key]).replace(/\{(\w+)\}/g,(_,name)=>name==='message'?localizeMessage(lang,params.message):params[name]??'');}
function status(key,params={},type=''){lastStatus={key,params,type};el.status.textContent=t(key,params)+(params.leftover?t('leftover'):'');el.status.className=`status ${type}`;}
function refresh(){el.start.disabled=busy||!slots.video.file||!slots.subtitle.file;}
function renderSlot(slot){
  slot.display.textContent=slot.file?`${slot.file.name} · ${prettyBytes(slot.file.size)}`:slot.rejected?t('wrongTypeDisplay',{ext:slot.extension,name:slot.rejected}):t('dropHint');
  slot.zone.classList.toggle('chosen',!!slot.file);slot.zone.classList.toggle('invalid',!!slot.rejected);
}
function idleStatus(){status(slots.video.file&&slots.subtitle.file?'ready':'pickBoth');}
function setLanguage(next){
  lang=next;document.documentElement.lang=next;document.title=t('pageTitle');
  for(const node of document.querySelectorAll('[data-i18n]'))node.textContent=t(node.dataset.i18n);
  el.langSwitch.textContent=t('switchLabel');el.langSwitch.lang=next==='en'?'ko':'en';
  if(busy)el.start.textContent=t('working');
  if(!languageTouched&&!busy){el.language.value=SUBTITLE_LANG[next];updateTrackName();}
  for(const slot of Object.values(slots))renderSlot(slot);
  status(lastStatus.key,lastStatus.params,lastStatus.type);
  try{localStorage.setItem('lang',next);}catch{}
}
function updateTrackName(){
  const current=el.trackName.value.trim();
  if(!current||Object.values(TRACK_LABELS).includes(current))el.trackName.value=TRACK_LABELS[el.language.value];
}
function setBusy(value){
  busy=value;
  for(const input of document.querySelectorAll('.card input,.card select'))input.disabled=value;
  el.langSwitch.disabled=value;
  el.start.textContent=t(value?'working':'start');
  el.cancel.hidden=!value;el.cancel.disabled=false;refresh();
  if(!value)document.title=t('pageTitle');
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
  slot.file=valid?file:null;slot.rejected=valid?null:file.name;
  renderSlot(slot);el.progress.hidden=true;refresh();
  if(valid)idleStatus();else status('wrongType',{ext:slot.extension},'error');
}
// Dropped files are sorted by extension, so both can be dropped at once on either zone or the page.
function route(files,fallback){
  if(busy||!files.length)return;
  const picked={};
  for(const file of files){const type=typeOf(file);if(type&&!picked[type])picked[type]=file;}
  if(!picked.video&&!picked.subtitle){if(fallback)chosen(fallback,files[0]);else status('dropUnknown',{},'error');return;}
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
el.language.addEventListener('change',()=>{languageTouched=true;updateTrackName();});
el.langSwitch.addEventListener('click',()=>setLanguage(lang==='en'?'ko':'en'));

function memorySink(filename){
  const chunks=[];let total=0;
  return {
    async write(data){total+=data.byteLength;if(total>MEMORY_LIMIT)throw new Error(t('memoryLimit'));chunks.push(data);},
    async close(){const url=URL.createObjectURL(new Blob(chunks,{type:'video/x-matroska'}));chunks.length=0;const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);},
    async abort(){chunks.length=0;total=0;},
  };
}
function checkCancelled(){if(controller.signal.aborted)throw new DOMException('The operation was cancelled.','AbortError');}

el.start.addEventListener('click',async()=>{
  if(busy||!slots.video.file||!slots.subtitle.file)return;
  // Freeze inputs before opening the asynchronous picker. No media reads precede
  // the picker call, keeping the browser's transient user activation intact.
  const input=slots.video.file,srt=slots.subtitle.file;
  const options={language:el.language.value,trackName:el.trackName.value.trim(),isDefault:$('make-default').checked};
  const filename=input.name.replace(/\.mkv$/i,'')+'-subtitled.mkv';
  controller=new AbortController();setBusy(true);el.progress.hidden=false;progress(0);
  let handle=null,createdOutput=false;
  try{
    if(srt.size>16*1024*1024)throw new Error('SRT files up to 16 MiB are supported.');
    if(supportsDisk){
      handle=await window.showSaveFilePicker({suggestedName:filename,id:'mkv-subtitle-output',excludeAcceptAllOption:true,types:[{description:'Matroska Video',accept:{'video/x-matroska':['.mkv']}}]});
      await assertNewOutput(handle,input.name);
      createdOutput=true; // The picker may have left an empty file at the chosen path.
    }else if(input.size>MEMORY_LIMIT)throw new Error(t('memoryLimit'));
    checkCancelled();status('readingSrt');
    const decoded=decodeSrt(await srt.arrayBuffer()), cues=parseSrt(decoded.text);
    const count=cues.length.toLocaleString();
    checkCancelled();status('analyzing',{count,encoding:decoded.encoding});
    const structure=await inspectMkv(input,{signal:controller.signal,onStatus:text=>status('raw',{message:text})});
    checkCancelled();
    const plan=planMux(structure,cues,options);
    if(!handle&&plan.total>MEMORY_LIMIT)throw new Error(t('memoryLimit'));
    checkCancelled();
    if(handle)await assertNewOutput(handle,input.name); // Recheck immediately before opening a writer.
    checkCancelled();
    const sink=handle?await handle.createWritable():memorySink(filename);
    status('writing');
    await writeMux(structure,plan,sink,{signal:controller.signal,onProgress:(percent,done,total)=>{progress(percent);status('saving',{done:prettyBytes(done),total:prettyBytes(total)});}});
    status(handle?'doneDisk':'doneDownload',{name:handle?.name??filename,count},'success');
  }catch(error){
    if(error.name==='AbortError')status('cancelled',{leftover:createdOutput},'error');
    else status('failed',{message:error.message,leftover:createdOutput},'error');
  }
  finally{controller=null;setBusy(false);}
});
el.cancel.addEventListener('click',()=>{controller?.abort();el.cancel.disabled=true;status('cancelling');});
window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
if(!supportsDisk)el.browserWarning.hidden=false;
let saved=null;try{saved=localStorage.getItem('lang');}catch{}
setLanguage(saved==='ko'?'ko':'en');
