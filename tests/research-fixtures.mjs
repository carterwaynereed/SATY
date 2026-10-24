export function fixture(){
 const days=['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23'];
 const bars=[],one=[];let i=0;
 for(const day of days)for(let j=0;j<130;j++){
   const time=new Date(Date.parse(day+'T13:30:00Z')+j*180000).toISOString();
   const close=100+0.8*Math.sin(j/9),open=100+0.8*Math.sin((j-1)/9);
   bars.push({time,open,high:Math.max(open,close)+.06,low:Math.min(open,close)-.06,close,volume:100});i++;
 }
 for(let j=0;j<390;j++)one.push({time:new Date(Date.parse('2026-10-23T13:30:00Z')+j*60000).toISOString(),open:100,high:101,low:99,close:100,volume:100});
 const daily=[];for(let j=0;j<150;j++)daily.push({time:new Date(Date.parse('2026-04-01T13:30:00Z')+j*86400000).toISOString(),open:100,high:101,low:99,close:100,volume:100});
 return {symbol:'SPY',source:{feed_fingerprint:'sha256:TEST-ONLY',symbol:'TEST:SPY'},bars,one_bars:one,daily,
   session:{date:'2026-10-23',open:'2026-10-23T13:30:00Z',close:'2026-10-23T20:00:00Z'},
   first_received_at:'2026-10-23T13:33:10Z',last_received_at:'2026-10-23T20:00:10Z'};
}
