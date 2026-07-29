# Uniswap hook release workflow

This workflow prepares two local review packets for a deployed Programmable
Uniswap v4 hook:

1. a Hooklist issue packet for the public hook registry
2. a separate routing intake packet for Uniswap routing review

It never submits either packet. A successful local run means the files are
ready for human review. It does not mean that Uniswap has listed or approved
the hook.

## Upstream boundary

The workflow follows the Uniswap Hooklist repository at commit
`9ca1f518c02c5057b0ec96195864e40a675320ca`:

- Registry: <https://github.com/Uniswap/hooklist>
- Hook schema:
  <https://github.com/Uniswap/hooklist/blob/9ca1f518c02c5057b0ec96195864e40a675320ca/schema.json>
- Issue template:
  <https://github.com/Uniswap/hooklist/blob/9ca1f518c02c5057b0ec96195864e40a675320ca/.github/ISSUE_TEMPLATE/submit-hook.yml>
- Routing intake:
  <https://share.hsforms.com/15fMHwt6NTzuKuQdxw6nHwws8pgg>

Hooklist is a public registry. Its README explicitly says that registry
submission does not allowlist a hook for routing. The routing packet therefore
has its own status, checklist and destination.

## Release gates

The command fails closed unless every item below is present:

- Ethereum Mainnet chain ID
- a final deployment and source verification status
- a release commit, source commitment and successful hook deployment record
- current lifecycle evidence from at least two independent RPCs
- `releaseEligible: true`
- no release blockers for a Deep release
- a ready Deep app activation state
- verified source on both Etherscan and Sourcify
- a live runtime code hash matching the manifest
- matching runtime code at the RPC `latest` and `safe` heads
- empty EIP-1967 implementation, admin and beacon slots
- no EIP-1167 minimal proxy runtime
- no reachable `DELEGATECALL` opcode in the runtime
- no owner, admin, proxy, upgrade or self-destruct signal in the locally
  resolved Solidity import tree
- exact agreement between the fourteen permission bits in the hook address and
  the explicit `getHookPermissions()` source declaration
- valid return-delta dependencies

These checks are conservative release gates. They are not an audit and they do
not replace Uniswap's review.

## Deep release history

`mainnet-deep-full-range-v1.json` remains the historical canary record. Its
current `releaseEligible: false`, disabled app state and keeper blocker make the
release command fail before it reads metadata or contacts an RPC.

A future Deep V2 uses the same workflow after its own deployment manifest has
been populated from real receipts and promoted to:

- `releaseVersion: deep-full-range-v2`
- `status: deployment-source-and-lifecycle-verified`
- `releaseEligible: true`
- `activation.appStatus: ready`
- `lifecycleEvidence.status: verified-current-release`
- `lifecycleEvidence.releaseEligible: true`
- an empty `blockers` array
- Etherscan and Sourcify verification for the deployed V2 fee hook

Do not copy V1 addresses, hashes or receipts into a V2 manifest. The release
manifest must be produced from the V2 deployment and lifecycle evidence.

## Reviewed metadata

Create a local metadata file. Do not commit private contacts or credentials.

```json
{
  "name": "Programmable Deep Fee Hook",
  "description": "A Uniswap v4 hook for the reviewed Deep launch model.",
  "auditUrl": "",
  "sourcePath": "contracts/src/LiquidityGrowthFeeOracleHookV2.sol",
  "properties": {
    "dynamicFee": false,
    "requiresCustomSwapData": false,
    "vanillaSwap": false,
    "swapAccess": "none"
  }
}
```

The four properties are review statements, not values inferred from marketing
copy. Check them against the deployed source and actual router behavior before
preparing a packet. `upgradeable` is not configurable: the workflow only emits
`false` after the proxy and upgrade gates pass.

## Prepare the local packets

Run the focused tests:

```bash
npm run release:uniswap-hook:test
```

Then prepare a release:

```bash
npm run release:uniswap-hook:prepare -- \
  --manifest contracts/deployments/mainnet-deep-full-range-v2.json \
  --metadata /absolute/path/to/deep-v2-hook-metadata.json \
  --rpc-url https://your-ethereum-rpc.example \
  --output /absolute/path/to/deep-v2-uniswap-review
```

`ETHEREUM_RPC_URL` may be used instead of `--rpc-url`. The RPC is used only for
read-only chain, bytecode and storage checks.

The output directory must not already exist. Files are written to a private
staging directory and then moved into place together. This prevents a later run
from silently replacing or partially mixing reviewed evidence.

## Output

The command writes:

- `hook-entry.json`: local entry matching the public Hooklist schema
- `hooklist-issue.json`: structured values for the Hooklist issue template
- `hooklist-issue.md`: copy-ready Hooklist issue body
- `routing-allowlist-intake.json`: local routing review facts and checklist
- `routing-allowlist-intake.md`: copy-ready routing review packet
- `release-evidence.json`: manifest, source, permissions and runtime evidence
  binding the two packets

Every output keeps `submissionStatus` at `not-submitted`. There is no GitHub,
form, email or account-writing code in the command.

## Human review and external submission

Before any external action:

1. compare `hook-entry.json` with the current upstream schema
2. check the current Hooklist issue template for changed questions
3. run real exact-input and exact-output quote checks
4. run buy and sell transactions through the intended router path
5. document hook data, access restrictions, partial-fill behavior and fee
   bounds
6. review the public wording and remove any unsupported safety claim
7. obtain explicit authorization to submit the Hooklist issue
8. obtain separate explicit authorization to send the routing intake

The two approvals are separate because the two external actions have different
reviewers and different effects.
