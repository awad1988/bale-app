module.exports = function supplierAccountRoutes({ app, supabaseRequest }) {
  const MARKER = '[SUPPLIER_ACCOUNT_V1:';
  const SUPPLIER_NAME = 'NOVATEX INTERNATIONAL LTD FZE';

  const account = {
    currency: 'USD',
    openingBalance: 257601.21,
    currentBalance: 452656.21,
    totalPurchases: 295055.00,
    totalPayments: 100000.00,
    dueAed: 1661248.30,
    importedFrom: 'Statement of account dated through 2026-08-26',
    bank: {
      name: 'Mashreq Bank',
      branch: 'Ajman, UAE',
      swift: 'BOMLAEAD',
      usdIban: 'AE96 0330 0000 1094 8170 856',
      eurIban: 'AE31 0330 0000 1095 5080 366',
      aedIban: 'AE76 0330 0000 1099 5050 152'
    },
    entries: [
      { date: '2026-08-10', type: 'opening', amount: 257601.21, balance: 257601.21, notes: 'Starting balance' },
      { date: '2026-08-13', type: 'payment', amount: 50000.00, balance: 207601.21, notes: '' },
      { date: '2026-08-17', type: 'purchase', ref: 'N1', container: '22858 DXB', bales: 890, amount: 135920.00, balance: 343521.21, notes: '' },
      { date: '2026-08-20', type: 'payment', amount: 50000.00, balance: 293521.21, notes: '' },
      { date: '2026-08-24', type: 'purchase', ref: 'V1', container: '87755 DXB', bales: 594, amount: 28190.00, balance: 321711.21, notes: '' },
      { date: '2026-08-24', type: 'purchase', ref: 'V2', container: '25148 DXB', bales: 653, amount: 76070.00, balance: 397781.21, notes: '' },
      { date: '2026-08-26', type: 'purchase', ref: 'V3', container: '30363 DXB', bales: 636, amount: 54875.00, balance: 452656.21, notes: '' }
    ]
  };

  function encodeAccount(value) {
    return `${MARKER}${encodeURIComponent(JSON.stringify(value))}]`;
  }

  function parseAccount(notesValue) {
    const text = String(notesValue || '');
    const start = text.indexOf(MARKER);
    if (start < 0) return null;
    const end = text.indexOf(']', start + MARKER.length);
    if (end < 0) return null;
    try {
      return JSON.parse(decodeURIComponent(text.slice(start + MARKER.length, end)));
    } catch (_) {
      return null;
    }
  }

  async function ensureNovatexAccount() {
    try {
      const found = await supabaseRequest(`suppliers?name=eq.${encodeURIComponent(SUPPLIER_NAME)}&select=id,name,balance,notes&limit=1`);
      const supplier = Array.isArray(found) ? found[0] : null;
      const notes = encodeAccount(account);

      if (!supplier) {
        await supabaseRequest('suppliers', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ name: SUPPLIER_NAME, phone: '', balance: account.currentBalance, notes })
        });
        return;
      }
      if (parseAccount(supplier.notes)) return;
      if (Number(supplier.balance || 0) !== 0 || String(supplier.notes || '').trim()) return;

      await supabaseRequest(`suppliers?id=eq.${encodeURIComponent(supplier.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ balance: account.currentBalance, notes })
      });
    } catch (error) {
      console.warn('NOVATEX supplier import failed:', error.message);
    }
  }

  app.get('/api/supplier-account/:id', async (req, res) => {
    try {
      const rows = await supabaseRequest(`suppliers?id=eq.${encodeURIComponent(req.params.id)}&select=id,name,balance,notes&limit=1`);
      const supplier = Array.isArray(rows) ? rows[0] : null;
      if (!supplier) return res.status(404).json({ error: 'المورد غير موجود' });
      const parsed = parseAccount(supplier.notes);
      if (!parsed) return res.status(404).json({ error: 'لا يوجد كشف مستورد لهذا المورد' });
      res.json({ supplierId: supplier.id, supplierName: supplier.name, ...parsed });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/supplier-account/:id/entries', async (req, res) => {
    try {
      const id = req.params.id;
      const x = req.body || {};
      const type = String(x.type || '').trim();
      const amount = Number(x.amount || 0);
      if (!['purchase', 'payment'].includes(type)) throw new Error('نوع الحركة غير صحيح');
      if (!(amount > 0)) throw new Error('أدخل مبلغًا أكبر من صفر');

      const rows = await supabaseRequest(`suppliers?id=eq.${encodeURIComponent(id)}&select=id,name,balance,notes&limit=1`);
      const supplier = Array.isArray(rows) ? rows[0] : null;
      if (!supplier) throw new Error('المورد غير موجود');
      const parsed = parseAccount(supplier.notes);
      if (!parsed) throw new Error('هذا المورد لا يحتوي كشفًا مستوردًا');

      const current = Number(parsed.currentBalance || supplier.balance || 0);
      const newBalance = type === 'purchase' ? current + amount : current - amount;
      const entry = {
        date: x.date || new Date().toISOString().slice(0, 10),
        type,
        amount,
        balance: newBalance,
        ref: String(x.ref || '').trim(),
        container: String(x.container || '').trim(),
        bales: Number(x.bales || 0),
        notes: String(x.notes || '').trim()
      };

      parsed.entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      parsed.entries.push(entry);
      parsed.currentBalance = newBalance;
      parsed.totalPurchases = Number(parsed.totalPurchases || 0) + (type === 'purchase' ? amount : 0);
      parsed.totalPayments = Number(parsed.totalPayments || 0) + (type === 'payment' ? amount : 0);

      await supabaseRequest(`suppliers?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ balance: newBalance, notes: encodeAccount(parsed) })
      });

      res.json({ ok: true, balance: newBalance, account: parsed });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  setTimeout(ensureNovatexAccount, 1500);
};
