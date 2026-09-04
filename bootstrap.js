const fs = require('fs');
const path = require('path');
const Module = require('module');

// Ensure the full-bale sale UI patch is loaded directly in the page.
try {
  const indexPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  if (!html.includes('/sale_patch.js')) {
    html = html.replace('</body>', '<script src="/sale_patch.js?v=5"></script></body>');
    fs.writeFileSync(indexPath, html, 'utf8');
  }
} catch (error) {
  console.warn('Could not inject sale_patch.js into index.html:', error.message);
}

const originalPath = path.join(__dirname, 'server.js');
let src = fs.readFileSync(originalPath, 'utf8');

function replaceOrFail(pattern, replacement, label) {
  const next = src.replace(pattern, replacement);
  if (next === src) throw new Error('Patch failed: ' + label);
  src = next;
}

replaceOrFail(
  "supabaseRequest('sales?select=customer_id,total_jod,sale_date,created_at')",
  "supabaseRequest('sales?select=customer_id,total_jod,sale_date,created_at,notes')",
  'agent sales notes'
);

replaceOrFail(
  /function businessSummary\(snapshot\) \{[\s\S]*?\n\}\n\nfunction localAgentCommand/,
`function businessSummary(snapshot) {
  const shipmentById = new Map(snapshot.shipments.map(item => [String(item.id), item]));
  const balesByShipment = new Map();
  for (const bale of snapshot.bales) {
    const key = String(bale.shipment_id);
    balesByShipment.set(key, (balesByShipment.get(key) || 0) + 1);
  }

  const baleCost = bale => {
    const shipment = shipmentById.get(String(bale.shipment_id));
    if (!shipment) return 0;
    const base = rowNum(bale.buy_usd) * rowNum(shipment.fx);
    const count = balesByShipment.get(String(bale.shipment_id)) || 1;
    const landed = (rowNum(shipment.customs) + rowNum(shipment.clearance) + rowNum(shipment.other_cost)) / count;
    return base + landed;
  };

  const purchases = snapshot.bales.reduce((sum, item) => sum + (rowNum(item.buy_usd) * rowNum(shipmentById.get(String(item.shipment_id))?.fx)), 0);
  const landedCosts = snapshot.shipments.reduce((sum, item) => sum + rowNum(item.customs) + rowNum(item.clearance) + rowNum(item.other_cost), 0);
  const sales = snapshot.sales.reduce((sum, item) => sum + rowNum(item.total_jod), 0);
  const customerPayments = snapshot.payments.reduce((sum, item) => sum + rowNum(item.amount), 0);
  const expenses = snapshot.expenses.reduce((sum, item) => sum + rowNum(item.amount), 0);
  const supplierPayments = snapshot.supplierPayments.reduce((sum, item) => sum + rowNum(item.amount_jod), 0);
  const manualCashIn = snapshot.cashMovements.filter(item => item.movement_type === 'in').reduce((sum, item) => sum + rowNum(item.amount), 0);
  const manualCashOut = snapshot.cashMovements.filter(item => item.movement_type === 'out').reduce((sum, item) => sum + rowNum(item.amount), 0);
  const cashIn = customerPayments + manualCashIn;
  const cashOut = expenses + manualCashOut;

  let linkedSales = 0;
  let soldBaleCost = 0;
  let linkedSaleCount = 0;
  let archivedSaleCount = 0;
  let archivedSalesAmount = 0;
  const seenBales = new Set();

  for (const sale of snapshot.sales) {
    const match = String(sale.notes || '').match(/\[BALE_ID:([^\]]+)\]/);
    if (!match) {
      archivedSaleCount += 1;
      archivedSalesAmount += rowNum(sale.total_jod);
      continue;
    }
    const baleId = String(match[1]);
    const bale = snapshot.bales.find(item => String(item.id) === baleId);
    if (!bale) {
      archivedSaleCount += 1;
      archivedSalesAmount += rowNum(sale.total_jod);
      continue;
    }
    linkedSales += rowNum(sale.total_jod);
    linkedSaleCount += 1;
    if (!seenBales.has(baleId)) {
      soldBaleCost += baleCost(bale);
      seenBales.add(baleId);
    }
  }

  return {
    customers: snapshot.customers.length,
    suppliers: snapshot.suppliers.length,
    bales: snapshot.bales.length,
    totalWeight: snapshot.bales.reduce((sum, item) => sum + rowNum(item.weight), 0),
    customerDebt: snapshot.customers.reduce((sum, item) => sum + rowNum(item.debt), 0),
    supplierDebt: snapshot.suppliers.reduce((sum, item) => sum + rowNum(item.balance), 0),
    sales,
    purchases,
    landedCosts,
    inventoryCost: purchases + landedCosts,
    customerPayments,
    supplierPayments,
    expenses,
    cashIn,
    cashOut,
    cashBalance: cashIn - cashOut,
    linkedSales,
    soldBaleCost,
    linkedSaleCount,
    archivedSaleCount,
    archivedSalesAmount,
    estimatedNet: linkedSales - soldBaleCost - expenses
  };
}

function localAgentCommand`,
  'businessSummary'
);

