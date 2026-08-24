---
description: Current requirements and status for reusable public Programmable templates
---

# Public templates

A public template is one versioned product that other creators can configure for their own launches. It can include a hook, factory, application or companion service, but every required component and configurable boundary belongs to the same version target.

Public template intake and template fee share activation are not open. Templates are not part of the current Custom launch submission flow. The Custom Launch API accepts one concrete project and token bundle; it does not publish a reusable catalog entry.

## Template or project

The [Custom Launch API](https://programmable.market/developers/custom-launch-api-v1.md) is for one concrete project and token. A future template path would publish reusable behavior that other creators can select. A project that happens to contain reusable code is still a project unless an active template program separately versions and publishes it.

## Version binding

Each template version identifies the source repository, commit, artifacts, parameter bounds, deployment path and payout wallet. A change to behavior, dependencies, factory, fees, authority or allowed configuration creates a new version rather than inheriting the previous record.

## Published fee model

The intended public template policy is one 0.2% transaction fee on the supported trading route. The template creator receives 0.1% and Programmable receives 0.1%. This fee is not active until the exact version and payout route are activated. It is one complete fee, not a published rate followed by another unnamed Programmable charge.

Partnership templates use a separate policy and review path. They are not available through public intake.
