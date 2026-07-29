# Hook Builder Program

## Purpose

Programmable accepts complete, open-source Uniswap v4 launch models from independent builders. A submission is reviewed
as a complete implementation rather than an idea pitch. Acceptance is selective and applies only to an exact model
version.

## Submission flow

Builders fork `0xprogrammable/programmable` and open a pull request containing the contracts, tests, model
documentation, security assumptions and licensing declarations. A pull request is public and non-confidential. It does
not guarantee review, acceptance, deployment or revenue.

If Programmable selects a submission, an acceptance record binds the exact commit, model version, builder identity,
beneficiary address and fee allocation before release. Deployment remains gated on technical review, security work and
release evidence.

## Economics

For an accepted external-builder model with a one percent swap fee:

- 0.80% is allocated to the token creator;
- 0.10% is allocated to the hook builder; and
- 0.10% is allocated to Programmable.

The builder allocation is not an additional fee. It applies to launches through the exact accepted model version and
is paid in native ETH. Only the beneficiary may claim it or change its payout address. The accepted allocation cannot
be redirected or reduced by Programmable for that deployed version. It does not create rights to later versions or
derivatives unless a new acceptance record says so. No trading volume or income is promised.

Models developed by Programmable without an external builder retain their own published economics.

## Ownership and attribution

The builder retains copyright in original work and licenses submitted code under MIT. The builder certifies that the
submission is original or properly licensed. Accepted builders are attributed in model documentation and release
records.

## Security and release

Submissions must state hook permissions, accounting behavior, external calls, dependencies, trust assumptions, known
limitations and expected invariants. Unit, integration, fuzz and invariant coverage is required where applicable.
Programmable may request changes, rewrite implementation details or decline a submission. Open source publication and
passing tests are not safety guarantees.

Deployed releases are immutable. A changed implementation is a new version with its own review and acceptance record.
