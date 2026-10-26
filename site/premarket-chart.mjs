const num=n=>typeof n==='number'&&Number.isFinite(n);
export function etClock(time){const k=typeof time==='number'?time:Date.parse(time);if(!num(k))return null;const [day,clock]=new Date(k).toLocaleString('sv-SE',{timeZone:'America/New_York',hourCycle:'h23'}).split(' ');const [h,m]=clock.split(':');return {day,hm:h+':'+m,minute:+h*60+ +m};}
function ohlc(b){const o=b?.o??b?.open,h=b?.h??b?.high,l=b?.l??b?.low,c=b?.c??b?.close;return [o,h,l,c].every(num)&&Math.min(o,h,l,c)>0&&l<=Math.min(o,c)&&h>=Math.max(o,c)?{o,h,l,c}:null;}
function pmOk(b,day,now){const s=Date.parse(b?.time??b?.start),c=etClock(s);return ohlc(b)&&c?.day===day&&s<=now+9e4&&c.minute>=240&&c.minute<570&&!((c.minute-240)%3);}
const gapText=(g,a)=>num(g)?(g>0?'+':'')+g.toFixed(2)+(num(a)&&a>0?` · ${(g>0?'+':'')+(g/a).toFixed(2)} ATR`:''):null;
export function premarketChartModel(rthBars,ext,ctx={}){
 const raw=Array.isArray(rthBars)?rthBars:[],src=ext?.premarket,pm=src?.date===ctx.calendarDay?src:{bars:[],reason:src?.reason||ext?.reason||'',state:src?.state||'CLOSED'},now=ctx.now??Date.now();
 const pre=[],seen=new Set();
 for(const b of pm.bars??[]){const s=Date.parse(b?.time??b?.start),p=ohlc(b);if(!pmOk(b,ctx.calendarDay,now)||seen.has(s))continue;seen.add(s);pre.push({...p,start:b.time??b.start,session:'premarket'});}
 pre.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 const rth=raw.map(b=>{const p=ohlc(b);return p&&{...p,start:b.start??b.time,session:'rth',ema13:b.ema13??b.ema8??null,ema21:b.ema21??null,vwap:b.vwap??null};}).filter(Boolean);
 const lead=ctx.mode==='EXTENDED HOURS'&&ctx.minute<570||ctx.mode==='REGULAR'&&ctx.rthDate&&ctx.calendarDay&&ctx.rthDate!==ctx.calendarDay,show=!!pre.length&&(lead||ctx.rthDate===ctx.calendarDay);
 const bars=show&&lead?pre:show?pre.concat(rth):rth,atr=num(ctx.atr)?ctx.atr:pm.atr14,opened=!lead&&ctx.rthDate===ctx.calendarDay&&raw.find(b=>etClock(b.time??b.start)?.day===ctx.rthDate),px=opened?.open??opened?.o,real=!lead&&num(px)&&num(ctx.prevClose);
 const last=raw.at(-1),lastDay=etClock(last?.time??last?.start)?.day,basis=lastDay&&ctx.calendarDay&&lastDay<ctx.calendarDay?last.close??last.c:ctx.prevClose;
 const gap=real?px-ctx.prevClose:num(pm.price)&&num(basis)?pm.price-basis:pm.gap,refs=[],on=ctx.mode!=='CLOSED';
 if(on&&(show||num(pm.high))){for(const [k,v] of [['PRE-MARKET high',pm.high],['PRE-MARKET low',pm.low]])if(num(v))refs.push([k,v.toFixed(2)]);if(pm.after_hours_observed)for(const [k,v] of [['OVERNIGHT high',pm.overnight_high],['OVERNIGHT low',pm.overnight_low]])if(num(v))refs.push([k,v.toFixed(2)]);}
 if(on&&lead&&num(pm.price)&&num(basis)&&basis!==ctx.prevClose)refs.push(['Last RTH close',basis.toFixed(2)]);
 const text=on&&gapText(gap,atr);if(text)refs.push([real?'GAP vs prior close':'GAP preview',text]);if(!refs.length&&on&&/SPX/.test(pm.reason||''))refs.push(['PRE-MARKET','Unavailable']);
 const hold=!show&&(lead||pm.state==='DATA HOLD'&&on),tag=show&&lead?pm.state==='DATA HOLD'?'PRE-MARKET DATA HOLD':'PRE-MARKET':show?'PRE-MARKET + RTH':hold?/SPX/.test(pm.reason||'')?'PRE-MARKET unavailable':'PRE-MARKET DATA HOLD':'RTH';
 const note=show?(pm.coverage==='partial'?'Partial · not in RTH stats':'Not in RTH stats'):hold?'DATA HOLD · no invented bars':'Completed candles only';
 return {bars,openIndex:show&&!lead?pre.length:null,profile:'SATY · 3m '+(tag==='RTH'?'RTH':tag),sessionTag:tag,hold,note,references:refs,quote:lead&&num(pm.price)?pm.price:null,quoteAsOf:lead?pm.price_asof??null:null};
}
export function candleStyle(bar,palette){const up=(bar.c??bar.close)>=(bar.o??bar.open);return bar.session==='premarket'?{color:up?palette.amber:palette.preDown,alpha:.78}:{color:up?palette.bull:palette.bear,alpha:1};}
export function paintPremarketCue(ctx,{boundary,top,bottom,color,label='09:30'}){if(!num(boundary))return false;ctx.save();ctx.strokeStyle=ctx.fillStyle=color;ctx.globalAlpha=.95;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(boundary,top);ctx.lineTo(boundary,bottom);ctx.stroke();ctx.fillText(label,boundary+4,top+11);ctx.restore();return true;}
