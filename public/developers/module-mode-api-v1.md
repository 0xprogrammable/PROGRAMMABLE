# Module contributions through the API

An agent submits the module's exact source files, configuration schema, wallet declarations and management interface. The API stores an immutable **unreviewed draft** and returns its identity. Intake does not run the source and does not approve, deploy or make the module selectable in launches.

A GitHub repository is not required. The descriptor always pins `source.files` with their SHA-256 hashes. Git provenance is optional: provide both `source.repository` and `source.revision`, or omit both. Providing that pair records a provenance claim; it does not verify remote Git history.

The wire contract is `programmable.modules.api.v0.1`, with source requests in `programmable.modules.submission.v0.1`. The initial API exposes durable source intake and private status reads. A later review or admission contract must provide its own evidence; these client commands do not invent that evidence.

## Author and reward wallet

The package descriptor requires two nonzero EVM addresses:

- `author` is the contributor's wallet. It must match the authenticated wallet that owns the Module contributions API key. A wallet string alone does not establish ownership.
- `rewardWallet` is the payout wallet submitted for this immutable module revision. It may differ from `author`. Supplying it does not claim control over that wallet or prove that any rewards exist.

Create a key for **Module contributions** in the website's authenticated developer key settings when that deployment offers this capability. Its scopes are exactly `modules:submit` and `modules:read`. Existing Custom launches keys do not gain those scopes automatically. Keys are secrets; source files, descriptors, output artifacts and command-line arguments must not contain them.

The CLI reads only `PROGRAMMABLE_MODULES_API_KEY` for authentication. Inject it through your agent's secret environment or a secret manager. Do not pass it as an argument or put a literal key in shell history. Capabilities are public and receive no Authorization header.

## Prepare, submit and track

Use Node.js 24.14 or newer within the supported Node 24 release line. These commands use the repository's existing CLI entry; the public standalone distribution uses the same commands. Set `MODULE_API_ORIGIN` to the verified origin of the deployment you intend to use. There is no guessed production endpoint. HTTPS is required; `http://localhost`, `http://127.0.0.1` and `http://[::1]` with an optional port are allowed for local integration.

From a checkout with its dependencies installed:

```bash
node packages/classic-modules/bin/programmable-classic-modules.mjs module-capabilities \
  --api-origin "$MODULE_API_ORIGIN"
```

Check `moduleContributions.submissions`. A false value means this deployment is not accepting drafts. `apiKeyIssuance` independently states whether it issues new module keys. The client also verifies capabilities before every upload; it sends no credentials or source when intake is unavailable or the format is incompatible.

Prepare a reviewable source request offline. Every path is relative to the explicit `--root` directory; source files must be ordinary files below that root, with no symlinks or traversal. `module.json` is an open source-package descriptor, not the older fixed-module manifest.

```bash
node packages/classic-modules/bin/programmable-classic-modules.mjs prepare-module-submission \
  --root /absolute/path/to/my-module \
  --package module.json \
  --out submission.json
```

The command verifies every declared SHA-256 against the local bytes and writes the exact transport request with exclusive creation. It prints `packageId`, `familyId`, `requestDigest`, the two wallets and explicit unverified states. It never overwrites an existing request file. Save that request and its identity for the review and any retries; do not publish source that contains credentials.

Submit the prepared bytes with a stable idempotency key of 16–128 letters, digits, dots, underscores, colons or hyphens:

```bash
node packages/classic-modules/bin/programmable-classic-modules.mjs submit-module \
  --root /absolute/path/to/my-module \
  --request submission.json \
  --api-origin "$MODULE_API_ORIGIN" \
  --idempotency-key my-module-0.1.0-intake-001
```

For a one-step source upload, replace `--request submission.json` with `--package module.json`. Use exactly one option. The prepared request is preferable for repeatable uploads because later edits to working files cannot change it. Both paths revalidate the pinned source bytes before sending.

An HTTP 201 response is a newly persisted draft; HTTP 200 is an idempotent replay. Both return `status: "draft_received"`, `reviewStatus: "unreviewed"`, `approved: false` and `available: false`. The client verifies the receipt's package, family, request digest, author, reward wallet, byte count, name, version and supersession against what it sent. The returned `submissionId` is a UUID; use it for subsequent reads.

```bash
node packages/classic-modules/bin/programmable-classic-modules.mjs status-module \
  --api-origin "$MODULE_API_ORIGIN" \
  --id YOUR_SUBMISSION_UUID

node packages/classic-modules/bin/programmable-classic-modules.mjs list-module-submissions \
  --api-origin "$MODULE_API_ORIGIN"

node packages/classic-modules/bin/programmable-classic-modules.mjs list-module-submissions \
  --api-origin "$MODULE_API_ORIGIN" \
  --cursor NEXT_CURSOR_UUID
```

