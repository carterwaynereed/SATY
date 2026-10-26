// Read-only public TradingView chart transport. No login, broker, quote scraping,
// or assumption that an unspecified exchange entitlement is real-time.
export const TV_SYMBOLS = Object.freeze({
  SPY: ['AMEX:SPY'], SPX: ['TVC:SPX', 'SP:SPX'],
  AAPL: ['NASDAQ:AAPL'], GOOGL: ['NASDAQ:GOOGL']
});
export const TV_URL = 'https://data.tradingview.com/socket.io/websocket?from=chart%2F&type=chart';
const etFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const finite = value => typeof value === 'number' && Number.isFinite(value);
const et = milliseconds => {
  const p = Object.fromEntries(etFormat.formatToParts(new Date(milliseconds)).map(x => [x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)};
};
export function packTV(method, parameters) {
  const body = JSON.stringify({m:method,p:parameters});
  return `~m~${body.length}~m~${body}`;
}
// Messages can contain multiple chart frames, including a heartbeat.
export function unpackTV(raw) {
  if (typeof raw !== 'string' || raw.length > 4_000_000) throw new Error('Invalid TradingView frame');
  const frames=[]; let position=0;
  while (position < raw.length) {
    const match=/^~m~(\d+)~m~/.exec(raw.slice(position));
    if (!match) throw new Error('Malformed TradingView frame');
    const length=Number(match[1]), start=position+match[0].length;
    if (!Number.isSafeInteger(length) || length < 1 || start+length > raw.length) throw new Error('Truncated TradingView frame');
    frames.push(raw.slice(start,start+length)); position=start+length;
  }
  return frames;
}
export function sourceIdentity(meta, symbol) {
  return {adjustment:'splits',interval:'3m',pro_name:meta?.pro_name || symbol,provider:'TradingView',session_basis:'RTH',source_id:meta?.source_id ?? null,symbol};
}
export async function sourceFingerprint(identity) {
  const canonical=JSON.stringify(Object.fromEntries(Object.keys(identity).sort().map(key=>[key,identity[key]])));
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)));
  return 'sha256:'+Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}
