---
description: Compare the current Programmable launch models and understand which path fits a token
---

# Tokens and launch models

Programmable separates the standard token path from individually reviewed Custom releases. This keeps the creator experience clear without treating every hook as though it has the same requirements.

| Model   | What it creates                                                            | Trading pair                                  | Access                                         |
| ------- | -------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| Classic | Fixed supply tokens with configurable buy and sell transaction fees        | ETH on Uniswap v4                             | Open through Create                            |
| Custom  | Tokens or applications that need an individually reviewed hook and release | The pool and route named in the exact release | Available for accepted and activated revisions |

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
