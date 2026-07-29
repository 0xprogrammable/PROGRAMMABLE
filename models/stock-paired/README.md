# Stock-Paired

**Status:** Candidate<br>
**Deployment:** Ethereum Mainnet<br>
**Availability:** Not available for public launch

Stock-Paired creates a new fixed-supply token and pairs it with one reviewed Ondo tokenized stock or ETF asset in a
Uniswap v4 pool. The complete launch position is placed in permanent custody.

The token created by Programmable is not a share, is not redeemable for the selected quote asset and carries no rights
in the underlying company, fund or security. The tokenized quote asset remains subject to its issuer's terms and
controls.

[Model manifest](model.json) ·
[Security properties](../../docs/security/STOCK_PAIRED_PROPERTIES.md) ·
[Immutable candidate source](https://github.com/0xprogrammable/programmable/tree/cdd102bed3d7556ab276ad381f54cbf6de8b2eab/contracts)

## Fixed behavior

- Supply is fixed at 1,000,000,000 tokens.
- The launch pool uses one approved quote asset and the Stock-Paired v4 hook.
- The total swap fee is 1.00% of the quote-asset side.
- Creator rewards receive 0.90%; Programmable receives 0.10%.
- Creator rewards may be split across up to eight immutable beneficiaries.
- Rewards accrue in the quote asset. Converting a claim to ETH is a separate routed transaction.
- The launch token has no transfer tax. The v4 pool's LP fee is zero.
- The one-sided launch position cannot be removed, transferred or approved by a configured operator.
- The ETH coordinator converts the initial ETH through pinned Uniswap v3 routes before calling the launcher.

## Reviewed quote assets

The current candidate fixes eleven quote assets:

| Asset | Token |
| --- | --- |
| NVIDIA | `NVDAon` |
| S&P 500 | `SPYon` |
| Alphabet | `GOOGLon` |
| Silver | `SLVon` |
| Tesla | `TSLAon` |
| Apple | `AAPLon` |
| Alibaba | `BABAon` |
| Copper Miners | `COPXon` |
| Circle | `CRCLon` |
| 20+ Year Treasuries | `TLTon` |
| Oil | `USOon` |

Admission checks pin the issuer manager, token runtime, implementation runtime, route pool and minimum round-trip
result on two Ethereum RPCs at the review block. These checks do not guarantee future liquidity or execution.

`GMEon` and `RDDTon` were excluded because no reviewed ETH route was available. `SPCXon` was excluded because its
reviewed route did not satisfy the candidate's 90% round-trip floor.

[Open the pinned asset and route configuration](https://github.com/0xprogrammable/programmable/blob/cdd102bed3d7556ab276ad381f54cbf6de8b2eab/config/stock-paired-assets.v2.json)

## Mainnet evidence

The candidate lifecycle was exercised against the deployed contracts on two independent Mainnet RPCs:

- ETH-first launch through the reviewed Silver route;
- fixed-supply token and v4 pool creation;
- permanent position custody;
- buy and sell execution;
- creator claim in the quote asset; and
- Programmable claim in the quote asset.

[Launch transaction](https://etherscan.io/tx/0xc45d348083c53afaf79f056f1ea5529e9410ac3faa954a5c8ef7272a6371ec83) ·
[Canary token](https://etherscan.io/address/0x369f5fa21942560c42Ba9FDb8a156F5C962BD2eC) ·
[Pinned deployment evidence](https://github.com/0xprogrammable/programmable/blob/cdd102bed3d7556ab276ad381f54cbf6de8b2eab/contracts/deployments/mainnet-stock-paired-v2.json)

## Verification state

Checked on 30 July 2026:

| Contract | Address | Etherscan |
| --- | --- | --- |
| Quote registry | [`0xd38F…9239`](https://etherscan.io/address/0xd38Fbc171C1a842dc3F6d10cf5642BAe097D9239#code) | Exact Match |
| Position planner | [`0x9372…4A3D`](https://etherscan.io/address/0x93728dF8288fC250294855F6D9dd28F8089E4A3D#code) | Similar Match |
| Reward-vault factory | [`0x52d7…52d4`](https://etherscan.io/address/0x52d70971D6653a754c29385a2a6f241A481952d4#code) | Similar Match |
| Hook factory | [`0x5C27…fBcB`](https://etherscan.io/address/0x5C2704C6eEaA2063d7a969BA7E557c87AEb1fBcB#code) | Similar Match |
| Fee hook | [`0x90c6…A0cc`](https://etherscan.io/address/0x90c67C1E866f86526F0e338459cD435E1F23A0cc#code) | Similar Match |
| Launcher | [`0x5eA6…0Daf`](https://etherscan.io/address/0x5eA6Be24838061bA45dbE8D82DE1b267DC240Daf#code) | Similar Match |
| ETH coordinator | [`0xFb9E…0fD2`](https://etherscan.io/address/0xFb9E1034df6161088E8F358502B19E7515c30fD2#code) | Similar Match |

Sourcify reports source matches for all seven contracts. An Uniswap routing review was submitted on 29 July 2026 and
is pending. The contracts have not received an independent audit or public security contest.

## Remaining gates

Stock-Paired stays unavailable in the public interface until:

1. all seven contracts have an Etherscan Exact Match;
2. the version-bound specification, release manifest and deployment record are on the default branch;
3. the Uniswap routing review and route checks are complete; and
4. the exact release passes a production launch, trade and claim smoke test.
