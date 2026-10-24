import {createMarketReader,marketEndpoints} from './assets/app.js';
import {sessionMode,shouldPoll} from './session-mode.mjs';
import {normalizeUW} from './uw-view.mjs';
import {TICKERS,priceText,currencyText,timeText,dayText,easternDay,momentumView,momentumCardHTML,watchView,watchHTML,statsView} from './momentum-view.mjs';

const $=id=>document.getElementById(id),readMarket=createMarketReader(),endpoints=marketEndpoints(location.hostname);
const DATA_BASE='https://raw.githubusercontent.com/carterwaynereed/SATY/dashboard-data/';
let bundle=null,uw=null,selected='SPY',failed=false,loading=true,inflight=false,lastPoll=0,lastUW=0,uwFailed=false;
const put=(id,text)=>{$(id).textContent=text;};
function currentSession(){return Object.values(bundle?.symbols??{}).find(s=>s.session?.date===easternDay(Date.now()))?.session??bundle?.symbols?.[selected]?.session;}
function render(){
  const now=Date.now(),v=momentumView(bundle,{now,failed,loading}),mode=sessionMode(now,currentSession());
  put('today-label',dayText(easternDay(now)).toUpperCase());
  const cardHTML=momentumCardHTML(v);if($('momentum-card').innerHTML!==cardHTML)$('momentum-card').innerHTML=cardHTML;$('momentum-card').dataset.side=v.direction??'';
  const focusedTicker=document.activeElement?.dataset?.ticker,stripHTML=watchHTML(watchView(bundle,{selected,now,failed}));if($('watch-strip').innerHTML!==stripHTML)$('watch-strip').innerHTML=stripHTML;
  for(const button of $('watch-strip').querySelectorAll('[data-ticker]'))button.onclick=()=>{selected=button.dataset.ticker;render();};
  if(focusedTicker&&TICKERS.includes(focusedTicker))$('watch-strip').querySelector(`[data-ticker="${focusedTicker}"]`)?.focus({preventScroll:true});
  put('second-candidate',v.secondText);
  const sessionText=loading&&!bundle?'Checking market data':failed?'Update unavailable · DATA HOLD':mode.mode==='CLOSED'?'Market closed · refresh paused':mode.mode==='EXTENDED HOURS'?'Extended hours · 60s refresh':v.fresh?'Confirmed bars · 15s refresh':'Waiting for confirmed bars';
  put('session-text',sessionText);$('session-status').className='session-status'+(failed?' hold':v.fresh?' current':'');
  const s=statsView(v.stats);put('forward-sample',s.held?'n unavailable':`n=${s.n}`);put('forward-headline',s.headline);put('target-rate',s.target);put('green-rate',s.green);put('profit-factor',s.pf);put('wilson-interval',s.interval);
  put('green-stat-label',`Closed green %${s.closedN!==null?' · n='+s.closedN:''}`);put('pf-stat-label',`Profit factor${s.closedN!==null?' · n='+s.closedN:''}`);
  put('stats-note',`${s.unresolved?`${s.unresolved} unresolved signal${s.unresolved===1?'':'s'} excluded and retained for review. `:''}Percentages stay hidden until n ≥ 20. Targets measure underlying price movement, not options returns.`);
  put('rule-version',v.version);put('tracker-inputs',v.holds.length?v.holds.join(' '):'Confirmed 3m bars. Same-time RVOL of 1.5 or higher skips the event; unavailable RVOL holds new signals.');
  renderUW(now);
}
function renderUW(now){
  const packet=bundle?.unusual_whales??bundle?.uw??uw,u=normalizeUW(packet,{symbol:selected,now});
  put('uw-symbol',selected);const state=uwFailed&&!bundle?.unusual_whales&&!bundle?.uw?'STALE':u.state;
  put('uw-state',state==='CURRENT'?'CURRENT':state==='PARTIAL'?'PARTIAL DATA':state==='STALE'?'REFERENCE':'DATA HOLD');$('uw-state').className='context-badge'+(state==='CURRENT'?' current':'');
  const values=u.values??{},fields=u.fields??{};
  const valid=x=>typeof x==='number'&&Number.isFinite(x);
  const reference=key=>fields[key]?.state==='STALE'?' · reference':'';
  const fieldNote=(key,fallback)=>`${fields[key]?.scope??fallback}${reference(key)}${fields[key]?.asof?' · '+timeText(fields[key].asof):''}`;
  const wallParts=[valid(values.call_wall)?`Call ${priceText(values.call_wall)}${reference('call_wall')}`:null,valid(values.put_wall)?`Put ${priceText(values.put_wall)}${reference('put_wall')}`:null].filter(Boolean);
  const display=(id,value,available)=>{put(id,value);$(id).classList.toggle('unavailable',!available);};
  display('gamma-wall',wallParts.join(' · ')||'Unavailable',wallParts.length>0);
  put('gamma-flip',valid(values.gamma_flip)?`Flip ${priceText(values.gamma_flip)}${reference('gamma_flip')}`:'Flip unavailable');
  display('market-tide',values.market_tide??'Unavailable',!!values.market_tide);
  display('net-premium',currencyText(values.net_premium),valid(values.net_premium));
  display('max-pain',valid(values.max_pain)?priceText(values.max_pain):'Unavailable',valid(values.max_pain));
  put('tide-scope',fieldNote('market_tide','Market-wide context'));put('premium-scope',fieldNote('net_premium','Selected ticker'));put('pain-scope',fieldNote('max_pain','Expiry scope unavailable'));
  for(const [id,keys] of [['gamma-wall',['call_wall','put_wall']],['gamma-flip',['gamma_flip']],['market-tide',['market_tide']],['net-premium',['net_premium']],['max-pain',['max_pain']]])$(id).title=keys.map(key=>`${key.replaceAll('_',' ')}: ${fields[key]?.state??'UNAVAILABLE'} · ${fields[key]?.asof?timeText(fields[key].asof):'time unavailable'} · ${fields[key]?.source??'source unavailable'}`).join('\n');
  const asof=u.asof?`As of ${timeText(u.asof)}. `:'';
  put('uw-foot',`${asof}${state==='CURRENT'?'Display only. Context does not change the momentum signal.':u.reason??'Awaiting verified feed values. Missing data stays unavailable.'}`);
}
async function readUW(){
  lastUW=Date.now();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetch(`${DATA_BASE}uw.json`,{credentials:'omit',cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('Unusual Whales context unavailable');const value=await response.json();if(!value||typeof value!=='object')throw Error('Invalid context');uw=value;uwFailed=false;}
  catch{uwFailed=true;}finally{clearTimeout(timer);}
}
async function refresh(){
  if(inflight)return;inflight=true;lastPoll=Date.now();$('refresh').disabled=true;
  try{
    const [market]=await Promise.allSettled([readMarket(endpoints.market,{sameOrigin:endpoints.sameOrigin}),Date.now()-lastUW>=60000?readUW():Promise.resolve()]);
    if(market.status==='fulfilled'){bundle=market.value;failed=false;if(bundle.momentum?.signal?.symbol&&TICKERS.includes(bundle.momentum.signal.symbol)&&loading)selected=bundle.momentum.signal.symbol;}else failed=true;
  }finally{loading=false;inflight=false;$('refresh').disabled=false;render();}
}
$('refresh').onclick=refresh;
// Preserve old owner-journal entry links without reading private data on home.
if(new URLSearchParams(location.search).get('journal')==='1')location.replace(new URL('details.html?journal=1',location.href));
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&shouldPoll(lastPoll,Date.now(),currentSession()))refresh();});
setInterval(()=>{render();if(!document.hidden&&shouldPoll(lastPoll,Date.now(),currentSession()))refresh();},5000);
render();refresh();
