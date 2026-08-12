# Hookbuilder synchronization

The canonical `programmable-v4-hook-builder` package in this repository is synchronized from the public
`0xprogrammable/hookbuilder` development source, not from the historical Builder beta tag.

| Binding | Value |
| --- | --- |
| source repository | `https://github.com/0xprogrammable/hookbuilder` |
| source ref | `main` |
| source commit | `509060301ce9bb1b5e318b28aeeeeb846c020f68` |
| source commit tree | `f49b32d6ff60e7e2b1457e5bd7e32ee3c81710a8` |
| package version | `0.5.1` (development scope) |
| canonical skill files | `640` |
| generated skill tree digest | `0a9e5508fdb77e16527e0dd85d58c5d34569c573d0bc6a0dc47b024462471913` |

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
