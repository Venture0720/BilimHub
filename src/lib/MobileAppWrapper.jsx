import React, { useEffect, useState } from 'react';
import { isMobile, isNative } from './platform';

/**
 * MobileAppWrapper handles:
 * - Online/Offline status banner
 * - Viewport height fix for mobile browsers (100dvh fallback)
 * - Keyboard visibility detection for Capacitor
 */
export function MobileAppWrapper({ children }) {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const root = document.documentElement;
    const isEditableTarget = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return Boolean(target.closest('input, textarea, select, option, [contenteditable="true"], [contenteditable="plaintext-only"], .allow-select'));
    };

    root.classList.toggle('native', isNative);
    root.classList.toggle('touch-ui', isMobile);
    root.classList.toggle('mobile-web', isMobile && !isNative);

    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    // Fix viewport height on mobile browsers (address bar resize)
    function setVH() {
      document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    }
    setVH();
    window.addEventListener('resize', setVH);

    const preventMobileTextActions = (event) => {
      if (!isMobile || isEditableTarget(event.target)) return;
      event.preventDefault();
    };

    document.addEventListener('selectstart', preventMobileTextActions);
    document.addEventListener('contextmenu', preventMobileTextActions);

    // Detect keyboard on native
    if (isNative) {
      let initialHeight = window.innerHeight;
      const checkKeyboard = () => {
        if (window.innerHeight < initialHeight * 0.75) {
          document.body.classList.add('keyboard-open');
        } else {
          document.body.classList.remove('keyboard-open');
          initialHeight = window.innerHeight;
        }
      };
      window.addEventListener('resize', checkKeyboard);
      return () => {
        root.classList.remove('native', 'touch-ui', 'mobile-web');
        document.removeEventListener('selectstart', preventMobileTextActions);
        document.removeEventListener('contextmenu', preventMobileTextActions);
        window.removeEventListener('resize', checkKeyboard);
        window.removeEventListener('offline', goOffline);
        window.removeEventListener('online', goOnline);
        window.removeEventListener('resize', setVH);
      };
    }

    return () => {
      root.classList.remove('native', 'touch-ui', 'mobile-web');
      document.removeEventListener('selectstart', preventMobileTextActions);
      document.removeEventListener('contextmenu', preventMobileTextActions);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('resize', setVH);
    };
  }, []);

  return (
    <>
      {isOffline && <div className="offline-banner">⚡ Нет соединения с интернетом</div>}
      {children}
    </>
  );
}
