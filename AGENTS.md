# Browser Extension Release Policy

- The user-approved release target is version `0.13.0`.
- Keep Chrome and Firefox manifests aligned at `0.13.0` for this release unless the user explicitly requests browser-specific versioning.
- Do not bump the extension version for ordinary fixes, new site adapters, data refreshes, repackaging, or local test builds.
- Bump the version only when the user decides to prepare and submit a new AMO or browser-store review.
- Before packaging, confirm the intended submitted version with the user when the target is a store upload rather than a self-use build.
- Firefox XPI archives must be built with explicit POSIX entry names and validated at the raw ZIP-byte level for backslashes; do not rely only on high-level archive listings because they may normalize Windows separators.
# Site Adapter Regression Policy

- Do not ship a single journal, conference, or venue-name hardcode as the final fix for a metadata-matching problem.
- Prefer stable upstream identifiers, generic normalization, and catalog-backed aliases.
- Validate a generalized adapter fix with at least two independent venues and one edge case where only a historical or abbreviated name is visible.
- Any claim of all-site or global adapter coverage must be backed by a manifest-driven regression matrix that exercises every declared URL pattern; publisher patterns must cover both search-result and article-detail page shapes, with a known positive venue and an ambiguous or generic negative case.
- Global matching claims must also include a venue-diversity matrix spanning conference and journal types, CCF A/B/C, JCR Q1-Q4, CAS zones 1-4, Web of Science variants, Chinese indexes, abbreviations, and ambiguous negatives, plus a catalog-wide runtime reachability audit.
# Catalog Data Quality Policy

- Reconcile duplicate journal entities before building runtime aliases. For Chinese records, use punctuation-insensitive normalized names, preserve all aliases and indexes, and refuse automatic merges when non-empty ISSN sets conflict.
- Every catalog rebuild must test that normalized Chinese aliases map to one record and that representative multi-index journals retain every applicable label.
- Browser installation packages must contain zero `*.private.json` files. Plaintext data shards belong only in the AMO source archive under `source-data/`.
