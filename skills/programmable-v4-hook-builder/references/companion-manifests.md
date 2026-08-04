# Companion manifests

Use a companion manifest when the reviewed project spans the primary GitHub repository plus a separate game, app,
service, indexer, or other public GitHub repository. Commit every manifest in the exact primary HEAD and pass its path
to `prepare-pr`. Use at most eight companions.

## Choose the contract

| Contract | Use | Closure result |
| --- | --- | --- |
| v2 (`2.0.0`) | A separate npm game, app, or service with a static JavaScript/TypeScript module graph | May complete the companion closure gate after exact public verification |
| v1 (`1.0.0`) | A proposal, unsupported build system, workspace, dynamic loader, or other architecture needing review | Remains proposal-compatible with `COMPANION_CLOSURE_REVIEW_REQUIRED` |

Do not weaken or mislabel an unusual project to fit v2. Keep v1 or submit the v2 failure as an architecture/tooling
question. An incomplete companion closure is not evidence that the idea is unsafe.

## Build v2

Start from `../assets/templates/companion-manifest-v2.example.json` and validate the document against
`companion-manifest-v2.schema.json`. Replace every example authority with the exact public companion values:

- immutable numeric GitHub repository id;
- full 40-hex commit id;
- full 40-hex root tree id from that commit;
- sorted, disjoint source, test, runtime, and build-configuration paths;
- npm `package.json` and `package-lock.json` paths;
- distinct package scripts that perform the build and tests; and
- at least one successful GitHub Actions run id for that exact repository id, commit, and tree, produced by the closed
  workflow profile below.

Use `npm-package-lock-v3-static-module-closure-v1` exactly. The current method accepts one npm package with
`lockfileVersion: 3`. It rejects workspaces, root peer-dependency authority, local links, Git dependencies, non-registry
tarballs, dependencies without exact versions and canonical 64-byte SHA-512 integrity, missing transitive dependency
targets, undeclared local imports,
ambiguous module resolution, aliases, nonliteral dynamic imports, runtime loaders, inline HTML scripts, and unsupported
source/config languages. Worker and service-worker loaders, `fetch`, WebAssembly instantiation, dynamic DOM construction,
external HTML/CSS resources, and build scripts capable of downloading or evaluating unbound code stay on v1. That is
an architecture-review state, not an unsafe-project verdict. Implicit `pre*` and `post*` lifecycle scripts for the
declared build/test names are rejected.

Declare runtime assets such as HTML, CSS, images, fonts, audio, video, WebAssembly, and shaders when the reviewed
project uses them. Static HTML `src`/`href`, CSS `@import`/`url`, JavaScript/TypeScript imports, CommonJS `require`, and
quoted shader includes must resolve to one declared path. Remote HTTP resources remain an explicit external runtime
dependency and therefore cannot receive a v2 static-closure receipt; use v1 and describe the dependency for review.

Copy `../assets/templates/companion-closure-workflow.yml` into `.github/workflows/`. Despite the `.yml` suffix, this
profile is deliberately strict JSON (valid YAML): exactly one unconditional Ubuntu 24.04 job, pinned checkout and
setup-node action commits, exact Node version and lock path, `npm ci --ignore-scripts --no-audit --no-fund`, then the
declared `npm run <build>` and `npm run <test>`. If the package is in a subdirectory, set the same exact
`working-directory` on all three run steps and point `cache-dependency-path` at that package lock. Other CI may live in
separate workflows, but only a successful run of this exact closure workflow counts. This binds execution of the named
scripts; it does not prove that their assertions are meaningful, which remains review work.

The combined closure is capped at 512 files, 2 MB per file, and 20 MB per repository. `prepare-pr` resolves raw blobs
through the bounded anonymous exact-Git path. It does not check out or execute companion code, npm scripts, hooks,
submodules, or Git configuration.

## Canonicalize locally

Validate and rewrite a manifest before committing it:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" companion \
  ".programmable/companions/game.json" \
  --write-canonical \
  --repository-root "$REPOSITORY_ROOT"
```

This command performs no network access and does not claim closure verification. It writes canonical JSON with one
trailing newline. Commit that exact file in the primary repository.

## Verify through `prepare-pr`

Run the normal package gates, then pass every committed companion manifest:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" prepare-pr \
  "submissions/$APPLICATION_ID" \
  --repository-root "$REPOSITORY_ROOT" \
  --companion-manifest ".programmable/companions/game.json" \
  --companion-manifest ".programmable/companions/service.json"
```

For v2, `prepare-pr` independently checks the declared numeric repository id, commit, root tree, every closure blob,
static module/resource graph, complete npm dependency targets, the exact closure workflow, and its successful
exact-revision Actions receipt. The JSON output records one `github.companionClosure` item with a closure hash and
exact primary manifest path, then copies that canonical receipt into `centralPackage/application.json`. Downstream
intake re-reads that manifest and every immutable companion/workflow blob and independently recomputes the receipt,
including script names, object ids, counts, resolutions, Actions evidence, and closure hash. A v2 mismatch fails
closed; it never silently falls back to v1.

For v1, `prepare-pr` still verifies the public repository, observed numeric id, exact commit, observed root tree, and
declared blobs. It keeps the companion closure diagnostic, allowing a proposal to enter architecture review while
blocking a prototype-ready claim.

## Interpretation

A verified v2 companion removes only the blanket companion-closure blocker. Prototype preparation still requires the
primary repository's complete review target, exact gate-status authority, tests and evidence, plus every
capability-specific security and integration gate. It is not an audit, maintainer approval, deployment, provider
support, or proof of availability.
