#!/usr/bin/env python3
"""Explicit opt-in, allowlisted PUBLIC research inputs. No browser credentials.

The owner submits a previewed JSON payload via workflow_dispatch or a prefixed
GitHub issue. Never deserialize it as code or write arbitrary files/fields.
"""
import argparse
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from zoneinfo import ZoneInfo

SYMBOLS = {'SPY', 'SPX', 'AAPL', 'GOOGL'}
SECRET = re.compile(r'(?i)(bearer\s+\S+|github_pat_|gh[pousr]_[A-Za-z0-9]|sk-[A-Za-z0-9]{12}|-----BEGIN .*PRIVATE KEY|(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[:=])')

def exact(obj, allowed, name):
    if not isinstance(obj, dict) or set(obj) - set(allowed):
        raise ValueError(f'{name}: unsupported fields or object type')

def text(value, name, limit=1000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or SECRET.search(value):
        raise ValueError(f'{name}: missing, oversized, or possible credential; rejected')
    return value.strip()

def timestamp(value, name):
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            raise ValueError()
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError, AttributeError):
        raise ValueError(f'{name}: aware ISO timestamp required') from None

def number(value, name, minimum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or (minimum is not None and value < minimum):
        raise ValueError(f'{name}: finite number required')
    return value

def validate(payload, now=None):
    now = now or datetime.now(timezone.utc)
    if len(json.dumps(payload)) > 24000:
        raise ValueError('Public input limit is 24 KB')
    exact(payload, ['schema_version','public_safe','symbol','asof','method','expiry_scope','leaderboard','max_pain','gex','lessons'], 'payload')
    if payload.get('schema_version') != 1 or payload.get('public_safe') is not True:
        raise ValueError('Explicit public_safe=true opt-in is required')
    if payload.get('symbol') not in SYMBOLS:
        raise ValueError('Unsupported ticker')
    asof = timestamp(payload.get('asof'), 'asof')
    if (asof-now).total_seconds() > 60:
        raise ValueError('Future input timestamp rejected')
    out = {'schema_version':1, 'public_safe':True, 'symbol':payload['symbol'], 'asof':asof.isoformat(),
           'method':text(payload.get('method'), 'method', 500),
           'expiry_scope':text(payload.get('expiry_scope'), 'expiry_scope', 100)}
    contracts = payload.get('leaderboard', [])
    if not isinstance(contracts, list) or len(contracts) > 10:
        raise ValueError('leaderboard must contain at most 10 contracts')
    result = []
    for c in contracts:
        exact(c, ['contract','expiry','type','strike','volume','premium','contract_vwap','likely_shakeout'], 'contract')
        if c.get('type') not in ('call','put') or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(c.get('expiry'))):
            raise ValueError('Contract requires type and expiry date')
        expiry = datetime.fromisoformat(c['expiry']).date()
        if expiry != asof.astimezone(ZoneInfo('America/New_York')).date():
            raise ValueError('Leaderboard accepts 0DTE contracts only')
        row={'contract':text(c.get('contract'),'contract ID',80),'expiry':c['expiry'],'type':c['type']}
        for k in ['strike','volume','premium','contract_vwap']:
            row[k]=None if c.get(k) is None and k in ('premium','contract_vwap') else number(c.get(k), k, 0)
        if int(row['volume']) != row['volume'] or row['strike'] <= 0:
            raise ValueError('Volume must be an integer and strike positive')
        flag=c.get('likely_shakeout')
        if flag is not None and not isinstance(flag,bool):
            raise ValueError('likely_shakeout must be boolean or null; always manual')
        row['likely_shakeout']=flag; result.append(row)
    if len({c['contract'] for c in result})!=len(result):
        raise ValueError('Duplicate contracts')
    out['leaderboard']=sorted(result,key=lambda c:-c['volume'])
    maxpain=payload.get('max_pain')
    if maxpain is not None:
        exact(maxpain,['spot','low','high'],'max_pain')
        maxpain={k:None if maxpain.get(k) is None else number(maxpain[k],k,0) for k in ('spot','low','high')}
        if (maxpain['low'] is None)!=(maxpain['high'] is None) or (maxpain['low'] is not None and maxpain['low']>maxpain['high']):
            raise ValueError('Max-pain range requires ordered low and high')
    out['max_pain']=maxpain
    gex=payload.get('gex')
    if gex is not None:
        exact(gex,['units','nodes'],'gex')
        units=text(gex.get('units'),'gamma units',100)
        nodes=gex.get('nodes')
        if not isinstance(nodes,list) or len(nodes)>30:
            raise ValueError('gex.nodes limit is 30')
        checked=[]
        for node in nodes:
            exact(node,['strike','gamma','label'],'gex node')
            checked.append({'strike':number(node.get('strike'),'gamma strike',0),
                            'gamma':number(node.get('gamma'),'gamma'),
                            'label':text(node.get('label','GEX node'),'node label',80)})
        gex={'units':units,'nodes':checked}
    out['gex']=gex
    lessons=payload.get('lessons',[])
    if not isinstance(lessons,list) or len(lessons)>10:
        raise ValueError('lessons limit is 10')
    checked=[]
    for lesson in lessons:
        exact(lesson,['source_url','paraphrase','observed_at'],'lesson')
        url=text(lesson.get('source_url'),'source URL',500);u=urlsplit(url)
        if u.scheme!='https' or not u.hostname or u.username or u.password or any(re.search(r'(?i)(token|key|auth|secret|sig)',k) for k in parse_qs(u.query)):
            raise ValueError('Source must be an HTTPS URL without credentials or signed parameters')
        observed=timestamp(lesson.get('observed_at'),'lesson observed_at')
        if observed>now:
            raise ValueError('Future lesson timestamp')
        checked.append({'source_url':url,'paraphrase':text(lesson.get('paraphrase'),'publishable paraphrase',1500),
                        'observed_at':observed.isoformat(),'status':'UNVALIDATED','probability':None})
    out['lessons']=checked
    return out

