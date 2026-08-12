# Hookbuilder synchronization

The canonical `programmable-v4-hook-builder` package in this repository is synchronized from the public
`0xprogrammable/hookbuilder` development source, not from the historical Builder beta tag.

| Binding | Value |
| --- | --- |
| source repository | `https://github.com/0xprogrammable/hookbuilder` |
| source ref | `codex/hookbuilder-latest-main-20260812` (candidate for `main`) |
| source commit | `3f62d82fe4336b1c47e63e58fc49cab5afe87704` |
| source commit tree | `8d51106ab13e0a50819cf2d6cd9bfb8dccc63687` |
| package version | `0.5.1` (development scope) |
| canonical skill files | `640` |
| generated skill tree digest | `17228e2aea3909e4b59815f766c26bf4f0a7a790ba8ad3ee1b916008dc5a468c` |

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
