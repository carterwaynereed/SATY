// No credential is requested or stored. GitHub confirms the owner write.
export function prepareSync({symbol,leaderboard,maxpain,gex,lessons,confirmed,now=new Date().toISOString()}){
  if(!confirmed)throw Error('Confirm that these exact inputs are safe to publish publicly.');
  if(!['SPY','SPX','AAPL','GOOGL'].includes(symbol))throw Error('Unsupported ticker');
  const parse=(s,def)=>s?.trim()?JSON.parse(s):def;
  const lb=parse(leaderboard,{contracts:[]}),mp=parse(maxpain,null),gx=parse(gex,null);
  const context=[lb,mp,gx].filter(Boolean).find(x=>x.asof&&x.method&&x.expiry_scope)??((lessons?.length)?{asof:now,method:'Lesson-only submission; no options observations',expiry_scope:'not applicable'}:null);
  if(!context)throw Error('Provide asof, method and expiry_scope in at least one input. JSON templates are shown below.');
  for(const x of [lb,mp,gx].filter(Boolean)){if(x.symbol&&x.symbol!==symbol)throw Error('Manual ticker differs from selected ticker');for(const k of ['asof','method','expiry_scope'])if(x[k]&&x[k]!==context[k])throw Error('Combined manual inputs must share '+k+'; submit different observations separately.');}
  const payload={schema_version:1,public_safe:true,symbol,asof:context.asof,method:context.method,expiry_scope:context.expiry_scope,
    leaderboard:lb.contracts??[],max_pain:mp?{spot:mp.spot??null,low:mp.low??null,high:mp.high??null}:null,
    gex:gx?{units:gx.units,nodes:gx.nodes}:null,
    lessons:(lessons??[]).map(x=>({source_url:x.url,paraphrase:x.text,observed_at:x.date??now}))};
  const json=JSON.stringify(payload,null,2);
  if(json.length>24000||/(bearer\s+\S+|github_pat_|gh[pousr]_[A-Za-z0-9]|sk-[A-Za-z0-9]{12}|-----BEGIN .*PRIVATE KEY|(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[:=])/i.test(json))throw Error('Oversized input or possible credential detected; nothing was sent.');
  const url=new URL('https://github.com/carterwaynereed/SATY/issues/new');
  url.searchParams.set('title','[SATY input sync] '+symbol+' '+now.slice(0,10));
  url.searchParams.set('body','I approve publishing only these research observations and lesson paraphrases. No private journal or credentials.\n\n```json\n'+json+'\n```');
  return {payload,json,url:url.href};
}
