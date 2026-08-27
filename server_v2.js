const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 80);

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 5,
      }
    : {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
        ssl: { rejectUnauthorized: false },
        max: 5,
      }
);

app.use(express.json({ limit: '1mb' }));

// الواجهة الجديدة
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index_new.html'));
});

// فحص الاتصال
app.get('/api/v2/health', async (_req, res) => {
  try {
    const r = await pool.query('select now() as now');
    res.json({
      ok: true,
      database: true,
      time: r.rows[0].now
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      database: false,
      error: e.message
    });
  }
});

// البيانات الأساسية للتطبيق
app.get('/api/v2/data', async (_req, res) => {
  try {
    const [products, inventory, customers] = await Promise.all([
      pool.query(`
        select
          id,
          name_ar,
          name_en,
          grade,
          weight_kg,
          purchase_price_usd,
          invoice_quantity,
          total_weight_kg,
          invoice_total_usd
        from products
        order by id
      `),

      pool.query(`
        select
          i.branch_id,
          i.product_id,
          i.quantity,
          p.name_ar,
          p.name_en,
          p.grade,
          p.weight_kg,
          p.purchase_price_usd
        from inventory i
        join products p on p.id = i.product_id
        order by i.branch_id, p.id
      `),

      pool.query(`
        select *
        from customers
        order by id
      `)
    ]);

    const customerRows = customers.rows.map(c => ({
      id: c.id,
      name: c.name || c.name_ar || '',
      phone: c.phone || '',
      debt: Number(
        c.debt ??
        c.balance_jod ??
        c.opening_balance_jod ??
        c.opening_balance ??
        0
      )
    }));

    res.json({
      products: products.rows,
      inventory: inventory.rows,
      customers: customerRows
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e.message
    });
  }
});

// نقل المخزون
app.post('/api/v2/inventory/transfer', async (req, res) => {
  const {
    product_id,
    from_branch_id,
    to_branch_id,
    quantity,
    notes
  } = req.body || {};

  try {
    if (!product_id || !from_branch_id || !to_branch_id) {
      throw new Error('بيانات النقل غير مكتملة');
    }

    if (from_branch_id === to_branch_id) {
      throw new Error('لا يمكن النقل إلى نفس الفرع');
    }

    if (!quantity || Number(quantity) <= 0) {
      throw new Error('الكمية يجب أن تكون أكبر من صفر');
    }

    await pool.query(
      `select transfer_inventory($1,$2,$3,$4,$5)`,
      [
        Number(product_id),
        Number(from_branch_id),
        Number(to_branch_id),
        Number(quantity),
        notes || 'نقل من التطبيق'
      ]
    );

    res.json({
      ok: true,
      message: 'تم نقل المخزون وتسجيل الحركة'
    });

  } catch (e) {
    console.error(e);
    res.status(400).json({
      error: e.message
    });
  }
});

// إضافة زبون
app.post('/api/v2/customers', async (req, res) => {
  const { name, phone, debt } = req.body || {};

  try {
    if (!name || !String(name).trim()) {
      throw new Error('أدخل اسم الزبون');
    }

    // نستخدم الأعمدة الموجودة في قاعدة البيانات الحالية
    const id = crypto.randomUUID();

    await pool.query(
      `
      insert into customers
        (id, name, phone, debt)
      values
        ($1, $2, $3, $4)
      `,
      [
        id,
        String(name).trim(),
        phone || '',
        Number(debt || 0)
      ]
    );

    res.json({
      ok: true,
      id
    });

  } catch (e) {
    console.error(e);
    res.status(400).json({
      error: e.message
    });
  }
});

// الوكيل - مرحلة أولى
app.post('/api/v2/agent', async (req, res) => {
  const message = String(req.body?.message || '').trim();

  if (!message) {
    return res.status(400).json({
      error: 'اكتب أمرًا للوكيل'
    });
  }

  // مؤقتًا نرجع الأمر فقط.
  // في المرحلة التالية نربطه بالذكاء الاصطناعي الحقيقي.
  res.json({
    ok: true,
    message:
      `استلمت الأمر: ${message}\n\nالخطوة التالية هي ربط الوكيل بالذكاء الاصطناعي وتنفيذ الأوامر على النظام.`
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Bale Agency V2 listening on ${port}`);
});
