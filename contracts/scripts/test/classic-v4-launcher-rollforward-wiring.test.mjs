import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  loadClassicV4ReleaseArtifactContext,
  resolveClassicV4ReviewedReleaseWorktree,
  resolveClassicV4ReleaseValidation,
} from "../classic-v4-release-validation.mjs";
import { verifyClassicV4RollforwardBlockLineageAtEndpoint } from
  "../verify-classic-v4-mainnet-deployment.mjs";

const testPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(testPath), "..", "..", "..");
const hash = `0x${"11".repeat(32)}`;
const commit = "1".repeat(40);
const tree = "2".repeat(40);
const cleanToolIdentity = Object.freeze({
  topLevel: repositoryRoot,
  clean: true,
  detached: false,
  commit: "a".repeat(40),
  tree: "b".repeat(40),
});

test("release validation dispatch keeps legacy default and selects V4 rollforward explicitly", () => {
  const legacy = resolveClassicV4ReleaseValidation({ status: "simulation-only" });
  assert.equal(legacy.kind, "legacy");
  assert.equal(legacy.requireObservedBlock, true);
  assert.equal(legacy.sourceTargets.launcher.contractName, "MemeLaunchV3");

  const rollforward = resolveClassicV4ReleaseValidation({
    status: "launcher-rollforward-composite",
  });
  assert.equal(rollforward.kind, "launcher-rollforward");
  assert.equal(rollforward.requireObservedBlock, false);
  assert.equal(rollforward.sourceTargets.launcher.contractName, "MemeLaunchV4");
  assert.throws(
    () => rollforward.validateArtifacts({}, {}),
    /exact sealed validation context/,
  );
  assert.throws(
    () => resolveClassicV4ReleaseValidation({ status: "unknown" }),
    /Unsupported Classic V4 release plan status/,
  );
});

test("legacy artifact loading remains delegated to the original sealed loader", async () => {
  const plan = { status: "simulation-only" };
  const expected = { legacy: true };
  let calls = 0;
  const context = await loadClassicV4ReleaseArtifactContext(plan, {
    legacyLoader: async (received) => {
      calls += 1;
      assert.equal(received, plan);
      return expected;
    },
  });
  assert.equal(context.plan, plan);
  assert.equal(context.artifacts, expected);
  assert.equal(context.baseArtifacts, null);
  assert.equal(calls, 1);
});

test("rollforward artifact loading rejects Git or source-pin drift before building", async () => {
  const plan = {
    status: "launcher-rollforward-composite",
    releaseCommit: commit,
    releaseTree: tree,
    parentBundle: {
      launcherUpgrade: { plan: { sourcePinsDigest: hash } },
    },
  };
  let builds = 0;
  const build = async () => {
    builds += 1;
    return {};
  };
  await assert.rejects(
    loadClassicV4ReleaseArtifactContext(plan, {
      identityReader: async () => ({
        topLevel: repositoryRoot,
        clean: true,
        commit: "3".repeat(40),
        tree,
      }),
      sourcePinReader: async () => ({ digest: hash }),
      retainedArtifactBuilder: build,
      launcherArtifactBuilder: build,
      rollforwardPlanValidator: () => plan,
    }),
    /clean Git identity differs/,
  );
  await assert.rejects(
    loadClassicV4ReleaseArtifactContext(plan, {
      identityReader: async () => ({
        topLevel: repositoryRoot,
        clean: true,
        commit,
        tree,
      }),
      sourcePinReader: async () => ({ digest: `0x${"22".repeat(32)}` }),
      retainedArtifactBuilder: build,
      launcherArtifactBuilder: build,
      rollforwardPlanValidator: () => plan,
    }),
    /source pins differ/,
  );
  assert.equal(builds, 0);
});

