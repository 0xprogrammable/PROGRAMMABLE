# Protocol revenue V2 Slither triage

Slither 0.11.5 was run separately against both production contracts with dependency paths excluded from reporting.
The raw JSON outputs are retained beside this document.

| Target | Findings | Disposition |
| --- | ---: | --- |
| Claim Coordinator | 6 | Reviewed; no unmitigated finding identified |
| Revenue Vault | 24 | Reviewed; no unmitigated finding identified |

## Claim Coordinator

- **Reentrancy:** `claim` uses `ReentrancyGuardTransient`. The only external calls target two fixed, code-hash-bound
  hooks. Those hooks pay their immutable recipient directly; the Coordinator never receives ETH. State updates after
  the calls are accounting records and the complete transaction reverts if the recipient balance delta differs.
- **Strict equality:** `lastClaimedAt == 0` only selects the first-run timestamp sentinel.
- **Timestamp:** timestamps enforce a 24-hour minimum cadence. Validator discretion of seconds cannot change the
  recipient, amount or caller authorization.

## Revenue Vault

- **Balance reads around the router:** `process` is transient-reentrancy guarded. The token and router addresses are
  fixed and code-hash bound. Per-chunk and total token deltas are postconditions; stale or unexpected balances cannot
  redirect funds and cause an atomic revert when a minimum is missed.
- **Calls in a loop:** the loop is intentionally capped at 32 chunks of at most `0.1 ETH`. Every chunk has a fee-aware
  output floor and 100-tick movement bound, with a separate 500-tick complete-cycle bound.
- **Strict equality:** zero checks are first-cycle and nonzero-output sentinels, not authorization decisions.
- **Unused tuple fields:** PoolManager and hook getters return fields that are not required for the fixed pool and price
  checks. The security-relevant values are validated explicitly.
- **Timestamp:** timestamps enforce a daily cadence, a 30-minute finalized observation window and a five-minute router
  deadline. Tick, output and cumulative movement checks independently constrain the swap.

## Residual boundary

The Coordinator can automate only Classic V1 and V2 because those hooks expose permissionless claims that always pay
the fixed revenue wallet. Existing Classic V3, Deep and quote-asset hooks require the revenue wallet as caller and stay
manual. No claim from those contracts is represented as automated.
