module.exports = function catalogNameEditorRoutes({ app, supabaseRequest }) {
  app.get('/api/catalog-name-editor', async (_req, res) => {
    try {
      const shipments = await supabaseRequest('shipments?select=id,container,created_at&order=created_at.asc');
      const shipmentIds = (Array.isArray(shipments) ? shipments : []).map(s => String(s.id));
      if (!shipmentIds.length) return res.json({ rows: [], shipmentCount: 0 });

      const bales = await supabaseRequest('bales?select=id,shipment_id,name_en,name_ar,status');
      const selected = (Array.isArray(bales) ? bales : []).filter(b => shipmentIds.includes(String(b.shipment_id)));
      const map = new Map();
      for (const b of selected) {
        const en = String(b.name_en || '').trim();
        if (!en) continue;
        const key = en.toUpperCase();
        if (!map.has(key)) map.set(key, { name_en: en, current_name_ar: String(b.name_ar || '').trim(), total: 0, sold: 0 });
        const row = map.get(key);
        row.total += 1;
        if (/مباع|sold/i.test(String(b.status || ''))) row.sold += 1;
      }
      res.json({
        shipmentCount: shipmentIds.length,
        rows: Array.from(map.values()).sort((a,b)=>a.name_en.localeCompare(b.name_en,'en'))
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/catalog-name-editor/preview', async (req, res) => {
    try {
      const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
      const clean = updates.filter(x => String(x.name_en || '').trim() && String(x.name_ar || '').trim());
      if (!clean.length) return res.json({ changes: [], totalBales: 0 });
      const bales = await supabaseRequest('bales?select=id,name_en,name_ar,status');
      const all = Array.isArray(bales) ? bales : [];
      const changes = clean.map(u => {
        const en = String(u.name_en).trim();
        const ar = String(u.name_ar).trim();
        const matches = all.filter(b => String(b.name_en || '').trim().toUpperCase() === en.toUpperCase());
        return {
          name_en: en,
          old_name_ar: matches[0] ? String(matches[0].name_ar || '') : '',
          new_name_ar: ar,
          affected: matches.length,
          sold: matches.filter(b => /مباع|sold/i.test(String(b.status || ''))).length
        };
      }).filter(x => x.affected > 0);
      res.json({ changes, totalBales: changes.reduce((s,x)=>s+x.affected,0) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/catalog-name-editor/apply', async (req, res) => {
    try {
      const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
      const clean = updates.filter(x => String(x.name_en || '').trim() && String(x.name_ar || '').trim());
      if (!clean.length) throw new Error('لا توجد أسماء عربية جديدة للحفظ.');
      let total = 0;
      for (const u of clean) {
        const en = String(u.name_en).trim();
        const ar = String(u.name_ar).trim();
        const matches = await supabaseRequest(`bales?name_en=ilike.${encodeURIComponent(en)}&select=id,name_en`);
        const exact = (Array.isArray(matches) ? matches : []).filter(b => String(b.name_en || '').trim().toUpperCase() === en.toUpperCase());
        for (const b of exact) {
          await supabaseRequest(`bales?id=eq.${encodeURIComponent(b.id)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ name_ar: ar })
          });
          total += 1;
        }
      }
      res.json({ ok: true, updatedBales: total });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
};
