// The dashboard and market/evidence endpoints are public. The paper journal
// has its own server-side authorization, independent of the Site's audience.
export function createWorker(assets, readHosted, writeHosted, getMarket = null) {
  const json = (value, status = 200) => Response.json(value, {
    status,
    headers: {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}
  });
  const pagesOrigin = 'https://carterwaynereed.github.io';
  const publicHeaders = (request, response) => {
    response.headers.set('Vary', 'Origin');
    if (request.headers.get('origin') === pagesOrigin) {
      response.headers.set('Access-Control-Allow-Origin', pagesOrigin);
      response.headers.set('Access-Control-Expose-Headers', 'ETag');
    }
    return response;
  };
  const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
  const publicResponse = async (request, body, revision) => {
    const etag='W/"'+await digest(revision)+'"';
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',ETag:etag};
    const unchanged=request.headers.get('if-none-match')===etag;
    return publicHeaders(request,new Response(unchanged||request.method==='HEAD'?null:body,{status:unchanged?304:200,headers}));
  };
  const serviceAllowed = (request, env) => {
    const expected=env.SATY_JOURNAL_SERVICE_KEY;
    const supplied=request.headers.get('x-saty-journal-authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    // Fixed-length comparison; never log either credential or return it to a client.
    if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||!supplied)return false;
    let difference=0;
    for(let i=0;i<64;i++)difference|=expected.charCodeAt(i)^supplied.charCodeAt(i);
    return difference===0;
  };
  const ownerAllowed = (request, env) => {
    // Sites dispatch owns these identity headers. A service bypass alone does
    // not supply identity; it must also carry the separate journal credential.
    const id=request.headers.get('oai-authenticated-user-id')?.trim();
    const email=request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
    const owner=typeof env.SATY_JOURNAL_OWNER_EMAIL==='string'?env.SATY_JOURNAL_OWNER_EMAIL.trim().toLowerCase():'';
    return Boolean(id&&email&&owner&&email===owner);
  };
  const denied = request => json({error:'Private journal access requires the owner or authorized updater'},
    request.headers.has('x-saty-journal-authorization')||request.headers.has('oai-authenticated-user-id')||request.headers.has('oai-authenticated-user-email')?403:401);
  return {
    async fetch(request, env) {
      const {pathname} = new URL(request.url);
      const publicAPI=pathname==='/api/market'||pathname==='/api/evidence';
      if(publicAPI&&request.method==='OPTIONS') {
        const method=request.headers.get('access-control-request-method');
        const requested=(request.headers.get('access-control-request-headers')||'').split(',').map(h=>h.trim().toLowerCase()).filter(Boolean);
        if(request.headers.get('origin')!==pagesOrigin||!['GET','HEAD'].includes(method)||requested.some(h=>h!=='if-none-match'))return json({error:'Cross-origin request is not allowed'},403);
        const response=publicHeaders(request,new Response(null,{status:204}));
        response.headers.set('Access-Control-Allow-Methods','GET, HEAD');
        response.headers.set('Access-Control-Allow-Headers','If-None-Match');
        response.headers.set('Access-Control-Max-Age','86400');
        return response;
      }
      if (pathname === '/api/market' && ['GET','HEAD'].includes(request.method)) {
        if (!getMarket) return publicHeaders(request,json({error:'Live TradingView adapter is not configured'}, 503));
        try {
          const market=await getMarket(env.BUCKET);
          // Daily reservations/status can change without a different bar timestamp.
          const revision=JSON.stringify(market.extended_hours??{})+'|'+JSON.stringify(market.momentum??{})+'|'+market.generated_at+'|'+Object.entries(market.symbols).map(([s,v])=>s+':'+v.health?.state+':'+v.session?.calendar_date).join('|');
          return await publicResponse(request,JSON.stringify(market),revision);
        }
        catch {return publicHeaders(request,json({error:'TradingView market refresh failed; retain reference bars and DATA HOLD'}, 503));}
      }
      if(pathname==='/api/evidence'&&['GET','HEAD'].includes(request.method)) {
        const evidence=assets['/data/tv-evidence.json'];
        if(!evidence)return publicHeaders(request,json({error:'Matching public evidence is unavailable'},503));
        return publicResponse(request,evidence.body,evidence.body);
      }
      if (pathname === '/api/snapshot' && request.method === 'GET') {
        if(!ownerAllowed(request,env)&&!serviceAllowed(request,env))return denied(request);
        if (!env.BUCKET) return json({error:'Hosted storage is not configured'}, 503);
        try {
          const value = await readHosted(env.BUCKET);
          return json(value ?? {error:'Waiting for the first scheduled private SPY update'}, value ? 200 : 503);
        } catch {
          return json({error:'Private paper snapshot is unavailable; retained data stays historical'}, 503);
        }
      }
      if (pathname === '/api/update' && request.method === 'POST') {
        if(!serviceAllowed(request,env))return denied(request);
        if (request.headers.get('origin') || request.headers.get('x-saty-update') !== '1') {
          return json({error:'Scheduled updater only'}, 403);
        }
        if (!request.headers.get('content-type')?.startsWith('application/json')) return json({error:'JSON required'}, 415);
        if (!env.BUCKET) return json({error:'Hosted storage is not configured'}, 503);
        try {
          if (Number(request.headers.get('content-length') ?? 0) > 2000000) return json({error:'Snapshot too large'}, 413);
          const reader = request.body?.getReader();
          if (!reader) return json({error:'Missing snapshot'}, 400);
          let length = 0;
          const chunks = [];
          while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            length += value.length;
            if (length > 2000000) {
              await reader.cancel();
              return json({error:'Snapshot too large'}, 413);
            }
            chunks.push(value);
          }
          const body = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {body.set(chunk, offset); offset += chunk.length;}
          return json(await writeHosted(env.BUCKET, JSON.parse(new TextDecoder().decode(body))));
        } catch (error) {
          return json({error:error instanceof Error ? error.message : 'Invalid update'}, 400);
        }
      }
      if (pathname.startsWith('/api/')) return json({error:'No such signal-only desk endpoint'}, 404);
      if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405,headers:{Allow:'GET, HEAD'}});
      const asset = assets[pathname === '/' ? '/index.html' : pathname];
      if (!asset) return new Response('Not found', {status:404});
      return new Response(request.method === 'HEAD' ? null : asset.body, {
        headers: {
          'Content-Type':asset.type,
          'Cache-Control':'private, max-age=0, must-revalidate',
          'X-Content-Type-Options':'nosniff',
          'Referrer-Policy':'no-referrer',
          'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://raw.githubusercontent.com; object-src 'none'; base-uri 'none'; form-action 'self'"
        }
      });
    }
  };
}
