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

  function normalizeSeason(value) {
    return normalizeArabic(value || 'غير محدد');
  }

  function productKey(row, season) {
    const name = normalizeName(row.name_en) || normalizeArabic(row.name_ar);
    return [
      name,
      normalizeGrade(row.grade),
      Number(row.weight_kg == null ? row.weight : row.weight_kg),
      normalizeSeason(season || row.season)
    ].join('|');
  }

  function stableUuid(value) {
    const chars = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32).split('');
    chars[12] = '5';
    chars[16] = ((parseInt(chars[16], 16) & 3) | 8).toString(16);
    const hex = chars.join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }

  function branchFromStatus(status) {
    const match = String(status || '').match(/\[BRANCH:(\d+)\]/i);
    return match ? Number(match[1]) : 1;
  }

  function branchStatus(branchId) {
    return '[BRANCH:' + Number(branchId) + '] متوفر';
  }

  function isSold(status) {
    return normalizeArabic(status).includes('مباع');
  }

  async function getRawSnapshot() {
    const result = await Promise.all([
      supabaseRequest('shipments?select=id,season,notes&order=created_at.asc'),
      supabaseRequest('bales?select=id,shipment_id,name_ar,name_en,grade,weight,buy_usd,status&order=created_at.asc'),
      supabaseRequest('customers?select=id,name,phone,debt,created_at&created_at=gt.2026-09-04T18%3A35%3A00Z&order=created_at.asc')
    ]);
    return {
      shipments: result[0] || [],
      bales: result[1] || [],
      customers: result[2] || []
    };
  }

  function aggregateSnapshot(snapshot) {
    const shipmentById = new Map(snapshot.shipments.map(item => [String(item.id), item]));
    const productByKey = new Map();
    const inventoryByKey = new Map();

    for (const bale of snapshot.bales) {
      const shipment = shipmentById.get(String(bale.shipment_id)) || {};
      const season = String(shipment.season || 'غير محدد');
      const shaped = {
        name_ar: String(bale.name_ar || ''),
        name_en: String(bale.name_en || ''),
        grade: normalizeGrade(bale.grade),
        weight_kg: rowNum(bale.weight),
        season
      };
      const key = productKey(shaped, season);
      let product = productByKey.get(key);
      if (!product) {
        product = {
          id: stableUuid('product|' + key),
          name_ar: shaped.name_ar,
          name_en: shaped.name_en,
          grade: shaped.grade,
          weight_kg: shaped.weight_kg,
          purchase_price_usd: 0,
          invoice_quantity: 0,
          total_weight_kg: 0,
          invoice_total_usd: 0,
          season
        };
        productByKey.set(key, product);
      }

      product.invoice_quantity += 1;
      product.total_weight_kg += shaped.weight_kg;
      product.invoice_total_usd += rowNum(bale.buy_usd);

      if (!isSold(bale.status)) {
        const branchId = branchFromStatus(bale.status);
        const inventoryKey = branchId + '|' + product.id;
        let inventory = inventoryByKey.get(inventoryKey);
        if (!inventory) {
          inventory = {
            branch_id: branchId,
            product_id: product.id,
            quantity: 0,
            name_ar: product.name_ar,
            name_en: product.name_en,
            grade: product.grade,
            weight_kg: product.weight_kg,
            purchase_price_usd: 0,
            season: product.season
          };
          inventoryByKey.set(inventoryKey, inventory);
        }
        inventory.quantity += 1;
        inventory.purchase_price_usd += rowNum(bale.buy_usd);
      }
    }

    for (const product of productByKey.values()) {
      product.purchase_price_usd = product.invoice_quantity
        ? product.invoice_total_usd / product.invoice_quantity
        : 0;
    }
    for (const inventory of inventoryByKey.values()) {
      inventory.purchase_price_usd = inventory.quantity
        ? inventory.purchase_price_usd / inventory.quantity
        : 0;
    }

    return {
      products: Array.from(productByKey.values()),
      inventory: Array.from(inventoryByKey.values()),
      customers: snapshot.customers.map(item => ({
        id: item.id,
        name: item.name || '',
        phone: item.phone || '',
        debt: rowNum(item.debt)
      }))
    };
  }

  function prepareRows(rows, season) {
    const preparedByKey = new Map();
    for (const raw of rows) {
      const quantity = Number(raw.quantity || 0);
      const weight = Number(raw.weight_kg || 0);
      const price = Number(raw.purchase_price_usd == null ? 0 : raw.purchase_price_usd);
      const nameEn = String(raw.name_en || '').trim();
      const nameAr = String(raw.name_ar || '').trim();
      const grade = normalizeGrade(raw.grade);

      if ((!nameEn && !nameAr) || !Number.isInteger(quantity) || quantity <= 0 || !(weight > 0) || price < 0) {
        throw new Error('بيانات صنف غير مكتملة: ' + (nameAr || nameEn || 'بدون اسم'));
      }

      const prepared = {
        name_en: nameEn,
        name_ar: nameAr,
        grade,
        quantity,
        weight_kg: weight,
        total_weight_kg: Number(raw.total_weight_kg || quantity * weight),
        invoice_total_usd: Number(raw.invoice_total_usd || quantity * price),
        purchase_price_usd: price,
        season
      };
      const key = productKey(prepared, season);
      const existing = preparedByKey.get(key);
      if (existing) {
        existing.quantity += prepared.quantity;
        existing.total_weight_kg += prepared.total_weight_kg;
        existing.invoice_total_usd += prepared.invoice_total_usd;
        existing.purchase_price_usd = existing.invoice_total_usd / existing.quantity;
      } else {
        preparedByKey.set(key, prepared);
      }
    }
    return preparedByKey;
  }

  app.get('/api/v2/health', async function (_req, res) {
    try {
      await Promise.all([
        supabaseRequest('shipments?select=id&limit=1'),
        supabaseRequest('bales?select=id&limit=1')
      ]);
      res.json({ ok: true, database: true, storage: 'bales' });
    } catch (error) {
      res.status(500).json({ ok: false, database: false, error: error.message });
    }
  });

  app.get('/api/v2/data', async function (_req, res) {
    try {
      res.set && res.set('Cache-Control', 'no-store');
      res.json(aggregateSnapshot(await getRawSnapshot()));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/v2/inventory/import', async function (req, res) {
    const input = req.body || {};
    const rows = Array.isArray(input.rows) ? input.rows : [];
    const branchId = Number(input.branch_id || 2);
    const batchId = String(input.batch_id || '').trim();
    const season = String(input.season || 'شتوي').trim() || 'شتوي';

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
      preparedByKey = prepareRows(rows, season);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const batchNote = 'IMPORT_BATCH:' + batchId;
    const pendingNote = 'IMPORT_PENDING:' + batchId;
    const shipmentId = stableUuid('shipment|' + batchId);

    try {
      const completed = (await supabaseRequest(
        'shipments?select=id&notes=eq.' + encodeURIComponent(batchNote) + '&limit=1'
      ) || [])[0];
      if (completed) {
        return res.json({
          ok: true,
          already_imported: true,
          batch_id: batchId,
          branch_id: branchId,
          unique_rows: preparedByKey.size,
          created_products: 0,
          updated_products: 0,
          updated_inventory: 0,
          imported_quantity: 0,
          skipped_rows: preparedByKey.size
        });
      }

      const rawBefore = await getRawSnapshot();
      const aggregateBefore = aggregateSnapshot(rawBefore);
      const existingProductIds = new Set(aggregateBefore.products.map(item => String(item.id)));
      const existingShipment = (await supabaseRequest(
        'shipments?select=id,notes&id=eq.' + encodeURIComponent(shipmentId) + '&limit=1'
      ) || [])[0];

      if (!existingShipment) {
        await supabaseRequest('shipments', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            id: shipmentId,
            supplier: 'كشف مستورد',
            supplier_id: null,
            container_name: 'الجدول الجديد',
            purchase_date: today(),
            arrival_date: today(),
            fx: 0,
            season,
            customs: 0,
            clearance: 0,
            other_cost: 0,
            notes: pendingNote
          })
        });
      }

      const currentBales = await supabaseRequest(
        'bales?select=id&shipment_id=eq.' + encodeURIComponent(shipmentId)
      ) || [];
      const currentIds = new Set(currentBales.map(item => String(item.id)));
      const pendingBales = [];
      let importedQuantity = 0;
      let createdProducts = 0;
      let updatedProducts = 0;

      for (const [key, row] of preparedByKey.entries()) {
        const productId = stableUuid('product|' + key);
        if (existingProductIds.has(productId)) updatedProducts += 1;
        else createdProducts += 1;

        importedQuantity += row.quantity;
        const unitPrice = row.quantity ? row.invoice_total_usd / row.quantity : row.purchase_price_usd;
        for (let index = 1; index <= row.quantity; index += 1) {
          const id = stableUuid('bale|' + batchId + '|' + key + '|' + index);
          if (currentIds.has(id)) continue;
          pendingBales.push({
            id,
            shipment_id: shipmentId,
            grade: row.grade,
            name_en: row.name_en,
            name_ar: row.name_ar,
            weight: row.weight_kg,
            buy_usd: unitPrice,
            status: branchStatus(branchId)
          });
        }
      }

      const chunkSize = 200;
      for (let start = 0; start < pendingBales.length; start += chunkSize) {
        await supabaseRequest('bales', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(pendingBales.slice(start, start + chunkSize))
        });
      }

      await supabaseRequest('shipments?id=eq.' + encodeURIComponent(shipmentId), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ notes: batchNote })
      });

      res.json({
        ok: true,
        already_imported: false,
        batch_id: batchId,
        branch_id: branchId,
        unique_rows: preparedByKey.size,
        created_products: createdProducts,
        updated_products: updatedProducts,
        updated_inventory: preparedByKey.size,
        imported_quantity: importedQuantity,
        inserted_bales: pendingBales.length,
        skipped_rows: 0
      });
    } catch (error) {
      res.status(400).json({
        error: error.message,
        retry_safe: true,
        batch_id: batchId
      });
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
    if (fromBranch === toBranch || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'اختر فرعين مختلفين وكمية صحيحة.' });
    }

    try {
      const raw = await getRawSnapshot();
      const shipmentById = new Map(raw.shipments.map(item => [String(item.id), item]));
      const available = raw.bales.filter(bale => {
        const shipment = shipmentById.get(String(bale.shipment_id)) || {};
        const key = productKey({
          name_ar: bale.name_ar,
          name_en: bale.name_en,
          grade: bale.grade,
          weight_kg: bale.weight
        }, shipment.season);
        return stableUuid('product|' + key) === productId &&
          branchFromStatus(bale.status) === fromBranch &&
          !isSold(bale.status);
      });

      if (available.length < quantity) {
        throw new Error('الكمية المتاحة ' + available.length + ' فقط.');
      }

      const selected = available.slice(0, quantity);
      const chunkSize = 80;
      for (let start = 0; start < selected.length; start += chunkSize) {
        const ids = selected.slice(start, start + chunkSize).map(item => item.id);
        await supabaseRequest('bales?id=in.(' + ids.join(',') + ')', {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: branchStatus(toBranch) })
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
          name,
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
