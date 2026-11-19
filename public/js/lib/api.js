/** Fetch wrapper: same-origin cookies, CSRF header on state-changing requests, typed errors. */
let csrf = null;

export class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.code = data.code;
    this.fields = data.fields || {};
    this.data = data;
  }
}

export const setCsrf = (t) => { csrf = t; };

async function token() {
  if (!csrf) {
    const r = await fetch('/api/auth/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    csrf = (await r.json()).csrfToken;
  }
  return csrf;
}

export function toQuery(q = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === '' || v === false) continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.set(k, v === true ? 'true' : v);
  }
  return p.toString();
}

export async function api(path, { method = 'GET', body, form, query, headers = {}, signal, retry = true } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (method !== 'GET' && method !== 'HEAD') h['X-CSRF-Token'] = await token();
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const qs = query ? toQuery(query) : '';
  let res;
  try {
    res = await fetch(qs ? `${path}?${qs}` : path, { method, headers: h, body: payload, credentials: 'same-origin', signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Network error — check your connection and try again.');
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (res.ok) {
    if (data && data.csrfToken) csrf = data.csrfToken;
    return data;
  }
  const err = (data && data.error) || {};
  if (res.status === 403 && err.code === 'CSRF_INVALID' && retry) {
    csrf = null;
    return api(path, { method, body, form, query, headers, signal, retry: false });
  }
  if (res.status === 401 && api.onUnauthorized) api.onUnauthorized(err);
  if (res.status === 403 && err.code === 'ACCOUNT_NOT_APPROVED' && api.onNotApproved) api.onNotApproved(err);
  throw new ApiError(res.status, err.message || `Request failed (${res.status}).`, { ...err, report: data && data.report });
}

export const get = (path, query, opts = {}) => api(path, { ...opts, query });
export const post = (path, body, opts = {}) => api(path, { ...opts, method: 'POST', body });
export const put = (path, body, opts = {}) => api(path, { ...opts, method: 'PUT', body });
export const patch = (path, body, opts = {}) => api(path, { ...opts, method: 'PATCH', body });
export const del = (path, opts = {}) => api(path, { ...opts, method: 'DELETE' });

/** Multipart upload with progress reporting (fetch cannot report upload progress). */
export async function upload(path, formData, { onProgress, headers = {} } = {}) {
  const t = await token();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-CSRF-Token', t);
    xhr.setRequestHeader('Accept', 'application/json');
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed — check your connection and try again.'));
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      const err = (data && data.error) || {};
      if (xhr.status === 403 && err.code === 'CSRF_INVALID') csrf = null;
      return reject(new ApiError(xhr.status, err.message || (xhr.status === 413 ? 'The file is too large.' : `Upload failed (${xhr.status}).`), { ...err, report: data && data.report }));
    };
    xhr.send(formData);
  });
}
