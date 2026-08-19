# Multi-repository project closure

Use this reference when an open-world V2 project spans a primary repository plus any number of apps, games, services,
indexers, keepers, libraries, evidence repositories, or other source surfaces. Application V3 treats every repository as
an independent public GitHub source binding. There is no product-level limit of eight companions, 512 files, or 20 MB.
Bounded verifier resources may require deterministic fragmentation or split review; they never make the idea unsafe or
ineligible.

Historical companion-manifest V1/V2 files, `prepare-pr`, the six-file `application.json` package, and their limits belong
only to exact historical Submission V1 reproduction. Do not use them to prepare or describe a new V2/V3 project.

## Repository graph

Choose one primary public GitHub repository for project lineage. Give every additional repository a stable package-local
id and record:

- canonical public `https://github.com/<owner>/<repo>` identity and immutable numeric GitHub repository id;
- exact commit and root tree;
- purpose, owning product surfaces and dependency edges;
- source-closure mode and exact paths or manifest binding;
- implementation, test, evidence and runtime roles; and
- build, service, deployment or provider dependencies needed to review its behavior.

A path, workflow, receipt, fee artifact or test in one repository cannot satisfy another repository's binding. Do not
flatten repositories into one synthetic trust boundary. Detect dependency cycles as architecture and operations facts;
keep provenance and revision lineage acyclic.

Application V3 is GitHub-only. A private repository, local path, ZIP, pasted source, mutable branch, other Git host or
credentialed URL can support local exploration but cannot satisfy the public application contract. Report
`INTEGRATION_PENDING`, preserve idea eligibility and perform no public-package or external write.

## Closure modes

Choose independently for each repository:

- `inline` binds one to 4,096 exact repository-relative paths and no source manifest.
- `manifest` binds no inline paths. It content-binds one versioned root source-closure manifest and ordered canonical
  JSONL fragments.

Inline is a small-package fast path, not a preferred project class. Crossing its bound selects manifest transport. The
root manifest is itself an exact blob in the pinned outer tree, repeats repository identity and binds every fragment; it
does not embed its own containing commit/tree because that would create a Git fixed point. Each entry binds UTF-8 path,
Git mode, blob id, byte length, SHA-256 and review roles.

The trusted verifier must walk the complete application-to-repository-to-root-to-fragment-to-entry chain against raw
objects from the exact commit. It checks bytewise ordering, uniqueness, ranges, counts, modes, roles, blobs, sizes, hashes
and closure digest. It must not follow a source symlink or execute candidate code, Git hooks, filters, submodules, build
scripts or package-install hooks.

`source-closure-manifest-v1` currently represents SHA-1 Git object databases with 40-hex object ids and separately binds
content bytes with SHA-256. It requires UTF-8 committed paths. Git SHA-256 object databases and non-UTF-8 paths are
`INTEGRATION_PENDING` transport cases; a UTF-8 path above the current 16 KiB path-byte budget is
`HOLD_SPLIT_REVIEW`. Other object formats or encodings need a new versioned contract, generator, verifier and migration.
Never silently widen V1.

## Dependency closure

For every repository, identify the build/runtime graph appropriate to its languages and tools. Bind exact lockfiles,
package versions, integrity records, source revisions, generated inputs and licenses where available. A static npm graph
may use the existing strict companion closure tooling as supporting evidence, but that historical tool is not the
Application V3 transport and does not impose its architecture or file limits on the project.

Dynamic imports, workspaces, native libraries, network-fetched build inputs, WebAssembly, remote media, generated code,
submodules, Git LFS and unsupported toolchains remain representable. They require explicit source/dependency closure and
review instead of being renamed or dropped to fit one analyzer. Missing analyzer support is a tooling/evidence gap, not a
product verdict.

## Application preparation

Freeze and push every source revision before preparation. First use `cli.mjs open-world prepare-revision` with one
`--source-root <repository-ref>=<git-root>` per current repository; keep revision and lineage absent from its draft.
This GET-only step derives the unique revision and creates only a new external `application.v3.json` root when
explicitly written. Then use that file with the released `cli.mjs open-world application --help` interface. The second
step is zero-network and binds repository identities, commits, trees, closure, Submission V2, security, fee
applicability and evidence into the complete package outside all source and Git-control roots.

On an update, a current repository can supply an earlier commit from its own object database. Use
`--predecessor-source-root` only for a selected removed or replaced historical repository whose objects are otherwise
unavailable; a removed inline companion in mixed manifest/inline history is one such case. Do not supply it for fully
remote-replayable all-inline history.

Preparation is local and read-only unless an explicit local write flag is chosen. It does not push, publish, open a pull
request, approve the project, or authorize launch. Only the revision step performs GET reads; the package builder does
not use the network. The later GitHub submit/update path first produces a read-only action plan and requires separate
authorization for its exact current digest.

## Evidence meaning

A complete closure proves only which exact bytes and dependencies were presented for review. A successful source-owned
workflow proves only that its declared commands completed for the bound commit. Neither proves that tests are sufficient,
the project is safe, the Registry accepted it, a runtime matches, a provider supports it, or the product is available.
