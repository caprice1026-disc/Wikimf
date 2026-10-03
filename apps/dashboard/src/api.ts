const base = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
let csrfToken = '';
export const setCsrfToken = (value: string) => { csrfToken = value; };
export const apiUrl = (path: string) => `${base}${path}`;

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method || 'GET';
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  if (method !== 'GET') headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(apiUrl(path), { ...options, headers, credentials: 'include', cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== '/me') window.dispatchEvent(new Event('wikimf:auth-expired'));
    throw new ApiError(response.status, body.error?.code || body.detail?.code || 'request_failed');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const mutate = <T>(path: string, method: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'ログインの有効期限が切れました。もう一度ログインしてください。';
    if (error.status === 404) return 'この記録は見つかりません。削除されたか、利用できないページです。';
    if (error.status === 429) return '操作が続いています。少し待ってから再試行してください。';
    if (error.code === 'last_identity') return '最後のログイン方法は解除できません。';
    if (['identity_conflict', 'identity_already_linked'].includes(error.code)) return 'このログイン方法は別のアカウントに連携されています。';
    if (error.code === 'provider_already_linked') return 'このログイン方法はすでに追加されています。';
    if (error.code === 'reauthentication_required') return 'この操作には再認証が必要です。ログインし直してください。';
    if (error.status === 403) return 'この操作を完了できません。再読み込みしてログイン状態を確認してください。';
    if (error.status === 410) return 'この端末連携は期限切れです。端末から連携をやり直してください。';
  }
  return 'データを取得できませんでした。接続を確認して再試行してください。';
}

export function safeWikipediaUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ['ja.wikipedia.org', 'en.wikipedia.org'].includes(parsed.hostname)
      && !parsed.username && !parsed.password && !parsed.port ? parsed.href : null;
  } catch { return null; }
}

export function safeRedirect(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/app') ? parsed.pathname + parsed.search : null;
  } catch { return null; }
}
