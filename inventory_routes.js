const crypto = require('crypto');

module.exports = function registerInventoryRoutes(ctx) {
  const app = ctx.app;
  const rowNum = ctx.rowNum;
  const normalizeArabic = ctx.normalizeArabic;
  const pool = ctx.pool || new (require('pg').Pool)(
    process.env.DATABASE_URL
      ? {
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false },
          max: 5
        }
      : {
          host: process.env.PGHOST,
          port: Number(process.env.PGPORT || 5432),
          user: process.env.PGUSER,
          password: process.env.PGPASSWORD,
          database: process.env.PGDATABASE,
          ssl: String(process.env.PGSSL || 'true').toLowerCase() === 'false'
            ? false
            : { rejectUnauthorized: false },
          max: 5
        }
  );
  const today = () => new Date().toISOString().slice(0, 10);

  function normalizeGrade(value) {
    const grade = String(value || '').trim().toUpperCase();
    if (['CREAM', 'CREME', 'CRÈME', 'كريم'].includes(grade)) return 'Cream';
    if (grade === 'B') return 'B';
    return 'A';
  }

  function normalizeName(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function productKey(row) {
    const name = normalizeName(row.name_en) || normalizeArabic(row.name_ar);
    return [
      name,
      normalizeGrade(row.grade),
      Number(row.weight_kg || 0)
    ].join('|');
  }

  function prepareRows(rows) {
    const preparedByKey = new Map();
    for (const raw of rows) {
      const quantity = Number(raw.quantity || 0);
      const weight = Number(raw.weight_kg || 0);
      const price = Number(raw.purchase_price_usd == null ? 0 : raw.purchase_price_usd);
      const nameEn = String(raw.name_en || '').trim();
      const nameAr = String(raw.name_ar || '').trim();
      const grade = normalizeGrade(raw.grade);

      if ((!nameEn && !nameAr) || !(quantity > 0) || !(weight > 0) || price < 0) {
        throw new Error(
          'بيانات صنف غير مكتملة: ' + (nameAr || nameEn || 'بدون اسم')
        );
      }

      const prepared = {
        name_en: nameEn,
        name_ar: nameAr,
        grade: grade,
        quantity: quantity,
        weight_kg: weight,
        purchase_price_usd: price,
        total_weight_kg: Number(raw.total_weight_kg || quantity * weight),
        invoice_total_usd: Number(raw.invoice_total_usd || quantity * price)
      };
      const key = productKey(prepared);
      const existing = preparedByKey.get(key);
      if (existing) {
        existing.quantity += prepared.quantity;
        existing.total_weight_kg += prepared.total_weight_kg;
        existing.invoice_total_usd += prepared.invoice_total_usd;
      } else {
        preparedByKey.set(key, prepared);
      }
    }
    return preparedByKey;
  }

  async function getSnapshot(client) {
    const db = client || pool;
    const result = await Promise.all([
      db.query(
        'select id, name_ar, name_en, grade, weight_kg, purchase_price_usd, invoice_quantity, total_weight_kg, invoice_total_usd from products order by id'
      ),
      db.query(
        'select branch_id, product_id, quantity from inventory order by branch_id, product_id'
      ),
      db.query(
        "select id, name, phone, debt from customers where created_at > timestamp '2026-09-04 18:35:00' order by created_at"
      )
    ]);
    return {
      products: result[0].rows || [],
      inventory: result[1].rows || [],
      customers: result[2].rows || []
    };
  }

  app.get('/api/v2/health', async function (_req, res) {
    try {
      const result = await pool.query('select now() as now');
      res.json({ ok: true, database: true, time: result.rows[0].now });
    } catch (error) {
      res.status(500).json({
        ok: false,
        database: false,
        error: error.message
      });
    }
  });

  app.get('/api/v2/data', async function (_req, res) {
    try {
      const snapshot = await getSnapshot();
      const productById = new Map(snapshot.products.map(function (item) {
        return [String(item.id), item];
      }));
      const inventory = snapshot.inventory.map(function (item) {
        return Object.assign(
          {},
          productById.get(String(item.product_id)) || {},
          {
            branch_id: Number(item.branch_id),
            product_id: item.product_id,
            quantity: rowNum(item.quantity),
            weight_kg: rowNum(
              (productById.get(String(item.product_id)) || {}).weight_kg
            ),
            purchase_price_usd: rowNum(
              (productById.get(String(item.product_id)) || {}).purchase_price_usd
            )
          }
        );
      });

      res.json({
        products: snapshot.products,
        inventory: inventory,
        customers: snapshot.customers.map(function (item) {
          return {
            id: item.id,
            name: item.name || '',
            phone: item.phone || '',
            debt: rowNum(item.debt)
          };
        })
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v2/inventory/import', async function (req, res) {
    const input = req.body || {};
    const rows = Array.isArray(input.rows) ? input.rows : [];
    const branchId = Number(input.branch_id || 2);
    const batchId = String(input.batch_id || '').trim();
    const mode = input.mode === 'replace' ? 'replace' : 'increment';

    if (!batchId || !/^[A-Za-z0-9_-]{4,80}$/.test(batchId)) {
      return res.status(400).json({ error: 'معرّف الاستيراد غير صالح.' });
    }
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return res.status(400).json({ error: 'الفرع غير صالح.' });
    }
    if (!rows.length || rows.length > 300) {
      return res.status(400).json({ error: 'الجدول فارغ أو أكبر من الحد المسموح.' });
    }

    let preparedByKey;
    try {
      preparedByKey = prepareRows(rows);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      const batchNote = 'IMPORT_BATCH:' + batchId;
      const priorBatch = await client.query(
        'select id from shipments where notes = $1 limit 1',
        [batchNote]
      );
      if (priorBatch.rows[0]) {
        await client.query('rollback');
        return res.json({
          ok: true,
          already_imported: true,
          batch_id: batchId,
          branch_id: branchId,
          unique_rows: preparedByKey.size,
          created_products: 0,
          updated_products: 0,
          updated_inventory: 0,
          imported_quantity: 0
        });
      }

      const snapshot = await getSnapshot(client);
      const productByKey = new Map();
      for (const product of snapshot.products) {
        const key = productKey(product);
        if (!productByKey.has(key)) productByKey.set(key, product);
      }

      let createdProducts = 0;
      let updatedProducts = 0;
      let updatedInventory = 0;
      let importedQuantity = 0;

      for (const entry of preparedByKey.entries()) {
        const key = entry[0];
        const row = entry[1];
        let product = productByKey.get(key);

        if (!product) {
          const inserted = await client.query(
            'insert into products (name_ar, name_en, grade, weight_kg, purchase_price_usd, invoice_quantity, total_weight_kg, invoice_total_usd) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *',
            [
              row.name_ar,
              row.name_en,
              row.grade,
              row.weight_kg,
              row.purchase_price_usd,
              row.quantity,
              row.total_weight_kg,
              row.invoice_total_usd
            ]
          );
          product = inserted.rows[0];
          productByKey.set(key, product);
          createdProducts += 1;
        } else {
          const updated = await client.query(
            'update products set name_ar=$2, name_en=$3, grade=$4, weight_kg=$5, purchase_price_usd=$6, invoice_quantity=$7, total_weight_kg=$8, invoice_total_usd=$9 where id=$1 returning *',
            [
              product.id,
              row.name_ar,
              row.name_en,
              row.grade,
              row.weight_kg,
              row.purchase_price_usd,
              row.quantity,
              row.total_weight_kg,
              row.invoice_total_usd
            ]
          );
          product = updated.rows[0];
          productByKey.set(key, product);
          updatedProducts += 1;
        }

        const locked = await client.query(
          'select quantity from inventory where branch_id=$1 and product_id=$2 for update',
          [branchId, product.id]
        );
        if (locked.rows[0]) {
          const currentQuantity = rowNum(locked.rows[0].quantity);
          const targetQuantity = mode === 'replace'
            ? row.quantity
            : currentQuantity + row.quantity;
          await client.query(
            'update inventory set quantity=$3 where branch_id=$1 and product_id=$2',
            [branchId, product.id, targetQuantity]
          );
        } else {
          await client.query(
            'insert into inventory (branch_id, product_id, quantity) values ($1,$2,$3)',
            [branchId, product.id, row.quantity]
          );
        }
        updatedInventory += 1;
        importedQuantity += row.quantity;
      }

      await client.query(
        'insert into shipments (id, supplier, container_name, purchase_date, arrival_date, fx, season, customs, clearance, other_cost, notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          crypto.randomUUID(),
          'كشف مستورد',
          'الجدول الجديد',
          today(),
          today(),
          0,
          String(input.season || 'شتوي'),
          0,
          0,
          0,
          'IMPORT_BATCH:' + batchId
        ]
      );
      await client.query('commit');

      res.json({
        ok: true,
        already_imported: false,
        batch_id: batchId,
        branch_id: branchId,
        unique_rows: preparedByKey.size,
        created_products: createdProducts,
        updated_products: updatedProducts,
        updated_inventory: updatedInventory,
        imported_quantity: importedQuantity
      });
    } catch (error) {
      await client.query('rollback').catch(function () {});
      res.status(400).json({ error: error.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/v2/inventory/transfer', async function (req, res) {
    const input = req.body || {};
    const productId = String(input.product_id || '').trim();
    const fromBranch = Number(input.from_branch_id);
    const toBranch = Number(input.to_branch_id);
    const quantity = Number(input.quantity);

    if (!productId || !Number.isInteger(fromBranch) || !Number.isInteger(toBranch)) {
      return res.status(400).json({ error: 'بيانات النقل غير مكتملة.' });
    }
    if (fromBranch === toBranch || !(quantity > 0)) {
      return res.status(400).json({ error: 'اختر فرعين مختلفين وكمية صحيحة.' });
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      const fromResult = await client.query(
        'select quantity from inventory where branch_id=$1 and product_id=$2 for update',
        [fromBranch, productId]
      );
      const available = rowNum(fromResult.rows[0] && fromResult.rows[0].quantity);
      if (available < quantity) {
        throw new Error('الكمية المتاحة ' + available + ' فقط.');
      }

      await client.query(
        'update inventory set quantity=$3 where branch_id=$1 and product_id=$2',
        [fromBranch, productId, available - quantity]
      );
      const toResult = await client.query(
        'select quantity from inventory where branch_id=$1 and product_id=$2 for update',
        [toBranch, productId]
      );
      if (toResult.rows[0]) {
        await client.query(
          'update inventory set quantity=$3 where branch_id=$1 and product_id=$2',
          [toBranch, productId, rowNum(toResult.rows[0].quantity) + quantity]
        );
      } else {
        await client.query(
          'insert into inventory (branch_id, product_id, quantity) values ($1,$2,$3)',
          [toBranch, productId, quantity]
        );
      }

      await client.query('commit');
      res.json({ ok: true, message: 'تم نقل المخزون.' });
    } catch (error) {
      await client.query('rollback').catch(function () {});
      res.status(400).json({ error: error.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/v2/customers', async function (req, res) {
    const input = req.body || {};
    const name = String(input.name || '').trim();
    if (!name) return res.status(400).json({ error: 'أدخل اسم الزبون.' });

    try {
      await pool.query(
        'insert into customers (name, phone, debt) values ($1,$2,$3)',
        [name, String(input.phone || ''), Number(input.debt || 0)]
      );
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
};
