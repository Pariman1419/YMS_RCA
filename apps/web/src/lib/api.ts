import { PublicClientApplication } from '@azure/msal-browser';
let instance: PublicClientApplication | undefined;
async function client() {
  if (!instance) {
    instance = new PublicClientApplication({
      auth: {
        clientId: process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID || '',
        authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_ENTRA_TENANT_ID}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'sessionStorage' },
    });
    await instance.initialize();
    await instance.handleRedirectPromise();
  }
  return instance;
}
export const localAuth = process.env.NEXT_PUBLIC_AUTH_MODE !== 'entra';
export async function login(username?: string, password?: string) {
  if (localAuth) return api('/auth/login', { username, password });
  const app = await client();
  await app.loginPopup({ scopes: [process.env.NEXT_PUBLIC_ENTRA_SCOPE || ''] });
}
async function token() {
  if (localAuth) return '';
  if (process.env.NEXT_PUBLIC_AUTH_DEMO === 'true') return '';
  const app = await client();
  const account = app.getAllAccounts()[0];
  if (!account) throw new Error('Sign in with your Microsoft account to continue.');
  const scopes = [process.env.NEXT_PUBLIC_ENTRA_SCOPE || ''];
  try {
    return (await app.acquireTokenSilent({ account, scopes })).accessToken;
  } catch {
    return (await app.acquireTokenPopup({ account, scopes })).accessToken;
  }
}
export async function request(path: string, options: RequestInit = {}) {
  const access = await token();
  const response = await fetch((process.env.NEXT_PUBLIC_API_URL || '/api') + path, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...options.headers,
    },
    signal: options.signal || AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.message === 'string'
        ? body.message
        : Array.isArray(body.message)
          ? body.message.join('; ')
          : body.fieldErrors
            ? Object.entries(body.fieldErrors)
                .map(([field, errors]) => `${field}: ${(errors as string[]).join(', ')}`)
                .join('; ')
            : `Request failed (${response.status})`,
    );
  }
  return response;
}
export async function api(path: string, body?: unknown, method = 'POST') {
  return (await request(path, body === undefined ? {} : { method, body: JSON.stringify(body) })).json();
}
export async function download(path: string, name: string) {
  const res = await request(path);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
