// Display/polling policy only. Exchange calendar is authoritative on the server.
export function sessionMode(now=Date.now(),session=null){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));
 const day=`${p.year}-${p.month}-${p.day}`,minute=+p.hour*60 + +p.minute;
 const weekday=!['Sat','Sun'].includes(p.weekday),open=Date.parse(session?.open),close=Date.parse(session?.close);
 const regular=weekday&&(Number.isFinite(open)&&session?.date===day?now>=open&&now<close:minute>=570&&minute<960);
 const extended=weekday&&!regular&&((minute>=240&&minute<570)||(minute>=960&&minute<1200));
 return {day,minute,mode:regular?'REGULAR':extended?'EXTENDED HOURS':'CLOSED',poll_ms:regular?15000:extended?60000:null};
}
export function shouldPoll(last,now=Date.now(),session=null){const ms=sessionMode(now,session).poll_ms;return ms!==null&&now-last>=ms;}
