import {readExtendedTradingView} from './tradingview-feed.mjs';
import {dailyLevels,etParts} from './saty-live.mjs';
import {sessionMode} from '../site/session-mode.mjs';
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
export function createExtendedReader(calendar,{reader=readExtendedTradingView,clock=()=>Date.now()}={}){
 let cache=null,checked=-Infinity,inflight=null;
 return async function getExtended(regular){
  const now=clock(),p=sessionMode(now),supported=p.mode==='EXTENDED HOURS'&&!!calendar.sessions?.[p.day];
  if(!supported)return Object.fromEntries(['SPY','SPX','AAPL','GOOGL'].map(s=>[s,{state:'CLOSED',reason:s==='SPX'?'SPX has no extended session':'Outside supported extended session',stats_eligible:false}]));
  if(cache&&now-checked<60000)return cache;
  if(inflight)return inflight;
  inflight=(async()=>{const result={SPX:{state:'CLOSED',reason:'SPX has no extended session',stats_eligible:false}};
   await Promise.all(['SPY','AAPL','GOOGL'].map(async symbol=>{try{
    const x=extendedSnapshot(await reader(symbol),calendar,clock()),s=regular?.symbols?.[symbol];
    if(x.period==='AFTER-HOURS'&&s?.session?.date===p.day&&Date.parse(s.health?.price_asof)>=Date.parse(calendar.sessions[p.day].close)){
      x.gap_basis=s.market.last;x.gap=x.price-x.gap_basis;x.gap_percent=x.gap/x.gap_basis*100;
    }
    result[symbol]=x;
   }catch(e){result[symbol]={state:'DATA HOLD',label:'EXTENDED HOURS',reason:e.message,stats_eligible:false};}}));
   cache=result;checked=clock();return result;
  })();try{return await inflight;}finally{inflight=null;}
 };
}
