---
description: Transaction fees, creator rewards and Programmable revenue
---

# Fees and revenue

Costs and fee paths depend on the transaction that actually executes. A launch model alone does not determine them. Each release must state the complete rate, how it is divided and which transactions pay it.

| Path               | Share                                                    | How it works                                                     |
| ------------------ | -------------------------------------------------------- | ---------------------------------------------------------------- |
| Classic            | 0.1% of the gross ETH amount exchanged                   | Included in the selected buy or sell transaction fee             |
| Standard Custom    | 0.1% of the gross amount exchanged on the supported route | Defined by the exact release used by the graph                   |
| Prediction Markets | Defined by the active protocol release                   | Current rates, recipients and creator rewards live in its source |
| Public template    | Intended 0.1% share inside a 0.2% total transaction fee  | Not active while public template intake remains closed           |

In these docs, transaction fee means the percentage charged when a token is bought or sold. It is separate from network gas and from the Uniswap pool fee. The active contract and release determine the exact rate and recipient.

## Classic rewards

Classic creators select buy and sell transaction fees from 1% through 10%. Programmable receives 0.1% of the gross ETH amount exchanged. That share is already included in the selected rate, while the remainder accrues as creator rewards. An ordinary wallet transfer does not pay this transaction fee.

## Custom releases

Custom fees are specific to each release. The published standard production policy assigns 0.1% of the gross amount exchanged on the verified supported market path to Programmable. A release without a qualifying market has no fee legs. Every other Custom fee mode fails closed.

## Prediction Markets

Prediction Markets economics are separately versioned. Use the [canonical Prediction Markets repository](https://github.com/0xprogrammable/programmable-prediction-markets) for current activation costs, trading and pool fees, fee recipients, creator rewards and the treatment of protocol or liquidity-provider fees. Do not infer those terms from Classic or an older Prediction Markets release.

## Protocol revenue

The public allocation policy assigns 80% of attributable net Programmable protocol revenue to V4 purchases and 20% to the treasury. Attributable net revenue means the amount that belongs to Programmable after creator and partner liabilities are separated.

{% hint style="warning" %}
The policy and an executed revenue cycle are different facts. The current V2 processor documented in the product source uses a 49.5% V4 purchase share, a 50% treasury share and a 0.5% keeper share until an exact activation record binds the 80/20 processor. These docs do not present the newer split as executed before that evidence exists.
{% endhint %}

Revenue processing applies only to supported sources and can wait for finality, provider agreement, minimum balances and safety checks. A policy does not promise a transaction at the same clock time every day, token value or holder yield.
