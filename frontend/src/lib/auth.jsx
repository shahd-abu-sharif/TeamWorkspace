import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiClient, setAccessToken, setActiveWorkspace } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [workspaceId, setWorkspace] = useState(null);
    const [loading, setLoading] = useState(true);

    const applySession = (data) => {
        setAccessToken(data.accessToken);
        setActiveWorkspace(data.workspaceId);
        setWorkspace(data.workspaceId);
        setUser(data.user);
    };

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(
                    `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'}/auth/refresh`,
                    { method: 'POST', credentials: 'include' },
                );
                if (res.ok) applySession(await res.json());
            } catch {
                /* not signed in */
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const value = useMemo(
        () => ({
            user,
            workspaceId,
            role: user?.memberships.find((m) => m.workspace.id === workspaceId)?.role ?? null,
            loading,
            login: async (email, password) => {
                const data = await apiClient.post(
                    '/auth/login',
                    { email, password },
                    { skipAuth: true },
                );
                applySession(data);
            },
            logout: async () => {
                await apiClient.post('/auth/logout', undefined, { skipAuth: true });
                setAccessToken(null);
                setActiveWorkspace(null);
                setUser(null);
            },
            refreshMe: async () => {
                const me = await apiClient.get('/auth/me');
                setUser(me);
            },
        }),
        [user, workspaceId, loading],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
}