# Stock-Paired V3 price policy

Stock-Paired V3 targets the same initial fully diluted value as Classic:

```text
1.355657760817103798 ETH
```

The public model name remains `Stock-Paired`. `V3` identifies the internal immutable contract release.

## Method

The calibration snapshot is Ethereum block `25,642,460`:

```text
block hash  0xefb6c45e3523ffc588d4c498cd6fd5ab528371f293eebc70375857a53fe12718
timestamp   1785375887
UTC         2026-07-30T01:44:47Z
```

Prices come from the marginal `slot0` midprice of the reviewed Uniswap v3 WETH/USDC and USDC/quote pools at that block. They do not come from an amount-sized route quote. A quote for the full target FDV would include severe price impact in the thinner stock pools and is not a valid price anchor.

All launched tokens and accepted quote assets use 18 decimals. For an absolute launch tick `t`:

```text
quote per launched token = 1.0001 ^ -t
quote FDV                = 1,000,000,000 * 1.0001 ^ -t
```

The signed pool tick is `+t` when the quote asset is `currency0` and `-t` when it is `currency1`. Each absolute tick is rounded to the nearest multiple of the fixed tick spacing, `200`.

## Pinned inputs

WETH/USDC:

```text
pool          0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640
sqrtPriceX96  1811374274676982379548779438342942
tick          200755
midprice      1,913.1224865707945 USDC per WETH
```

| Quote | Pool | Pool sqrtPriceX96 | Pool tick | Target quote FDV raw | Absolute launch tick | Tick-implied quote FDV raw | Drift from Classic |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| NVDAon | `0xf5294094BCe435bFbd0eC488be5C462aAF32Bc7A` | 1097232669160320469452120 | -223758 | 13522423984475316997 | 181200 | 13520023064276052820 | -1.78 bps |
| SPYon | `0x5638bbDE046EC2EFC7C8f3fd8DC5A9A1016f7EEB` | 2916328541485761273243512415623187 | 210280 | 3514038942016415531 | 194600 | 3540396661305328988 | +75.01 bps |
| GOOGLon | `0x39FCB1935f6Ccb0A106D05eB928205C59646af57` | 4333169358298493129367655695972817 | 218200 | 7757914703760533694 | 186800 | 7722975943643816421 | -45.04 bps |
| SLVon | `0xEeb8F880EAd7281A301ef2E6791A6bBe790603eD` | 10945964930190207783395284454387554 | 236734 | 49504169414249928797 | 168200 | 49605751312209836038 | +20.52 bps |
| TSLAon | `0x31227b50eCCDC9C589826AA2D9E7C5619B1895Da` | 4606653194514317023717169536081316 | 219424 | 8768084165474772643 | 185600 | 8707578819134800530 | -69.01 bps |
| AAPLon | `0xad82C9EB065a5CFed71DB087e4a52C8a09c69921` | 1463596069436387980672637 | -217995 | 7599929078251473378 | 187000 | 7570058343489581718 | -39.30 bps |

The selected ticks keep the initial ETH-denominated FDV within 100 basis points of Classic at the calibration snapshot.

## Independent checks

The pinned pool midprices were reproduced through two independent Ethereum RPC providers. Small `0.0001 ETH` and `0.0006 ETH` route quotes produced prices consistent with the pool midprices after the configured 0.05% and 0.30% or 1.00% route fees.

The six quote midprices were also compared with contemporaneous underlying US-market reference prices. The largest difference was 1.20%. This is a calibration check, not an onchain oracle.

Four of the six reviewed stock pools had an observation cardinality of one at the snapshot block. A universal stock-pool TWAP was therefore unavailable. V3 uses a pinned immutable policy instead of trusting a manipulable launch-time spot price.

## Fail-closed scope

V3 accepts exactly these six quote assets and ticks. QQQon and all other assets have no price configuration and must revert before token creation, pool registration, or asset transfer.

Existing V1 and V2 pools remain historical and tradable. Their contracts and price policies are unchanged.

## Drift

The fixed quote FDV is deterministic. Its future ETH and USD value is not:

```text
future ETH FDV / calibrated ETH FDV
    = future quote-asset/ETH price ratio
      / calibrated quote-asset/ETH price ratio
```

A 20% move in the quote asset relative to ETH therefore moves the ETH-denominated starting FDV by approximately 20%.

For activation, the selected tick must remain within 100 basis points of the target using the pinned calculation. Immediately before production activation, the current quote/ETH ratio must also place every configured tick within 500 basis points of the Classic target. The current quote midpoint must independently remain within 300 basis points of the underlying reference. Missing, stale, or conflicting data and any threshold breach block activation.

New launches should be paused in the interface when runtime monitoring finds a current implied ETH FDV more than 500 basis points from the Classic target. This interface pause does not disable direct contract calls.

A later dynamic release should use fresh, authenticated issuer or oracle prices with explicit staleness and deviation bounds. It must not derive the launch tick from a raw spot quote in a thin pool.
