# Security properties and verification map

Status: reference candidate, not independently audited or deployed.

These properties define what the starter intends to preserve. Tests are evidence about this exact source revision, not
proof that an adaptation, deployment or runtime retains them.

| ID | Property | Current local coverage |
| --- | --- | --- |
| FEE-01 | `effective=max(selected,1000)`; platform rate is 1,000 hundredths of a bip; project rate is the remainder. | Unit plus fuzz |
| FEE-02 | `selected=0`, below floor and at floor become 10/10/0 bps; 300 bps becomes 300/10/290 bps. | Unit |
| FEE-03 | Every callback with at least 1,000 units of executed gross quote creates a nonzero Programmable liability; zero execution creates none and a positive amount below the quantum reverts atomically. | Unit plus invariant |
| FEE-04 | Programmable and project fractional numerators persist independently across swaps and claims; splitting accepted volume cannot suppress either cumulative floor. | Unit, adversarial sequence, fuzz and invariant |
| FEE-05 | Exact-output gross minus both fee components equals the requested net quote amount under the current carried remainders. | Unit and fuzz with zero/nonzero remainders |
| SWAP-01 | All zero-for-one/one-for-zero and exact-input/exact-output quadrants charge executed gross quote volume. | Four executable swap tests |
| SWAP-02 | Quote-specified partial fills revert the entire transaction; no pre-accrual survives. | Adversarial unit |
| SWAP-03 | Quote-unspecified paths use the executed `BalanceDelta`, not the request. | Adversarial unit |
| POOL-01 | One hook instance accepts only its one registered canonical `PoolKey`; other fee/tick/currency keys fail. | Adversarial unit |
| POOL-02 | PoolKey validation, one-time registration and PoolManager initialization are atomic; unsorted currencies, invalid spacing, dynamic/invalid LP fees, LP fees above 999,998 pips, or a bad initial price cannot brick the hook. | Adversarial unit |
| AUTH-01 | BaseHook callbacks and `unlockCallback` accept only the canonical PoolManager. | Adversarial unit |
| AUTH-02 | Only `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` initiates Programmable claims. | Adversarial unit |
| AUTH-03 | The immutable project owner cannot claim Programmable liabilities and vice versa. | Adversarial unit |
| CLAIM-01 | Each authorized owner chooses a nonzero destination per claim; no stored mutable recipient exists. | Unit |
| CLAIM-02 | Project and Programmable balances remain separate and their sum equals total claim-token custody. | Unit plus invariant |
| CLAIM-03 | Every liability is keyed by canonical pool id, quote currency and owner; other pool/currency tuples stay zero. | Adversarial unit |
| SETTLE-01 | Collection mints PoolManager ERC-6909 claims; redemption burns the exact claims before taking underlying quote. | Unit |
| ADDR-01 | CREATE2 deployment requires the exact five permission flags and rejects every other low-bit mask. | Unit |
| SELF-01 | The reference hook exposes no PoolManager swap entry and explicitly declares same-pool self-swaps forbidden. | Static conformance plus unit |

## Rounding rule

Rates use a denominator `D=1,000,000`. For accepted swaps `i` with gross quote `G_i` and effective rate `E_i`, lifetime
entitlements after swap `n` are:

```text
Programmable_n = floor(sum(i=1..n, G_i * 1,000) / D)
project_n      = floor(sum(i=1..n, G_i * (E_i - 1,000)) / D)
total_n        = Programmable_n + project_n
```

Each stream stores its numerator remainder modulo `D`. A claim does not reset either remainder. Therefore fragmenting
the same accepted gross volume produces the same cumulative platform entitlement as one swap, while never rounding the
platform stream upward. The two independently floored streams can leave at most one smallest unit below a single
combined-rate floor; they never add the platform rate on top of the selected total.

Nonzero gross quote below 1,000 units reverts. That lower bound keeps an accepted swap able to fund its newly realized
whole-unit liabilities. A materially coarse quote currency needs a separately reviewed architecture rather than
silently waiving, overstating, or shifting fractional fees between users.

Exact output starts from the closed-form gross-up, searches a fixed 17-value window that covers the two carried
fractional streams, and reverts if `gross-total=requested net` cannot be represented. Tests fuzz both zero and nonzero
carried-remainder states.

## Settlement rule

Hot-path collection uses PoolManager ERC-6909 claims, so it does not transfer ERC-20 tokens into PoolManager. Claim
redemption burns those claims with `CurrencySettler.settle(..., true)` and then takes underlying currency. If an
adaptation instead owes underlying ERC-20 currency to PoolManager, it must use the `sync -> transfer -> settle` order;
`CurrencySettler.settle(..., false)` implements that order. Never transfer first and sync later.

## Explicitly incomplete evidence

- Slither 0.11.5 was run locally across 101 detectors with dependencies and tests filtered; it returned zero findings
  after the intentional native-currency `address(0)` assignment received a narrow inline disposition. Public CI repeats
  this scan. Static analysis is evidence, not an independent audit.
- Echidna campaign: not run.
- Manticore symbolic execution: not run.
- Mainnet-fork lifecycle and gas profiling: not run in this starter package.
- Independent security review or external audit: not performed.
- Deployed bytecode/runtime match, source verification and monitoring: not applicable; not deployed.

These are real remaining gates. Do not relabel Foundry or structural-conformance results as any of them.
