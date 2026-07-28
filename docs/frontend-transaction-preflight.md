# Frontend transaction preflight

The browser never chooses a contract address or supplies arbitrary calldata. It sends a normalized Classic draft and connected account to `/api/launch/preflight`. The server owns the chain, deployment record, ABI, transaction encoding and simulation.

## Classic launch

1. Require a token name, symbol and description within the fixed limits
2. Require one total swap fee from 1% through 10% in whole percentage points
3. Fix the supply at 1,000,000,000 tokens and require a creator-selected Dev Buy of at least 0.0006 ETH
4. Validate optional website, image, X and Telegram values as bounded HTTPS URLs
5. Encode official UERC20 v2.0.0 metadata as `(string description,string website,string image,bytes extraData)`
6. Encode no social links as `0x`, or versioned UTF-8 JSON `{v:1,x?,telegram?}` as `extraData`
7. Refuse preparation unless the selected Classic deployment is marked ready
8. Verify runtime code hashes for the hook factory, shared hook, position-forwarder factory and launcher
9. Verify the hook factory recognizes the shared hook
10. Read the launcher's immutable PoolManager, PositionManager, token factory, hook and position-forwarder factory
11. Verify the hook's PoolManager, treasury, 10-basis-point platform share, 0 LP fee, tick spacing 200 and callback mask `8396`
12. Predict the creator-bound UERC20 address and refuse an occupied address
13. Encode the single payable `MemeLaunchV1.launch` call with the selected Dev Buy, which must be at least 0.0006 ETH
14. Simulate the exact call, estimate gas and check that the connected account can pay the network cost
15. Return the fixed transaction and a hash of its account, chain, target, calldata and value

The browser repeats the preflight when the user presses the final button. Privy opens only when the fresh plan hash matches the plan shown in Review. A changed account, chain, deployment, calldata or simulation result replaces the stale review instead of opening a wallet request.

## Fee encoding

The selected number is the complete hook fee. The fixed Programmable share is deducted from it.

```text
selected 1%  → totalSwapFeeBps 100  → creator 90 bps  + Programmable 10 bps
selected 2%  → totalSwapFeeBps 200  → creator 190 bps + Programmable 10 bps
selected 10% → totalSwapFeeBps 1000 → creator 990 bps + Programmable 10 bps
```

The launch call sends the creator's selected Dev Buy into the atomic initial market buy. The contract requires at least 0.0006 ETH, and the client requires the prepared transaction value to match the current form exactly. This is not a launch fee or liquidity deposit, and the purchased tokens go directly to the creator. Ethereum gas and any independently enabled Uniswap protocol fee are outside the fee split.

## Direct trading

The canonical Classic pool key is native ETH, launched token, fee `0`, tick spacing `200` and the verified Classic hook.

For each exact-input trade, the server:

1. Verifies the ready deployment and runtime code for the official PoolManager, V4Quoter, Universal Router, Permit2 and Classic hook
2. Quotes the canonical PoolKey through `V4Quoter.quoteExactInputSingle`
3. Applies the selected slippage to produce a nonzero minimum output
4. Restricts the transaction deadline to between 60 seconds and one hour
5. Encodes `SWAP_EXACT_IN_SINGLE`, `SETTLE_ALL` and `TAKE_ALL` with the official v4 SDK
6. Wraps the actions in Universal Router v2.0 `execute`

A buy sends native ETH as the router call value. A sell returns, when needed, a token approval to pinned Permit2 and then a Permit2 allowance for the pinned Universal Router before returning the swap transaction.

These builders define the direct trading path. They remain fail closed whenever the selected deployment gate is not ready.

## Deployment gate

`contracts/config/app-deployments.v1.json` is the release switch.

- Mainnet Classic is `ready`
- Sepolia Classic is `ready` for an explicitly configured rehearsal build

The Mainnet record contains exact addresses, deployment blocks, runtime hashes, source-verification state and the
two-RPC-reconciled canary lifecycle for the current Classic release. The Sepolia record contains the equivalent
source-verified atomic Dev Buy release and signed Test2 lifecycle. The app uses Sepolia only when both server and client
select the `rehearsal` environment. Older lifecycles remain separately historical and are not release eligible.

## Read model

Explore and Profile read through the verified release manifest:

1. Scan confirmed logs from the launcher deployment block
2. Pair `MemeTokenLaunched` and `MemeLiquidityConfigured` from the verified launcher
3. Reject `PoolRegistered` or any unpaired shared-hook event as launch provenance
4. Accept `NativeSwapFeesAccrued` only for canonical pool IDs established by those pairs
5. Read token identity, supply, creator and UERC20 metadata at one snapshot block
6. Read pool price and active liquidity from the official StateView at that same block
7. Verify runtime code hashes for the launcher, hook and StateView

Production persists an integrity-checked private snapshot after full confirmed replay and agreement between two
authenticated RPC providers. The five-minute refresh is reorg-aware and fails health checks on RPC disagreement or a
snapshot older than fifteen minutes. Incremental checkpoints remain a scale requirement before full replay approaches
the function-duration budget.
