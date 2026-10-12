import { apiClient } from './api.js';

function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(normalized);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function enablePush() {
    if (!pushSupported()) {
        return {
            ok: false,
            reason:
                'This browser does not support push notifications. On iPhone or iPad, add the app to your Home Screen first (iOS 16.4+).',
        };
    }

    const registration =
        (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
    if (!registration) return { ok: false, reason: 'Service worker registration failed' };

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        return { ok: false, reason: 'Notification permission was not granted' };
    }

    const { publicKey } = await apiClient.get('/notifications/vapid-public-key');
    if (!publicKey) return { ok: false, reason: 'Push notifications are not configured on the server' };

    const existing = await registration.pushManager.getSubscription();
    const subscription =
        existing ??
        (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

    await apiClient.post('/notifications/subscriptions', subscription.toJSON());
    return { ok: true };
}

export function pushState() {
    if (!pushSupported()) return 'unsupported';
    return Notification.permission;
}
