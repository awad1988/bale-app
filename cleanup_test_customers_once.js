module.exports = function registerCleanupTestCustomers(ctx) {
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;
  const TARGET_NAMES = new Set(['تجريبي', 'تجريبي وكيل']);

  function branchId(status) {
    const m = String(status || '').match(/\[BRANCH:(\d+)\]/i);
    return m ? Number(m[1]) : 2;
  }

  function saleBatch(notes) {
    const m = String(notes || '').match(/\[SALE_BATCH:([^\]]+)\]/i);
    return m ? String(m[1]) : '';
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

  async function restoreBalesForSale(sale) {
    const seen = new Set();
    const rows = [];
    const batch = saleBatch(sale.notes);
    if (batch) {
      const sold = await fetchAll('bales?select=id,status&status=like.' + encodeURIComponent('*[SALE_BATCH:' + batch + ']*'));
      for (const b of sold) if (!seen.has(String(b.id))) { seen.add(String(b.id)); rows.push(b); }
    }
    const returned = await fetchAll('bales?select=id,status&status=like.' + encodeURIComponent('*[RETURN_OF:' + sale.id + ']*'));
    for (const b of returned) if (!seen.has(String(b.id))) { seen.add(String(b.id)); rows.push(b); }

    for (const b of rows) {
      await supabaseRequest('bales?id=eq.' + encodeURIComponent(b.id), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: '[BRANCH:' + branchId(b.status) + '] متوفر' })
      });
    }
    return rows.length;
  }

  async function cleanup() {
    const customers = await fetchAll('customers?select=id,name,debt,created_at&order=created_at.asc');
    const targets = customers.filter(c => TARGET_NAMES.has(String(c.name || '').trim()));
    const summary = { customers: [], restored_bales: 0, deleted_sales: 0, deleted_payments: 0, deleted_cash_movements: 0 };

    for (const customer of targets) {
      const customerId = String(customer.id);
      const sales = await fetchAll('sales?select=id,customer_id,total_jod,notes,created_at&customer_id=eq.' + encodeURIComponent(customerId));

      for (const sale of sales) {
        summary.restored_bales += await restoreBalesForSale(sale);
        const cashRows = await fetchAll('cash_movements?select=id,reference_id,reference_type&reference_id=eq.' + encodeURIComponent(sale.id));
        for (const row of cashRows) {
          await supabaseRequest('cash_movements?id=eq.' + encodeURIComponent(row.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
          summary.deleted_cash_movements += 1;
        }
      }

      const payments = await fetchAll('payments?select=id,customer_id&customer_id=eq.' + encodeURIComponent(customerId));
      for (const p of payments) {
        await supabaseRequest('payments?id=eq.' + encodeURIComponent(p.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        summary.deleted_payments += 1;
      }

      for (const sale of sales) {
        await supabaseRequest('sales?id=eq.' + encodeURIComponent(sale.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        summary.deleted_sales += 1;
      }

      await supabaseRequest('customers?id=eq.' + encodeURIComponent(customer.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      summary.customers.push({ id: customer.id, name: customer.name });
    }

    return summary;
  }

  app.get('/cleanup-test-customers', (_req, res) => {
    res.type('html').send(`<!doctype html><html lang="ar" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:24px;max-width:640px;margin:auto"><h2>تنظيف الحسابات التجريبية</h2><p>سيتم حذف <b>تجريبي</b> و<b>تجريبي وكيل</b> فقط، مع إعادة كل بالاتهم للمخزون. لن يتم لمس حساب الإيطالي.</p><button id="go" style="font-size:18px;padding:14px 20px">تأكيد الحذف</button><pre id="out" style="white-space:pre-wrap"></pre><script>document.getElementById('go').onclick=async()=>{if(!confirm('تأكيد حذف الحسابين التجريبيين وإعادة بالاتهم للمخزون؟'))return;const r=await fetch('/api/admin/cleanup-test-customers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'DELETE_TEST_CUSTOMERS_ONLY'})});document.getElementById('out').textContent=JSON.stringify(await r.json(),null,2);};</script></body></html>`);
  });

  app.post('/api/admin/cleanup-test-customers', async (req, res) => {
    try {
      if (String(req.body?.confirm || '') !== 'DELETE_TEST_CUSTOMERS_ONLY') {
        return res.status(400).json({ error: 'التأكيد غير صحيح.' });
      }
      const summary = await cleanup();
      res.json({ ok: true, ...summary });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
};
