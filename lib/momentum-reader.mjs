// Public signal-only observations. Daily admission is durable and independent of
// the owner's private paper journal. Historical replay is never a delivered alert.
import {readExtendedTradingView} from './tradingview-feed.mjs';
import {etParts} from './saty-live.mjs';
import {replayMomentum,manageMomentum,momentumStats,validMomentumReservation,MOMENTUM_VERSION} from './momentum.mjs';

export const MOMENTUM_DAY_PREFIX='saty-plus/momentum-v1/';
export const MOMENTUM_EVIDENCE_KEY=MOMENTUM_DAY_PREFIX+'evidence.json';
export const MOMENTUM_PREMARKET_KEY='saty-plus/momentum-premarket-v1.json';
export const MOMENTUM_FORWARD_FROM='2026-10-26';
const SYMBOLS=['SPY','SPX','AAPL','GOOGL'],T=Date.parse,iso=t=>new Date(t).toISOString();
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const EVIDENCE_FIELDS=new Set(['id','version','symbol','side','direction','session_date','decision_at','entry_at','entry','exit','exit_at','status','state','target_hit','target_hit_at','last_price_at','return_pct','exit_reason','first_observed_at','observation_kind']);
const timestamp=x=>typeof x==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(T(x));

// Premarket means this date's 04:00–09:30 ET, never prior after-hours bars.
// A partial range is not silently advertised as the session's high/low.
export function momentumPremarketReference(feed,day,calendar,source=null){
 const session=calendar.sessions?.[day],open=T(session?.open);
 if(!Number.isFinite(open)||!feed?.source?.source_id)return null;
 if(source?.source_id&&feed.source.source_id!==source.source_id)return null;
 if(finite(feed.source.reported_delay)&&feed.source.reported_delay>0)return null;
 const start=open-330*60000,byTime=new Map();
 for(const b of feed.bars??[]){const at=T(b.time);if(at<start||at>=open||!Number.isFinite(at)||!['open','high','low','close'].every(k=>finite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))continue;byTime.set(at,b);}
 const rows=Array.from({length:330},(_,i)=>byTime.get(start+i*60000));
 if(rows.some(b=>!b))return null;
 return {day,session_date:day,low:Math.min(...rows.map(b=>b.low)),high:Math.max(...rows.map(b=>b.high)),asof:iso(open),start:iso(start),bar_count:330,complete:true,session_basis:'PREMARKET',source:feed.source};
}

function publicBundle(bundle,momentum){
 const {momentum_context,alert_budget,...rest}=bundle;
 const symbols={};
 for(const [symbol,s] of Object.entries(bundle.symbols??{})){
  const {approved_rules,conservative_rules,level_bounce,live_alerts,...reference}=s;
  symbols[symbol]={...reference,signals:(s.signals??[]).map(x=>({...x,live:false,research_only:true}))};
 }
 return {...rest,symbols,momentum};
}

function eligibleBatch(bundle,day,now,calendar){
 const session=calendar.sessions?.[day];if(!session||now<T(session.open)||now>=T(session.close))return false;
 let close=null;
 for(const symbol of SYMBOLS){
  const s=bundle.symbols?.[symbol],at=T(s?.health?.price_asof);
  if(s?.session?.date!==day||s?.health?.state!=='CURRENT'||!Number.isFinite(at)||now-at<0||now-at>225000)return false;
  if(close!==null&&at!==close)return false;close=at;
 }
 return true;
}

function compactEvidence(signal){
 if(!signal)return null;
 const result={};
 for(const k of EVIDENCE_FIELDS)if(signal[k]!==undefined)result[k]=signal[k];
 return result;
}

