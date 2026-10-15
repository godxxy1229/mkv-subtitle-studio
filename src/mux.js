import { ID, parseHeader, parseChildren, fileHeader, readUInt, encodeUInt, encodeId, encodeVint, element, uintElement, textElement, master, rawChild, concat, segmentHeader } from './ebml.js';

const MAX_META = 96 * 1024 * 1024;
const CHUNK_SIZE = 4 * 1024 * 1024;
const SEEK_ITEMS = [ID.Info, ID.Tracks, ID.Chapters, ID.Attachments, ID.Tags, ID.Cues, ID.Cluster];

function ensure(condition, message) { if (!condition) throw new Error(message); }

async function readElementData(file, item, max = MAX_META) {
  ensure(item.size <= max, 'MKV 메타데이터가 너무 커서 처리할 수 없습니다.');
  return new Uint8Array(await file.slice(item.dataStart, item.end).arrayBuffer());
}

async function clusterTimestamp(file, item, signal) {
  // Scan only element headers, skipping encoded payloads. A 4 KiB read-ahead
  // cache bounds memory/IO and also finds deprecated offsets after media blocks.
  let cacheStart=-1,cache=new Uint8Array();
  async function header(at,boundary) {
    if(at<cacheStart || at+Math.min(12,boundary-at)>cacheStart+cache.length){
      cacheStart=at;cache=new Uint8Array(await file.slice(at,Math.min(at+4096,item.end)).arrayBuffer());
    }
    const e=parseHeader(cache,at-cacheStart);
    const child={...e,start:at,dataStart:cacheStart+e.dataStart,end:e.unknown?null:cacheStart+e.end};
    ensure(!child.unknown && child.end<=boundary,'지원되지 않거나 잘린 클러스터 요소입니다.');
    return child;
  }
  let found=null,position=item.dataStart,count=0;
  while(position<item.end){
    if(signal?.aborted)throw new DOMException('작업이 취소되었습니다.','AbortError');
    const child=await header(position,item.end);
    ensure(++count<=2000000,'단일 클러스터의 요소가 지나치게 많습니다.');
    ensure(child.id!==ID.Position && child.id!==ID.PrevSize,
      '내부 위치/이전 크기를 기록한 클러스터는 현재 지원하지 않습니다.');
    if(child.id===ID.Timestamp){
      ensure(found===null && child.size<=8,'잘못된 클러스터 시간 정보입니다.');
      found=readUInt(new Uint8Array(await file.slice(child.dataStart,child.end).arrayBuffer()));
    }
    if(child.id===ID.BlockGroup){
      for(let pos=child.dataStart;pos<child.end;){
        const part=await header(pos,child.end);
        ensure(part.id!==0xC8,'위치 참조형 ReferenceFrame 블록은 현재 지원하지 않습니다.');
        pos=part.end;
      }
    }
    position=child.end;
  }
  ensure(found!==null,'클러스터의 Timestamp를 읽을 수 없습니다.');
  return found;
}


async function outputEbmlHeader(file, ebml) {
  const data = await readElementData(file,ebml,1024*1024);
  const children = parseChildren(data);
  const get = id => children.find(e=>e.id===id);
  const value = (id,def) => { const e=get(id);return e?readUInt(data.subarray(e.dataStart,e.end)):def; };
  const type = get(ID.DocType);
  ensure(type && new TextDecoder().decode(data.subarray(type.dataStart,type.end))==='matroska',
    'Matroska MKV만 지원합니다. WebM/MP4 확장자를 바꾼 파일은 지원하지 않습니다.');
  ensure(value(ID.EBMLReadVersion,1)<=1 && value(ID.DocTypeReadVersion,1)<=4 &&
    value(ID.EBMLMaxIDLength,4)<=4 && value(ID.EBMLMaxSizeLength,8)<=8,
    '지원 범위를 벗어나는 MKV 문서 버전입니다.');
  const parts=children.filter(e=>![ID.DocTypeVersion,ID.CRC32].includes(e.id)).map(e=>rawChild(data,e));
  parts.push(uintElement(ID.DocTypeVersion,Math.max(4,value(ID.DocTypeVersion,1))));
  return master(ID.EBML,...parts);
}

