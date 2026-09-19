const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
let child, base, output = '', seq = 0;
const pending = new Map();
function fixture(action) {
  const requestId = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Fixture timeout')); }, 3000);
    pending.set(requestId, value => { clearTimeout(timer); resolve(value); });
    child.send({ action, requestId });
  });
}
async function request(url, method = 'GET', body) {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function ok(url, method, body) {
  const result = await request(url, method, body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
before(async () => {
  const portFinder = net.createServer();
  portFinder.listen(0, '127.0.0.1');
  await once(portFinder, 'listening');
  const port = portFinder.address().port;
  await new Promise(resolve => portFinder.close(resolve));
  base = 'http://127.0.0.1:' + port;
  child = fork(path.join(root, 'launcher.js'), [], {
    cwd: root, execArgv: ['--require', path.join(__dirname, 'checkpoint-fixture.cjs')],
    env: { PATH: process.env.PATH, PORT: String(port), SKIP_BOOTSTRAP_FILE_PATCH: '1',
      SUPABASE_URL: 'https://checkpoint.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.on('message', message => { const done = pending.get(message.requestId); pending.delete(message.requestId); if (done) done(message); });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Server failed to start: ' + output);
});
beforeEach(async () => { await fixture('reset'); });
after(async () => { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } });

test('launcher serves supplier delete and inventory scripts; external integrations stay disabled', async () => {
  const html = await fetch(base + '/').then(r => r.text());
  for (const src of ['supplier_account_patch.js?v=4-delete-payment', 'inventory_add_form_patch.js?v=1',
    'customer_statement_patch.js?v=3-share', 'statement_share_patch.js?v=2-almadinah']) {
    assert.equal(html.split(src).length - 1, 1, src);
    assert.equal((await fetch(base + '/' + src)).status, 200);
  }
  assert.equal((await ok('/api/v7/whatsapp/status')).configured, false);
  assert.equal((await ok('/api/v7/backups/status')).enabled, false);
});

test('deleting a middle supplier payment recalculates every later balance and only changes the supplier', async () => {
  const initial = await fixture('inspect');
  const result = await ok('/api/supplier-account/501/entries/2', 'DELETE');
  assert.equal(result.deleted.amount, 10);
  assert.equal(result.balance, 130);
  assert.deepEqual(result.account.entries.map(x => x.balance), [100, 150, 130]);
  assert.equal(result.account.totalPurchases, 50);
  assert.equal(result.account.totalPayments, 20);
  assert.equal((await ok('/api/supplier-account/501')).currentBalance, 130);
  const after = await fixture('inspect');
  for (const key of ['bales', 'sales', 'payments', 'customers', 'cash_movements', 'shipments']) assert.deepEqual(after.db[key], initial.db[key], key);
  assert.ok(after.writes.every(x => x.endpoint === 'suppliers'));
  assert.equal(after.db.suppliers[0].balance, 130);
});

test('opening, purchase, invalid and missing supplier entries cannot be deleted', async () => {
  for (const index of ['0', '1', '-1', '1.5', '99', 'invalid']) {
    assert.equal((await request('/api/supplier-account/501/entries/' + index, 'DELETE')).status, 400);
  }
  assert.equal((await request('/api/supplier-account/999/entries/2', 'DELETE')).status, 400);
  assert.equal((await fixture('inspect')).writes.length, 0);
});

test('new supplier payments and purchases retain decimal totals after deletion', async () => {
  await ok('/api/supplier-account/501/entries/2', 'DELETE');
  await ok('/api/supplier-account/501/entries', 'POST', { type: 'payment', amount: 10.25 });
  const result = await ok('/api/supplier-account/501/entries', 'POST', { type: 'purchase', amount: 5.10 });
  assert.equal(result.balance, 124.85);
  assert.equal(result.account.totalPurchases, 55.10);
  assert.equal(result.account.totalPayments, 30.25);
});

function inventoryForm(quantity, apiOverride) {
  let uid = 0;
  const alerts = [];
  const fields = Object.fromEntries(Object.entries({ baleShipment: 'test-shipment', nameAr: 'صنف عربي جديد',
    nameEn: '', grade: 'Cream', weight: '20', buyUsd: '50', baleQty: String(quantity) }).map(([key, value]) => [key, { value }]));
  const button = { textContent: 'حفظ البالة', disabled: false };
  const context = { document: { readyState: 'complete', getElementById: key => fields[key] || null,
      querySelector: () => button, addEventListener() {} },
    alert: text => alerts.push(text), uid: () => 'added-bale-' + (++uid),
    api: apiOverride || (async (url, options) => ok(url, options.method, JSON.parse(options.body))),
    refresh: async () => {}, refreshInventoryNow: async () => {}, setTimeout };
  context.window = context;
  vm.runInNewContext(readFileSync(path.join(root, 'inventory_add_form_patch.js'), 'utf8'), context);
  return { context, fields, button, alerts };
}

test('Arabic-only multi-bale entry reaches inventory and the sale catalog with exact quantity', async () => {
  const form = inventoryForm(3);
  await form.context.saveBale();
  assert.equal(form.button.disabled, false);
  assert.match(form.alerts.at(-1), /3/);
  const full = await ok('/api/v3/inventory/full');
  assert.equal(full.bale_count, 7);
  assert.equal(full.bales.filter(x => x.name_ar === 'صنف عربي جديد').length, 3);
  const catalog = await ok('/api/v4/sales/catalog');
  assert.equal(catalog.products.find(x => x.name_ar === 'صنف عربي جديد').quantity, 3);
  assert.equal((await ok('/api/v12/data/fast')).bales.length, 7);
});

test('inventory rejects missing shipment and more than 500 bales without writing', async () => {
  const form = inventoryForm(501);
  await form.context.saveBale();
  form.fields.baleQty.value = '3'; form.fields.baleShipment.value = '';
  await form.context.saveBale();
  assert.equal((await fixture('inspect')).db.bales.length, 4);
  assert.equal(form.alerts.length, 2);
});

async function sell(batch = 'checkpoint-sale-01') {
  const catalog = await ok('/api/v4/sales/catalog');
  const product = catalog.products.find(x => x.name_en === 'TEST COAT');
  const input = { customer_id: 101, batch_id: batch, paid_now: 50,
    lines: [{ product_id: product.id, quantity: 2, line_total_jod: 200 }] };
  const preview = await ok('/api/v4/sales/preview', 'POST', input);
  assert.equal(preview.expected_debt_after, 250);
  assert.equal((await fixture('inspect')).db.sales.length, 0);
  assert.equal((await ok('/api/v4/sales/commit', 'POST', input)).debt, 250);
  return input;
}

test('sale preview is read-only; sale reduces inventory and updates statement; same batch cannot duplicate sale', async () => {
  const input = await sell();
  const repeat = await ok('/api/v4/sales/commit', 'POST', input);
  assert.equal(repeat.already_recorded, true);
  assert.equal(repeat.debt, 250);
  const state = await fixture('inspect');
  assert.equal(state.db.sales.length, 1); assert.equal(state.db.payments.length, 1);
  assert.equal(state.db.bales.filter(x => x.status.includes('مباع')).length, 2);
  assert.equal((await ok('/api/v4/sales/catalog')).products[0].quantity, 2);
  for (const version of ['v6', 'v7']) {
    const statement = await ok('/api/' + version + '/customers/101/statement');
    assert.equal(statement.opening_debt, 100); assert.equal(statement.customer.current_debt, 250);
    assert.equal(statement.total_sales, 200); assert.equal(statement.total_payments, 50);
    assert.equal(statement.movements[0].balance_after, 250);
  }
});

test('full reversal restores stock, debt and cash-refund record; repeat reversal has no duplicate effect', async () => {
  await sell();
  const saleId = (await fixture('inspect')).db.sales[0].id;
  const result = await ok('/api/v6/sales/' + saleId + '/reverse', 'POST', {});
  assert.equal(result.debt, 100); assert.equal(result.restored_bales, 2); assert.equal(result.cash_refund, 50);
  await ok('/api/v6/sales/' + saleId + '/reverse', 'POST', {});
  const state = await fixture('inspect');
  assert.equal(state.db.customers[0].debt, 100);
  assert.equal(state.db.cash_movements.filter(x => x.reference_type === 'sale_return').length, 1);
  assert.equal((await ok('/api/v4/sales/catalog')).products[0].quantity, 4);
  const statement = await ok('/api/v7/customers/101/statement');
  assert.equal(statement.total_returns, 200); assert.equal(statement.customer.current_debt, 100);
});

test('partial return restores one bale and the corresponding customer credit without duplication', async () => {
  await sell();
  const saleId = (await fixture('inspect')).db.sales[0].id;
  const body = { return_id: 'checkpoint-return-01', lines: [{ line_index: 0, quantity: 1 }] };
  const result = await ok('/api/v7/sales/' + saleId + '/partial-return', 'POST', body);
  assert.equal(result.returned_qty, 1); assert.equal(result.returned_total, 100); assert.equal(result.debt, 150);
  await ok('/api/v7/sales/' + saleId + '/partial-return', 'POST', body);
  assert.equal((await ok('/api/v4/sales/catalog')).products[0].quantity, 3);
  const statement = await ok('/api/v7/customers/101/statement');
  assert.equal(statement.total_returns, 100); assert.equal(statement.customer.current_debt, 150);
  assert.equal(statement.movements.filter(x => x.type === 'partial_return').length, 1);
});

test('supplier delete UI asks for confirmation and refreshes the statement after success', async () => {
  const account = await ok('/api/supplier-account/501');
  const holder = { innerHTML: '' };
  let approve = false, calls = 0, refreshes = 0;
  const context = { document: { getElementById: () => holder },
    data: { suppliers: [{ id: 501, name: 'مورد اختبار', notes: '[SUPPLIER_ACCOUNT_V1:' + encodeURIComponent(JSON.stringify(account)) + ']' }] },
    confirm: () => approve, alert() {}, api: async () => { calls++; }, refresh: async () => { refreshes++; } };
  context.window = context;
  vm.runInNewContext(readFileSync(path.join(root, 'supplier_account_patch.js'), 'utf8'), context);
  context.supplierStatement(501);
  assert.equal((holder.innerHTML.match(/حذف الدفعة/g) || []).length, 2);
  await context.deleteSupplierAccountPayment(501, 2); assert.equal(calls, 0);
  approve = true; await context.deleteSupplierAccountPayment(501, 2);
  assert.equal(calls, 1); assert.equal(refreshes, 1);
});

test('KNOWN P1: a stale or repeated supplier delete must not delete the next payment',
  { todo: 'Current code addresses entries by mutable array index; add stable entry IDs and conflict protection in a separate fix.' }, async () => {
    await ok('/api/supplier-account/501/entries/2', 'DELETE');
    const repeat = await request('/api/supplier-account/501/entries/2', 'DELETE');
    assert.notEqual(repeat.status, 200, 'Second DELETE silently removed the different $20 payment');
  });

test('KNOWN P2, pre-existing: retrying a partially completed inventory batch must not add duplicates',
  { todo: 'Inventory batch retry needs durable operation IDs/resume or an atomic bulk insert; behavior also exists in d5ea927.' }, async () => {
    let attempt = 0;
    const form = inventoryForm(3, async (url, options) => {
      if (++attempt === 2) throw new Error('Simulated connection failure');
      return ok(url, options.method, JSON.parse(options.body));
    });
    await form.context.saveBale();
    assert.equal((await fixture('inspect')).db.bales.length, 5);
    await form.context.saveBale();
    assert.equal((await fixture('inspect')).db.bales.length, 7, 'Retry added all three again, leaving four new bales instead of three');
  });
