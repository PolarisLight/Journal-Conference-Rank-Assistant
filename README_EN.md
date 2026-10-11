<p align=center><img src=extension/icons/icon128.png width=88 height=88 alt=Extension-icon></p>

<h1 align=center>Journal & Conference Rank Assistant</h1>

<p align=center>See journal and conference rankings beside paper titles. No sign-in, with matching performed locally.</p>

<p align=center>
  <a href=README.md>简体中文</a> ·
  <a href=README_EN.md>English</a> ·
  <a href=https://chromewebstore.google.com/detail/ibanchmlkanbhbddpejommgfhpfofifm>Install for Chrome</a> ·
  <a href=https://addons.mozilla.org/addon/journal-conf-rank-assistant>Install for Firefox</a> ·
  <a href=https://polarislight.github.io/Journal-Conference-Rank-Assistant/>Project website</a> ·
  <a href=https://polarislight.github.io/Journal-Conference-Rank-Assistant/#support>Support the project</a> ·
  <a href=https://github.com/PolarisLight/Journal-Conference-Rank-Assistant/issues>Report an issue</a>
</p>

![Journal and Conference Rank Assistant interface preview](submission/v0.11.0/promo-1400x560-en.png)

## Understand every venue at a glance

The extension places rank badges beside paper titles and explains each badge on hover. Newly loaded results are matched without reopening the popup.

- CCF A, B, and C, with a gray `CCF None` badge for unlisted venues
- Combined CAS partition and Top status, such as `CAS Zone 1 Top`
- JCR Q1-Q4, impact factor, and Web of Science indexing types
- CSSCI, PKU Core, Ei Compendex, XinRui partitions, and the current warning list
- UTD24, FT50, and ABS/AJG 2024 business-journal badges
- Venue details including canonical name, publisher, topics, ISSN, data year, and source
- A draggable page filter for keeping papers by index, partition, or rank
- Multiple independently named custom CSV indexes, with user-defined tiers, badges, and filtering
- Light, dark, and system-following panel themes
- Soft, vivid, and color-blind-friendly badge palettes, with vivid selected by default
- An explicit interface language switch between Simplified Chinese and English

<p align=center><img src=submission/v0.11.0/promo-440x280-en.png width=440 alt=Extension-interface></p>

## Use your own index lists

Version 0.13.0 adds multiple custom CSV indexes. Each file creates a separate named index that can be enabled, disabled, exported, or deleted independently.

