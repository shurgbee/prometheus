// Real client/proxy contract tests. No browser mocks or external services.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'finhub-contract-'));
function compile(source, target) {
  fs.writeFileSync(path.join(folder, target), ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', source), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText);
}
compile('lib/api/http.ts', 'http.js'); compile('lib/api/sse.ts', 'sse.js');
compile('app/api/[...path]/route.ts', 'proxy.js');
const { httpApi, normalizePortfolio, normalizeTrigger, normalizeEvaluation, normalizeJob } = require(path.join(folder, 'http.js'));
const proxy = require(path.join(folder, 'proxy.js'));
const originalFetch = global.fetch;
const originalToken = process.env.BACKEND_API_TOKEN;
after(() => { fs.rmSync(folder, { recursive: true, force: true }); global.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.BACKEND_API_TOKEN; else process.env.BACKEND_API_TOKEN = originalToken;
});
const spec = { name: 'Tesla watch', entity: 'Tesla', tickers: ['TSLA'], hypothesis: 'Test',
  signals: [{ source: 'news', query: 'Tesla', detector: 'text_event', params: { keywords: ['recall'] }, poll: '5m' }],
  critical_capable: true, pinned: false, cooldown: { normal: '30m', critical: '30m' } };
const trigger = { id: 't1', spec, status: 'active', created_at: '2026-11-07T20:00:00Z',
  last_checked_at: '2026-11-07T20:01:00Z', level: 'Critical', last_severity: 85 };
const evaluation = { ts: trigger.last_checked_at, magnitude: 1, exposure: .04, credibility: 1,
  urgency: 1, adjustment: 0, severity: 85, level: 'Critical' };
const report = { id: 'r1', title: 'EV subsidies', topic: 'EV', summary: 'Test', tickers: ['TSLA'], created_at: trigger.created_at };
const respond = (value, status = 200) => Response.json(value, { status });
const parseBody = (init) => JSON.parse(init.body);

test('financial semantics: position cost, percentage units, missing prices and exposure', () => {
  const raw = { total: 100000, day_change: 1000, day_change_percent: 1, allocation: { cash: 96000, cd: 0, stocks: 4000 },
    holdings: [{ id: 'h1', asset_class: 'stock', name: 'Tesla', quantity: 16, cost_basis: 3500,
      value: 4000, gain: 500, gain_percent: 14.2857, day_change_percent: 2, weight: .04 }], demo: true };
  const p = normalizePortfolio(raw);
  assert.equal(p.day_change_pct, .01); assert.equal(p.holdings[0].cost_basis, 3500);
  assert.equal(p.holdings[0].gain_pct, .142857); assert.equal(p.holdings[0].day_change_pct, .02);
  assert.equal(normalizePortfolio({ ...raw, total: null, day_change_percent: null }).total, null);
  assert.ok(Math.abs(normalizeEvaluation(evaluation).exposure - .4) < 1e-12);
  assert.equal(normalizeTrigger(trigger).last_level, 'critical');
  assert.equal(normalizeJob({ id: 'j1', status: 'completed' }).status, 'done');
});
test('history, report listing/search and research jobs use backend envelopes', async () => {
  global.fetch = async (url) => {
    if (url.includes('/networth/')) { assert.match(url, /range=All/); return respond({ series: [{ total: 100 }] }); }
    if (url === '/api/reports') return respond({ reports: [report] });
    if (url.startsWith('/api/reports?')) return respond({ matches: [{ ...report, passage: 'Tax credits', score: .8 }], similar: [] });
    return respond({ id: 'j1', topic: 'EV', status: 'completed', report_id: 'r1', error: null });
  };
  assert.equal((await httpApi.getNetWorthHistory('ALL')).points[0].total, 100);
  assert.equal((await httpApi.searchReports()).results[0].report.id, 'r1');
  assert.equal((await httpApi.searchReports('subsidies')).results[0].passage, 'Tax credits');
  assert.equal((await httpApi.getResearchJob('j1')).job_id, 'j1');
});
test('holdings retain total cost; trigger mutations carry explicit approval', async () => {
  global.fetch = async (url, init) => {
    if (url === '/api/holdings') { assert.equal(parseBody(init).cost_basis, 3500); return respond(parseBody(init)); }
    assert.deepEqual(parseBody(init), { approved: true, status: 'paused' });
    return respond({ ...trigger, status: 'paused' });
  };
  await httpApi.createHolding({ asset_class: 'stock', cost_basis: 3500, quantity: 16 });
  assert.equal((await httpApi.updateTrigger('t1', { status: 'paused' })).status, 'paused');
});
test('fragmented SSE maps approvals/research/saved triggers without duplicating answer text', async () => {
  const frames = [['thread', { thread_id: 'thread1' }], ['tool', { data: { research_job: { id: 'j1', topic: 'EV' } } }],
    ['token', { text: 'Hello' }], ['answer', { text: 'Hello' }], ['trigger_approval', { proposals: [{ proposal_id: 'p1', spec }] }],
    ['triggers_updated', { trigger_ids: ['t1'], rejected: [] }], ['done', {}]];
  global.fetch = async (url, init) => {
    if (url === '/api/triggers') return respond([trigger]);
    assert.equal(parseBody(init).decisions[0].action, 'edit');
    const bytes = new TextEncoder().encode(frames.map(([event, data]) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`).join(''));
    return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close();
    }}));
  };
  const events = [];
  for await (const event of httpApi.resumeChat('thread1', { decisions: [{ proposal_id: 'p1', action: 'edit', spec }] })) events.push(event);
  assert.equal(events.filter((e) => e.type === 'token' && e.text === 'Hello').length, 1);
  assert.equal(events.find((e) => e.type === 'research').job_id, 'j1');
  assert.equal(events.find((e) => e.type === 'proposals').proposals[0].proposal_id, 'p1');
  assert.equal(events.find((e) => e.type === 'triggers_created').triggers[0].name, spec.name);
});
test('injected events include IDs, URLs and urgency, without unsupported fields', async () => {
  global.fetch = async (_url, init) => {
    const body = parseBody(init); assert.ok(body.external_id); assert.equal(body.urgency, 1);
    assert.equal(body.price_change_pct, undefined); return respond({ evaluation, alert: null });
  };
  const result = await httpApi.injectSignal({ trigger_id: 't1', source: 'sec_edgar', title: 'DEMO', url: 'https://www.sec.gov/',
    magnitude: .9, urgency: 1, price_change_pct: -.08 });
  assert.equal(result.evaluation.level, 'critical');
});
test('atomic CSV errors identify failing rows', async () => {
  global.fetch = async () => respond({ detail: { imported: 0, rows: [{ row: 3, errors: [{ msg: 'Missing principal' }] }] } }, 422);
  await assert.rejects(() => httpApi.importHoldings(new File(['test'], 'test.csv')), /Row 3: Missing principal/);
});
function req(url, init) { const r = new Request(url, init); r.nextUrl = new URL(url); return r; }
test('server proxy keeps auth private, streams SSE and denies internal/cross-origin mutations', async () => {
  process.env.BACKEND_API_TOKEN = 'private-test-token';
  global.fetch = async (url, init) => {
    assert.match(url, /\/api\/chat$/); assert.equal(init.headers.get('authorization'), 'Bearer private-test-token');
    return new Response('event: token\ndata: {"text":"streamed"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const r = await proxy.POST(req('http://localhost:3000/api/chat', { method: 'POST', body: '{}' }), { params: { path: ['chat'] } });
  assert.match(await r.text(), /streamed/); assert.equal(r.headers.get('content-type'), 'text/event-stream');
  assert.equal(r.headers.get('authorization'), null);
  assert.equal((await proxy.POST(req('http://localhost:3000/api/chat', { method: 'POST', headers: { Origin: 'https://evil.test' } }), { params: { path: ['chat'] } })).status, 403);
  assert.equal((await proxy.GET(req('http://localhost:3000/api/internal/anything'), { params: { path: ['internal', 'anything'] } })).status, 404);
});
