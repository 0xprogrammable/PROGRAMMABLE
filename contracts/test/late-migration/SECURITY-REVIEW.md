# V3 intake contract verification

This review covers the source-only Ethereum intake. It is local implementation evidence, not deployment, activation, public availability, wallet-provider support, or payment evidence.

## Reviewed source

- `contracts/src/late-migration/ProgrammableLateMigrationIntakeV3.sol`
- SHA-256: `c8a6d228b237911603de9eb2f006097f2fc724b981103ade65d09888e06d3180`
- Solidity 0.8.26, Cancun, optimizer 1,000 runs, `via_ir = true`, no CBOR metadata or bytecode hash.
- Constructor remains `constructor(address activationAuthority_)`; deposit, views and events retain the draft ABI. New error: `PermitNonceNotConsumed(uint256 expected,uint256 current)`.

Fixed two implementation defects: `_validateOffer` incorrectly declared `pure` despite reading the root, and a failed native permit could previously fall back to an existing approval while leaving its nonce unconsumed. The fresh-nonce path now calls the token permit directly and requires its nonce to advance exactly once. Activation and each deposit also pin the current source chain ID.

## Security properties

- Activation is closed initially, available only to its constructor authority once, and deletes that authority. There is no close, pause, upgrade, root setter, sweep, arbitrary call or destination-chain execution path.
- Constructor verifies chain, nonzero activation authority and token domain. Runtime code is verified at activation and every deposit. Deployment tooling must bind the exact production runtime rather than either test harness.
- Every deposit binds round, offer index, source, full gross amount and per-wallet rounded 80% amount through the frozen double-hashed Merkle leaf. Token, source chain, recipient, target chain and target token are constants.
- The contract independently recovers the exact source from native token-domain ECDSA over owner, intake spender, full gross amount, token nonce and deadline. Source code length does not replace signature ownership. This admits underlying EOA signatures from EIP-7702 delegated accounts; it provides no ERC-1271 or ERC-4337 signature dispatch.
- A source and offer index can each be used only once. The bitmap, accepted deposit ID, block, totals and complete `MigrationDepositAccepted` event agree. The event provides evidence for a later manual ledger, not an automatic payment instruction.
- Source decrease and fixed recipient increase must each equal the committed gross amount. Fee-on-transfer, extra source debit, failed transfer, bad nonce/signature/proof and reentrancy cannot leave a partial deposit. Native permit state also rolls back if the same transaction fails.
- Aggregate caps use raw integers. Each payout is `floor(gross * 8000 / 10000)` independently. The frozen total is 594 smallest units below rounding the combined gross amount once.
- Direct transfers to the recipient do not modify intake totals, consumption records or event evidence.

## Pre-submitted permit boundary

A supplied signature with token nonce `n` is accepted while the token nonce is `n + 1` only if the exact intake allowance equals the full frozen gross amount and the deadline still applies. Its ECDSA owner, domain, spender and value are still checked. This permits a third party to submit the native permit first. It is not a proof of which native permit advanced that nonce: ERC-2612 does not expose the previously consumed permit digest. A pre-existing exact approval combined with a separately advanced nonce is therefore indistinguishable. This intake behavior is deliberately allowance-based in that branch, and the immutable intake destination remains the only possible use. Clearing the intake allowance rejects the old signature; moving nonce to `n + 2` also rejects it. Tests cover both revocation cases. A permit does not reserve execution for one sponsor, and any sponsor can execute the same committed deposit.

## Executed checks

From `contracts/`:

```sh
FOUNDRY_PROFILE=late-migration LATE_MIGRATION_FORK_RPC_URL=https://eth.drpc.org forge test --match-path 'test/late-migration/*'
FOUNDRY_PROFILE=late-migration slither . --exclude-dependencies --filter-paths 'test|lib' --json ../work/contract-security/slither.json
FOUNDRY_PROFILE=late-migration slither . --ignore-compile --exclude-dependencies --filter-paths 'test|lib' --print inheritance-graph,function-summary,vars-and-auth --json ../work/contract-security/slither-printers.json
```

