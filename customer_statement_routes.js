module.exports = function registerCustomerStatementRoutes(ctx) {
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;

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
      const [customers, sales, payments] = await Promise.all([
        fetchAll('customers?select=id,name,phone,debt,created_at&id=eq.' + encodeURIComponent(id)),
        fetchAll('sales?select=id,customer_id,total_jod,notes,sale_date,created_at&customer_id=eq.' + encodeURIComponent(id) + '&order=created_at.asc'),
        fetchAll('payments?select=id,customer_id,amount,paid_at&customer_id=eq.' + encodeURIComponent(id) + '&order=paid_at.asc')
      ]);
      const customer = customers[0];
      if (!customer) throw new Error('الزبون غير موجود.');

      const totalSales = sales.reduce((s,x)=>s+Number(x.total_jod||0),0);
      const totalPayments = payments.reduce((s,x)=>s+Number(x.amount||0),0);
      const currentDebt = Number(customer.debt||0);
      const openingDebt = currentDebt - totalSales + totalPayments;

      const movements = [];
      for (const s of sales) {
        movements.push({
          id: s.id,
          type: 'sale',
          date: s.sale_date || s.created_at || null,
          created_at: s.created_at || s.sale_date || null,
          amount: Number(s.total_jod||0),
          notes: s.notes || '',
          lines: parseSaleLines(s.notes)
        });
      }
      for (const p of payments) {
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
        movements: movements.slice().reverse()
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
};