// Evidence is a compact copy of an actually issued observation, not a trusted
// aggregate or an arbitrary target_hit flag. Validate every row before counting.
export function validMomentumEvidence(record,day,calendar,now=Date.now()){
 if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).some(k=>!EVIDENCE_FIELDS.has(k)))return false;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day<MOMENTUM_FORWARD_FROM||record.session_date!==day||record.version!==MOMENTUM_VERSION||!SYMBOLS.includes(record.symbol)||![1,-1].includes(record.side)||record.observation_kind!=='ISSUED')return false;
 if(typeof record.id!=='string'||!record.id.startsWith(`${MOMENTUM_VERSION}|${record.symbol}|${day}|`)||record.id.length>500)return false;
 if(record.direction!==undefined&&record.direction!==(record.side===1?'CALL':'PUT'))return false;
 const allowed={PENDING_ENTRY:['WAIT'],TRACKING:['HOLD','GET READY TO EXIT'],UNRESOLVED:['DATA HOLD'],CLOSED:['EXIT']};
 if(!allowed[record.state]?.includes(record.status)||typeof record.target_hit!=='boolean')return false;
 if(!timestamp(record.entry_at)||!timestamp(record.decision_at)||!timestamp(record.first_observed_at))return false;
 const session=calendar.sessions?.[day],entry=T(record.entry_at),observed=T(record.first_observed_at),deadline=T(session?.close)-300000;
 if(!session||entry!==T(record.decision_at)||entry<=T(session.open)||entry>=deadline||etParts(entry).day!==day||etParts(entry).hm>='15:00'||(entry-T(session.open))%180000!==0)return false;
 if(observed<entry||observed-entry>60000||observed>now)return false;
 const hasEntry=finite(record.entry)&&record.entry>0;
 if(record.entry!==null&&!hasEntry)return false;
 if(['TRACKING','CLOSED'].includes(record.state)&&!hasEntry)return false;
 if(record.state==='PENDING_ENTRY'&&(record.entry!==null||record.target_hit))return false;
 if(record.last_price_at!=null&&(!timestamp(record.last_price_at)||T(record.last_price_at)<entry||T(record.last_price_at)>Math.min(now,deadline)))return false;
 if(record.target_hit){
  if(!hasEntry||!timestamp(record.target_hit_at)||T(record.target_hit_at)<entry||T(record.target_hit_at)>Math.min(now,deadline))return false;
 }else if(record.target_hit_at!=null)return false;
 if(record.state==='CLOSED'){
  if(!finite(record.exit)||record.exit<=0||!timestamp(record.exit_at)||T(record.exit_at)<entry||T(record.exit_at)>Math.min(now,deadline)||!finite(record.return_pct)||typeof record.exit_reason!=='string'||!record.exit_reason.trim())return false;
  if(Math.abs(record.return_pct-record.side*(record.exit/record.entry-1)*100)>1e-6)return false;
  if(record.target_hit&&T(record.target_hit_at)>T(record.exit_at))return false;
 }else if(['exit','exit_at','return_pct','exit_reason'].some(k=>record[k]!=null))return false;
 return true;
}

function validEvidenceIndex(value,calendar,now){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.schema_version!==1||value.version!==MOMENTUM_VERSION||value.from!==MOMENTUM_FORWARD_FROM||!value.records||typeof value.records!=='object'||Array.isArray(value.records))return false;
 if(Object.keys(value).some(k=>!['schema_version','version','from','records','updated_at'].includes(k)))return false;
 if(value.updated_at!=null&&(!timestamp(value.updated_at)||T(value.updated_at)>now))return false;
 const seen=new Set();
 for(const [day,record] of Object.entries(value.records)){if(!validMomentumEvidence(record,day,calendar,now)||seen.has(record.id))return false;seen.add(record.id);}
 return true;
}

function evidenceStamp(record){return Math.max(...['exit_at','last_price_at','target_hit_at','decision_at','first_observed_at'].map(k=>T(record?.[k])).filter(Number.isFinite),0);}
// A slow visitor's older result cannot undo a win or a completed observation.
export function mergeMomentumEvidence(previous,next){
 if(!previous)return next;if(!next)return previous;if(previous.id!==next.id)return previous;
 let base=previous.state==='CLOSED'?previous:next.state==='CLOSED'?next:evidenceStamp(next)>=evidenceStamp(previous)?next:previous;
 if(previous.target_hit===true||next.target_hit===true){const times=[previous.target_hit_at,next.target_hit_at].filter(x=>Number.isFinite(T(x))).sort((a,b)=>T(a)-T(b));base={...base,target_hit:true,...(times.length?{target_hit_at:times[0]}:{})};}
 return base;
}

