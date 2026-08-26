# Direct native hook graph v1

`programmable.direct-native-hook-graph.v1` is a review-bound use of the existing Router V1 `CustomGraph` path and
`ProgrammableCreate2GraphDeployerV1`. It does not add a Router capability, deploy a profile contract, or turn an
arbitrary hook getter into fee-behavior proof.

The existing immutable permit authority remains the admission trust root. It may sign only after reproducing the
profile hashes from an exact reviewed source revision, compiler input/output, init code, final runtime, fee-conformance
evidence, final graph calldata, current Router/GraphFactory code hashes, and the initialized pool result. Router V1 then
binds the topology hash, GraphDeployer commitment, expected runtime set and result in the signed route payload.

## Exact execution envelope

- GraphDeployer accepts 1–16 targets and Router V1's base market path accepts 2–16. This profile requires 3–16: one
  distinct direct token, hook and terminal initializer must each appear exactly once, with one exclusive component for
  every target/result index.
- All targets deploy before any initializer runs. The manifest and launch intent bind the terminal initializer's exact
  target ID, creation/runtime hashes, compiler ABI, unsigned calldata and final calldata hash. The pool must be
  initialized before Router V1 writes the stamp.
- Currencies are strictly ordered. Native currency is address zero and can therefore only be `currency0`; native/ERC-20
  and ERC-20/ERC-20 pairs are supported. The token and quote currency must each be one pool currency.
- A variable 14-bit v4 permission mask is admitted only as part of an exact review. Address low bits must equal the
  mask. Every return-delta flag requires its callback flag, and fee collection requires a before-swap or after-swap
  callback/return-delta pair. A new mask or runtime is a new review, not an automatically allowed variant.

## Canonical fee rule

The profile uses the inclusive `programmable-volume-fee-v2@2.0.0` `standard-amm` rule over executed gross quote
volume. Rates use a 1,000,000 denominator:

```text
effectiveTotal = max(selectedTotal, 1_000)
Programmable share = 1_000
project share = effectiveTotal - 1_000
```

The fixed Programmable claimant is `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. A selected 3% is therefore 2.9%
project plus 0.1% Programmable, still 3.0% total; it is not 3.1%. Admission needs exact-input/output buy/sell,
partial/no-fill, remainder, liability and claim evidence. A self-reported rate or configuration hash is not evidence
that arbitrary bytecode implements the rule.

The repository's `ProgrammableVolumeFeeHookV2` is an unaudited, undeployed reference with mask `0x20cc`; it is not a
production allowlist entry. Its exact source/build/runtime must still pass the same review.

The route namespace is the exact nonzero public-API derivation from source-bundle hash, launch wallet, Router and
GraphFactory. It is bound as supplied; it is not the profile ID hash.

## Launch-intent-bound EIP-3009 funding

The public API first computes its canonical `sha256:` launch intent over the exact unsigned request, including the
reviewed initializer target/function ABI and signature-patch descriptor. Convert that digest to its raw `bytes32`
commitment, then compute:

```text
fundingIntentHash = keccak256(abi.encode(
  keccak256("programmable.direct-native-hook-graph.funding-intent.v1"),
  chainId, token, router, graphFactory, routeNamespace, routeNonce,
  launchIntentCommitment, from, to, value, validAfter, validBefore
))

nonce = keccak256(abi.encode(
  keccak256("programmable.direct-native-hook-graph.funding-nonce.v1"),
  fundingIntentHash
))
```

The funding-intent domain hash is
`0xa511b4d24d73d4905b0a9b50873a89978bd950d8bac23485ec98a43a0dd4c85c`; the nonce-domain hash is
`0xe64de4316449729c8e063e150d279ac2c159605f54d1ecbe52687fd4c639eb04`. Neither hash includes the signature or
final graph commitment. The reviewed initializer must equal EIP-3009 `to` and directly call the currency contract.

The launch-intent-bound patch descriptor is exactly:

```text
schemaVersion = programmable.eip3009-signature-patch.v1
targetId
unsignedInitializerCalldataSha256
initializerCalldataLengthBytes
signatureEncoding = eip3009-r-s-v-abi-words
rOffsetBytes
sOffsetBytes
vOffsetBytes
```

Offsets count from calldata byte zero, including the four-byte selector. The reviewed compiler ABI must prove that `r`
and `s` are distinct static `bytes32` words and `v` is a static `uint8` word for that exact initializer function. All
three offsets must be distinct, at least 4, `(offset - 4) % 32 == 0`, and place a complete word in bounds. Every patch
word must be all zero in the unsigned template. After checking a canonical 65-byte low-s `r || s || v` signature,
patch the full `r` and `s` words and only the final byte of the `v` word; its first 31 bytes remain zero. Finally,
decode/re-encode—or provide an equivalent deterministic proof—that the result is byte-identical to a complete compiler
ABI encoding. Raw or compiler-unvalidated offsets remain forbidden. The final GraphDeployer commitment binds these
validated post-patch signature bytes.

## Deterministic preparation order

1. Pin deployed Router, GraphFactory and PoolManager addresses and runtime code hashes; pin applicant Git commit/tree.
2. Reproduce compiler input/output, creation code, predicted target addresses and final runtime hashes.
3. Review fee behavior and produce the conformance/security evidence hashes.
4. Compute target manifest, review admission, PoolKey and fee policy. Bind the derived route namespace and exact
   compiler-validated unsigned signature-patch descriptor in the canonical launch intent.
5. Compute funding intent and nonce from that launch intent, obtain the EIP-3009 signature, validate and apply the
   static ABI-word patch, prove full-encoding equality, then compute graph commitment and expected graph result.
   Simulate the complete Router transaction and compare every runtime and pool result.
6. The permit authority signs the exact route. The launch wallet submits the single `launchAndStampV1` transaction.
7. Read back the Router stamp, component code hashes, PoolManager state, fee liabilities and claim configuration.

There is no required onchain owner transaction and no Router/GraphFactory redeployment for an exact admitted launch.
The remaining authority boundary is the permit-authority signature plus the launch wallet's one transaction. This
source package issued neither and did not enable public API admission.

## Local verification

```sh
jq empty spec/programmable.direct-native-hook-graph.v1.schema.json
jq empty artifacts/direct-native-hook-graph-v1/programmable.direct-native-hook-graph.v1.json
forge fmt --check src/ProgrammableDirectNativeHookGraphProfileV1.sol \
  test/ProgrammableDirectNativeHookGraphProfileV1.t.sol
forge test --match-contract ProgrammableDirectNativeHookGraphProfileV1Test
forge build
git diff --check
```
