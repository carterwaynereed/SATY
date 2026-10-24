// A 0–100 display scale. Defined components total at most 95; never normalize.
export function radarScore(rows,index,warm={widths:[],volumes:[]}){
 const r=rows[index],history=rows.slice(0,index+1),widths=[...(warm.widths??[]),...history.map(x=>Math.abs(x.ema8-x.ema34))],volumes=[...(warm.volumes??[]),...history.slice(0,-1).map(x=>x.volume)],last=widths.length-1;
 const narrow=j=>{if(j<39)return false;const w=widths.slice(j-39,j+1);if(!w.every(Number.isFinite))return false;return widths[j]<=[...w].sort((a,b)=>a-b)[7];};
 const squeezed=Array.from({length:Math.min(10,last+1)},(_,k)=>last-k).some(narrow),expanding=last>=2&&widths[last]>widths[last-1]&&widths[last-1]>widths[last-2];
 const range=(r.day_high-r.day_low)/r.atr14,room=range<.6?20:range<.8?10:0;
 const mean=volumes.slice(-20).reduce((s,v)=>s+(Number.isFinite(v)?v:0),0)/20,volumeKnown=volumes.length>=20&&volumes.slice(-20).every(Number.isFinite)&&Number.isFinite(r.volume);
 const volume=r.symbol!=='SPX'&&volumeKnown&&mean>0&&r.volume>=1.5*mean?15:0;
 const d=r.row_directions??[],lean=d[0]??0,alignment=lean&&lean===d[1]?(lean===d[2]?20:12):0;
 const p=rows[index-1],pp=rows[index-2],turn=lean&&p&&pp&&lean*(r.phase-p.phase)>0&&lean*(p.phase-pp.phase)<=0?10:0;
 const components={atr_room:room,squeeze_expansion:squeezed?(expanding?30:12):0,volume_surge:volume,phase_turning:turn,alignment};
 const score=Object.values(components).reduce((a,b)=>a+b,0);
 return {score,components,lean,highlight:score>=55&&lean!==0,label:'Direction heads-up',time:r.time,session_date:r.session_date,scale_max:100,component_max:95,volume_available:r.symbol!=='SPX'&&volumeKnown,evidence:{origin:'Carter-supplied replay',directional_rate_range:[.62,.63],n:652,horizon_minutes:60,independently_reproduced:false,note:'Development observation; correlated bars, not a calibrated live probability'}};
}
export function renderRadar(root,bundle,{selected,now=Date.now(),onSelect}={}){
 const symbols=['SPY','SPX','AAPL','GOOGL'];const cards=symbols.map(symbol=>{const s=bundle?.symbols?.[symbol],r=s?.radar,age=now-Date.parse(s?.health?.price_asof),fresh=s?.health?.state==='CURRENT'&&age>=0&&age<=225000;return {symbol,r,fresh};}).sort((a,b)=>(b.r?.score??-1)-(a.r?.score??-1)||symbols.indexOf(a.symbol)-symbols.indexOf(b.symbol));
 root.replaceChildren(...cards.map(({symbol,r,fresh})=>{const b=document.createElement('button');b.type='button';b.className='radar-chip'+(fresh&&r?.highlight?' hot':'')+(symbol===selected?' selected':'');b.setAttribute('aria-label',symbol+' direction radar');b.textContent=`${symbol} ${r?`${r.score}/100`:'—'} `;const arrow=document.createElement('span');arrow.className='radar-direction '+(fresh&&r?.lean===1?'bull':fresh&&r?.lean===-1?'bear':'inactive');arrow.textContent=r?.lean===1?'↑':r?.lean===-1?'↓':'·';b.append(arrow,document.createTextNode(` · ${fresh?(r?.highlight?'Direction heads-up':'Watching'):'REFERENCE / HOLD'}`));b.title=r?`Confirmed ${r.time}. Carter-supplied replay: 62–63% directional over 60 min, n=652. Not independently reproduced; not a calibrated probability.`:'Awaiting confirmed regular-session bars.';b.onclick=()=>onSelect?.(symbol);return b;}));
}
