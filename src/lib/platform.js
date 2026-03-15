import { Capacitor } from '@capacitor/core';

let _isNative = false;
let _platform = 'web';
try {
  _isNative = Capacitor.isNativePlatform();
  _platform = Capacitor.getPlatform();
} catch { /* Capacitor not available */ }

/** True when the app runs inside a Capacitor native shell (Android / iOS). */
export const isNative = _isNative;

/** Current platform: 'android' | 'ios' | 'web' */
export const platform = _platform;

/** True on any mobile (native shell OR mobile browser). */
export const isMobile = isNative || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * Base URL for API calls.
 * On web (browser): empty string (relative URLs work fine with the same-origin server).
 * On native (Capacitor): points to the backend server on the local network.
 * Set VITE_API_URL env var to override, or it falls back to the LAN IP.
 */
export const API_BASE = isNative
  ? (import.meta.env.VITE_API_URL || 'http://192.168.1.177:3000')
  : '';

/**
 * One-time native bridge initialization.
 * Sets status bar style and handles Android back button.
 * Safe to call on web — all imports are tree-shaken or no-op.
 */
export async function initNativeBridge() {
  if (!isNative) return;

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0d1117' });
  } catch { /* plugin not installed */ }

  try {
    const { App: CapApp } = await import('@capacitor/app');
    CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else CapApp.exitApp();
    });
  } catch { /* plugin not installed */ }
}

/**
 * Trigger a light haptic tap (native only, no-op on web).
 */
export async function hapticTap() {
  if (!isNative) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch { /* plugin not installed */ }
}
