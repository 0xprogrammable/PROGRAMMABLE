import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { hashGraphBundle } from "../src/graph.mjs";
import {
  buildProjectMetadata as buildProjectMetadataForProfile,
  hashProjectMetadata,
  validateProjectMetadata,
} from "../src/project-metadata.mjs";

const buildProjectMetadata = (input, options) => buildProjectMetadataForProfile(input, {
  ...options,
  requireComplete: true,
});

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const METADATA_SOURCE_ROOT = await mkdtemp(
  path.join(os.tmpdir(), "programmable-project-metadata-shared-"),
);
await mkdir(path.join(METADATA_SOURCE_ROOT, "assets"), { recursive: true });
await writeFile(path.join(METADATA_SOURCE_ROOT, "assets", "token.png"), TINY_PNG);
after(async () => {
  await rm(METADATA_SOURCE_ROOT, { recursive: true, force: true });
});

const HASH_VECTOR_METADATA = {
  schemaVersion: "programmable.project-metadata.v1",
  token: {
    name: "Café 🪝",
    symbol: "CAFÉ",
  },
  presentation: {
    schemaVersion: "programmable.launch-presentation-draft.v1",
    description: "Créateurs build hooks 🪝",
    image: {
      uri: "ipfs://QmYwAPJzv5CZsnAzt8auVZRnGi1Wm4eQNf6gMss5QZb7S6",
      contentSha256: "sha256:431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
      mediaType: "image/png",
      byteLength: 68,
      width: 1,
      height: 1,
    },
    links: [
      { kind: "website", uri: "https://atelier.example/" },
      { kind: "x", uri: "https://x.com/hookatelier" },
    ],
  },
  tokenMetadataBinding: {
    schemaVersion: "programmable.project-token-metadata-binding.v1",
    tokenTargetId: "project-token",
    declarationBinding: "request-and-launch-id",
    standardReadModel: { name: true, symbol: true },
    name: {
      staticSource: "not-deterministically-extractable",
      argumentIndex: null,
      argumentName: null,
    },
    symbol: {
      staticSource: "not-deterministically-extractable",
      argumentIndex: null,
      argumentName: null,
    },
    postDeploymentReadback: "required",
  },
};

const HASH_VECTOR_GRAPH = {
  schemaVersion: "programmable.custom-graph-bundle.v1",
  sourceBundleSha256: `sha256:${"11".repeat(32)}`,
  targets: [
    hashVectorTarget("project-token", "token", "01"),
    hashVectorTarget("project-hook", "hook", "02", ["beforeSwap"]),
    hashVectorTarget("initializer", "other", "03"),
  ],
  pool: {
    tokenTargetId: "project-token",
    hookTargetId: "project-hook",
    fee: 8_388_608,
    tickSpacing: 60,
  },
};

test("project metadata and graph binding match the frozen cross-runtime hash vector", () => {
  const metadata = validateProjectMetadata(HASH_VECTOR_METADATA);
  const projectMetadataHash = hashProjectMetadata(metadata);
  const hashes = hashGraphBundle(HASH_VECTOR_GRAPH, projectMetadataHash);

  assert.equal(
    projectMetadataHash,
    "sha256:7afb14ee0e4b85d2f6fe34ac7d60062c07969a6d20a3a9cae1eeec12badeaebb",
  );
  assert.equal(
    hashes.unboundGraphBundleHash,
    "sha256:4761d6eeb2ca54d41dd3d0afa3359676bd3b0f6e325f5c1f16d160bd3b72dffb",
  );
  assert.equal(
    hashes.graphBundleHash,
    "sha256:b9288966cdf899edbcaaa254c6f9fc231e8c79dd9c806c1fb8543efb957cfbd6",
  );
});