test("reviewed release worktree must be absolute, real, clean and detached", async () => {
  const created = await mkdtemp(path.join(os.tmpdir(), "classic-v4-reviewed-"));
  const directory = await realpath(created);
  const symbolic = `${directory}-symbolic`;
  const identity = {
    topLevel: directory,
    clean: true,
    detached: true,
    commit,
    tree,
  };
  try {
    assert.deepEqual(
      await resolveClassicV4ReviewedReleaseWorktree(directory, {
        identityReader: async (root) => {
          assert.equal(root, directory);
          return identity;
        },
      }),
      { root: directory, identity },
    );
    await assert.rejects(
      resolveClassicV4ReviewedReleaseWorktree("relative/release", {
        identityReader: async () => identity,
      }),
      /path must be absolute/u,
    );
    await symlink(directory, symbolic);
    await assert.rejects(
      resolveClassicV4ReviewedReleaseWorktree(symbolic, {
        identityReader: async () => identity,
      }),
      /real canonical directory/u,
    );
    for (const changed of [
      { clean: false },
      { detached: false },
      { topLevel: path.dirname(directory) },
    ]) {
      await assert.rejects(
        resolveClassicV4ReviewedReleaseWorktree(directory, {
          identityReader: async () => ({ ...identity, ...changed }),
        }),
        /clean detached Git top level/u,
      );
    }
  } finally {
    await rm(symbolic, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("reviewed release worktree is checked against the exact sealed plan before builds", async () => {
  const created = await mkdtemp(path.join(os.tmpdir(), "classic-v4-seal-"));
  const directory = await realpath(created);
  const plan = {
    status: "launcher-rollforward-composite",
    releaseCommit: commit,
    releaseTree: tree,
    parentBundle: {
      launcherUpgrade: { plan: { sourcePinsDigest: hash } },
    },
  };
  let builds = 0;
  try {
    for (const changed of [
      { commit: "3".repeat(40) },
      { tree: "4".repeat(40) },
    ]) {
      await assert.rejects(
        loadClassicV4ReleaseArtifactContext(plan, {
          reviewedReleaseWorktree: directory,
          toolIdentityReader: async () => cleanToolIdentity,
          identityReader: async () => ({
            topLevel: directory,
            clean: true,
            detached: true,
            commit,
            tree,
            ...changed,
          }),
          sourcePinReader: async (root) => {
            assert.equal(root, directory);
            return { digest: hash };
          },
          retainedArtifactBuilder: async () => {
            builds += 1;
            return {};
          },
          launcherArtifactBuilder: async () => {
            builds += 1;
            return {};
          },
          rollforwardPlanValidator: () => plan,
        }),
        /clean Git identity differs/u,
      );
    }
    assert.equal(builds, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reviewed release builders use only reviewedRoot/contracts and recheck drift", async () => {
  const created = await mkdtemp(path.join(os.tmpdir(), "classic-v4-build-root-"));
  const directory = await realpath(created);
  const plan = {
    status: "launcher-rollforward-composite",
    releaseCommit: commit,
    releaseTree: tree,
    parentBundle: {
      launcherUpgrade: { plan: { sourcePinsDigest: hash } },
    },
  };
  const identity = {
    topLevel: directory,
    clean: true,
    detached: true,
    commit,
    tree,
  };
  try {
    const builderRoots = [];
    await assert.rejects(
      loadClassicV4ReleaseArtifactContext(plan, {
        reviewedReleaseWorktree: directory,
        toolIdentityReader: async () => cleanToolIdentity,
        identityReader: async () => identity,
        sourcePinReader: async (root) => {
          assert.equal(root, directory);
          return { digest: hash };
        },
        retainedArtifactBuilder: async ({ contractsDirectory }) => {
          builderRoots.push(contractsDirectory);
          throw new Error("reviewed builder stop");
        },
        launcherArtifactBuilder: async ({ contractsDirectory }) => {
          builderRoots.push(contractsDirectory);
          throw new Error("reviewed builder stop");
        },
        rollforwardPlanValidator: () => plan,
      }),
      /reviewed builder stop/u,
    );
    assert.deepEqual(builderRoots, [
      path.join(directory, "contracts"),
      path.join(directory, "contracts"),
    ]);

    let identityReads = 0;
    await assert.rejects(
      loadClassicV4ReleaseArtifactContext(plan, {
        reviewedReleaseWorktree: directory,
        toolIdentityReader: async () => cleanToolIdentity,
        identityReader: async () => {
          identityReads += 1;
          return identityReads === 1
            ? identity
            : { ...identity, commit: "5".repeat(40) };
        },
        sourcePinReader: async () => ({ digest: hash }),
        retainedArtifactBuilder: async () => ({}),
        launcherArtifactBuilder: async () => ({}),
        rollforwardPlanValidator: () => plan,
      }),
      /clean Git identity differs/u,
    );

    let pinReads = 0;
    await assert.rejects(
      loadClassicV4ReleaseArtifactContext(plan, {
        reviewedReleaseWorktree: directory,
        toolIdentityReader: async () => cleanToolIdentity,
        identityReader: async () => identity,
        sourcePinReader: async () => {
          pinReads += 1;
          return { digest: pinReads === 1 ? hash : `0x${"22".repeat(32)}` };
        },
        retainedArtifactBuilder: async () => ({}),
        launcherArtifactBuilder: async () => ({}),
        rollforwardPlanValidator: () => plan,
      }),
      /source pins differ/u,
    );

    await assert.rejects(
      loadClassicV4ReleaseArtifactContext(plan, {
        reviewedReleaseWorktree: directory,
        toolIdentityReader: async () => ({
          ...cleanToolIdentity,
          clean: false,
        }),
        identityReader: async () => identity,
        sourcePinReader: async () => ({ digest: hash }),
        retainedArtifactBuilder: async () => ({}),
        launcherArtifactBuilder: async () => ({}),
        rollforwardPlanValidator: () => plan,
      }),
      /lifecycle tool Git identity must be clean/u,
    );

    let toolIdentityReads = 0;
    await assert.rejects(
      loadClassicV4ReleaseArtifactContext(plan, {
        reviewedReleaseWorktree: directory,
        toolIdentityReader: async () => {
          toolIdentityReads += 1;
          return toolIdentityReads === 1
            ? cleanToolIdentity
            : { ...cleanToolIdentity, tree: "c".repeat(40) };
        },
        identityReader: async () => identity,
        sourcePinReader: async () => ({ digest: hash }),
        retainedArtifactBuilder: async () => ({}),
        launcherArtifactBuilder: async () => ({}),
        rollforwardPlanValidator: () => plan,
      }),
      /lifecycle tool changed during the sealed build/u,
    );
    assert.equal(toolIdentityReads, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rollforward artifact validation requires the exact explicit seal context", () => {
  const plan = { status: "launcher-rollforward-composite" };
  const artifacts = {};
  const baseArtifacts = {};
  const context = Object.freeze({ plan, artifacts, baseArtifacts });
  const validation = resolveClassicV4ReleaseValidation(plan);

  assert.throws(
    () => validation.validateArtifacts(plan, artifacts),
    /exact sealed validation context/,
  );
  assert.throws(
    () =>
      validation.validateArtifacts(
        structuredClone(plan),
        artifacts,
        context,
      ),
    /exact sealed validation context/,
  );
  assert.throws(
    () =>
      validation.validateArtifacts(
        plan,
        structuredClone(artifacts),
        context,
      ),
    /exact sealed validation context/,
  );
  assert.throws(
    () =>
      validation.validateArtifacts(
        { status: "launcher-rollforward-composite" },
        artifacts,
        context,
      ),
    /exact sealed validation context/,
  );
  assert.throws(
    () => validation.validateArtifacts(plan, artifacts, context),
    /launcher rollforward parent bundle keys differ/,
  );
});

test("rollforward common-head replay binds every parent block on both RPCs", async () => {
  const verificationBlock = 114;
  const verificationBlockHash = `0x${"aa".repeat(32)}`;
  const blocks = [
    [100, `0x${"01".repeat(32)}`],
    [101, `0x${"02".repeat(32)}`],
    [102, `0x${"03".repeat(32)}`],
    [103, `0x${"04".repeat(32)}`],
  ];
  const plan = {
    status: "launcher-rollforward-composite",
    parentBundle: {
      base: {
        plan: {
          observedAtBlock: blocks[0][0],
          observedAtBlockHash: blocks[0][1],
        },
        deploymentEvidence: {
          verificationBlock: blocks[1][0],
          verificationBlockHash: blocks[1][1],
        },
      },
      launcherUpgrade: {
        plan: {
          observedAtBlock: blocks[2][0],
          observedAtBlockHash: blocks[2][1],
        },
        receiptEvidence: {
          blockNumber: blocks[3][0],
          blockHash: blocks[3][1],
        },
        verificationEvidence: {
          verificationBlock,
          verificationBlockHash,
        },
      },
    },
  };
  const calls = [];
  const rpcClient = async (endpoint, method, params) => {
    assert.equal(method, "eth_getBlockByNumber");
    calls.push([endpoint, ...params]);
    const number = Number(BigInt(params[0]));
    const expected = blocks.find(([blockNumber]) => blockNumber === number);
    assert.ok(expected, `Unexpected historical block ${number}`);
    return {
      number: params[0],
      hash: expected[1],
    };
  };
  const endpoints = ["https://rpc-a.example", "https://rpc-b.example"];
  await Promise.all(
    endpoints.map((endpoint) =>
      verifyClassicV4RollforwardBlockLineageAtEndpoint({
        endpoint,
        plan,
        verificationBlock,
        verificationHead: { hash: verificationBlockHash },
        rpcClient,
      }),
    ),
  );
  assert.equal(calls.length, endpoints.length * blocks.length);
  for (const endpoint of endpoints) {
    assert.deepEqual(
      calls
        .filter(([calledEndpoint]) => calledEndpoint === endpoint)
        .map(([, blockTag, fullTransactions]) => [
          Number(BigInt(blockTag)),
          fullTransactions,
        ]),
      blocks.map(([blockNumber]) => [blockNumber, false]),
    );
  }
  await assert.rejects(
    verifyClassicV4RollforwardBlockLineageAtEndpoint({
      endpoint: endpoints[0],
      plan,
      verificationBlock: verificationBlock - 1,
      verificationHead: { hash: verificationBlockHash },
      rpcClient,
    }),
    /verification head differs from launcher upgrade finality evidence/,
  );
});

test("all lifecycle and manifest entry points use the shared release-kind dispatch", async () => {
  const contractScripts = [
    "capture-classic-v4-mainnet-release.mjs",
    "prepare-classic-v4-lifecycle-canary.mjs",
    "verify-classic-v4-lifecycle-canary.mjs",
    "verify-classic-v4-mainnet-deployment.mjs",
    "verify-classic-v4-mainnet-sources.mjs",
    "verify-classic-v4-release-prerequisites.mjs",
  ];
  for (const file of contractScripts) {
    const source = await readFile(
      path.join(repositoryRoot, "contracts/scripts", file),
      "utf8",
    );
    assert.match(source, /resolveClassicV4ReleaseValidation/);
  }
  for (const file of [
    ...contractScripts.filter(
      (name) => name !== "verify-classic-v4-release-prerequisites.mjs",
    ),
  ]) {
    const source = await readFile(
      path.join(repositoryRoot, "contracts/scripts", file),
      "utf8",
    );
    assert.match(source, /loadClassicV4ReleaseArtifactContext/);
    assert.match(source, /artifactContext/);
  }
  const lifecycleConsole = await readFile(
    path.join(repositoryRoot, "scripts/serve-classic-v4-lifecycle-canary.mjs"),
    "utf8",
  );
  assert.match(lifecycleConsole, /loadClassicV4ReleaseArtifactContext/);
  assert.match(lifecycleConsole, /artifactContext/);
  assert.match(lifecycleConsole, /resolveClassicV4ReleaseValidation/);

  const lifecycleVerifier = await readFile(
    path.join(
      repositoryRoot,
      "contracts/scripts/verify-classic-v4-lifecycle-canary.mjs",
    ),
    "utf8",
  );
  assert.match(
    lifecycleVerifier,
    /validateDeploymentEvidence:\s*releaseValidation\.validateDeploymentEvidence/,
  );
  assert.match(
    lifecycleVerifier,
    /validateSourceEvidence:\s*releaseValidation\.validateSourceEvidence/,
  );

  const capture = await readFile(
    path.join(
      repositoryRoot,
      "contracts/scripts/capture-classic-v4-mainnet-release.mjs",
    ),
    "utf8",
  );
  assert.match(capture, /releaseValidation\.createReleaseManifest/);

  const deploymentVerifier = await readFile(
    path.join(
      repositoryRoot,
      "contracts/scripts/verify-classic-v4-mainnet-deployment.mjs",
    ),
    "utf8",
  );
  assert.match(deploymentVerifier, /launchStampRouter/);
  assert.match(deploymentVerifier, /launcher canonical Router/);
});
