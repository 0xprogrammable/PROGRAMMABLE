---
description: Package, submit and track one deterministic Custom project
---

# Launch a project

Public V3 general-hook creation and lifecycle reads are live on Ethereum Mainnet. V2 and V1 history remain readable, while authenticated V1 POST remains nonretryable `409 CUSTOM_LAUNCH_V1_READ_ONLY`. Legacy Registry and GitHub submission intake is closed.

## Prepare the source

Keep the contracts, tests, deployment logic and material project information needed to understand the release in one reproducible source bundle. Derive the exact API request with the versioned public `programmable-launch` CLI and validate it against the published schema.

The 3.0.0 package includes the executable `examples/direct-native-v3-no-broadcast/README.md` rev2 clean-room project. It compiles real project-owned token, hook and initializer targets, then runs deterministic `pack` and `validate` without submitting, signing, broadcasting or creating a Mainnet coin.

The source descriptor, manifest digest, graph bundle and agent evidence must all identify the same exact launch subject. Run the checks that apply to the project and keep their underlying evidence. The API requires check IDs and evidence digests but does not publish a universal check catalog or assess the evidence.

## Choose the liquidity design explicitly

Initializing a normal Uniswap v4 pool creates the pool but does not add liquidity. A project using ordinary concentrated liquidity must fund and create its own position; trading volume cannot create that initial liquidity from nothing. Custody, withdrawal and any lock belong to the project's exact graph and must be disclosed.

A zero-classical-LP launch is possible only when the project hook and initializer implement custom accounting or hold launch inventory that can exchange against incoming assets. In that design, buys can increase the assets held by the hook over time, but the initial token inventory and accounting path still come from the project. Selecting `fundingMode: none` does not turn an empty ordinary pool into a liquid market.

## Create an API key

Connect the controller wallet at [Custom Launch API keys](https://programmable.market/developers/api-keys) and create a scoped key. Store it only as `PROGRAMMABLE_API_KEY` in an encrypted environment or secret store. Put only `$PROGRAMMABLE_API_KEY` in source, chat, prompts and agent setup.

The key is bound to its controller wallet and API scopes. It is not a wallet key and cannot sign or broadcast a transaction.

## Submit the V3 request

Run `programmable-launch pack`, `validate`, `submit` and then `status`. Submit the bundle to `POST https://api.programmable.market/v3/custom-launches` with the CLI. Preserve the exact request bytes and idempotency key across timeout, `429` and `503` retries and honor `Retry-After`. Follow the [Custom Launch API guide](../developers/custom-launch.md) for the exact public contract.

Existing durable resources record the platform's manifest, graph, attestation, exact-source and permit checks. Post-finality provider verification is independent from launch finality. Programmable does not reproduce project tests, audit the project or adopt the agent's claims as a safety conclusion.

## Launch from the bound wallet

For an existing request, `pending_review` means platform conformance is still being evaluated. `action_required` means a deterministic indicator needs additional platform review; it is not a wallet-signing stage. Read the exact report and contact support with the request ID when directed. In EIP-3009 mode, `awaiting_funding_authorization` requires one explicit typed-data signature in the website; native-value and no-funding modes skip that separate signature. `prepared` means only the exact artifact exists. An `authorized` resource still requires the controller wallet to check the network, destination, calldata and value before signing and broadcasting the Router transaction. A submitted transaction becomes a completed launch only after it succeeds, reaches the required finality and agrees with the public Router record.

The mandatory 10 bps Programmable share may be additive to the project's selected fee or included in that selected total. The exact accounting basis, currency, claim binding and buy/sell economics are request-bound and server-recomputed. The Uniswap pool LP fee is separate. Generic fee claiming and buyback management for arbitrary hooks are not live; FADE has a specifically bound adapter only.

## Keep the record useful

After launch, share the contract address rather than only a name or ticker. Material source changes, permission changes or a new deployed version create a new launch subject. An earlier prepared bundle does not silently cover new bytes.
