const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=x=>Number.isFinite(x)?'$'+x.toFixed(2):'—';
export function bouncePanelModel(snapshot,{now=Date.now(),failed=false}={}){
 const b=snapshot?.level_bounce,live=!failed&&snapshot?.health?.state==='CURRENT'&&now-Date.parse(snapshot?.health?.price_asof)>=0&&now-Date.parse(snapshot?.health?.price_asof)<=225000&&now<Date.parse(snapshot?.session?.close);
 const trade=b?.position??b?.trades?.at(-1),pending=b?.pending;
 const freshPending=pending&&now-Date.parse(pending.decision_at)<=225000&&now>=Date.parse(pending.decision_at)&&new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now))<'15:00';
 const hold=failed||['STALE','UNAVAILABLE'].includes(snapshot?.health?.state)||!b||b.state==='DATA HOLD';
 const signal=hold?'DATA HOLD':!live?'CLOSED':b.state==='SKIP DAY'?'SKIP DAY':freshPending?(pending.side===1?'CALL':'PUT'):trade?.status==='TRACKING'?(trade.side===1?'CALL':'PUT'):'WAIT';
 return {signal,trade,pending:freshPending?pending:null,reason:b?.reason??'Waiting for Level Bounce context',live};
}
export function renderBouncePanel(root,snapshot,options={}){
 if(!root)return;const b=snapshot?.level_bounce,x=bouncePanelModel(snapshot,options),t=x.trade,p=x.pending;
 const tone=x.signal==='CALL'?'green':x.signal==='PUT'?'red':'neutral';
 root.innerHTML=`<div class="panel-head"><h2>Level Bounce <small>· signal only</small></h2><span class="exit-badge ${tone}" role="status">${esc(x.signal)}</span></div><p>${esc(x.reason)}</p><p class="fine">Two confirmed 3m candles · ${esc(b?.start_et??'10:00')} start · No new entries after 3 PM · Trades today: ${esc(b?.entries_today??0)}${b?.cooldown_until&&Date.parse(b.cooldown_until)>(options.now??Date.now())?' · Cooldown until '+esc(new Date(b.cooldown_until).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'}))+' ET':''}</p>${p?'<p><b>'+esc(p.side===1?'CALL':'PUT')+' confirmed</b> at '+esc(p.level.label)+' '+price(p.level.price)+'. Entry: next 3m open (price pending). Stop: 0.35 ATR; target: 0.4 ATR, subject to put cap.</p>':''}${t?`<p><b>${esc(t.side===1?'CALL':'PUT')}</b> · modeled entry ${price(t.entry)} · stop ${price(t.stop)} · target ${price(t.target?.price)} · ${esc(t.status)}</p><button type="button" class="bounce-select">Show target & stop</button>`:''}<p class="fine">Hold to stop, target or 15:55 ET; no early cut. ${b?.overnight_available?'Overnight context available.':'Overnight range unavailable: conservative 10:00 start; overnight level omitted.'}</p><p class="fine">Reported OOS replay · 5 weeks · n=33 · 70% wins · Wilson 95% 53–83% · +4.02% · PF 1.76 · max DD −1.10%. User-supplied, not independently reproduced; a small sample, not a live win probability.</p>`;
 root.querySelector('button')?.addEventListener('click',()=>options.onSelect?.(t.id));
}