replaceOrFail(
  /if \(call\.name === 'profit_summary'\) \{[\s\S]*?\n  \}\n  if \(call\.name === 'record_customer_payment'\)/,
`if (call.name === 'profit_summary') {
    const summary = businessSummary(snapshot);
    if (!summary.linkedSaleCount) {
      const archive = summary.archivedSaleCount
        ? \` يوجد أيضًا \${summary.archivedSaleCount} مبيعة قديمة محفوظة كأرشيف ولا تدخل في الربح الجديد.\`
        : '';
      return {
        mode,
        message: \`لا توجد مبيعات جديدة مرتبطة ببالات حتى الآن. سجّل المبيعة باختيار البالة الكاملة أولًا، وبعدها أحسب ربحها الحقيقي.\${archive}\`,
        action: null
      };
    }
    const archive = summary.archivedSaleCount
      ? \` المبيعات القديمة محفوظة كأرشيف: \${summary.archivedSaleCount} حركة بإجمالي \${summary.archivedSalesAmount.toFixed(2)} د.أ، ولا تدخل في صافي الربح الجديد.\`
      : '';
    return {
      mode,
      message: \`صافي ربح البالات الجديدة: \${summary.estimatedNet.toFixed(2)} د.أ = مبيعات البالات \${summary.linkedSales.toFixed(2)} - تكلفة البالات المباعة \${summary.soldBaleCost.toFixed(2)} - المصاريف \${summary.expenses.toFixed(2)}.\${archive}\`,
      action: null
    };
  }
  if (call.name === 'record_customer_payment')`,
  'profit summary message'
);

replaceOrFail(
  /sales: \(sales \|\| \[\]\)\.map\(x => \(\{\n  id: x\.id,\n  customerId: x\.customer_id,\n  amount: rowNum\(x\.total_jod\),\n  date: x\.sale_date \|\| x\.created_at \|\| null,\n  notes: x\.notes \|\| ''\n\}\)\),/,
`sales: (sales || []).map(x => ({
  id: x.id,
  customerId: x.customer_id,
  amount: rowNum(x.total_jod),
  date: x.sale_date || x.created_at || null,
  notes: String(x.notes || '').replace(/\s*\[BALE_ID:[^\]]+\]\s*/g, ' ').trim(),
  baleId: (String(x.notes || '').match(/\[BALE_ID:([^\]]+)\]/) || [])[1] || null
})),`,
  'sales api mapping'
);

replaceOrFail(
  /app\.post\('\/api\/sales',[\s\S]*?\n\}\);\napp\.post\('\/api\/expenses'/,
`app.post('/api/sales', async (req, res) => {
  const x = req.body || {};

  try {
    const amount = Number(x.amount || 0);
    const baleId = String(x.baleId || '').trim();
    if (!(amount > 0)) throw new Error('أدخل قيمة مبيعة صحيحة.');
    if (!baleId) throw new Error('اختر البالة المباعة. البيع مسموح لبالة كاملة فقط.');

    const found = await supabaseRequest(\`bales?id=eq.\${encodeURIComponent(baleId)}&select=id,status,name_ar,name_en&limit=1\`);
    const bale = Array.isArray(found) ? found[0] : null;
    if (!bale) throw new Error('البالة غير موجودة في المخزون.');
    if (normalizeArabic(bale.status).includes('مباع')) throw new Error('هذه البالة مباعة مسبقًا.');

    const cleanNotes = String(x.notes || '').replace(/\s*\[BALE_ID:[^\]]+\]\s*/g, ' ').trim();
    const storedNotes = \`[BALE_ID:\${baleId}]\${cleanNotes ? ' ' + cleanNotes : ''}\`;

    await supabaseRequest('rpc/record_sale', {
      method: 'POST',
      body: JSON.stringify({
        p_id: x.id,
        p_customer_id: Number(x.customerId),
        p_amount: amount,
        p_notes: storedNotes
      })
    });

    await supabaseRequest(\`bales?id=eq.\${encodeURIComponent(baleId)}\`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'مباعة' })
    });

    res.json({ ok: true, baleId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/expenses'`,
  'sales route'
);

replaceOrFail(
  "app.post('/api/bales', async (req, res) => {",
`app.delete('/api/shipments/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  try {
    if (!id) throw new Error('معرّف الشحنة غير صالح.');
    await supabaseRequest(\`bales?shipment_id=eq.\${encodeURIComponent(id)}\`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    });
    await supabaseRequest(\`shipments?id=eq.\${encodeURIComponent(id)}\`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/bales', async (req, res) => {`,
  'shipment delete route'
);

module.filename = originalPath;
module.paths = Module._nodeModulePaths(__dirname);
module._compile(src, originalPath);
