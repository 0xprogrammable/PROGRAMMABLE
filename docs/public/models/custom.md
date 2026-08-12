---
description: How reviewed Custom hook projects become exact, wallet bound Programmable releases
cover: ../.gitbook/assets/custom.webp
coverY: 0
---

# Custom hooks

Custom is the release path for products that need their own Uniswap v4 hook, application logic or execution graph. It is not one generic contract with a free form configuration. Each accepted project carries its own source identity, permissions, fee policy, dependency set and launch transaction requirements.

## Public review

The current public intake starts with the stable [Programmable v4 Builder](https://github.com/0xprogrammable/hookbuilder/releases/latest). The Builder prepares one exact application and submits it to [Submit a Launch](https://github.com/0xprogrammable/submit-launch), where the repository records the source revision and review evidence.

Submit a Launch intake is open. A draft application, green check or merged record does not by itself deploy a project or authorize a wallet transaction. The accepted revision still needs the matching execution profile and release binding before the named wallet can launch it.

## Release binding

A Custom release binds the repository identity, commit, tree, launch wallet, chain, contracts, permissions and transaction plan that were reviewed. If the source or a material configuration changes, it becomes a new review target rather than silently inheriting the previous result.

The creator sees the final network, destination, calldata and value before signing. Programmable prepares and verifies the route, while the creator wallet remains the only party that can submit the user transaction.

## Public provenance

The canonical Launch Stamp Router is live on Ethereum at `0x8622DD5bAb44185f2A458ac90384Ac99248f8d56`. A valid stamp binds the recorded launch to the Router execution, token, hook, PoolManager and pool. The public developer manifest provides the current runtime hash, ABI hash, start block and finality policy.

{% hint style="warning" %}
A launch stamp is provenance, not an audit or guarantee. It does not prove current liquidity, sellability, terminal support or economic outcome.
{% endhint %}

The public developer feed currently discovers both Classic and approved Custom records. General Custom execution remains revision specific, so users should follow the accepted release rather than assume that any repository or hook is launchable.
