# Peco-XT extension build

The editable extension sources stay in the project root. Peco-XT is free and open source under the MIT License; all providers, API keys, and refresh controls are available without a license or purchase. To create a separate, obfuscated Opera/Chromium extension build:

```powershell
npm ci
npm run build
```

Load the generated `dist` directory from `opera://extensions` using **Load unpacked**. Re-run the build after changing the extension sources. The build excludes the website, build tooling, archives, CRX packages, and PEM signing keys; it copies the extension assets and manifest, and obfuscates JavaScript without bundling away the files referenced by the manifest.

The release build reports user-facing process messages prefixed with `[ PecoXT ]` rather than request traces or generated answer contents. Failed requests are reported as user notices, and pending provider requests are released so a failed request does not block the next one.

For Opera Add-ons, upload a ZIP containing the *contents* of `dist` (so `manifest.json` is at the ZIP root), not the `dist` folder itself. Use Python's ZIP writer to ensure archive paths use `/`, from the project root:

```powershell
python -c "from pathlib import Path; from zipfile import ZipFile, ZIP_DEFLATED; root=Path('dist'); z=ZipFile('Peco-XT-Opera-v1.1.2.zip','w',ZIP_DEFLATED); [z.write(p,p.relative_to(root).as_posix()) for p in root.rglob('*') if p.is_file()]; z.close()"
```

Never include or publish the `.pem` signing key.

Obfuscation only changes the packaged representation; it does not prevent inspection of an installed extension. Keep private API keys and signing keys out of public source and the `dist` directory.
