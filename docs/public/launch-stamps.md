---
description: Verify canonical Programmable Router provenance for future Classic and Custom launches
---

# Launch stamps

The `ProgrammableLaunchStampRouterV1` contract is the provenance root for future Router based Programmable launches on Ethereum. A successful Router transaction records the launch identity, token, hook, PoolManager, pool and launch kind in one atomic execution.

| Field       | Current value                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| Network     | Ethereum Mainnet                                                                                         |
| Router      | `0x8622DD5bAb44185f2A458ac90384Ac99248f8d56`                                                             |
| Start block | `25717612`                                                                                               |
| Scope       | Future Router based launches only                                                                        |
| Manifest    | [developers.programmable.family/api/v2/manifest](https://developers.programmable.family/api/v2/manifest) |

## What a stamp establishes

A valid stamp establishes that the exact canonical Router executed and recorded the launch, and that the record binds the listed token, hook and pool to one launch id. Integrators can verify the runtime code, immutable bindings, events and lookup results against the public manifest and ABI.

## What a stamp does not establish

A stamp does not establish current liquidity, safety, audit coverage, sellability, price quality or support in an external terminal. Historical launches are not retroactively stamped, and a direct call to another factory does not create Router provenance.

The public canary records one finalized Custom graph launch and is included in the developer manifest so an integration can test the complete verification path against a known transaction.

{% content-ref url="developers/verify.md" %}
[verify.md](developers/verify.md)
{% endcontent-ref %}
