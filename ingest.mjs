import {readFile} from 'node:fs/promises';
import {readJSON,saveJSON,withDataLock} from './scan.mjs';
import {prepareFeed} from './lib/feed-ingest.mjs';
const file=process.argv[2];if(!file)throw new Error('Usage: node ingest.mjs data/provider-update.json');
const update=JSON.parse(await readFile(file,'utf8'));
await withDataLock(async()=>{const feeds=await readJSON('feeds.json',{provider:'Unusual Whales',symbols:{}});try{
 feeds.symbols.SPY=prepareFeed(feeds.symbols.SPY,update);feeds.fetchedAt=update.retrievedAt;
 await saveJSON('feeds.json',feeds);console.log(JSON.stringify({symbol:'SPY',...feeds.symbols.SPY.quality,error:feeds.symbols.SPY.error,delayed:feeds.symbols.SPY.delayed}));
}catch(error){feeds.symbols.SPY={...feeds.symbols.SPY,error:error.message,lastAttemptAt:new Date().toISOString()};await saveJSON('feeds.json',feeds);throw error;}});
