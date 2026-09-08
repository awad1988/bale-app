module.exports = function registerInventoryFullRoutes(ctx) {
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;

  async function fetchAll(basePath) {
    const out = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 100000; offset += pageSize) {
      const sep = basePath.includes('?') ? '&' : '?';
      const page = await supabaseRequest(basePath + sep + 'limit=' + pageSize + '&offset=' + offset);
      const rows = Array.isArray(page) ? page : [];
      out.push(...rows);
      if (rows.length < pageSize) break;
    }
    return out;
  }

  app.get('/api/v3/inventory/full', async function (_req, res) {
    try {
      const result = await Promise.all([
        fetchAll('shipments?select=id,season,notes&order=created_at.asc'),
        fetchAll('bales?select=id,shipment_id,name_ar,name_en,grade,weight,buy_usd,status,created_at&order=created_at.asc')
      ]);
      res.set && res.set('Cache-Control', 'no-store');
      res.json({ shipments: result[0], bales: result[1], bale_count: result[1].length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};
