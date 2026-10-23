import {snapshot,saveJSON} from './scan.mjs';
const state=await snapshot();
for(const symbol of ['SPX','AAPL','GOOGL'])state.feeds.symbols[symbol]={bars:[],daily:[],error:symbol==='SPX'?'SPX paused: Unusual Whales requires provisioned Cboe index access':'Paused: SPY-only focus'};
delete state.analyses;
await saveJSON('hosted-snapshot.json',state);
console.log(JSON.stringify({file:'data/hosted-snapshot.json',generatedAt:state.generatedAt,symbols:['SPY'],journal:state.journal.length}));
