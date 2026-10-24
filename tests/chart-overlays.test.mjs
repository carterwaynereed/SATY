import test from 'node:test';import assert from 'node:assert/strict';
import {chartLevels,stackPriceTags,drawChartOverlays} from '../site/chart-overlays.mjs';
const snapshot={levels:[{label:'-100',multiple:-1,price:90},{label:'-23.6',multiple:-.236,price:98},{label:'+23.6',multiple:.236,price:102},{label:'+38.2',multiple:.382,price:103},{label:'+61.8',multiple:.618,price:104},{label:'+100',multiple:1,price:110}]};
test('default overlays contain next two directional targets and stop, with no other ATR levels',()=>{
 for(const [side,target,stop,expected] of [['LONG',102,99,[102,103]],['SHORT',98,101,[98,90]]]){const model={setup:{side},targets:[{label:'selected',price:target}],stop:{price:stop}};const x=chartLevels(snapshot,model);assert.equal(x.length,3);assert.deepEqual(x.filter(l=>l.exitRole==='target').map(l=>l.price),expected);assert.equal(x.filter(l=>l.exitRole==='stop').length,1);}
});
test('all-level toggle restores reference grid; triggers grey and duplicate stop wins',()=>{
 const model={setup:{side:'LONG'},targets:[{label:'+38.2',price:103}],stop:{price:102}};
 const all=chartLevels(snapshot,model,{all:true});assert.equal(all.length,6);assert.equal(all.find(x=>x.price===98).exitRole,'trigger');assert.equal(all.find(x=>x.price===102).exitRole,'stop');assert.equal(all.find(x=>x.price===103).exitRole,'target');assert.equal(chartLevels(snapshot,model).length,3);
});
test('price-axis tag stacking stays inside bounds, avoids collisions and is immutable',()=>{
 const source=[{price:1,lineY:10},{price:2,lineY:11},{price:3,lineY:12},{price:4,lineY:179}],before=structuredClone(source);const result=stackPriceTags(source,20,180);assert.deepEqual(source,before);for(let i=0;i<result.length;i++){assert.ok(result[i].tagY>=20&&result[i].tagY<=180);if(i)assert.ok(result[i].tagY-result[i-1].tagY>=19.99);}
 const dense=stackPriceTags(Array.from({length:25},(_,i)=>({price:i,lineY:90})),10,210);for(let i=1;i<dense.length;i++)assert.ok(dense[i].tagY>dense[i-1].tagY);assert.ok(dense.at(-1).tagY<=210);
});
test('overlay rendering keeps all text in reserved axis gutter; dashed low-opacity lines',()=>{
 const calls=[],ctx={save(){},restore(){},setLineDash(v){calls.push(['dash',v]);},beginPath(){},moveTo(x,y){calls.push(['move',x,y]);},lineTo(){},stroke(){calls.push(['stroke',this.globalAlpha,this.lineWidth]);},fill(){},roundRect(x,y,w,h){calls.push(['pill',x,y,w,h]);},fillText(text,x,y){calls.push(['text',text,x,y]);}};
 drawChartOverlays(ctx,[{label:'-100',price:90,exitRole:'target'},{label:'stop',price:91,exitRole:'stop'}],{left:3,right:450,width:580,top:0,bottom:200,y:p=>100-(p-90)});
 assert.ok(calls.filter(c=>c[0]==='text').every(c=>c[2]>=456));assert.ok(calls.some(c=>c[0]==='stroke'&&c[1]===.3&&c[2]===.8));assert.ok(calls.some(c=>c[0]==='pill'));assert.deepEqual(calls.find(c=>c[0]==='dash')[1],[4,5]);
});
