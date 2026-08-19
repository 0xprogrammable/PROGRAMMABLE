# Programmable volume fee v1 reference candidate

This is a starter implementation for `programmable-volume-fee-v1`. It is a **reference candidate, not independently
audited or deployed**. Copy and adapt it in the builder's repository; never treat the bundled source or a green local
test as approval, production safety, deployment evidence, or live fee collection.

The starter provides:

- one immutable canonical `PoolKey` per hook with atomic registration and PoolManager initialization;
- the non-additive fee split `effective=max(selected,10 bps)`, Programmable `10 bps`, project `effective-10 bps`;
- the exact immutable Programmable owner `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`;
- before/after return-delta collection for all four direction/exactness quadrants;
- atomic rejection when a specified-quote swap partially fills;
- independent cumulative platform/project rounding streams, so splitting volume across small accepted swaps cannot
  suppress the eventual 10-bps platform entitlement;
- atomic rejection below the 1,000-smallest-unit fee quantum, requiring a different reviewed architecture when
  quote-asset granularity makes that minimum material;
- separate claim-token liabilities and owner-only, per-claim destinations;
- exact CREATE2 hook permission-bit enforcement; and
- unit, fuzz and stateful fee-math invariant tests plus executable PoolManager swap and claim paths.

It deliberately does not provide upgrade, rescue, sweep, mutable-recipient or same-pool self-swap surfaces.

## Run locally

Requirements: Node.js, npm and Foundry.

```bash
npm ci
forge test -vvv
```

Pinned direct dependencies are in `package-lock.json`. Build information and storage layout are enabled in
`foundry.toml` for the conformance receipt.

## Adapt safely

1. Keep one fee-enforcing hook for the canonical pool. If the project already needs custom hook behavior, integrate the
   policy into that hook instead of composing a second hook.
2. Decide and disclose the canonical quote asset, project owner, directional selected totals and static LP fee independently.
   Registration and PoolManager initialization must remain atomic so a bad key or initial price cannot brick the hook.
   Dynamic LP fees need update logic in the same hook and therefore use the custom-hook path rather than this starter.
   This starter rejects static LP fees above 999,998 pips because the maximum v4 protocol fee can otherwise make exact
   output swaps impossible.
3. Preserve the four quadrant paths. Quote-specified swaps collect before core execution and verify the actual pool
   amount after execution. Quote-unspecified swaps calculate from the executed `BalanceDelta` after the swap.
4. Preserve both cumulative remainders across swaps and claims. Resetting, direction-splitting or omitting a remainder
   creates a fragmentation bypass. Preserve the partial-fill policy or submit a separately reviewed replacement with
   complete differential tests.
5. Mine the deployment salt and deploy only through the exact-mask factory. A normal CREATE/CREATE2 address whose low
   bits do not match the permissions is invalid.
6. Rerun tests, static analysis, isolated maintainer rebuild, review and deployment gates. Do not deploy from this asset
   directory.

Read `SECURITY_PROPERTIES.md` before changing the source.

## Create and check a structural receipt

First copy `evidence/fee-conformance-evidence.example.json`, replace every placeholder with the actual local test
receipt, and keep its assurance labels unchanged. Then choose the one `out/build-info/*.json` file whose output contains
`src/ProgrammableVolumeFeeHookV1.sol:ProgrammableVolumeFeeHookV1`.

From this directory, when the skill repository is still present:

```bash
node ../../../scripts/fee-conformance.mjs create \
  --root . \
  --source src/ProgrammableVolumeFeeHookV1.sol \
  --supporting-source hook-factory:src/ProgrammableVolumeFeeHookFactoryV1.sol \
  --artifact out/ProgrammableVolumeFeeHookV1.sol/ProgrammableVolumeFeeHookV1.json \
  --build-info out/build-info/REPLACE_WITH_BUILD_ID.json \
  --evidence evidence/fee-conformance-evidence.json \
  --contract ProgrammableVolumeFeeHookV1 \
  --out fee-conformance.json

node ../../../scripts/fee-conformance.mjs check --root . --manifest fee-conformance.json
```

The checker binds source, factory, ABI, deployed bytecode, build information and named test evidence. Its success status
is `STRUCTURALLY_CONFORMANT_REFERENCE_CANDIDATE`; that intentionally remains below maintainer rebuild, security review,
audit, deployment, runtime matching and monitoring.