1. [Download the CSV template](https://polarislight.github.io/Journal-Conference-Rank-Assistant/downloads/custom-index-template.csv). Keep the four headers `名称,等级,ISSN,别名`: venue name, tier, ISSN, and aliases. Venue names are required; blank tiers display as 收录 (included). Separate multiple ISSNs or aliases with semicolons.
2. Open the extension popup → **Manage custom indexes** → choose the CSV. Enter the group name in **Index name**, check the preview, and click **Import index**.
3. Refresh paper pages to see **Custom: index name tier** badges and filter by the new index.

Tell an AI tool with web search enabled which ranking system or institution, subject scope, and year you want. AI searches the issuing body's original list itself, verifies it, and generates CSV with source links, the actual year, entry counts, and a coverage report. Check the result, then download and import the file. [Read the step-by-step guide and copy the AI prompt](https://polarislight.github.io/Journal-Conference-Rank-Assistant/#custom-indexes).

## Ranking and indexing coverage

| System | Information shown | Data version |
| --- | --- | --- |
| CCF | A, B, C, None | 2026 |
| CAS partitions | Zones 1-4, Top | 2025 |
| XinRui partitions | Zones 1-4, Top | 2026 |
| JCR | Q1-Q4, impact factor | 2025 |
| Web of Science | SCIE, SSCI, AHCI, ESCI | Current local catalog |
| CSSCI | Source and extended lists | 2025-2026 |
| PKU Core | Chinese Core Journals | 2023 |
| Ei Compendex | Source journals and proceedings | 2026-07-09 |
| CAS warning list | Current list only | 2025 |
| UTD24 | 24 journals used by the UT Dallas research ranking | Current list |
| FT50 | Financial Times business-journal list | April 2026 |
| ABS / AJG | Academic Journal Guide ratings 1, 2, 3, 4, and 4* | 2024 |

The local catalog contains **35,093** journal and conference records. SCI, SCIE, SSCI, CSSCI, PKU Core, and Ei Compendex are different indexing or title-list systems. They do not define another Q1-Q4 scale. Phrases such as “SCI Q1” normally refer to JCR quartiles, so quartiles appear only on the JCR badge.

## Supported websites

Google Scholar search and author profiles · DBLP and its official mirrors · Semantic Scholar · arXiv · OpenAlex · PubMed · AMiner · Baidu Scholar · CNKI public search · Wanfang Data public search · public ResearchGate publication pages · major journal and publisher platforms including Nature/Springer, ScienceDirect, IEEE Xplore, ACM DL, and Wiley

ResearchGate is annotated only when a public publication page exposes standard journal metadata.

## Install

| Browser | Package | Notes |
| --- | --- | --- |
| Chrome / Chromium | [Install from Chrome Web Store](https://chromewebstore.google.com/detail/ibanchmlkanbhbddpejommgfhpfofifm) | Updates are delivered by the Chrome Web Store |
| Firefox | [Install from Firefox Add-ons](https://addons.mozilla.org/addon/journal-conf-rank-assistant) | Signed by Mozilla with automatic updates |

The Chrome and Firefox editions are now officially available from their respective browser extension stores.

For direct package downloads, see [GitHub Releases](https://github.com/PolarisLight/Journal-Conference-Rank-Assistant/releases).

## Support the project

The extension will remain free and ad-free. If it saves you time, you can support data curation, browser compatibility testing, and ongoing maintenance through WeChat Pay or Alipay. Sponsorship does not unlock extra features and is not a purchase or subscription. Please verify the recipient name before paying.

<details>
<summary>View WeChat Pay and Alipay QR codes</summary>

<table>
  <tr>
    <th align="center">WeChat Pay</th>
    <th align="center">Alipay</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/assets/support-wechat.jpg" width="280" alt="WeChat Pay payment QR code"></td>
    <td align="center"><img src="docs/assets/support-alipay.jpg" width="280" alt="Alipay payment QR code"></td>
  </tr>
</table>

</details>

The same options are also available in the [support section on the project website](https://polarislight.github.io/Journal-Conference-Rank-Assistant/#support).

## Privacy and data updates

Ranking lookups run locally. The extension has no ads, analytics, user tracking, or developer-operated account system, and it does not upload queries or browsing history. Network access is limited to:

- checking and downloading signed database updates from this repository
- querying the official DBLP JSON API when a results page is temporarily unavailable
- querying the official NCBI summary API by PMID when PubMed omits a full journal title
- querying Crossref by journal name or ISSN when metadata is missing, with results cached locally for 30 days

The extension checks for updates every seven days but never replaces the database automatically. After the user clicks the update button, it verifies the encrypted bundle with SHA-256 and ECDSA P-256, then stores it using AES-GCM.

Read the full [Privacy Policy](PRIVACY.md).

<details>
<summary><strong>Maintainer build instructions</strong></summary>

After preparing the private CSV inputs, run:

```powershell
python scripts/build_private_data.py
python scripts/merge_social_and_ei_indexes.py
python scripts/merge_xinrui_and_warning.py
python scripts/build_runtime_catalog.py
node scripts/encrypt_runtime_catalog.mjs
node scripts/build_signed_update.mjs 2026.07.13.2
```

Plaintext inputs, private signing keys, and build caches are excluded by `.gitignore`. Browser packages contain no `*.private.json` files.

</details>

## Data and naming notice

The offline inputs for base CCF, JCR, CAS partitions, XinRui 2026, and the current warning list are derived from GPL-3.0-licensed [`hitfyd/ShowJCR`](https://github.com/hitfyd/ShowJCR) exports, with upstream version metadata retained.

UTD24 and FT50 are compiled from the [official UT Dallas journal list](https://jindal.utdallas.edu/news/2026-utd-top-100-business-school-research-rankings/) and the [Financial Times FT50 list](https://www.ft.com/ft50-journals). ABS/AJG badges use Academic Journal Guide 2024 ratings. Consult the publishing body’s latest material before formal evaluation or submission decisions.

## Other contributors

- Zining Wang — business-journal feature requirements, cross-site compatibility testing, and issue reports

This project is not affiliated with or endorsed by the relevant ranking bodies, databases, search providers, or publishers. Rankings, quartiles, indexing information, and impact factors are references only. Always consult the latest official information before formal evaluation or submission decisions.

<p align=center>
  <a href=https://polarislight.github.io/Journal-Conference-Rank-Assistant/>Project website</a> ·
  <a href=PRIVACY.md>Privacy</a> ·
  <a href=https://github.com/PolarisLight/Journal-Conference-Rank-Assistant/issues>Issues</a>
</p>
