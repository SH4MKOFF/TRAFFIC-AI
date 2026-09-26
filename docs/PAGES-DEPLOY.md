# GitHub Pages deployment

GitHub Pages is configured from `main / (root)`, so the web app files must exist at repository root.

The same web app is also kept in `www/` for Capacitor/iOS.

For each web release, sync `www/` to the repository root before pushing:

```powershell
Copy-Item .\www\* . -Recurse -Force
```
