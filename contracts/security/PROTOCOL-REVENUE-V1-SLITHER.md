# Protocol revenue V1 Slither triage

Slither 0.11.5 was run separately against each production contract with dependencies excluded from reporting. Raw JSON
is stored alongside this document.

| Target | High | Medium | Low | Informational | Disposition |
| --- | ---: | ---: | ---: | ---: | --- |
| Router | 4 | 8 | 7 | 0 | Reviewed; no unmitigated finding identified |
| Enforcer | 0 | 0 | 1 | 9 | Reviewed; no unmitigated finding identified |
| Executor | 0 | 0 | 2 | 11 | Reviewed; no unmitigated finding identified |

## Router

- **Reentrancy findings:** `process` is protected by OpenZeppelin `ReentrancyGuardTransient`. It is the router's only
  mutating external entry point. Universal Router, PoolManager, the main hook and `$V4` are fixed and code-hash bound.
  The balance-delta checks flagged around swaps are inside the same guarded call. Reentrant view calls can observe an
  in-progress state but cannot redirect funds or mutate policy.
- **Calls in a loop:** the swap loop is intentionally bounded to 32 chunks. Chunking enforces per-chunk output and price
  movement checks, plus a separate 500-tick cumulative bound.
- **Strict equality:** the reported equality checks are zero/sentinel checks for first-cycle and minimum-output
  validity. They do not compare attacker-controlled balances to grant authority.
- **Unused tuple values:** only the pool fields required for binding and price checks are intentionally read.
- **Timestamp findings:** timestamps enforce report freshness and a 24-hour minimum cadence. Seconds of validator
  discretion do not change recipients, percentages or authorization.

## Enforcer

- **Timestamp:** the postcondition requires the router to record the current transaction timestamp. This proves that the
  process call completed in the same atomic delegation redemption.
- **Assembly:** `_decodeProcessCall` operates only after an exact 100-byte length check. The complete calldata is then
  compared with canonical `abi.encodeCall` output.
- **Naming and literal style:** interface names match deployed public getters. The 32-byte mode literal is the exact
  ERC-7579 batch/default mode used by MetaMask's Delegation Framework.

## Executor

- **Strict equality:** zero accrued fees are omitted from the canonical batch. This does not grant access or determine
  ownership.
- **Timestamp:** checks enforce finalized-observation freshness, future skew, replay ordering and the router's actual
  wall-clock cooldown.
- **Keeper boundary:** only the immutable keeper may use the automated entry point. The keeper selects only a recent
  observation timestamp and bounded reference tick; the caveat reconstructs every funds-moving call independently.
- **Naming and literal style:** names match deployed getter ABIs and the exact ERC-7579 mode encoding.

## Review-driven changes

The initial chunked swap design limited every `0.1 ETH` chunk to 100 ticks but did not independently limit the complete
purchase. Review added `MAX_TOTAL_SWAP_TICK_MOVE = 500` from the cycle's starting tick and an atomic failure test. This
closes a cumulative price-impact bypass while preserving the current live-backlog execution path.

The Vercel-keeper revision removed the CRE receiver and workflow-identity parser. The immutable split is now 50% to
Treasury, 49.5% to the buy and 0.5% to the keeper gas reserve. The exact claim amount remains bound in the enforcer and
router, and tests prove that pre-existing revenue-wallet ETH and unrelated router ETH remain untouched.
