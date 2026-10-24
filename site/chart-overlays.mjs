// Canvas-only price-axis overlays shared by main and EOD charts.
const finite=Number.isFinite;
// Canvas colors follow the same semantic tokens as the surrounding dashboard.
// The dark defaults also support offline rendering/tests without a DOM.
export function chartPalette(element=globalThis.document?.documentElement){
 const style=element&&globalThis.getComputedStyle?globalThis.getComputedStyle(element):null;
 const color=(name,fallback)=>style?.getPropertyValue(name).trim()||fallback;
 return {grid:color('--chart-grid','#334459'),label:color('--chart-label','#a8b6c7'),bull:color('--green','#68e0a5'),bear:color('--red','#ff8d99'),info:color('--blue','#7ad9ef'),vwap:color('--purple','#c9b4ff'),neutral:color('--muted','#a8b6c7'),panel:color('--panel','#141d29')};
}
export function chartLevels(snapshot,model,{all=false,extra=[]}={}){
 const side=model?.setup?.side==='LONG'?1:model?.setup?.side==='SHORT'?-1:0;
 const targets=(model?.targets??[]).filter(t=>finite(t.price));
 const anchor=targets[0]?.price;
 if(!model?.fixed_target_only&&side&&finite(anchor))for(const t of (snapshot?.levels??[]).filter(l=>finite(l.price)&&Math.abs(l.multiple??parseFloat(l.label)/100)<=1&&side*(l.price-anchor)>0).sort((a,b)=>side*(a.price-b.price)))if(!targets.some(x=>x.price===t.price))targets.push(t);
 const selected=targets.slice(0,2).map(t=>({...t,exitRole:'target'}));
 const stop=model?.stop;
 const full=all?[...(snapshot?.levels??[]),...extra].filter(l=>finite(l.price)).map(l=>({...l,exitRole:/^[+-]23\.6$/.test(l.label)?'trigger':side&&finite(anchor)&&side*(l.price-anchor)>=0?'target':'level'})):[];
 const unique=new Map(full.map(l=>[l.price,l]));for(const l of selected)unique.set(l.price,l);
 if(stop&&finite(stop.price))unique.set(stop.price,{...stop,exitRole:'stop'});
 return [...unique.values()];
}
export function stackPriceTags(items,top,bottom,gap=20){
 const sorted=items.map(x=>({...x})).sort((a,b)=>a.lineY-b.lineY||a.price-b.price);
 if(!sorted.length)return [];
 const spacing=Math.min(gap,Math.max(1,(bottom-top)/Math.max(1,sorted.length-1)));
 sorted.forEach((x,i)=>{x.tagY=Math.max(top,Math.min(bottom,x.lineY),i?sorted[i-1].tagY+spacing:top);});
 if(sorted.at(-1).tagY>bottom){sorted.at(-1).tagY=bottom;for(let i=sorted.length-2;i>=0;i--)sorted[i].tagY=Math.min(sorted[i].tagY,sorted[i+1].tagY-spacing);}
 return sorted.map(x=>({...x,spacing}));
}
export function drawChartOverlays(ctx,levels,{left=3,right,width,top,bottom,y}){
 const palette=chartPalette(ctx.canvas),roles={target:{color:palette.bull,prefix:'T'},stop:{color:palette.bear,prefix:'STOP'},trigger:{color:palette.neutral,prefix:'TRG'},level:{color:palette.neutral,prefix:'LVL'}};
 const visible=levels.filter(l=>finite(l.price)&&y(l.price)>=top&&y(l.price)<=bottom);
 const tags=stackPriceTags(visible.map(l=>({...l,lineY:y(l.price)})),top+10,bottom-10);
 ctx.save();ctx.lineWidth=.8;ctx.setLineDash([4,5]);ctx.globalAlpha=.3;
 for(const l of tags){ctx.strokeStyle=(roles[l.exitRole]??roles.level).color;ctx.beginPath();ctx.moveTo(left,l.lineY);ctx.lineTo(right,l.lineY);ctx.stroke();}
 ctx.setLineDash([]);ctx.globalAlpha=1;
 const axisX=right+6,pillW=Math.max(40,width-axisX-3);
 for(const l of tags){const style=roles[l.exitRole]??roles.level,h=Math.max(1,Math.min(18,l.spacing-2)),font=Math.max(7,Math.min(10,h-4));
  // Leaders stay in the reserved price-axis gutter; text never enters candles.
  ctx.strokeStyle=style.color;ctx.globalAlpha=.5;ctx.beginPath();ctx.moveTo(right,l.lineY);ctx.lineTo(axisX,l.tagY);ctx.stroke();ctx.globalAlpha=1;
  ctx.fillStyle=palette.panel;ctx.beginPath();ctx.roundRect(axisX,l.tagY-h/2,pillW,h,Math.min(5,h/2));ctx.fill();
  ctx.strokeStyle=style.color;ctx.globalAlpha=.6;ctx.stroke();ctx.globalAlpha=1;ctx.fillStyle=style.color;ctx.font=`${font}px system-ui`;ctx.textBaseline='middle';
  const label=l.exitRole==='stop'?'STOP':`${style.prefix} ${l.label}`;ctx.fillText(`${label} ${l.price.toFixed(2)}`,axisX+5,l.tagY,pillW-9);
 }
 ctx.restore();return tags;
}
