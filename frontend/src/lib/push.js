import { apiClient } from './api.js';

function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(normalized);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function subscriptionUsesKey(subscription, applicationServerKey) {
    const subscribedKey = subscription?.options.applicationServerKey;
    if (!subscribedKey) return false;

    const bytes = new Uint8Array(subscribedKey);
    return bytes.length === applicationServerKey.length &&
        bytes.every((byte, index) => byte === applicationServerKey[index]);
}

export function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    return navigator.serviceWorker.ready;
}

export async function syncPushSubscription() {
    if (!pushSupported() || Notification.permission !== 'granted') return false;

    const registration = await registerServiceWorker();
    if (!registration) return false;

    const { publicKey } = await apiClient.get('/notifications/vapid-public-key');
    if (!publicKey) return false;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return false;
    if (!subscriptionUsesKey(subscription, urlBase64ToUint8Array(publicKey))) return false;

    await apiClient.post('/notifications/subscriptions', subscription.toJSON());
    return true;
}

export async function enablePush() {
    if (!pushSupported()) {
        return {
            ok: false,
            reason:
                'This browser does not support push notifications. On iPhone or iPad, add the app to your Home Screen first (iOS 16.4+).',
        };
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        return { ok: false, reason: 'Notification permission was not granted' };
    }

    const { publicKey } = await apiClient.get('/notifications/vapid-public-key');
    if (!publicKey) return { ok: false, reason: 'Push notifications are not configured on the server' };

    const registration = await registerServiceWorker();
    if (!registration) return { ok: false, reason: 'Service worker registration failed' };

    const applicationServerKey = urlBase64ToUint8Array(publicKey);
    let subscription = await registration.pushManager.getSubscription();

    if (subscription && !subscriptionUsesKey(subscription, applicationServerKey)) {
        await subscription.unsubscribe();
        subscription = null;
    }

    if (!subscription) {
        try {
            subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
            });
        } catch (error) {
            if (error?.name === 'AbortError' && /push service/i.test(error.message)) {
            console.error('The browser push service rejected the subscription request.', error);
            return { ok: false, reason: 'notifications.pushServiceUnavailable' };
            }
            throw error;
        }
    }

    await apiClient.post('/notifications/subscriptions', subscription.toJSON());
    return { ok: true };
}

export function pushState() {
    if (!pushSupported()) return 'unsupported';
    return Notification.permission;
}
