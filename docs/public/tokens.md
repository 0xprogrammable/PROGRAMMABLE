---
description: Compare Classic and Custom, and understand how a Uniswap v4 hook changes a pool
---

# Launch models

Programmable separates a direct standard model from individually reviewed Custom releases. Choose the model by the behavior the product needs, not by how unusual its name or branding is.

| Model   | What it creates                                                            | Trading pair                                  | Access                                |
| ------- | -------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------- |
| Classic | Fixed supply tokens with configurable buy and sell transaction fees        | ETH on Uniswap v4                             | Open through Create                   |
| Custom  | Tokens or applications that need an individually reviewed hook and release | The pool and route named in the exact release | Accepted and activated revisions only |

## What is a hook

A hook is a smart contract attached to a Uniswap v4 pool. The pool calls it at defined points in a transaction, such as before or after a swap. This lets a product apply behavior at the pool level instead of relying only on a website or a separate trading interface.

The hook's permissions define when it can run, while its code defines what it actually does. A hook can change fees, accounting, access or other pool behavior, but the word hook does not by itself establish safety, compatibility or launch approval.

## Classic

Classic creates a fixed supply of one billion tokens and initializes its ETH pool in one transaction signed by the creator. The full supply enters a permanently locked one sided Uniswap v4 position. Before signing, the creator chooses the buy transaction fee, sell transaction fee, reward destination and Initial Buy custody.

{% content-ref url="models/classic.md" %}
[classic.md](models/classic.md)
{% endcontent-ref %}

## Custom

Custom releases are for products whose behavior cannot be represented by the Classic settings. A hook is code that can change how a Uniswap v4 pool behaves during a transaction. Each Custom release identifies the exact source, permissions, transaction fees, dependencies, transaction construction and the wallet allowed to launch it. Public review intake is open through Submit a Launch, while execution remains bound to the accepted release rather than to a project name.

{% content-ref url="models/custom.md" %}
[custom.md](models/custom.md)
{% endcontent-ref %}