function timestampScaleOf(infoData) {
  let scale = 1000000;
  for (const e of parseChildren(infoData)) if (e.id === ID.TimestampScale) {
    scale = readUInt(infoData.subarray(e.dataStart,e.end));
  }
  ensure(Number.isSafeInteger(scale) && scale > 0, 'MKV 타임스탬프 배율이 잘못되었습니다.');
  return scale;
}

function newTracks(tracksData, { language, trackName, isDefault }) {
  const existingEntries = parseChildren(tracksData);
  let maxTrack = 0;
  const seenUids = new Set();
  const pieces = [];
  for (const entry of existingEntries) {
    if (entry.id === ID.CRC32) continue; // Tracks changes invalidate original CRC.
    if (entry.id !== ID.TrackEntry) { pieces.push(rawChild(tracksData,entry)); continue; }
    const fields=parseChildren(tracksData,entry.dataStart,entry.end);
    const type=fields.find(e=>e.id===ID.TrackType);
    const isSubtitle=type && readUInt(tracksData.subarray(type.dataStart,type.end))===17;
    // FlagDefault is implicitly 1 when absent. Remove old subtitle defaults only,
    // preserving audio/video defaults and every existing compressed payload.
    pieces.push(isDefault && isSubtitle ? master(ID.TrackEntry,
      ...fields.filter(e=>![ID.FlagDefault,ID.CRC32].includes(e.id)).map(e=>rawChild(tracksData,e)),
      uintElement(ID.FlagDefault,0)) : rawChild(tracksData,entry));
    for (const part of fields) {
      if (part.id === ID.TrackNumber) maxTrack = Math.max(maxTrack, readUInt(tracksData.subarray(part.dataStart,part.end)));
      if (part.id === ID.TrackUID) { const uidBytes=tracksData.subarray(part.dataStart,part.end); seenUids.add(Array.from(uidBytes, b=>b.toString(16).padStart(2,'0')).join('').replace(/^0+/,'')); }
    }
  }
  const track = maxTrack + 1;
  ensure(track < 1000000, '트랙 수가 비정상적입니다.');
  const random = new Uint8Array(8);
  let uid;
  do {
    crypto.getRandomValues(random);
    // 53 bits avoid unsafe JS while retaining randomization.
    uid = (BigInt(random[0] & 31) << 48n) | (BigInt(random[1]) << 40n) |
      (BigInt(random[2]) << 32n) | (BigInt(random[3]) << 24n) |
      (BigInt(random[4]) << 16n) | (BigInt(random[5]) << 8n) | BigInt(random[6]);
  } while (uid === 0n || seenUids.has(uid.toString(16)));
  const lang = language === 'kor' ? 'ko' : language === 'jpn' ? 'ja' : language === 'eng' ? 'en' : 'und';
  const entry = master(ID.TrackEntry,
    uintElement(ID.TrackNumber,track), uintElement(ID.TrackUID,uid),
    uintElement(ID.TrackType, 17), uintElement(ID.FlagDefault,isDefault?1:0),
    uintElement(ID.FlagForced,0), textElement(ID.CodecID,'S_TEXT/UTF8'),
    textElement(ID.Language,language), textElement(ID.LanguageIETF,lang),
    textElement(ID.Name,trackName || '자막')
  );
  pieces.push(entry);
  return { content: master(ID.Tracks, ...pieces), track };
}

function encodeTrackVint(number) {
  // Same VINT encoding as EBML sizes, but all-one values are legal track numbers.
  const num = BigInt(number);
  for(let width=1;width<=8;width++) {
    if (num < (1n << BigInt(7*width))) {
      let n = num | (1n << BigInt(7*width));
      const bytes = new Uint8Array(width);
      for(let i=width-1;i>=0;i--){ bytes[i]=Number(n&255n); n>>=8n; }
      return bytes;
    }
  }
  throw new Error('트랙 번호가 너무 큽니다.');
}

