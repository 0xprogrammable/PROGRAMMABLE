# Frontend transaction preflight

The launch form does not construct an arbitrary wallet request. It sends the normalized token setup and connected account to a fixed server route. The server owns the chain, contract addresses, ABI and transaction encoding.

## Direct launch flow

1. Validate the selected behavior against the protocol-tested direct standard
2. Parse token, ETH and price inputs with integer arithmetic
3. Verify an existing token against the official UERC20Factory when applicable
4. Refuse to continue unless the production deployment manifest is marked ready
5. Match official and Launcher runtime bytecode to the release manifest
6. Read the launcher’s immutable PoolManager, PositionManager, token factory, hook factory, position factory and treasury
7. Predict the new token address or reuse the verified existing token address
8. Read the hook factory’s exact init-code hash and mine an address with only the required v4 callback flags
9. Check ETH balance, token balance and allowance
10. Build either an exact token approval or the complete atomic launch call
11. Run the exact call with `eth_call`, estimate gas and check the maximum required ETH balance
12. Return the fixed transaction and a hash of its account, type, chain, target, calldata and value

The browser repeats the complete preflight when the user presses the final approval or launch button. Privy opens only when the fresh plan hash matches the plan already shown in Review. A changed allowance, address, calldata, value or contract state updates the Review instead of opening a stale wallet request.

## Opening price

The public input is tokens per ETH. The server converts it to Uniswap’s raw currency ratio and then to `sqrtPriceX96` without JavaScript `Number` arithmetic:

```text
raw ratio = tokensPerEth × 10^tokenDecimals ÷ 10^18
sqrtPriceX96 = floor(sqrt(raw ratio × 2^192))
```

The result must remain inside the exact v4 `TickMath` bounds. New Launcher tokens use 18 decimals. Existing UERC20s use the immutable decimals read from Ethereum.

## Existing-token approval

The existing-token path accepts only a token whose address can be reconstructed from its immutable UERC20 identity through the configured official factory. The connected account must equal the token’s recorded creator. If allowance is insufficient, the preflight returns an approval for exactly the token liquidity amount, not an unlimited approval. The launch call is prepared only after the allowance is visible onchain.

## Deployment gate

`contracts/config/app-deployments.v1.json` is the release switch. Mainnet is currently `not-deployed`, so the route returns no target, calldata or wallet transaction. A ready entry requires all three Launcher addresses and their exact runtime-code hashes. The catalog validator deliberately fails if the current repository claims mainnet readiness.

## Auction flow

1. Fix the allocation policy at 50% auction supply, 50% LP reserve, 100% proceeds allocation and a full-range position
2. Save a schedule beginning 100 Ethereum blocks after preparation, running for 1,200 blocks, becoming claimable at the end block and migratable one block later
3. Convert the minimum valuation in ETH to raw currency per raw token in Q96, snap it to the official CCA tick boundary and derive the currency required to clear the auction half at that floor
4. Derive the official 12-step convex emission curve with 30% of supply emitted in the final block
5. Match the installed Liquidity Launcher SDK addresses to the pinned official deployment snapshot and verify current runtime bytecode
6. Select either the fixed 0.30% hook or the separately tested 0.30–1.00% bounded dynamic hook, then verify that family’s factory bytecode
7. Predict the UERC20 from the connected creator, then derive the permanent position recipient and exact v4 hook address with that family’s callback mask
8. Prepare and simulate the deterministic LP-lock deployment if it does not exist
9. Prepare and simulate the deterministic hook deployment if it does not exist
10. Build the official LiquidityLauncher multicall that atomically creates the token and distributes the full supply to LBPStrategy
11. Check that the destination pool is neither initialized nor reserved, predict the CCA address and simulate the exact atomic launch

The browser repeats preflight before every setup or launch signature. If the saved schedule is too close to starting, the server replaces it with a fresh canonical window before any wallet prompt opens.
