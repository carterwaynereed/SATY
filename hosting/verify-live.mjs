// Read-only deployment proof. Credentials arrive only through hidden stdin;
// output contains counts and hashes, never journal rows or access tokens.
import {createHash} from 'node:crypto';
const site='https://saty-plus-trading-desk.zestyfawn9.chatgpt.site';
console.log('Ready for private verification JSON on stdin (input is hidden).');
if(process.stdin.isTTY){process.stdin.setRawMode(true);process.stdin.resume();}
const access=await new Promise((resolve,reject)=>{
  let input='';process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{
    input+=chunk;
    if(input.length>20000)return reject(new Error('Access input too large'));
    if(/[\r\n]/.test(input)){try{resolve(JSON.parse(input.trim()));}catch{reject(new Error('Invalid access input'));}}
  });
});
try{
  if(typeof access.token!=='string'||access.token.length<20)throw new Error('Access token required');
  const headers={'OAI-Sites-Authorization':'Bearer '+access.token};
  const page=await fetch(site+'/',{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
  const html=await page.text();
  const response=await fetch(site+'/api/snapshot',{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
  const snapshot=await response.json().catch(()=>({}));
  const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
  console.log(JSON.stringify({page_status:page.status,page_bytes:Buffer.byteLength(html),has_saty:html.includes('Saty'),has_learning:html.includes('Learning'),snapshot_status:response.status,generated_at:snapshot.generatedAt??null,paper_rows:Array.isArray(snapshot.journal)?snapshot.journal.length:null,journal_hash:Array.isArray(snapshot.journal)?hash(snapshot.journal):null,mode:snapshot.mode??null}));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();process.stdin.removeAllListeners();process.stdin.unref?.();}
process.exit(process.exitCode||0);