function subtitleCluster(cue, track, scale) {
  const start = Math.round(cue.startMs * 1000000 / scale);
  const duration = Math.max(1, Math.round((cue.endMs-cue.startMs)*1000000 / scale));
  const text = new TextEncoder().encode(cue.text);
  // Block: TrackNumber VINT + 2-byte signed relative timestamp + flags + UTF-8 payload.
  const block = element(ID.Block, concat(encodeTrackVint(track), Uint8Array.of(0,0,0),text));
  return master(ID.Cluster, uintElement(ID.Timestamp,start), master(ID.BlockGroup, block, uintElement(ID.BlockDuration,duration)));
}

function seekHead(positions) {
  const children=[];
  for (const id of SEEK_ITEMS) {
    if(!positions.has(id)) continue;
    children.push(master(ID.Seek,element(ID.SeekID,encodeId(id)),uintElement(ID.SeekPosition,positions.get(id),8)));
  }
  return master(ID.SeekHead,...children);
}

function patchedCues(cueData, oldToNew) {
  if (!cueData) return [];
  const result=[];
  for(const p of parseChildren(cueData)) {
    if(p.id===ID.CRC32 || p.id===ID.Void) continue;
    if(p.id!==ID.CuePoint){result.push(rawChild(cueData,p));continue;}
    const children=[];
    for(const c of parseChildren(cueData,p.dataStart,p.end)){
      if(c.id===ID.CRC32)continue;
      if(c.id!==ID.CueTrackPositions){children.push(rawChild(cueData,c));continue;}
      const inner=[];
      for(const t of parseChildren(cueData,c.dataStart,c.end)) {
        ensure(t.id!==ID.CueReference,'참조형 Cue 인덱스는 현재 지원하지 않습니다.');
        ensure(t.id!==ID.CueCodecState || readUInt(cueData.subarray(t.dataStart,t.end))===0,
          '위치 기반 CodecState 인덱스는 현재 지원하지 않습니다.');
        if(t.id===ID.CueClusterPosition){
          const old=readUInt(cueData.subarray(t.dataStart,t.end));
          const revised=oldToNew.get(old);
          ensure(revised!==undefined, '원본 MKV 탐색 인덱스가 유효하지 않아 안전하게 변환할 수 없습니다.');
          inner.push(uintElement(ID.CueClusterPosition,revised,8));
        } else if(t.id!==ID.CRC32) inner.push(rawChild(cueData,t));
      }
      children.push(master(ID.CueTrackPositions,...inner));
    }
    result.push(master(ID.CuePoint,...children));
  }
  return result;
}

function cueTimeOf(raw) {
  const head=parseHeader(raw,0);
  const pos=parseChildren(raw,head.dataStart,head.end).find(e=>e.id===ID.CueTime);
  return pos ? readUInt(raw.subarray(pos.dataStart,pos.end)) : 0;
}

