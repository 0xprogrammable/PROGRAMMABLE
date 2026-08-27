# Programmable Launch CLI release

This runbook publishes `@programmable/launch` only as an immutable GitHub
Release from the exact reviewed `production` commit. It does not publish to the
npm registry and it never grants wallet, signer, or broadcast authority.

## One-time repository controls

The repository must have immutable releases enabled. It must also have one
active tag ruleset with no bypass actors:

- name: `Protect Programmable Launch CLI release tags`
- target: tag
- include: `refs/tags/programmable-launch-v*`
- exclude: none
- rules: block update and deletion

The release workflow reads both controls before creating a release and fails
closed when either is absent or different. GitHub enforces immutable release
assets and their associated tag after publication; draft releases are not
immutable. See GitHub's [immutable release behavior](https://cli.github.com/manual/gh_release_create)
and [repository setting endpoint](https://docs.github.com/en/rest/repos/repos#check-if-immutable-releases-are-enabled-for-a-repository).

## Source preparation

Prepare one clean `production` candidate in which all of these values agree:

1. `packages/launch/package.json` contains the new exact version.
2. Package constants, public discovery, install instructions, OpenAPI and the
   expected tarball SHA-256 identify that same release.
3. The expected tarball digest was computed with Node `24.14.0`, npm `11.16.0`
   and `npm pack --ignore-scripts` from the exact candidate package tree.
4. The package tests, machine-contract verification and dry pack pass.
5. The candidate is merged to `production` and its exact production `Verify`
   run produces a fresh, Sigstore-attested proof.

The release workflow re-runs those package gates and rejects any version that
does not exactly match its dispatch input. It does not reuse a tag or release
and it never uses `--clobber`.

## Publish

From the Actions page, run `Release Programmable Launch CLI` on the
`production` branch with the exact version from `packages/launch/package.json`.
The workflow:

1. consumes and verifies the exact-commit production `Verify` proof;
2. installs the exact Node and npm toolchain and exact shrinkwrapped runtime
   dependency closure;
3. runs the focused public package gates;
4. builds one tarball, adjacent checksum, normalized CycloneDX SBOM and
   source/toolchain/digest manifest;
5. self-verifies every byte and creates GitHub OIDC/Sigstore provenance for all
   four assets;
6. creates the release and tag at the exact `production` commit;
7. requires the published release to report `isImmutable: true`; and
8. downloads all assets into a fresh directory, verifies the release and every
   asset attestation, then re-runs the byte-level verifier.

The automatically created release tag points to the exact GitHub-verified
source commit. It is not an annotated or independently signed tag, and must not
be described as one. Asset provenance comes from the release workflow's OIDC
attestations. GitHub documents the consumer checks in
[`gh release verify`](https://cli.github.com/manual/gh_release_verify) and
[`gh release verify-asset`](https://cli.github.com/manual/gh_release_verify-asset).

## Independent readback

After the workflow succeeds, record the exact release URL, tag target commit,
immutable state, asset names, byte sizes and SHA-256 digests. In a new temporary
directory, repeat:

```sh
gh release verify programmable-launch-vVERSION \
  --repo 0xprogrammable/PROGRAMMABLE
gh release download programmable-launch-vVERSION \
  --repo 0xprogrammable/PROGRAMMABLE \
  --dir "$temporary_release_directory"
for asset in "$temporary_release_directory"/*; do
  gh release verify-asset programmable-launch-vVERSION "$asset" \
    --repo 0xprogrammable/PROGRAMMABLE
done
node scripts/programmable-launch-release-assets.mjs verify \
  --repository-root "$exact_production_checkout" \
  --output-dir "$temporary_release_directory" \
  --source-ref refs/heads/production \
  --expected-version VERSION
```

Then checksum-install the tarball in another clean room, run `pack` and
`validate` from real exact source/build artifacts, and stop before submit,
signature, or broadcast unless the release plan separately authorizes those
steps. Keep production deployment, live API readback, release immutability and
clean-room evidence as distinct records.

If publication fails after GitHub creates a tag or draft, stop. Do not delete,
move, reuse, or overwrite release identity automatically. Inspect the remote
state and resolve it explicitly before another versioned release.
