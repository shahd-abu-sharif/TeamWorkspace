const BASE = import.meta.env.VITE_API_URL ;
// const BASE = 'https://teamworkspace.onrender.com'

let accessToken = null;
let activeWorkspaceId = localStorage.getItem('tth_workspace');

export const setAccessToken = (t) => {
    accessToken = t;
};
export const getAccessToken = () => accessToken;

export const setActiveWorkspace = (id) => {
    activeWorkspaceId = id;
    if (id) localStorage.setItem('tth_workspace', id);
    else localStorage.removeItem('tth_workspace');
};

export class ApiError extends Error {
    constructor(status, message, issues) {
        super(message);
        this.status = status;
        this.issues = issues;
    }
}

let refreshPromise = null;

async function refreshSession() {
    refreshPromise ??= (async () => {
        try {
            const res = await fetch(`${BASE}/auth/refresh`, {
                method: 'POST',
                credentials: 'include',
            });
            if (!res.ok) return false;
            const data = await res.json();
            setAccessToken(data.accessToken);
            setActiveWorkspace(data.workspaceId);
            return true;
        } catch {
            return false;
        } finally {
            refreshPromise = null;
        }
    })();
    return refreshPromise;
}

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
        fetch(`${BASE}${path}`, {
            ...rest,
            headers: buildHeaders(),
            credentials: 'include',
            body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
        });

    let res = await send();

    if (res.status === 401 && !skipAuth && !path.startsWith('/auth/')) {
        const ok = await refreshSession();
        if (ok) res = await send();
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
            xhr.open('POST', `${BASE}${p}`);
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