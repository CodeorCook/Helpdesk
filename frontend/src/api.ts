export type Role = 'customer' | 'staff' | 'manager';
export type User = { id: string; name: string; email: string; role: Role; role_label: string };
export type Session = { user: User; csrf_token: string | null };
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
let csrfToken: string | null = null;
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (options.method && !['GET','HEAD'].includes(options.method.toUpperCase()) && !['/auth/login','/auth/register'].includes(path)) {
    csrfToken = (await api<{csrf_token:string}>('/auth/csrf')).csrf_token;
  }
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  let response: Response;
  try { response = await fetch(`/api/v1${path}`, {...options, headers, credentials: 'include'}); }
  catch { throw new ApiError(0, 'Không thể kết nối máy chủ. Vui lòng thử lại.'); }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, typeof body.detail === 'string' ? body.detail : 'Yêu cầu không hợp lệ. Vui lòng kiểm tra thông tin.');
  }
  return response.status === 204 ? undefined as T : response.json();
}
export async function signIn(email: string, password: string) {
  const result = await api<Session>('/auth/login', {method: 'POST', body: JSON.stringify({email, password})});
  csrfToken = result.csrf_token; return result.user;
}
export async function signOut() {
  await api<void>('/auth/logout', {method: 'POST'}); csrfToken = null;
}
