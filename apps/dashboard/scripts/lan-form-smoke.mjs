// Native navigation must supply its own Origin; never set browser extra headers.
// Only an intentionally invalid value is submitted; no login secret is needed.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.argv[2] || 'http://127.0.0.1:18080';
const channel = process.env.LAN_FORM_BROWSER_CHANNEL;
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
try {
  const page = await browser.newPage();
  const form = await page.goto(`${origin}/lan-login`);
  assert.equal(form.status(), 200);
  const headers = await form.allHeaders();
  assert.equal(headers['referrer-policy'], 'same-origin');
  assert.equal(headers['x-content-type-options'].split(',').at(-1).trim(), 'nosniff');
  assert.equal(headers['cache-control'].split(',').at(-1).trim(), 'no-store');
  await page.getByLabel('ログイントークン').fill('intentionally-invalid-browser-regression');
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url() === `${origin}/lan-login` && r.request().method() === 'POST'),
    page.getByRole('button', { name: '検証ユーザーでログイン' }).click(),
  ]);
  const requestHeaders = await response.request().allHeaders();
  assert.equal(requestHeaders.origin, origin);
  assert.equal(requestHeaders.host, new URL(origin).host);
  assert.equal(response.status(), 401);
  assert.equal((await response.json()).error.code, 'lan_login_invalid_or_expired');
  // Other routes retain their original privacy policy.
  const app = await page.goto(`${origin}/app`);
  assert.equal((await app.allHeaders())['referrer-policy'], 'no-referrer');
  console.log(JSON.stringify({ native_form_origin: origin, host_port_preserved: true,
    login_policy: 'same-origin', other_routes_policy: 'no-referrer',
    invalid_secret_status: 401, success: true }));
} finally {
  await browser.close();
}
