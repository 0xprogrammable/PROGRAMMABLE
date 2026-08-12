---
description: Programmable fee paths, creator rewards and protocol revenue boundaries
---

# Economics

Programmable fees are defined by the market path that actually executes. A category name alone is not enough to infer a fee, and a planned template policy should not be displayed as though it already applies to a live pool.

| Path            | Programmable share                             | Treatment                                              |
| --------------- | ---------------------------------------------- | ------------------------------------------------------ |
| Classic         | 10 bps of gross native swap amount             | Included in the selected buy or sell fee               |
| Standard Custom | 10 bps on a verified official market path      | Added according to the accepted release                |
| Public template | Intended 10 bps inside one 20 bps template fee | Not active while public template intake remains closed |

One basis point is 0.01%, so 10 basis points are 0.10%. The active release, contract and market path determine the basis and recipient.

## Classic rewards

Classic creators select buy and sell fees from 1% through 10%. The 0.10% Programmable share is part of the selected rate, while the remainder accrues as creator rewards. Normal token transfers do not pay the hook fee.

## Custom releases

Custom economics are release specific. Standard Native Custom paths use a 10 basis point Programmable policy, while a named partner release can define a different total and split. The accepted release must disclose the complete fee rather than presenting only one recipient's share.

## Protocol revenue

The public allocation policy assigns 80% of attributable net Programmable protocol revenue to V4 purchases and 20% to the treasury. Attributable net revenue means the amount that belongs to Programmable after creator and partner liabilities are separated.

{% hint style="warning" %}
The policy and an executed revenue cycle are different facts. The current V2 processor documented in the product source uses a 49.5% V4 purchase share, a 50% treasury share and a 0.5% keeper share until an exact activation record binds the 80/20 processor. These docs do not present the newer split as executed before that evidence exists.
{% endhint %}

Revenue processing applies only to supported sources and can wait for finality, provider agreement, minimum balances and safety checks. A policy does not promise a transaction at the same clock time every day, token value or holder yield.