/** Scan MKV top-level EBML structure without reading the media payload into RAM. */
export async function inspectMkv(file,{onStatus=()=>{},signal=null}={}) {
  ensure(file && file.size>32,'MKV 파일이 비어 있거나 잘못되었습니다.');
  const ebml=await fileHeader(file,0);
  ensure(ebml.id===ID.EBML && !ebml.unknown,'유효한 MKV EBML 헤더를 찾지 못했습니다.');
  ensure(ebml.end<=file.size,'MKV EBML 헤더가 잘렸습니다.');
  const outputHeader=await outputEbmlHeader(file,ebml);
  let segPos=ebml.end;
  let segment;
  for(let count=0;count<10 && segPos<file.size;count++){
    const p=await fileHeader(file,segPos);
    if(p.id===ID.Segment){segment=p;break;}
    ensure(!p.unknown && (p.id===ID.Void || p.id===ID.CRC32),'Segment 요소를 찾지 못했습니다.');
    segPos=p.end;
  }
  ensure(segment,'MKV Segment를 찾지 못했습니다.');
  ensure(segment.unknown || segment.end===file.size,'파일이 잘렸거나 여러 Segment가 들어 있는 MKV는 지원하지 않습니다.');
  const end=segment.unknown?file.size:segment.end;
  const items=[];
  let pos=segment.dataStart;
  let lastTime=-1;
  let scanned=0;
  while(pos<end) {
    if(signal?.aborted) throw new DOMException('작업이 취소되었습니다.','AbortError');
    const item=await fileHeader(file,pos);
    ensure(!item.unknown && item.end<=end && item.end>pos,'크기가 알려지지 않은 요소 또는 손상된 MKV입니다.');
    if(item.id===ID.Cluster){
      item.time=await clusterTimestamp(file,item,signal);
      ensure(item.time>=lastTime,'클러스터 시간이 역순인 MKV는 현재 지원되지 않습니다.');
      lastTime=item.time;
    }
    ensure([ID.Info,ID.Tracks,ID.Cluster,ID.Cues,ID.SeekHead,ID.Attachments,ID.Chapters,ID.Tags,ID.Void,ID.CRC32].includes(item.id),
      '서명 또는 알 수 없는 최상위 요소가 있는 MKV는 안전을 위해 처리하지 않습니다.');
    items.push(item);
    pos=item.end;
    if((++scanned%50)===0) onStatus(`MKV 구조 분석 중 · ${Math.min(100,Math.round(pos*100/file.size))}%`);
    ensure(scanned<250000,'MKV 요소가 지나치게 많습니다.');
  }
  ensure(items.filter(e=>e.id===ID.Info).length===1 && items.filter(e=>e.id===ID.Tracks).length===1,'Info/Tracks 요소가 중복되었거나 없습니다.');
  for(const id of [ID.Attachments,ID.Chapters,ID.Tags]) ensure(items.filter(e=>e.id===id).length<=1,'중복된 메타데이터 요소는 현재 지원하지 않습니다.');
  const info=items.find(e=>e.id===ID.Info);
  const tracks=items.find(e=>e.id===ID.Tracks);
  ensure(info&&tracks,'MKV의 Info 또는 Tracks 요소가 없습니다.');
  const clusters=items.filter(e=>e.id===ID.Cluster);
  ensure(clusters.length>0,'영상/음성이 들어 있는 Cluster를 찾지 못했습니다.');
  const infoData=await readElementData(file,info,8*1024*1024);
  const tracksData=await readElementData(file,tracks,8*1024*1024);
  const cueItems=items.filter(e=>e.id===ID.Cues);
  ensure(cueItems.length<=1,'여러 Cues 요소가 들어 있는 MKV는 지원되지 않습니다.');
  const cueData=cueItems.length? await readElementData(file,cueItems[0],MAX_META):null;
  return { file, ebml, outputHeader, segment, items, clusters, scale:timestampScaleOf(infoData), info, tracksData, cueData };
}

