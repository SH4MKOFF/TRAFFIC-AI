# GHOST iOS roadmap

## Stage 1 — Capacitor shell (current)
- Reuse the stable GHOST V93 web application unchanged.
- Add a Capacitor app container and native bridge entry point.
- Keep Camera / Viewer / PeerJS / local AI / archive in the current web layer.
- Add a clean separation point for iOS-only capabilities.

## Stage 2 — Native iOS bridge
- Add a Swift Capacitor plugin (`GhostNative`).
- Keep the iPhone screen awake while Camera mode is active by disabling the iOS idle timer.
- Handle foreground/background lifecycle events.
- Return native device/camera diagnostics to the web UI.
- Do not move working GHOST logic to Swift unnecessarily.

## Stage 3 — iOS camera hardening
- Verify WKWebView `getUserMedia` on the target iOS versions.
- Verify actual camera resolution/aspect ratio in portrait and landscape.
- Verify rotation, interruption handling and resume behavior.
- Only if required, add an AVFoundation capture path as a native fallback.

## Stage 4 — Long-running Camera mode
- Keep the screen from auto-locking while the app remains foreground.
- Detect interruptions and attempt safe resume when the app returns foreground.
- Add connection watchdog / reconnect logic around the existing WebRTC layer.
- Measure battery, thermal load, AI FPS and video FPS over long sessions.

## Stage 5 — Native polish
- Status bar / safe area.
- App icon and launch screen.
- Haptics / notifications as needed.
- Native permission strings.
- Orientation behavior.
- Crash-safe state restoration.

## Stage 6 — TestFlight
- Build on a Mac/Xcode environment.
- Install on real iPhone devices.
- Test Camera ↔ Viewer on the same Wi-Fi and across different networks.
- Test 1–8 hour sessions, reconnects, orientation changes, permissions and low battery.

## Stage 7 — App Store release
- App Store Connect metadata.
- Privacy disclosures and permission descriptions.
- TestFlight sign-off.
- Production archive and submission.
