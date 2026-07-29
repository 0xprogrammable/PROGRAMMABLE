# Hook Builder Program

Programmable accepts complete, open-source Uniswap v4 launch models from independent builders.

Submit a model by forking this repository and opening a pull request. The pull request must contain the implementation,
tests and documentation needed to review the model as a complete release candidate.

## What to submit

A model submission must include:

- Solidity source for the hook and every supporting contract;
- unit and integration tests for the complete launch path;
- fuzz and invariant tests for permissions, accounting and model-specific properties;
- a model document under `models/<model-name>/README.md`;
- fixed compiler and dependency versions;
- all hook permissions, return deltas, external calls and privileged roles;
- fee calculations, rounding behavior and supported pool shape;
- trust assumptions, known limitations and failure modes;
- deployment and source-verification instructions; and
- the builder's GitHub identity and Ethereum beneficiary address.

Keep each model isolated:

```text
models/<model-name>/README.md     Behavior, economics and security assumptions
src/<ModelContracts>.sol         Hook and supporting contracts
test/<Model>.t.sol               Unit and integration tests
test/invariant/<Model>.t.sol     Stateful invariants
spec/<model-name>.json           Fixed parameters and dependency versions
```

Use the pull request template as the submission checklist. Do not include private keys, credentials or non-public
security findings.

## Selection

A pull request is a public, non-confidential submission. Opening one does not guarantee review, acceptance, deployment,
trading volume or revenue. Programmable may request changes, decline a submission or be working independently on a
similar model.

Models are evaluated on:

- usefulness as a distinct launch model;
- correctness and simplicity;
- accounting and permission safety;
- test and documentation quality;
- dependency and operational risk;
- gas and integration cost; and
- whether the behavior can be presented clearly to token creators and traders.

Security requirements depend on the model's risk. Programmable may require additional testing, independent review,
monitoring or a bug bounty before release. Passing repository checks is not a security certification.

## Accepted models

Selection is recorded in an acceptance record before release. The record identifies:

- the model and version;
- the accepted commit;
- the builder and beneficiary address;
- the applicable fee allocation;
- the source license; and
- the scope of the builder's participation.

Selection is final only when a completed
[acceptance record](models/ACCEPTANCE_RECORD_TEMPLATE.md) is merged into the repository.

For an accepted external-builder model with a total swap fee of 1.00%, the allocation is fixed:

| Recipient | Share of swap volume |
| --- | ---: |
| Token creator | 0.80% |
| Hook builder | 0.10% |
| Programmable | 0.10% |

The builder share is part of the published 1.00% fee. It is not added on top. It applies only to launches through the
exact accepted model version and does not create rights to later versions or derivative models. The deployed contracts
and release record must match the disclosed allocation.

For Ethereum models, these fees are accounted for and paid in native ETH. Only the builder beneficiary may claim its
share or change its payout address. Changing the payout address does not change the builder allocation. Programmable
cannot redirect or reduce the accepted builder share for that deployed version.

Models developed by Programmable without an external builder allocate 0.90% to the token creator and 0.10% to
Programmable when the published total fee is 1.00%.

No minimum volume, launch count or income is promised.

## Ownership and license

Builders retain copyright in their original work. By submitting a pull request, each contributor confirms that they
have the right to submit the code and license it under this repository's [MIT License](LICENSE). Programmable may review,
modify, test, deploy and publish accepted code under that license.

Third-party code must retain its required notices and use a license compatible with MIT distribution. Submissions with
unclear ownership or incompatible licensing will not be accepted.

## Attribution

An accepted builder is credited in the model documentation and acceptance record. Contract NatSpec and release
metadata should preserve that attribution where practical.

Attribution does not imply that Uniswap Labs, Uniswap Foundation or any other third party reviewed or endorsed the
model.

## Versions and changes

Published contracts are immutable. A material contract change creates a new model version with new tests, security
documentation and deployment evidence.

The builder allocation for an accepted deployed version remains attached to that version. A fix, rewrite, successor or
derivative requires a new acceptance record unless the existing record explicitly covers it.

Programmable may stop offering new launches through a version when security, legal, operational or product concerns
arise. Existing deployed contracts continue to behave according to their code.

## Security reports

Do not disclose vulnerabilities in a pull request or public issue. Follow [SECURITY.md](SECURITY.md) and use GitHub
private vulnerability reporting.
