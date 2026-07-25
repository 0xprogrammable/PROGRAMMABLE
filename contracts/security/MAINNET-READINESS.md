# Mainnet readiness gate

Current state: blocked by design. The protocol spike is green locally and on a read-only Ethereum fork, but it is not audited or deployed.

## Required before Sepolia

- Choose the real fee-recipient treasury
- Choose the LP-position recipient and locking or forwarding policy
- Fix the production CCA schedule and rehearse the exact factory, salt and protocol-fee-controller path
- Add deployment scripts with chain-ID and bytecode-hash guards
- Add frontend calldata generation and simulation against the same machine-readable spec
- Publish source and dependency pins with the deployment artifacts

## Required before mainnet

- Complete Sepolia launch, migration, swap, fee collection and failure-recovery rehearsals
- Commission an independent audit and resolve every accepted finding
- Recheck current official Uniswap deployment addresses and runtime bytecode
- Verify the factory and hook source code on the block explorer
- Confirm the exact 10-bp fee disclosure in the launch confirmation and token detail view
- Document treasury custody, monitoring, incident response and upgrade-by-new-version policy
- Obtain legal review for platform operation and prohibit unsupported securities or RWA claims

## Owner inputs still missing

- Treasury address
- Deployment signer or Safe policy
- LP ownership and lock policy
- Final brand and production domain

No private key or placeholder treasury is embedded in the repository.