def sync(payload, data, state, now=None):
    now=now or datetime.now(timezone.utc);value=validate(payload,now)
    key=hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    dest=state/'inputs'/f'{key}.json';dest.parent.mkdir(parents=True,exist_ok=True)
    if dest.exists():
        return {'input_id':key,'duplicate':True,'path':str(dest)}
    value.update(input_id=key,received_at=now.isoformat(),source='EXPLICIT_PUBLIC_MANUAL_SYNC')
    dest.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n')
    path=data/'manual-inputs.json'
    current=json.loads(path.read_text()) if path.exists() else {'schema_version':1,'by_symbol':{},'lessons':[]}
    old=current['by_symbol'].get(value['symbol'])
    # Never replace a later market observation with a backdated sync.
    if not old or timestamp(value['asof'],'asof')>=timestamp(old['asof'],'asof'):
        current['by_symbol'][value['symbol']]={k:v for k,v in value.items() if k!='lessons'}
    for lesson in value['lessons']:
        item={**lesson,'input_id':key,'received_at':value['received_at'],'symbol':value['symbol']}
        if not any(x['source_url']==item['source_url'] and x['paraphrase']==item['paraphrase'] for x in current['lessons']):
            current['lessons'].append(item)
    current['lessons']=current['lessons'][-30:]
    current['updated_at']=value['received_at'];data.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(current,ensure_ascii=False,separators=(',',':'))+'\n')
    return {'input_id':key,'duplicate':False,'symbol':value['symbol'],'public':True,'lesson_n':len(value['lessons'])}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--event',type=Path,required=True);parser.add_argument('--data-dir',type=Path,default=Path('site/data'))
    parser.add_argument('--state-dir',type=Path,default=Path('.dashboard-state/state'));args=parser.parse_args()
    event=json.loads(args.event.read_text())
    if 'issue' in event:
        issue=event['issue'];owner=event['repository']['owner']['login']
        if issue['user']['login']!=owner or not issue.get('title','').startswith('[SATY input sync]'):
            raise ValueError('Only an owner-submitted SATY sync issue is authorized')
        matches=re.findall(r'```json\s*([\s\S]*?)```',issue.get('body') or '')
        if len(matches)!=1:
            raise ValueError('Expected exactly one json code block')
        payload=json.loads(matches[0])
    else:
        payload=json.loads(event.get('inputs',{}).get('payload',''))
    print(json.dumps(sync(payload,args.data_dir,args.state_dir)))

if __name__=='__main__':
    main()
