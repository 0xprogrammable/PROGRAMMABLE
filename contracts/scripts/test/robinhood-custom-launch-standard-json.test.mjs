import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_COMPILER_PROFILE,
  ROBINHOOD_STANDARD_JSON_ARTIFACTS,
  assertPinnedCompilerProfile,
  assertSourceClosureMatchesCheckout,
  canonicalJsonBytes,
  readBoundedRobinhoodCompilerResponse,
  resolveRobinhoodReproductionCompiler,
  robinhoodReproductionCompilerLayout,
  sha256Hex,
  validateCanonicalStandardJsonBytes,
  verifyCompiledCommitments,
  verifyRobinhoodStandardJsonInputs,
} from "../robinhood-custom-launch-standard-json-core.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
let verifiedPromise;

function verified() {
  verifiedPromise ??= verifyRobinhoodStandardJsonInputs();
  return verifiedPromise;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function artifactBytes(artifact) {
  return readFile(path.join(repositoryRoot, artifact.path));
}

test("compiles both canonical inputs and preserves every deployment commitment", async () => {
  const result = await verified();
  assert.deepEqual(result.buildCompiler, result.profile.compiler);
  const { source: reproductionSource, ...reproductionCompiler } =
    result.reproductionCompiler;
  const reproductionLayout = robinhoodReproductionCompilerLayout();
  const selectedCompiler = reproductionLayout.candidates.find(
    ({ source }) => source === reproductionSource,
  ) ?? {
    binaryLabel: reproductionLayout.binaryLabel,
    binarySha256: reproductionLayout.binarySha256,
  };
  assert.ok(selectedCompiler);
  assert.deepEqual(reproductionCompiler, {
    role: "platform-reproduction-compiler",
    version: "0.8.26+commit.8a97fa7a",
    versionLine:
      process.platform === "darwin"
        ? "Version: 0.8.26+commit.8a97fa7a.Darwin.appleclang"
        : "Version: 0.8.26+commit.8a97fa7a.Linux.g++",
    platform: process.platform,
    architecture: process.arch,
    binaryLabel: selectedCompiler.binaryLabel,
    binarySha256: selectedCompiler.binarySha256,
  });
  assert.ok(
    [
      "foundry-svm-cache",
      "solc-select-cache",
      "official-solidity-binary-download",
      "profile-build-compiler",
    ].includes(reproductionSource),
  );
  assert.equal(
    result.artifacts.graphFactory.sha256,
    "0x8ab811a215d70b1d5aef0c71a47153173953ee78d7632725413833888369ec4d",
  );
  assert.equal(result.artifacts.graphFactory.sources, 1);
  assert.equal(
    result.artifacts.router.sha256,
    "0x6abca24d06b013599f4ff63e049976419c3f17455fa9bc343b15ec0d6e6a078a",
  );
  assert.equal(result.artifacts.router.sources, 52);
  assert.deepEqual(result.ownerTransaction, {
    dataHash:
      "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9",
    dataBytes: 33_412,
  });
});

test("pins the exact hosted Linux compiler layout without PATH or env selection", async () => {
  const layout = robinhoodReproductionCompilerLayout({
    platform: "linux",
    architecture: "x64",
    homeDirectory: "/home/runner",
  });
  assert.deepEqual(
    layout.candidates.map(({ source, path: candidatePath }) => ({
      source,
      path: candidatePath,
    })),
    [
      {
        source: "foundry-svm-cache",
        path: "/home/runner/.svm/0.8.26/solc-0.8.26",
      },
      {
        source: "solc-select-cache",
        path: "/home/runner/.solc-select/artifacts/solc-0.8.26/solc-0.8.26",
      },
    ],
  );
  assert.ok(
    layout.candidates.every(
      ({ binarySha256 }) => binarySha256 === layout.binarySha256,
    ),
  );
  assert.equal(
    layout.binarySha256,
    "0xd5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef",
  );
  assert.equal(
    layout.downloadUrl,
    "https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-v0.8.26+commit.8a97fa7a",
  );
  const coreBytes = await readFile(
    path.join(
      repositoryRoot,
      "contracts/scripts/robinhood-custom-launch-standard-json-core.mjs",
    ),
    "utf8",
  );
  assert.doesNotMatch(coreBytes, /ROBINHOOD_SOLC_0_8_26_PATH/u);
  assert.doesNotMatch(coreBytes, /\bsolcPath\b/u);
});

test("fails closed when every fixed hosted compiler candidate is missing", async () => {
  const homeDirectory = await mkdtemp(
    path.join(os.tmpdir(), "robinhood-solc-missing-"),
  );
  try {
    await assert.rejects(
      resolveRobinhoodReproductionCompiler(
        { compiler: EXPECTED_COMPILER_PROFILE },
        {
          platform: "linux",
          architecture: "x64",
          homeDirectory,
          allowDownload: false,
        },
      ),
      /unavailable in fixed local candidates/iu,
    );
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("fails closed on a wrong binary at the fixed hosted compiler path", async () => {
  const homeDirectory = await mkdtemp(
    path.join(os.tmpdir(), "robinhood-solc-wrong-"),
  );
  try {
    const candidate = path.join(homeDirectory, ".svm/0.8.26/solc-0.8.26");
    await mkdir(path.dirname(candidate), { recursive: true });
    await writeFile(candidate, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await assert.rejects(
      resolveRobinhoodReproductionCompiler(
        { compiler: EXPECTED_COMPILER_PROFILE },
        {
          platform: "linux",
          architecture: "x64",
          homeDirectory,
          allowDownload: false,
        },
      ),
      /candidate SHA-256 drift/iu,
    );
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("rejects symlinked and oversized fixed compiler candidates before reading bytes", async () => {
  for (const invalid of ["symlink", "oversized"]) {
    const homeDirectory = await mkdtemp(
      path.join(os.tmpdir(), `robinhood-solc-${invalid}-`),
    );
    try {
      const candidate = path.join(homeDirectory, ".svm/0.8.26/solc-0.8.26");
      await mkdir(path.dirname(candidate), { recursive: true });
      if (invalid === "symlink") {
        const target = path.join(homeDirectory, "untrusted-solc");
        await writeFile(target, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
        await symlink(target, candidate);
        await assert.rejects(
          resolveRobinhoodReproductionCompiler(
            { compiler: EXPECTED_COMPILER_PROFILE },
            {
              platform: "linux",
              architecture: "x64",
              homeDirectory,
              allowDownload: false,
            },
          ),
          /candidate is unreadable/iu,
        );
      } else {
        await writeFile(candidate, "x", { mode: 0o700 });
        const handle = await open(candidate, "r+");
        try {
          await handle.truncate(128 * 1024 * 1024 + 1);
        } finally {
          await handle.close();
        }
        await assert.rejects(
          resolveRobinhoodReproductionCompiler(
            { compiler: EXPECTED_COMPILER_PROFILE },
            {
              platform: "linux",
              architecture: "x64",
              homeDirectory,
              allowDownload: false,
            },
          ),
          /file type or size is invalid/iu,
        );
      }
    } finally {
      await rm(homeDirectory, { recursive: true, force: true });
    }
  }
});

test("bounds official compiler responses and rejects every invalid download", async () => {
  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(9));
      controller.close();
    },
  });
  await assert.rejects(
    readBoundedRobinhoodCompilerResponse(new Response(oversizedStream), 8),
    /response is too large/iu,
  );

  const homeDirectory = await mkdtemp(
    path.join(os.tmpdir(), "robinhood-solc-download-invalid-"),
  );
  try {
    const options = {
      platform: "linux",
      architecture: "x64",
      homeDirectory,
    };
    await assert.rejects(
      resolveRobinhoodReproductionCompiler(
        { compiler: EXPECTED_COMPILER_PROFILE },
        {
          ...options,
          fetchImplementation: async () =>
            new Response("unavailable", { status: 503 }),
        },
      ),
      /download failed/iu,
    );
    await assert.rejects(
      resolveRobinhoodReproductionCompiler(
        { compiler: EXPECTED_COMPILER_PROFILE },
        {
          ...options,
          fetchImplementation: async () =>
            new Response("x", {
              headers: { "content-length": "134217729" },
            }),
        },
      ),
      /response length is invalid/iu,
    );
    await assert.rejects(
      resolveRobinhoodReproductionCompiler(
        { compiler: EXPECTED_COMPILER_PROFILE },
        {
          ...options,
          fetchImplementation: async () => new Response("wrong compiler"),
        },
      ),
      /downloaded reproduction solc binary SHA-256 drift/iu,
    );
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("materializes an exact official download and leaves explicit cleanup ownership", async (context) => {
  const layout = robinhoodReproductionCompilerLayout();
  let officialBytes;
  for (const candidate of layout.candidates) {
    if (candidate.binarySha256 !== layout.binarySha256) continue;
    try {
      officialBytes = await readFile(candidate.path);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
    }
  }
  if (!officialBytes) {
    context.skip("official compiler cache is unavailable in this environment");
    return;
  }
  assert.equal(sha256Hex(officialBytes), layout.binarySha256);

  const homeDirectory = await mkdtemp(
    path.join(os.tmpdir(), "robinhood-solc-download-success-"),
  );
  let resolved;
  try {
    resolved = await resolveRobinhoodReproductionCompiler(
      { compiler: EXPECTED_COMPILER_PROFILE },
      {
        platform: process.platform,
        architecture: process.arch,
        homeDirectory,
        fetchImplementation: async () => new Response(officialBytes),
      },
    );
    assert.equal(
      resolved.attestation.source,
      "official-solidity-binary-download",
    );
    assert.equal(sha256Hex(await readFile(resolved.path)), layout.binarySha256);
    assert.equal((await lstat(resolved.path)).isFile(), true);
  } finally {
    if (resolved?.cleanupDirectory) {
      await rm(resolved.cleanupDirectory, { recursive: true, force: true });
      await assert.rejects(lstat(resolved.cleanupDirectory), /ENOENT/iu);
    }
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("rejects a source-byte mutation even when reserialized canonically", async () => {
  const artifact = ROBINHOOD_STANDARD_JSON_ARTIFACTS.router;
  const input = JSON.parse(await artifactBytes(artifact));
  input.sources[artifact.sourceUnit].content += " ";
  const mutatedBytes = canonicalJsonBytes(input);
  const parsed = validateCanonicalStandardJsonBytes(
    mutatedBytes,
    {
      ...artifact,
      sourceSha256: sha256Hex(
        Buffer.from(input.sources[artifact.sourceUnit].content),
      ),
    },
    sha256Hex(mutatedBytes),
  );
  await assert.rejects(
    assertSourceClosureMatchesCheckout(parsed, artifact),
    /tracked source byte drift/iu,
  );
});

test("rejects a compiler-setting mutation independently of its file hash", async () => {
  const artifact = ROBINHOOD_STANDARD_JSON_ARTIFACTS.graphFactory;
  const input = JSON.parse(await artifactBytes(artifact));
  input.settings.optimizer.runs = 999;
  const mutatedBytes = canonicalJsonBytes(input);
  assert.throws(
    () =>
      validateCanonicalStandardJsonBytes(
        mutatedBytes,
        artifact,
        sha256Hex(mutatedBytes),
      ),
    /compiler settings drift/iu,
  );
});

test("rejects a compiler-binary pin mutation", async () => {
  const result = await verified();
  const compiler = clone(result.profile.compiler);
  compiler.binarySha256 =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.throws(
    () => assertPinnedCompilerProfile(compiler),
    /compiler pin drift/iu,
  );
});

test("rejects a Router constructor-input mutation after exact compilation", async () => {
  const result = await verified();
  const deployment = clone(result.deployment);
  deployment.contracts.programmableLaunchStampRouter.constructor[2] =
    "0x1111111111111111111111111111111111111111";
  assert.throws(
    () =>
      verifyCompiledCommitments({
        profile: result.profile,
        deployment,
        compilations: result.compilations,
      }),
    /constructor input drift/iu,
  );
});
