# Hookbuilder synchronization

The canonical `programmable-v4-hook-builder` package in this repository is synchronized from the exact immutable
`0xprogrammable/hookbuilder` `v0.5.1` Node 24 release, not from the historical Builder beta tag.

| Binding | Value |
| --- | --- |
| source repository | `https://github.com/0xprogrammable/hookbuilder` |
| binding status | `IMMUTABLE_PUBLIC_RELEASE_VERIFIED` |
| source ref | `v0.5.1` |
| annotated tag object | `7f0beec2afe00facd25ba65cecbb18f285f15b91` |
| source commit | `547482adf6ed0ed19e9cd4d0e884abd70e143229` |
| source commit tree | `ed030750bb745e7915070985f0d8643c29760c25` |
| source skill tree | `b7a0eeec627b2fd2dfe24fcadd35befcd42b8cec` |
| source plugin payload digest | `3dcea707506fc22f8bac79d9948e185ed90b3635d03c8d56f97158dca4bd1152` |
| package version | `0.5.1` |
| public release | `latest`, `immutable`, six assets |
| canonical skill files | `640` |
| generated skill tree digest | `9bff40b2825c672873e7a98699b1d7d117cc6186de50db246f24c93b56dea8bb` |

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

The immutable public release establishes exact package and artifact identity only. It does not prove model behavior,
acceptance, independent review, deployment, routing, Registry activation, or launch.
