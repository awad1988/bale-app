module.exports = function registerCustomerStatementRoutes(ctx) {
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;
  const crypto = require('crypto');

  const ITALIAN_BATCH = 'ITALIAN-SALE-2026-09-09-V1';
  const ITALIAN_LINES = [
    { name:'JOGGING WCR', grade:'Cream', weight:25, quantity:10, line_total_jod:1875 },
    { name:'MEDIUM RUMMAGE WCR', grade:'Cream', weight:25, quantity:12, line_total_jod:2250 },
    { name:'HOODED WCR', grade:'Cream', weight:25, quantity:6, line_total_jod:1125 },
    { name:'LADY WINTER DRESS WCR', grade:'Cream', weight:25, quantity:5, line_total_jod:925 },
    { name:'MEN ANORAK WCR', grade:'Cream', weight:20, quantity:7, line_total_jod:1050 },
    { name:'MEN WINTER SHIRT WCR', grade:'Cream', weight:25, quantity:1, line_total_jod:185 },
    { name:'LOC WCR', grade:'Cream', weight:20, quantity:4, line_total_jod:600 },
    { name:'BOY ANORAK WCR', grade:'Cream', weight:20, quantity:7, line_total_jod:1050 },
    { name:'LADY ANORAK WCR', grade:'Cream', weight:20, quantity:3, line_total_jod:450 },
    { name:'LADY WINTER SKIRT WCR', grade:'Cream', weight:40, quantity:4, line_total_jod:1200 },
    { name:'LADY FLANNEL BLOUSE WCR', grade:'Cream', weight:25, quantity:3, line_total_jod:560 },
    { name:'LADY WINTER ABAYA', grade:'A', weight:25, quantity:5, line_total_jod:1250 },
    { name:'LADY WINTER BLOUSE WCR', grade:'Cream', weight:25, quantity:5, line_total_jod:625 },
    { name:'BODY T SHIRT L/S WCR', grade:'Cream', weight:25, quantity:5, line_total_jod:625 },
    { name:'BABY ANORAK 40KG', grade:'A', weight:40, quantity:4, line_total_jod:640 },
    { name:'BOY ANORAK EX', grade:'A', weight:40, quantity:4, line_total_jod:640 },
    { name:'CHILDREN HOODED', grade:'A', weight:40, quantity:8, line_total_jod:1200 },
    { name:'LRC JACKET EX', grade:'A', weight:40, quantity:2, line_total_jod:260 },
    { name:'LADY LONG FASHION WINTER JACKET', grade:'A', weight:40, quantity:3, line_total_jod:450 },
    { name:'MIX CROP TOP HOODED', grade:'A', weight:40, quantity:2, line_total_jod:300 },
    { name:'DUBLANKA JACKET EX', grade:'A', weight:40, quantity:4, line_total_jod:560 },
    { name:'FARU JACKET EX', grade:'A', weight:40, quantity:4, line_total_jod:560 },
    { name:'LEGGING PREMIUM', grade:'A', weight:40, quantity:2, line_total_jod:320 },
    { name:'OVERALL FLEECE', grade:'A', weight:40, quantity:4, line_total_jod:400 }
  ];

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

  function stableUuid(value) {
    const chars = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32).split('');
    chars[12] = '5';
    chars[16] = ((parseInt(chars[16], 16) & 3) | 8).toString(16);
    const hex = chars.join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }

  function saleBatch(notes) {
    const match = String(notes || '').match(/\[SALE_BATCH:([^\]]+)\]/i);
    return match ? String(match[1]) : '';
  }

  function branchId(status) {
    const match = String(status || '').match(/\[BRANCH:(\d+)\]/i);
    return match ? Number(match[1]) : 2;
  }

  async function paymentById(id) {
    const rows = await supabaseRequest('payments?select=id,customer_id,amount&id=eq.' + encodeURIComponent(id) + '&limit=1');
    return Array.isArray(rows) ? rows[0] : null;
  }

  async function restoreBales(rows) {
    const byStatus = new Map();
    for (const bale of rows) {
      const status = '[BRANCH:' + branchId(bale.status) + '] متوفر';
      const list = byStatus.get(status) || [];
      list.push(bale);
      byStatus.set(status, list);
    }
    for (const [status, bales] of byStatus.entries()) {
      for (let i = 0; i < bales.length; i += 35) {
        const ids = bales.slice(i, i + 35).map(x => x.id).join(',');
        await supabaseRequest('bales?id=in.(' + ids + ')', {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status })
        });
      }
    }
  }

  function parseSaleLines(notes) {
    const text = String(notes || '');
    if (text.includes('[SALE_BATCH:' + ITALIAN_BATCH + ']')) {
      return ITALIAN_LINES.map(x => ({ ...x }));
    }

    const marker = 'الأصناف:';
    const idx = text.indexOf(marker);
    if (idx === -1) return [];
    const tail = text.slice(idx + marker.length).trim();
    if (!tail) return [];
    return tail.split('||').map(part => {
      const bits = part.split('|').map(x => x.trim()).filter(Boolean);
      const name = bits[0] || '';
      let grade = '', weight = 0, quantity = 0, lineTotal = 0;
      for (const b of bits.slice(1)) {
        if (/^عدد\s+/i.test(b)) quantity = Number((b.match(/\d+(?:\.\d+)?/) || [0])[0]);
        else if (/^اجمالي\s+/i.test(b) || /^إجمالي\s+/i.test(b)) lineTotal = Number((b.match(/\d+(?:\.\d+)?/) || [0])[0]);
        else if (/كغ|kg/i.test(b)) weight = Number((b.match(/\d+(?:\.\d+)?/) || [0])[0]);
        else if (!grade) grade = b;
      }
      return { name, grade, weight, quantity, line_total_jod: lineTotal };
    }).filter(x => x.name || x.quantity || x.line_total_jod);
  }

  app.get('/api/v6/customers/:id/statement', async function(req, res) {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) throw new Error('رقم الزبون غير صالح.');
      const [customers, sales, payments, cashReturns] = await Promise.all([
        fetchAll('customers?select=id,name,phone,debt,created_at&id=eq.' + encodeURIComponent(id)),
        fetchAll('sales?select=id,customer_id,total_jod,notes,sale_date,created_at&customer_id=eq.' + encodeURIComponent(id) + '&order=created_at.asc'),
        fetchAll('payments?select=id,customer_id,amount,paid_at&customer_id=eq.' + encodeURIComponent(id) + '&order=paid_at.asc'),
        fetchAll('cash_movements?select=id,amount,movement_date,reference_id,notes&reference_type=eq.sale_return&order=movement_date.asc')
      ]);
      const customer = customers[0];
      if (!customer) throw new Error('الزبون غير موجود.');

      const totalSales = sales.reduce((s,x)=>s+Number(x.total_jod||0),0);
      const saleById = new Map(sales.map(s=>[String(s.id),s]));
      const returnPaymentToSale = new Map(sales.map(s=>[stableUuid('return-credit|' + s.id),String(s.id)]));
      const returnPayments = payments.filter(p=>returnPaymentToSale.has(String(p.id)));
      const regularPayments = payments.filter(p=>!returnPaymentToSale.has(String(p.id)));
      const customerCashReturns = cashReturns.filter(x=>saleById.has(String(x.reference_id)));
      const cashReturnBySale = new Map(customerCashReturns.map(x=>[String(x.reference_id),x]));
      const returnPaymentBySale = new Map(returnPayments.map(p=>[returnPaymentToSale.get(String(p.id)),p]));
      const returnedSaleIds = new Set([...cashReturnBySale.keys(),...returnPaymentBySale.keys()]);
      const totalPayments = regularPayments.reduce((s,x)=>s+Number(x.amount||0),0);
      const totalReturnCredit = returnPayments.reduce((s,x)=>s+Number(x.amount||0),0);
      const totalReturns = [...returnedSaleIds].reduce((sum,saleId)=>sum+Number(saleById.get(saleId)?.total_jod||0),0);
      const currentDebt = Number(customer.debt||0);
      const openingDebt = currentDebt - totalSales + totalPayments + totalReturnCredit;

      const movements = [];
      for (const s of sales) {
        movements.push({
          id: s.id,
          type: 'sale',
          date: s.sale_date || s.created_at || null,
          created_at: s.created_at || s.sale_date || null,
          amount: Number(s.total_jod||0),
          notes: s.notes || '',
          lines: parseSaleLines(s.notes),
          returned: returnedSaleIds.has(String(s.id)),
          can_reverse: !!saleBatch(s.notes) &&
            !returnedSaleIds.has(String(s.id))
        });
      }
      for (const p of regularPayments) {
        movements.push({
          id: p.id,
          type: 'payment',
          date: p.paid_at || null,
          created_at: p.paid_at || null,
          amount: Number(p.amount||0),
          notes: '',
          lines: []
        });
      }
      for (const saleId of returnedSaleIds) {
        const original = saleById.get(String(saleId));
        if (!original) continue;
        const credit = returnPaymentBySale.get(String(saleId));
        const cash = cashReturnBySale.get(String(saleId));
        movements.push({
          id: 'return-' + saleId,
          type: 'return',
          date: credit?.paid_at || cash?.movement_date || null,
          created_at: credit?.paid_at || cash?.movement_date || null,
          amount: Number(credit?.amount || 0),
          returned_total: Number(original.total_jod || 0),
          cash_refund: Number(cash?.amount || 0),
          notes: cash?.notes || 'مرتجع مبيعة',
          lines: parseSaleLines(original.notes)
        });
      }
      movements.sort((a,b)=>new Date(a.created_at||a.date||0)-new Date(b.created_at||b.date||0));
      let running = openingDebt;
      for (const m of movements) {
        if (m.type === 'sale') running += m.amount;
        else running -= m.amount;
        m.balance_after = running;
      }

      res.set && res.set('Cache-Control','no-store');
      res.json({
        ok: true,
        customer: { id: customer.id, name: customer.name, phone: customer.phone || '', current_debt: currentDebt },
        opening_debt: openingDebt,
        total_sales: totalSales,
        total_payments: totalPayments,
        total_returns: totalReturns,
        movements: movements.slice().reverse()
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/v6/sales/:id/reverse', async function(req, res) {
    const saleId = String(req.params.id || '').trim();
    try {
      if (!saleId) throw new Error('رقم المبيعة غير صالح.');
      const sales = await fetchAll('sales?select=id,customer_id,total_jod,notes&id=eq.' + encodeURIComponent(saleId));
      const sale = sales[0];
      if (!sale) throw new Error('المبيعة غير موجودة.');

      const batchId = saleBatch(sale.notes);
      if (!batchId) throw new Error('هذه المبيعة قديمة وغير مرتبطة ببالات؛ لا يمكن عكسها تلقائيًا.');
      const originalPaymentId = stableUuid('payment|' + batchId);
      const originalPayment = await paymentById(originalPaymentId);
      const saleAmount = Math.abs(Number(sale.total_jod || 0));
      const paidAmount = Math.min(saleAmount,Math.max(0,Number(originalPayment?.amount || 0)));
      const creditAmount = Math.max(0,saleAmount-paidAmount);
      const returnPaymentId = stableUuid('return-credit|' + saleId);
      const existingCredit = await paymentById(returnPaymentId);
      const existingCash = await fetchAll('cash_movements?select=id,amount&reference_type=eq.sale_return&reference_id=eq.' + encodeURIComponent(saleId));
      const alreadyReturned = (!creditAmount || !!existingCredit) && (!paidAmount || existingCash.length>0);

      if (creditAmount > 0 && !existingCredit) {
        await supabaseRequest('rpc/record_payment', {
          method: 'POST',
          body: JSON.stringify({
            p_id: returnPaymentId,
            p_customer_id: Number(sale.customer_id),
            p_amount: creditAmount
          })
        });
      }

      if (paidAmount > 0 && !existingCash.length) {
        await supabaseRequest('cash_movements', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            movement_type: 'out',
            amount: paidAmount,
            movement_date: new Date().toISOString().slice(0,10),
            reference_type: 'sale_return',
            reference_id: saleId,
            notes: '[RETURN_OF:' + saleId + '] رد نقدي لمرتجع مبيعة'
          })
        });
      }

      const taggedBales = await fetchAll('bales?select=id,status&status=like.' + encodeURIComponent('*[SALE_BATCH:' + batchId + ']*'));
      if (taggedBales.length) await restoreBales(taggedBales);

      const customers = await fetchAll('customers?select=id,name,debt&id=eq.' + encodeURIComponent(sale.customer_id));
      const customer = customers[0] || {};
      res.json({
        ok: true,
        already_reversed: alreadyReturned,
        restored_bales: taggedBales.length,
        returned_total: saleAmount,
        debt_credit: creditAmount,
        cash_refund: paidAmount,
        customer_id: sale.customer_id,
        customer: customer.name || '',
        debt: Number(customer.debt || 0)
      });
    } catch (e) {
      res.status(400).json({ error: e.message, retry_safe: true });
    }
  });
};
