# Candidate-neutral production ownership V1

This inventory separates the Programmable launch platform from external applicant projects.

## Preserved platform surfaces

- `components/custom-launch-experience.tsx` is the descriptor-driven Launch Console used by `/launch`.
- `lib/custom-launch/{client-v2,contract-v2,response-contract-v2}.ts` owns the neutral browser/API contract.
- `lib/server/custom-launch/{generic-launch-contract-v1,generic-launch-read-v1}.ts` owns neutral public discovery.
- `app/api/custom-launch/generic/v1/launches/**` owns the neutral feed and detail API.
- Registry manifests, readiness gates, approval entitlements, wallet submission, finality, and the generic indexer remain platform-owned.

## Removed production surfaces

- The disconnected legacy manual applicant component and its styles.
- Legacy manual route APIs, authorities, stores, workers, configuration, release scripts, vendored closures, and tests.
- Project-specific applicant identities, route compatibility, wallet senders, schemas, configuration, and presentation branches.
- Project-specific source and route verification scripts that were reachable from the package release graph.

External projects can be reviewed and launched only through a current descriptor and grant. Their names, owners, repositories, ABIs, event topics, fees, and route semantics are not platform trust inputs.

## Release gate

`npm run verify:candidate-neutrality` scans production source roots, package scripts, root deployment configuration, and build workflows. The build, interface test, and full test commands invoke it before accepting a release. A second `npm run verify:candidate-neutrality:build` pass scans the emitted `.next/server` and `.next/static` artifacts.
