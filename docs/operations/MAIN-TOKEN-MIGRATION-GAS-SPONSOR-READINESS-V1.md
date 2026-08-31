# Main Token Migration Gas Sponsor V1 Readiness

This checklist remains the release and incident-response gate for the active migration window. Operational values
belong only in the deployment secret manager and private release evidence.

## Candidate identity

- [ ] The candidate is an immutable build from the exact reviewed `production` commit.
- [ ] `config/main-token-migration-activation.v1.json` binds the reviewed release and has a 259,200-second window,
      exact finalized pre-window eligibility block number and hash.
- [ ] The sponsor contract matches
      `config/main-token-migration-gas-sponsor-contract.v1.json` byte-for-byte in the candidate.
- [ ] The current-holder gasless path matches
      `config/main-token-migration-gasless-transfer-contract.v1.json` byte-for-byte in the candidate.
- [ ] The normalized provider readback exactly matches
      `config/main-token-migration-gas-sponsor-privy-policy.v2.json`.

## Server configuration

- [ ] `MAIN_TOKEN_MIGRATION_GAS_SPONSOR_ENABLED=true` exists only in the intended deployment environment.
- [ ] The exact Privy wallet ID, exact single policy ID and checksummed wallet address all identify the same dedicated
      Ethereum EOA.
- [ ] Maximum top-up is positive and no greater than 2,000,000,000,000,000 wei.
- [ ] Total budget is at least the maximum top-up, no greater than 1,000,000,000,000,000,000 wei, and below the
      wallet's funded balance after a deliberate safety margin.
- [ ] Privy app secret, projection database URL/CA/role, and the committed independent dRPC/QuickNode pair are present
      and remain server-only.

## Wallet policy

- [ ] The wallet readback reports `chain_type=ethereum`, the configured address and exactly one attached policy.
- [ ] The attached policy ID exactly matches the configured policy ID.
- [ ] The policy allows only strictly positive bounded Mainnet top-ups plus exact V4 `permit` and `transferFrom`
      calls; the permit spender and fixed migration destination are provider-enforced and unrelated calls default to
      deny.
- [ ] Server tests independently bind the exact linked holder, signed amount, token calldata, native recipient,
      sender, type-2 fee/gas limits and exact calculated value.
- [ ] The sponsor address differs from both the V4 token and migration recipient addresses and has empty runtime code.

## Focused behavior

- [ ] Disabled manifest or disabled environment switch returns a fail-closed unavailable response and spends nothing.
- [ ] An authenticated linked EOA that held the requested V4 amount at the eligibility block can receive only its bounded
      current gas deficit.
- [ ] Unlinked wallets, unsupported smart-contract wallets, insufficient current token balances, wrong eligibility block for native top-ups,
      RPC disagreement, quotes above 20 gwei, exhausted budget and the final five minutes all fail closed.
- [ ] Concurrent duplicate requests reserve and broadcast no more than one transfer.
- [ ] An ambiguous Privy response is recorded as unknown and is not rebroadcast.
- [ ] Dual-RPC readback confirms the exact transaction fields and successful receipt before status becomes confirmed.
- [ ] A plain EOA without gas or delegated EIP-7702 wallet, including a post-start buyer, signs the exact EIP-2612 domain/message, receives no ETH top-up, and the sponsor can
      relay only the signed amount through the pinned token to the fixed migration wallet.
- [ ] The normal top-up endpoint rejects delegated wallets; both paths share one total budget and a gasless root guard
      blocks a later native reservation.
- [ ] Wrong signer, token, spender, amount, nonce, deadline, destination, calldata, native top-up root eligibility or provider
      reference fails closed without a token transfer.
- [ ] Resume uses only the existing signed intent and exact account/amount/idempotency binding, even if its token balance is now lower.
- [ ] Resume after the window is receipt-only; expired unsent permits and replaced provider hashes never cause blind resubmission.
- [ ] Recovery is offered only after dual-RPC finalized expiry, unchanged permit nonce, zero sponsor allowance and
      absence of any stored/provider transfer submission. Ambiguous lookups and RPC disagreement block recovery.
- [ ] A new attempt requires explicit fresh wallet approval and is bound to the exact predecessor, holder, amount,
      release and sponsor. Preparation alone reserves nothing; submit rechecks the proof.
- [ ] Concurrent recovery requests append at most one successor. Older requests cannot overwrite or send for a newer
      attempt. Immutable original intents, aliases, completions and recovery history remain available.
- [ ] All attempt reservations still count against the shared native/gasless budget, the original faucet guard remains,
      and no holder exceeds three total signed attempts.
- [ ] Cancelling fresh approval or a browser-storage failure preserves the existing marker. A lost response resumes the
      exact successor without an automatic additional signature or another attempt.
- [ ] Shared budget exhaustion fails closed. Current-holder eligibility is not an unlimited or Sybil-resistant gas guarantee.

## Release evidence

- [ ] Focused sponsor unit/configuration tests, typecheck and `git diff --check` pass on the reviewed commit.
- [ ] Privy wallet/policy readback is captured privately without credentials.
- [ ] Candidate route readback, sponsor balance, durable-store readiness and independent RPC identity are captured at
      the activation time.
- [ ] The inactive public preview exposes no timer, address or transfer action. The timer, official address, wallet
      actions and sponsor become visible only after the activation manifest, server-time readback and sponsor readiness
      gates pass.
- [ ] Post-window disablement and Privy policy revocation have named owners.

If any item is false or unknown, leave the manifest or sponsor switch disabled.
