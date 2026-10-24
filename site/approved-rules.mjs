// Carter-approved v3 overlay. Pure confirmed-RTH replay, never orders or option P&L.
export const APPROVED_VERSION='carter-score60-runner-1.0';
export function scoreDirection(weights){return weights?.call>=60?'CALL':weights?.put>=60?'PUT':'WAIT';}
const sign=d=>d==='CALL'?1:d==='PUT'?-1:0;
const finite=Number.isFinite;
export function replayApproved(rows,levels,session,{runner=true,now=Date.now(),minutes=[]}={}){
 const close=Date.parse(session.close);
 // Time exit is five minutes before the actual calendar close (15:55 normally).
 const end=close-300000,sessionOpen=Date.parse(session.open);
 const bars=rows.filter(r=>Date.parse(r.time)<=now&&Date.parse(r.bar_open)>=sessionOpen&&Date.parse(r.time)<=close);
 let position=null,pending=null,entries=0,cooldownUntil=null,previous='WAIT',lastEvent=null;
 const trades=[],decisions=[];
 const nextTarget=(side,price)=>levels.filter(l=>finite(l.price)&&Math.abs(l.multiple)<=1&&side*(l.price-price)>1e-8).sort((a,b)=>side*(a.price-b.price))[0]??null;
 function exit(price,at,reason,index){const p=position;Object.assign(p,{status:'CLOSED',exit:price,exit_at:new Date(at).toISOString(),exit_reason:reason,return_pct:p.side*(price/p.entry-1)*100});if(p.return_pct<=0)cooldownUntil=at+1800000;lastEvent={kind:'EXIT',reason,time:p.exit_at,price};position=null;}
 for(let i=0;i<bars.length;i++){
  const r=bars[i],start=Date.parse(r.bar_open),at=Date.parse(r.time),side=sign(r.score_direction??scoreDirection(r.evidence_score));
  const contiguous=i===0||start===Date.parse(bars[i-1].time);
  if(!contiguous){pending=null;if(position){position.status='UNRESOLVED';position.exit_reason='Missing RTH bar; no modeled fill';position=null;}}
  if(pending){
   if(start===pending.at&&start<end&&r.et_open<'15:00'&&(!cooldownUntil||start>=cooldownUntil)&&entries<2){
    const dir=pending.side,stop=pending.stop,target=nextTarget(dir,r.open);
    if(finite(stop)&&dir*(r.open-stop)>0&&target){
     position={id:[APPROVED_VERSION,r.symbol,session.date,pending.decision_at].join('|'),side:dir,entry:r.open,entry_at:r.bar_open,decision_at:pending.decision_at,stop,original_stop:stop,target,trigger:pending.trigger,runner:false,status:'TRACKING',setup:pending.setup,extensions:[],modeled:true};trades.push(position);entries++;lastEvent={kind:'ENTRY',time:r.bar_open,price:r.open};
    }
   }
   pending=null;
  }
  if(position){
   const p=position,cut=at>end&&start<end;
   // Never infer a 15:55 price from a 15:54–15:57 3m candle.
   let b=r,exitTime=at;
   if(cut){const subset=minutes.filter(m=>Date.parse(m.time)>=start&&Date.parse(m.time)+60000<=end&&Date.parse(m.time)+60000<=now).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
    if(subset.length!==(end-start)/60000||subset.some((m,j)=>Date.parse(m.time)!==start+j*60000)){
     p.time_exit_pending=true;p.exit_reason='15:55 minute unavailable; DATA HOLD';
     decisions.push({time:r.time,decision:'WAIT',direction:r.score_direction,entries,cooldown_until:cooldownUntil,position_id:p.id,state:'DATA_HOLD'});break;
    }
    b={...r,high:Math.max(...subset.map(x=>x.high)),low:Math.min(...subset.map(x=>x.low)),close:subset.at(-1).close};exitTime=end;
   }
   const stopped=p.side===1?b.low<=p.stop:b.high>=p.stop;
   if(p.side*(b.open-p.stop)<=0)exit(b.open,start,'STOP HIT',i);
   else if(stopped)exit(p.stop,exitTime,'STOP HIT',i);
   else if(exitTime>=end)exit(b.close,end,'15:55 time exit',i);
   else {
    const prior=bars[i-1]??r,target=p.target,hit=p.side===1?b.high>=target.price:b.low<=target.price;
    const support=[{label:'3m ribbon',price:r.ribbon3_stop},{label:'10m ribbon',price:r.ribbon10_stop},...(finite(p.trigger)&&p.side*(p.entry-p.trigger)>0?[{label:'trigger',price:p.trigger}]:[])].filter(l=>finite(l.price));
    const lost=support.find(l=>p.side*(r.close-l.price)<0);
    if(lost)exit(r.close,at,'Lost '+lost.label+' on close',i);
    else if(side===-p.side)exit(r.close,at,'Opposite flip',i);
    else if(hit){
     const following=nextTarget(p.side,target.price),agrees=prior.row_directions?.[0]===p.side,phase=p.side*prior.phase;
     if(runner&&agrees&&finite(phase)&&phase<80&&Math.abs(target.multiple)<=1&&following){
      p.stop=p.side===1?Math.max(p.stop,target.price-.1*r.atr14):Math.min(p.stop,target.price+.1*r.atr14);p.runner=true;p.target=following;p.extensions.push({at:r.time,touched:target.price,stop:p.stop,next:following.price});lastEvent={kind:'RUNNER',time:r.time,price:target.price};
     }else exit(p.side*(b.open-target.price)>=0?b.open:target.price,at,'ATR target',i);
    }
   }
  }
  const direction=r.score_direction??scoreDirection(r.evidence_score),flip=direction!=='WAIT'&&direction!==previous;
  const allowed=contiguous&&flip&&!position&&entries<2&&r.et_close<'15:00'&&at<end&&(!cooldownUntil||at>=cooldownUntil);
  if(allowed){const side=sign(direction),swing=bars.slice(Math.max(0,i-4),i+1);if(swing.length===5){const managed=r.managed_entry?.side===side?r.managed_entry:null;
   pending={at,side,decision_at:r.time,stop:managed?.stop??(side===1?Math.min(...swing.map(x=>x.low)):Math.max(...swing.map(x=>x.high))),trigger:levels.find(l=>l.label===(side===1?'+23.6':'-23.6'))?.price,setup:managed?.setup??'60% score flip · 5-bar swing'};
  }}
  decisions.push({time:r.time,decision:pending?direction:'WAIT',direction,entries,cooldown_until:cooldownUntil,position_id:position?.id??null,state:position?.runner?'RUNNER':position?'HOLD':pending?'NEXT_OPEN':'WAIT'});
  previous=direction;
 }
 // At 15:55 a completed 1m candle may exist before the next 3m close.
 if(position&&now>=end&&!position.time_exit_pending){
  const last=bars.at(-1),start=Date.parse(last?.time),subset=minutes.filter(m=>Date.parse(m.time)>=start&&Date.parse(m.time)+60000<=end).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  if(start<end&&subset.length===(end-start)/60000&&subset.every((m,j)=>Date.parse(m.time)===start+j*60000)){
   for(const b of subset){if(!position)break;const at=Date.parse(b.time)+60000,p=position;if(p.side*(b.open-p.stop)<=0)exit(b.open,Date.parse(b.time),'STOP HIT',bars.length);else if(p.side===1?b.low<=p.stop:b.high>=p.stop)exit(p.stop,at,'STOP HIT',bars.length);else if(at===end)exit(b.close,end,'15:55 time exit',bars.length);}
  }else if(start<end){position.time_exit_pending=true;position.exit_reason='15:55 minute unavailable; DATA HOLD';}
 }
 return {version:APPROVED_VERSION,runner_enabled:runner,trades,decisions,position,pending,entries_today:entries,cooldown_until:cooldownUntil?new Date(cooldownUntil).toISOString():null,cooldown_seconds:cooldownUntil?Math.max(0,Math.ceil((cooldownUntil-now)/1000)):0,last_event:lastEvent,entry_note:'No new entries after 3 PM',signal_only:true};
}
export function summarizeApproved(trades){
 const resolved=trades.filter(t=>t.status==='CLOSED'&&finite(t.return_pct)),n=resolved.length,wins=resolved.filter(t=>t.return_pct>0),gain=wins.reduce((s,t)=>s+t.return_pct,0),loss=-resolved.filter(t=>t.return_pct<0).reduce((s,t)=>s+t.return_pct,0);
 return {n,wins:wins.length,win_rate:n?wins.length/n:null,sum_underlying_return_pct:resolved.reduce((s,t)=>s+t.return_pct,0),profit_factor:loss?gain/loss:null,unresolved_n:trades.filter(t=>t.status==='UNRESOLVED'||t.time_exit_pending).length,open_n:trades.filter(t=>t.status==='TRACKING').length,note:'Underlying equal-notional sum; no costs, leverage or options modeled. Session-correlated small samples.'};
}
export function renderPolicyReview(root,config,evidence){
 if(!root||!config)return;
 const h=document.createElement('h2');h.textContent='Approved rules · one-week replay record';
 const p=document.createElement('p');p.className='fine';p.textContent='Carter-supplied development summary, Oct 19–23. Not independently reproduced. One week is a small, correlated sample; underlying returns are not option returns.';
 const table=document.createElement('table'),body=document.createElement('tbody');
 for(const [name,s] of Object.entries(config.supplied_results??{}).filter(([,v])=>v&&typeof v==='object'&&'n' in v)){
  const row=document.createElement('tr');for(const text of [name,`n=${s.n??'not supplied'}`,`${Math.round(s.win_rate*100)}% wins`,`${s.return_pct>0?'+':''}${s.return_pct}%`, `PF ${s.profit_factor}`,s.max_drawdown_pct!=null?`Max DD ${s.max_drawdown_pct}%`:'']){const c=document.createElement('td');c.textContent=text;row.append(c);}body.append(row);
 }
 table.append(body);
 const live=document.createElement('p');live.className='fine';live.textContent=evidence?`Prospective paired review: sessions n=${evidence.session_count}; runner trades n=${evidence.runner?.n??0}; no-runner trades n=${evidence.no_runner?.n??0}; radar resolved n=${evidence.radar?.n??0}. ${evidence.promotion?.reason??'No automatic promotion.'}`:'Prospective paired review unavailable. No result is inferred from the supplied development week.';
 root.replaceChildren(h,p,table,live);
}
