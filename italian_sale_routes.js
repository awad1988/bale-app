module.exports = function registerItalianSaleRoutes(ctx) {
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;

  const BATCH = 'ITALIAN-SALE-2026-09-09-V1';
  const SALE_ID = '91090919-0600-4a11-9000-000000000114';
  const TOTAL_JOD = 19060;
  const TARGET_CUSTOMER = 'حمودة الايطالي';

  const ITEMS = [
    { name: 'JOGGING WCR', grade: 'Cream', weight: 25, qty: 10, amount: 1875 },
    { name: 'MEDIUM RUMMAGE WCR', grade: 'Cream', weight: 25, qty: 12, amount: 2250 },
    { name: 'HOODED WCR', grade: 'Cream', weight: 25, qty: 6, amount: 1125 },
    { name: 'LADY WINTER DRESS WCR', grade: 'Cream', weight: 25, qty: 5, amount: 925 },
    { name: 'MEN ANORAK WCR', grade: 'Cream', weight: 20, qty: 7, amount: 1050 },
    { name: 'MEN WINTER SHIRT WCR', grade: 'Cream', weight: 25, qty: 1, amount: 185 },
    { name: 'LOC WCR', grade: 'Cream', weight: 20, qty: 4, amount: 600 },
    { name: 'BOY ANORAK WCR', grade: 'Cream', weight: 20, qty: 7, amount: 1050 },
    { name: 'LADY ANORAK WCR', grade: 'Cream', weight: 20, qty: 3, amount: 450 },
    { name: 'LADY WINTER SKIRT WCR', grade: 'Cream', weight: 40, qty: 4, amount: 1200 },
    { name: 'LADY FLANNEL BLOUSE WCR', grade: 'Cream', weight: 25, qty: 3, amount: 560 },
    { name: 'LADY WINTER ABAYA', grade: 'A', weight: 25, qty: 5, amount: 1250 },
    { name: 'LADY WINTER BLOUSE WCR', grade: 'Cream', weight: 25, qty: 5, amount: 625 },
    { name: 'BODY T SHIRT L/S WCR', grade: 'Cream', weight: 25, qty: 5, amount: 625 },
    { name: 'BABY ANORAK 40KG', grade: 'A', weight: 40, qty: 4, amount: 640 },
    { name: 'BOY ANORAK EX', grade: 'A', weight: 40, qty: 4, amount: 640 },
    { name: 'CHILDREN HOODED', grade: 'A', weight: 40, qty: 8, amount: 1200 },
    { name: 'LRC JACKET EX', grade: 'A', weight: 40, qty: 2, amount: 260 },
    { name: 'LADY LONG FASHION WINTER JACKET', grade: 'A', weight: 40, qty: 3, amount: 450 },
    { name: 'MIX CROP TOP HOODED', grade: 'A', weight: 40, qty: 2, amount: 300 },
    { name: 'DUBLANKA JACKET EX', grade: 'A', weight: 40, qty: 4, amount: 560 },
    { name: 'FARU JACKET EX', grade: 'A', weight: 40, qty: 4, amount: 560 },
    { name: 'LEGGING PREMIUM', grade: 'A', weight: 40, qty: 2, amount: 320 },
    { name: 'OVERALL FLEECE', grade: 'A', weight: 40, qty: 4, amount: 400 }
  ];

  function norm(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[ـ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^A-Z0-9\u0600-\u06FF]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normGrade(value) {
    const g = norm(value);
    if (['CREAM', 'CREME', 'CRÈME', 'كريم'].map(norm).includes(g)) return 'CREAM';
    return g;
  }

  function itemKey(name, grade, weight) {
    return [norm(name), normGrade(grade), Number(weight || 0)].join('|');
  }

  function baleKey(b) {
    return itemKey(b.name_en || b.name_ar || '', b.grade, b.weight);
  }

  async function fetchAll(basePath) {
    const out = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 100000; offset += pageSize) {
      const sep = basePath.includes('?') ? '&' : '?';
      const page = await supabaseRequest(basePath + sep + 'limit=' + pageSize + '&offset=' + offset);
      const rows = Array.isArray(page) ? page : [];
      out.push(...rows);
      if (rows.length < pageSize) break;
    }
    return out;
  }

  function isBranch2(b) {
    const s = String(b.status || '');
    return /\[BRANCH:2\]/i.test(s) || !/\[BRANCH:\d+\]/i.test(s);
  }

  function isSold(b) {
    return /مباع/i.test(String(b.status || ''));
  }

  function isThisBatch(b) {
    return String(b.status || '').includes('[SALE_BATCH:' + BATCH + ']');
  }

  async function snapshot() {
    const [customers, bales, sales] = await Promise.all([
      fetchAll('customers?select=id,name,debt'),
      fetchAll('bales?select=id,name_en,name_ar,grade,weight,status,created_at&order=created_at.asc'),
      fetchAll('sales?select=id,customer_id,total_jod,notes,created_at')
    ]);

    const targetNorm = norm(TARGET_CUSTOMER);
    const customer = customers.find(c => norm(c.name) === targetNorm) ||
      customers.find(c => norm(c.name).includes('حموده') && norm(c.name).includes('الايطالي'));
    if (!customer) throw new Error('لم أجد حساب حمودة الإيطالي في الزبائن.');

    const existingSale = sales.find(s => String(s.notes || '').includes('[SALE_BATCH:' + BATCH + ']')) || null;
    return { customer, bales, existingSale };
  }

  function buildPlan(bales) {
    const availableByKey = new Map();
    const batchByKey = new Map();

    for (const b of bales) {
      if (!isBranch2(b)) continue;
      const key = baleKey(b);
      if (isThisBatch(b)) {
        const a = batchByKey.get(key) || [];
        a.push(b); batchByKey.set(key, a);
      } else if (!isSold(b)) {
        const a = availableByKey.get(key) || [];
        a.push(b); availableByKey.set(key, a);
      }
    }

    const lines = [];
    const toMark = [];
    let ok = true;

    for (const item of ITEMS) {
      const key = itemKey(item.name, item.grade, item.weight);
      const already = batchByKey.get(key) || [];
      const available = availableByKey.get(key) || [];
      const remaining = Math.max(0, item.qty - already.length);
      const canSupply = already.length + available.length >= item.qty;
      if (!canSupply) ok = false;
      toMark.push(...available.slice(0, remaining));
      lines.push({
        name: item.name,
        grade: item.grade,
        weight: item.weight,
        qty: item.qty,
        amount: item.amount,
        already_marked: already.length,
        available: available.length,
        remaining_to_mark: remaining,
        ok: canSupply
      });
    }

    return { ok, lines, toMark };
  }

  function invoiceNotes() {
    const short = ITEMS.map(x => x.name + ' x' + x.qty).join(' | ');
    return '[SALE_BATCH:' + BATCH + '] مبيعة حمودة الإيطالي آجل بالكامل، 114 بالة، إجمالي 19060 د.أ، مدفوع 0. ' + short;
  }

  app.get('/api/v2/sales/italian-2026-09-09/preview', async function (_req, res) {
    try {
      const s = await snapshot();
      const plan = buildPlan(s.bales);
      const qty = ITEMS.reduce((a, x) => a + x.qty, 0);
      const amount = ITEMS.reduce((a, x) => a + x.amount, 0);
      res.set && res.set('Cache-Control', 'no-store');
      res.json({
        ok: plan.ok && qty === 114 && amount === TOTAL_JOD,
        batch_id: BATCH,
        customer: { id: s.customer.id, name: s.customer.name, current_debt: Number(s.customer.debt || 0) },
        already_recorded: !!s.existingSale,
        total_qty: qty,
        total_jod: amount,
        expected_debt_after: s.existingSale ? Number(s.customer.debt || 0) : Number(s.customer.debt || 0) + TOTAL_JOD,
        lines: plan.lines
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/v2/sales/italian-2026-09-09/commit', async function (_req, res) {
    try {
      const s = await snapshot();
      const plan = buildPlan(s.bales);
      const qty = ITEMS.reduce((a, x) => a + x.qty, 0);
      const amount = ITEMS.reduce((a, x) => a + x.amount, 0);
      if (qty !== 114 || amount !== TOTAL_JOD) throw new Error('أرقام الفاتورة الداخلية غير مطابقة للاعتماد.');
      if (!plan.ok) {
        const bad = plan.lines.filter(x => !x.ok).map(x => x.name + ': المطلوب ' + x.qty + ' والمتاح ' + (x.already_marked + x.available));
        throw new Error('المخزون غير كافٍ لبعض الأصناف: ' + bad.join(' | '));
      }

      if (!s.existingSale) {
        await supabaseRequest('rpc/record_sale', {
          method: 'POST',
          body: JSON.stringify({
            p_id: SALE_ID,
            p_customer_id: Number(s.customer.id),
            p_amount: TOTAL_JOD,
            p_notes: invoiceNotes()
          })
        });
      }

      const chunks = [];
      for (let i = 0; i < plan.toMark.length; i += 35) chunks.push(plan.toMark.slice(i, i + 35));
      for (const chunk of chunks) {
        if (!chunk.length) continue;
        const ids = chunk.map(b => b.id).join(',');
        await supabaseRequest('bales?id=in.(' + ids + ')', {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: '[BRANCH:2] مباع [SALE_BATCH:' + BATCH + ']' })
        });
      }

      const after = await snapshot();
      const afterPlan = buildPlan(after.bales);
      const marked = after.bales.filter(isThisBatch).length;
      res.json({
        ok: afterPlan.lines.every(x => x.already_marked >= x.qty),
        already_recorded: !!s.existingSale,
        customer: after.customer.name,
        debt: Number(after.customer.debt || 0),
        total_qty: qty,
        marked_bales: marked,
        total_jod: TOTAL_JOD
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
};
