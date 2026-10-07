// Original synthetic fixtures. Never mount a user profile or substitute public URLs.
import { createServer } from 'node:http';

export const CASES = Object.freeze([
  { id: 'static', expected: 'Radar: fonte pública de demonstração.', http: 'captured', browser: 'captured' },
  { id: 'dynamic', expected: 'Radar: conteúdo renderizado por JavaScript.', http: 'abstained', browser: 'captured' },
  { id: 'missing', expected: null, http: 'abstained', browser: 'abstained' },
  { id: 'ambiguous', expected: null, http: 'abstained', browser: 'abstained' },
]);
const html = body => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body>${body}</body></html>`;
const script = code => `<script>${code}</script>`;
const evidence = text => `<p data-radar-evidence>${text}</p>`;
const pages = Object.freeze({
  static: html(evidence(CASES[0].expected)),
  dynamic: html(script(`const p=document.createElement('p'); p.dataset.radarEvidence=''; p.textContent=${JSON.stringify(CASES[1].expected)}; document.body.append(p);`)),
  missing: html('<p>Sem evidência publicável.</p>'),
  ambiguous: html(evidence('Primeira versão.') + evidence('Segunda versão.')),
  post: html(script("fetch('/sink',{method:'POST',body:'synthetic'}).catch(()=>{});")),
  subresource: html('<img src="/sink">'),
  frame: html('<iframe src="/sink"></iframe>'),
  inlineframe: html('<iframe src="about:blank"></iframe>'),
  websocket: html(script("new WebSocket('ws://'+location.host+'/sink');")),
  popup: html(script("window.open('/sink');")),
  foreign: html(script("fetch('http://localhost:'+location.port+'/sink').catch(()=>{});")),
  serviceworker: html(script("navigator.serviceWorker.register('/sink').catch(()=>{});")),
  storage: html(script("const previous=localStorage.getItem('fixture')||document.cookie; localStorage.setItem('fixture','synthetic'); document.cookie='fixture=synthetic'; const p=document.createElement('p'); p.dataset.radarEvidence=''; p.textContent=previous?'leaked':'fresh'; document.body.append(p);")),
  longtext: html(evidence('x'.repeat(2100))),
});

export async function startFixtures() {
  const hits = [];
  const timers = new Set();
  const server = createServer((req, res) => {
    hits.push({ path: req.url, method: req.method, cookie: req.headers.cookie ?? null });
    const id = req.url?.replace(/^\/fixtures\//, '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (id === 'redirect') { res.writeHead(302, { Location: '/sink' }); return res.end(); }
    if (id === 'oversized') { res.write('x'.repeat(40000)); return res.end('x'.repeat(40000)); }
    if (id === 'slow') {
      const timer = setTimeout(() => { timers.delete(timer); res.end(html('late')); }, 3000);
      timers.add(timer); return;
    }
    if (id === 'badmime') { res.setHeader('Content-Type', 'application/json'); return res.end('{}'); }
    if (Object.hasOwn(pages, id)) return res.end(pages[id]);
    res.writeHead(404); res.end();
  });
  server.on('upgrade', (req, socket) => { hits.push({ path: req.url, method: 'UPGRADE' }); socket.destroy(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const ids = [...Object.keys(pages), 'redirect', 'oversized', 'slow', 'badmime'];
  return {
    origin, ids: Object.freeze(ids), hits,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
