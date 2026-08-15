/**
 * Web Push Notifications utilities (PWA-only).
 *
 * Supports:
 *  - Android Chrome/Edge/Firefox/Samsung Internet (browser or installed PWA)
 *  - Desktop Chrome/Edge/Firefox
 *  - iOS 16.4+ ONLY when the PWA is installed to the home screen
 *    (Safari on iOS refuses `Notification.requestPermission()` unless the
 *    app runs in standalone mode)
 *
 * All functions are no-ops on native React Native (they check
 * `Platform.OS === 'web'` and gate every DOM call behind `typeof window`).
 */

import { Platform } from 'react-native';
import { api } from './api';

export type PushSupport =
  | 'unsupported'          // browser doesn't have Notification / PushManager / SW
  | 'ios-needs-install'    // iOS Safari not in standalone mode → user must "Add to Home"
  | 'ready';               // ready to prompt for permission

const isBrowser = () => Platform.OS === 'web' && typeof window !== 'undefined';

/** True when running inside an installed PWA (standalone display-mode). */
export function isStandalone(): boolean {
  if (!isBrowser()) return false;
  const nav: any = window.navigator;
  if (nav.standalone === true) return true; // iOS Safari home-screen app
  return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
}

/** Detect iOS Safari (or the iOS webview) — needed to gate the "Add to Home" hint. */
export function isIOS(): boolean {
  if (!isBrowser()) return false;
  const ua = window.navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
}

/** Return current support status without prompting. */
export function pushSupport(): PushSupport {
  if (!isBrowser()) return 'unsupported';
  const w: any = window;
  const hasApis =
    'Notification' in w && 'PushManager' in w && 'serviceWorker' in navigator;
  if (!hasApis) return 'unsupported';
  // iOS 16.4+ supports Web Push only in installed PWAs.
  if (isIOS() && !isStandalone()) return 'ios-needs-install';
  return 'ready';
}

/** Current permission state or 'unsupported'. */
export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!isBrowser() || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

function urlB64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Register the service worker at /sw.js (idempotent). */
export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!isBrowser() || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return reg;
  } catch (e) {
    console.warn('SW registration failed', e);
    return null;
  }
}

/** Ask the browser for notification permission (must be inside a user gesture). */
export async function requestPermission(): Promise<NotificationPermission> {
  if (!isBrowser() || !('Notification' in window)) return 'denied';
  const perm = await Notification.requestPermission();
  return perm;
}

/** Full flow: register SW + subscribe + POST to backend. Returns true on success. */
export async function subscribeToPush(): Promise<
  | { ok: true }
  | { ok: false; reason: 'permission' | 'no-support' | 'network' | 'sw' }
> {
  const support = pushSupport();
  if (support !== 'ready') return { ok: false, reason: 'no-support' };
  if (Notification.permission !== 'granted') {
    const perm = await requestPermission();
    if (perm !== 'granted') return { ok: false, reason: 'permission' };
  }
  const reg = await registerSW();
  if (!reg) return { ok: false, reason: 'sw' };

  try {
    // Fetch VAPID public key from backend
    const { publicKey } = await api<{ publicKey: string }>(
      '/push/vapid-public-key',
      { auth: false },
    );
    // Subscribe or reuse existing
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(publicKey),
      });
    }
    const json: any = sub.toJSON();
    await api('/push/subscribe', {
      method: 'POST',
      body: {
        endpoint: json.endpoint,
        keys: {
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
        },
        user_agent: window.navigator.userAgent,
      },
    });
    return { ok: true };
  } catch (e) {
    console.warn('subscribeToPush failed', e);
    return { ok: false, reason: 'network' };
  }
}

/** Unsubscribe this browser from push notifications. */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isBrowser() || !('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return true;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    try {
      await api('/push/unsubscribe', {
        method: 'POST',
        body: { endpoint },
      });
    } catch (_e) {
      // Best-effort — even if backend call fails, the browser subscription is gone.
    }
    return true;
  } catch {
    return false;
  }
}

/** Ask backend to send a test push to the current user. */
export async function sendTestPush(): Promise<{ ok: boolean; detail?: string }> {
  try {
    await api('/push/test', { method: 'POST' });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, detail: e?.message || 'Errore' };
  }
}
