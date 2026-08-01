# Support

Use the channel that matches the report.

| Report | Channel |
| --- | --- |
| Reproducible contract or integration problem | [Open an issue](https://github.com/0xprogrammable/programmable/issues/new/choose) |
| Documentation correction | [Open a documentation issue](https://github.com/0xprogrammable/programmable/issues/new/choose) |
| Complete Uniswap v4 project application | [Read the Programmable v4 Builder Program](BUILDER_PROGRAM.md) and open a pull request |
| Security vulnerability | [Report it privately](https://github.com/0xprogrammable/programmable/security/advisories/new) |

Include the model release, contract address, transaction and smallest useful reproduction. Never post private keys,
seed phrases, credentials or an unpatched vulnerability in a public issue.

Programmable does not provide private token-launch consulting or guarantee that a submitted model will be reviewed,
accepted or deployed.

## Builder Beta operations

Programmable maintainers (`@0xprogrammable`) own the public application queue and final GitHub review. The beta has no
review-time or response-time promise; capacity is intentionally limited while the workflow is new.

The canonical machine-readable intake state is [`docs/builder/intake-status.json`](docs/builder/intake-status.json).
Only a maintainer-reviewed change on `main` can move it between these states:

- `prelaunch`: applications are not open;
- `open`: new applications and updates may enter the trusted intake check;
- `paused-new`: applications already on `main` and only the exact unmerged PR/application identities recorded in the
  trusted status may continue; every other new application id is blocked; and
- `paused-all`: application changes are temporarily blocked while the public history stays available.

A pause never means rejection or approval. Open pull requests remain visible, no place in the queue is promised, and
the status-file commit records the pause, its bounded continuing-PR records, or the resume. A continuation record binds
the PR, application, immutable builder id, primary repository lineage, and companion repository identities; it is not
a queue promise or approval. A private security issue may additionally pause one application as described in the
public beta guide.

Maintainers monitor the `public-intake` GitHub Actions result for provider, quota and tooling system blockers. One
bounded rerun may follow the provider reset; repeated shared-IP quota failures pause new or all intake instead of
retrying indefinitely. These failures are beta availability incidents, not security findings against an applicant.
