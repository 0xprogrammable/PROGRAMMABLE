# Asset Profiles

## Scope

The baseline contains two binding-local transfer primitives. They are available
to `DomainVaultV1`, but protected execution is disabled, so their presence is
not a live asset-support or conformance claim.

## Native ETH strict profile

`NativeETHProfileV1.pushExact` sends a nonzero amount with a 47,700-gas CALL
argument. The EVM adds the 2,300-gas nonzero-value stipend, bounding recipient
execution at 50,000 gas. The primitive budgets 40,000 gas for caller-side CALL
overhead and enforces at least 75,000 gas remaining immediately after the
hostile call. It rejects the zero address, the sending vault itself, call
failure and return data over 256 bytes. It measures both balances and requires
exact source debit and exact destination credit. The vault also forbids its
Core as a push recipient.

The profile provides no pull operation. An ordinary direct ETH call can be
received only by the vault's plain `receive` path; `DomainVaultV1` rejects
calldata-bearing native value. Forced ETH and address pre-funding cannot be
prevented. Direct donations are physical custody, not automatically a
Principal claim or Protocol accounting credit.

**Do not fund a canonical vault created by the current foundations-only Core.**
That immutable Core has no vault-command path and its protected entry always
reverts. Native ETH arriving at such a vault has no release path; ERC-20
balances have no release path controlled by Core, while unsupported token or
issuer behavior may change them externally. The transfer primitives are
exercised through a controller harness only as binding-local foundation inputs.

## Strict measured ERC-20 profile

`StrictMeasuredERC20ProfileV1` uses bounded low-level calls and accepts only:

- `balanceOf(address)` returning exactly 32 bytes;
- `transfer` and `transferFrom` returning exactly the 32-byte value `1`;
- exact requested source debit; and
- exact requested spendable destination credit.

It rejects empty, malformed, oversized or false returns, call failure, aliased
endpoints, zero amount, reversed balance directions, fees/taxes, short credit
and over-debit at the observed transfer. The vault forbids its Core as a push
recipient and rechecks the token entry runtime code hash recorded at
construction before every command.

These checks are point-in-time observations. They do not prove honest
`balanceOf`, storage or implementation immutability, solvency, issuer policy or
future behavior.

## Unsupported assets

The baseline does not support or claim support for:

- fee-on-transfer, burn-on-transfer or reflection tokens;
- positive or negative rebasing assets;
- asynchronously confiscatable or blocklist-controlled balances;
- ERC-777-style callback behavior or other unexpected transfer callbacks;
- tokens with empty/noncanonical boolean returns;
- ERC-721, ERC-1155 or multi-asset contracts;
- proxy, beacon, diamond or otherwise mutable tokens as immutable assets;
- deceptive `balanceOf` implementations; or
- assets whose exact spendable credit cannot be measured inside the transaction.

An asset may pass one strict transfer and later change behavior. Admission must
not extrapolate a single observation into a lifetime guarantee.

## Async deficit limitation

The locked Protocol requires that a later unrelated inflow cannot hide an
earlier deficit. For an asset that can confiscate 20 from a 100 balance and
receive an unrelated 20 before Core observes either change, the next balance is
again 100. The EVM observation cannot prove the hidden history
(`SPEC-GAP-006`). Such behavior is not repaired by the strict profile and must
remain unsupported rather than assigned invented provenance rules.
