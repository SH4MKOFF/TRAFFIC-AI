/*
 * GHOST native bridge.
 *
 * Stage 1 keeps the existing web app intact. In the native build this bridge
 * will talk to a custom Capacitor Swift plugin for iOS-only capabilities:
 * - prevent automatic screen lock while Camera mode is active;
 * - app lifecycle / foreground detection;
 * - native camera health information where needed;
 * - future native camera capture fallback if WKWebView media capture proves
 * insufficient for long-running Camera mode.
 *
 * Browser/PWA fallback intentionally uses the existing Wake Lock API when
 * available, so the web build remains functional.
 */

let webWakeLock = null;

export async function setKeepAwake(enabled) {
  const plugin = globalThis?.Capacitor?.Plugins?.GhostNative;

  if (plugin?.setKeepAwake) {
    try {
      await plugin.setKeepAwake({ enabled: Boolean(enabled) });
      return true;
    } catch (error) {
      console.warn('[GHOST] Native keep-awake failed:', error);
    }
  }

  if ('wakeLock' in navigator) {
    try {
      if (enabled) {
        webWakeLock = await navigator.wakeLock.request('screen');
      } else if (webWakeLock) {
        await webWakeLock.release();
        webWakeLock = null;
      }
      return true;
    } catch (error) {
      console.warn('[GHOST] Web Wake Lock unavailable:', error);
    }
  }

  return false;
}

export async function notifyLifecycle(event) {
  const plugin = globalThis?.Capacitor?.Plugins?.GhostNative;
  if (plugin?.lifecycle) {
    try {
      await plugin.lifecycle({ event });
    } catch (error) {
      console.warn('[GHOST] Lifecycle bridge failed:', error);
    }
  }
}
