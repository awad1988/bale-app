const crypto = require('crypto');

module.exports = function registerGenericSalesRoutes(ctx) {
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;

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
    if (g === 'B') return 'B';
    return 'A';
  }

  function branchId(status) {
    const m = String(status || '').match(/\[BRANCH:(\d+)\]/i);
    return m ? Number(m[1]) : 2;
  }

  function isSold(status) {
    return /مباع/i.test(String(status || ''));
  }

  function productKey(bale, season) {
    return [norm(bale.name_en || bale.name_ar || ''), normGrade(bale.grade), Number(bale.weight || 0), norm(season || 'شتوي')].join('|');
  }

  function stableUuid(value) {
    const chars = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32).split('');
    chars[12] = '5';
    chars[16] = ((parseInt(chars[16], 16) & 3) | 8).toString(16);
    const hex = chars.join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
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

  async function snapshot() {
    const [shipments, bales, customers, sales] = await Promise.all([
      fetchAll('shipments?select=id,season'),
      fetchAll('bales?select=id,shipment_id,name_en,name_ar,grade,weight,buy_usd,status,created_at&order=created_at.asc'),
      fetchAll('customers?select=id,name,debt,created_at&created_at=gt.2026-09-04T18%3A35%3A00Z&order=created_at.asc'),
      fetchAll('sales?select=id,customer_id,total_jod,notes,created_at')
    ]);
    return { shipments, bales, customers, sales };
  }

  function catalogFrom(snapshot) {
    const shipMap = new Map(snapshot.shipments.map(s => [String(s.id), s]));
    const groups = new Map();
    for (const b of snapshot.bales) {
      if (isSold(b.status)) continue;
      const season = shipMap.get(String(b.shipment_id))?.season || 'شتوي';
      const key = productKey(b, season);
      const br = branchId(b.status);
      const id = stableUuid('sale-product|' + br + '|' + key);
      let g = groups.get(id);
      if (!g) {
        g = { id, key, branch_id: br, name_en: b.name_en || '', name_ar: b.name_ar || '', grade: normGrade(b.grade) === 'CREAM' ? 'Cream' : normGrade(b.grade), weight: Number(b.weight || 0), season, quantity: 0 };
        groups.set(id, g);
      }
      g.quantity += 1;
    }
    return [...groups.values()].sort((a,b) => (a.name_ar || a.name_en).localeCompare(b.name_ar || b.name_en, 'ar'));
  }

  function validateInput(input, catalog) {
    const customerId = String(input.customer_id || '').trim();
    const batchId = String(input.batch_id || '').trim();
    const lines = Array.isArray(input.lines) ? input.lines : [];
    const paid = Number(input.paid_now || 0);
    if (!customerId) throw new Error('اختر الزبون.');
    if (!batchId || !/^[A-Za-z0-9_-]{8,100}$/.test(batchId)) throw new Error('معرّف المبيعة غير صالح.');
    if (!lines.length || lines.length > 80) throw new Error('أضف صنفًا واحدًا على الأقل.');
    const byId = new Map(catalog.map(x => [String(x.id), x]));
    const merged = new Map();
    for (const raw of lines) {
      const product = byId.get(String(raw.product_id || ''));
      const qty = Number(raw.quantity || 0);
      const amount = Number(raw.line_total_jod || 0);
      if (!product) throw new Error('أحد الأصناف غير موجود في المخزون الحالي.');
      if (!Number.isInteger(qty) || qty <= 0) throw new Error('كمية غير صحيحة للصنف ' + (product.name_ar || product.name_en));
      if (!(amount > 0)) throw new Error('إجمالي بيع الصنف يجب أن يكون أكبر من صفر.');
      const current = merged.get(product.id) || { product, quantity: 0, line_total_jod: 0 };
      current.quantity += qty;
      current.line_total_jod += amount;
      merged.set(product.id, current);
    }
    const finalLines = [...merged.values()];
    for (const x of finalLines) {
      if (x.quantity > x.product.quantity) throw new Error((x.product.name_ar || x.product.name_en) + ': المطلوب ' + x.quantity + ' والمتاح ' + x.product.quantity + ' فقط.');
    }
    const total = finalLines.reduce((s,x)=>s+x.line_total_jod,0);
    if (paid < 0 || paid > total) throw new Error('المبلغ المدفوع الآن غير صحيح.');
    return { customerId, batchId, lines: finalLines, total, paid };
  }

  app.get('/api/v4/sales/catalog', async function (_req, res) {
    try {
      const s = await snapshot();
      res.set && res.set('Cache-Control','no-store');
      res.json({ customers: s.customers.map(c=>({id:c.id,name:c.name,debt:Number(c.debt||0)})), products: catalogFrom(s) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/v4/sales/preview', async function (req, res) {
    try {
      const s = await snapshot();
      const catalog = catalogFrom(s);
      const v = validateInput(req.body || {}, catalog);
      const customer = s.customers.find(c => String(c.id) === v.customerId);
      if (!customer) throw new Error('الزبون غير موجود.');
      const noteTag = '[SALE_BATCH:' + v.batchId + ']';
      const existing = s.sales.find(x => String(x.notes || '').includes(noteTag));
      res.json({
        ok: true,
        already_recorded: !!existing,
        customer: { id: customer.id, name: customer.name, current_debt: Number(customer.debt || 0) },
        total_jod: v.total,
        paid_now: v.paid,
        credit_jod: v.total - v.paid,
        expected_debt_after: existing ? Number(customer.debt || 0) : Number(customer.debt || 0) + v.total - v.paid,
        total_qty: v.lines.reduce((s,x)=>s+x.quantity,0),
        lines: v.lines.map(x=>({ product_id:x.product.id, name_ar:x.product.name_ar, name_en:x.product.name_en, grade:x.product.grade, weight:x.product.weight, quantity:x.quantity, available:x.product.quantity, line_total_jod:x.line_total_jod }))
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/v4/sales/commit', async function (req, res) {
    try {
      const s = await snapshot();
      const catalog = catalogFrom(s);
      const v = validateInput(req.body || {}, catalog);
      const customer = s.customers.find(c => String(c.id) === v.customerId);
      if (!customer) throw new Error('الزبون غير موجود.');
      const noteTag = '[SALE_BATCH:' + v.batchId + ']';
      const existing = s.sales.find(x => String(x.notes || '').includes(noteTag));
      if (existing) return res.json({ ok:true, already_recorded:true, total_jod:v.total, paid_now:v.paid, customer:customer.name, debt:Number(customer.debt||0) });

      const shipMap = new Map(s.shipments.map(x => [String(x.id), x]));
      const selected = [];
      for (const line of v.lines) {
        const p = line.product;
        const matching = s.bales.filter(b => {
          if (isSold(b.status) || branchId(b.status) !== p.branch_id) return false;
          const season = shipMap.get(String(b.shipment_id))?.season || 'شتوي';
          return productKey(b, season) === p.key;
        });
        if (matching.length < line.quantity) throw new Error((p.name_ar || p.name_en) + ': الكمية تغيرت أثناء التسجيل. أعد الفحص.');
        selected.push(...matching.slice(0, line.quantity));
      }

      const saleId = stableUuid('sale|' + v.batchId);
      const notes = noteTag + ' بيع أصناف من المخزون • عدد ' + selected.length + ' بالة • إجمالي ' + v.total.toFixed(2) + ' د.أ • مدفوع الآن ' + v.paid.toFixed(2) + ' د.أ';
      await supabaseRequest('rpc/record_sale', {
        method:'POST',
        body:JSON.stringify({ p_id:saleId, p_customer_id:Number(customer.id), p_amount:v.total, p_notes:notes })
      });

      for (let i=0;i<selected.length;i+=35) {
        const ids = selected.slice(i,i+35).map(x=>x.id).join(',');
        await supabaseRequest('bales?id=in.(' + ids + ')', {
          method:'PATCH',
          headers:{ Prefer:'return=minimal' },
          body:JSON.stringify({ status:'[BRANCH:2] مباع ' + noteTag })
        });
      }

      if (v.paid > 0) {
        await supabaseRequest('rpc/record_payment', {
          method:'POST',
          body:JSON.stringify({ p_id:stableUuid('payment|' + v.batchId), p_customer_id:Number(customer.id), p_amount:v.paid })
        });
      }

      const afterCustomers = await fetchAll('customers?select=id,name,debt&id=eq.' + encodeURIComponent(customer.id));
      const after = afterCustomers[0] || customer;
      res.json({ ok:true, already_recorded:false, total_jod:v.total, paid_now:v.paid, total_qty:selected.length, customer:after.name, debt:Number(after.debt||0) });
    } catch (e) {
      res.status(400).json({ error:e.message, retry_safe:true });
    }
  });
};
