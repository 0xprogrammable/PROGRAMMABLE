---
description: Prepare one deterministic Custom project through the authenticated API and creator signed launch
---

# Launch a project

Custom launch preparation is API-first. The Builder packages one deterministic source and graph bundle, the authenticated API validates its declared commitments, and the controller wallet separately reviews and signs the prepared transaction. No GitHub pull request submits the launch.

## Prepare the source

Keep the contracts, tests, deployment logic and material project information needed to understand the release in one reproducible source bundle. Use the latest stable [Programmable v4 Builder release](https://github.com/0xprogrammable/hookbuilder/releases/latest) rather than the moving development branch.

The Builder preserves the product intent, chooses the smallest complete architecture and runs the checks that apply to that project. The source descriptor, manifest digest, graph bundle and agent evidence must all identify the same exact launch subject.

## Create an API key

Connect the controller wallet at [Custom Launch API keys](https://programmable.market/developers/api-keys) and create a scoped key. Give the secret only to the agent or workflow that should prepare launches for that wallet. Keep it out of source control and public chats.

The key grants only `custom-launch:create` and `custom-launch:read`. It is not a wallet key and cannot sign or broadcast a transaction.

## Submit the bundle

Send one closed request to `https://api.programmable.market/v1/custom-launches` with the API key as a Bearer credential and a stable idempotency key. Follow the [Custom Launch API V1 guide](https://programmable.market/developers/custom-launch-api-v1.md) for the exact schema, graph limits, evidence fields and response states.

The platform validates the manifest digest, graph constraints, required agent evidence and permit binding. It does not compile the source, reproduce the build, audit the project or adopt the agent's claims as a safety conclusion.

## Launch from the bound wallet

When the request is prepared, the controller wallet checks the network, transaction destination, calldata and value, then signs the transaction itself. A submitted transaction becomes a completed launch only after it succeeds, reaches the required finality and agrees with the public Router record.

## Keep the record useful

After launch, share the contract address rather than only a name or ticker. Material source changes, permission changes or a new deployed version create a new launch subject. An earlier prepared bundle does not silently cover new bytes.
