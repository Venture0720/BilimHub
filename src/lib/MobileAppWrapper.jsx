import React, { useEffect, useState } from 'react';
import { isNative, platform } from './platform';

/**
 * MobileAppWrapper — wraps the entire app when running inside a Capacitor
 * native shell.  Handles:
 *  • Safe-area class injection on <html>
 *  • Keyboard-open body class for layout adjustments
 *  • Splash screen hide once the app is mounted
 *  • Network status banner (offline indicator)
 *
 * On web this is a transparent pass-through (no extra DOM, no listeners).
 */
export function MobileAppWrapper({ children }) {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    // Safe-area + platform classes on <html>
    if (isNative) {
      document.documentElement.classList.add('native', `platform-${platform}`);
    }

    // Hide splash screen once React is mounted
    if (isNative) {
      import('@capacitor/splash-screen')
        .then(({ SplashScreen }) => SplashScreen.hide())
        .catch(() => {});
    }

    // Keyboard open/close detection (native only)
    let keyboardShowCleanup, keyboardHideCleanup;
    if (isNative) {
      import('@capacitor/keyboard').then(({ Keyboard }) => {
        keyboardShowCleanup = Keyboard.addListener('keyboardWillShow', () => {
          document.body.classList.add('keyboard-open');
        });
        keyboardHideCleanup = Keyboard.addListener('keyboardWillHide', () => {
          document.body.classList.remove('keyboard-open');
        });
      }).catch(() => {});
    }

    // Network status listeners
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      keyboardShowCleanup?.then?.(h => h.remove());
      keyboardHideCleanup?.then?.(h => h.remove());
    };
  }, []);

  return (
    <>
      {offline && (
        <div className="offline-banner">
          Нет подключения к интернету
        </div>
      )}
      {children}
    </>
  );
}
