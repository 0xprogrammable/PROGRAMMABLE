# Custom Launch detached release record V1

This directory defines the immutable release-record path required by
`CUSTOM-LAUNCH-PRODUCTION-ACTIVATION-V1.md`. It does not clear the production
freeze and it does not authorize a deployment or promotion.

## Why the record is detached

The record binds the final Website commit. Storing that record inside the same
commit would create an impossible self-reference: changing the record changes
the commit it names. Create the Website commit first, then instantiate this
template as a detached, content-addressed Command Center record. Retain the
record on the dedicated `command-center-release-records` branch at
`release-records/custom-launch-v1/release-record.json`. The production workflow
fetches an explicitly supplied commit from that branch rather than trusting its
mutable tip. The verifier prints the SHA-256 of the entire canonical record so
the retained object can be identified without mutating it.

The record has two different hashes:

- `subject.releaseSubjectSha256` binds the exact Website commit, reviewed diff,
  approval-service package artifact and its two packed-content hashes. Command
  Center decisions must repeat this hash.
- `detachedRecordSha256` is printed by the verifier and identifies the complete
  record, including later deployment evidence. It is never written back into
  the record.

## Required order

1. Copy `release-record.template.json` to an evidence-only location. Never edit
   the template itself for a release.
2. Insert the final Website commit, reviewed diff hash and the values from the
   approval service's generated `release/production-packed-artifact.json`.
3. Run the template verifier and copy its computed release-subject hash into
   `subject.releaseSubjectSha256`.
4. Command Center clears the freeze for that exact subject. Record the decision
   id, canonical `command-center://decision/<decision-id>` reference, timestamp
   and SHA-256 of the exact decision text.
   General publishing permission, a request for speed or a green test is not a
   freeze-clearance reference.
5. Add passed validation evidence, production dependency attestations and the
   exact previous deployment/configuration rollback snapshot.
6. Commit the staging record to the dedicated record branch, then dispatch the
   reviewed production workflow with its exact record commit and detached
   digest. The workflow verifies it before build or candidate staging.
7. After staging, create the next detached record revision that binds the
   workflow run, exact commit, immutable deployment id/URL and verification
   evidence.
8. Obtain a separate Command Center promotion decision that names the exact
   candidate. Freeze clearance alone never authorizes promotion.
9. After promotion, complete the authenticated and bounded Ethereum canaries.
   A separate Command Center live declaration is required before the record can
   verify at `live` level.

Do not store tokens, private keys, database URLs, passwords, provider secrets or
credentials in this record. Store only public identities, immutable references
and cryptographic evidence digests.

## Verification

```bash
# The untouched template is structurally valid but not releaseable.
npm run release:custom-launch:record:verify -- \
  docs/operations/releases/custom-launch-v1/release-record.template.json \
  --require template

# Each later level is fail closed.
node scripts/verify-custom-launch-release-record.mjs /path/to/record.json \
  --require clearance
node scripts/verify-custom-launch-release-record.mjs /path/to/record.json \
  --require staging
node scripts/verify-custom-launch-release-record.mjs /path/to/record.json \
  --require candidate
node scripts/verify-custom-launch-release-record.mjs /path/to/record.json \
  --require promotion
node scripts/verify-custom-launch-release-record.mjs /path/to/record.json \
  --require live
```

`staging` requires every validation gate, production dependency and rollback
snapshot while all candidate and promotion fields remain empty. `candidate`
then requires the exact protected-workflow and immutable deployment binding.
`promotion` additionally requires a candidate-specific Command Center
decision. `live` additionally requires the promoted identity, canary evidence
and live declaration.

The protected workflow compares the staging record with its exact Website
commit, reviewed backend artifact, current rollback deployment and supplied
detached-record digest before it builds or stages an enabled Custom Launch
candidate. The workflow remains stage-only. Any later promotion needs an
updated, candidate-bound record and its separate Command Center decision.
