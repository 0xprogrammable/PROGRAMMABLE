# Custom launch fee policy v1

Custom fees are approved per provider, model, template version, and market path. There is no
platform-wide fee that can be copied onto every Custom launch.

Every approved launch route publishes `programmable.custom-launch-fee-policy.v1` with:

- `providerId`;
- `modelId` and `templateId`;
- a strict semantic `semanticVersion`;
- the exact `marketPathId`, or `null` when no qualifying market path exists;
- total ppm and bps, charge mode, and an ordered list of fee legs;
- an explicit namespaced recipient identity for every nonzero leg.

The Programmable recipient is always
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` in the route chain namespace. A partner recipient
must come from the approved launch plan. The Website, Registry projection, documentation, or test
fixtures must never invent a partner recipient for a real release.

## Exact modes

| Mode | Qualifying path | Total | Legs | Charge mode |
| --- | --- | ---: | --- | --- |
| Standard Programmable Custom | exact `marketPathId` | 10 bps | 10 bps Programmable | added on top |
| AEON partner Custom | exact `marketPathId` | 20 bps | 15 bps AEON, 5 bps Programmable | included in the 20 bps partner total |
| No qualifying market | `marketPathId: null` | 0 bps | none | none |

AEON uses `providerId: "aeon"`. Its 20 bps mode sets
`normalProgrammableTenBpsApplied: false`; an additional 10 bps Programmable fee is invalid.
An AEON fee-bearing route is also invalid unless the approved plan supplies the AEON recipient as
an explicit namespaced identity.

The finalized `programmable.launch-fee-obligation.v3` embeds this exact policy. Its canonical hash
therefore commits the provider, model, template, semantic version, market path, rates, charge mode,
and recipients together with chain and enforcement evidence. A fee-bearing obligation must point
to a discoverable market with the same `marketPathId`. A no-qualifying-market obligation has null
basis and enforcement fields and `claimSemantics: "not-applicable"`.

## UI requirement

The review screen reads the policy attached to the selected approved route. It shows the exact
total and split, provider/model/template/version identity, market path, and recipients. It must not
display a universal 0.10% Custom fee.
