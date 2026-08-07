# Test plan

This is a proposal-stage plan for a system that is already deployed. It separates (A) checks
that have actually run in this repository, (B) evidence that exists on the private production
pipeline and on-chain, and (C) checks that would be required if maintainers ever scope a
Programmable-launch variant. Nothing in (B) or (C) is claimed as evidence produced by this
repository's tooling.

## A. Executed in this repository (reproducible by anyone)

- **Offline deployment proof** — `cd flagship && forge test` (forge 1.5.1, solc 0.8.26 pinned
  by `flagship/foundry.toml`). Four tests, all passing:
  1. `test_ConstructorArgsMatchVerifiedRecord` — abi-encoded constructor args equal the
     Etherscan-published bytes;
  2. `test_InitCodeHashMatchesMinedRecord` — `keccak256(creationCode ++ args)` equals the
     pre-launch mined init-code hash `0x8a34afea…0535`;
  3. `test_Create2AddressMatchesDeployedHook` — CREATE2(deployer `0x4e59…956C`, salt `0x…1302`)
     derives the live address `0xA6f7…9440`;
  4. `test_AddressEncodesExactlyTheDeclaredPermissions` — flag bits equal `0x1440`, cross-checked
     against v4-core's own flag constants.
  A single changed byte in `flagship/src`/`flagship/lib`, or any changed compiler setting,
  fails this suite — it is a byte-exactness proof, not a behavior test.
- **Template regression** — repository root `forge build && forge test`: 62 tests across 10
  suites pass against the same production-pinned vendored dependencies (v4-core 1.0.2,
  uniswap-hooks 1.2.2, OpenZeppelin 5.6.1, v4-periphery 1.0.3, solmate, permit2). The template
  is a teaching rewrite; its tests exercise the architecture, not the deployed bytecode.
- **Deterministic beta preflight** — `cli.mjs check` over `submission.json` with
  `--repository-root`; the committed `compatibility-report.json` records the exact decision,
  risk derivation, and complete Solidity closure for the declared flagship paths.

## B. Existing external evidence (verifiable, not produced here)

- **Etherscan source verification** of the hook (and the token, NFT, renderer) at the live
  addresses with the exact compiler profile; the 30-file standard-JSON is byte-identical to
  `flagship/`.
- **Live chain reads** anyone can reproduce (see `flagship/README.md`): runtime code hash
  `0xd45977dd…7fc6` (8,644 bytes), `owner() == address(0)`, `canonicalPoolId() == 0x33d9…31ed`.
- **Production pipeline** (private repository): the deployed revision shipped with unit,
  integration, fuzz, invariant, reentrancy, differential, event-ordering, gas-fork and
  marketplace-fork suites, plus release gates that verify published numbers, single-sided
  genesis geometry, launch-phase fail-closed behavior, fee canon (3000), and
  `projectFundedBootstrapBuy = false`. These ran before launch on 2026-08-03; they are stated
  here as provenance, not bound as beta evidence.

## C. Required only if a Programmable-launch variant is ever scoped

A new hook deployment integrating the mandatory volume fee would need the full prototype
battery defined by the standard: the mandatory-fee vectors (10 bps floor, non-additive split,
all four executed gross quote-side swap modes, quadrant-dependent basis, callback-skipping
self-calls, immutable owner-only claims to
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`, per-claim destination, non-bypassability, no
cross-pool netting), fuzz/invariant/static-analysis/fork suites for the new code, a fresh
permission-mask + CREATE2 plan, and independent review at the assigned risk tier. None of that
applies to the immutable deployed instance, which cannot change.

## Known limitations of this plan

- The flagship suite proves byte-exact identity with the deployed artifact; it intentionally
  does not re-test the deployed contract's behavior (that evidence lives in B).
- The token/NFT layer's behavior tests exist in the private pipeline and as clean-room
  equivalents in the template's suites; the token source itself is outside this repository's
  declared closure and is reviewable on Etherscan.
- No fork tests run in this repository's CI (no RPC secrets in a public template); the
  template's fork smoke test skips cleanly when `MAINNET_RPC_URL` is unset.