function validBar(values) {
  if (!Array.isArray(values) || !values.slice(0,5).every(finite)) return null;
  const [seconds,open,high,low,close,volume]=values;
  if (seconds <= 0 || Math.min(open,high,low,close) <= 0 || low > Math.min(open,close) || high < Math.max(open,close) || high < low) return null;
  return {time:new Date(seconds*1000).toISOString(),open,high,low,close,volume:finite(volume)&&volume>=0?volume:null};
}
export function confirmedBars(values, intervalMinutes, now=Date.now()) {
  return [...values].map(validBar).filter(Boolean).filter(bar=>{
    const start=Date.parse(bar.time), local=et(start);
    return local.minute>=570 && local.minute<960 && (local.minute-570)%intervalMinutes===0 && local.minute+intervalMinutes<=960 && start+intervalMinutes*60000<=now;
  }).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
}
// TradingView's no-login service rejects custom 10m resolution. Build it from
// exactly ten completed 1m bars, aligned at the 09:30 regular-session open.
export function aggregateTenMinutes(oneMinuteBars, now=Date.now()) {
  const groups=new Map();
  for (const bar of oneMinuteBars) {
    const time=Date.parse(bar.time), local=et(time);
    if (!Number.isFinite(time)||local.minute<570||local.minute>=960||time+60000>now) continue;
    const bucketStart=time-((local.minute-570)%10)*60000;
    if (!groups.has(bucketStart)) groups.set(bucketStart,new Map());
    groups.get(bucketStart).set(time,bar);
  }
  const result=[];
  for (const [start,mapping] of [...groups].sort((a,b)=>a[0]-b[0])) {
    if (start+600000>now || mapping.size!==10) continue;
    const bars=Array.from({length:10},(_,i)=>mapping.get(start+i*60000));
    if (bars.some(bar=>!bar)) continue;
    result.push({time:new Date(start).toISOString(),open:bars[0].open,high:Math.max(...bars.map(b=>b.high)),low:Math.min(...bars.map(b=>b.low)),close:bars[9].close,volume:bars.every(b=>finite(b.volume))?bars.reduce((sum,b)=>sum+b.volume,0):null});
  }
  return result;
}
export async function openTradingViewSocket({fetcher=fetch,signal}={}) {
  const response=await fetcher(TV_URL,{headers:{Upgrade:'websocket',Origin:'https://www.tradingview.com'},signal});
  if (!response.webSocket) throw new Error(`TradingView WebSocket upgrade failed (${response.status})`);
  return response.webSocket;
}
async function readSymbol(tvSymbol,{openSocket,deadline,clock,counts,extended=false,intervals=null}) {
  const specs=intervals??(extended?[['one','1',counts.one],['daily','D',counts.daily]]:[['three','3',counts.three],['one','1',counts.one],['daily','D',counts.daily]]);
  const controller=new AbortController();
  let socket, timer, settled=false;
  const chartSessions=new Map(), datasets={three:new Map(),one:new Map(),daily:new Map()}, metadata={};
  const completed=new Set();
  const remaining=Math.max(1,deadline-clock());
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();try{socket?.close(1000,'timeout');}catch{}reject(new Error('TradingView request timed out'));},remaining);});
  try {
    return await Promise.race([timeout,(async()=>{
      socket=await openSocket({signal:controller.signal});
      return await new Promise((resolve,reject)=>{
        const finish=(error,value)=>{if(settled)return;settled=true;error?reject(error):resolve(value);};
        const send=(method,args)=>socket.send(packTV(method,args));
        socket.addEventListener('error',()=>finish(new Error('TradingView WebSocket error')));
        socket.addEventListener('close',()=>{if(!settled)finish(new Error('TradingView closed before all series completed'));});
        socket.addEventListener('message',event=>{
          if (settled) return;
          try {
            for (const body of unpackTV(event.data)) {
              if(body.startsWith('~h~')){socket.send(`~m~${body.length}~m~${body}`);continue;}
              let message;try{message=JSON.parse(body);}catch{continue;}
              const p=message.p ?? [], key=chartSessions.get(p[0]);
              if(message.m==='symbol_resolved'&&key)metadata[key]=p[2] ?? {};
              if(['symbol_error','series_error','critical_error','protocol_error'].includes(message.m)) {
                const detail=p.filter(v=>typeof v==='string').slice(-2).join(' / ').slice(0,120);
                finish(new Error(`TradingView ${message.m}: ${detail}`));return;
              }
              if(['timescale_update','du'].includes(message.m)&&key) {
                for(const series of Object.values(p[1] ?? {}))for(const item of series?.s ?? []) {
                  if(Array.isArray(item.v)&&finite(item.v[0]))(datasets[key]??=new Map()).set(item.v[0],item.v);
                }
              }
              if(message.m==='series_completed'&&key)completed.add(key);
            }
            if(completed.size===specs.length)finish(null,{datasets,metadata});
          } catch(error){finish(error);}
        });
        // Cloudflare outgoing fetch upgrades need accept(); Node test transports
        // and pre-opened browser WebSocket adapters do not.
        socket.accept?.();
        send('set_auth_token',['unauthorized_user_token']);
        for(const [key,interval,count] of specs) {
          const session='cs_'+crypto.randomUUID().replaceAll('-','').slice(0,12);
          chartSessions.set(session,key);
          send('chart_create_session',[session,'']);
          send('resolve_symbol',[session,'symbol','='+JSON.stringify({symbol:tvSymbol,adjustment:'splits',session:extended&&key!=='daily'?'extended':'regular'})]);
          send('create_series',[session,'series','s1','symbol',interval,count,'']);
        }
      });
    })()]);
  } finally {
    clearTimeout(timer);settled=true;
    try{socket?.close(1000,'snapshot complete');}catch{}
  }
}
export async function readTradingView(symbol,{openSocket=openTradingViewSocket,clock=()=>Date.now(),timeoutMs=12000,counts={three:1200,one:2000,daily:400}}={}) {
  if(!TV_SYMBOLS[symbol])throw new Error('Unsupported ticker');
  const deadline=clock()+Math.max(100,Math.min(timeoutMs,20000)), attempts=[];
  for(const [attemptIndex,tvSymbol] of TV_SYMBOLS[symbol].entries()) {
    if(clock()>=deadline)break;
    try {
      const {datasets,metadata}=await readSymbol(tvSymbol,{openSocket,deadline:clock()+(deadline-clock())/(TV_SYMBOLS[symbol].length-attemptIndex),clock,counts});
      const identity=sourceIdentity(metadata.three,tvSymbol);
      if(!metadata.three?.source_id)throw new Error('TradingView omitted source identity');
      for(const key of ['one','daily'])if(JSON.stringify(sourceIdentity(metadata[key],tvSymbol))!==JSON.stringify(identity))throw new Error(`TradingView ${key} source differs from 3m source`);
      const now=clock(), meta=metadata.three, delay=finite(meta.delay)?Math.max(0,meta.delay):null;
      const cutoff=now-(delay??0)*1000;
      const bars=confirmedBars(datasets.three.values(),3,cutoff);
      const one=confirmedBars(datasets.one.values(),1,cutoff);
      if(!bars.length)throw new Error('TradingView returned no completed regular-session 3m bars');
      const sessionDate=et(Date.parse(bars.at(-1).time)).date;
      // ATR always uses completed daily bars before the intraday session shown.
      const daily=[...datasets.daily.values()].map(validBar).filter(Boolean).filter(bar=>et(Date.parse(bar.time)).date<sessionDate).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
      if(daily.length<20)throw new Error('TradingView daily history is insufficient for ATR14');
      const trend=aggregateTenMinutes(one,cutoff);
      const fingerprint=await sourceFingerprint(identity);
      const last=bars.at(-1), closeAt=new Date(Date.parse(last.time)+180000).toISOString();
      attempts.push({symbol:tvSymbol,status:'OK',source_id:identity.source_id,reported_delay_seconds:delay});
      return {symbol,tv_symbol:tvSymbol,attempts,received_at:new Date(now).toISOString(),
        source:{provider:'TradingView',symbol:tvSymbol,interval:'3m',source_id:identity.source_id,pro_name:identity.pro_name,delay_seconds:delay,reported_delay:delay,realtime:typeof meta.is_realtime==='boolean'?meta.is_realtime:null,data_status:meta.data_status??null,session_basis:'RTH',adjustment:'splits',feed_fingerprint:fingerprint,identity,feed_name:`TradingView ${tvSymbol} · ${identity.source_id}`,notes:symbol==='SPX'?['TVC:SPX is preferred; SP:SPX is the fallback and may report a delay. Index volume may be unavailable.']:[]},
        bars,one_bars:one,trend_bars:trend,daily,last_bar_at:last.time,last_bar_close_at:closeAt,
        volume_available:bars.some(bar=>finite(bar.volume)&&bar.volume>0)};
    } catch(error) {
      attempts.push({symbol:tvSymbol,status:'ERROR',reason:error instanceof Error?error.message:'Feed failed'});
    }
  }
  const error=new Error(`TradingView unavailable for ${symbol}; tried ${attempts.map(a=>a.symbol+': '+a.reason).join('; ')||TV_SYMBOLS[symbol].join(', ')}`);
  error.attempts=attempts;throw error;
}