The Foundry suite includes 26 unit/fuzz tests, one full frozen-artifact reconciliation, three explicit native-token fork tests, and two handler/invariant tests. The invariant configuration uses 256 runs at depth 64 and `fail_on_revert = true`, so failed handler assertions cannot be silently ignored. The handler explores exact deposits, pre-submitted permits, replay, wrong proofs/signatures/deadlines, transfer faults, top-ups and withdrawals across eight independent sources and all six bitmap words. The separate deterministic handler exercise successfully consumes all eight eligible offers and rejects sixteen invalid/replayed attempts.

The frozen-artifact test reads the actual shipped config, verifies all 1,499 unique sorted sources and indices, recalculates every per-wallet payout, rebuilds the full production root, and compares the exact gross and payout totals. It uses the production root, not a test-root override.

Fork tests use finalized Ethereum block `25906557` from the read-only token evidence. The native old-token runtime hash is `0x4fe466386aeebe507f6bcfc58e046a0632e4687699fa5bd28c4b7ec6333141ad` and domain is `0xe2ac19a052ba41dccaaa930f489a94353d986c7769e416830273d9362ad26a47`. The fork substitutes only a generated-key eligibility root and local balances; token code, signature validation, allowance/nonce behavior and transfers are real. Both EOA and EIP-7702 marker cases pass exact transfer and nonce checks. A chain-ID change rejects production activation. With no explicit `LATE_MIGRATION_FORK_RPC_URL`, the fork setup is reported as skipped rather than as passed.

Slither analyzed 13 contracts with 101 detectors and reported two findings:

1. `arbitrary-send-erc20` on the source argument of `safeTransferFrom`. Intentional sponsored execution: frozen proof binds the source and amount, independently recovered ECDSA binds that same source and intake spender, exact nonce/allowance gates consumption, and recipient is immutable. Unit, fuzz and stateful tests cover these controls. No unrestricted transfer exists.
2. `timestamp` on permit expiry and maximum lead comparisons. Intentional ERC-2612 inclusive deadline checks with a 20-minute lead bound; timestamp is not used for pricing, randomness or eligibility.

The Slither command exits nonzero because it reports those findings; it was not a clean zero-finding scan. Inheritance, function summary and variable-authority printer output was generated and reviewed. Only `ReentrancyGuard` is inherited; activation authority has no token routing or payout authority. The dependency token integration was checked against its exact pinned runtime and native permit path. This contract is not an ERC token or an upgradeable proxy, so token-conformance and proxy-upgrade tools do not apply. No oracle, pool, swap, flash-loan, random, secret, delegatecall or target-chain operation exists in the source.

## Remaining release evidence

The backend, deployment tooling and UI have now been integrated and locally checked. Before public activation, require exact deployment/runtime and immutable commitment evidence, canonical activation receipt/finality, reconciled sponsor ownership and explicit owner authorization. Contract fork success does not demonstrate a particular wallet application's signing flow. Manual payouts remain outside this implementation and require a canonical finalized-event ledger plus explicit paid records to avoid repeats.

Integration note: the repository formatter joined the native permit call onto one line after the original Slither run (whose source SHA-256 was `598fe74a2255f4eb093c9cc3ddeaf5f1744e8b53aaa42c27917774575d375b6f`). No semantic Solidity changed; creation and patched runtime hashes reproduced unchanged. Slither was rerun against the final source hash above: 13 contracts, 101 detectors, the same two findings. The final CI-style command includes the repository's existing `--fail-none`, so that invocation exits zero while retaining both findings in its JSON report.

Final integrated Foundry tests and source/test formatting pass. Forge lint exits successfully with sponsored-transfer, external-call/event and permit-timestamp warnings plus naming/style notes. The transfer source is proof/signature-bound; the deposit is nonReentrant, and the pinned old-token runtime has no transfer callback. These findings do not establish an unrestricted transfer or an unguarded callback path. The scan and lint were not zero-finding reports.

The default Foundry profile excludes only the dedicated late-migration source/test paths. The late-migration profile clears that exclusion and isolates its script namespace as well, so its via-IR compiler never includes legacy deployment scripts. Package build, lint, local/CI verification and Slither commands explicitly include both profiles. CI sets the read-only native-token fork endpoint so those three tests are not silently skipped there. The workflow pins Foundry 1.7.1; use that version for the repository-wide formatter rather than the locally installed 1.8 formatter, which changes unrelated legacy formatting.
