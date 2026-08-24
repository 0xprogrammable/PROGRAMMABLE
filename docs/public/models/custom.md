---
description: How deterministic Custom hook bundles become exact, wallet bound Programmable releases
cover: ../.gitbook/assets/custom-v2.png
coverY: 0
---

# Custom hooks

Custom is the release path for products that need their own Uniswap v4 hook, application logic or execution graph. It is not one generic contract with a free form configuration. Each request carries its own source identity, permissions, fee policy, dependency set and launch transaction requirements.

A hook is a smart contract that a Uniswap v4 pool calls at defined points in a transaction. It can apply product specific behavior directly around swaps and other pool actions. What it can do depends on its declared permissions and exact code, which is why each Custom request is bound to one exact bundle rather than to a project name.

## API-first preparation

Start with the stable [Programmable v4 Builder](https://github.com/0xprogrammable/hookbuilder/releases/latest). The Builder prepares one deterministic source and graph bundle with the required agent evidence. The controller wallet creates a [wallet-bound API key](https://programmable.market/developers/api-keys), and the agent submits the bundle to `https://api.programmable.market/v1/custom-launches`.

The API checks the declared bundle commitments and prepares the exact wallet action. It does not compile the project, reproduce its tests, audit it, sign the transaction or broadcast it. The API key is not wallet authority; the controller wallet must review and confirm the prepared action.

## Release binding

A Custom release binds the source descriptor, manifest digest, graph bundle, launch wallet, chain, contracts, permissions and transaction plan used for that request. If the source or a material configuration changes, it becomes a new launch subject rather than silently inheriting the previous result.

The creator sees the final network, destination, calldata and value before signing. Programmable prepares and verifies the route, while the creator wallet remains the only party that can submit the user transaction.

## Public provenance

The canonical Launch Stamp Router is live on Ethereum at `0x8622DD5bAb44185f2A458ac90384Ac99248f8d56`. A valid stamp binds the recorded launch to the Router execution, token, hook, PoolManager and pool. The public developer manifest provides the current runtime hash, ABI hash, start block and finality policy.

{% hint style="warning" %}
A launch stamp is provenance, not an audit or guarantee. It does not prove current liquidity, sellability, terminal support or economic outcome.
{% endhint %}

The public developer feed discovers Classic records and verified Custom records. Custom execution remains bundle specific, so users should follow the exact prepared action rather than assume that any repository or hook is launchable.
