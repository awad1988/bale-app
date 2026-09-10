const { spawn } = require('child_process');

const port = 18080;
const child = spawn(process.execPath, ['launcher.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(port), SKIP_BOOTSTRAP_FILE_PATCH: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v7/whatsapp/status`);
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start.\n${output}`);
}

(async () => {
  try {
    await waitForServer();
    const [root, whatsapp, backup] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/`).then(r => r.text()),
      fetch(`http://127.0.0.1:${port}/api/v7/whatsapp/status`).then(r => r.json()),
      fetch(`http://127.0.0.1:${port}/api/v7/backups/status`).then(r => r.json())
    ]);
    if (!root.includes('customer_statement_patch.js?v=3-share')) throw new Error('Share patch cache version is missing.');
    if (!root.includes('statement_share_patch.js?v=1')) throw new Error('Final statement share patch is missing.');
    if (whatsapp.configured !== false) throw new Error('WhatsApp must be disabled without credentials.');
    if (backup.enabled !== false) throw new Error('Backups must be disabled without an encryption key.');
    console.log('Smoke test passed.');
  } finally {
    child.kill('SIGTERM');
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
