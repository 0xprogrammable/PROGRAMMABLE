# Hookbuilder synchronization

The canonical `programmable-v4-hook-builder` package in this repository is synchronized from the public
`0xprogrammable/hookbuilder` development source, not from the historical Builder beta tag.

| Binding | Value |
| --- | --- |
| source repository | `https://github.com/0xprogrammable/hookbuilder` |
| source ref | `codex/hookbuilder-latest-main-20260812` (candidate for `main`) |
| source commit | `3548e942161a5439666fc8b3870320644124926e` |
| source commit tree | `c32ae2ce994b49fe6ce22db3e33ab50a1ee077b9` |
| package version | `0.5.1` (development scope) |
| canonical skill files | `640` |
| generated skill tree digest | `dbeda5fad8a32e0c6dea24b0d5e00266c0d58b7ef155c9f8ff244e2c60b16ac8` |

The source skill is authoritative for the newest model. The repository-root Codex and Claude manifests and the
`plugins/marketplace/plugins/programmable` distribution are generated from the same metadata and
`skills/programmable-v4-hook-builder` by:

```bash
node plugins/marketplace/scripts/generate-plugin.mjs --write
```

The root manifests make this repository directly installable while the marketplace distribution remains a byte-aligned
mirror of the canonical skill. The old
`programmable-v4-builder-v0.2.1` contract is retained only where the trusted public-beta verifier reads historical
application records; it is not a second active Builder implementation.

Source `main` is not a stable release and does not prove acceptance, review, deployment, routing, or launch. Rebind
this manifest, the generated plugin hashes, and all release evidence whenever the source commit changes.
