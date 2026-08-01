# Protocol revenue V1 Slither triage

Slither 0.11.5 was run separately against each production contract with dependencies excluded from reporting. Raw JSON
is stored alongside this document.

| Target | High | Medium | Low | Informational | Disposition |
| --- | ---: | ---: | ---: | ---: | --- |
| Router | 3 | 11 | 7 | 0 | Reviewed; no unmitigated finding identified |
| Enforcer | 0 | 0 | 1 | 9 | Reviewed; no unmitigated finding identified |
| Executor | 0 | 1 | 2 | 12 | Reviewed; no unmitigated finding identified |

## Router

- **Reentrancy findings:** `process` is protected by OpenZeppelin `ReentrancyGuardTransient`. It is the router's only
  mutating external entry point. Universal Router, PositionManager, Permit2, the main hook and `$V4` are fixed and
  code-hash bound. Reentrant view calls can observe an in-progress state but cannot redirect funds or mutate policy.
- **Calls in a loop:** the swap loop is intentionally bounded to 32 chunks. Chunking enforces per-chunk output and price
  movement checks, plus a separate 500-tick cumulative bound.
- **Strict equality:** the reported equality checks are zero/sentinel checks for first-cycle state, liquidity and
  minimum-output validity. They do not compare attacker-controlled asset balances to grant authority.
- **Uninitialized memory struct:** Solidity zero-initializes memory. Every field used in accounting is assigned before
  use; the fork and fuzz suites exercise the path.
- **Unused tuple values:** only the pool fields required for binding and price checks are intentionally read.
- **Timestamp findings:** timestamps enforce report freshness and a 24-hour minimum cadence. Seconds of validator
  discretion do not change recipients, percentages or authorization.

## Enforcer

- **Timestamp:** the postcondition requires the router to record the current transaction timestamp. This proves that the
  process call completed in the same atomic delegation redemption.
- **Assembly:** `_decodeProcessCall` operates only after an exact 68-byte length check. The complete calldata is then
  compared with canonical `abi.encodeCall` output.
- **Naming and literal style:** interface names match deployed public getters. The 32-byte mode literal is the exact
  ERC-7579 batch/default mode used by MetaMask's Delegation Framework.

## Executor

- **Strict equality:** zero accrued fees are omitted from the canonical batch. This does not grant access or determine
  ownership.
- **Timestamp:** checks enforce CRE freshness, future skew, replay ordering and the router's actual wall-clock cooldown.
- **Assembly:** `_workflowIdentity` runs only after the official 62-byte metadata length is verified. The offsets match
  CRE's packed `bytes32 workflowId + bytes10 workflowName + address workflowOwner` layout.
- **Naming and literal style:** names match deployed getter ABIs and the exact ERC-7579 mode encoding.

## Review-driven change

The initial chunked swap design limited every `0.1 ETH` chunk to 100 ticks but did not independently limit the complete
purchase. Review added `MAX_TOTAL_SWAP_TICK_MOVE = 500` from the cycle's starting tick and an atomic failure test. This
closes a cumulative price-impact bypass while preserving the current live-backlog execution path.
