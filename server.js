const express = require('express');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 80);

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

function rowNum(v) {
  return v == null ? 0 : Number(v);
}

function cleanDate(v) {
  return v || null;
}

function normalizeArabic(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ');
}

function parseArabicNumber(value) {
  const converted = String(value || '')
    .replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
    .replace(/[٬,]/g, '');
  const match = converted.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function findNamed(items, name) {
  const wanted = normalizeArabic(name);
  if (!wanted) return null;
  return items.find(item => normalizeArabic(item.name) === wanted) ||
    items.find(item => normalizeArabic(item.name).includes(wanted) || wanted.includes(normalizeArabic(item.name))) ||
    null;
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

async function getAgentSnapshot() {
  const [customers, suppliers, payments, sales, expenses, shipments, bales, supplierPayments] = await Promise.all([
    supabaseRequest('customers?select=id,name,debt'),
    supabaseRequest('suppliers?select=id,name,balance'),
    supabaseRequest('payments?select=customer_id,amount'),
    supabaseRequest('sales?select=customer_id,total_jod'),
    supabaseRequest('expenses?select=amount'),
    supabaseRequest('shipments?select=id,supplier_id,supplier'),
    supabaseRequest('bales?select=id,shipment_id,buy_usd'),
    supabaseRequest('supplier_payments?select=supplier_id,amount_jod')
  ]);

  return {
    customers: customers || [],
    suppliers: suppliers || [],
    payments: payments || [],
    sales: sales || [],
    expenses: expenses || [],
    shipments: shipments || [],
    bales: bales || [],
    supplierPayments: supplierPayments || []
  };
}

function businessSummary(snapshot) {
  return {
    customers: snapshot.customers.length,
    suppliers: snapshot.suppliers.length,
    bales: snapshot.bales.length,
    customerDebt: snapshot.customers.reduce((sum, item) => sum + rowNum(item.debt), 0),
    supplierDebt: snapshot.suppliers.reduce((sum, item) => sum + rowNum(item.balance), 0),
    sales: snapshot.sales.reduce((sum, item) => sum + rowNum(item.total_jod), 0),
    customerPayments: snapshot.payments.reduce((sum, item) => sum + rowNum(item.amount), 0),
    expenses: snapshot.expenses.reduce((sum, item) => sum + rowNum(item.amount), 0)
  };
}

function localAgentCommand(prompt, snapshot) {
  const text = normalizeArabic(prompt);
  const amount = parseArabicNumber(prompt);
  const customer = snapshot.customers.find(item => text.includes(normalizeArabic(item.name)));
  const supplier = snapshot.suppliers.find(item => text.includes(normalizeArabic(item.name)));
  const expenseCategory = String(prompt)
    .replace(/.*(?:مصروف|صرف)\s*/i, '')
    .replace(/[٠-٩0-9.,٬]+.*/, '')
    .trim() || 'عام';

  if (text.includes('كشف') && text.includes('حساب') && text.includes('مورد')) {
    return { name: 'supplier_statement', arguments: { supplier_name: supplier?.name || '' } };
  }
  if (text.includes('كشف') && text.includes('حساب')) {
    return { name: 'customer_statement', arguments: { customer_name: customer?.name || '' } };
  }
  if ((text.includes('دفعه') || text.includes('دفعت') || text.includes('قبض')) && text.includes('مورد')) {
    return { name: 'record_supplier_payment', arguments: { supplier_name: supplier?.name || '', amount, notes: '' } };
  }
  if (text.includes('دفعه') || text.includes('دفعت') || text.includes('قبض')) {
    return { name: 'record_customer_payment', arguments: { customer_name: customer?.name || '', amount, notes: '' } };
  }
  if (text.includes('مبيع') || text.includes('بيعه') || text.includes('بيع')) {
    return { name: 'record_sale', arguments: { customer_name: customer?.name || '', amount, notes: '' } };
  }
  if (text.includes('مصروف') || text.includes('صرف')) {
    return { name: 'record_expense', arguments: { category: expenseCategory, amount, notes: '' } };
  }
  if (text.includes('ملخص') || text.includes('الوضع') || text.includes('اجمالي')) {
    return { name: 'business_summary', arguments: {} };
  }
  return {
    name: 'clarify',
    arguments: { message: 'لم أفهم الأمر بالكامل. اذكر العملية والاسم والمبلغ، مثل: سجل دفعة 50 للزبون أحمد.' }
  };
}

function agentTools() {
  const nullableText = { type: ['string', 'null'] };
  return [
    {
      type: 'function', name: 'customer_statement', strict: true,
      description: 'عرض رصيد أو كشف حساب زبون موجود.',
      parameters: { type: 'object', properties: { customer_name: { type: 'string' } }, required: ['customer_name'], additionalProperties: false }
    },
    {
      type: 'function', name: 'supplier_statement', strict: true,
      description: 'عرض رصيد أو كشف حساب مورد موجود.',
      parameters: { type: 'object', properties: { supplier_name: { type: 'string' } }, required: ['supplier_name'], additionalProperties: false }
    },
    {
      type: 'function', name: 'record_customer_payment', strict: true,
      description: 'تجهيز تسجيل دفعة مستلمة من زبون. لا ينفذها مباشرة.',
      parameters: { type: 'object', properties: { customer_name: { type: 'string' }, amount: { type: 'number' }, notes: nullableText }, required: ['customer_name', 'amount', 'notes'], additionalProperties: false }
    },
    {
      type: 'function', name: 'record_sale', strict: true,
      description: 'تجهيز تسجيل مبيعة آجلة لزبون. لا ينفذها مباشرة.',
      parameters: { type: 'object', properties: { customer_name: { type: 'string' }, amount: { type: 'number' }, notes: nullableText }, required: ['customer_name', 'amount', 'notes'], additionalProperties: false }
    },
    {
      type: 'function', name: 'record_expense', strict: true,
      description: 'تجهيز تسجيل مصروف. لا ينفذه مباشرة.',
      parameters: { type: 'object', properties: { category: { type: 'string' }, amount: { type: 'number' }, notes: nullableText }, required: ['category', 'amount', 'notes'], additionalProperties: false }
    },
    {
      type: 'function', name: 'record_supplier_payment', strict: true,
      description: 'تجهيز تسجيل دفعة مدفوعة لمورد. لا ينفذها مباشرة.',
      parameters: { type: 'object', properties: { supplier_name: { type: 'string' }, amount: { type: 'number' }, notes: nullableText }, required: ['supplier_name', 'amount', 'notes'], additionalProperties: false }
    },
    {
      type: 'function', name: 'business_summary', strict: true,
      description: 'عرض ملخص سريع عن العمل والأرصدة المسجلة.',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }
    },
    {
      type: 'function', name: 'clarify', strict: true,
      description: 'طلب معلومة ناقصة أو توضيح أمر غير مفهوم.',
      parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false }
    }
  ];
}

