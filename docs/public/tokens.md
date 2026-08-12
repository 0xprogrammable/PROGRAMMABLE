---
description: Compare the current Programmable launch models and understand which path fits a token
---

# Tokens and launch models

Programmable separates the standard token path from project specific hook releases. This keeps the creator experience simple without pretending that every unusual hook can be launched under the same assumptions.

| Model        | Current use                                                                         | Market                          | Access                                         |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------- |
| Classic      | Fixed supply tokens with configurable buy and sell fees                             | ETH on Uniswap v4               | Open through Create                            |
| Custom hooks | Projects whose behavior depends on an individually reviewed hook or execution graph | Defined by the accepted release | Available for accepted and activated revisions |
| Stock Paired | Historical launches paired with allowlisted stock tokens                            | Historical Uniswap v4 markets   | Closed to new launches                         |

## Classic

Classic creates a one billion token fixed supply and initializes its ETH market in one creator signed transaction. The full supply enters a permanently locked one sided Uniswap v4 position, and the creator chooses the buy fee, sell fee, reward destination and Initial Buy custody before signing.

{% content-ref url="models/classic.md" %}
[classic.md](models/classic.md)
{% endcontent-ref %}

## Custom hooks

Custom releases are for products whose behavior cannot be represented by the Classic configuration. Each release identifies exact source, permissions, fee behavior, dependencies, transaction construction and the wallet allowed to launch it. Public review intake is open through Submit a Launch, while execution remains bound to the accepted release rather than to a project name.

{% content-ref url="models/custom.md" %}
[custom.md](models/custom.md)
{% endcontent-ref %}

## Historical models

Stock Paired launches remain part of the public record, but new launches are closed. Their documentation is retained so existing tokens can still be understood without presenting the model as a current creation path.
