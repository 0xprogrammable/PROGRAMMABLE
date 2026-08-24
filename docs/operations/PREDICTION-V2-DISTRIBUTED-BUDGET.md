# Prediction V2 shared provider budget

Status: release-dark contract only. No public or private route is activated by this module, no production shared backend is configured here, and no production-readiness claim exists.

## Purpose

Prediction V2 can fan one user action into several paid or rate-limited provider calls. A limit held only in one serverless runtime is not a global limit: parallel runtimes can each spend their own full bucket. `lib/prediction-v2/distributed-budget-v2.server.ts` defines the fail-closed boundary required before those calls can be exposed.

It does not buy or deploy a server, add a database, change Supabase, create a provider account, add a route, or pretend that a shared store exists. An existing shared atomic facility may implement the boundary later, but its durability, atomicity and deadline behavior need separate operational evidence.

## Closed policy and release projection

The application is constructed with a finite list of provider/action lanes. Each lane pins:

- the provider and action;
- the provider-specific unit, such as HTTP calls or RPC compute units;
- the exact complete worst-case cost for one action;
- provider-global, provider/action and provider/action/client capacities and fixed windows;
- a short owner-lease TTL; and
- an idempotency-retention TTL at least as long as the longest charged window.

The runtime caller supplies only the exact provider/action pair, an opaque salted client-scope SHA-256 key and an opaque idempotency SHA-256 key. It cannot submit or reduce the cost. Unknown lanes and raw client identifiers fail before any backend call.

`runtimePolicyProjection()` returns a deterministic, sorted, closed and secret-free shape containing schema/policy version, backend scope and backend-ID commitment, backend timeout, lane identity, exact units, TTLs and every capacity. It contains no endpoint, credential or client key. `runtimePolicyCommitment()` hashes canonical JSON under this fixed domain:

```text
prediction-v2-distributed-budget-runtime-policy/v2\n
```

Any signed release binding must match both `distributedBudgetPolicy` and `distributedBudgetPolicyCommitment`, require `backend.scope === "shared-atomic"`, and require a non-null SHA-256 backend-ID commitment. `assertPredictionV2DistributedBudgetRuntimeV2()` must run first: it proves through a module-private `WeakSet` that the runtime came from the real factory rather than a structurally compatible object that can forge projection methods and bypass leases.

## Reservation and one-owner authorization

One backend reserve operation receives all three scopes, a stable operation key, a stable request fingerprint and a fresh random owner token. The operation key is scoped to provider + action + idempotency key; deliberately changing the client digest cannot open a second operation. A compliant shared backend must atomically:

1. compare the existing operation and request fingerprint;
2. check every capacity;
3. reserve the full worst-case units in all three buckets; and
4. create exactly one operation lease bound to exactly one owner token.

Only a new `reserved` result whose returned owner token exactly matches the attempted token creates an operation owner. It does not yet authorize provider work. No reserve replay status authorizes work:

- `in-progress` means another owner already holds the operation; retry or replay it, but do not call the provider;
- `replay` means the operation is already `committed`, `canceled` or `expired`; use the committed result fingerprint when present, but do not call the provider;
- `rate-limited` and `blocked` fail closed.

A repeated identical in-flight key therefore cannot produce a second operation owner, even when requests arrive concurrently in different application runtimes. The backend must never return the existing owner's secret token to a competing caller.

Running three independent increments, separating the bucket mutation from the lease write, or treating an idempotent reservation replay as another grant is not compliant.

## Absolute backend timeout and late completion

Every reserve, start, commit and cancel call carries both an `AbortSignal` and an absolute epoch `deadlineAtMs`. The application also races the call against its own bounded timeout. Timeout and exception responses are `blocked`; they never authorize provider work.

A shared backend must check both signal and absolute deadline immediately before its durable atomic mutation. The signal alone is not enough because cancellation delivery may be late. The application never turns a late backend response into success. If a reserve mutated just before the client-side timeout but its response arrived late, a retry uses a new owner token and must receive `in-progress` or a terminal replay from the backend, never a second lease.

Do not issue a compensating cancel automatically after a timeout. The timed-out mutation may have committed, and a blind cancel could free capacity after work was already consumed.

## Exact commit and cancel semantics

