# Main Token Migration Gas Sponsor V1 Readiness

This checklist is an activation gate, not an activation record. The committed migration manifest is currently
disabled. Replace no placeholders in the repository; operational values belong only in the deployment secret manager
and private release evidence.

## Candidate identity

- [ ] The candidate is an immutable build from the exact reviewed `production` commit.
- [ ] `config/main-token-migration-activation.v1.json` binds the reviewed release and has a 345,600-second window,
      exact finalized pre-window eligibility block number and hash.
- [ ] The sponsor contract matches
      `config/main-token-migration-gas-sponsor-contract.v1.json` byte-for-byte in the candidate.

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
- [ ] The policy permits only Ethereum Mainnet `eth_sendTransaction` native transfers, caps value at or below the
      configured maximum top-up, and defaults to deny for unrelated wallet methods.
- [ ] Server tests and the reviewed candidate independently bind the exact linked holder recipient, empty calldata,
      sender, type-2 fee/gas limits and exact calculated value; these fields are not attributed to the Privy policy.
- [ ] The sponsor address differs from both the V4 token and migration recipient addresses and has empty runtime code.

## Focused behavior

- [ ] Disabled manifest or disabled environment switch returns a fail-closed unavailable response and spends nothing.
- [ ] An authenticated linked EOA that held the requested V4 amount at the eligibility block can receive only its bounded
      current gas deficit.
- [ ] Unlinked wallets, smart-contract wallets, insufficient eligibility/current token balances, wrong eligibility block,
      RPC disagreement, quotes above 20 gwei, exhausted budget and the final five minutes all fail closed.
- [ ] Concurrent duplicate requests reserve and broadcast no more than one transfer.
- [ ] An ambiguous Privy response is recorded as unknown and is not rebroadcast.
- [ ] Dual-RPC readback confirms the exact transaction fields and successful receipt before status becomes confirmed.

## Release evidence

- [ ] Focused sponsor unit/configuration tests, typecheck and `git diff --check` pass on the reviewed commit.
- [ ] Privy wallet/policy readback is captured privately without credentials.
- [ ] Candidate route readback, sponsor balance, durable-store readiness and independent RPC identity are captured at
      the activation time.
- [ ] Public page visibility is enabled only after the activation manifest, server-time readback and sponsor readiness
      gates pass.
- [ ] Post-window disablement and Privy policy revocation have named owners.

If any item is false or unknown, leave the manifest or sponsor switch disabled.
