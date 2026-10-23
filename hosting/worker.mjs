// Sites enforces the existing owner-private audience before invoking this Worker.
// Keep the private paper journal behind that boundary; never proxy it to Pages.
export function createWorker(assets, readHosted, writeHosted, getMarket = null) {
  const json = (value, status = 200) => Response.json(value, {
    status,
    headers: {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}
  });
  return {
    async fetch(request, env) {
      const {pathname} = new URL(request.url);
      if (pathname === '/api/market' && request.method === 'GET') {
        if (!getMarket) return json({error:'Live TradingView adapter is not configured'}, 503);
        try {
          const market=await getMarket(env.BUCKET);
          const revision=market.generated_at+'|'+Object.entries(market.symbols).map(([s,v])=>s+':'+v.health?.state+':'+v.session?.calendar_date).join('|');
          const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(revision));
          const etag='W/"'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')+'"';
          if(request.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers:{ETag:etag,'Cache-Control':'private, no-store'}});
          const response=json(market);response.headers.set('ETag',etag);return response;
        }
        catch {return json({error:'TradingView market refresh failed; retain reference bars and DATA HOLD'}, 503);}
      }
      if (pathname === '/api/snapshot' && request.method === 'GET') {
        if (!env.BUCKET) return json({error:'Hosted storage is not configured'}, 503);
        try {
          const value = await readHosted(env.BUCKET);
          return json(value ?? {error:'Waiting for the first scheduled private SPY update'}, value ? 200 : 503);
        } catch {
          return json({error:'Private paper snapshot is unavailable; retained data stays historical'}, 503);
        }
      }
      if (pathname === '/api/update' && request.method === 'POST') {
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
