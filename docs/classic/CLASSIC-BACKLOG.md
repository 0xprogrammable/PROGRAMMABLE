# Classic

Classic is Programmable's fixed-supply Uniswap v4 launch model. The product name stays
`Classic` as its capabilities grow.

This file is the product and release backlog for Classic. A capability belongs in
`Available now` only after its exact Ethereum deployment, source verification, lifecycle
evidence and app release are complete.

## Available now

- Fixed supply of 1,000,000,000 tokens with 18 decimals
- One permanently locked, one-sided Uniswap v4 position
- Mandatory Initial Buy of at least 0.0006 ETH, with larger buys supported
- Fixed 1.00% total swap fee
  - 0.90 percentage points accrue to the creator in ETH
  - 0.10 percentage points accrue to Programmable in ETH
- No ERC-20 transfer tax
- No owner minting, blacklist, pause or post-launch fee changes
- Public launch, liquidity, Initial Buy and fee events

### Directional fees

- Buy and sell fees are selected independently
- Each direction accepts a whole percentage from 1% through 10%
- Programmable's disclosed 0.10 percentage-point share is included in the selected
  total, never added on top
- Fee rates are immutable after launch

### Creator reward allocations

- Creator rewards remain ETH-denominated
- A launch can use the launch wallet, one external wallet or a split
- A split supports one to five allocations
- Shares may differ but must be positive and total exactly 100%
- Each payout wallet can claim only its own accrued ETH
- The developer and Programmable cannot claim another wallet's rewards

### Change payout wallet

- The current payout wallet can change where only its future rewards accrue in one
  transaction
- The new wallet does not need to accept
- All creator fees accrued before the change remain claimable by the old wallet
- Changing the payout wallet never transfers previously accrued, unclaimed ETH
- Only fees accrued after the change belong to the new wallet
- The allocation percentage does not change
- A transfer to a wallet that already owns another allocation is allowed
- There is no administrator recovery for a mistyped destination

### Community takeovers

- Every Classic launch is eligible for a Programmable-approved community takeover
- The initial CTO authority is
  `0x2Bb333d48DFAF1596D9036671d2E43168994249E`
- An approved CTO takes effect immediately
- A CTO may replace the complete future creator-reward configuration with one to five
  allocations whose shares total 100%
- All fees accrued before the CTO remain claimable under the previous configuration
- Only fees accrued after the CTO use the new configuration
- CTO actions cannot change swap fees, Programmable's share, token supply, token
  behavior or locked liquidity
- Every CTO records the previous configuration, new configuration and approval
  reference onchain
- The CTO authority can be transferred through a two-step propose-and-accept flow

### Initial Buy custody

- Initial Buy remains mandatory with a minimum of 0.0006 ETH
- The creator can choose a larger Initial Buy
- One immutable custody mode applies to 100% of the tokens bought in that Initial Buy:
  - Unlocked
  - Locked until a fixed release time
  - Linear vesting
  - Cliff followed by linear vesting
- The launch wallet is the immutable beneficiary
- Lock and vesting rights cannot be transferred
- Presets include 30, 90, 180 and 365 days
- Custom schedules accept 1 through 3,650 days
- Cliff schedules require at least one day before the cliff and at least one day
  of linear vesting after it

### Launch preview

Before signing, the app shows:

- Token supply and starting price
- Initial Buy amount and estimated token output
- Buy fee, sell fee, creator share and Programmable share
- Reward wallets and exact percentages
- CTO eligibility and authority
- Initial Buy custody mode, beneficiary and release schedule
- Permanent liquidity custody

## Under design

- The public CTO application form, evidence requirements and approval-reference format
- Future fee destinations such as liquidity growth, buyback and burn, or holder rewards;
  each requires a separate launch model or security review

## Rejected

- User-facing names such as Classic V2 or Classic V3
- Hidden or undisclosed fees
- A 0% total swap fee while Programmable's 0.10 percentage-point share applies
- Fees added on top of the user's selected total
- Post-launch buy-fee or sell-fee changes
- Retroactive reassignment of accrued rewards
- Developer control over another wallet's allocation
- A CTO receiving rewards accrued before its effective transaction
- Owner minting, arbitrary rescue, blacklist, pause or honeypot behavior
- Any ability to remove or redirect the permanently locked liquidity position

## Current release state

- The configurable Classic release is deployed on Ethereum and enabled by the
  production manifest
- All seven contracts match on Etherscan and Sourcify
- The Mainnet canary completed launch, buy, sell, creator claim and Programmable claim
- The release passes 688 app tests, 613 deterministic Solidity tests, fuzz and
  stateful invariants, plus the pinned Ethereum lifecycle
- ESLint, TypeScript, Forge formatting, Forge lint, the webpack production build
  and Classic-focused Slither analysis pass; the repository-wide Solidity linters
  still report unrelated Deep-model warnings
- Exact deployed addresses, runtime hashes, blocks and transactions are recorded in
  `contracts/deployments/mainnet-classic-v3.json`
- Existing Classic tokens cannot be retrofitted with the new reward or Initial Buy
  custody rules
