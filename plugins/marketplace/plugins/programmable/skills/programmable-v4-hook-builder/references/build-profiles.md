# Build profiles

Build profiles let the builder recognize how a repository is assembled without making one language, package manager,
game engine, or monorepo layout mandatory. They are reproducibility evidence hints, not an allowlist, a security
verdict, or proof that a build succeeds.

Run `build-profile.mjs detect --repository-root <path>` before planning checks for an existing repository. Detection
only reads bounded regular files and bounded file names. It never executes project commands, package managers, install
hooks, compilers, Git, or network requests. Every `suggestedChecks[].argv` value is inert data for later review. Run a
suggested command only after reviewing the repository, inside an isolated environment without secrets or wallet access.

## Recognition model

The bundled catalog covers Foundry, Hardhat, npm, pnpm, Yarn, Bun, JavaScript/TypeScript monorepos, Python, Rust, Go,
.NET/C#, and Unity. A project can match several profiles at different roots. That is normal for a hook combined with a
browser game, backend, keeper, indexer, or other custom product.

Every match includes `projectRoot`. Manifests, required files, dependency locks, and pins are associated only inside
that root. A `package.json` in `app-a` can never borrow `app-b/yarn.lock`. Nested packages covered by a detected
workspace are not treated as independent npm projects unless they declare their own package manager or lock.

`recognized` means all required, root-bound signals for that profile were found and are internally consistent.
`needs-review` means the repository remains eligible but evidence is incomplete or ambiguous. Unknown systems,
missing locks, conflicting managers, malformed pins, skipped filesystem entries, and scan cutoffs never become
`unsafe` or `rejected` automatically. `eligibility` therefore remains `unchanged`.

## JavaScript package managers

The detector considers both root-bound lock files and the `packageManager` field in `package.json`.

- A `packageManager` declaration selects and pins a manager, but never replaces its dependency lock.
- Multiple manager locks at one root produce `PACKAGE_MANAGER_CONFLICT` and require review.
- A declaration that disagrees with the lock produces `PACKAGE_MANAGER_DECLARATION_MISMATCH` and requires review.
- Hardhat and JavaScript monorepo profiles require `package.json` plus exactly one root-bound JavaScript manager lock.
- Yarn Classic and modern Yarn are resolved separately. Classic install guidance uses `--frozen-lockfile` and
  `--ignore-scripts`; modern Yarn uses `--immutable --mode=skip-build`.
- If the Yarn generation cannot be determined, the profile requires review and no install command is suggested.

The builder may report a missing-lock npm fallback for a standalone `package.json` with no manager evidence. That is a
request for reproducibility evidence, not an assumption that npm is definitely the intended tool.

## Unity pins

Unity is recognized only when the same project root contains all three signals:

- `Packages/manifest.json`;
- `Packages/packages-lock.json`; and
- `ProjectSettings/ProjectVersion.txt` with a parseable `m_EditorVersion` value.

The editor value is returned as the `unity-editor-version` pin. A moving label such as `latest` is not a pin and enters
review.

## Bounded and deterministic inspection

The scan is breadth-first, does not follow symlinks, ignores declared generated/dependency directories, and orders
names by raw UTF-8 bytes. It exposes its entry and depth bounds in `scan`. `depthCutoffs`, `entryLimitReached`, skipped
symlinks, unsafe Unicode names, non-regular entries, and unreadable directories are visible findings. Any incomplete
scan forces the overall result to `needs-review`, even if an otherwise complete profile was found near the root.

The catalog itself is a bounded, regular, non-symlink UTF-8 JSON file with:

- a closed schema and profile set;
- duplicate-key rejection;
- NFC, control-character, bidirectional-control, private-use, and unsafe-path checks;
- UTF-8 byte ordering for profiles, patterns, checks, paths, and output;
- `catalogSha256`, which binds the exact catalog bytes;
- `catalogDigest`, which binds canonical semantic JSON; and
- one canonical `profileDigest` per profile.

`list`, `show`, and `detect` return these digests so reviews can name the exact rules used. CLI failures are canonical
JSON on standard output with `USAGE_ERROR` or `BUILD_PROFILE_FAILED`; usage failures exit `2`, other failures exit `1`.

## Custom and future systems

For an unfamiliar system, keep the submission open and record a custom profile with:

- exact toolchain and version source;
- project root, manifests, dependency locks, generated inputs, and source roots;
- build and test commands as ordered argument arrays rather than shell strings;
- expected outputs and hashes;
- environment, network, resource, and external-service policies; and
- isolation plus evidence needed to reproduce the result twice.

Adding a bundled profile is a versioned catalog-and-code change: extend the closed semantics, add adversarial fixtures,
recompute the exposed digests, and publish it only as part of a reviewed Skill release. Build-profile detection remains
separate from design eligibility, security review, implementation conformance, platform approval, deployment,
provider indexing, and live availability.
