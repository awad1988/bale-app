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

  function productKey(row, season) {
    const name = normalizeName(row.name_en) || normalizeArabic(row.name_ar);
    return [
      name,
      normalizeGrade(row.grade),
      Number(row.weight_kg || row.weight || 0),
      normalizeArabic(season || 'شتوي')
    ].join('|');
  }

  function isMissingTable(error) {
    return /(does not exist|not found|PGRST205|Could not find)/i.test(
      String(error && error.message || error || '')
    );
  }

  async function getMovements() {
    try {
      return await supabaseRequest(
        'stock_movements?select=id,bale_id,branch_id,qty,date,notes&order=id.asc'
      ) || [];
    } catch (error) {
      if (isMissingTable(error)) {
        throw new Error('جدول حركات المخزون غير موجود في قاعدة البيانات.');
      }
      throw error;
    }
  }

  app.get('/api/v2/data', async function (_req, res) {
    try {
      const result = await Promise.all([
        supabaseRequest(
          'bales?select=id,shipment_id,name_ar,name_en,grade,weight,buy_usd,status,created_at&order=created_at.asc'
        ),
        getMovements(),
        supabaseRequest(
          'customers?select=id,name,phone,debt,created_at&created_at=gt.2026-09-04T18%3A35%3A00Z&order=created_at.asc'
        )
      ]);
      const bales = result[0] || [];
      const movements = result[1] || [];
      const customers = result[2] || [];

      const products = bales.map(function (item) {
        return {
          id: item.id,
          name_ar: item.name_ar || '',
          name_en: item.name_en || '',
          grade: item.grade || '',
          weight_kg: rowNum(item.weight),
          purchase_price_usd: rowNum(item.buy_usd),
          status: item.status || '',
          shipment_id: item.shipment_id || null
        };
      });

      const byProductBranch = new Map();
      for (const movement of movements) {
        const key = String(movement.bale_id) + '|' + String(movement.branch_id);
        const existing = byProductBranch.get(key) || {
          product_id: movement.bale_id,
          branch_id: Number(movement.branch_id),
          quantity: 0
        };
        existing.quantity += rowNum(movement.qty);
        byProductBranch.set(key, existing);
      }

      const productById = new Map(products.map(function (item) {
        return [String(item.id), item];
      }));
      const inventory = Array.from(byProductBranch.values())
        .filter(function (item) {
          return item.quantity !== 0 && productById.has(String(item.product_id));
        })
        .map(function (item) {
          return Object.assign({}, productById.get(String(item.product_id)), item);
        });

      res.json({
        products: products,
        inventory: inventory,
        customers: customers.map(function (item) {
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
    const season = String(input.season || 'شتوي').trim() || 'شتوي';
    const batchId = String(input.batch_id || '').trim();

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
      const weight = Number(raw.weight_kg || raw.weight || 0);
      const price = Number(raw.purchase_price_usd == null ? raw.buy_usd || 0 : raw.purchase_price_usd);
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
      const key = productKey(prepared, season);
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
      let shipment = (await supabaseRequest(
        'shipments?select=id,season,notes&notes=eq.' + encodeURIComponent(batchNote) + '&limit=1'
      ) || [])[0];

      if (!shipment) {
        const shipmentId = crypto.randomUUID();
        const inserted = await supabaseRequest('shipments', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            id: shipmentId,
            supplier: 'كشف مستورد',
            supplier_id: null,
            container_name: 'الجدول الجديد',
            purchase_date: today(),
            arrival_date: today(),
            fx: 0,
            season: season,
            customs: 0,
            clearance: 0,
            other_cost: 0,
            notes: batchNote
          })
        });
        shipment = Array.isArray(inserted) && inserted[0]
          ? inserted[0]
          : { id: shipmentId, season: season, notes: batchNote };
      }

      const snapshot = await Promise.all([
        supabaseRequest(
          'bales?select=id,shipment_id,name_ar,name_en,grade,weight,buy_usd,status'
        ),
        supabaseRequest('shipments?select=id,season'),
        getMovements()
      ]);
      const allBales = snapshot[0] || [];
      const shipments = snapshot[1] || [];
      const movements = snapshot[2] || [];

      const seasonByShipment = new Map(shipments.map(function (item) {
        return [String(item.id), item.season || ''];
      }));
      const baleByKey = new Map();
      for (const bale of allBales) {
        const key = productKey({
          name_en: bale.name_en,
          name_ar: bale.name_ar,
          grade: bale.grade,
          weight_kg: bale.weight
        }, seasonByShipment.get(String(bale.shipment_id)) || '');
        if (!baleByKey.has(key)) baleByKey.set(key, bale);
      }

      const completedMarkers = new Set(movements.map(function (item) {
        return String(item.notes || '');
      }));
      let createdProducts = 0;
      let addedMovements = 0;
      let skippedRows = 0;
      let importedQuantity = 0;

      for (const entry of preparedByKey.entries()) {
        const key = entry[0];
        const row = entry[1];
        const digest = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
        const marker = 'IMPORT:' + batchId + ':' + digest;
        if (completedMarkers.has(marker)) {
          skippedRows += 1;
          continue;
        }

        let bale = baleByKey.get(key);
        if (!bale) {
          const id = crypto.randomUUID();
          const inserted = await supabaseRequest('bales', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
              id: id,
              shipment_id: shipment.id,
              grade: row.grade,
              name_en: row.name_en,
              name_ar: row.name_ar,
              weight: row.weight_kg,
              buy_usd: row.purchase_price_usd,
              status: 'في المخزون'
            })
          });
          bale = Array.isArray(inserted) && inserted[0] ? inserted[0] : {
            id: id,
            shipment_id: shipment.id,
            grade: row.grade,
            name_en: row.name_en,
            name_ar: row.name_ar,
            weight: row.weight_kg,
            buy_usd: row.purchase_price_usd,
            status: 'في المخزون'
          };
          baleByKey.set(key, bale);
          createdProducts += 1;
        }

        await supabaseRequest('stock_movements', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            bale_id: bale.id,
            branch_id: branchId,
            qty: row.quantity,
            date: today(),
            notes: marker
          })
        });
        completedMarkers.add(marker);
        addedMovements += 1;
        importedQuantity += row.quantity;
      }

      res.json({
        ok: true,
        batch_id: batchId,
        branch_id: branchId,
        unique_rows: preparedByKey.size,
        created_products: createdProducts,
        added_movements: addedMovements,
        skipped_rows: skippedRows,
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
      const movements = await getMovements();
      const available = movements
        .filter(function (item) {
          return String(item.bale_id) === productId &&
            Number(item.branch_id) === fromBranch;
        })
        .reduce(function (sum, item) {
          return sum + rowNum(item.qty);
        }, 0);
      if (available < quantity) {
        throw new Error('الكمية المتاحة ' + available + ' فقط.');
      }

      const transferId = crypto.randomUUID();
      await supabaseRequest('stock_movements', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([
          {
            bale_id: productId,
            branch_id: fromBranch,
            qty: -quantity,
            date: today(),
            notes: 'TRANSFER:' + transferId + ':OUT'
          },
          {
            bale_id: productId,
            branch_id: toBranch,
            qty: quantity,
            date: today(),
            notes: 'TRANSFER:' + transferId + ':IN'
          }
        ])
      });
      res.json({ ok: true, message: 'تم نقل المخزون وتسجيل الحركة.' });
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

