import {marketEndpoints,createMarketReader,number,snapshotHealth} from './assets/app.js';
import {analyzeEOD,closeWindow} from './eod-analysis.mjs';
import {prepareSync} from './public-sync.mjs';
const $=id=>document.getElementById(id),fmt=number;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DATA='https://raw.githubusercontent.com/carterwaynereed/SATY/dashboard-data/';
const ep=marketEndpoints(location.hostname),readMarket=createMarketReader();
let bundle=null,shared=null,fetchFailed=false,busy=false,metadataAt=0;
async function get(url){const r=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(new URL(url,location.href).pathname+' HTTP '+r.status);return r.json();}
const localKey=id=>'saty-eod-'+$('symbol').value+'-'+id;
function local(id){return localStorage.getItem(localKey(id))??localStorage.getItem('saty-eod-'+id)??'';}
function loadFields(){for(const id of ['leaderboard','maxpain','gex'])$(id).value=local(id);}
function detector(id,result){
  $(id).className=result.state==='DATA_HOLD'?'connection warning':'';
  if(result.state==='DATA_HOLD'){$(id).textContent='DATA HOLD · '+result.reason;return;}
  const c=result.compression;
  $(id).innerHTML='<p><b>'+esc(result.state)+'</b> · '+esc(result.reason)+' · bars n='+result.n+'</p><p><b>Divergence:</b> '+(result.divergence.map(x=>esc(x.type)+' near '+fmt(x.price)+'; confirmed '+esc(x.known_at)).join(' · ')||'not detected')+'</p><p><b>Compression:</b> '+(c?(c.active?'POSSIBLE':'not detected')+' · 8-bar range '+fmt(c.range)+' / daily ATR '+fmt(c.range_daily_atr,3):'unavailable')+'</p><p class="fine">2-left/2-right price pivots versus EMA21 / ATR14 phase proxy; confirmation is dated after the second right bar. Compression: 8-bar range &lt; 0.18 daily ATR. UNVALIDATED, no probability.</p>';
}
function render(){
  const s=bundle?.symbols?.[$('symbol').value];if(!s){$('status').textContent='DATA HOLD · Instrument unavailable.';return;}
  const h=snapshotHealth(s,Date.now(),fetchFailed);
  $('status').className='connection '+(h.tone==='hold'?'warning':'');
  $('status').textContent=h.state+' · '+h.reason+' · '+(s.health?.source?.feed_name||s.health?.source?.symbol||'source unavailable')+' · last 3m '+(s.health?.price_asof||'unknown');
  const m=s.market||{};$('spot').textContent=fmt(m.last);
  $('atr-context').textContent='Change '+fmt(m.change)+' ('+fmt(m.change_atr,3)+' ATR) · range '+fmt(m.day_low)+'–'+fmt(m.day_high);
  $('atr-levels').innerHTML=(s.levels||[]).filter(x=>Math.abs(x.multiple)<=1).map(x=>'<span class="tag">'+esc(x.label)+' · '+fmt(x.price)+'</span>').join('');
  const session={...s.session,daily_atr:m.atr14};
  let one=analyzeEOD(s.one_minute_bars,1,session),three=analyzeEOD(s.bars,3,session);
  if(!s.one_minute_health||['UNAVAILABLE','GAP','STALE'].includes(s.one_minute_health.state))one={state:'DATA_HOLD',reason:s.one_minute_health?.reason||'Confirmed same-feed 1m history missing'};
  if(fetchFailed||h.tone==='hold'){one={state:'DATA_HOLD',reason:'Market retrieval or freshness check failed'};three=one;}
  detector('one-minute',one);detector('three-minute',three);
  const levels=three.levels??[];$('sr').innerHTML=levels.map(x=>'<p><b>'+esc(x.type)+'</b> '+fmt(x.price)+(x.reversal?' · touch and rejection CONTEXT':'')+' · known '+esc(x.known_at)+'</p>').join('')||'No usable confirmed swing levels.';
  const v=shared?.by_symbol?.[$('symbol').value];
  $('synced-inputs').textContent=v?'Shared MANUAL input '+v.asof+'; received '+v.received_at+'; contracts n='+v.leaderboard.length+'; GEX nodes n='+(v.gex?.nodes?.length??0)+'. Manual observations do not modify live weights.':'MANUAL / PLACEHOLDER · no public inputs synced for this ticker.';
  clock();
}
const rateText=x=>!x||!x.n?'unavailable · n=0':`${x.hits}/${x.n} = ${fmt(100*x.rate,0)}%; Wilson 95% ${x.wilson_95.map(v=>fmt(100*v,0)+'%').join('–')} · n=${x.n}`;
async function metadata(){
  const results=await Promise.allSettled(['eod-review.json','health-alarms.json','manual-inputs.json','shadow-evidence.json'].map(n=>get(DATA+n)));
  const [r,a,m,sh]=results.map(x=>x.status==='fulfilled'?x.value:null);if(m)shared=m;
  const last=r?.sessions?.at(-1);
  $('health-review').innerHTML='<p>Latest review: '+esc(last?.session_date||'not available')+' · observed signals n='+esc(last?.signal_count??'—')+' · actual observed WAIT n='+esc(last?.wait_count??'—')+' · replay-late n='+esc(last?.replay_late_count??'—')+'</p><p>'+esc(last?.lesson||'No completed ledger review yet.')+'</p><p>Signal excursion fraction: '+esc(rateText(last?.signal_evidence))+'</p><p>WAIT large-move context: '+esc(rateText(last?.wait_missed_move_evidence))+'</p><p>Alarms n='+esc(a?.alarms?.length??'—')+'. Inspection requests are not proof of a broken engine.</p>';
  $('shadow-review').innerHTML=sh?.candidates?.length?sh.candidates.map(c=>'<p><b>'+esc(c.candidate_id)+'</b> · SHADOW ONLY · sessions n='+c.sessions+' · episodes n='+c.episodes_n+'</p><p>Baseline: '+esc(rateText(c.baseline))+'<br>Challenger: '+esc(rateText(c.challenger))+'</p><p>'+esc(c.promotion.reason)+'</p>').join(''):'No executable shadow sample yet · n=0. Registration never implies performance.';
  metadataAt=Date.now();
}
async function refresh(){if(busy)return;busy=true;try{
  // Prefer the same live endpoint. When old Site code lacks 1m, the new shared
  // bundle may supply it, but retains its own timestamps and stale gates.
  let live=null,reference=null;try{live=await readMarket(ep.market,{sameOrigin:ep.sameOrigin});}catch{}
  if(!live||!live.symbols?.[$('symbol').value]?.one_minute_health){try{reference=await get(DATA+'market.json');}catch{}}
  const newer=reference&&(!live||Date.parse(reference.generated_at)>Date.parse(live.generated_at));
  bundle=newer?reference:live??reference;
  // An older same-source 1m field is usable only as dated reference, never fresh.
  if(bundle&&reference&&bundle!==reference&&!bundle.symbols?.[$('symbol').value]?.one_minute_health){
    bundle=structuredClone(bundle);for(const [symbol,s] of Object.entries(bundle.symbols)){
      const other=reference.symbols?.[symbol];if(other?.health?.source?.feed_fingerprint===s.health?.source?.feed_fingerprint){s.one_minute_bars=other.one_minute_bars;s.one_minute_health=other.one_minute_health;}
    }
  }
  if(!bundle)throw Error('Neither live nor shared market bundle is available');
  fetchFailed=false;if(Date.now()-metadataAt>60000)await metadata();render();
}catch(e){fetchFailed=true;render();$('status').textContent='DATA HOLD · '+e.message;}finally{busy=false;}}
function clock(){const now=Date.now();$('clock').textContent=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now)+' ET';const s=bundle?.symbols?.[$('symbol').value]?.session,w=closeWindow(s,now);$('countdown').textContent=w.state==='COUNTDOWN'||w.state==='PREMARKET'?Math.floor(w.seconds/60)+'m '+w.seconds%60+'s to window':w.state==='LAST_10_MINUTES'?'LAST 10 MINUTES · '+w.seconds+'s left':w.state==='CLOSED'?'Session closed':'Calendar unavailable';$('session-note').textContent=w.window_open?'Window begins '+new Date(w.window_open).toLocaleTimeString('en-US',{timeZone:'America/New_York'})+' ET; exchange-calendar close '+new Date(w.close).toLocaleTimeString('en-US',{timeZone:'America/New_York'})+' ET.':'No clock-only weekend or holiday signal is inferred.';}
const candidates=[['EOD-01','1m confirmed pivot / phase divergence'],['EOD-02','3m confirmed pivot / phase divergence'],['EOD-03','1m/3m range compression and swing reversal context'],['EOD-04','Manual 0DTE leaderboard shakeout versus GEX'],['EOD-05','Manual final-ten-minute max pain versus negative gamma']];
$('candidates').innerHTML=candidates.map(([id,title])=>'<div class="panel"><span class="tag">'+id+' · UNVALIDATED</span><p>'+esc(title)+'</p><p class="fine">Validated sample n=0 · no probability · no weight contribution</p></div>').join('');
loadFields();
$('save-leaderboard').onclick=()=>{localStorage.setItem(localKey('leaderboard'),$('leaderboard').value);$('leaderboard-status').textContent='Saved in this browser only.';};
document.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>localStorage.setItem(localKey(b.dataset.save),$(b.dataset.save).value));
function showLessons(){let notes=[];try{notes=JSON.parse(localStorage.getItem('saty-eod-lessons')||'[]');}catch{}$('lessons').textContent=notes.map(n=>n.date+' · '+n.url+' · '+n.text).join('\n')||'No local lessons.';return notes;}
$('lesson-form').onsubmit=e=>{e.preventDefault();const url=new URL($('lesson-url').value);if(url.protocol!=='https:')return;const notes=showLessons();notes.push({url:url.href,text:$('lesson-text').value,date:new Date().toISOString(),status:'CANDIDATE'});localStorage.setItem('saty-eod-lessons',JSON.stringify(notes));$('lesson-form').reset();showLessons();};
function download(name,obj){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export-lessons').onclick=()=>download('saty-eod-lessons.json',showLessons());
$('prepare-sync').onclick=()=>{try{
  const prepared=prepareSync({symbol:$('symbol').value,leaderboard:$('leaderboard').value,maxpain:$('maxpain').value,gex:$('gex').value,lessons:showLessons(),confirmed:$('public-consent').checked});
  $('sync-preview').value=prepared.json;$('submit-sync').href=prepared.url;$('submit-sync').hidden=false;
  $('sync-status').textContent='Review the exact public JSON below, then submit the GitHub issue as the repo owner. Nothing is sent by preparing this preview.';
}catch(e){$('sync-status').textContent=e.message;$('submit-sync').hidden=true;}};
$('symbol').onchange=()=>{loadFields();render();refresh();};$('refresh').onclick=refresh;
clock();showLessons();refresh();setInterval(clock,1000);setInterval(()=>{if(!document.hidden)refresh();},15000);
