const fs = require('fs');
const Module = require('module');

const originalReadFileSync = fs.readFileSync.bind(fs);
const originalCompile = Module.prototype._compile;

fs.readFileSync = function(file, options){
  const result = originalReadFileSync(file, options);
  const fileName = String(file || '');
  const encoding = typeof options === 'string' ? options : options && options.encoding;

  if (fileName.endsWith('/server.js') || fileName.endsWith('\\server.js')) {
    const src = Buffer.isBuffer(result) ? result.toString(encoding || 'utf8') : String(result);
    const patched = src.replace(
      "app.use(express.static(__dirname));",
      `app.get('/', (_req, res) => {\n  try {\n    let html = require('fs').readFileSync(require('path').join(__dirname, 'index.html'), 'utf8');\n    if (!html.includes('sale_patch.js')) {\n      html = html.replace('</body>', '<script src=\"/sale_patch.js?v=5\"></script></body>');\n    }\n    if (!html.includes('catalog_patch.js')) {\n      html = html.replace('</body>', '<script src=\"/catalog_patch.js?v=2\"></script></body>');\n    }\n    if (!html.includes('shipment_remove_patch.js')) {\n      html = html.replace('</body>', '<script src=\"/shipment_remove_patch.js?v=1\"></script></body>');\n    }\n    if (!html.includes('reset_experimental_patch.js')) {\n      html = html.replace('</body>', '<script src=\"/reset_experimental_patch.js?v=1\"></script></body>');\n    }\n    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');\n    res.set('Pragma', 'no-cache');\n    res.set('Expires', '0');\n    res.type('html').send(html);\n  } catch (e) {\n    res.status(500).send(e.message);\n  }\n});\napp.use(express.static(__dirname, { etag: false, maxAge: 0 }));`
    );
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
