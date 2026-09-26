# GHOST iOS — Windows development setup

This repository is intentionally prepared so development can continue on Windows.

## What works on Windows

You can edit the GHOST HTML/CSS/JS, install npm dependencies, verify JavaScript, and prepare/sync the web layer.

## What requires macOS

The actual iOS platform project, Xcode build, signing, device installation and normal iOS debugging require macOS/Xcode. Apple publishes the supported Xcode/macOS combinations and iOS SDK requirements.

## Windows commands

```powershell
cd C:\Users\User\Desktop\VibeCodding\GHOST_IOS_STAGE1
npm install
npm run verify
npm run sync:web
```

On a Mac later:

```bash
npm install
npx cap add ios
npm run cap:sync
npx cap open ios
```

The first actual iOS build should be done from Xcode on a Mac, not simulated on Windows.

## Stage 2 status

The web app now contains a native bridge entry point for Capacitor/iOS.
On Windows, continue using `npm.cmd run verify` and `npm.cmd run sync:web`.
The actual Swift plugin is prepared under `native/GhostNative/` and is wired after the iOS platform is created on macOS/Xcode.

## Final Windows preparation

Run:

```powershell
npm.cmd install
npm.cmd run verify
npm.cmd run sync:web
npm.cmd run prepare:vendor
npm.cmd run verify:ios
```

The iOS preflight must end with `GHOST iOS preflight: OK` before the project is moved to macOS/Xcode.
