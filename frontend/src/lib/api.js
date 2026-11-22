const ENV_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

// Base URL for every HTTP call.
//
// In dev we always go through the Vite proxy ('/api') so the request is
// same-origin with the app. That keeps the httpOnly refresh cookie working no
// matter which host you open the app on (localhost, 127.0.0.1, a LAN IP...).
// In production VITE_API_URL points at the deployed API.
export const API_BASE = import.meta.env.DEV ? '/api' : ENV_BASE || '/api';

// The socket connects straight to the backend, so it needs an absolute URL.
export const SOCKET_BASE = (ENV_BASE || 'http://localhost:3000/api').replace(/\/api\/?$/, '');

const TOKEN_KEY = 'tth_access';
const WORKSPACE_KEY = 'tth_workspace';

const storage = {
    get: (key) => {
        try {
            return sessionStorage.getItem(key);
        } catch {
            return null;
        }
    },
    set: (key, value) => {
        try {
            if (value) sessionStorage.setItem(key, value);
            else sessionStorage.removeItem(key);
        } catch {
            /* storage unavailable */
        }
    },
};

// A token is useless once expired — never resurrect one from storage.
function isExpired(token) {
    try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return !payload.exp || payload.exp * 1000 <= Date.now() + 5000;
    } catch {
        return true;
    }
}

const storedToken = storage.get(TOKEN_KEY);
let accessToken = storedToken && !isExpired(storedToken) ? storedToken : null;
let activeWorkspaceId = (() => {
    try {
        return localStorage.getItem(WORKSPACE_KEY);
    } catch {
        return null;
    }
})();

export const setAccessToken = (t) => {
    accessToken = t ?? null;
    storage.set(TOKEN_KEY, accessToken);
};
export const getAccessToken = () => accessToken;

export const setActiveWorkspace = (id) => {
    activeWorkspaceId = id ?? null;
    try {
        if (id) localStorage.setItem(WORKSPACE_KEY, id);
        else localStorage.removeItem(WORKSPACE_KEY);
    } catch {
        /* storage unavailable */
    }
};
export const getActiveWorkspace = () => activeWorkspaceId;

export class ApiError extends Error {
    constructor(status, message, issues) {
        super(message);
        this.status = status;
        this.issues = issues;
    }
}

// ------------------------------------------------------------------ session

const sessionExpiredListeners = new Set();

/** Called by AuthProvider so an unrecoverable 401 clears the UI session. */
export function onSessionExpired(listener) {
    sessionExpiredListeners.add(listener);
    return () => sessionExpiredListeners.delete(listener);
}

function notifySessionExpired() {
    for (const listener of sessionExpiredListeners) {
        try {
            listener();
        } catch {
            /* ignore */
        }
    }
}

async function attemptRefresh() {
    let res;
    try {
        res = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
        });
    } catch {
        // network failed / API asleep — not a session problem
        return { ok: false, expired: false };
    }

    if (res.status === 401 || res.status === 403) return { ok: false, expired: true };
    if (!res.ok) return { ok: false, expired: false };

    const data = await res.json();
    setAccessToken(data.accessToken);
    setActiveWorkspace(data.workspaceId);
    return { ok: true, data };
}

let refreshPromise = null;

/**
 * Exchange the httpOnly refresh cookie for a fresh access token.
 *
 * Retries transient failures (API cold start, flaky network) instead of
 * giving up: a single failed attempt used to log the user out on reload.
 * Returns { ok, data?, expired? } — `expired` means the cookie really is gone.
 */
export async function refreshSession({ retries = 2 } = {}) {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        try {
            let result = { ok: false, expired: false };
            for (let i = 0; i <= retries; i += 1) {
                result = await attemptRefresh();
                if (result.ok || result.expired) break;
                if (i < retries) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
            }
            if (result.expired) {
                setAccessToken(null);
                notifySessionExpired();
            }
            return result;
        } finally {
            refreshPromise = null;
        }
    })();

    return refreshPromise;
}

// ------------------------------------------------------------------ requests

export async function api(path, options = {}) {
    const { body, skipAuth, raw, headers, ...rest } = options;

    const buildHeaders = () => {
        const h = { ...(headers ?? {}) };
        if (!raw && body !== undefined) h['Content-Type'] = 'application/json';
        if (!skipAuth && accessToken) h.Authorization = `Bearer ${accessToken}`;
        if (activeWorkspaceId) h['x-workspace-id'] = activeWorkspaceId;
        return h;
    };

    const send = () =>
        fetch(`${API_BASE}${path}`, {
            ...rest,
            headers: buildHeaders(),
            credentials: 'include',
            body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
        });

    let res = await send();

    // An access token can expire between two actions; renew it once and retry.
    if (res.status === 401 && !skipAuth && !path.startsWith('/auth/')) {
        const session = await refreshSession();
        if (session.ok) res = await send();
    }

    if (!res.ok) {
        let message = res.statusText;
        let issues;
        try {
            const data = await res.json();
            message = data.message ?? message;
            issues = data.issues;
        } catch {
            /* non-JSON error body */
        }
        throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : message, issues);
    }

    if (res.status === 204) return undefined;
    return await res.json();
}

export const apiClient = {
    get: (p, o) => api(p, { ...o, method: 'GET' }),
    post: (p, body, o) => api(p, { ...o, method: 'POST', body }),
    patch: (p, body, o) => api(p, { ...o, method: 'PATCH', body }),
    delete: (p, o) => api(p, { ...o, method: 'DELETE' }),
    upload: async (p, file, onProgress) => {
        const form = new FormData();
        form.append('file', file);
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${API_BASE}${p}`);
            if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
            if (activeWorkspaceId) xhr.setRequestHeader('x-workspace-id', activeWorkspaceId);
            xhr.withCredentials = true;
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
            };
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
                else
                    reject(
                        new ApiError(
                            xhr.status,
                            JSON.parse(xhr.responseText || '{}').message ?? 'Upload failed',
                        ),
                    );
            };
            xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
            xhr.send(form);
        });
    },
};
