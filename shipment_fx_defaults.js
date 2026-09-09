module.exports = function registerShipmentFxDefaults(ctx) {
  const app = ctx.app;
  const supabaseRequest = ctx.supabaseRequest;
  const DEFAULT_FX = 0.709;

  async function fetchAllShipments() {
    const out = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 10000; offset += pageSize) {
      const rows = await supabaseRequest('shipments?select=id,fx,container_name,notes&limit=' + pageSize + '&offset=' + offset);
      const page = Array.isArray(rows) ? rows : [];
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  }

  async function applyDefaultFx() {
    const shipments = await fetchAllShipments();
    const missing = shipments.filter(s => !(Number(s.fx || 0) > 0));
    for (const shipment of missing) {
      await supabaseRequest('shipments?id=eq.' + encodeURIComponent(shipment.id), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ fx: DEFAULT_FX })
      });
    }
    return { total: shipments.length, updated: missing.length, fx: DEFAULT_FX };
  }

  // Idempotent startup repair for the existing imported shipments.
  setTimeout(() => {
    applyDefaultFx().catch(error => console.error('shipment fx default repair failed:', error.message));
  }, 1000);

  app.get('/api/v5/fx/status', async function (_req, res) {
    try {
      const shipments = await fetchAllShipments();
      res.set && res.set('Cache-Control', 'no-store');
      res.json({
        ok: true,
        default_fx: DEFAULT_FX,
        shipments: shipments.map(s => ({
          id: s.id,
          container: s.container_name || '',
          fx: Number(s.fx || 0),
          has_fx: Number(s.fx || 0) > 0
        }))
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/v5/fx/apply-default', async function (_req, res) {
    try {
      res.json({ ok: true, ...(await applyDefaultFx()) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
};
