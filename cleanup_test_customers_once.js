module.exports = function registerCleanupTestCustomersOnce(ctx) {
  const supabaseRequest = ctx.supabaseRequest;
  const TARGET_NAMES = new Set(['تجريبي', 'تجريبي وكيل']);
  let started = false;

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

  async function runCleanup() {
    if (started) return;
    started = true;
    try {
      const customers = await fetchAll('customers?select=id,name,debt,created_at&order=created_at.asc');
      const targets = customers.filter(c => TARGET_NAMES.has(String(c.name || '').trim()));
      if (!targets.length) {
        console.log('[cleanup-test-customers] no target customers found; nothing to do');
        return;
      }

      let restored = 0;
      let deletedSales = 0;
      let deletedPayments = 0;
      let deletedCash = 0;

      for (const customer of targets) {
        const customerId = String(customer.id);
        const sales = await fetchAll('sales?select=id,customer_id,total_jod,notes,created_at&customer_id=eq.' + encodeURIComponent(customerId));

        for (const sale of sales) {
          restored += await restoreBalesForSale(sale);
          const cashRows = await fetchAll('cash_movements?select=id,reference_id,reference_type&reference_id=eq.' + encodeURIComponent(sale.id));
          for (const row of cashRows) {
            await supabaseRequest('cash_movements?id=eq.' + encodeURIComponent(row.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
            deletedCash += 1;
          }
        }

        const payments = await fetchAll('payments?select=id,customer_id&customer_id=eq.' + encodeURIComponent(customerId));
        for (const p of payments) {
          await supabaseRequest('payments?id=eq.' + encodeURIComponent(p.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
          deletedPayments += 1;
        }

        for (const sale of sales) {
          await supabaseRequest('sales?id=eq.' + encodeURIComponent(sale.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
          deletedSales += 1;
        }

        await supabaseRequest('customers?id=eq.' + encodeURIComponent(customer.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      }

      console.log('[cleanup-test-customers] done', {
        customers: targets.map(x => ({ id: x.id, name: x.name })),
        restored_bales: restored,
        deleted_sales: deletedSales,
        deleted_payments: deletedPayments,
        deleted_cash_movements: deletedCash
      });
    } catch (e) {
      console.error('[cleanup-test-customers] failed:', e && e.message ? e.message : e);
    }
  }

  setTimeout(runCleanup, 1500);
};
