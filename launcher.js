const fs = require('fs');

const originalReadFileSync = fs.readFileSync.bind(fs);

fs.readFileSync = function(file, options){
  const result = originalReadFileSync(file, options);
  const fileName = String(file || '');
  const encoding = typeof options === 'string' ? options : options && options.encoding;

  if (fileName.endsWith('/server.js') || fileName.endsWith('\\server.js')) {
    const src = Buffer.isBuffer(result) ? result.toString(encoding || 'utf8') : String(result);
    const patched = src.replace(
      "app.use(express.static(__dirname));",
      `app.get('/', (_req, res) => {\n  try {\n    let html = require('fs').readFileSync(require('path').join(__dirname, 'index.html'), 'utf8');\n    if (!html.includes('sale_patch.js')) {\n      html = html.replace('</body>', '<script src=\"/sale_patch.js?v=4\"></script></body>');\n    }\n    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');\n    res.set('Pragma', 'no-cache');\n    res.set('Expires', '0');\n    res.type('html').send(html);\n  } catch (e) {\n    res.status(500).send(e.message);\n  }\n});\napp.use(express.static(__dirname, { etag: false, maxAge: 0 }));`
    );
    return encoding ? patched : Buffer.from(patched);
  }

  return result;
};

require('./bootstrap.js');
