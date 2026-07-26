# Mainnet readiness gate

Current state: blocked by design. The fixed-fee auction, bounded dynamic-fee auction, new-token direct and
existing-UERC20 direct variants are green locally and on pinned Ethereum and Sepolia forks. The four-contract Sepolia
infrastructure is deployed and source-verified, but no complete launch rehearsal or independent audit has been
completed.

## Completed Sepolia infrastructure

- The configured wallet received `0.05 Sepolia ETH` from Google Cloud in transaction
  `0x1ef3f04c455cd98197b3900cc233638fc97127eeab8683e0bfdc4d9d5174d122`
- The four deployments succeeded at the nonce-derived addresses recorded in `config/app-deployments.v1.json`
- All four runtime-code hashes and immutable dependency getters match the deployment specification
- Blockscout serves verified Solidity source compiled with Solidity 0.8.26, Cancun and 1,000 optimizer runs
- The deployment manifest records every receipt, block, runtime-code hash, dependency pin and explorer verification
- The post-deployment wallet nonce is four and the remaining balance is `0.023250300786254092 Sepolia ETH`

## Still required on Sepolia

- Rehearse the fixed four-hour CCA schedule, 50/50 token allocation, minimum-valuation floor, exact factory, salt and protocol-fee-controller path
- Rehearse the bounded dynamic-fee auction, migration, cross-block fee update and fixed 1.00% ceiling
- Rehearse the direct launch, bidirectional swaps and separate platform/creator fee collection
- Rehearse the existing-UERC20 launch with factory provenance, recorded-creator authorization, bidirectional swaps and separate platform/creator fee collection
- Rehearse the frontend-generated direct approval and launch calldata against the deployed Sepolia contracts and bind the evidence to the exact commit
- Rehearse the frontend-generated auction lock setup, hook setup and atomic LiquidityLauncher calldata against deployed Sepolia contracts and bind the evidence to the exact commit

The platform treasury is fixed to `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. The LP policy is also fixed: the official Uniswap `PositionFeesForwarder`, zero operator, maximum `uint256` timelock and launch creator as immutable LP-fee recipient. The standard auction is enabled only while the pinned CCA factory’s protocol fee controller is the zero address, which is what allows all auction proceeds to fund the pool. The Sepolia deployment script fails closed on chain ID, broadcaster and eight official runtime-code hashes.

## Required before mainnet

- Complete Sepolia fixed-fee auction, bounded dynamic-fee auction, new-token direct and existing-UERC20 direct launches, migration where applicable, swaps, fee collection and failure-recovery rehearsals
- Commission an independent audit and resolve every accepted finding
- Run `npm run contracts:official-deployments` against Uniswap’s current registry, then recheck runtime bytecode
- Verify the factories, direct launcher and every launched hook source on the block explorer
- Confirm the exact 10-bp fee disclosure in the launch confirmation and token detail view
- Replace `not-deployed` in `config/app-deployments.v1.json` only after recording the verified mainnet addresses and runtime-code hashes
- Bind production preflight requests to a verified Privy session and enforce provider-level rate limits before enabling the CPU-bound hook search
- Implement and rehearse the specified monitoring and incident-response process; document treasury custody and upgrade-by-new-version policy
- Obtain legal review for platform operation and prohibit unsupported securities or RWA claims

## Owner inputs still missing

- Explicit confirmation that the supplied EOA is the final immutable mainnet treasury, or a replacement Safe address
- Production deployment signer or Safe policy
- Final brand and production domain

No private key is embedded in the repository. The public treasury and test-wallet addresses are recorded in `config/deployment-inputs.v1.json`.

## Frontend transaction gate

The production direct and auction preflights remain intentionally disabled because the mainnet entry in
`config/app-deployments.v1.json` is `not-deployed`. The same manifest now records the verified Sepolia infrastructure as
the rehearsal target. Direct launch validates integer-only amount and price math, reconstructs existing-UERC20
provenance and prepares the exact approval or atomic launch. Auction launch derives the canonical CCA economics and
schedule, selects the fixed-fee or bounded dynamic-fee hook family, predicts the official token and auction, prepares
deterministic lock and hook setup, checks pool availability and builds the atomic LiquidityLauncher multicall. Both
paths verify official and Launcher runtime bytecode, run the exact `eth_call`, estimate gas and return a fixed
transaction for explicit Privy wallet review. The route does not accept a target address or calldata from the browser.

The Sepolia manifest and receipts are deployment evidence, not end-to-end launch evidence. No production transaction
can be prepared while the mainnet manifest remains `not-deployed`.
