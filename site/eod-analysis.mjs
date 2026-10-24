// Explicit unvalidated context rules. No weights, trade instructions or forecasts.
export function analyzeEOD(input,minutes,session,now=Date.now()){
  const open=Date.parse(session?.open),close=Date.parse(session?.close),step=minutes*60000;
  const bars=(input??[]).filter(b=>[b.open,b.high,b.low,b.close].every(Number.isFinite)&&Date.parse(b.time)>=open&&Date.parse(b.time)+step<=Math.min(now,close)).slice().sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  if(bars.length<30)return {state:'DATA_HOLD',reason:'Need at least 30 confirmed '+minutes+'m bars',n:bars.length};
  const last=bars.at(-1),asof=Date.parse(last.time)+step,inSession=now>=open&&now<close;
  if(bars.some((b,i)=>i&&Date.parse(b.time)-Date.parse(bars[i-1].time)!==step))return {state:'DATA_HOLD',reason:'Gap or duplicate in '+minutes+'m bars',n:bars.length};
  if(inSession&&now-asof>step+45000)return {state:'DATA_HOLD',reason:'Stale '+minutes+'m feed',n:bars.length};
  let atr=null,pivot=null,smooth=null,pc=null;const phase=[];
  for(const b of bars){const tr=pc==null?b.high-b.low:Math.max(b.high-b.low,Math.abs(b.high-pc),Math.abs(b.low-pc));pc=b.close;atr=atr==null?tr:atr+(tr-atr)/14;pivot=pivot==null?b.close:pivot+2/22*(b.close-pivot);const v=atr>0?(b.close-pivot)/(3*atr)*100:0;smooth=smooth==null?v:smooth+.5*(v-smooth);phase.push(smooth);}
  const pivots=[];
  for(let i=14;i<bars.length-2;i++){
    const b=bars[i];
    if([i-2,i-1,i+1,i+2].every(j=>b.high>bars[j].high))pivots.push({type:'SUPPLY',i,price:b.high,phase:phase[i],known_at:new Date(Date.parse(bars[i+2].time)+step).toISOString()});
    if([i-2,i-1,i+1,i+2].every(j=>b.low<bars[j].low))pivots.push({type:'DEMAND',i,price:b.low,phase:phase[i],known_at:new Date(Date.parse(bars[i+2].time)+step).toISOString()});
  }
  const divergence=[];
  for(const type of ['SUPPLY','DEMAND']){
    const pair=pivots.filter(p=>p.type===type).slice(-2);if(pair.length!==2)continue;
    const [a,b]=pair;
    if(b.i<bars.length-12)continue;
    if(type==='SUPPLY'&&b.price>a.price&&b.phase<a.phase||type==='DEMAND'&&b.price<a.price&&b.phase>a.phase)
      divergence.push({type:type==='SUPPLY'?'BEARISH':'BULLISH',price:b.price,pivot_at:bars[b.i].time,known_at:b.known_at,candidate_id:minutes===1?'EOD-01':'EOD-02'});
  }
  const recent=bars.slice(-8),range=Math.max(...recent.map(b=>b.high))-Math.min(...recent.map(b=>b.low));
  // Retains the original page's 8-bar-range / DAILY ATR compression definition.
  const daily=session?.daily_atr;
  const compression=Number.isFinite(daily)&&daily>0?{active:range/daily<0.18,range,range_daily_atr:range/daily,candidate_id:'EOD-03'}:null;
  const levels=pivots.filter(p=>p.i>=bars.length-60).slice(-8).map(p=>({...p,
    reversal:p.type==='DEMAND'?last.low<=p.price+.15*atr&&last.low>=p.price-.15*atr&&last.close>p.price:
      last.high>=p.price-.15*atr&&last.high<=p.price+.15*atr&&last.close<p.price}));
  return {state:inSession?'CURRENT':'REFERENCE',reason:inSession?'Confirmed bars; unvalidated context':'Closed-session reference only',
    n:bars.length,asof:new Date(asof).toISOString(),phase:phase.at(-1),phase_slope:phase.at(-1)-phase.at(-2),divergence,compression,levels,
    probability:null,evidence_weight:0};
}
export function closeWindow(session,now=Date.now()){
  const open=Date.parse(session?.open),close=Date.parse(session?.close);
  if(!Number.isFinite(open)||!Number.isFinite(close))return {state:'UNKNOWN',seconds:null};
  if(now>=close)return {state:'CLOSED',seconds:0};
  const window=close-600000;
  return {state:now<open?'PREMARKET':now<window?'COUNTDOWN':'LAST_10_MINUTES',
    seconds:Math.ceil(((now<window?window:close)-now)/1000),window_open:new Date(window).toISOString(),close:new Date(close).toISOString()};
}