Status and listing are private to the authenticated principal. Lists contain at most 20 items. Follow the returned `nextCursor` until it is `null`; do not construct offset or limit queries.

To submit an edited revision, update the package version and hashes, then prepare a new file linked to the previous submission:

```bash
node packages/classic-modules/bin/programmable-classic-modules.mjs prepare-module-submission \
  --root /absolute/path/to/my-module \
  --package module.json \
  --supersedes PREVIOUS_SUBMISSION_UUID \
  --out submission-v2.json
```

Submit this new revision with its own stable idempotency key. The old source request remains immutable. `--supersedes` is also accepted with the one-step `--package` upload; it cannot override a prepared request's already pinned supersession.

## SDK

The Node-only `@programmable/classic-modules/open-client` entry uses the same HTTP contract. For source checkouts, the equivalent relative imports are shown below. The package remains marked as a development package; an installed release must be verified independently.

```js
import { loadOpenSourcePackage } from './packages/classic-modules/src/open-package-io.mjs';
import { moduleSubmissionFromPack } from './packages/classic-modules/src/open-transport.mjs';
import { createModuleApiClient } from './packages/classic-modules/src/open-client.mjs';

const client = createModuleApiClient({
  apiOrigin: process.env.MODULE_API_ORIGIN,
  apiKey: process.env.PROGRAMMABLE_MODULES_API_KEY,
  timeoutMs: 20_000,
});
const pack = await loadOpenSourcePackage('/absolute/path/to/my-module', 'module.json');
const request = moduleSubmissionFromPack(pack);
const receipt = await client.submit(request, { idempotencyKey: 'my-module-0.1.0-intake-001' });
const status = await client.status(receipt.submission.submissionId);
const page = await client.list();
```

Public capabilities do not require `apiKey`. Authenticated methods require a key and send it only to the explicit origin. Redirects are rejected. The client has a default 20-second timeout covering headers and streamed body reads, and a maximum 1 MiB response size after decompression. A caller may set a timeout between 1 and 120,000 milliseconds. There are no automatic retries or arbitrary URL fetches from package metadata.

## Request limits and failure handling

Each request contains the descriptor and exactly its pinned source files, encoded as canonical base64. Local limits are 128 files, 4 MiB per file, 16 MiB total raw source and 24 MiB serialized HTTP request bytes. Base64 expansion is included in the HTTP limit. The deployment may publish lower limits; the client checks those before uploading. A source hash match proves the received bytes match the descriptor. It does not prove source ownership, repository history, a successful build, runtime safety or approval.

CLI failures return a nonzero exit code and structured JSON on stderr. Codes and safe field paths are retained; arbitrary server messages, raw response bodies and credential echoes are not printed. Relevant failures include:

| Code or HTTP status | Action |
| --- | --- |
| `OPEN_ADDRESS` / `MODULE_AUTHOR_MISMATCH` | Provide nonzero EVM addresses and use a module key owned by the declared author wallet. |
| `OPEN_SOURCE_HASH` / `MODULE_FILE_HASH` | Reconcile source bytes and declared hashes before preparing a new request. |
| 401 / `API_SCOPE_REQUIRED` | Use an active Module contributions key with the required scopes. |
| `MODULE_IDEMPOTENCY_CONFLICT` | The same key was used with different source bytes or declarations. Do not overwrite or replace the original attempt. |
| `MODULE_PACKAGE_CONFLICT` / `MODULE_VERSION_ALREADY_SUBMITTED` | Read the existing revision or intentionally create a new version and revision link. |
| `MODULE_REVISION_LINEAGE_INVALID` | The supplied predecessor is not a valid revision for this author and package family. |
| 429 | Observe `retryAfterSeconds` when returned; reduce request frequency or resolve the indicated quota. |
| `MODULE_SUBMISSIONS_UNAVAILABLE` | This deployment currently does not accept uploads. |
| `MODULE_API_NETWORK` / `MODULE_API_TIMEOUT` | Connectivity, redirect or timeout failure. A POST may already have reached the server. |
| `MODULE_API_RECEIPT_MISMATCH` / `MODULE_API_RESPONSE` | Do not treat the response as a valid receipt. Preserve the request and investigate the deployment. |

When `submissionMayExist: true` is returned, retain the original idempotency key and immutable request. Retry that exact pair after resolving the failure, or inspect the principal's submissions. Do not generate a new key automatically: a lost response does not prove that the server failed to persist the draft.

## Verification scope

The local HTTP tests cover credential boundaries, redirect refusal, real POST/GET requests, canonical source identity, idempotency, lost-response recovery, receipt substitution, author/reward wallet requirements, response limits, timeouts and cursor pagination. These checks do not constitute a deployment, independent review, contract audit or proof that the public API is enabled.

```bash
node --test packages/classic-modules/test/open-client.test.mjs \
  packages/classic-modules/test/module-api-cli.test.mjs
```
