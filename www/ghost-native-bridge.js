/* GHOST native bridge — Stage 2
 * Browser fallback stays fully functional. On iOS/Capacitor this calls the
 * GhostNative Swift plugin when it is registered.
 */
(() => {
  let webWakeLock = null;

  async function getPlugin() {
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    try {
      const plugins = cap.Plugins || {};
      if (plugins.GhostNative) return plugins.GhostNative;
      return null;
    } catch {
      return null;
    }
  }

  async function setKeepAwake(enabled) {
    const value = Boolean(enabled);
    const plugin = await getPlugin();

    if (plugin?.setKeepAwake) {
      try {
        await plugin.setKeepAwake({ enabled: value });
        return true;
      } catch (error) {
        console.warn('[GHOST] Native keep-awake failed:', error);
      }
    }

    if (!('wakeLock' in navigator)) return false;

    try {
      if (value) {
        if (!webWakeLock || webWakeLock.released) {
          webWakeLock = await navigator.wakeLock.request('screen');
        }
      } else if (webWakeLock) {
        await webWakeLock.release().catch(() => {});
        webWakeLock = null;
      }
      return true;
    } catch (error) {
      console.warn('[GHOST] Web Wake Lock unavailable:', error);
      return false;
    }
  }

  async function lifecycle(event) {
    const plugin = await getPlugin();
    if (!plugin?.lifecycle) return false;
    try {
      await plugin.lifecycle({ event: String(event || '') });
      return true;
    } catch (error) {
      console.warn('[GHOST] Native lifecycle bridge failed:', error);
      return false;
    }
  }

  window.GHOSTNative = Object.freeze({
    setKeepAwake,
    lifecycle,
    isNative: () => Boolean(window.Capacitor?.isNativePlatform?.())
  });
})();
