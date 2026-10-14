import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken } from './api';
import { useAuth } from './auth.jsx';

const SocketContext = createContext(null);

const SOCKET_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api')
    .replace(/\/api\/?$/, '');

export function SocketProvider({ children }) {
    const { user } = useAuth();
    const [socket, setSocket] = useState(null);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        if (!user) {
            setSocket(null);
            setConnected(false);
            return;
        }

        const token = getAccessToken();
        if (!token) return;

        console.log('[Socket] Connecting to', `${SOCKET_URL}/chat`);

        const s = io(`${SOCKET_URL}/chat`, {
            auth: { token },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 10,
        });

        s.on('connect', () => {
            console.log('[Socket] Connected:', s.id);
            setConnected(true);
        });

        s.on('disconnect', (reason) => {
            console.log('[Socket] Disconnected:', reason);
            setConnected(false);
        });

        s.on('connect_error', (err) => {
            console.error('[Socket] Connection error:', err.message);
        });

        // ⬇️ جديد: إبلاغ السيرفر قبل إغلاق التاب
        const handleBeforeUnload = () => {
            s.emit('presence:leaving');
            s.disconnect();
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        setSocket(s);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            console.log('[Socket] Cleanup');
            s.disconnect();
        };
    }, [user]);

    return (
        <SocketContext.Provider value={{ socket, connected }}>
            {children}
        </SocketContext.Provider>
    );
}

export function useSocket() {
    return useContext(SocketContext);
}