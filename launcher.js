const fs = require('fs');
const Module = require('module');

const originalReadFileSync = fs.readFileSync.bind(fs);
const originalCompile = Module.prototype._compile;

fs.readFileSync = function(file, options){
  const result = originalReadFileSync(file, options);
  const fileName = String(file || '');
  const encoding = typeof options === 'string' ? options : options && options.encoding;

  if (fileName.endsWith('/bootstrap.js') || fileName.endsWith('\\server.js') && false) {
    let src = Buffer.isBuffer(result) ? result.toString(encoding || 'utf8') : String(result);
    const marker = 'replaceOrFail(\n  "module.filename = originalPath;",';
    const start = src.indexOf(marker);
    if (start !== -1) {
      const endMarker = '\nmodule.filename = originalPath;\nmodule.paths';
      const end = src.indexOf(endMarker, start);
      if (end !== -1) src = src.slice(0, start) + src.slice(end);
    }
    return encoding ? src : Buffer.from(src);
  }

  if (fileName.endsWith('/server.js') || fileName.endsWith('\\server.js')) {
    const src = Buffer.isBuffer(result) ? result.toString(encoding || 'utf8') : String(result);
    let patched = src.replace(
      "app.use(express.static(__dirname));",
      `app.get('/', (_req, res) => {\n  try {\n    let html = require('fs').readFileSync(require('path').join(__dirname, 'index.html'), 'utf8');\n    if (!html.includes('sale_patch.js')) html = html.replace('</body>', '<script src=\"/sale_patch.js?v=5\"></script></body>');\n    if (!html.includes('catalog_patch.js')) html = html.replace('</body>', '<script src=\"/catalog_patch.js?v=2\"></script></body>');\n    if (!html.includes('shipment_remove_patch.js')) html = html.replace('</body>', '<script src=\"/shipment_remove_patch.js?v=1\"></script></body>');\n    if (!html.includes('reset_experimental_patch.js')) html = html.replace('</body>', '<script src=\"/reset_experimental_patch.js?v=1\"></script></body>');\n    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');\n    res.set('Pragma', 'no-cache');\n    res.set('Expires', '0');\n    res.type('html').send(html);\n  } catch (e) {\n    res.status(500).send(e.message);\n  }\n});\napp.use(express.static(__dirname, { etag: false, maxAge: 0 }));`
    );

    patched = patched
      .replace("supabaseRequest('customers?select=id,name,debt')", "supabaseRequest('customers?select=id,name,debt,created_at&created_at=gt.2026-09-04T18:35:00Z')")
      .replace("supabaseRequest('customers?select=*&order=created_at.asc')", "supabaseRequest('customers?select=*&created_at=gt.2026-09-04T18:35:00Z&order=created_at.asc')");

    const resetRoute = `app.post('/api/reset-experimental-data', async (req, res) => {\n  const confirmation = String((req.body || {}).confirmation || '');\n  if (confirmation !== 'RESET-ALL-EXPERIMENTAL') return res.status(400).json({ error: 'تأكيد الحذف غير صحيح.' });\n  const tables = ['stock_movements','inventory','sales','payments','customer_payments','supplier_payments','cash_movements','expenses','bales','shipments','customers','suppliers'];\n  const optionalTables = new Set(['stock_movements','inventory']);\n  const deleted = [];\n  const skipped = [];\n  try {\n    for (const tableName of tables) {\n      try {\n        await supabaseRequest(tableName + '?id=not.is.null', { method: 'DELETE', headers: { Prefer: 'return=minimal' } });\n        deleted.push(tableName);\n      } catch (error) {\n        const msg = String(error.message || error);\n        if (optionalTables.has(tableName) && /(does not exist|not found|PGRST205|Could not find|permission denied|42501)/i.test(msg)) { skipped.push(tableName); continue; }\n        throw new Error('تعذر تنظيف جدول ' + tableName + ': ' + msg);\n      }\n    }\n    res.json({ ok: true, deleted, skipped, message: 'تم حذف كل البيانات التشغيلية التجريبية. النظام جاهز للبدء من صفر.' });\n  } catch (e) {\n    res.status(400).json({ error: e.message });\n  }\n});\n\n`;
    patched = patched.replace("app.post('/api/bales', async (req, res) => {", resetRoute + "app.post('/api/bales', async (req, res) => {");
    return encoding ? patched : Buffer.from(patched);
  }

  return result;
};

Module.prototype._compile = function(content, filename){
  if (String(filename || '').endsWith('/server.js') || String(filename || '').endsWith('\\server.js')) {
    content = String(content)
      .replaceAll(".match(/[BALE_ID:([^]]+)]/)", ".match(/\\[BALE_ID:([^\\]]+)\\]/)")
      .replaceAll(".replace(/s*[BALE_ID:[^]]+]s*/g", ".replace(/\\s*\\[BALE_ID:[^\\]]+\\]\\s*/g");
  }
  return originalCompile.call(this, content, filename);
};

require('./bootstrap.js');
