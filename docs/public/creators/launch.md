---
description: Move one exact public project from the Programmable v4 Builder through review and creator signed launch
---

# Launch a project

Custom projects use a public, exact revision workflow. The project stays in its creator owned repository, while the Builder prepares a small application that identifies the source, evidence, requested route and launch wallet without copying the whole codebase into the review repository.

## Prepare the source

Start from a public GitHub repository that contains the code, tests, deployment logic and material project information needed to understand the release. Use the latest stable [Programmable v4 Builder release](https://github.com/0xprogrammable/hookbuilder/releases/latest), currently `v0.4.3`, rather than the moving development branch.

The Builder preserves the product intent, chooses the smallest complete architecture and runs the checks that apply to that project. It freezes the repository id, commit and tree used by the application so a later commit cannot be mistaken for the reviewed revision.

## Submit the application

[Submit a Launch](https://github.com/0xprogrammable/submit-launch) accepts public applications. The Builder creates the required six file draft application and checks the repository state before every GitHub write. Do not hand write the package or treat the pull request as launch approval.

Review evaluates the named revision and evidence. Missing evidence remains pending rather than being turned into an unsupported safety conclusion. A complete reproducible failure can block the exact revision, while a scanner label or model opinion cannot replace the published review policy.

## Launch from the bound wallet

An accepted revision still needs an active release binding. When that binding exists, the named wallet opens the launch experience, checks the network, transaction destination, calldata and value, then signs the transaction itself. A submitted transaction becomes a completed launch only after it succeeds, reaches the required finality and agrees with the public launch record.

## Keep the record useful

After launch, share the contract address rather than only a name or ticker. Material source changes, permission changes or a new deployed version should be disclosed as a new review target. An old accepted revision does not silently cover new bytes.
