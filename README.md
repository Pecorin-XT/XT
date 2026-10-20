# Peco-XT browser extension source

This repository contains the source code for **Peco-XT 1.1.2**. Peco-XT is free and open source under the MIT License; every extension feature is available without a license or purchase.

## Build

Requirements: Windows 10/11, Node.js 20 or later, and npm.

From the repository root, run:

```powershell
npm ci
npm run build
```

The production extension is generated in `dist`. To try it in Opera, open `opera://extensions`, enable developer mode, and load the `dist` folder. To submit it to Opera Add-ons, ZIP the *contents* of `dist`, with `manifest.json` at the archive root.

See [BUILD.md](./BUILD.md) for packaging details.

## Privacy and credentials

Peco-XT sends question content to the AI provider selected by the user. The Peco-XT website does not receive AI questions, answers, or API keys. Review the public [privacy policy](https://pecorin-xt.onrender.com/privacy/) for details.

Never add API keys, passwords, environment files, or the private `.pem` signing key to this repository. Build output, CRX packages, and ZIP archives are intentionally excluded.
