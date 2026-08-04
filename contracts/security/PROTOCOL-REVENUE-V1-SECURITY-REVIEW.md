# Protocol revenue V1 security review

## Scope

- `ProtocolRevenueRouterV1`
- `ProtocolRevenueExecutionEnforcerV1`
- `ProtocolRevenueMetaMaskExecutorV1`
- `IProtocolRevenueMetaMaskV1`
- `DeployMainnetProtocolRevenueV1`
- the disabled Chainlink CRE workflow in `ops/protocol-revenue-cre`

This is an internal review of the local release candidate. It is not an independent audit or live-deployment proof.

## Security properties

### Access and authority

- Only the fixed revenue wallet can call `process`, configure the one-time delegation or use the manual fallback.
- Automation accepts reports only from the code-hash-pinned Mainnet CRE Forwarder and fixed workflow identity.
- MetaMask's existing EIP-7702 implementation is preserved; the signed delegation remains revocable.
- The caveat accepts one canonical claim, exact Deep transfer and process batch. Unsigned arguments are forbidden.

### Funds and accounting

- Exactly 50% of each aggregate claim buys `$V4`; the remainder goes to Treasury.
- Bought `$V4` is transferred to the fixed revenue wallet. No LP position is created or modified.
- Classic claims go directly to the router. Only the exact Deep snapshot crosses the revenue wallet.
- Prior wallet ETH and unallocated router ETH are excluded from automated processing.
- The enforcer recomputes the hook snapshot and binds it to the router call's `claimedRevenue` argument.
- Claims, transfer, Treasury payment, swap and token delivery are atomic.

### Price and timing bounds

- The finalized-block reference tick may differ from execution by at most 100 ticks.
- Each purchase chunk is at most `0.1 ETH`, has a fee-aware minimum output and may move the pool by at most 100 ticks.
- The full cycle may move the pool by at most 500 ticks and contains at most 32 chunks.
- A successful cycle starts a real 24-hour cooldown; scheduler timestamps cannot accelerate it.

## Property-based and fork tests

The Foundry suite checks:

1. exact 50/50 conservation, including odd-wei handling;
2. bought-token delivery and zero token retention in the router;
3. exclusion of old wallet ETH and unrelated router ETH;
4. exact claim amount binding and rejection of altered process amounts;
5. atomic failure for insufficient balance, capacity and cumulative price impact;
6. delegation, revocation, report identity, replay and caveat restrictions.

## Manual review

| Area | Result |
| --- | --- |
| Upgradeability | No proxy, initializer or upgrade function |
| Administration | No owner, role, pause, recovery or arbitrary-call surface |
| Reentrancy | Mutating entry points use OpenZeppelin transient guards |
| Token integration | Exact `$V4`, PoolManager, hook and Universal Router are runtime-code-hash bound; SafeERC20 is used |
| Liquidity | No liquidity position, PositionManager or Permit2 dependency remains |
| MEV | Reference, output, per-chunk and cumulative tick bounds fail closed; no TWAP claim is made |
| Arithmetic | Checked Solidity arithmetic, FullMath for the split and explicit narrowing checks |
| Loops | The only external-call loop is capped at 32 iterations |
| Failure mode | The full claim and buyback sequence reverts atomically |

## Residual risks

- This is not an independent audit.
- The spot reference can be manipulated; the bounds limit harm but do not eliminate MEV.
- A reverting Treasury, paused MetaMask manager, revoked delegation, dependency code drift, insufficient CRE funding or
  a cycle above price/capacity bounds can stop automation.
- Bought `$V4` remains controlled by the fixed revenue wallet after delivery.
- New hook versions and non-native fee assets require explicit reviewed support.
- Buybacks generate normal hook fees, which become eligible in a later cycle.

## Release boundary

Local tests and static analysis do not make this production-ready. Mainnet deployment, source verification, a signed
delegation, funded CRE activation, a small live lifecycle and monitoring remain required.
