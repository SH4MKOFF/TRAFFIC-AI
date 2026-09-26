# GHOST Native Stage 2

This folder contains the first native iOS bridge layer.

## On a Mac

1. Open the project in Terminal.
2. Run `npm install`.
3. Install the iOS platform with `npm install @capacitor/ios`.
4. Run `npx cap add ios` once.
5. Add `GhostNativePlugin.swift` and `GhostBridgeViewController.swift` to the iOS App target in Xcode.
6. Make the app's bridge view controller use `GhostBridgeViewController`.
7. Run `npx cap sync` and build on a real iPhone.

The plugin provides:
- `GhostNative.setKeepAwake({ enabled })`
- `GhostNative.lifecycle({ event })`

The web app keeps Wake Lock as a browser fallback, so the Windows/web build remains usable.
