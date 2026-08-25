---
description: Prepare one deterministic Custom project through the authenticated API and creator signed launch
---

# Launch a project

Custom launch preparation is API-first. The submitting workflow packages one deterministic source and graph bundle, and the authenticated API validates its declared commitments. A `prepared` result contains no wallet transaction. After the request becomes `authorized`, the controller wallet separately reviews, signs and broadcasts the exact transaction. No GitHub pull request submits the launch.

## Prepare the source

Keep the contracts, tests, deployment logic and material project information needed to understand the release in one reproducible source bundle. Derive the exact API request with the versioned public `programmable-launch` CLI and validate it against the published schema.

The source descriptor, manifest digest, graph bundle and agent evidence must all identify the same exact launch subject. Run the checks that apply to the project and keep their underlying evidence. V1 requires check IDs and evidence digests but does not publish a universal check catalog or assess the evidence.

## Create an API key

Connect the controller wallet at [Custom Launch API keys](https://programmable.market/developers/api-keys) and create a scoped key. Store it only as `PROGRAMMABLE_API_KEY` in an encrypted environment or secret store. Put only `$PROGRAMMABLE_API_KEY` in source, chat, prompts and agent setup.

The key grants only `custom-launch:create` and `custom-launch:read`. It is not a wallet key and cannot sign or broadcast a transaction.

## Submit the bundle

Send one closed request to `https://api.programmable.market/v1/custom-launches` with the API key as a Bearer credential and a stable idempotency key. Follow the [Custom Launch API guide](../developers/custom-launch.md) for authentication, the exact schema, graph limits, evidence fields and response states.

The platform validates the manifest digest, graph constraints, attestation shape, evidence digests, optional exact-source build inputs and permit binding. Post-finality provider verification is independent from launch finality. Programmable does not reproduce project tests, audit the project or adopt the agent's claims as a safety conclusion.

## Launch from the bound wallet

When the request is `prepared`, only the exact artifact exists. Wait for `authorized`, then have the controller wallet check the network, destination, calldata and value before it signs and broadcasts. A submitted transaction becomes a completed launch only after it succeeds, reaches the required finality and agrees with the public Router record.

## Keep the record useful

After launch, share the contract address rather than only a name or ticker. Material source changes, permission changes or a new deployed version create a new launch subject. An earlier prepared bundle does not silently cover new bytes.
