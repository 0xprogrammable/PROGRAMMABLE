# Mainnet readiness gate

Current state: blocked by design. The auction and direct variants are green locally and on pinned read-only Ethereum and Sepolia forks, but they are not audited or deployed.

## Required before Sepolia

- Fund `0x2Bb333d48DFAF1596D9036671d2E43168994249E` with Sepolia ETH. The latest 2026-07-26 dry run estimated 0.01756022828985984 Sepolia ETH; 0.03 provides a rehearsal margin, subject to a fresh estimate
- Sign the rehearsal from that address through a local Foundry keystore or hardware wallet; never place its private key in this repository
- Rehearse the three-contract infrastructure deployment and verify its source and runtime bytecode
- Fix the production CCA schedule and rehearse the exact factory, salt and protocol-fee-controller path
- Rehearse the direct launch, bidirectional swaps and separate platform/creator fee collection
- Add frontend calldata generation and simulation against the same machine-readable spec
- Publish source and dependency pins with the deployment artifacts

The platform treasury is fixed to `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. The LP policy is also fixed: the official Uniswap `PositionFeesForwarder`, zero operator, maximum `uint256` timelock and launch creator as immutable LP-fee recipient. The Sepolia deployment script fails closed on chain ID, broadcaster and eight official runtime-code hashes.

## Required before mainnet

- Complete Sepolia auction and direct launches, migration where applicable, swaps, fee collection and failure-recovery rehearsals
- Commission an independent audit and resolve every accepted finding
- Run `npm run contracts:official-deployments` against Uniswap’s current registry, then recheck runtime bytecode
- Verify the factories, direct launcher and every launched hook source on the block explorer
- Confirm the exact 10-bp fee disclosure in the launch confirmation and token detail view
- Implement and rehearse the specified monitoring and incident-response process; document treasury custody and upgrade-by-new-version policy
- Obtain legal review for platform operation and prohibit unsupported securities or RWA claims

## Owner inputs still missing

- Explicit confirmation that the supplied EOA is the final immutable mainnet treasury, or a replacement Safe address
- Production deployment signer or Safe policy
- Final brand and production domain

No private key is embedded in the repository. The public treasury and test-wallet addresses are recorded in `config/deployment-inputs.v1.json`.
