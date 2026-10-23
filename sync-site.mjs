import {snapshot,saveJSON} from './scan.mjs';
const SITE='https://saty-plus-trading-desk.zestyfawn9.chatgpt.site';
// Access is supplied by the owning task from Sites get_site, in memory only.
// No market-provider credentials are used here. Never put tokens in arguments.
console.log('Ready for private Sites access JSON on stdin (input is hidden).');
if(process.stdin.isTTY){process.stdin.setRawMode(true);process.stdin.resume();}
const access=await new Promise((resolve,reject)=>{
 let input='';process.stdin.setEncoding('utf8');
 process.stdin.on('data',chunk=>{
  if(chunk.includes('\u0003')){reject(new Error('Cancelled'));return;}
  input+=chunk;if(input.length>20000){reject(new Error('Access input too large'));return;}
  if(input.includes('\n')||input.includes('\r')){try{resolve(JSON.parse(input.trim()));}catch{reject(new Error('Invalid access input'));}}
 });
 process.stdin.on('end',()=>{try{resolve(JSON.parse(input));}catch{reject(new Error('Missing access input'));}});
});
try{
 if(access.site!==SITE||typeof access.token!=='string'||access.token.length<20)throw new Error('Access must be for the configured private Site');
 const state=await snapshot();
 for(const symbol of ['SPX','AAPL','GOOGL'])state.feeds.symbols[symbol]={bars:[],daily:[],error:symbol==='SPX'?'SPX paused: Unusual Whales requires provisioned Cboe index access':'Paused: SPY-only focus'};
 delete state.analyses;
 const headers={'OAI-Sites-Authorization':`Bearer ${access.token}`};
 const response=await fetch(SITE+'/api/update',{method:'POST',headers:{...headers,'Content-Type':'application/json','X-Saty-Update':'1'},body:JSON.stringify(state),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`Hosted update failed (${response.status})`);
 const result=await response.json();
 const readback=await fetch(SITE+'/api/snapshot',{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!readback.ok)throw new Error(`Hosted readback failed (${readback.status})`);
 const saved=await readback.json();
 if(Date.parse(saved.generatedAt)<Date.parse(state.generatedAt))throw new Error('Hosted readback is older than the submitted scan');
 const status={ok:true,syncedAt:new Date().toISOString(),generatedAt:saved.generatedAt,asOf:saved.analyses?.find(a=>a.symbol==='SPY')?.asOf,mode:saved.mode};
 await saveJSON('site-sync-status.json',status);console.log(JSON.stringify(status));
}catch(error){await saveJSON('site-sync-status.json',{ok:false,attemptedAt:new Date().toISOString(),error:error.message});console.error(error.message);process.exitCode=1;}
finally{if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();process.stdin.removeAllListeners();process.stdin.unref?.();}
// Windows PTYs may retain their input handle after pause/unref. All network and
// atomic status writes are already awaited; end this one-shot helper explicitly.
process.exit(process.exitCode||0);
