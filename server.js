const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 80);

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
  max: 5,
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

function rowNum(v) { return v == null ? 0 : Number(v); }

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      supplier TEXT NOT NULL DEFAULT '',
      container_name TEXT NOT NULL,
      purchase_date DATE,
      arrival_date DATE,
      fx NUMERIC(12,6) NOT NULL DEFAULT 0,
      season TEXT NOT NULL DEFAULT 'شتوي',
      customs NUMERIC(14,2) NOT NULL DEFAULT 0,
      clearance NUMERIC(14,2) NOT NULL DEFAULT 0,
      other_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bales (
      id TEXT PRIMARY KEY,
      shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
      grade TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      name_ar TEXT NOT NULL DEFAULT '',
      weight NUMERIC(12,2) NOT NULL DEFAULT 0,
      buy_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'في الطريق',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      debt NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      amount NUMERIC(14,2) NOT NULL,
      paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

app.get('/api/health', async (_req, res) => {
  try {
    const r = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, database: true, time: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, database: false, error: e.message });
  }
});

app.get('/api/data', async (_req, res) => {
  try {
    const [s, b, c, p] = await Promise.all([
      pool.query('SELECT * FROM shipments ORDER BY created_at ASC'),
      pool.query('SELECT * FROM bales ORDER BY created_at ASC'),
      pool.query('SELECT * FROM customers ORDER BY created_at ASC'),
      pool.query('SELECT * FROM payments ORDER BY paid_at ASC'),
    ]);
    res.json({
      shipments: s.rows.map(x => ({id:x.id,supplier:x.supplier,container:x.container_name,purchaseDate:x.purchase_date,arrivalDate:x.arrival_date,fx:rowNum(x.fx),season:x.season,customs:rowNum(x.customs),clearance:rowNum(x.clearance),otherCost:rowNum(x.other_cost),notes:x.notes})),
      bales: b.rows.map(x => ({id:x.id,shipmentId:x.shipment_id,grade:x.grade,nameEn:x.name_en,nameAr:x.name_ar,weight:rowNum(x.weight),buyUsd:rowNum(x.buy_usd),status:x.status})),
      customers: c.rows.map(x => ({id:x.id,name:x.name,phone:x.phone,debt:rowNum(x.debt)})),
      payments: p.rows.map(x => ({id:x.id,customerId:x.customer_id,amount:rowNum(x.amount),date:x.paid_at})),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/shipments', async (req, res) => {
  const x = req.body || {};
  try {
    await pool.query(`INSERT INTO shipments(id,supplier,container_name,purchase_date,arrival_date,fx,season,customs,clearance,other_cost,notes)
      VALUES($1,$2,$3,NULLIF($4,'')::date,NULLIF($5,'')::date,$6,$7,$8,$9,$10,$11)`,
      [x.id,x.supplier||'',x.container,x.purchaseDate||'',x.arrivalDate||'',x.fx||0,x.season||'شتوي',x.customs||0,x.clearance||0,x.otherCost||0,x.notes||'']);
    res.json({ ok:true });
  } catch (e) { res.status(400).json({ error:e.message }); }
});

app.post('/api/bales', async (req, res) => {
  const x = req.body || {};
  try {
    await pool.query(`INSERT INTO bales(id,shipment_id,grade,name_en,name_ar,weight,buy_usd,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [x.id,x.shipmentId,x.grade,x.nameEn||'',x.nameAr||'',x.weight||0,x.buyUsd||0,x.status||'في الطريق']);
    res.json({ ok:true });
  } catch (e) { res.status(400).json({ error:e.message }); }
});

app.post('/api/customers', async (req, res) => {
  const x = req.body || {};
  try {
    await pool.query('INSERT INTO customers(id,name,phone,debt) VALUES($1,$2,$3,$4)', [x.id,x.name,x.phone||'',x.debt||0]);
    res.json({ ok:true });
  } catch (e) { res.status(400).json({ error:e.message }); }
});

app.post('/api/payments', async (req, res) => {
  const x = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query('SELECT debt FROM customers WHERE id=$1 FOR UPDATE', [x.customerId]);
    if (!c.rowCount) throw new Error('الزبون غير موجود');
    const debt = Math.max(0, rowNum(c.rows[0].debt) - Number(x.amount||0));
    await client.query('UPDATE customers SET debt=$1 WHERE id=$2', [debt,x.customerId]);
    await client.query('INSERT INTO payments(id,customer_id,amount,paid_at) VALUES($1,$2,$3,NOW())', [x.id,x.customerId,x.amount]);
    await client.query('COMMIT');
    res.json({ ok:true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error:e.message });
  } finally { client.release(); }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

initDb().then(() => {
  app.listen(port, '0.0.0.0', () => console.log(`Bale app listening on ${port}`));
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