test("pack metadata hashes exact image bytes, sorts public links and binds ABI token strings", async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "programmable-project-metadata-"));
  try {
    const imagePath = path.join(sourceRoot, "assets", "token.png");
    await mkdir(path.dirname(imagePath), { recursive: true });
    await writeFile(imagePath, TINY_PNG);
    const result = await buildProjectMetadata({
      schemaVersion: "programmable.project-metadata-input.v1",
      token: { name: "Café Hook 🪝", symbol: "ATELIER" },
      presentation: {
        description: "Project-owned token and hook\nExact public source",
        image: {
          sourcePath: "assets/token.png",
          uri: "ipfs://QmYwAPJzv5CZsnAzt8auVZRnGi1Wm4eQNf6gMss5QZb7S6",
        },
        links: [
          { kind: "x", uri: "https://x.com/hookatelier" },
          { kind: "website", uri: "https://atelier.example/" },
        ],
      },
    }, {
      sourceRoot,
      tokenTarget: tokenTarget(),
    });

    assert.equal(result.imageSourcePath, "assets/token.png");
    assert.equal(result.projectMetadata.presentation.image.mediaType, "image/png");
    assert.equal(result.projectMetadata.presentation.image.width, 1);
    assert.equal(result.projectMetadata.presentation.image.height, 1);
    assert.match(result.projectMetadata.presentation.image.contentSha256, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(
      result.projectMetadata.presentation.links.map(({ kind }) => kind),
      ["website", "x"],
    );
    assert.deepEqual(result.projectMetadata.tokenMetadataBinding, {
      schemaVersion: "programmable.project-token-metadata-binding.v1",
      tokenTargetId: "project-token",
      declarationBinding: "request-and-launch-id",
      standardReadModel: { name: true, symbol: true },
      name: {
        staticSource: "constructor-argument",
        argumentIndex: 0,
        argumentName: "_name",
      },
      symbol: {
        staticSource: "constructor-argument",
        argumentIndex: 1,
        argumentName: "_symbol",
      },
      postDeploymentReadback: "required",
    });
    assert.equal(
      result.projectMetadataHash,
      hashProjectMetadata(result.projectMetadata, { requireComplete: true }),
    );
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test("token metadata mismatch fails only when one exact static ABI source is available", async () => {
  await assert.rejects(
    buildProjectMetadata(metadataInput({ symbol: "WRONG" }), {
      sourceRoot: METADATA_SOURCE_ROOT,
      tokenTarget: tokenTarget(),
    }),
    /projectMetadata\.token\.symbol does not match constructor-argument _symbol/u,
  );

  const arbitrary = await buildProjectMetadata(metadataInput(), {
    sourceRoot: METADATA_SOURCE_ROOT,
    tokenTarget: {
      componentKind: "token",
      targetId: "project-token",
      abi: [],
      constructorArguments: [],
      initializer: null,
    },
  });
  assert.deepEqual(arbitrary.projectMetadata.tokenMetadataBinding.name, {
    staticSource: "not-deterministically-extractable",
    argumentIndex: null,
    argumentName: null,
  });
  assert.deepEqual(arbitrary.projectMetadata.tokenMetadataBinding.symbol, {
    staticSource: "not-deterministically-extractable",
    argumentIndex: null,
    argumentName: null,
  });
});

test("project metadata rejects noncanonical token text, URLs and content-address paths", async () => {
  const missingImage = metadataInput();
  missingImage.presentation.image = null;
  await assert.rejects(
    buildProjectMetadata(missingImage, {
      sourceRoot: METADATA_SOURCE_ROOT,
      tokenTarget: tokenTarget(),
    }),
    /projectMetadata\.presentation\.image must name a non-empty local/u,
  );

  const shortDescription = metadataInput();
  shortDescription.presentation.description = "Short placeholder";
  await assert.rejects(
    buildProjectMetadata(shortDescription, {
      sourceRoot: METADATA_SOURCE_ROOT,
      tokenTarget: tokenTarget(),
    }),
    /projectMetadata\.presentation\.description.*at least 20 UTF-8 bytes/u,
  );

  for (const [links, expected] of [
    [[{ kind: "x", uri: "https://x.com/hookatelier" }], /exactly one website link/u],
    [[{ kind: "website", uri: "https://atelier.example/" }], /exactly one x link/u],
  ]) {
    const missingRequiredLink = metadataInput();
    missingRequiredLink.presentation.links = links;
    await assert.rejects(
      buildProjectMetadata(missingRequiredLink, {
        sourceRoot: METADATA_SOURCE_ROOT,
        tokenTarget: tokenTarget(),
      }),
      expected,
    );
  }

  const legacyTwitterLink = metadataInput();
  legacyTwitterLink.presentation.links[1].uri = "https://twitter.com/hookatelier";
  await assert.rejects(
    buildProjectMetadata(legacyTwitterLink, {
      sourceRoot: METADATA_SOURCE_ROOT,
      tokenTarget: tokenTarget(),
    }),
    /canonical X profile URL like https:\/\/x\.com\/project_handle/u,
  );

  for (const input of [
    metadataInput({ name: " Café Hook 🪝" }),
    metadataInput({ name: "Hook\nAtelier" }),
    metadataInput({ name: "Hook\u0085Atelier" }),
    metadataInput({ name: "Hook\ud800Atelier" }),
    metadataInput({ symbol: "ATELIER " }),
    metadataInput({ symbol: "😀😀😀😀😀" }),
  ]) {
    await assert.rejects(
      buildProjectMetadata(input, { sourceRoot: METADATA_SOURCE_ROOT, tokenTarget: tokenTarget() }),
      /canonical public token metadata/u,
    );
  }

  const c1Description = metadataInput();
  c1Description.presentation.description = "Project\u0085description";
  await assert.rejects(
    buildProjectMetadata(c1Description, {
      sourceRoot: METADATA_SOURCE_ROOT,
      tokenTarget: tokenTarget(),
    }),
    /canonical public text/u,
  );

  for (const secret of [
    "PROGRAMMABLE_API_KEY=do-not-bind-secrets",
    "programmable_api_key=do-not-bind-secrets",
    `pm_live_${"A".repeat(22)}_${"B".repeat(43)}`,
    "-----BEGIN PRIVATE KEY-----",
    `github_pat_${"A".repeat(20)}`,
    `ghp_${"A".repeat(20)}`,
    `sk-live_${"A".repeat(20)}`,
    `AKIA${"A".repeat(16)}`,
    "eyJabcdefgh.eyJabcdefgh.abcdefgh",
    "api_key=do-not-bind-secrets",
  ]) {
    const secretDescription = metadataInput();
    secretDescription.presentation.description = secret;
    await assert.rejects(
      buildProjectMetadata(secretDescription, {
        sourceRoot: METADATA_SOURCE_ROOT,
        tokenTarget: tokenTarget(),
      }),
      /canonical public text/u,
    );
  }

  const encodedSecretLink = metadataInput();
  const rawProgrammableKey = `pm_live_${"A".repeat(22)}_${"B".repeat(43)}`;
  encodedSecretLink.presentation.links = [{
    kind: "website",
    uri: `https://atelier.example/path/${encodeURIComponent(rawProgrammableKey)}`,
  }];
  await assert.rejects(
    buildProjectMetadata(encodedSecretLink, {
      sourceRoot: METADATA_SOURCE_ROOT,
      tokenTarget: tokenTarget(),
    }),
    /invalid|credential-like/u,
  );

  const noncanonicalLink = metadataInput();
  noncanonicalLink.presentation.links = [{ kind: "website", uri: "https://atelier.example" }];
  await assert.rejects(
    buildProjectMetadata(noncanonicalLink, {
      sourceRoot: METADATA_SOURCE_ROOT,
      tokenTarget: tokenTarget(),
    }),
    /not canonical/u,
  );

  const invalidBinding = structuredClone(HASH_VECTOR_METADATA);
  invalidBinding.tokenMetadataBinding.name = {
    staticSource: "constructor-argument",
    argumentIndex: 0,
    argumentName: " _name",
  };
  assert.throws(
    () => validateProjectMetadata(invalidBinding),
    /static ABI argumentName is invalid/u,
  );

  const unsafeIndexBinding = structuredClone(HASH_VECTOR_METADATA);
  unsafeIndexBinding.tokenMetadataBinding.name = {
    staticSource: "constructor-argument",
    argumentIndex: Number.MAX_SAFE_INTEGER + 1,
    argumentName: "_name",
  };
  assert.throws(
    () => validateProjectMetadata(unsafeIndexBinding),
    /static ABI source is invalid/u,
  );

  const loneSurrogateBinding = structuredClone(HASH_VECTOR_METADATA);
  loneSurrogateBinding.tokenMetadataBinding.name = {
    staticSource: "constructor-argument",
    argumentIndex: 0,
    argumentName: "_name\ud800",
  };
  assert.throws(
    () => validateProjectMetadata(loneSurrogateBinding),
    /static ABI argumentName is invalid/u,
  );

  const c1Binding = structuredClone(HASH_VECTOR_METADATA);
  c1Binding.tokenMetadataBinding.name = {
    staticSource: "constructor-argument",
    argumentIndex: 0,
    argumentName: "_name\u0085",
  };
  assert.throws(
    () => validateProjectMetadata(c1Binding),
    /static ABI argumentName is invalid/u,
  );

  const invalidNondeterministicBinding = structuredClone(HASH_VECTOR_METADATA);
  invalidNondeterministicBinding.tokenMetadataBinding.name = {
    staticSource: "not-deterministically-extractable",
    argumentIndex: 0,
    argumentName: "_name",
  };
  assert.throws(
    () => validateProjectMetadata(invalidNondeterministicBinding),
    /nondeterministic source must use null ABI leaves/u,
  );

  const secretArgumentBinding = structuredClone(HASH_VECTOR_METADATA);
  secretArgumentBinding.tokenMetadataBinding.name = {
    staticSource: "constructor-argument",
    argumentIndex: 0,
    argumentName: `pm_live_${"A".repeat(22)}_${"B".repeat(43)}`,
  };
  assert.throws(
    () => validateProjectMetadata(secretArgumentBinding),
    /static ABI argumentName is invalid/u,
  );

  const secretTargetBinding = structuredClone(HASH_VECTOR_METADATA);
  secretTargetBinding.tokenMetadataBinding.tokenTargetId =
    `pm_live_${"A".repeat(22)}_${"B".repeat(43)}`;
  assert.throws(
    () => validateProjectMetadata(secretTargetBinding),
    /tokenMetadataBinding is invalid/u,
  );

  for (const uri of [
    "https://project.local/",
    "https://localhost./",
    "https://sub.localhost./",
  ]) {
    const localLink = metadataInput();
    localLink.presentation.links = [{ kind: "website", uri }];
    await assert.rejects(
      buildProjectMetadata(localLink, {
        sourceRoot: METADATA_SOURCE_ROOT,
        tokenTarget: tokenTarget(),
      }),
      /public credential-free HTTPS/u,
    );
  }

  const c1Link = metadataInput();
  c1Link.presentation.links = [{
    kind: "website",
    uri: "https://atelier.example/\u0085",
  }];
  await assert.rejects(
    buildProjectMetadata(c1Link, {
      sourceRoot: METADATA_SOURCE_ROOT,
      tokenTarget: tokenTarget(),
    }),
    /is invalid/u,
  );

  for (const encodedControl of ["%0A", "%250A", "%25250A"]) {
    const controlLink = metadataInput();
    controlLink.presentation.links = [{
      kind: "website",
      uri: `https://atelier.example/${encodedControl}`,
    }];
    await assert.rejects(
      buildProjectMetadata(controlLink, {
        sourceRoot: METADATA_SOURCE_ROOT,
        tokenTarget: tokenTarget(),
      }),
      /is invalid/u,
    );
  }

  const encodedControlImage = structuredClone(HASH_VECTOR_METADATA);
  encodedControlImage.presentation.image = {
    uri: "https://atelier.example/%0A",
    contentSha256: `sha256:${"11".repeat(32)}`,
    mediaType: "image/png",
    byteLength: 1,
    width: 1,
    height: 1,
  };
  assert.throws(
    () => validateProjectMetadata(encodedControlImage),
    /image URI is invalid/u,
  );
});

function metadataInput({ name = "Café Hook 🪝", symbol = "ATELIER" } = {}) {
  return {
    schemaVersion: "programmable.project-metadata-input.v1",
    token: { name, symbol },
    presentation: {
      description: "Project-owned token and hook\nExact public source",
      image: {
        sourcePath: "assets/token.png",
        uri: "ipfs://QmYwAPJzv5CZsnAzt8auVZRnGi1Wm4eQNf6gMss5QZb7S6",
      },
      links: [
        { kind: "website", uri: "https://atelier.example/" },
        { kind: "x", uri: "https://x.com/hookatelier" },
      ],
    },
  };
}

function tokenTarget() {
  return {
    componentKind: "token",
    targetId: "project-token",
    abi: [
      {
        type: "constructor",
        inputs: [
          { name: "_name", type: "string" },
          { name: "_symbol", type: "string" },
        ],
      },
      {
        type: "function",
        name: "name",
        inputs: [],
        outputs: [{ name: "", type: "string" }],
      },
      {
        type: "function",
        name: "symbol",
        inputs: [],
        outputs: [{ name: "", type: "string" }],
      },
    ],
    constructorArguments: ["Café Hook 🪝", "ATELIER"],
    initializer: null,
  };
}

function hashVectorTarget(targetId, componentKind, saltByte, declaredHookPermissions = null) {
  return {
    targetId,
    applicantSalt: `0x${saltByte.repeat(32)}`,
    creationBytecode: "0x6000",
    constructorArguments: "0x",
    initializerCalldata: "0x",
    constructorAddressLocators: [],
    initializerAddressLocators: [],
    deploymentValueWei: "0",
    initializerValueWei: "0",
    expectedRuntimeCodeHash: `0x${"44".repeat(32)}`,
    componentKind,
    declaredHookPermissions,
  };
}
