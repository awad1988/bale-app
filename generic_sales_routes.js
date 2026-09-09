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

  function batchFromStatus(status) {
    const m = String(status || '').match(/\[SALE_BATCH:([^\]]+)\]/i);
    return m ? String(m[1]) : '';
  }

  function isSold(status) {
    return /مباع/i.test(String(status || ''));
  }

  function isReserved(status) {
    return /محجوز/i.test(String(status || ''));
  }

  function usableForBatch(status, batchId) {
    const taggedBatch = batchFromStatus(status);
    if (taggedBatch && taggedBatch === batchId) return true;
    return !isSold(status) && !isReserved(status) && !taggedBatch;
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

  function catalogFrom(s, batchId) {
    const shipMap = new Map(s.shipments.map(x => [String(x.id), x]));
    const groups = new Map();
    for (const b of s.bales) {
      if (!usableForBatch(b.status, batchId || '')) continue;
      const season = shipMap.get(String(b.shipment_id))?.season || 'شتوي';
      const key = productKey(b, season);
      const br = branchId(b.status);
      const id = stableUuid('sale-product|' + br + '|' + key);
      let g = groups.get(id);
      if (!g) {
        g = {
          id,
          key,
          branch_id: br,
          name_en: b.name_en || '',
          name_ar: b.name_ar || '',
          grade: normGrade(b.grade) === 'CREAM' ? 'Cream' : normGrade(b.grade),
          weight: Number(b.weight || 0),
          season,
          quantity: 0
        };
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
      if (x.quantity > x.product.quantity) {
        throw new Error((x.product.name_ar || x.product.name_en) + ': المطلوب ' + x.quantity + ' والمتاح ' + x.product.quantity + ' فقط.');
      }
    }
    const total = finalLines.reduce((s,x)=>s+x.line_total_jod,0);
    if (paid < 0 || paid > total) throw new Error('المبلغ المدفوع الآن غير صحيح.');
    return { customerId, batchId, lines: finalLines, total, paid };
  }

  function lineDescription(line) {
    const p = line.product;
    return (p.name_ar || p.name_en || 'صنف') +
      ' | ' + p.grade +
      ' | ' + Number(p.weight || 0) + 'كغ' +
      ' | عدد ' + line.quantity +
      ' | إجمالي ' + Number(line.line_total_jod || 0).toFixed(2) + ' د.أ';
  }

  async function paymentExists(paymentId) {
    const rows = await supabaseRequest('payments?select=id&id=eq.' + encodeURIComponent(paymentId) + '&limit=1');
    return Array.isArray(rows) && rows.length > 0;
  }

  async function patchBalesStatus(bales, statusBuilder) {
    const byStatus = new Map();
    for (const bale of bales) {
      const nextStatus = statusBuilder(bale);
      const list = byStatus.get(nextStatus) || [];
      list.push(bale);
      byStatus.set(nextStatus, list);
    }
    for (const [status, rows] of byStatus.entries()) {
      for (let i = 0; i < rows.length; i += 35) {
        const ids = rows.slice(i, i + 35).map(x => x.id).join(',');
        await supabaseRequest('bales?id=in.(' + ids + ')', {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status })
        });
      }
    }
  }

  app.get('/api/v4/sales/catalog', async function (_req, res) {
    try {
      const s = await snapshot();
      res.set && res.set('Cache-Control','no-store');
      res.json({
        customers: s.customers.map(c=>({id:c.id,name:c.name,debt:Number(c.debt||0)})),
        products: catalogFrom(s, '')
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/v4/sales/preview', async function (req, res) {
    try {
      const input = req.body || {};
      const batchId = String(input.batch_id || '').trim();
      const s = await snapshot();
      const catalog = catalogFrom(s, batchId);
      const v = validateInput(input, catalog);
      const customer = s.customers.find(c => String(c.id) === v.customerId);
      if (!customer) throw new Error('الزبون غير موجود.');

      const noteTag = '[SALE_BATCH:' + v.batchId + ']';
      const saleId = stableUuid('sale|' + v.batchId);
      const paymentId = stableUuid('payment|' + v.batchId);
      const existingSale = s.sales.find(x => String(x.id) === saleId || String(x.notes || '').includes(noteTag));
      const existingPayment = v.paid > 0 ? await paymentExists(paymentId) : true;
      const reservedCount = s.bales.filter(b => batchFromStatus(b.status) === v.batchId).length;

      let expectedDebtAfter = Number(customer.debt || 0);
      if (!existingSale) expectedDebtAfter += v.total;
      if (v.paid > 0 && !existingPayment) expectedDebtAfter -= v.paid;

      res.json({
        ok: true,
        already_recorded: !!existingSale && existingPayment && reservedCount >= v.lines.reduce((sum,x)=>sum+x.quantity,0),
        in_progress: reservedCount > 0 || !!existingSale || !existingPayment,
        customer: { id: customer.id, name: customer.name, current_debt: Number(customer.debt || 0) },
        total_jod: v.total,
        paid_now: v.paid,
        credit_jod: v.total - v.paid,
        expected_debt_after: expectedDebtAfter,
        total_qty: v.lines.reduce((sum,x)=>sum+x.quantity,0),
        lines: v.lines.map(x=>({
          product_id:x.product.id,
          name_ar:x.product.name_ar,
          name_en:x.product.name_en,
          grade:x.product.grade,
          weight:x.product.weight,
          quantity:x.quantity,
          available:x.product.quantity,
          line_total_jod:x.line_total_jod
        }))
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/v4/sales/commit', async function (req, res) {
    const input = req.body || {};
    const batchId = String(input.batch_id || '').trim();
    const noteTag = '[SALE_BATCH:' + batchId + ']';

    try {
      let s = await snapshot();
      let catalog = catalogFrom(s, batchId);
      const v = validateInput(input, catalog);
      const customer = s.customers.find(c => String(c.id) === v.customerId);
      if (!customer) throw new Error('الزبون غير موجود.');

      const shipMap = new Map(s.shipments.map(x => [String(x.id), x]));
      const selected = [];
      const newlySelected = [];

      for (const line of v.lines) {
        const p = line.product;
        const tagged = [];
        const available = [];
        for (const b of s.bales) {
          if (branchId(b.status) !== p.branch_id) continue;
          const season = shipMap.get(String(b.shipment_id))?.season || 'شتوي';
          if (productKey(b, season) !== p.key) continue;
          const taggedBatch = batchFromStatus(b.status);
          if (taggedBatch === v.batchId) tagged.push(b);
          else if (usableForBatch(b.status, v.batchId)) available.push(b);
        }

        const already = tagged.slice(0, line.quantity);
        const needed = line.quantity - already.length;
        if (available.length < needed) {
          throw new Error((p.name_ar || p.name_en) + ': الكمية تغيرت أثناء التسجيل. أعد الفحص.');
        }
        const add = available.slice(0, needed);
        selected.push(...already, ...add);
        newlySelected.push(...add);
      }

      if (newlySelected.length) {
        await patchBalesStatus(newlySelected, bale => '[BRANCH:' + branchId(bale.status) + '] محجوز ' + noteTag);
      }

      s = await snapshot();
      const saleId = stableUuid('sale|' + v.batchId);
      const paymentId = stableUuid('payment|' + v.batchId);
      const existingSale = s.sales.find(x => String(x.id) === saleId || String(x.notes || '').includes(noteTag));

      if (!existingSale) {
        const details = v.lines.map(lineDescription).join(' || ');
        const notes = noteTag +
          ' بيع أصناف من المخزون' +
          ' • عدد ' + selected.length + ' بالة' +
          ' • إجمالي ' + v.total.toFixed(2) + ' د.أ' +
          ' • مدفوع الآن ' + v.paid.toFixed(2) + ' د.أ' +
          (String(input.notes || '').trim() ? ' • ملاحظة: ' + String(input.notes || '').trim() : '') +
          ' • الأصناف: ' + details;

        await supabaseRequest('rpc/record_sale', {
          method:'POST',
          body:JSON.stringify({
            p_id:saleId,
            p_customer_id:Number(customer.id),
            p_amount:v.total,
            p_notes:notes
          })
        });
      }

      if (v.paid > 0 && !(await paymentExists(paymentId))) {
        await supabaseRequest('rpc/record_payment', {
          method:'POST',
          body:JSON.stringify({
            p_id:paymentId,
            p_customer_id:Number(customer.id),
            p_amount:v.paid
          })
        });
      }

      const latestBales = await fetchAll('bales?select=id,status');
      const taggedBales = latestBales.filter(b => batchFromStatus(b.status) === v.batchId);
      if (taggedBales.length) {
        await patchBalesStatus(taggedBales, bale => '[BRANCH:' + branchId(bale.status) + '] مباع ' + noteTag);
      }

      const afterCustomers = await fetchAll('customers?select=id,name,debt&id=eq.' + encodeURIComponent(customer.id));
      const after = afterCustomers[0] || customer;
      res.json({
        ok:true,
        already_recorded: !!existingSale,
        total_jod:v.total,
        paid_now:v.paid,
        credit_jod:v.total-v.paid,
        total_qty:selected.length,
        customer:after.name,
        debt:Number(after.debt||0),
        cash_added:v.paid
      });
    } catch (e) {
      res.status(400).json({
        error:e.message,
        retry_safe:true,
        batch_id:batchId,
        note:'إذا انقطع الاتصال، أعد نفس المبيعة بنفس الشاشة؛ لن تتكرر العملية.'
      });
    }
  });
};