export function createMomentumReader(calendar,{clock=()=>Date.now(),overnightReader=readExtendedTradingView,replay=replayMomentum,manage=manageMomentum,summarize=momentumStats}={}){
 let pm={day:null,values:{},attempts:{}},pmLoaded=false,pmInflight=null;
 const retained=new Map(),reconcileChecked=new Map();let evidenceRetained=null;

 async function premarket(bundle,bucket,day,now){
  if(!pmLoaded){if(bucket)try{const saved=await(await bucket.get(MOMENTUM_PREMARKET_KEY))?.json();if(saved?.day&&saved.values)pm=saved;}catch{}pmLoaded=true;}
  if(pm.day!==day)pm={day,values:{},attempts:{}};
  const session=calendar.sessions?.[day];
  // No extra overnight polling. Fetch one complete frozen reference after open;
  // failed public-feed reads retry at most every ten minutes during RTH.
  if(!session||now<T(session.open)||now>=T(session.close))return pm.values;
  pmInflight??=(async()=>{
   let changed=false;
   await Promise.all(['SPY','AAPL','GOOGL'].map(async symbol=>{
    const source=bundle.momentum_context?.[symbol]?.source??bundle.symbols?.[symbol]?.health?.source;
    const saved=pm.values[symbol];
    if(saved?.source?.source_id===source?.source_id&&saved.complete===true&&saved.session_date===day&&saved.day===day&&saved.bar_count===330&&T(saved.asof)===T(session.open)&&finite(saved.low)&&saved.low>0&&finite(saved.high)&&saved.high>=saved.low)return;
    delete pm.values[symbol];
    if(now-(pm.attempts[symbol]??0)<600000)return;
    pm.attempts[symbol]=now;
    try{const feed=await overnightReader(symbol),ref=momentumPremarketReference(feed,day,calendar,source);if(ref){pm.values[symbol]=ref;changed=true;}}catch{}
   }));
   if(changed&&bucket)try{await bucket.put(MOMENTUM_PREMARKET_KEY,JSON.stringify(pm),{httpMetadata:{contentType:'application/json'}});}catch{}
  })();try{await pmInflight;}finally{pmInflight=null;}
  return pm.values;
 }

 async function reconcilePrevious(bucket,day,inputs,now){
  const updates={};
  const days=Object.keys(calendar.sessions??{}).filter(d=>d>=MOMENTUM_FORWARD_FROM&&d<day).sort().slice(-5);
  await Promise.all(days.map(async date=>{
   if(now-(reconcileChecked.get(date)??0)<60000)return;
   const key=MOMENTUM_DAY_PREFIX+date+'.json';
   try{
    const object=await bucket.get(key),record=await object?.json();
    if(!record){reconcileChecked.set(date,now);return;}
    if(record.version!==MOMENTUM_VERSION||record.day!==date||!validMomentumReservation(record.reservation))return;
    let saved=record.reservation;
    if(saved.state!=='CLOSED'){
     const input=inputs[saved.symbol],session=calendar.sessions[date],bars=(input?.history??[]).filter(b=>T(b.time)>=T(session.open)&&T(b.time)<T(session.close));
     if(bars.length&&input?.snapshot){
      const snapshot={...input.snapshot,session:{...session,date},market:{...input.snapshot.market,atr14:saved.atr},levels:saved.levels,bars};
      const next={...manage(saved,{...input,snapshot},{now}),first_observed_at:saved.first_observed_at,observation_kind:'ISSUED'};
      if(!same(saved,next)){
       const written=await bucket.put(key,JSON.stringify({...record,updated_at:iso(now),reservation:next}),{httpMetadata:{contentType:'application/json'},onlyIf:{etagMatches:object.etag}});
       if(!written)return;saved=next;
      }
     }
    }
    updates[date]=compactEvidence(saved);reconcileChecked.set(date,now);
   }catch{} // Retain the unresolved record; never infer a missing time exit.
  }));
  return updates;
 }

 async function evidence(bucket,day,signal,now,inputs){
  if(!bucket)return {stats:null,state:'DATA HOLD',reason:'Forward evidence storage is unavailable'};
  // A visitor need not remain on the dashboard through 15:55. On later reads,
  // use the bounded retained bar history to finish prior observed signals.
  const reconciled=await reconcilePrevious(bucket,day,inputs,now);
  for(let attempt=0;attempt<3;attempt++){
   let current,etag;
   try{const object=await bucket.get(MOMENTUM_EVIDENCE_KEY);etag=object?.etag;current=await object?.json();
    if(current&&!validEvidenceIndex(current,calendar,now))throw Error('Invalid saved evidence');
   }catch{return {stats:evidenceRetained,state:'DATA HOLD',reason:'Forward evidence could not be read'};}
   current??={schema_version:1,version:MOMENTUM_VERSION,from:MOMENTUM_FORWARD_FROM,records:{}};
   const record=compactEvidence(signal),previous=current.records[day],records={...current.records};
   if(record&&!validMomentumEvidence(record,day,calendar,now)||Object.entries(reconciled).some(([date,value])=>!validMomentumEvidence(value,date,calendar,now)))return {stats:evidenceRetained,state:'DATA HOLD',reason:'A saved forward outcome is invalid; statistics are withheld'};
   if(record&&previous&&record.id!==previous.id)return {stats:evidenceRetained,state:'DATA HOLD',reason:'Forward evidence disagrees with the saved daily signal'};
   for(const [date,value] of Object.entries(reconciled))if(value?.observation_kind==='ISSUED'&&(!records[date]||records[date].id===value.id))records[date]=mergeMomentumEvidence(records[date],value);
   if(record?.observation_kind==='ISSUED')records[day]=mergeMomentumEvidence(records[day],record);
   if(!Object.entries(records).every(([date,value])=>validMomentumEvidence(value,date,calendar,now)))return {stats:evidenceRetained,state:'DATA HOLD',reason:'Forward outcomes conflict; statistics are withheld'};
   if(!same(current.records,records)){
    const updated={...current,updated_at:iso(now),records};
    try{const written=await bucket.put(MOMENTUM_EVIDENCE_KEY,JSON.stringify(updated),{httpMetadata:{contentType:'application/json'},onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'}});if(written===null){if(attempt<2)continue;throw Error('Conflict');}if(!written)throw Error('No write result');current=updated;}
    catch{return {stats:evidenceRetained,state:'DATA HOLD',reason:'Forward evidence could not be saved'};}
   }
   const rows=Object.values(current.records),stats={...summarize(rows),sample:'FORWARD',issued_n:rows.length,pending_n:rows.filter(r=>r.state==='PENDING_ENTRY').length,unresolved_n:rows.filter(r=>r.state==='UNRESOLVED').length,from:current.from,asof:current.updated_at??null};
   evidenceRetained=stats;return {stats,state:'CURRENT',reason:null};
  }
  return {stats:evidenceRetained,state:'DATA HOLD',reason:'Forward evidence update conflicted'};
 }

 return async function attachMomentum(bundle,bucket){
  let now=clock();const day=etParts(now).day,session=calendar.sessions?.[day];
  const pmValues=await premarket(bundle,bucket,day,now),inputs={};now=clock();
  const active=!!session&&now>=T(session.open)&&now<T(session.close),beforeCutoff=etParts(now).hm<'15:00';
  for(const symbol of SYMBOLS){const raw=bundle.momentum_context?.[symbol]??{};inputs[symbol]={snapshot:bundle.symbols?.[symbol],source:raw.source,history:raw.history??raw.bars??[],one_bars:raw.one_bars??bundle.symbols?.[symbol]?.one_minute_bars??[],overnight:symbol==='SPX'?null:pmValues[symbol]??null};}
  const synced=eligibleBatch(bundle,day,now,calendar),allowNew=active&&beforeCutoff&&synced&&day>=MOMENTUM_FORWARD_FROM;
  const key=MOMENTUM_DAY_PREFIX+day+'.json';let result=null,admitted=null,storage='CURRENT',storageReason=null;
  for(let attempt=0;attempt<3;attempt++){
   let prior=null,etag=null;
   try{
    if(!bucket)throw Error('No storage');
    const object=await bucket.get(key);etag=object?.etag;prior=await object?.json();
    if(prior&&(prior.version!==MOMENTUM_VERSION||prior.day!==day||!validMomentumReservation(prior.reservation)||prior.reservation.session_date!==day))throw Error('Unsupported daily record');
    if(prior?.reservation)retained.set(day,prior.reservation);
   }catch{storage='DATA HOLD';storageReason='Daily signal storage is unavailable';admitted=retained.get(day)??null;result=replay(inputs,calendar,{now,sessionDate:day,reservation:admitted,entryAfter:Infinity});break;}
   const existing=prior?.reservation??null;
   result=replay(inputs,calendar,{now,sessionDate:day,reservation:existing,entryAfter:allowNew?now-60000:Infinity});
   let next=result._reservation??null;
   // Publish only a still-pending decision observed within one minute of its
   // confirmed close. Once the entry or its outcome is visible it is replay,
   // not a new alert. Existing pending reservations progress normally.
   if(!existing&&next&&(next.state!=='PENDING_ENTRY'||next.entry!==null||next.target_hit===true||now-T(next.decision_at)>60000||T(next.decision_at)>now||!validMomentumReservation(next))){
    result=replay(inputs,calendar,{now,sessionDate:day,reservation:null,entryAfter:Infinity});result.reason='Earlier event retained as research; waiting for a new confirmed setup.';next=null;
   }
   // The existing id is authoritative even if a later fetch discovers an earlier
   // event or a higher-confidence candidate. No visitor can allocate another id.
   if(existing&&next&&existing.id!==next.id){next=existing;result=replay(inputs,calendar,{now,sessionDate:day,reservation:existing,entryAfter:Infinity});}
   if(next){next={...next,first_observed_at:existing?.first_observed_at??iso(now),observation_kind:'ISSUED'};result.signal={...result.signal,...next};}
   if(!next||same(existing,next)){admitted=existing??next;break;}
   const record={schema_version:1,version:MOMENTUM_VERSION,day,updated_at:iso(now),reservation:next};
   try{
    const written=await bucket.put(key,JSON.stringify(record),{httpMetadata:{contentType:'application/json'},onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'}});
    if(written===null){if(attempt<2)continue;throw Error('Conflict');}if(!written)throw Error('No write result');
    admitted=next;retained.set(day,next);break;
   }catch{storage='DATA HOLD';storageReason='The one-signal daily limit could not be saved';admitted=existing;result=replay(inputs,calendar,{now,sessionDate:day,reservation:existing,entryAfter:Infinity});break;}
  }
  const measured=await evidence(bucket,day,storage==='CURRENT'?admitted:null,now,inputs);
  result??={signal:null,second_signal:null,holds:[],rejected:[],candidates:[]};
  let state=result.signal?.status??result.state??'WAIT',reason=result.signal?.reason??result.reason??'Waiting for a confirmed momentum event';
  if(!result.signal&&(result.holds??[]).some(x=>/relative volume|same-time volume|missing regular-session/i.test(x))){state='DATA HOLD';reason=(result.holds??[]).find(x=>/relative volume|same-time volume|missing regular-session/i.test(x));}
  if(!session||!active){state='CLOSED';reason='Regular session closed. No new signals.';}
  else if(day<MOMENTUM_FORWARD_FROM){state='WAIT';reason='Forward tracking begins October 26. Earlier replay events are research only.';}
  else if(!synced){state='DATA HOLD';reason='Waiting for matching fresh confirmed bars on all four tickers.';}
  else if(!result.signal&&!beforeCutoff){state='WAIT';reason='No new entries after 3 PM.';}
  if(storage!=='CURRENT'){state='DATA HOLD';reason=storageReason;}
  const live=active&&synced&&storage==='CURRENT'&&state!=='DATA HOLD';
  const signal=admitted?{...result.signal,...(result.signal?.id===admitted.id?{}:admitted),first_observed_at:admitted.first_observed_at,observation_kind:'ISSUED',live,read_only:!live}:null;
  const second=result.second_signal?{...result.second_signal,live:false,research_only:true,label:'Second signal (lower confidence)',note:'Watch only. The daily live signal limit remains one.'}:null;
  const stats=measured.stats?{...measured.stats,state:measured.state,reason:measured.reason}:{n:null,wins:null,issued_n:null,target_hit_rate:null,win_rate:null,interval:null,sample:'FORWARD',from:MOMENTUM_FORWARD_FROM,state:'DATA HOLD',reason:measured.reason};
  const updateTimes=[T(bundle.generated_at),...Object.values(bundle.symbols??{}).map(s=>T(s.health?.price_asof)),evidenceStamp(signal),T(stats.asof)].filter(Number.isFinite);
  return publicBundle(bundle,{version:MOMENTUM_VERSION,signal_only:true,session_date:day,generated_at:iso(updateTimes.length?Math.max(...updateTimes):now),state,reason,signal,second_signal:second,entries_today:admitted?1:0,max_signals:1,storage_state:storage,stats,holds:[...new Set(result.holds??[])].slice(0,12),candidate_count:result.candidates?.length??0,rejected_count:result.rejected?.length??0});
 };
}
