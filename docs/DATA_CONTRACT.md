# Dashboard JSON contract (v1)
All times ISO 8601 including offset. Null means unavailable, never zero-imputed. Only confirmed bars.
Money prices numeric rounded 4 decimals maximum. No NaN/Infinity. UI reads relative data/*.json.
## site/data/latest.json
{schema_version:1, generated_at, snapshot_id, strategy:{version:"saty-sig-2.0",name,session_basis:"RTH",notes:[]},
session:{date,status:"OPEN|CLOSED|PREMARKET|HOLIDAY",open,close,timezone:"America/New_York",refresh_minutes:10},
health:{state:"CURRENT|STALE|UNAVAILABLE|CLOSED",reason,price_asof,age_seconds,ttl_seconds:900,history_complete,warnings:[],source:{provider,symbol,interval,delay_seconds,realtime}},
market:{symbol:"SPY",last,prev_close,atr14,change,change_atr,vwap,day_high,day_low},
levels:[{label,multiple,price,distance}],
ribbon:{ema8,ema13,ema21,ema34,ema48,alignment,conviction,price_position,phase,phase_slope,squeeze},
bars:[{time,open,high,low,close,volume,ema8,ema21,ema34,ema48,vwap,phase}],
plan:{state:"WAIT|TRACKING|DATA_HOLD",summary,next_conditions:[{label,price,note}],conflicts:[]},
signals:[{id,setup,cohort,side:"LONG|SHORT",kind:"managed|context",decision_at,observed_at,bar_at,entry_at,entry,stop,risk,risk_atr,status:"PENDING_ENTRY|TRACKING|CANCELLED|CLOSED|EXPIRED",eligibility,note,targets:[{label,price,rr,outcome,probability:Probability}],exit:{reason,price,at}|null}],
footnotes:[]}
No actionable ELIGIBLE state in v1: polling/replayed entries are historical or pending, cannot know next open in advance.
## Probability
{event:"Tn before original stop by session close",evidence:"DEVELOPMENT",display_probability:null|number,
raw_rate:null|number,hits:number,n:number,sessions:number,episodes:number|null,
interval:null|[lo,hi],interval_method:"Wilson 95% (descriptive; sessions correlated)",
estimate:null|number,estimate_label:"... descriptive ...",target_index:1..3,rr_bucket,
cohort_label,reason,training_end,ambiguous:number,timeouts:number,method_notes:[]}
Rates are 0..1. Count hits/n, separate 95% interval of raw event rate from any smoothed estimate.
Exact relevant setup+cohort+target index+RR bucket count; suppress headline under 20 relevant episodes.
Supplied stats lack episode ID: same target index row count equals episodes conditional on supplied generator; disclose ID limitation.
Never pool target j rows as independent signals. No made-up counts. If robust target-specific estimate unavailable display null.
## site/data/evidence.json
{schema_version:1,stats_id,strategy_version,training_from,training_to,built,evidence_state:"DEVELOPMENT",sessions,event_definition,method,limitations:[],cohorts:[{setup,cohort,episodes,sessions,t1:{hits,n,rate,interval},median_t1_r,ambiguous,timeouts}],calibration:{...}}
## site/data/uw.json
{schema_version:1,status:"placeholder|manual",asof:null,source:"Unusual Whales — manual",symbol:"SPY",method:null,expiry_scope:null,ttl_minutes:15,
gamma:{regime:null,net_gex:null,zero_gamma:null,call_wall:null,put_wall:null,units:null},
flow:{net_premium:null,call_premium:null,put_premium:null,window:null,classification:null},
dark_pool:{levels:[],note:null},max_pain:null,notes:[]}
Manual inputs are contextual only; never modify probability or baseline setup rules. SPX data kept on SPX basis.
