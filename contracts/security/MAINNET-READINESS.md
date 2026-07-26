# Mainnet readiness gate

Current state: blocked by design. The auction, new-token direct and existing-UERC20 direct variants are green locally and on pinned read-only Ethereum and Sepolia forks, but they are not audited or deployed.

## Required before Sepolia

- Fund `0x2Bb333d48DFAF1596D9036671d2E43168994249E` with Sepolia ETH. The latest 2026-07-26 dry run estimated 0.025241416086645184 Sepolia ETH; 0.04 provides a rehearsal margin, subject to a fresh estimate
- Sign the rehearsal from that address through a local Foundry keystore or hardware wallet; never place its private key in this repository
- Rehearse the three-contract infrastructure deployment and verify its source and runtime bytecode
- Rehearse the fixed four-hour CCA schedule, 50/50 token allocation, minimum-valuation floor, exact factory, salt and protocol-fee-controller path
- Rehearse the direct launch, bidirectional swaps and separate platform/creator fee collection
- Rehearse the existing-UERC20 launch with factory provenance, recorded-creator authorization, bidirectional swaps and separate platform/creator fee collection
- Rehearse the frontend-generated direct approval and launch calldata against the deployed Sepolia contracts and bind the evidence to the exact commit
- Rehearse the frontend-generated auction lock setup, hook setup and atomic LiquidityLauncher calldata against deployed Sepolia contracts and bind the evidence to the exact commit
- Publish source and dependency pins with the deployment artifacts

The platform treasury is fixed to `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. The LP policy is also fixed: the official Uniswap `PositionFeesForwarder`, zero operator, maximum `uint256` timelock and launch creator as immutable LP-fee recipient. The standard auction is enabled only while the pinned CCA factory’s protocol fee controller is the zero address, which is what allows all auction proceeds to fund the pool. The Sepolia deployment script fails closed on chain ID, broadcaster and eight official runtime-code hashes.

## Required before mainnet

- Complete Sepolia auction, new-token direct and existing-UERC20 direct launches, migration where applicable, swaps, fee collection and failure-recovery rehearsals
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

The direct and auction preflights are implemented but intentionally disabled by `config/app-deployments.v1.json`. Direct launch validates integer-only amount and price math, reconstructs existing-UERC20 provenance and prepares the exact approval or atomic launch. Auction launch derives the canonical CCA economics and schedule, predicts the official token and auction, prepares deterministic lock and hook setup, checks pool availability and builds the atomic LiquidityLauncher multicall. Both paths verify official and Launcher runtime bytecode, run the exact `eth_call`, estimate gas and return a fixed transaction for explicit Privy wallet review. The route does not accept a target address or calldata from the browser.

This is implementation evidence, not deployment evidence. No production transaction can be prepared while the mainnet manifest remains `not-deployed`.
