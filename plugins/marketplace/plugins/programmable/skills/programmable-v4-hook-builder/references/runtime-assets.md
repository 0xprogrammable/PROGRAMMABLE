# Runtime assets

Use the runtime-asset channel for large, non-executable project data such as GLB/glTF models, audio, video, textures,
level data, map data, tiles, sprites, and other media that would otherwise exceed the source-review byte limits.

Create a manifest from `assets/templates/runtime-assets.example.json`, validate it against
`runtime-assets-v1.schema.json`, and set `submission.json.implementation.runtimeAssetManifestPath` to its repository
path. Do not also list those data files in source or test path arrays. A literal JavaScript or TypeScript `?url` import
is accepted only when its resolved file is declared by this manifest.

For a repository asset, record its exact repository path, regular non-executable Git blob id, SHA-256, MIME type and
size. Record how and when it loads, its failure behavior, its license declaration and evidence, and its provenance.
The checker compares the declaration with the path and blob in `HEAD`, hashes ordinary or materialized LFS content in
bounded chunks, and never parses, renders, decodes, loads, imports, or executes the asset.

The manifest does not contain the repository root-tree id because that would create a self-reference once the manifest
or generated review target is committed. `prepare-pr` binds the manifest and its declared blob ids to the independently
resolved exact public commit and root tree. The generated source-resolution record carries that root-tree identity.

Git LFS is supported. The committed pointer blob, its SHA-256 object id and declared size are bound exactly. When the
large object is materialized, the checker hashes it. When only the pointer is available, the project enters attributable
asset review instead of being labelled unsafe or failing source closure.

External HTTPS or IPFS resources may be declared with a nullable SHA-256. They are never fetched by deterministic
checks and always enter attributable provider, integrity, license and provenance review. A declared digest, release
tag, `latest` URL or mutable provider endpoint is not upgraded to verified identity without a separate exact fetch and
origin receipt. A review-required asset does not by itself block structural prototype readiness.

Keep code, tests, shaders, WebAssembly, HTML, CSS, native libraries, executables and scripts in the strict source/test
closure. Renaming executable content or giving it a media MIME type does not make it an asset; review must treat such a
misclassification as an invalid package. The runtime-asset channel does not weaken the 2 MB per-file, 20 MB total,
semantic dependency-closure, compiler, test or security requirements for executable project surfaces.

The closed v1 bounds are 256 assets, 512 MB per declared asset, 2 GB aggregate declared bytes, a 1 MB manifest, 512
evidence paths and the canonical repository-path limits. Symlinks, Gitlinks, executable blob modes, traversal, duplicate
ids or paths, false blob ids, false sizes, and false verifiable hashes fail closed.