// Isolated extended transport: never returns the regular replay feed contract.
export async function readExtendedTradingView(symbol,{openSocket=openTradingViewSocket,clock=()=>Date.now(),timeoutMs=12000}={}){
 if(symbol==='SPX'||!TV_SYMBOLS[symbol])throw Error('No extended session for this ticker');
 const {datasets,metadata}=await readSymbol(TV_SYMBOLS[symbol][0],{openSocket,clock,deadline:clock()+timeoutMs,counts:{one:2000,daily:400},extended:true});
 if(!metadata.one?.source_id)throw Error('Extended source identity unavailable');
 if(metadata.daily?.source_id!==metadata.one.source_id)throw Error('Extended and daily source identities differ');
 const now=clock(),delay=metadata.one.delay;
 if(finite(delay)&&delay>0)throw Error('Extended feed reports delayed bars');
 const bars=[...datasets.one.values()].map(validBar).filter(Boolean).filter(b=>{
  const t=Date.parse(b.time),m=et(t).minute;return t+60000<=now&&m>=240&&m<1200&&(m<570||m>=960);
 }).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
 if(!bars.length)throw Error('Public feed returned no confirmed extended bars');
 return {symbol,bars,daily:[...datasets.daily.values()].map(validBar).filter(Boolean).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)),source:{provider:'TradingView',symbol:TV_SYMBOLS[symbol][0],source_id:metadata.one.source_id,session_basis:'EXTENDED',reported_delay:delay??null},received_at:new Date(now).toISOString()};
}

