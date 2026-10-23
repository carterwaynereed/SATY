// Independent implementation of common indicators. Source attribution is in sources.json.
export const VERSION='0.1.0';
export const SYMBOLS=['SPY','SPX','AAPL','GOOGL'];
const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'});
export function eastern(time){const p=Object.fromEntries(dateFormat.formatToParts(new Date(time)).map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,minute:+p.hour*60+(+p.minute),weekday:p.weekday};}
const holidays=new Set('2026-01-01 2026-01-19 2026-02-16 2026-04-03 2026-05-25 2026-06-19 2026-07-03 2026-09-07 2026-11-26 2026-12-25 2027-01-01 2027-01-18 2027-02-15 2027-03-26 2027-05-31 2027-06-18 2027-07-05 2027-09-06 2027-11-25 2027-12-24'.split(' '));
const early=new Set(['2026-11-27','2026-12-24','2027-11-26']);
export function sessionAt(now){const e=eastern(now),year=+e.date.slice(0,4),close=early.has(e.date)?780:960;let name='Closed';if(year<2026||year>2027)return {...e,name:'Calendar needs update',active:false,close};if(!['Sat','Sun'].includes(e.weekday)&&!holidays.has(e.date)){if(e.minute>=240&&e.minute<570)name='Premarket';else if(e.minute>=570&&e.minute<660)name='Opening focus';else if(e.minute>=660&&e.minute<720)name='Late morning';else if(e.minute>=720&&e.minute<close)name=e.minute>=900?'End of day':'Midday pause';}return {...e,name,close,active:['Opening focus','Late morning','End of day'].includes(name)};}
export function normalizeBars(rows,symbol,now=Date.now()){
 const map=new Map();let rejected=0,partial=0;
 for(const x of rows??[]){const start=Date.parse(x.start),end=Date.parse(x.end);const prices=[x.o,x.h,x.l,x.c];if(x.ticker!==symbol||!Number.isFinite(start)||!Number.isFinite(end)||end-start!==60000||prices.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<=0)||x.h<Math.max(x.o,x.c,x.l)||x.l>Math.min(x.o,x.c)||typeof x.vol!=='number'||!Number.isFinite(x.vol)||x.vol<0||!['r','pr','po'].includes(x.market)){rejected++;continue;}if(end>+now){partial++;continue;}const prev=map.get(start);if(prev&&JSON.stringify(prev)!==JSON.stringify(x))rejected++;map.set(start,x);}
 return {bars:[...map.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)),rejected,partial};
}
export function ema(values,n){if(!values.length)return [];let value=values[0];return values.map((x,i)=>{if(i)value+=(2/(n+1))*(x-value);return value;});}
export function atr(rows,n=14){if(rows.length<n+1)return null;const trs=rows.slice(1).map((x,i)=>Math.max(x.h-x.l,Math.abs(x.h-rows[i].c),Math.abs(x.l-rows[i].c)));let a=trs.slice(0,n).reduce((s,v)=>s+v,0)/n;for(const t of trs.slice(n))a=(a*(n-1)+t)/n;return a;}
export function aggregate(rows,minutes){const span=minutes*60000,groups=new Map();for(const b of rows){const key=Math.floor(Date.parse(b.start)/span)*span;const g=groups.get(key)??[];g.push(b);groups.set(key,g);}return [...groups.values()].filter(g=>g.length===minutes&&Date.parse(g.at(-1).end)-Date.parse(g[0].start)===span).map(g=>({ticker:g[0].ticker,market:g[0].market,start:g[0].start,end:g.at(-1).end,o:g[0].o,h:Math.max(...g.map(x=>x.h)),l:Math.min(...g.map(x=>x.l)),c:g.at(-1).c,vol:g.reduce((s,x)=>s+x.vol,0)}));}
export const aggregate5=rows=>aggregate(rows,5);
function dailyRows(rows,date){return (rows??[]).filter(x=>x.date<date).map(x=>({date:x.date,o:Number(x.open),h:Number(x.high),l:Number(x.low),c:Number(x.close)})).filter(x=>[x.o,x.h,x.l,x.c].every(v=>Number.isFinite(v)&&v>0)&&x.h>=Math.max(x.o,x.c)&&x.l<=Math.min(x.o,x.c)).sort((a,b)=>a.date.localeCompare(b.date));}
export function atrLevels(daily,date){const rows=dailyRows(daily,date),a=atr(rows);if(!a)return [];const c=rows.at(-1).c;const out=[{label:'Prior close',price:c}];for(const f of [.236,.382,.618,1,1.236,1.618,2])for(const s of [-1,1])out.push({label:`ATR ${s>0?'+':'−'}${f}`,price:c+s*f*a});return out;}
function trend(values){const e8=ema(values,8).at(-1),e21=ema(values,21).at(-1),e34=ema(values,34).at(-1),p=values.at(-1);return p>e8&&e8>e21&&e21>e34?1:p<e8&&e8<e21&&e21<e34?-1:0;}
const round=(v,n=2)=>Number(v.toFixed(n));
export function analyze(input={},now=Date.now(),context={}){
 const symbol=input.symbol??'SPY',session=sessionAt(now),gates=[],notes=[],features=[];
 const profile=input.profile??(symbol==='SPX'?{entry:1,trend:3}:{entry:3,trend:10});
 const entryMinutes=[1,3].includes(profile.entry)?profile.entry:3,trendMinutes=[3,5,10].includes(profile.trend)?profile.trend:10;
 const base={version:VERSION,symbol,at:new Date(now).toISOString(),session,decision:'WAIT',scores:{call:0,put:0,wait:100},scoreMeaning:'Heuristic support allocation, not a probability of profit',gates,notes,features,levels:[],chart:[],plan:null,regime:'Unknown',price:null,asOf:null};
 if(input.error)gates.push(input.error);
 if(Array.isArray(context.activeSymbols)&&!context.activeSymbols.includes(symbol))gates.push(symbol==='SPX'?'SPX paused: licensed index access pending':'Paused: SPY-only focus');
 const observed=Date.parse(input.fetchedAt);
 const norm=normalizeBars(input.bars,symbol,Number.isFinite(observed)?Math.min(+now,observed):now);if(norm.rejected)gates.push(`${norm.rejected} malformed or conflicting candles`);
 const rawRegular=norm.bars.filter(x=>x.market==='r'),rawToday=rawRegular.filter(x=>eastern(x.start).date===session.date);
 const regular=entryMinutes===1?rawRegular:aggregate(rawRegular,entryMinutes),today=regular.filter(x=>eastern(x.start).date===session.date),last=today.at(-1);
 base.profile={entry:entryMinutes,trend:trendMinutes};
 if(!session.active)gates.push(session.name==='Calendar needs update'?'Exchange calendar needs updating':`Outside entry window: ${session.name}`);
 if(!last){gates.push('No completed regular-session candles for today');return base;}
 base.price=rawToday.at(-1)?.c??last.c;base.asOf=rawToday.at(-1)?.end??last.end;base.signalAsOf=last.end;base.ageSeconds=Math.max(0,Math.floor((+now-Date.parse(base.asOf))/1000));
 if(base.ageSeconds>90)gates.push(`Stale candles: ${base.ageSeconds}s old (limit 90s)`);
 if(input.delayed===true)gates.push('Provider marked this feed delayed');
 const five=aggregate(rawRegular,trendMinutes),values=regular.map(x=>x.c),higherValues=five.map(x=>x.c),a=atr(regular.slice(-100));
 const higher13=ema(higherValues,13),higher21=ema(higherValues,21),higher48=ema(higherValues,48),e13=[],e21=[],e48=[];
 let higherIndex=-1;for(const b of regular){while(higherIndex+1<five.length&&Date.parse(five[higherIndex+1].end)<=Date.parse(b.end))higherIndex++;e13.push(higher13[higherIndex]??null);e21.push(higher21[higherIndex]??null);e48.push(higher48[higherIndex]??null);}
 if(regular.length<150||five.length<60)gates.push(`Need 150 complete ${entryMinutes}m and 60 complete ${trendMinutes}m bars for warm-up`);
 const recent=rawToday.slice(-30);if(recent.some((b,i)=>i&&Date.parse(b.start)!==Date.parse(recent[i-1].end)))gates.push('Missing recent one-minute candles');
 if(eastern(today[0].start).minute!==570)gates.push('Missing session open: VWAP and opening range incomplete');
 if(rawToday.length<5)gates.push('Wait for the first five-minute opening range');
 const eventTime=Date.parse(context.eventsReviewedAt),eventDate=Number.isFinite(eventTime)?eastern(eventTime).date:'';
 if(eventDate!==session.date||+now-eventTime>4*3600000||eventTime>+now||!context.eventSource)gates.push('Economic calendar has not been verified within four hours');
 if(context.eventsValidFrom&&+now<Date.parse(context.eventsValidFrom)||context.eventsValidUntil&&+now>Date.parse(context.eventsValidUntil))gates.push('Outside verified economic-calendar coverage');
 for(const event of context.events??[]){if(event.impact==='high'&&Math.abs(Date.parse(event.at)-+now)<10*60000)gates.push(`News blackout: ${event.name}`);}
 if(context.halted===true)gates.push('Market halt or feed interruption');
 if((context.realizedR??0)<=-3)gates.push('Paper daily loss cap reached (−3R)');
 if((context.consecutiveLosses??0)>=3)gates.push('Three consecutive paper losses: review required');
 if(session.minute>=session.close-10)gates.push('Final ten minutes: manage exits, no new entries');
 let pv=0,vol=0;const vwByEnd=new Map();for(const b of rawToday){pv+=((b.h+b.l+b.c)/3)*b.vol;vol+=b.vol;vwByEnd.set(b.end,vol>0?pv/vol:null);}const chart=[];for(const [i,b] of regular.entries()){if(eastern(b.start).date!==session.date)continue;chart.push({...b,vwap:vwByEnd.get(b.end)??null,ema13:e13[i],ema21:e21[i],ema48:e48[i]});}
 base.chart=chart;base.vwap=vwByEnd.get(last.end)??null;base.atrEntry=a;base.ema13=e13.at(-1);base.ema21=e21.at(-1);
 if(symbol!=='SPX'&&vol===0)gates.push('Missing volume: VWAP unavailable');
 const t1=trend(values),t5=trend(five.map(x=>x.c));base.regime=t1&&t1===t5?(t1>0?'Uptrend':'Downtrend'):'Mixed / range';
 const pre=norm.bars.filter(x=>x.market==='pr'&&eastern(x.start).date===session.date),prior=regular.filter(x=>eastern(x.start).date<session.date),priorDate=prior.length?eastern(prior.at(-1).start).date:null,priorDay=prior.filter(x=>eastern(x.start).date===priorDate);
 const levels=atrLevels(input.daily,session.date);
 if(!levels.length)notes.push('Daily ATR grid unavailable: insufficient daily history');
 if(priorDay.length){levels.push({label:'Previous high',price:Math.max(...priorDay.map(x=>x.h))},{label:'Previous low',price:Math.min(...priorDay.map(x=>x.l))});}
 if(pre.length)levels.push({label:'Premarket high',price:Math.max(...pre.map(x=>x.h))},{label:'Premarket low',price:Math.min(...pre.map(x=>x.l))});
 const or=rawToday.filter(x=>eastern(x.start).minute<575);if(or.length===5)levels.push({label:'Opening range high',price:Math.max(...or.map(x=>x.h))},{label:'Opening range low',price:Math.min(...or.map(x=>x.l))});
 base.levels=levels.sort((a,b)=>a.price-b.price);
 const push=(label,direction,weight,detail)=>features.push({label,direction,weight,detail});
 push(`${entryMinutes}m ribbon`,t1,25,'8 / 21 / 34 EMA stack');push(`${trendMinutes}m ribbon`,t5,25,`Completed ${trendMinutes}-minute candles only`);
 push('13 / 48 conviction',Math.sign(e13.at(-1)-e48.at(-1)),10,'EMA relationship; not an independent probability');
 const vw=base.vwap;push('Session VWAP',vw?Math.sign(last.c-vw):0,15,vw?`Session average ${round(vw)}`:'Index has no traded volume');
 const daily=dailyRows(input.daily,session.date),da=atr(daily),dc=daily.at(-1)?.c;
 push('Daily ATR trigger',da?(last.c>dc+.236*da?1:last.c<dc-.236*da?-1:0):0,10,'Previous completed daily ATR × 0.236');
 const prev=today.at(-2),support=levels.filter(x=>x.price<last.c).at(-1),resistance=levels.find(x=>x.price>last.c);
 let setup=null,direction=0;
 if(prev&&a&&t1&&t1===t5){
  const s=t1,level=e13.at(-1),priorLevel=e13.at(-2),reclaim=vw&&s*(prev.c-vw)<=0&&s*(last.c-vw)>0;
  const touch=s>0?Math.min(prev.l,last.l)<=level+a*.12:Math.max(prev.h,last.h)>=level-a*.12;
  const confirm=s*(last.c-prev.c)>0&&s*(last.c-level)>0&&s*(last.c-last.o)>0;
  if(touch&&confirm&&Math.abs(last.c-level)<a*1.2){setup='Ribbon pullback bounce';direction=s;}
  if(reclaim&&confirm){setup=s>0?'VWAP reclaim':'VWAP rejection';direction=s;}
  for(const l of levels){const held=s>0?prev.c>l.price&&last.l<=l.price+a*.15&&last.c>l.price:prev.c<l.price&&last.h>=l.price-a*.15&&last.c<l.price;if(held&&confirm&&Math.abs(last.c-l.price)<a){setup=`Break and retest · ${l.label}`;direction=s;break;}}
  void priorLevel;
 }
 push('Confirmed trigger',direction,15,setup??'No completed-candle trigger');
 const positive=features.filter(x=>x.direction===1).reduce((s,x)=>s+x.weight,0),negative=features.filter(x=>x.direction===-1).reduce((s,x)=>s+x.weight,0);
 const disagreement=Math.min(positive,negative),c=Math.max(0,positive-disagreement),p=Math.max(0,negative-disagreement);base.evidenceScores={call:c,put:p,wait:100-c-p};
 if(!t1||t1!==t5)gates.push(`${entryMinutes}m and ${trendMinutes}m trends do not agree`);
 if(!setup)gates.push('No confirmed bounce, reclaim, or retest');
 if(a&&Math.abs(last.c-e21.at(-1))>a*2.5)gates.push('Price extended from the pivot: do not chase');
 if(direction&&a){const swing=today.slice(-5);const stop=direction>0?Math.min(...swing.map(x=>x.l))-.1*a:Math.max(...swing.map(x=>x.h))+.1*a;const risk=Math.abs(last.c-stop),ahead=levels.filter(x=>direction*(x.price-last.c)>0).sort((a,b)=>direction*(a.price-b.price));const target=ahead[0],rr=target?Math.abs(target.price-last.c)/risk:0;const slippage=symbol==='SPX'?.5:.02;
  base.plan={side:direction>0?'CALL':'PUT',setup,entry:round(last.c),stop:round(stop),target:target?round(target.price):null,targetLabel:target?.label??'No mapped target',rr:round(rr),risk:round(risk,4),slippage,unit:'Underlying price study; no options contract selected',expiresAt:new Date(Date.parse(last.end)+90000).toISOString()};
  if(+now>Date.parse(base.plan.expiresAt))gates.push('Closed-candle trigger expired; wait for a new confirmation');
  if(!target||rr<1.5)gates.push('Nearest mapped target offers less than 1.5R');
  if(risk<=slippage*2)gates.push('Stop too tight relative to simulated execution costs');
  if(Math.max(c,p)<75)gates.push('Directional evidence below 75 / 100');
 }
 notes.push('Phase Oscillator, options flow, spreads and option Greeks are not yet incorporated');
 if(!gates.length&&base.plan){base.decision=base.plan.side;base.scores=base.evidenceScores;}
 return base;
}
export function paperOutcome(trade,rows){
 // Entries are queued at signal time and filled only on a subsequent bar, never at a past close.
 const bars=(rows??[]).filter(b=>Date.parse(b.start)>=Date.parse(trade.signalEnd)).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 if(!bars.length)return {...trade,status:'pending'};
 const d=trade.side==='CALL'?1:-1,first=bars[0];
 if(Date.parse(first.start)!==Date.parse(trade.signalEnd))return {...trade,status:'cancelled',reason:'Missing next bar; no invented fill'};
 const fill=first.o+d*trade.slippage,risk=d*(fill-trade.stop);
 if(risk<=0||d*(trade.target-fill)<=0||d*(trade.target-fill)/risk<1.5)return {...trade,status:'cancelled',reason:'Gap removed the original reward/risk'};
 const result={...trade,status:'open',fill,filledAt:first.start,risk};
 for(let i=0;i<bars.length;i++){const b=bars[i];if(i&&Date.parse(b.start)!==Date.parse(bars[i-1].end))return {...result,status:'unresolved',reason:'Missing bars before exit; outcome requires review'};
  const hitStop=d>0?b.l<=trade.stop:b.h>=trade.stop,hitTarget=d>0?b.h>=trade.target:b.l<=trade.target;let exit,reason;
  if(hitStop){exit=d>0?Math.min(b.o,trade.stop)-trade.slippage:Math.max(b.o,trade.stop)+trade.slippage;reason=hitTarget?'Stop first: both touched in one candle':'Stop';}
  else if(hitTarget){exit=trade.target-d*trade.slippage;reason='Target';}
  else if(Date.parse(b.end)-Date.parse(first.start)>=15*60000||eastern(b.end).minute>=sessionAt(b.end).close-5){exit=b.c-d*trade.slippage;reason='Time exit';}
  if(exit!==undefined)return {...result,status:'closed',exit,exitedAt:b.end,reason,r:round(d*(exit-fill)/risk,3)};
 }
 return result;
}
export function journalStats(trades){const closed=trades.filter(t=>t.status==='closed'&&Number.isFinite(t.r)),wins=closed.filter(x=>x.r>0).length,n=closed.length;if(!n)return {n:0,winRate:null,expectancy:null,interval:null};const p=wins/n,z=1.96,den=1+z*z/n,center=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;return {n,winRate:round(p*100,1),expectancy:round(closed.reduce((s,x)=>s+x.r,0)/n,3),interval:[round((center-half)*100,1),round((center+half)*100,1)]};}