The opaque lease binds schema version, provider/action, operation key, request fingerprint, reservation ID, owner token and expiry. Start, commit and cancel are owner-token compare-and-set transitions over that exact operation:

- `markLeaseStarted({ lease })` changes live `reserved -> started`; only the first non-replay `status: "started"` with `providerWorkAuthorized: true` authorizes exactly one provider invocation;
- a concurrent, repeated or late start returns `lease-already-started` and never reauthorizes provider work, even for the correct owner;
- `commitLease({ lease, resultFingerprint })` changes `started -> committed` and retains an opaque SHA-256 reference to a result stored outside the budget backend;
- commit directly from `reserved` fails: the caller cannot skip the irreversible consume-before-provider boundary;
- repeating the exact same commit is an idempotent replay;
- committing a different result, committing after cancellation, or using a changed operation/reservation fails closed;
- `cancelLease({ lease })` changes live `reserved -> canceled` and releases all three bucket charges atomically exactly once;
- repeating the exact same cancel returns `releasedUnits: 0` and cannot decrement any bucket again;
- cancel after `started` always fails and can never refund provider capacity, including when execution, JSON serialization, result storage, commit, response writing or the client connection later fails;
- owner mismatch is explicit but never reveals the real owner token;
- an unstarted expired lease cannot start, commit or cancel; its conservative charge remains until the fixed window;
- a lease that was started before expiry may commit after its start TTL, up to the idempotency-retention deadline, so a slow provider response can still become a durable replay.

Cancellation is allowed only in the pre-start `reserved` state. The trusted route must atomically mark the lease started before invoking the provider. From that one-way transition onward, every catch, abort and cleanup path is forbidden from canceling it. The owner should commit a durable success or failure result; if it cannot, the capacity remains consumed. An external caller must never receive authority to choose start, commit or cancel.

The result fingerprint is only a stable replay pointer/digest. The provider response and any sensitive data belong in a separately reviewed durable result store.

## In-memory adapter

The bundled adapter exists only for deterministic unit tests and local development:

- construction requires `allowNonProduction: true` and an explicit `test` or `development` environment;
- it throws when the process environment is production;
- its backend scope is always `single-runtime-test`;
- it owns one fixed secret-free test-backend commitment; and
- the enclosing budget always reports `productionReady: false` and `releaseState: release-dark`.

It mirrors the atomic bucket + lease + transition algorithm inside one JavaScript runtime, but it is neither shared nor durable. Passing its tests is not provider-capacity or production evidence.

## Activation requirements

Before any route can use this boundary, an integration owner must provide and verify all of the following:

1. A shared durable backend that executes operation lookup, three-scope reservation, owner lease and each `start`/`commit`/`cancel` transition as one atomic compare-and-set.
2. An immutable backend-ID commitment plus exact signed matching of the deterministic runtime policy projection and commitment.
3. Provider-approved unit definitions, worst-case call graphs, capacities and windows for every enabled lane. Display providers and settlement/oracle providers remain separate lanes.
4. A salted server-side derivation for client scope keys. Raw IP addresses, wallet addresses, account IDs and other personal identifiers must never be stored as bucket keys.
5. Concurrency canaries proving one owner under identical simultaneous keys and exactly one non-replay start, plus owner-mismatch, commit replay, cancel replay/no-double-release, cancel-after-start rejection, fixed-window and idempotency-conflict tests against the deployed backend.
6. Timeout and late-completion canaries proving deadline checks before mutation, abort handling, fail-closed application behavior, no second owner after an ambiguous reserve, and no provider authorization after an ambiguous start.
7. A durable provider-result store keyed by the committed result fingerprint, with its own retention and access policy.
8. Metrics that do not expose client keys or owner tokens, plus an operator runbook for sustained capacity denial, timeouts and backend failures.
9. Route-level propagation of the exact retry delay, `markLeaseStarted` immediately before provider invocation, never canceling after a successful or ambiguous start, and an exact commit after durable result storage. Execute throws, JSON failures, commit failures and client aborts must all preserve the consumed charge.
10. A separately reviewed release binding and integration change. This file alone cannot activate Prediction V2.

An edge per-client WAF limit can reduce abuse before application execution, but it does not replace this shared provider budget: it does not atomically account for variable provider-specific worst-case units across provider and action scopes.
