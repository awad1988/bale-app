const crypto = require('crypto');
const zlib = require('zlib');

module.exports = function registerBackupService(ctx) {
  const app = ctx.app;
  const fetchAll = ctx.supabaseRequestAll;
  const tables = [
    'shipments', 'bales', 'customers', 'payments', 'sales', 'expenses',
    'cash_movements', 'suppliers', 'supplier_payments', 'supplier_purchases',
    'inventory', 'stock_movements'
  ];
  const optionalTables = new Set(['inventory', 'stock_movements', 'supplier_purchases']);
  let running = false;
  let lastResult = null;

  function ammanNow() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    return Object.fromEntries(parts.map(part => [part.type, part.value]));
  }

  function encryptionKey() {
    const key = Buffer.from(String(process.env.BACKUP_ENCRYPTION_KEY || '').trim(), 'base64');
    if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY يجب أن يكون مفتاح Base64 بطول 32 بايت.');
    return key;
  }

  function encrypt(buffer) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return Buffer.concat([Buffer.from('BALEBACKUP1'), iv, cipher.getAuthTag(), encrypted]);
  }

  async function collectSnapshot() {
    const data = {};
    for (const table of tables) {
      try {
        data[table] = await fetchAll(`${table}?select=*`);
      } catch (error) {
        if (optionalTables.has(table) && /(does not exist|not found|PGRST205|Could not find)/i.test(String(error.message))) {
          data[table] = [];
          continue;
        }
        throw new Error(`تعذر نسخ جدول ${table}: ${error.message}`);
      }
    }
    return {
      format: 'bale-agency-backup',
      version: 1,
      created_at: new Date().toISOString(),
      timezone: 'Asia/Amman',
      tables: data
    };
  }

  async function storageRequest(path, options = {}) {
    const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
    if (!base || !key) throw new Error('إعدادات Supabase غير مكتملة.');
    const response = await fetch(`${base}/storage/v1/${path}`, {
      ...options,
      headers: { apikey: key, Authorization: `Bearer ${key}`, ...(options.headers || {}) }
    });
    const text = await response.text();
    let body = text;
    try { body = text ? JSON.parse(text) : null; } catch (_) {}
    if (!response.ok) throw new Error(body?.message || body?.error || text || `Storage error ${response.status}`);
    return body;
  }

  async function ensureBucket() {
    const bucket = String(process.env.BACKUP_BUCKET || 'bale-backups');
    try {
      await storageRequest(`bucket/${encodeURIComponent(bucket)}`);
    } catch (error) {
      if (!/(not found|404)/i.test(String(error.message))) throw error;
      await storageRequest('bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bucket, name: bucket, public: false })
      });
    }
    return bucket;
  }

  async function uploadSupabase(name, bytes) {
    const bucket = await ensureBucket();
    const encodedName = name.split('/').map(encodeURIComponent).join('/');
    await storageRequest(`object/${encodeURIComponent(bucket)}/${encodedName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
      body: bytes
    });
    return `${bucket}/${name}`;
  }

  function parseServiceAccount() {
    const raw = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) {}
    try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch (_) {}
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON غير صالح.');
  }

  function base64url(value) {
    return Buffer.from(value).toString('base64url');
  }

  async function googleAccessToken(account) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/drive.file',
      aud: account.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    }));
    const unsigned = `${header}.${claims}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url');
    const assertion = `${unsigned}.${signature}`;
    const response = await fetch(account.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) throw new Error(body.error_description || body.error || 'تعذر تسجيل Google Drive.');
    return body.access_token;
  }

  async function uploadGoogleDrive(fileName, bytes) {
    const account = parseServiceAccount();
    const folderId = String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
    if (!account || !folderId) return { configured: false };
    const token = await googleAccessToken(account);
    const boundary = `bale_${crypto.randomBytes(12).toString('hex')}`;
    const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--`)
    ]);
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error?.message || `Google Drive error ${response.status}`);
    return { configured: true, id: result.id, name: result.name };
  }

  async function runBackup({ forceDrive = false } = {}) {
    if (running) throw new Error('توجد عملية نسخ احتياطي قيد التنفيذ.');
    running = true;
    try {
      const local = ammanNow();
      const date = `${local.year}-${local.month}-${local.day}`;
      const fileName = `bale-backup-${date}.json.gz.enc`;
      const snapshot = await collectSnapshot();
      const encrypted = encrypt(zlib.gzipSync(Buffer.from(JSON.stringify(snapshot))));
      const supabasePath = await uploadSupabase(`daily/${date}/${fileName}`, encrypted);
      const shouldDrive = forceDrive || local.weekday === 'Sun';
      const drive = shouldDrive ? await uploadGoogleDrive(fileName, encrypted) : { configured: Boolean(parseServiceAccount()) };
      lastResult = {
        ok: true,
        created_at: snapshot.created_at,
        date,
        bytes: encrypted.length,
        supabase_path: supabasePath,
        drive
      };
      return lastResult;
    } finally {
      running = false;
    }
  }

  function requireAdminPin(req) {
    const configured = String(process.env.APP_ADMIN_PIN || '');
    if (!configured || String(req.get('x-admin-pin') || '') !== configured) throw new Error('رمز التأكيد الإداري غير صحيح.');
  }

  app.get('/api/v7/backups/status', (_req, res) => {
    res.json({
      enabled: Boolean(process.env.BACKUP_ENCRYPTION_KEY),
      drive_configured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_DRIVE_FOLDER_ID),
      schedule: '03:00 Asia/Amman daily; Sunday copy to Google Drive',
      running,
      last_result: lastResult
    });
  });

  app.post('/api/v7/backups/run', async (req, res) => {
    try {
      requireAdminPin(req);
      if (req.body?.confirmation !== 'BACKUP-CONFIRMED') throw new Error('يجب تأكيد النسخ الاحتياطي.');
      res.json(await runBackup({ forceDrive: Boolean(req.body?.drive) }));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  async function scheduledTick() {
    if (!process.env.BACKUP_ENCRYPTION_KEY || running) return;
    const local = ammanNow();
    const date = `${local.year}-${local.month}-${local.day}`;
    if (Number(local.hour) < 3 || lastResult?.date === date) return;
    try {
      await runBackup();
      console.log(`Daily encrypted backup completed for ${date}.`);
    } catch (error) {
      console.error('Daily backup failed:', error.message);
    }
  }

  const timer = setInterval(scheduledTick, 15 * 60 * 1000);
  timer.unref();
  setTimeout(scheduledTick, 15 * 1000).unref();
};
