import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    apiClient,
    getAccessToken,
    getActiveWorkspace,
    onSessionExpired,
    refreshSession,
    setAccessToken,
    setActiveWorkspace,
} from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [workspaceId, setWorkspace] = useState(() => getActiveWorkspace());
    const [loading, setLoading] = useState(true);
    // Set when the API could not be reached at all — that is not the same thing
    // as "signed out", so the app must not bounce the user to /login for it.
    const [sessionError, setSessionError] = useState(null);

    const applySession = useCallback((data) => {
        setAccessToken(data.accessToken);
        setActiveWorkspace(data.workspaceId);
        setWorkspace(data.workspaceId);
        setUser(data.user);
        setSessionError(null);
    }, []);

    const clearSession = useCallback(() => {
        setAccessToken(null);
        setUser(null);
    }, []);

    const bootstrap = useCallback(async () => {
        try {
            // Fast path: this tab already holds a valid access token (kept in
            // sessionStorage), so a reload does not have to depend on the
            // refresh cookie being sent.
            if (getAccessToken()) {
                try {
                    const me = await apiClient.get('/auth/me');
                    const ws = getActiveWorkspace() ?? me.memberships?.[0]?.workspace?.id ?? null;
                    if (ws) setActiveWorkspace(ws);
                    setWorkspace(ws);
                    setUser(me);
                    return;
                } catch (err) {
                    if (err?.status === 401) return; // cookie path below confirms it
                }
            }

            const session = await refreshSession();
            if (session.ok) {
                applySession(session.data);
            } else {
                // `expired` means the cookie is really gone (redirect to login);
                // anything else is the API being unreachable, so offer a retry.
                setSessionError(session.expired ? null : 'network');
            }
        } finally {
            setLoading(false);
        }
    }, [applySession]);

    useEffect(() => {
        void bootstrap();
    }, [bootstrap]);

    // A 401 that survives a refresh attempt means the cookie is gone for good.
    useEffect(() => onSessionExpired(() => setUser(null)), []);

    const value = useMemo(
        () => ({
            user,
            workspaceId,
            role:
                user?.memberships?.find((m) => m.workspace?.id === workspaceId)?.role ??
                user?.memberships?.[0]?.role ??
                null,
            loading,
            sessionError,
            retry: () => {
                setLoading(true);
                return bootstrap();
            },
            login: async (email, password) => {
                const data = await apiClient.post(
                    '/auth/login',
                    { email, password },
                    { skipAuth: true },
                );
                applySession(data);
            },
            logout: async () => {
                try {
                    await apiClient.post('/auth/logout', undefined, { skipAuth: true });
                } finally {
                    clearSession();
                }
            },
            refreshMe: async () => {
                const me = await apiClient.get('/auth/me');
                setUser(me);
            },
        }),
        [user, workspaceId, loading, sessionError, bootstrap, applySession, clearSession],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
}
