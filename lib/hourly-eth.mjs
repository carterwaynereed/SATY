// Hourly extended-session context. Confirmed 04:00–20:00 ET bars only.
// Never invents a missing hour and never feeds RTH stats or live entries.
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const etFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function clock(ms){const p=Object.fromEntries(etFormat.formatToParts(new Date(ms)).map(x=>[x.type,x.value]));return Number(p.hour)*60+Number(p.minute);}
function ok(b){return b&&[b.open,b.high,b.low,b.close].every(finite)&&Math.min(b.open,b.high,b.low,b.close)>0&&b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close);}
export function confirmedHourly(bars,now=Date.now()){
 const by=new Map();
 for(const b of bars??[]){const t=Date.parse(b?.time);if(!ok(b)||!Number.isFinite(t)||t+3600000>now)continue;const m=clock(t);if(m<240||m>=1200)continue;by.set(t,b);}
 return [...by.values()].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
}
function shell(partial){return {label:'hourly TTM',session_basis:'ETH',stats_eligible:false,evidence_weights:null,signals:null,state:'DATA HOLD',reason:null,price:null,price_basis:null,price_asof:null,ema10:null,ema21:null,vs10:null,vs21:null,dist10:null,dist21:null,momentum:null,squeeze_bars:0,bar_time:null,bar_count:0,...partial};}
function ema(values,n){if(values.length<n)return null;let v=values.slice(0,n).reduce((a,b)=>a+b,0)/n;const k=2/(n+1);for(let i=n;i<values.length;i++)v=values[i]*k+v*(1-k);return v;}
function study(bars){
 const on=[],delta=[];
 for(let i=0;i<bars.length;i++){
  if(i<19){on.push(false);continue;}
  let sum=0,hh=-Infinity,ll=Infinity,tr=0;
  const closes=[];
  for(let j=i-19;j<=i;j++){const b=bars[j];closes.push(b.close);sum+=b.close;hh=Math.max(hh,b.high);ll=Math.min(ll,b.low);const pc=j?bars[j-1].close:null;tr+=pc==null?b.high-b.low:Math.max(b.high-b.low,Math.abs(b.high-pc),Math.abs(b.low-pc));}
  const mean=sum/20,sd=Math.sqrt(closes.reduce((a,v)=>a+(v-mean)**2,0)/20),atr=tr/20;
  on.push(atr>0&&2*sd<1.5*atr);delta.push(bars[i].close-(((hh+ll)/2)+mean)/2);
 }
 return {on,delta};
}
function linreg(values){
 const n=values.length;let x=0,y=0,xy=0,x2=0;
 for(let i=0;i<n;i++){x+=i;y+=values[i];xy+=i*values[i];x2+=i*i;}
 const d=n*x2-x*x;if(!d)return 0;const slope=(n*xy-x*y)/d;return (y-slope*x)/n+slope*(n-1);
}
function streak(on,index){let n=0;for(let i=index;i>=0&&on[i];i--)n++;return n;}
export function hourlyEthContext(bars,options={}){
 const symbol=options.symbol??null,now=options.now??Date.now();
 if(symbol==='SPX')return shell({state:'CLOSED',reason:'SPX has no extended session'});
 const confirmed=confirmedHourly(bars,now);
 if(!confirmed.length)return shell({reason:options.reason||'No confirmed hourly ETH bars'});
 if(!confirmed.some(b=>{const m=clock(Date.parse(b.time));return m<570||m>=960;}))return shell({reason:'Hourly feed has no extended-hours bars',bar_count:confirmed.length});
 if(confirmed.length<40)return shell({reason:`Hourly ETH history is ${confirmed.length} confirmed bars`,bar_count:confirmed.length});
 const closes=confirmed.map(b=>b.close),ema10=ema(closes,10),ema21=ema(closes,21),{on,delta}=study(confirmed),last=confirmed.length-1;
 let state,squeeze=0;
 if(on[last]){state='ON';squeeze=streak(on,last);}
 else if(on[last-1]){state='FIRING';squeeze=streak(on,last-1);}
 else state=on.slice(Math.max(0,last-6),last).some(Boolean)?'RELEASE':'OFF';
 const mom=delta.length>=20?linreg(delta.slice(-20)):null,price=finite(options.price)?options.price:confirmed[last].close;
 const rel=level=>price>level?'above':price<level?'below':'at',barTime=confirmed[last].time;
 return shell({state,reason:'Hourly ETH context only · not a live entry',price,price_basis:options.priceBasis||'hourly close',price_asof:options.priceAsOf||new Date(Date.parse(barTime)+3600000).toISOString(),ema10,ema21,vs10:rel(ema10),vs21:rel(ema21),dist10:price-ema10,dist21:price-ema21,momentum:mom==null||Math.abs(mom)<1e-8?null:mom>0?'up':'down',squeeze_bars:squeeze,bar_time:barTime,bar_count:confirmed.length});
}
