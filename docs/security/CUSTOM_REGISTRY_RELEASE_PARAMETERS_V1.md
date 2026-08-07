# Programmable Custom Registry V1 release parameters

These values are frozen constructor and manifest inputs. They do not assert that a deployment exists. Public status
remains `prelaunch` and all address/start-block fields remain `null` until a finalized deployment receipt is bound to
the release manifest.

## Constructor policy

- intended chain: Ethereum Mainnet (`chainId = 1`)
- Registry generation: `1`
- minimum finality depth: `64` blocks
- default-admin transfer delay: `172800` seconds
- default administrator: `0x2Bb333d48DFAF1596D9036671d2E43168994249E`
- Programmable fee recipient: `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`
- Solidity source commit: `c988ac29b4e6cbcf9f3b2161bcb2013dce3d5ad2`

`CUSTOM_REGISTRY_CHAIN_PROFILE_V1.json` is hashed as RFC 8785 JSON with the domain
`programmable.evm-chain-profile.v1`:

```text
sha256:30991a4ebef393737148f7986c880a4af602691e059ad428aa9ca17c6b4066ff
```

The onchain `CHAIN_PROFILE_HASH` constructor value is the raw 32-byte digest:

```text
0x30991a4ebef393737148f7986c880a4af602691e059ad428aa9ca17c6b4066ff
```

`CUSTOM_REGISTRY_POLICY_V1.json` is hashed as RFC 8785 JSON with the domain
`programmable.custom-registry-policy.v1`:

```text
sha256:7a814ecb2d2b8be2debb29481f25f06e976559eec41fa7c8d92e030ec69fc9ff
```

The onchain `REGISTRY_POLICY_HASH` constructor value is the raw 32-byte digest:

```text
0x7a814ecb2d2b8be2debb29481f25f06e976559eec41fa7c8d92e030ec69fc9ff
```

## Published artifact file hashes

These are byte-level SHA-256 values; the semantic event-set commitment remains the separately verified value in
`CUSTOM_REGISTRY_EVENT_SET_V1.json`.

| Artifact | SHA-256 |
| --- | --- |
| Event-set JSON | `sha256:47323a4162b1429d70b8828f0061d25e386f0808b2e22fd13f0cc2ad661c4898` |
| Registry ABI | `sha256:270d186ceb684d2c44f144de6d63a3b278081ca476d537b3a7fcd8952ce8d74e` |
| Partner-factory Registry ABI | `sha256:0401b53b147d8c9ee6d16578d6a362ed6c88de897bc4c6b341118222299872a3` |
| Fee-policy verifier ABI | `sha256:dc3d35c26cb4daeee2d8c61a8fddc91ed981e974312ac29e942ca567eab1debf` |
| Atomic registrar ABI | `sha256:c8822824b4b0956be3cd71cf4d9d2fbe04a703409272a906a2e784d6a9f0d88a` |

## Role boundary

The canonical V1 release uses the reviewed four-transaction nonce-bound deployment flow in
`contracts/script/DeployProgrammableCustomRegistryReleaseV1.s.sol`. Before transaction one, the deployer and its exact
pending nonce are frozen. The main Registry constructor receives the deterministic `CREATE` address of the atomic
registrar at `startingNonce + 3` as its only initial `WRITER_ROLE`; no temporary EOA or bootstrap writer is authorized.
Transaction four must deploy the registrar at that exact predicted address, and the script must prove that the Registry
grants the writer role to it. Any failed or interleaved transaction invalidates the address prediction and requires a
new freeze and full simulation; the remaining transactions must not continue under the old release record.

The default administrator is not a writer. The approver must be independent of the registrar/writer and must satisfy
the role-separation checks enforced by both stateful contracts. The legacy
`ConfigureProgrammableCustomAtomicRegistrarV1.s.sol` path is not part of this canonical four-transaction deployment
and must not be executed for it. No address is inferred from a display name, GitHub identity, or operator label.

The finalizer, corrector, revoker, approver, registrar/writer, deployed addresses, deployment transactions, verified
runtime hashes, and per-contract start blocks belong in the deployment manifest only after they are real. They are
intentionally not filled with placeholders in these predeployment artifacts.
