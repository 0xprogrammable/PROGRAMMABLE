# Runtime assets and large project data

Use this reference for non-executable project data such as models, audio, video, textures, maps, tiles, sprites, fonts,
level data and other media. Runtime assets are first-class dependency and review surfaces. They do not create a project
size allowlist and must not be hidden merely to fit an inline source-closure budget.

Historical `runtime-assets-v1.schema.json`, `runtime-assets.example.json`, `submission.json` bindings and `prepare-pr`
behavior remain available only for exact V1 reproduction. New work models assets through Submission V2 components,
dependencies, product surfaces, source bindings and Application V3 repository closure.

## Record each asset

For every local or remote runtime asset record:

- stable id and owning repository/component;
- exact repository path or external origin;
- Git blob when committed, byte length, SHA-256 and declared media type;
- loading point, consumer and failure/fallback behavior;
- license, provenance and attributable evidence;
- mutability, cache/update policy and integrity expectations; and
- whether the bytes are ordinary Git, Git LFS, generated, or externally hosted.

Keep code, tests, shaders, WebAssembly, HTML, CSS, native libraries, executables and scripts in executable source closure.
Renaming executable content or assigning a media MIME type does not turn it into an inert asset. Bounded magic/container
checks can prove only that bytes match a known structural format; they do not prove that application decoders are safe.

## Git and Git LFS evidence

For ordinary Git blobs, bind and hash the exact committed bytes from the pinned tree. For Git LFS, distinguish:

1. the committed pointer blob;
2. the expected LFS object id and size;
3. locally materialized object bytes; and
4. public GitHub LFS availability for the exact repository/revision.

Local materialized bytes can support local classification and hashing but do **not** prove that reviewers or trusted
intake can fetch the object publicly. A pointer alone does not prove the large object is available, matches local bytes,
or is inert. Application review therefore keeps Git LFS as an independent dependency/availability hold unless a
versioned public reproducibility contract proves the exact object. Launch Bundle V2 remains `NOT_AUTHORIZED` while a
required asset or executable dependency is unavailable or unresolved. Moving necessary bytes to an ordinary verified
Git blob or a separately verified public companion repository is the current repair path.

Do not call a Git LFS limitation a product rejection. Preserve the idea, exact local evidence and dependency requirement;
route the unresolved public object to tooling/dependency review.

## External assets

HTTPS, IPFS or provider-hosted assets remain external dependencies. A URL, release label or claimed digest is not proof
of origin or current availability. Bind exact content identity where possible and separately record provider, retrieval
time, response/integrity evidence, mutability, license, fallback and user-visible failure behavior. Deterministic local
package checks must not silently fetch them.

## Closure and review

Application V3 closes each repository through inline paths or a content-addressed source manifest. Large asset sets may
use manifest fragments and deterministic split review; no fixed count or aggregate byte limit is a product-category
rule. Resource exhaustion produces an explicit tooling hold with a continuation path.

Test loading, decoding, cancellation, cache corruption, missing bytes, hash mismatch, oversized input, decompression or
parser bounds, license/provenance display and the product's fallback behavior. Asset closure is not an audit, runtime
receipt, public availability proof, provider statement or launch authorization.