/** Create a byte-accurate mux plan. O(file metadata + caption count) RAM. */
export function planMux(structure, captions, settings={}) {
  ensure(Array.isArray(captions) && captions.length,'자막이 없습니다.');
  ensure(captions.length<=50000,'SRT 자막 구간이 너무 많습니다.');
  for(let i=0;i<captions.length;i++){
    const c=captions[i];
    ensure(Number.isSafeInteger(c.startMs)&&Number.isSafeInteger(c.endMs)&&c.startMs>=0&&c.endMs>c.startMs&&typeof c.text==='string'&&c.text.length>0,'자막 구간이 잘못되었습니다.');
    ensure(i===0 || c.startMs>=captions[i-1].startMs,'자막을 시간순으로 정렬해주세요.');
  }
  const {items,clusters,tracksData,info,scale,segment}=structure;
  const {content:tracksContent,track}=newTracks(tracksData,{
    language:settings.language||'kor',trackName:settings.trackName||'한국어 자막',isDefault:!!settings.isDefault,
  });
  const allCaptions=captions.map(c=>({...c,ticks:Math.round(c.startMs*1000000/scale)}));
  const extraItems=items.filter(e=>![ID.Info,ID.Tracks,ID.Cluster,ID.SeekHead,ID.Cues,ID.Void,ID.CRC32].includes(e.id));
  const positions=new Map([[ID.Info,0],[ID.Tracks,0],[ID.Cues,0],[ID.Cluster,0]]);
  for(const m of extraItems) if(SEEK_ITEMS.includes(m.id)) positions.set(m.id,0);
  const seekPlaceholder=seekHead(positions);
  let at=seekPlaceholder.byteLength;
  const operations=[];
  const add=(item,type,data) => {const pos=at;at += item; operations.push({type,pos,data,length:item});return pos;};
  const infoPos=add(info.end-info.start,'source',info);
  positions.set(ID.Info,infoPos);
  const trackPos=add(tracksContent.byteLength,'bytes',tracksContent);
  positions.set(ID.Tracks,trackPos);
  for(const m of extraItems){const mp=add(m.end-m.start,'source',m);if(positions.has(m.id))positions.set(m.id,mp);}
  let si=0;
  const oldToNew=new Map();
  const subtitlePoints=[];
  for(let i=0;i<clusters.length;i++) {
    const original=clusters[i];
    // Place events BEFORE a source cluster if its time has arrived, else after previous cluster.
    while(si<allCaptions.length && allCaptions[si].ticks<=original.time){
      const c=allCaptions[si++];
      const data=subtitleCluster(c,track,scale);
      const place=add(data.byteLength,'bytes',data);
      subtitlePoints.push(master(ID.CuePoint,uintElement(ID.CueTime,c.ticks),master(ID.CueTrackPositions,uintElement(ID.CueTrack,track),uintElement(ID.CueClusterPosition,place,8))));
    }
    const place=add(original.end-original.start,'source',original);
    oldToNew.set(original.start-segment.dataStart,place);
    if(!positions.get(ID.Cluster)) positions.set(ID.Cluster,place);
  }
  while(si<allCaptions.length){
    const c=allCaptions[si++];const data=subtitleCluster(c,track,scale);
    const place=add(data.byteLength,'bytes',data);
    subtitlePoints.push(master(ID.CuePoint,uintElement(ID.CueTime,c.ticks),master(ID.CueTrackPositions,uintElement(ID.CueTrack,track),uintElement(ID.CueClusterPosition,place,8))));
  }
  const existing=patchedCues(structure.cueData,oldToNew);
  const cuePoints=[...existing,...subtitlePoints].sort((a,b)=>cueTimeOf(a)-cueTimeOf(b));
  positions.set(ID.Cues,at);
  const cues=master(ID.Cues,...cuePoints);
  add(cues.byteLength,'bytes',cues);
  const seek=seekHead(positions);
  ensure(seek.byteLength===seekPlaceholder.byteLength,'SeekHead 크기 오류입니다.');
  const total=structure.outputHeader.byteLength+segmentHeader().byteLength+at;
  return {seek,operations,track,captionCount:captions.length,total,scale};
}

/** Sink must have async write(Uint8Array), close() and optional abort(). */
export async function writeMux(structure,plan,sink,{onProgress=()=>{},signal=null}={}) {
  const {file,ebml}=structure;
  let done=0;
  let lastReported=-1;
  async function push(chunk) {
    if(signal?.aborted) throw new DOMException('작업이 취소되었습니다.','AbortError');
    await sink.write(chunk);
    done+=chunk.byteLength;
    const pct=Math.min(100,Math.floor(done*100/plan.total));
    if(pct!==lastReported){ lastReported=pct;onProgress(pct,done,plan.total); }
  }
  async function copy(start,end) {
    for(let pos=start;pos<end;pos+=CHUNK_SIZE) {
      const next=Math.min(pos+CHUNK_SIZE,end);
      await push(new Uint8Array(await file.slice(pos,next).arrayBuffer()));
    }
  }
  try {
    await push(structure.outputHeader);
    await push(segmentHeader());
    await push(plan.seek);
    for(const op of plan.operations) {
      if(op.type==='bytes') await push(op.data);
      else await copy(op.data.start,op.data.end);
    }
    ensure(done===plan.total,'출력 크기 검증에 실패했습니다.');
    if(signal?.aborted) throw new DOMException('작업이 취소되었습니다.','AbortError');
    await sink.close();
  } catch(error){try{await sink.abort?.();}catch{}throw error;}
}
