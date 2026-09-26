# GHOST iOS — FINAL STAGE on Windows

## First setup

From the project root:

```powershell
npm.cmd install
npm.cmd run verify
npm.cmd run sync:web
npm.cmd run prepare:vendor
npm.cmd run verify:ios
```

The browser libraries are declared in `package.json` and are installed by the normal `npm install` step. `prepare:vendor` only copies the already-installed browser bundles into `www/vendor/`; it does **not** spawn a second npm installation.

Expected final result:

```text
GHOST local vendor ready: 5 libraries
iOS preflight: OK
Local AI/WebRTC/QR assets: OK
Native bridge: OK
```

## Preview

```powershell
npm.cmd run preview
```

Open:

```text
http://127.0.0.1:5173/preview/
```

## Important

Do not run `npm audit fix` during this stage. Keep the locked package versions stable until the iOS build is established.
