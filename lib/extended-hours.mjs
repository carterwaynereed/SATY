import {readExtendedTradingView} from './tradingview-feed.mjs';
import {dailyLevels,etParts} from './saty-live.mjs';
import {sessionMode} from '../site/session-mode.mjs';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const minuteOf=hm=>{const [h,m]=hm.split(':');return +h*60 + +m;};
export function aggregatePremarketBars(bars,day,now=Date.now()){
 const by=new Map();
 for(const b of bars??[]){const start=Date.parse(b?.time),p=Number.isFinite(start)?etParts(start):null,minute=p?minuteOf(p.hm):NaN;if(!minuteOK(b)||!p||p.day!==day||start+60000>now||minute<240||minute>=570)continue;by.set(minute,b);}
 const out=[];for(let minute=240;minute+3<=570;minute+=3){const rows=[0,1,2].map(i=>by.get(minute+i));if(rows.every(Boolean))out.push({time:rows[0].time,open:rows[0].open,high:Math.max(...rows.map(r=>r.high)),low:Math.min(...rows.map(r=>r.low)),close:rows[2].close,session:'premarket'});}
 const ones=[...by.values()].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
 return {bars:out,high:ones.length?Math.max(...ones.map(b=>b.high)):null,low:ones.length?Math.min(...ones.map(b=>b.low)):null,last:ones.at(-1)??null,one_count:ones.length,complete:out.length===110};
}
function minuteOK(b){return b&&[b.open,b.high,b.low,b.close].every(finite)&&Math.min(b.open,b.high,b.low,b.close)>0&&b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close);}
export function extendedSnapshot(feed,calendar,now=Date.now()){
 const policy=sessionMode(now),row=calendar.sessions?.[policy.day];
 if(!row||policy.mode!=='EXTENDED HOURS')return {state:'CLOSED',reason:'Outside supported extended session'};
 const pre=policy.minute<570,previous=Object.keys(calendar.sessions).filter(d=>d<policy.day).sort().at(-1);
 const bars=feed.bars.filter(b=>{const p=etParts(b.time),end=Date.parse(b.time)+60000;return end<=now&&(pre?(p.day===policy.day&&p.hm>='04:00'&&p.hm<'09:30')||(p.day===previous&&p.hm>='16:00'&&p.hm<'20:00'):p.day===policy.day&&p.hm>='16:00'&&p.hm<'20:00');});
 const current=bars.filter(b=>etParts(b.time).day===policy.day&&(pre?etParts(b.time).hm<'09:30':etParts(b.time).hm>='16:00'));
 const last=current.at(-1),asof=Date.parse(last?.time)+60000;
 if(!last||now-asof>125000||now<asof)throw Error('Confirmed extended 1m bars missing or stale');
 const prior=feed.daily.filter(b=>etParts(b.time).day<policy.day).at(-1);
 if(!prior||etParts(prior.time).day!==previous)throw Error('Previous regular close unavailable');
 const ref=dailyLevels(feed.daily,policy.day);
 // A forming daily candle must never be treated as a final close. After-hours
 // gap basis comes from the independently confirmed RTH cache, attached below.
 return {state:'CURRENT',label:'EXTENDED HOURS',period:pre?'PRE-MARKET':'AFTER-HOURS',date:policy.day,price:last.close,price_asof:new Date(asof).toISOString(),bars:current,source:feed.source,
  high:Math.max(...bars.map(b=>b.high)),low:Math.min(...bars.map(b=>b.low)),range_note:pre?'Observed prior after-hours + current pre-market; coverage may be partial':'Observed after-hours range; coverage may be partial',
  prev_close:ref.pc,atr14:ref.atr,levels:Object.entries(ref.levels).map(([label,price])=>({label,price})),gap_basis:pre?ref.pc:null,gap:pre?last.close-ref.pc:null,gap_percent:pre?(last.close/ref.pc-1)*100:null,next_open:Object.entries(calendar.sessions).filter(([d])=>pre?d>=policy.day:d>policy.day).sort(([a],[b])=>a.localeCompare(b))[0]?.[1].open??null,
  stats_eligible:false,reason:'Confirmed extended bars · reference context only · no regular-session signals'};
}
// Chart context only. Confirmed 04:00–09:30 bars stay off the RTH replay feed.
export function premarketChartContext(feed,calendar,now=Date.now()){
 const policy=sessionMode(now),day=policy.day,session=calendar.sessions?.[day];
 const base={label:'PRE-MARKET',date:day,session_basis:'PREMARKET',stats_eligible:false,bars:[]};
 if(!session)return {...base,state:'CLOSED',reason:'Outside supported extended session',date:null};
 const agg=aggregatePremarketBars(feed?.bars??[],day,now);
 const previous=Object.keys(calendar.sessions).filter(d=>d<day).sort().at(-1);
 const ah=(feed?.bars??[]).filter(b=>{const end=Date.parse(b.time)+60000,p=etParts(b.time);return minuteOK(b)&&end<=now&&p.day===previous&&p.hm>='16:00'&&p.hm<'20:00';});
 let ref=null;try{ref=dailyLevels(feed.daily,day);}catch{ref=null;}
 const price=agg.last?.close??null,gap=price!=null&&ref?price-ref.pc:null;
 const highs=[...ah.map(b=>b.high),agg.high].filter(finite),lows=[...ah.map(b=>b.low),agg.low].filter(finite);
 return {...base,state:agg.one_count?'CURRENT':'DATA HOLD',price,price_asof:agg.last?new Date(Date.parse(agg.last.time)+60000).toISOString():null,
  high:agg.high,low:agg.low,overnight_high:highs.length?Math.max(...highs):null,overnight_low:lows.length?Math.min(...lows):null,after_hours_observed:ah.length>0,
  range_note:ah.length&&agg.one_count?'Observed prior after-hours + current pre-market; coverage may be partial':agg.one_count?'Pre-market prints only; prior after-hours not in this read':'No confirmed pre-market bars',
  gap,gap_percent:gap!=null&&ref?.pc?(price/ref.pc-1)*100:null,gap_atr:gap!=null&&ref?.atr>0?gap/ref.atr:null,gap_basis:ref?.pc??null,atr14:ref?.atr??null,
  bars:agg.bars,coverage:agg.complete?'complete':'partial',bar_count:agg.bars.length,open:session.open,
  reason:agg.one_count?(agg.complete?'Confirmed pre-market 3m buckets · chart context only · excluded from RTH stats':'Confirmed pre-market bars · 3m coverage partial · excluded from RTH stats'):'No confirmed pre-market bars'};
}
export function createExtendedReader(calendar,{reader=readExtendedTradingView,clock=()=>Date.now()}={}){
 let cache=null,checked=-Infinity,inflight=null,memory={day:null,by:{}},backfill=null,backfillAt=-Infinity;
 const names=['SPY','SPX','AAPL','GOOGL'];
 const preClosed=(symbol,reason)=>({state:'CLOSED',label:'PRE-MARKET',reason:symbol==='SPX'?'SPX has no extended session':reason,bars:[],stats_eligible:false,session_basis:'PREMARKET'});
 const closed=(symbol,reason)=>({state:'CLOSED',reason:symbol==='SPX'?'SPX has no extended session':reason,stats_eligible:false,premarket:preClosed(symbol,reason)});
 const recall=(day,symbol)=>memory.day===day?memory.by[symbol]??null:null;
 function remember(day,symbol,ctx){if(memory.day!==day)memory={day,by:{}};if(ctx)memory.by[symbol]=ctx;}
 function held(symbol,reason){return {state:'DATA HOLD',label:'PRE-MARKET',date:sessionMode(clock()).day,reason,bars:[],stats_eligible:false,session_basis:'PREMARKET'};}
 async function backfillMissing(day,symbols){
  if(backfill)return backfill;
  backfill=(async()=>{backfillAt=clock();await Promise.all(symbols.map(async symbol=>{const prev=recall(day,symbol);try{const ctx=premarketChartContext(await reader(symbol),calendar,clock());if(!prev?.bars?.length||(ctx.bars?.length??0)>=prev.bars.length)remember(day,symbol,ctx);}catch(e){if(!prev)remember(day,symbol,held(symbol,e.message));}}));})();
  try{return await backfill;}finally{backfill=null;}
 }
 return async function getExtended(regular){
  const now=clock(),p=sessionMode(now),session=calendar.sessions?.[p.day];
  if(!session||p.mode==='CLOSED')return Object.fromEntries(names.map(s=>[s,closed(s,'Outside supported extended session')]));
  if(p.mode==='REGULAR'){
   const openTail=p.minute<573,pending=['SPY','AAPL','GOOGL'].filter(s=>recall(p.day,s)?.coverage!=='complete'),unseen=pending.filter(s=>!recall(p.day,s));
   if((unseen.length||openTail&&pending.length)&&now-backfillAt>=600000)await backfillMissing(p.day,unseen.length?unseen:pending);
   return Object.fromEntries(names.map(s=>s==='SPX'?[s,closed(s,'SPX has no extended session')]:[s,{state:'CLOSED',reason:'Regular session; pre-market is chart context only',stats_eligible:false,premarket:recall(p.day,s)??held(s,'Confirmed pre-market bars unavailable')}]));
  }
  if(cache&&now-checked<60000)return cache;
  if(inflight)return inflight;
  inflight=(async()=>{const result={SPX:closed('SPX','SPX has no extended session')};
   await Promise.all(['SPY','AAPL','GOOGL'].map(async symbol=>{try{
    const feed=await reader(symbol);let live=null,err=null;try{live=extendedSnapshot(feed,calendar,clock());}catch(e){err=e;}
    let ctx=premarketChartContext(feed,calendar,clock()),prev=recall(p.day,symbol);
    if(prev?.bars?.length&&(ctx.bars?.length??0)<prev.bars.length)ctx=prev;else remember(p.day,symbol,ctx);
    if(live?.period==='AFTER-HOURS'){const s=regular?.symbols?.[symbol];if(s?.session?.date===p.day&&Date.parse(s.health?.price_asof)>=Date.parse(session.close)){live.gap_basis=s.market.last;live.gap=live.price-live.gap_basis;live.gap_percent=live.gap/live.gap_basis*100;}}
    result[symbol]=live?{...live,premarket:ctx}:{state:'DATA HOLD',label:'EXTENDED HOURS',reason:err?.message??'Confirmed extended bars unavailable',stats_eligible:false,premarket:ctx.bars.length?ctx:{...ctx,state:'DATA HOLD',reason:err?.message??ctx.reason}};
   }catch(e){const prev=recall(p.day,symbol),ctx=prev?.bars?.length?prev:held(symbol,e.message);if(!prev?.bars?.length)remember(p.day,symbol,ctx);result[symbol]={state:'DATA HOLD',label:'EXTENDED HOURS',reason:e.message,stats_eligible:false,premarket:ctx};}}));
   cache=result;checked=clock();return result;
  })();try{return await inflight;}finally{inflight=null;}
 };
}