async function callOpenAIAgent(prompt, snapshot) {
  const names = {
    customers: snapshot.customers.map(item => item.name),
    suppliers: snapshot.suppliers.map(item => item.name)
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: [
          'أنت وكيل محاسبة عربي لتجارة البالات في الأردن.',
          'حوّل أمر المستخدم إلى وظيفة واحدة فقط، ولا تخترع أسماء أو مبالغ.',
          'الأسماء المتاحة: ' + JSON.stringify(names),
          'إذا كان الاسم أو المبلغ ناقصًا أو غير موجود استخدم clarify.',
          'لا تنفذ أي عملية مالية بنفسك؛ النظام سيعرض تأكيدًا للمالك.'
        ].join('\n'),
        input: prompt,
        tools: agentTools(),
        tool_choice: 'required',
        parallel_tool_calls: false
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body?.error?.message || `OpenAI error ${response.status}`;
      throw new Error(message);
    }
    const call = (body.output || []).find(item => item.type === 'function_call');
    if (!call) throw new Error('لم يرجع الذكاء الاصطناعي أمرًا صالحًا');
    return { name: call.name, arguments: JSON.parse(call.arguments || '{}') };
  } finally {
    clearTimeout(timer);
  }
}

function buildAgentResult(call, snapshot, mode) {
  const args = call.arguments || {};
  const amount = Number(args.amount || 0);
  const requireAmount = () => {
    if (!(amount > 0)) throw new Error('اذكر مبلغًا صحيحًا أكبر من صفر.');
  };
  const customer = () => {
    const found = findNamed(snapshot.customers, args.customer_name);
    if (!found) throw new Error('لم أجد الزبون في الحسابات. اذكر الاسم كما هو مسجل.');
    return found;
  };
  const supplier = () => {
    const found = findNamed(snapshot.suppliers, args.supplier_name);
    if (!found) throw new Error('لم أجد المورد في الحسابات. اذكر الاسم كما هو مسجل.');
    return found;
  };

  if (call.name === 'customer_statement') {
    const item = customer();
    return { mode, message: `رصيد الزبون ${item.name}: ${rowNum(item.debt).toFixed(2)} د.أ`, action: { type: 'view_customer_statement', requiresConfirmation: false, payload: { customerId: item.id } } };
  }
  if (call.name === 'supplier_statement') {
    const item = supplier();
    return { mode, message: `رصيد المورد ${item.name}: ${rowNum(item.balance).toFixed(2)} د.أ`, action: { type: 'view_supplier_statement', requiresConfirmation: false, payload: { supplierId: item.id } } };
  }
  if (call.name === 'record_customer_payment') {
    const item = customer(); requireAmount();
    return { mode, message: `تأكيد تسجيل دفعة ${amount.toFixed(2)} د.أ من الزبون ${item.name}؟`, action: { type: call.name, requiresConfirmation: true, payload: { customerId: item.id, customerName: item.name, amount, notes: args.notes || '' } } };
  }
  if (call.name === 'record_sale') {
    const item = customer(); requireAmount();
    return { mode, message: `تأكيد تسجيل مبيعة ${amount.toFixed(2)} د.أ على الزبون ${item.name}؟`, action: { type: call.name, requiresConfirmation: true, payload: { customerId: item.id, customerName: item.name, amount, notes: args.notes || '' } } };
  }
  if (call.name === 'record_supplier_payment') {
    const item = supplier(); requireAmount();
    return { mode, message: `تأكيد تسجيل دفعة ${amount.toFixed(2)} د.أ للمورد ${item.name}؟`, action: { type: call.name, requiresConfirmation: true, payload: { supplierId: item.id, supplierName: item.name, amount, notes: args.notes || '' } } };
  }
  if (call.name === 'record_expense') {
    requireAmount();
    return { mode, message: `تأكيد تسجيل مصروف ${amount.toFixed(2)} د.أ ضمن ${args.category || 'عام'}؟`, action: { type: call.name, requiresConfirmation: true, payload: { category: args.category || 'عام', amount, notes: args.notes || '' } } };
  }
  if (call.name === 'business_summary') {
    const summary = businessSummary(snapshot);
    return {
      mode,
      message: `الملخص: ${summary.customers} زبائن، ${summary.suppliers} موردين، ${summary.bales} بالات. ديون الزبائن ${summary.customerDebt.toFixed(2)} د.أ، رصيد الموردين ${summary.supplierDebt.toFixed(2)} د.أ، والمصاريف ${summary.expenses.toFixed(2)} د.أ.`,
      action: null
    };
  }
  return { mode, message: args.message || 'أحتاج تفاصيل أكثر لتنفيذ الأمر.', action: null };
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
    res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
res.set('Pragma','no-cache');
res.set('Expires','0');
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
        supplierId: x.supplier_id,
        container: x.container_name,
        purchaseDate: x.purchase_date,
        arrivalDate: x.arrival_date,
        createdAt: x.created_at,
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
  amount: rowNum(x.amount_jod),
  date: x.payment_date || null,
  createdAt: x.created_at || null,
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
        supplier_id: x.supplierId ? Number(x.supplierId) : null,
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
app.post('/api/suppliers', async (req, res) => {
  const x = req.body || {};

  try {
    await supabaseRequest('suppliers', {
      method: 'POST',
      headers: {
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        name: x.name,
        phone: x.phone || '',
        balance: Number(x.balance || 0),
        notes: x.notes || ''
      })
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/supplier-payments', async (req, res) => {
  const x = req.body || {};

  try {
    await supabaseRequest('rpc/record_supplier_payment', {
  method: 'POST',
  body: JSON.stringify({
    p_supplier_id: Number(x.supplierId),
    p_amount: Number(x.amount || 0),
    p_notes: x.notes || ''
  })
});

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/agent', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'اكتب أمرًا أولاً.' });
  if (prompt.length > 500) return res.status(400).json({ error: 'الأمر طويل جدًا. اختصره إلى جملة واضحة.' });

  try {
    const snapshot = await getAgentSnapshot();
    let mode = 'local';
    let call;

    if (OPENAI_API_KEY) {
      call = await callOpenAIAgent(prompt, snapshot);
      mode = 'ai';
    } else {
      call = localAgentCommand(prompt, snapshot);
    }

    res.json(buildAgentResult(call, snapshot, mode));
  } catch (e) {
    const status = /OpenAI|aborted|fetch/i.test(e.message) ? 502 : 400;
    res.status(status).json({ error: e.name === 'AbortError' ? 'انتهت مهلة اتصال الذكاء الاصطناعي. حاول مرة أخرى.' : e.message });
  }
});
app.delete('/api/suppliers/:id', async (req, res) => {
  const id = Number(req.params.id);

  try {
    await supabaseRequest(`supplier_payments?supplier_id=eq.${id}`, {
      method: 'DELETE'
    });
await supabaseRequest(`supplier_purchases?supplier_id=eq.${id}`, {
  method: 'DELETE'
});
    await supabaseRequest(`suppliers?id=eq.${id}`, {
      method: 'DELETE'
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
