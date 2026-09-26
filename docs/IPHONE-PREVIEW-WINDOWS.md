# GHOST iPhone Preview on Windows

This is a development-only interactive phone frame for working on UI and interaction in VS Code. It is not Apple's iOS Simulator.

## Start

```powershell
npm.cmd run preview
```

Open:

http://127.0.0.1:5173/preview/

In VS Code, run the task **GHOST: Start iPhone Preview** from Terminal -> Run Task, then use the built-in Simple Browser and dock it to the right side.

The preview lets you switch device and portrait/landscape and click the real GHOST web UI inside the phone frame.

Real camera/permissions/native iOS behavior must still be tested with Xcode on macOS.
