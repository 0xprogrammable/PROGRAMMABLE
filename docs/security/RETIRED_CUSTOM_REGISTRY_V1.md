# Retired Custom Registry V1

The first Mainnet Custom Registry generation is retired and is not a production
launch, discovery, indexing, fee-claim, readiness, or deployment authority.
Production serves its public manifest as `prelaunch` with null contract bindings
and readiness fails closed. Stale environment values cannot re-enable it.

Its exact source, deployment record, ABI, policy snapshot, tests, and operator
scripts remain available in Git history at production revision
`2537bdc9874e270accedd4bbd22816a7dc06a4dd`. They were removed from the active
package rather than rewritten, because changing a deployed generation's source
would create false source-to-runtime evidence.

Generic Custom launches remain unavailable until a distinct candidate-neutral
generation has independently reviewed source, deployment, runtime, finality,
indexing, and Website activation evidence.
