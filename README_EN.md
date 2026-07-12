# Journal & Conference Rank Assistant

[简体中文](README.md) | [English](README_EN.md)

See journal and conference rankings directly beside academic search results, with no account or sign-in required. The extension supports Google Scholar, DBLP, and commonly used official DBLP mirror domains.

> Firefox listing name: **Journ. & Conf. Rank Assistant**

Project website: https://polarislight.github.io/Journal-Conference-Rank-Assistant/

## Information shown

- CCF A, B, and C recommendations, with a gray `CCF None` badge for unlisted venues
- Combined CAS partition and Top-journal status, such as `CAS Q1 Top`
- JCR Q1-Q4 and Journal Impact Factor reference information
- Web of Science indexing types, including SCIE, SSCI, AHCI, and ESCI
- Venue details such as canonical name, publisher, primary research topics, ISSN, data year, and source
- Opaque hover cards explaining each badge and metric

SCI and SCIE are Web of Science indexing types, not independent quartile systems. What is often called an “SCI Q1 journal” normally refers to its JCR quartile, so this extension does not display a misleading SCI quartile.

## Supported websites

- Google Scholar
- DBLP (`dblp.org`)
- Official DBLP mirror domains under `uni-trier.de` and `dagstuhl.de`

## Installation

Current test packages:

- [Chrome / Chromium CRX v0.10.0](releases/v0.10.0/Journal-Conference-Rank-Assistant-Chrome-v0.10.0.crx)
- [Firefox XPI v0.10.0](releases/v0.10.0/Journal-Conference-Rank-Assistant-Firefox-v0.10.0.xpi)

An unsigned Firefox test package can only be loaded temporarily from `about:debugging#/runtime/this-firefox`. Permanent installation in standard Firefox requires Mozilla signing.

Firefox v0.10.1 has been submitted for a public Mozilla Add-ons review. This section will be updated with the official AMO installation link after approval.

Chrome Web Store publication is currently postponed. On ordinary Windows and macOS installations, a locally signed CRX is not a substitute for Chrome Web Store distribution.

## Data updates

The extension checks this repository's `updates/latest.json` every seven days. It only shows an update notification and does not replace the database without user action. When the user chooses to download an update, the extension:

1. downloads an encrypted `.prdb` data bundle from this repository;
2. verifies its SHA-256 digest;
3. verifies its ECDSA P-256 signature using the public key bundled with the extension; and
4. decrypts and stores the verified data locally using AES-GCM.

The runtime extension does not download CSV files from third-party data repositories. Public upstream data is processed offline by the maintainer when preparing a signed update.

## Privacy and network access

Ranking lookups are performed locally. The extension has no ads, analytics, user tracking, or developer-operated account system. Network access is limited to:

- checking and downloading signed database updates from this repository;
- querying the official DBLP JSON API when a DBLP results page is temporarily unavailable; and
- querying Crossref by journal name or ISSN when publisher or subject metadata is missing, with results cached locally for 30 days.

See the full [Privacy Policy](PRIVACY.md).

## Themes and interaction

- Light, dark, and system-following themes
- Inline badges attached to publication titles
- Hover details for rankings, years, metric meanings, and venue metadata
- Performance-conscious handling of dynamically loaded result pages

## Local data build

After preparing the private CSV inputs, maintainers can run:

```powershell
python scripts/build_private_data.py
python scripts/build_runtime_catalog.py
node scripts/encrypt_runtime_catalog.mjs
node scripts/build_signed_update.mjs 2026.07.12.1
```

Plaintext inputs, private signing keys, and build caches are excluded by `.gitignore`. The public repository contains readable extension source code, encrypted data shards, the verification public key, and signed update bundles.

## Firefox extension ID

The fixed Firefox extension ID is:

```text
journal-conference-rank-assistant@polarislight.github.io
```

Despite its email-like syntax, this is a Mozilla extension identifier, not an email address. It does not need to receive mail and does not create an inbox under `github.io`.

## Support

Please report bugs and feature requests through [GitHub Issues](https://github.com/PolarisLight/Journal-Conference-Rank-Assistant/issues).

## Disclaimer

This project is not affiliated with or endorsed by the China Computer Federation, the National Science Library of the Chinese Academy of Sciences, Clarivate, Google, DBLP, Crossref, or any publisher. Rankings, quartiles, indexing information, and impact factors are provided only as search and submission references. Always consult the latest information published by the relevant official organization or database before making formal evaluation or submission decisions.