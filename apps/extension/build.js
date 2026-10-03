import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import '../../packages/tracker/build.js';
const root = new URL(process.env.WIKIMF_EXTENSION_OUTPUT || './dist/', import.meta.url); await mkdir(root, { recursive: true });
const origin = new URL(process.env.WIKIMF_API_ORIGIN || 'http://localhost:8000');
const dashboard = new URL(process.env.WIKIMF_DASHBOARD_ORIGIN || (origin.protocol==='http:'?'http://localhost:5173':origin.origin));
for (const target of [origin,dashboard]) if (target.username || target.password || target.pathname !== '/' || target.search || target.hash ||
  !(target.protocol === 'https:' || (target.protocol === 'http:' && ['127.0.0.1','localhost'].includes(target.hostname)))) throw new Error('Use HTTPS origins (loopback HTTP is development only).');
const files = ['worker.js','outbox.js','popup.html','popup.js','popup.css','content.js'];
for (const file of files) await copyFile(new URL('./src/' + file, import.meta.url), new URL(file, root));
await copyFile(new URL('../../packages/tracker/dist/wiki-tracker.js', import.meta.url), new URL('wiki-tracker.js', root));
await copyFile(new URL('../../packages/tracker/tracker.js', import.meta.url), new URL('tracker-module.js', root));
await writeFile(new URL('config.js', root), `export const API_ORIGIN=${JSON.stringify(origin.origin)};\nexport const DASHBOARD_ORIGIN=${JSON.stringify(dashboard.origin)};\nexport const CLIENT_VERSION='0.1.0';\n`);
await writeFile(new URL('manifest.json', root), JSON.stringify({ manifest_version: 3, minimum_chrome_version: '114', name: 'wikimf', version: '0.1.0',
  description: '非公開で始める Wikipedia の読書記録。日本語・英語に対応。', incognito: 'not_allowed', permissions: ['storage','alarms'],
  host_permissions: ['https://ja.wikipedia.org/*','https://en.wikipedia.org/*',origin.origin + '/*'],
  background: { service_worker: 'worker.js', type: 'module' }, action: { default_popup: 'popup.html', default_title: 'wikimf' },
  content_scripts: [{ matches: ['https://ja.wikipedia.org/wiki/*','https://ja.wikipedia.org/w/index.php*','https://en.wikipedia.org/wiki/*','https://en.wikipedia.org/w/index.php*'], js: ['wiki-tracker.js','content.js'], all_frames: false, run_at: 'document_idle' }],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" } }, null, 2) + '\n');
console.log(fileURLToPath(root));
