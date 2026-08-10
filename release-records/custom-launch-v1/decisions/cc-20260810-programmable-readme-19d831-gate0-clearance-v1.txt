Decision ID: cc-20260810-programmable-readme-19d831-gate0-clearance-v1
Immutable reference: command-center://decision/cc-20260810-programmable-readme-19d831-gate0-clearance-v1
Authority: Command Center
Decision time: 2026-08-10T00:47:54Z

Command Center clears Gate 0 only for the README presentation candidate described below.

Repository: 0xprogrammable/programmable
Target branch: production
Reviewed base: c238cb2dbbbd966f59b747aa87b84a2175734570
Reviewed candidate: 19d831087c2df6c8d5b69d9f79ea1bda6623a7b0
Reviewed candidate tree: 6cacf1a0ee255d00c4967051edd39defb1ef1e5b

The reviewed candidate changes exactly these paths:

README.md
assets/readme/README.md
assets/readme/programmable-repository-cover-v1.jpg
assets/readme/programmable-social-preview-v1.jpg

Authorized actions:

1. Push the exact reviewed candidate to the feature branch codex/programmable-readme-design-20260810.
2. Open a pull request from that branch into production at the exact reviewed base.
3. Run and, without changing the candidate SHA, retry the required pull request checks.
4. Squash merge the pull request without an administrator bypass after every required check passes and every conversation is resolved.
5. Verify that the resulting production tree equals the reviewed candidate tree and that the public GitHub README renders the reviewed presentation assets.

This decision does not authorize a Vercel deployment, production promotion, alias movement, environment or secret change, workflow dispatch, Custom Launch activation, approval-service change, contract change, database change, Registry change, indexer change, tag, release, history rewrite, force push, or branch-protection change.

No approval-service artifact is part of this README-only decision. The reviewed diff contains no application runtime, API, server, contract, database, indexer, configuration, workflow, or release-control path.

No candidate substitution is authorized. If production no longer equals the reviewed base before the feature push or merge, or if the candidate SHA, tree, or path set changes, this clearance expires and a new decision is required.
