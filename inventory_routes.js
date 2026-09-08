const crypto = require('crypto');

module.exports = function registerInventoryRoutes(ctx) {
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;
  const rowNum = ctx.rowNum;
  const normalizeArabic = ctx.normalizeArabic;
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

  async function getSnapshot() {
    const result = await Promise.all([
      supabaseRequest(
        'products?select=id,name_ar,name_en,grade,weight_kg,purchase_price_usd,invoice_quantity,total_weight_kg,invoice_total_usd&order=id.asc'
      ),
      supabaseRequest(
        'inventory?select=branch_id,product_id,quantity&order=branch_id.asc'
      ),
      supabaseRequest(
        'customers?select=id,name,phone,debt,created_at&created_at=gt.2026-09-04T18%3A35%3A00Z&order=created_at.asc'
      )
    ]);
    return {
      products: result[0] || [],
      inventory: result[1] || [],
      customers: result[2] || []
    };
  }

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
            quantity: rowNum(item.quantity)
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

    const preparedByKey = new Map();
    for (const raw of rows) {
      const quantity = Number(raw.quantity || 0);
      const weight = Number(raw.weight_kg || 0);
      const price = Number(raw.purchase_price_usd == null ? 0 : raw.purchase_price_usd);
      const nameEn = String(raw.name_en || '').trim();
      const nameAr = String(raw.name_ar || '').trim();
      const grade = normalizeGrade(raw.grade);

      if ((!nameEn && !nameAr) || !(quantity > 0) || !(weight > 0) || price < 0) {
        return res.status(400).json({
          error: 'بيانات صنف غير مكتملة: ' + (nameAr || nameEn || 'بدون اسم')
        });
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

    try {
      const batchNote = 'IMPORT_BATCH:' + batchId;
      const priorBatch = (await supabaseRequest(
        'shipments?select=id,notes&notes=eq.' + encodeURIComponent(batchNote) + '&limit=1'
      ) || [])[0];
      if (priorBatch) {
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

      const snapshot = await getSnapshot();
      const productByKey = new Map();
      for (const product of snapshot.products) {
        const key = productKey(product);
        if (!productByKey.has(key)) productByKey.set(key, product);
      }
      const inventoryByKey = new Map(snapshot.inventory.map(function (item) {
        return [
          String(item.branch_id) + '|' + String(item.product_id),
          item
        ];
      }));

      let createdProducts = 0;
      let updatedProducts = 0;
      let updatedInventory = 0;
      let importedQuantity = 0;

      for (const entry of preparedByKey.entries()) {
        const key = entry[0];
        const row = entry[1];
        const productFields = {
          name_ar: row.name_ar,
          name_en: row.name_en,
          grade: row.grade,
          weight_kg: row.weight_kg,
          purchase_price_usd: row.purchase_price_usd,
          invoice_quantity: row.quantity,
          total_weight_kg: row.total_weight_kg,
          invoice_total_usd: row.invoice_total_usd
        };

        let product = productByKey.get(key);
        if (!product) {
          const inserted = await supabaseRequest('products', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(productFields)
          });
          if (!Array.isArray(inserted) || !inserted[0]) {
            throw new Error('لم ترجع قاعدة البيانات رقم الصنف الجديد.');
          }
          product = inserted[0];
          productByKey.set(key, product);
          createdProducts += 1;
        } else {
          await supabaseRequest(
            'products?id=eq.' + encodeURIComponent(product.id),
            {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify(productFields)
            }
          );
          Object.assign(product, productFields);
          updatedProducts += 1;
        }

        const inventoryKey = String(branchId) + '|' + String(product.id);
        const current = inventoryByKey.get(inventoryKey);
        if (current) {
          const targetQuantity = mode === 'replace'
            ? row.quantity
            : rowNum(current.quantity) + row.quantity;
          await supabaseRequest(
            'inventory?branch_id=eq.' + branchId + '&product_id=eq.' + encodeURIComponent(product.id),
            {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify({ quantity: targetQuantity })
            }
          );
          current.quantity = targetQuantity;
        } else {
          const created = {
            branch_id: branchId,
            product_id: product.id,
            quantity: row.quantity
          };
          await supabaseRequest('inventory', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(created)
          });
          inventoryByKey.set(inventoryKey, created);
        }
        updatedInventory += 1;
        importedQuantity += row.quantity;
      }

      await supabaseRequest('shipments', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          supplier: 'كشف مستورد',
          supplier_id: null,
          container_name: 'الجدول الجديد',
          purchase_date: today(),
          arrival_date: today(),
          fx: 0,
          season: String(input.season || 'شتوي'),
          customs: 0,
          clearance: 0,
          other_cost: 0,
          notes: batchNote
        })
      });

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
      res.status(400).json({ error: error.message });
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

    try {
      const snapshot = await getSnapshot();
      const fromRow = snapshot.inventory.find(function (item) {
        return String(item.product_id) === productId &&
          Number(item.branch_id) === fromBranch;
      });
      const available = rowNum(fromRow && fromRow.quantity);
      if (available < quantity) {
        throw new Error('الكمية المتاحة ' + available + ' فقط.');
      }

      const toRow = snapshot.inventory.find(function (item) {
        return String(item.product_id) === productId &&
          Number(item.branch_id) === toBranch;
      });

      await supabaseRequest(
        'inventory?branch_id=eq.' + fromBranch + '&product_id=eq.' + encodeURIComponent(productId),
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ quantity: available - quantity })
        }
      );

      if (toRow) {
        await supabaseRequest(
          'inventory?branch_id=eq.' + toBranch + '&product_id=eq.' + encodeURIComponent(productId),
          {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ quantity: rowNum(toRow.quantity) + quantity })
          }
        );
      } else {
        await supabaseRequest('inventory', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            branch_id: toBranch,
            product_id: productId,
            quantity: quantity
          })
        });
      }

      res.json({ ok: true, message: 'تم نقل المخزون.' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/v2/customers', async function (req, res) {
    const input = req.body || {};
    const name = String(input.name || '').trim();
    if (!name) return res.status(400).json({ error: 'أدخل اسم الزبون.' });

    try {
      await supabaseRequest('customers', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          name: name,
          phone: String(input.phone || ''),
          debt: Number(input.debt || 0)
        })
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
};