// Native 60-minute extended session. RTH-only hourly bars cannot stand in for ETH.
export async function readHourlyExtended(symbol,{openSocket=openTradingViewSocket,clock=()=>Date.now(),timeoutMs=12000}={}){
 if(symbol==='SPX'||!TV_SYMBOLS[symbol])throw Error('No extended session for this ticker');
 const {datasets,metadata}=await readSymbol(TV_SYMBOLS[symbol][0],{openSocket,clock,deadline:clock()+timeoutMs,counts:{one:1,daily:1,three:1},extended:true,intervals:[['hour','60',500]]});
 if(!metadata.hour?.source_id)throw Error('Hourly source identity unavailable');
 const now=clock(),delay=metadata.hour.delay;
 if(finite(delay)&&delay>0)throw Error('Hourly feed reports delayed bars');
 const bars=[...(datasets.hour?.values()??[])].map(validBar).filter(Boolean).filter(b=>{const t=Date.parse(b.time),m=et(t).minute;return t+3600000<=now&&m>=240&&m<1200;}).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
 if(!bars.length)throw Error('Public feed returned no confirmed hourly ETH bars');
 if(!bars.some(b=>{const m=et(Date.parse(b.time)).minute;return m<570||m>=960;}))throw Error('Hourly feed has no extended-hours bars');
 return {symbol,bars,source:{provider:'TradingView',symbol:TV_SYMBOLS[symbol][0],source_id:metadata.hour.source_id,session_basis:'ETH',interval:'60',reported_delay:delay??null},received_at:new Date(now).toISOString()};
}

// Independent VIX context; never mixed into ticker bars or evidence weights.
export async function readVixTradingView({openSocket=openTradingViewSocket,clock=()=>Date.now(),timeoutMs=12000}={}){
 const {datasets,metadata}=await readSymbol('CBOE:VIX',{openSocket,clock,deadline:clock()+timeoutMs,counts:{three:1500,one:1,daily:120}});
 if(!metadata.three?.source_id||metadata.daily?.source_id!==metadata.three.source_id)throw Error('VIX source identity unavailable or inconsistent');
 const delay=metadata.three.delay,cutoff=clock()-(finite(delay)?Math.max(0,delay):0)*1000;
 return {bars:confirmedBars(datasets.three.values(),3,cutoff),daily:[...datasets.daily.values()].map(validBar).filter(Boolean).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)),source:{symbol:'CBOE:VIX',source_id:metadata.three.source_id,reported_delay:delay??null}};
}

// Small native interval context for live alerts; isolated from RTH evidence bars.
export async function readAlertInterval(tvSymbol,minutes,{openSocket=openTradingViewSocket,clock=()=>Date.now(),timeoutMs=10000}={}){
 const {datasets,metadata}=await readSymbol(tvSymbol,{openSocket,clock,deadline:clock()+timeoutMs,counts:{three:500},intervals:[['three',String(minutes),500]]});
 if(!metadata.three?.source_id)throw Error('Native alert interval source unavailable');
 const delay=metadata.three.delay,cutoff=clock()-(finite(delay)?Math.max(0,delay):0)*1000;
 return {bars:[...datasets.three.values()].map(validBar).filter(Boolean).filter(b=>Date.parse(b.time)<=cutoff).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)),source:{symbol:tvSymbol,source_id:metadata.three.source_id,pro_name:metadata.three.pro_name??tvSymbol},cutoff};
}
