const finite=v=>typeof v==='number'&&Number.isFinite(v);
const num=v=>finite(v)?v.toFixed(2):'—';
const signed=v=>finite(v)?`${v>0?'+':''}${v.toFixed(2)}`:'—';
const tone=s=>s==='ON'||s==='FIRING'?'watch-text':s==='RELEASE'?'info':'inactive';
const side=v=>v==='above'?'bull':v==='below'?'bear':'inactive';
function css(){if(document.getElementById('hourly-eth-style'))return;const s=document.createElement('style');s.id='hourly-eth-style';s.textContent='.ribbon-values b.bull,.eth-read b.bull{color:var(--green)}.ribbon-values b.bear,.eth-read b.bear{color:var(--red)}.ribbon-values b.watch-text,.eth-read b.watch-text{color:var(--amber)}.ribbon-values b.info,.eth-read b.info{color:var(--cyan)}.ribbon-values b.inactive,.eth-read b.inactive{color:var(--neutral)}.eth-read{position:absolute;z-index:3;top:8px;left:8px;display:flex;gap:6px;flex-wrap:wrap;max-width:72%;pointer-events:none}.eth-read span{background:#141d29eb;border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:10px;color:var(--muted)}';document.head.append(s);}
function chip(k,v,cls){const s=document.createElement('span'),a=document.createElement('small'),b=document.createElement('b');a.textContent=k;b.textContent=v;if(cls)b.className=cls;s.append(a,b);return s;}
function chips(h){
 const state=h?.state||'DATA HOLD',held=!h||state==='DATA HOLD'||state==='CLOSED',out=[chip('hourly TTM',held?state:h.momentum?`${state} · ${h.momentum}`:state,tone(state))];
 if(held)out.push(chip('ETH',h?.reason||'Hourly ETH unavailable','inactive'));
 else{out.push(chip('h10 ETH',`${num(h.ema10)} · ${h.vs10??'—'} ${signed(h.dist10)}`,side(h.vs10)));out.push(chip('h21 ETH',`${num(h.ema21)} · ${h.vs21??'—'} ${signed(h.dist21)}`,side(h.vs21)));}
 return out;
}
function mount(doc,h){
 const wrap=doc.getElementById('chart')?.parentElement;if(!wrap)return;
 wrap.querySelector('[data-eth]')?.remove();
 const badge=doc.createElement('div');badge.className='eth-read';badge.dataset.eth='1';badge.title=h?.reason||'Hourly ETH context only. Not a live entry.';badge.append(...chips(h));wrap.append(badge);
 const levels=doc.getElementById('levels');if(!levels)return;
 levels.querySelectorAll('[data-eth-level]').forEach(node=>node.remove());
 if(!finite(h?.ema10)||!finite(h?.ema21))return;
 for(const [label,price,rel,dist] of [['h10 ETH',h.ema10,h.vs10,h.dist10],['h21 ETH',h.ema21,h.vs21,h.dist21]]){
  const row=doc.createElement('div');row.className='level';row.dataset.ethLevel='1';
  const name=doc.createElement('span'),strong=doc.createElement('strong'),note=doc.createElement('small');
  name.textContent=label;strong.textContent=num(price);strong.className=side(rel);note.textContent=`${rel??'—'} ${signed(dist)} · hourly context`;
  row.append(name,strong,note);levels.append(row);
 }
}
export function paint(host,h){
 if(!host)return;css();host.querySelector('[data-h]')?.remove();
 const row=document.createElement('span');row.dataset.h='1';row.append(...chips(h));row.title=h?.reason||'Hourly ETH context only. Not a live entry.';host.append(row);
 const doc=host.ownerDocument;if(doc?.getElementById)mount(doc,h);
}
