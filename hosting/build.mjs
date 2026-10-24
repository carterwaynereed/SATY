// Deterministic, dependency-free Worker ESM build. Only public site/ files are
// embedded. Private data/, local journals, credentials and Python never ship.
import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname, extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createWorker} from './worker.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.jsonl':'application/x-ndjson; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'};
const assets = {};
async function collect(directory, prefix = '') {
  for (const entry of (await readdir(directory, {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const name = prefix + entry.name;
    if (entry.isDirectory()) await collect(join(directory,entry.name), name+'/');
    else {
      if (!types[extname(name)]) throw new Error('Unsupported public asset: '+name);
      assets['/'+name] = {type:types[extname(name)],body:await readFile(join(directory,entry.name),'utf8')};
    }
  }
}
await collect(join(root,'site'));
if (!assets['/index.html'] || !assets['/engine.mjs']) throw new Error('Merged frontend is missing');
// Embed the exact frozen paper engine and storage module in isolated closures.
// These two authored modules have named exports only; fail on new imports.
const engine = (await readFile(join(root,'site/engine.mjs'),'utf8')).replace(/^export /gm,'');
if (/^import /m.test(engine)) throw new Error('Paper engine acquired a runtime dependency');
const snapshot = (await readFile(join(root,'lib/hosted-snapshot.mjs'),'utf8'))
  .replace(/^import \{analyze,journalStats\} from '\.\.\/site\/engine\.mjs';\r?\n/, '')
  .replace(/^export /gm,'');
if (/^import /m.test(snapshot)) throw new Error('Unexpected storage-module dependency');
async function inlineModule(path, imports, returns) {
  let text = await readFile(join(root,path),'utf8');
  for (const line of imports) {
    if (!text.includes(line)) throw new Error('Unexpected import contract in '+path);
    text = text.replace(line,'');
  }
  text=text.replace(/^export /gm,'');
  if (/^import /m.test(text)) throw new Error('Unexpected runtime dependency in '+path);
  return text+`\nreturn {${returns}};`;
}
const weights = await inlineModule('site/weights.mjs',[],'allocateEvidenceWeights');
const tv = await inlineModule('lib/tradingview-feed.mjs',[],'readTradingView,readExtendedTradingView,readVixTradingView,readAlertInterval,TV_SYMBOLS');
const live = await inlineModule('lib/saty-live.mjs',["import {allocateEvidenceWeights} from '../site/weights.mjs';"],'buildLiveSnapshot,unavailableSnapshot,etParts,dailyLevels,replaySaty,SATY_VERSION');
const rulesModule=await inlineModule('site/approved-rules.mjs',["import {outcomeStats,metricText} from './outcome-stats.mjs';"],'APPROVED_VERSION,replayApproved,scoreDirection');
const radarModule=await inlineModule('site/radar.mjs',[],'radarScore');
const policyModule=await inlineModule('lib/approved-policy.mjs',["import {replaySaty,etParts,SATY_VERSION} from './saty-live.mjs';","import {allocateEvidenceWeights} from '../site/weights.mjs';","import {APPROVED_VERSION,replayApproved,scoreDirection} from '../site/approved-rules.mjs';","import {radarScore} from '../site/radar.mjs';"],'attachApproved');
const outcomeModule=await inlineModule('site/outcome-stats.mjs',[],'outcomeStats,metricText,ALERT_PROFILES');
const alertsModule=await inlineModule('lib/live-alerts.mjs',["import {etParts} from './saty-live.mjs';","import {bounceEventGate} from './level-bounce.mjs';","import {outcomeStats,ALERT_PROFILES} from '../site/outcome-stats.mjs';"],'intervalRows,intervalAt,replayAlertDesk');
const alertReaderModule=await inlineModule('lib/live-alert-reader.mjs',["import {readAlertInterval,TV_SYMBOLS} from './tradingview-feed.mjs';","import {intervalRows,intervalAt,replayAlertDesk} from './live-alerts.mjs';","import {etParts} from './saty-live.mjs';"],'createAlertReader');
const bounceModule=await inlineModule('lib/level-bounce.mjs',["import {etParts} from './saty-live.mjs';"],'bounceReferences,replayBounce,overnightReference,bounceEventGate');
const bounceLiveModule=await inlineModule('lib/level-bounce-live.mjs',["import {createAlertReader} from './live-alert-reader.mjs';","import {readVixTradingView,readExtendedTradingView} from './tradingview-feed.mjs';","import {replayBounce,overnightReference} from './level-bounce.mjs';","import {etParts} from './saty-live.mjs';"],'createBounceReader');
const bounceEvents=JSON.parse(await readFile(join(root,'hosting/bounce-events.json'),'utf8'));
const market = await inlineModule('lib/live-market.mjs',["import {bounceReferences} from './level-bounce.mjs';","import {attachApproved} from './approved-policy.mjs';","import {readTradingView,TV_SYMBOLS} from './tradingview-feed.mjs';","import {buildLiveSnapshot,unavailableSnapshot,etParts} from './saty-live.mjs';","import {allocateEvidenceWeights} from '../site/weights.mjs';"],'createMarketReader');
const sessionModeModule = await inlineModule('site/session-mode.mjs',[],'sessionMode');
const extendedModule = await inlineModule('lib/extended-hours.mjs',["import {readExtendedTradingView} from './tradingview-feed.mjs';","import {dailyLevels,etParts} from './saty-live.mjs';","import {sessionMode} from '../site/session-mode.mjs';"],'createExtendedReader');
const calendar = JSON.parse(await readFile(join(root,'hosting/session-calendar.json'),'utf8'));
const evidence = JSON.parse(assets['/data/tv-evidence.json'].body);
const output = `// Generated by hosting/build.mjs; edit source files, never this artifact.\nconst assets=${JSON.stringify(assets)};\nconst paper=(()=>{\n${engine}\nreturn {analyze,journalStats};})();\nconst storage=(()=>{const {analyze,journalStats}=paper;\n${snapshot}\nreturn {readHosted,writeHosted};})();\nconst weights=(()=>{${weights}})();\nconst tv=(()=>{${tv}})();\nconst live=(()=>{const {allocateEvidenceWeights}=weights;${live}})();\nconst approvedRules=(()=>{const {outcomeStats,metricText}=(()=>{${outcomeModule}})();${rulesModule}})();\nconst radarModuleRuntime=(()=>{${radarModule}})();\nconst approvedPolicy=(()=>{const {replaySaty,etParts,SATY_VERSION}=live;const {allocateEvidenceWeights}=weights;const {APPROVED_VERSION,replayApproved,scoreDirection}=approvedRules;const {radarScore}=radarModuleRuntime;${policyModule}})();\nconst bounceRuntime=(()=>{const {etParts}=live;${bounceModule}})();\nconst outcomeRuntime=(()=>{${outcomeModule}})();\nconst alertsRuntime=(()=>{const {etParts}=live;const {bounceEventGate}=bounceRuntime;const {outcomeStats,ALERT_PROFILES}=outcomeRuntime;${alertsModule}})();\nconst alertReaderRuntime=(()=>{const {readAlertInterval,TV_SYMBOLS}=tv;const {intervalRows,intervalAt,replayAlertDesk}=alertsRuntime;const {etParts}=live;${alertReaderModule}})();\nconst bounceLive=(()=>{const {createAlertReader}=alertReaderRuntime;const {readVixTradingView,readExtendedTradingView}=tv;const {replayBounce,overnightReference}=bounceRuntime;const {etParts}=live;${bounceLiveModule}})();\nconst attachBounce=bounceLive.createBounceReader(${JSON.stringify(calendar)},${JSON.stringify(bounceEvents)});\nconst market=(()=>{const {bounceReferences}=bounceRuntime;const {attachApproved}=approvedPolicy;const {readTradingView,TV_SYMBOLS}=tv;const {buildLiveSnapshot,unavailableSnapshot,etParts}=live;const {allocateEvidenceWeights}=weights;${market}})();\nconst getRegularMarket=market.createMarketReader(${JSON.stringify(evidence)},${JSON.stringify(calendar)});\nconst sessionPolicy=(()=>{${sessionModeModule}})();\nconst ext=(()=>{const {readExtendedTradingView}=tv;const {dailyLevels,etParts}=live;const {sessionMode}=sessionPolicy;${extendedModule}})();\nconst getExtended=ext.createExtendedReader(${JSON.stringify(calendar)});\nconst getMarket=async bucket=>{const regular=await getRegularMarket(bucket);const extended_hours=await getExtended(regular);return attachBounce({...regular,extended_hours},bucket);};\nconst createWorker=${createWorker.toString()};\nexport default createWorker(assets,storage.readHosted,storage.writeHosted,getMarket);\n`;
const module = await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
if (typeof module.default?.fetch !== 'function') throw new Error('Worker must export default.fetch');
const response = await module.default.fetch(new Request('https://example.test/'), {});
if (response.status !== 200 || !(await response.text()).includes('Saty')) throw new Error('Worker asset smoke test failed');
if(process.argv.includes('--check')){console.log(JSON.stringify({checked:true,assets:Object.keys(assets).length,worker_bytes:Buffer.byteLength(output)}));process.exit(0);}
const manifest = JSON.parse(await readFile(join(root,'.openai/hosting.json'),'utf8'));
if (!manifest.project_id || manifest.static || manifest.r2 !== 'BUCKET') throw new Error('Preserve the existing Site ID and R2 BUCKET binding; no static manifest for this Worker');
await mkdir(join(root,'dist/server'),{recursive:true});
await mkdir(join(root,'dist/.openai'),{recursive:true});
await writeFile(join(root,'dist/server/index.js'),output);
await writeFile(join(root,'dist/.openai/hosting.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({assets:Object.keys(assets).length,worker_bytes:Buffer.byteLength(output),sha256:createHash('sha256').update(output).digest('hex')}));
