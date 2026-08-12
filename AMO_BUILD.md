# AMO source submission for version 0.12.0

This archive contains the human-readable source and data inputs required to reproduce the submitted Firefox extension.

## Build environment

- Ubuntu 24.04 LTS (x86-64 or ARM64)
- Node.js 24.x
- Python 3.12.x
- No npm, pip, network download, package manager, or third-party dependency is required.

Install Node.js from `https://nodejs.org/` or the distribution package manager. Python 3.12 is included with Ubuntu 24.04.

## Build

From the root of this archive, run:

```sh
bash build.sh
```

The script regenerates the compact non-executable ISSN lookup, copies the readable JavaScript, HTML, CSS, manifest, locale, and image files, regenerates the 28 AES-GCM encrypted catalog shards from the supplied plaintext data using the original public IVs, verifies every unpacked file byte-for-byte, and creates `dist/firefox-extension-v0.12.0.zip` using only the Python standard library.

The verified unpacked extension is written to `dist/firefox-extension/`. Reviewers can compare that directory with the unpacked AMO submission. ZIP container metadata may differ, while all contained files are verified byte-for-byte.

Windows convenience command:

```powershell
.\build.ps1
```

The extension source is not transpiled, bundled, concatenated, minified, or obfuscated. Only non-executable catalog data is generated. No private update-signing key is included or required.
