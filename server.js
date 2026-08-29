const express = require('express');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 80);

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

function rowNum(v) {
  return v == null ? 0 : Number(v);
}

function cleanDate(v) {
  return v || null;
}

async function supabaseRequest(endpoint, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase environment variables are missing');
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  if (!response.ok) {
    let message = text;

    try {
      const json = JSON.parse(text);
      message = json.message || json.error || text;
    } catch (_) {}

    throw new Error(message || `Supabase error ${response.status}`);
  }

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    await supabaseRequest('shipments?select=id&limit=1');

    res.json({
      ok: true,
      database: true,
      mode: 'supabase-https',
      time: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      database: false,
      error: e.message
    });
  }
});

app.get('/api/data', async (_req, res) => {
  try {
  const [shipments, bales, customers, payments, sales, expenses, cashMovements, suppliers, supplierPayments] = await Promise.all([
  supabaseRequest('shipments?select=*&order=created_at.asc'),
  supabaseRequest('bales?select=*&order=created_at.asc'),
  supabaseRequest('customers?select=*&order=created_at.asc'),
  supabaseRequest('payments?select=*&order=paid_at.asc'),
  supabaseRequest('sales?select=*'),
  supabaseRequest('expenses?select=*&order=expense_date.asc'),
  supabaseRequest('cash_movements?select=*&order=movement_date.asc'),
    supabaseRequest('suppliers?select=*&order=created_at.asc'),
supabaseRequest('supplier_payments?select=*&order=payment_date.asc')
]);
    res.json({
      shipments: (shipments || []).map(x => ({
        id: x.id,
        supplier: x.supplier,
        container: x.container_name,
        purchaseDate: x.purchase_date,
        arrivalDate: x.arrival_date,
        fx: rowNum(x.fx),
        season: x.season,
        customs: rowNum(x.customs),
        clearance: rowNum(x.clearance),
        otherCost: rowNum(x.other_cost),
        notes: x.notes
      })),

      bales: (bales || []).map(x => ({
        id: x.id,
        shipmentId: x.shipment_id,
        grade: x.grade,
        nameEn: x.name_en,
        nameAr: x.name_ar,
        weight: rowNum(x.weight),
        buyUsd: rowNum(x.buy_usd),
        status: x.status
      })),

      customers: (customers || []).map(x => ({
        id: x.id,
        name: x.name,
        phone: x.phone,
        debt: rowNum(x.debt)
      })),

      payments: (payments || []).map(x => ({
        id: x.id,
        customerId: x.customer_id,
        amount: rowNum(x.amount),
        date: x.paid_at
      })),
      sales: (sales || []).map(x => ({
  id: x.id,
  customerId: x.customer_id,
  amount: rowNum(x.total_jod),
  date: x.sale_date || x.created_at || null,
  notes: x.notes || ''
})),

expenses: (expenses || []).map(x => ({
  id: x.id,
  category: x.category || '',
  amount: rowNum(x.amount),
  date: x.expense_date || null,
  notes: x.notes || ''
})),

cashMovements: (cashMovements || []).map(x => ({
  id: x.id,
  type: x.movement_type || '',
  amount: rowNum(x.amount),
  date: x.movement_date || null,
  referenceType: x.reference_type || '',
  referenceId: x.reference_id || '',
  notes: x.notes || ''
})),
      suppliers: (suppliers || []).map(x => ({
  id: x.id,
  name: x.name,
  phone: x.phone || '',
  balance: rowNum(x.balance),
  notes: x.notes || ''
})),

supplierPayments: (supplierPayments || []).map(x => ({
  id: x.id,
  supplierId: x.supplier_id,
  amount: rowNum(x.amount),
  date: x.payment_date || null,
  notes: x.notes || ''
}))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/shipments', async (req, res) => {
  const x = req.body || {};

  try {
    await supabaseRequest('shipments', {
      method: 'POST',
      headers: {
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        id: x.id,
        supplier: x.supplier || '',
        container_name: x.container,
        purchase_date: cleanDate(x.purchaseDate),
        arrival_date: cleanDate(x.arrivalDate),
        fx: Number(x.fx || 0),
        season: x.season || 'شتوي',
        customs: Number(x.customs || 0),
        clearance: Number(x.clearance || 0),
        other_cost: Number(x.otherCost || 0),
        notes: x.notes || ''
      })
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/bales', async (req, res) => {
  const x = req.body || {};

  try {
    await supabaseRequest('bales', {
      method: 'POST',
      headers: {
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        id: x.id,
        shipment_id: x.shipmentId,
        grade: x.grade,
        name_en: x.nameEn || '',
        name_ar: x.nameAr || '',
        weight: Number(x.weight || 0),
        buy_usd: Number(x.buyUsd || 0),
        status: x.status || 'في الطريق'
      })
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/customers', async (req, res) => {
  const x = req.body || {};

  try {
    await supabaseRequest('customers', {
      method: 'POST',
      headers: {
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        name: x.name,
        phone: x.phone || '',
        debt: Number(x.debt || 0)
      })
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/payments', async (req, res) => {
  const x = req.body || {};

  try {
    await supabaseRequest('rpc/record_payment', {
      method: 'POST',
      body: JSON.stringify({
        p_id: x.id,
        p_customer_id: Number(x.customerId),
        p_amount: Number(x.amount || 0)
      })
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/sales', async (req, res) => {
  const x = req.body || {};

  try {
    await supabaseRequest('rpc/record_sale', {
      method: 'POST',
      body: JSON.stringify({
        p_id: x.id,
        p_customer_id: Number(x.customerId),
        p_amount: Number(x.amount || 0),
        p_notes: x.notes || ''
      })
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/expenses', async (req, res) => {
  const x = req.body || {};

  try {
    await supabaseRequest('expenses', {
      method: 'POST',
      headers: {
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        category: x.category || 'عام',
        amount: Number(x.amount || 0),
        expense_date: cleanDate(x.date) || new Date().toISOString().slice(0, 10),
        notes: x.notes || ''
      })
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/cash-movements', async (req, res) => {
  const x = req.body || {};

  try {
    await supabaseRequest('cash_movements', {
      method: 'POST',
      headers: {
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        movement_type: x.type || 'manual',
        amount: Number(x.amount || 0),
        movement_date: cleanDate(x.date) || new Date().toISOString().slice(0, 10),
        reference_type: x.referenceType || '',
        reference_id: x.referenceId || '',
        notes: x.notes || ''
      })
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Bale app listening on ${port} using Supabase HTTPS`);
});
