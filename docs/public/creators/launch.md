---
description: Package one deterministic Custom project locally and understand the held public launch path
---

# Launch a project

Public Custom launch creation is currently held. V1 list and single-resource reads remain live for existing requests, while authenticated V1 POST returns non-retryable `409 CUSTOM_LAUNCH_V1_READ_ONLY`. The fee-enforced V2 release candidate returns `503 CUSTOM_LAUNCH_V2_UNAVAILABLE` with `Retry-After` until canary and explicit public activation. Legacy Registry and GitHub submission intake is closed.

## Prepare the source

Keep the contracts, tests, deployment logic and material project information needed to understand the release in one reproducible source bundle. Derive the exact API request with the versioned public `programmable-launch` CLI and validate it against the published schema.

The source descriptor, manifest digest, graph bundle and agent evidence must all identify the same exact launch subject. Run the checks that apply to the project and keep their underlying evidence. V1 requires check IDs and evidence digests but does not publish a universal check catalog or assess the evidence.

## Create an API key

Connect the controller wallet at [Custom Launch API keys](https://programmable.market/developers/api-keys) and create a scoped key. Store it only as `PROGRAMMABLE_API_KEY` in an encrypted environment or secret store. Put only `$PROGRAMMABLE_API_KEY` in source, chat, prompts and agent setup.

Existing keys can use `custom-launch:read` for their wallet-owned V1 history. A legacy `custom-launch:create` scope does not override the write fence. The key is not a wallet key and cannot sign or broadcast a transaction.

## Stop at the public write fence

Do not submit the bundle to V1. Authenticated `POST https://api.programmable.market/v1/custom-launches` returns `409 CUSTOM_LAUNCH_V1_READ_ONLY`; do not retry, rotate the nonce or change bytes to bypass it. V2 is not a public API contract until its canary and activation evidence are explicitly published. Follow the [Custom Launch API guide](../developers/custom-launch.md) for the current read and write-fence contract.

Existing durable resources record the platform's manifest, graph, attestation, exact-source and permit checks. Post-finality provider verification is independent from launch finality. Programmable does not reproduce project tests, audit the project or adopt the agent's claims as a safety conclusion.

## Launch from the bound wallet

For an existing request, `prepared` means only the exact artifact exists. An already `authorized` resource still requires the controller wallet to check the network, destination, calldata and value before signing and broadcasting. A submitted transaction becomes a completed launch only after it succeeds, reaches the required finality and agrees with the public Router record.

## Keep the record useful

After launch, share the contract address rather than only a name or ticker. Material source changes, permission changes or a new deployed version create a new launch subject. An earlier prepared bundle does not silently cover new bytes.
