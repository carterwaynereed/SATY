/* Directional support, never a calibrated probability. No trading gate changes row math. */
export const EVIDENCE_ROWS = Object.freeze([
  {id:'ribbon3',label:'3m ribbon',weight:25},
  {id:'ribbon10',label:'10m ribbon',weight:25},
  {id:'conviction',label:'13 / 48 conviction',weight:10},
  {id:'vwap',label:'Session VWAP',weight:15},
  {id:'atr_trigger',label:'Daily ATR trigger',weight:10},
  {id:'confirmed_trigger',label:'Confirmed trigger',weight:15},
]);

export function allocateEvidenceWeights(input = [], {fresh = false, inSession = false} = {}) {
  const rows = Array.isArray(input) ? input : [];
  const features = EVIDENCE_ROWS.map((row,index) => {
    const found = rows.find(x => x?.id === row.id || x?.label === row.label) ?? rows[index];
    const direction = [-1,0,1].includes(found?.direction) ? found.direction : 0;
    return {...row,direction,detail:typeof found?.detail === 'string' ? found.detail : 'Indicator unavailable; neutral weight.'};
  });
  const bull = features.filter(x => x.direction === 1).reduce((sum,x) => sum+x.weight,0);
  const bear = features.filter(x => x.direction === -1).reduce((sum,x) => sum+x.weight,0);
  const neutral = 100-bull-bear, conflict = Math.min(bull,bear);
  const blocked = !fresh || !inSession;
  const call = blocked ? 0 : bull-conflict, put = blocked ? 0 : bear-conflict, wait = 100-call-put;
  const reason = !fresh ? 'Feed unavailable or stale: reference rows retained; live allocation is WAIT.' : !inSession ? 'Outside the regular session: reference rows retained; live allocation is WAIT.' : 'Fresh confirmed bar during the regular session. Entry eligibility is evaluated separately.';
  const math = `Bull ${bull} + bear ${bear} + neutral ${neutral} = 100 points. Conflict = min(${bull}, ${bear}) = ${conflict}. ${blocked ? `Session/feed hold overrides to CALL 0%, PUT 0%, WAIT 100%.` : `CALL = ${bull} − ${conflict} = ${call}%; PUT = ${bear} − ${conflict} = ${put}%; WAIT = ${neutral} + 2 × ${conflict} = ${wait}%.`}`;
  return {call,put,wait,bull,bear,neutral,conflict,blocked,reason,features,math};
}
