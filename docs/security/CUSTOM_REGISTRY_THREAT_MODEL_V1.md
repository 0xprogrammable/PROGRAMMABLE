# Programmable Custom Registry V1 threat model

## Protected claims

The registry protects one narrow claim: a launch came through the official Programmable Custom launch boundary and is
bound to the exact approved source, build, deployment, runtime set, review, fee policy, and record commitments. It does
not protect token price, liquidity, profitability, availability, external protocol behavior, or future administrator
actions outside the recorded authority model.

## Threats and controls

| Threat | V1 control | Residual responsibility |
| --- | --- | --- |
| Fake name, symbol, logo, or creator tag | None of those fields can register a launch; only an independently authorized public launch ID and the official writer can. | Integrators must use the manifest-bound address, not metadata. |
| Fake registry or copied event | Chain, immutable generation, official address, start block, emitter, and topic allowlist. | Manifest distribution and indexer allowlist must be authenticated. |
| Cross-chain or cross-generation replay | `chainId == CHAIN_ID`, exact generation, chain-bound public launch ID, consumed approval and deployment IDs. | Each future chain needs a distinct deployed registry manifest entry. |
| PR or approval treated as a launch | Approval is a prior event; registration additionally requires deployment/runtime/review bindings and live primary code. | Approval service must not grant `WRITER_ROLE`; launch gateway must submit exact evidence. |
| Compromised writer invents or substitutes an approval/deployment/review/record | `APPROVER_ROLE` preauthorizes exact launch ID, approval binding, and full registration/identity hash; role co-location is rejected. | Approver evidence generation, custody, and monitoring remain independent control-plane duties. |
| Changed commit, artifact, config, wallet, or fee policy | Exact approval binding recomputation. | Reproducible-build and artifact generation must be independently verified. |
| Changed deployed runtime | Primary `EXTCODEHASH`, runtime-set commitment, and review/deployment binding. | Proxies and external dependencies require implementation/authority coverage in the committed set plus monitoring. |
| Unapproved partner factory calls the Registry | Partner-attributed registration bypasses global `WRITER_ROLE` and must pass the separate factory registry's exact caller, current `EXTCODEHASH`, validity window, configuration, and revocation checks. | Programmable must verify the deployed factory before authorization and monitor runtime/authority changes. |
| Partner source commit or version substituted | The deterministic configuration hash binds model and factory repositories/commits, provider/model/template/version, chain, factory/runtime set, permissions, and fee policy. | Approval tooling must use the published encoding and retain the raw public preimages. |
| Partner factory deploys but does not register | The authorized provider factory must deploy and call `registerLaunch` in the same EVM transaction; tests prove rollback when registration fails. | Each partner implementation must prove its own atomic method before factory authorization. |
| Partial or differently initialized atomic launch | The supplied `CREATE2` registrar binds bytecode, salt/address, values, init calldata/result, and runtime into the approved deployment configuration, then deploys, initializes, runtime-checks, and registers in one non-reentrant call; tests prove rollback. | Non-`CREATE2` adapters must prove equivalent transaction-level atomicity before receiving writer authority. |
| Premature final publication | Registration is only `Observed`; separate native-blockhash finality transition. | API/read model must not publish observed as finalized. |
| Fabricated old block hash | Both proof blocks must be within 256 blocks and equal native `blockhash`. | Operations must finalize before the window expires. |
| Fabricated transaction/log identity | Finality event commits finalizer-attested identity. | Indexer must compare it with the actual registration receipt; the contract cannot natively inspect tx hash/index/log index. |
| Record overwrite or skipped revision | Exact previous hash, contiguous revision, immutable history mapping. | Public record validator must keep immutable launch/economics fields unchanged across correction payloads. |
| Revoked launch reactivated | Revocation is terminal in V1. | A legitimate replacement needs a new approval, deployment, and launch ID. |
| Native fee changed | Exact 10 BPS and fixed Programmable recipient enforced inline. | Review proves actual market-path accounting and scope. |
| Partner under/overcharge or extra native fee | Exact 20 = 15 partner + 5 Programmable and native fee = 0. | Review proves both legs share real basis/currency and no bypass/double claim exists. |
| Native 10 BPS globally copied onto partner projects | Fee kind, provider, model/version, template/version, and market path are inside the fee-policy hash; AEON rejects any extra native surcharge. | API, manifest, and UI must expose the bound per-path policy without a global fallback. |
| Fee or market invented for a project with no qualifying market | Enum value 2 requires zero economics and fully zero legs while preserving nonzero verification evidence. | Read models must keep unsupported market actions disabled and must not add a fallback fee. |
| One party claims the other share | Distinct claim-right commitments and nonzero isolation/safety evidence. | Template review and runtime/onchain tests establish actual isolation; the registry does not execute claims. |
| Public fee details substituted or richer multi-market currency semantics omitted | Required public-policy SHA/JCS binding is inside the canonical onchain fee hash and registration commitment. | Producer and read model must independently recompute the versioned immutable semantic preimage. |
| Compromised operational key | Separate roles, immediate admin revocation, append-only evidence. | Key custody, monitoring, incident response, and timely revocation remain operational gates. |
| Compromised default admin | OpenZeppelin single-admin, delayed two-step transfer. | Use a real threshold authority and nonzero delay; no EOA placeholder in production. |
| Malicious or oversized metadata | Registry stores fixed-size commitments only. | API schema, canonicalization, URI, byte-limit, Unicode/Bidi, SSRF, and credential-URL defenses live in the record pipeline. |

## Trust assumptions

V1 trusts the configured approver to authorize only independently verified exact bindings, the writer, atomic
registrar, or exact approved partner factory to consume those bindings for the intended launch, the finalizer to attest the actual transaction/log
identity, the corrector to append only policy-permitted record changes, and the revoker to append authenticated
incident decisions. Approver and writer cannot be the same address. The contract makes those authorities explicit
and separable; it does not remove their trust.

Finality block hashes receive native verification. Transaction/log identity, repository objects, build artifacts,
multi-contract runtime sets, detailed review findings, partner template behavior, and accounting evidence are
commitments whose preimages are verified by the surrounding approval, finality, indexer, and public-record systems.

## Explicit non-guarantees

Registry inclusion and the phrase `Programmable Verified` do not mean audited by an independent third party, safe,
unruggable, risk-free, immutable, permissionless, tradable, liquid, or supported by a particular wallet, terminal,
scanner, or market-data provider. Provider discovery, charting, quote, simulation, and execution are independent axes.

No deployment address, start block, partner wallet, canary transaction, or active chain is established by these local
contracts and tests. AEON's catalog entry alone is not an approval record, and Programmable does not deploy AEON's
factory.
