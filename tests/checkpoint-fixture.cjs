// Test-only in-memory PostgREST stand-in. Never connects to a real database.
const clone = value => JSON.parse(JSON.stringify(value));
const marker = '[SUPPLIER_ACCOUNT_V1:';
const encode = account => marker + encodeURIComponent(JSON.stringify(account)) + ']';
let db, writes, tick;
function reset() {
  tick = 0; writes = [];
  const account = { currency: 'USD', openingBalance: 100, currentBalance: 120,
    totalPurchases: 50, totalPayments: 30, entries: [
      { type: 'opening', amount: 100, balance: 100, date: '2026-09-01' },
      { type: 'purchase', amount: 50, balance: 150, date: '2026-09-02' },
      { type: 'payment', amount: 10, balance: 140, date: '2026-09-03' },
      { type: 'payment', amount: 20, balance: 120, date: '2026-09-04' }
    ] };
  db = {
    suppliers: [{ id: 501, name: 'NOVATEX INTERNATIONAL LTD FZE', balance: 120, notes: encode(account) }],
    shipments: [{ id: 'test-shipment', season: 'شتوي', fx: 0.709, customs: 0, clearance: 0, other_cost: 0 }],
    bales: Array.from({ length: 4 }, (_, i) => ({ id: 'test-bale-' + i,
      shipment_id: 'test-shipment', name_en: 'TEST COAT', name_ar: 'جاكيت اختبار',
      grade: 'Cream', weight: 20, buy_usd: 50, status: '[BRANCH:2] متوفر', created_at: '2026-09-10T00:00:00Z' })),
    customers: [{ id: 101, name: 'زبون مراجعة معزول', debt: 100, created_at: '2026-09-10T00:00:00Z' }],
    sales: [], payments: [], cash_movements: [], expenses: [], supplier_payments: []
  };
}
reset();
const now = () => new Date(Date.UTC(2026, 8, 19, 12, 0, ++tick)).toISOString();
function matches(row, query) {
  for (const [key, filter] of query) {
    if (['select', 'order', 'offset', 'limit'].includes(key)) continue;
    const value = String(row[key] ?? '');
    if (filter.startsWith('eq.')) { if (value !== filter.slice(3)) return false; }
    else if (filter.startsWith('gt.')) { if (!(value > filter.slice(3))) return false; }
    else if (filter.startsWith('in.(')) { if (!filter.slice(4, -1).split(',').includes(value)) return false; }
    else if (filter.startsWith('like.')) {
      const pieces = filter.slice(5).split('*').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      if (!new RegExp('^' + pieces.join('.*') + '$').test(value)) return false;
    } else throw new Error('Unsupported fixture filter: ' + key + '=' + filter);
  }
  return true;
}
global.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://checkpoint.invalid' || !url.pathname.startsWith('/rest/v1/')) {
    throw new Error('External network disabled in checkpoint tests');
  }
  const endpoint = url.pathname.slice('/rest/v1/'.length);
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  if (method !== 'GET') writes.push({ endpoint, method, body: clone(body) });
  if (endpoint.startsWith('rpc/')) {
    const customer = db.customers.find(x => x.id === body.p_customer_id);
    if (!customer) throw new Error('Fixture customer missing');
    if (endpoint === 'rpc/record_sale') {
      if (db.sales.some(x => x.id === body.p_id)) throw new Error('Duplicate sale ID');
      db.sales.push({ id: body.p_id, customer_id: body.p_customer_id, total_jod: body.p_amount, notes: body.p_notes, created_at: now() });
      customer.debt += body.p_amount;
    } else if (endpoint === 'rpc/record_payment') {
      if (db.payments.some(x => x.id === body.p_id)) throw new Error('Duplicate payment ID');
      db.payments.push({ id: body.p_id, customer_id: body.p_customer_id, amount: body.p_amount, paid_at: now() });
      customer.debt -= body.p_amount;
    } else throw new Error('Unsupported fixture RPC: ' + endpoint);
    return Response.json({ ok: true });
  }
  if (!Object.hasOwn(db, endpoint)) throw new Error('Unsupported fixture table: ' + endpoint);
  let selected = db[endpoint].filter(row => matches(row, url.searchParams));
  if (method === 'GET') {
    const order = url.searchParams.get('order');
    if (order) {
      const [key, direction] = order.split('.');
      selected.sort((a,b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (direction === 'desc' ? -1 : 1));
    }
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 1000);
    return Response.json(clone(selected.slice(offset, offset + limit)));
  }
  if (method === 'PATCH') selected.forEach(row => Object.assign(row, clone(body)));
  else if (method === 'POST') {
    for (const row of Array.isArray(body) ? body : [body]) {
      if (row.id && db[endpoint].some(x => x.id === row.id)) throw new Error('Duplicate fixture ID');
      db[endpoint].push({ created_at: now(), ...clone(row) });
    }
  } else if (method === 'DELETE') db[endpoint] = db[endpoint].filter(row => !selected.includes(row));
  else throw new Error('Unsupported fixture method: ' + method);
  return Response.json([]);
};
process.on('message', message => {
  if (message.action === 'reset') reset();
  if (['reset', 'inspect'].includes(message.action)) {
    process.send({ requestId: message.requestId, db: clone(db), writes: clone(writes) });
  }
});
