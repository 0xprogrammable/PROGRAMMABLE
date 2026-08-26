---
description: How deterministic Custom hook bundles become exact, wallet bound Programmable releases
cover: ../.gitbook/assets/custom-v2.png
coverY: 0
---

# Custom hooks

Custom is the release path for products that need their own Uniswap v4 hook, application logic or execution graph. It is not one generic contract with a free form configuration. Each request carries its own source identity, permissions, fee policy, dependency set and launch transaction requirements.

A hook is a smart contract that a Uniswap v4 pool calls at defined points in a transaction. It can apply product specific behavior directly around swaps and other pool actions. What it can do depends on its declared permissions and exact code, which is why each Custom request is bound to one exact bundle rather than to a project name.

## Local packaging and API availability

Build and test the exact project. The public `programmable-launch` 3.3.0 CLI derives the deterministic source manifest,
graph bundle, CREATE2 locators, evidence digests and exact-source verification bundle against the [Custom Launch API
schema](../developers/custom-launch.md). The default `programmable.direct-native-hook-graph-profile.v3` profile uses
`profileRevision: 3`, `profileVersion: 3.1.0` and exact `solc 0.8.26+commit.8a97fa7a`; exact `3.0.0` requests remain
readable and byte-identical retryable, and revision 2 remains compatible.
Run `pack`, `validate`, `submit` and `status` for the byte-identical public V3 request. Stop for every explicit wallet
handoff. The API key and CLI never sign or broadcast.

Profile 3.1.0 applies role-aware exact-source static admission. Exactly seven objective rules hard-block deployment;
proxy/delegatecall, mint/tax/pause, liquidity and return-delta surfaces require evidence instead of categorical
rejection. A hard-block code-and-role match moves the request to `action_required`; other findings remain visible. A final
Router simulation is mandatory before authorization. If action is required, keep the request ID and contact support
without sending the API key.

Existing durable resources record the API's declared bundle checks. `prepared` means the exact artifact exists while the
signed permit and wallet transaction remain null. An already `authorized` resource supplies the permit-attached
transaction for separate controller-wallet review. Exact-source provider status begins only after finality and never
revises it. Static admission and simulation are not an audit or a guarantee of safety, honeypot resistance, liquidity,
tradeability or fee behavior. The API does not sign or broadcast, and the API key is not wallet authority.

## Release binding

A Custom release binds the source descriptor, manifest digest, graph bundle, launch wallet, chain, contracts, permissions and transaction plan used for that request. If the source or a material configuration changes, it becomes a new launch subject rather than silently inheriting the previous result.

The creator sees the final network, destination, calldata and value before signing. Programmable prepares and verifies the route, while the creator wallet remains the only party that can submit the user transaction.

Initializing a normal Uniswap v4 pool does not add liquidity. Ordinary concentrated liquidity requires a project-funded position. Zero classical LP is possible only when the exact project hook and initializer implement custom accounting or hold launch inventory; volume cannot create initial liquidity from nothing.

## Public provenance

The canonical Launch Stamp Router is live on Ethereum at `0x8622DD5bAb44185f2A458ac90384Ac99248f8d56`. A valid stamp binds the recorded launch to the Router execution, token, hook, PoolManager and pool. The public developer manifest provides the current runtime hash, ABI hash, start block and finality policy.

{% hint style="warning" %}
A launch stamp is provenance, not an audit or guarantee. It does not prove current liquidity, sellability, terminal support or economic outcome.
{% endhint %}

The public developer feed discovers Classic records and verified Custom records. Custom execution remains bundle specific, so users should inspect the exact authorized transaction rather than assume that any repository or hook is launchable.
