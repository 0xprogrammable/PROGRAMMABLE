import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

import {
  REQUIRED_RETIRED_SAFE_SALT_COMMITMENTS,
  assertCompleteRetiredSaltInventory,
  generatePredictionRoleEntries,
} from "../generate-custom-registry-v2-safe-prediction-inputs.mjs";
import {
  assertCanonicalTransactionJournalPath,
  assertNoExistingTransactionIntent,
  canonicalTransactionJournalPath,
} from "../custom-registry-v2-release-evidence.mjs";

const scripts = path.resolve(import.meta.dirname, "..");
const writeFile = (filePath, bytes, options = {}) =>
  fsWriteFile(filePath, bytes, { mode: 0o600, ...options });
const durableTestDirectory = () =>
  mkdtemp(path.join(os.homedir(), ".programmable-registry-v2-test-"));
const run = (name, args = [], env = {}) =>
  spawnSync(process.execPath, [path.join(scripts, name), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

test("broadcast CLI requires explicit broadcast intent", () => {
  const result = run("broadcast-custom-registry-v2-deployment.mjs");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /explicit --broadcast is required/);
});

test("both production transaction stagers use protected Keychain custody instead of private-key environment variables", async () => {
  const keychainSource = await readFile(
    path.join(scripts, "custom-registry-v2-keychain-custody.mjs"),
    "utf8",
  );
  assert.match(keychainSource, /default-keychain/u);
  assert.match(keychainSource, /list-keychains/u);
  assert.match(keychainSource, /find-generic-password/u);
  assert.doesNotMatch(keychainSource, /"-k"/u);
  assert.match(keychainSource, /sole search target/u);
  for (const name of [
    "stage-custom-registry-v2-safe-transaction.mjs",
    "stage-custom-registry-v2-deployment-transaction.mjs",
  ]) {
    const source = await readFile(path.join(scripts, name), "utf8");
    assert.match(source, /readDefaultUserKeychainItem/u);
    assert.doesNotMatch(source, /process\.env\.[A-Z0-9_]*PRIVATE_KEY/);
    assert.doesNotMatch(source, /createWalletClient/);
    assert.doesNotMatch(
      source,
      /createPublicClient|sendRawTransaction|\bfetch\s*\(/u,
    );
  }
});

test("both broadcasters require explicit exact-hash dispatch-intent activation", async () => {
  for (const name of [
    "broadcast-custom-registry-v2-safe-controllers.mjs",
    "broadcast-custom-registry-v2-deployment.mjs",
  ]) {
    const source = await readFile(path.join(scripts, name), "utf8");
    assert.match(source, /--activate-dispatch-intent/u);
    assert.match(source, /DISPATCH_INTENT_ACTIVATED/u);
    assert.match(source, /workflowCancellationAllowed:\s*false/u);
    assert.ok(
      source.indexOf("DISPATCH_INTENT_ACTIVATED") <
        source.lastIndexOf("sendRawTransaction"),
    );
    assert.ok(
      source.indexOf("if (receipt)") < source.indexOf("const discoveryTime"),
    );
  }
});

test("Safe prediction input generator binds each owner and produces fresh distinct salts", async () => {
  const source = await readFile(
    path.join(
      scripts,
      "generate-custom-registry-v2-safe-prediction-inputs.mjs",
    ),
    "utf8",
  );
  assert.match(source, /randomBytesFunction\(32\)/u);
  assert.match(source, /randomBytesFunction\s*=\s*randomBytes/u);
  assert.match(source, /REGISTRY_RETIRED_SAFE_SALT_COMMITMENTS/u);
  assert.match(source, /generatedAfterPublicSourceAndApprovalPolicyFreeze/u);
  assert.match(source, /custom-registry-v2-production-policy\.json/u);
  assert.match(source, /productionPolicySha256/u);
  assert.doesNotMatch(source, /Math\.random/u);
  assert.equal(REQUIRED_RETIRED_SAFE_SALT_COMMITMENTS.length, 4);
  assert.throws(
    () => assertCompleteRetiredSaltInventory(new Set()),
    /inventory is incomplete/u,
  );
  assert.doesNotThrow(() =>
    assertCompleteRetiredSaltInventory(
      new Set(REQUIRED_RETIRED_SAFE_SALT_COMMITMENTS),
    ),
  );
  let next = 0;
  const owners = [1, 2, 3, 4].map(
    (value) => `0x${value.toString(16).padStart(40, "0")}`,
  );
  const entries = generatePredictionRoleEntries({
    owners,
    retiredSaltCommitments: new Set(),
    randomBytesFunction: () => Buffer.alloc(32, ++next),
  });
  assert.deepEqual(
    entries.map(({ role, owner }) => ({ role, owner })),
    ["approver", "registrar", "finalizer", "revoker"].map((role, index) => ({
      role,
      owner: owners[index],
    })),
  );
  assert.equal(new Set(entries.map(({ saltNonce }) => saltNonce)).size, 4);
});

test("Safe prediction input generator rejects a wrong Approval policy environment commitment", () => {
  const result = run(
    "generate-custom-registry-v2-safe-prediction-inputs.mjs",
    [
      "--generate-fresh-prediction-inputs",
      "--output",
      path.join(os.tmpdir(), "must-not-write-safe-prediction-inputs.json"),
    ],
    {
      REGISTRY_SOURCE_COMMIT: "a".repeat(40),
      REGISTRY_SOURCE_TREE: "b".repeat(40),
      REGISTRY_APPROVAL_POLICY_COMMITMENT: `0x${"00".repeat(32)}`,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match the production policy/u);
});

test("persistent release evidence lock excludes concurrent writers and recovers after process death", async () => {
  const directory = await durableTestDirectory();
  await import("node:fs/promises").then(({ chmod }) => chmod(directory, 0o700));
  const helper = path.join(scripts, "custom-registry-v2-release-evidence.mjs");
  const target = path.join(directory, "journal.jsonl");
  const code = `import { acquireReleaseEvidenceLock } from ${JSON.stringify(helper)}; await acquireReleaseEvidenceLock(${JSON.stringify(target)}); process.stdout.write("LOCKED\\n"); setInterval(() => {}, 1000);`;
  const owner = spawn(process.execPath, ["--input-type=module", "-e", code], {
    env: { ...process.env, REGISTRY_RELEASE_EVIDENCE_ROOT: directory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      owner.stdout.once("data", (bytes) =>
        bytes.toString().includes("LOCKED")
          ? resolve()
          : reject(new Error("lock owner did not start")),
      );
      owner.once("error", reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const contender = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        code.replace("setInterval(() => {}, 1000);", ""),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, REGISTRY_RELEASE_EVIDENCE_ROOT: directory },
      },
    );
    assert.notEqual(contender.status, 0);
    assert.match(contender.stderr, /another live release process/u);
    owner.kill("SIGKILL");
    await new Promise((resolve) => owner.once("close", resolve));
    const recovered = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        code.replace("setInterval(() => {}, 1000);", ""),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, REGISTRY_RELEASE_EVIDENCE_ROOT: directory },
      },
    );
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, /LOCKED/u);
    const raceCode = code.replace(
      "setInterval(() => {}, 1000);",
      "setTimeout(() => {}, 1000);",
    );
    const contenders = Array.from({ length: 12 }, () =>
      spawn(process.execPath, ["--input-type=module", "-e", raceCode], {
        env: { ...process.env, REGISTRY_RELEASE_EVIDENCE_ROOT: directory },
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    const results = await Promise.all(
      contenders.map(
        (child) =>
          new Promise((resolve) => {
            let stdout = "";
            child.stdout.on("data", (bytes) => {
              stdout += bytes.toString();
            });
            child.once("close", (status) => resolve({ status, stdout }));
          }),
      ),
    );
    assert.equal(
      results.filter(
        ({ status, stdout }) => status === 0 && stdout.includes("LOCKED"),
      ).length,
      1,
    );
  } finally {
    if (owner.exitCode === null) owner.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("one canonical signer-and-nonce journal is the durable intent tombstone", async () => {
  const directory = await durableTestDirectory();
  await import("node:fs/promises").then(({ chmod }) => chmod(directory, 0o700));
  const previous = process.env.REGISTRY_RELEASE_EVIDENCE_ROOT;
  process.env.REGISTRY_RELEASE_EVIDENCE_ROOT = directory;
  try {
    const signer = "0x1111111111111111111111111111111111111111";
    const journal = canonicalTransactionJournalPath({
      chainId: 1,
      signer,
      nonce: 7,
    });
    assert.doesNotThrow(() =>
      assertNoExistingTransactionIntent({ chainId: 1, signer, nonce: 7 }),
    );
    assert.equal(
      assertCanonicalTransactionJournalPath({
        candidate: journal,
        chainId: 1,
        signer,
        nonce: 7,
        mustExist: false,
      }),
      journal,
    );
    assert.throws(
      () =>
        assertCanonicalTransactionJournalPath({
          candidate: path.join(directory, "operator-selected.jsonl"),
          chainId: 1,
          signer,
          nonce: 7,
          mustExist: false,
        }),
      /canonical signer-and-nonce/u,
    );
    await writeFile(journal, "{}\n");
    assert.throws(
      () => assertNoExistingTransactionIntent({ chainId: 1, signer, nonce: 7 }),
      /existing durable transaction intent/u,
    );
  } finally {
    if (previous === undefined)
      delete process.env.REGISTRY_RELEASE_EVIDENCE_ROOT;
    else process.env.REGISTRY_RELEASE_EVIDENCE_ROOT = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("broadcast CLI rejects a wrong authorization digest before any RPC or key use", async () => {
  const directory = await durableTestDirectory();
  await import("node:fs/promises").then(({ chmod }) => chmod(directory, 0o700));
  try {
    const planPath = path.join(directory, "preflight.json");
    const authorizationPath = path.join(directory, "authorization.json");
    const planBytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion: "programmable.custom-registry-deployment-preflight.v4",
        status: "PREFLIGHT_ONLY_NO_TRANSACTION",
        chainId: 1,
        broadcastAllowed: false,
        signingAllowed: false,
        createdAtTimestamp: Math.floor(Date.now() / 1000),
        expiresAtTimestamp: Math.floor(Date.now() / 1000) + 60,
      })}\n`,
    );
    await writeFile(planPath, planBytes);
    await writeFile(authorizationPath, "{}\n");
    const result = run(
      "broadcast-custom-registry-v2-deployment.mjs",
      [
        "--broadcast",
        "--activate-dispatch-intent",
        `0x${"99".repeat(32)}`,
        "--output",
        path.join(directory, "journal.jsonl"),
      ],
      {
        REGISTRY_RELEASE_EVIDENCE_ROOT: directory,
        REGISTRY_REVIEWED_PLAN_PATH: planPath,
        REGISTRY_REVIEWED_PLAN_SHA256: `0x${createHash("sha256").update(planBytes).digest("hex")}`,
        REGISTRY_BROADCAST_AUTHORIZATION_PATH: authorizationPath,
        REGISTRY_BROADCAST_AUTHORIZATION_SHA256: `0x${"11".repeat(32)}`,
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /broadcast authorization digest mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("authorize CLI rejects stale and constructor-spliced preflights", async () => {
  const directory = await durableTestDirectory();
  await import("node:fs/promises").then(({ chmod }) => chmod(directory, 0o700));
  try {
    const owner = "0xc7fB6d0d2b78A30D0D3599F7F4BAd5c9b87665AF";
    const base = {
      schemaVersion: "programmable.custom-registry-deployment-preflight.v4",
      status: "PREFLIGHT_ONLY_NO_TRANSACTION",
      chainId: 1,
      broadcastAllowed: false,
      signingAllowed: false,
      rpcProviders: ["provider-a", "provider-b"],
      rpcProviderBindings: [
        { providerId: "provider-a", rpcOrigin: "https://rpc-a.example" },
        { providerId: "provider-b", rpcOrigin: "https://rpc-b.example" },
      ],
      createdAtTimestamp: Math.floor(Date.now() / 1000) - 10,
      releaseAuthorization: {
        owner,
        maximumDispatchIntentAuthorizationValiditySeconds: 300,
        authorizationSemantics:
          "EXACT_RAW_TRANSACTION_HASH_AUTHORIZED_DURABLE_DISPATCH_INTENT_ACTIVATES_LATER_IDENTICAL_RAW_SEND_REBROADCAST_AND_INCLUSION_NO_WORKFLOW_CANCELLATION",
      },
      constructor: {
        initialAdminDelay: "10",
        initialAdmin: "0x0000000000000000000000000000000000000001",
        initialApprover: "0x0000000000000000000000000000000000000002",
        initialRegistrar: "0x0000000000000000000000000000000000000003",
        initialFinalizer: "0x0000000000000000000000000000000000000004",
        initialRevoker: "0x0000000000000000000000000000000000000005",
        minimumFinalityBlocks: "64",
        registryPolicyCommitment: `0x${"44".repeat(32)}`,
      },
      constructorCommitment: `0x${"11".repeat(32)}`,
    };
    const stalePath = path.join(directory, "stale.json");
    const safePath = path.join(directory, "safe.json");
    const safeBytes = Buffer.from("{}\n");
    await writeFile(safePath, safeBytes);
    await writeFile(
      stalePath,
      `${JSON.stringify({ ...base, expiresAtTimestamp: 1 })}\n`,
    );
    const commonEnv = {
      REGISTRY_RELEASE_EVIDENCE_ROOT: directory,
      REGISTRY_RELEASE_OWNER: owner,
      REGISTRY_DISPATCH_INTENT_EXPIRES_AT: String(
        Math.floor(Date.now() / 1000) + 60,
      ),
      REGISTRY_SAFE_VERIFICATION_PATH: safePath,
      REGISTRY_SAFE_VERIFICATION_SHA256: `0x${createHash("sha256").update(safeBytes).digest("hex")}`,
    };
    const stale = run(
      "authorize-custom-registry-v2-deployment.mjs",
      ["--preflight", stalePath, "--print-message"],
      commonEnv,
    );
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /preflight plan is stale or invalid/);

    const splicedPath = path.join(directory, "spliced.json");
    await writeFile(
      splicedPath,
      `${JSON.stringify({ ...base, expiresAtTimestamp: Math.floor(Date.now() / 1000) + 60 })}\n`,
    );
    const spliced = run(
      "authorize-custom-registry-v2-deployment.mjs",
      ["--preflight", splicedPath, "--print-message"],
      commonEnv,
    );
    assert.notEqual(spliced.status, 0);
    assert.match(
      spliced.stderr,
      /source manifest|source identity|Safe controller|constructor commitment|preflight plan/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("source verifier review freezes exact standard-json without submitting", async () => {
  const directory = await durableTestDirectory();
  await import("node:fs/promises").then(({ chmod }) => chmod(directory, 0o700));
  try {
    const root = path.resolve(scripts, "../..");
    const commit = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim();
    const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim();
    const artifact = JSON.parse(
      await readFile(
        path.join(
          root,
          "contracts/out/ProgrammableCustomRegistryV2.sol/ProgrammableCustomRegistryV2.json",
        ),
      ),
    );
    const onchainPath = path.join(directory, "onchain.json");
    const onchainBytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion:
          "programmable.custom-registry-deployment-verification.v2",
        status: "VERIFIED_FINALIZED_ONCHAIN_AWAITING_SOURCE",
        verified: false,
        chainId: 1,
        source: { commit, tree },
        contractAddress: "0x0000000000000000000000000000000000000001",
        transactionHash: `0x${"11".repeat(32)}`,
        runtimeCodeKeccak256: `0x${"22".repeat(32)}`,
        constructorArguments: "0x",
      })}\n`,
    );
    await writeFile(onchainPath, onchainBytes);
    const planPath = path.join(directory, "plan.json");
    const planBytes = Buffer.from(
      `${JSON.stringify({
        source: { commit, tree },
        expectedTransaction: { input: artifact.bytecode.object },
      })}\n`,
    );
    await writeFile(planPath, planBytes);
    const result = run("verify-custom-registry-v2-source.mjs", [], {
      REGISTRY_RELEASE_EVIDENCE_ROOT: directory,
      REGISTRY_ONCHAIN_VERIFICATION_PATH: onchainPath,
      REGISTRY_ONCHAIN_VERIFICATION_SHA256: `0x${createHash("sha256").update(onchainBytes).digest("hex")}`,
      REGISTRY_REVIEWED_PLAN_PATH: planPath,
      REGISTRY_REVIEWED_PLAN_SHA256: `0x${createHash("sha256").update(planBytes).digest("hex")}`,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /REVIEW_ONLY_NO_EXTERNAL_ACTION/);
    assert.match(result.stdout, /standardJsonSha256/);
    const activeOutput = path.join(directory, "active-source.json");
    const active = run(
      "verify-custom-registry-v2-source.mjs",
      ["--capture", "--output", activeOutput],
      {
        REGISTRY_RELEASE_EVIDENCE_ROOT: directory,
        REGISTRY_ONCHAIN_VERIFICATION_PATH: onchainPath,
        REGISTRY_ONCHAIN_VERIFICATION_SHA256: `0x${createHash("sha256").update(onchainBytes).digest("hex")}`,
        REGISTRY_REVIEWED_PLAN_PATH: planPath,
        REGISTRY_REVIEWED_PLAN_SHA256: `0x${createHash("sha256").update(planBytes).digest("hex")}`,
      },
    );
    assert.notEqual(active.status, 0);
    assert.match(
      active.stderr,
      /exact clean reviewed source|fresh full onchain release verification/u,
    );
    await assert.rejects(() => readFile(activeOutput), /ENOENT/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("final source verification rejects self-authored forged sidecars without the full release trust root", async () => {
  const directory = await durableTestDirectory();
  await import("node:fs/promises").then(({ chmod }) => chmod(directory, 0o700));
  try {
    const forgedOnchainPath = path.join(directory, "onchain.json");
    const forgedSourcePath = path.join(directory, "source.json");
    const forgedOnchainBytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion:
          "programmable.custom-registry-deployment-verification.v2",
        status: "VERIFIED_FINALIZED_ONCHAIN_AWAITING_SOURCE",
        verified: false,
        chainId: 1,
        source: { commit: "a".repeat(40), tree: "b".repeat(40) },
        contractAddress: "0x0000000000000000000000000000000000000001",
        transactionHash: `0x${"11".repeat(32)}`,
        runtimeCodeKeccak256: `0x${"22".repeat(32)}`,
        constructorArguments: "0x",
      })}\n`,
    );
    const forgedSourceBytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion: "programmable.custom-registry-source-verification.v3",
        status:
          "SELF_COMPILED_ETHERSCAN_VERIFIED_SOURCE_EXACT_CLOSURE_SOURCIFY_V2_EXACT",
        verified: true,
      })}\n`,
    );
    await writeFile(forgedOnchainPath, forgedOnchainBytes);
    await writeFile(forgedSourcePath, forgedSourceBytes);
    const outputPath = path.join(directory, "final.json");
    const result = run(
      "verify-custom-registry-v2-deployment.mjs",
      ["--finalize-source", "--output", outputPath],
      {
        REGISTRY_RELEASE_EVIDENCE_ROOT: directory,
        REGISTRY_ONCHAIN_VERIFICATION_PATH: forgedOnchainPath,
        REGISTRY_ONCHAIN_VERIFICATION_SHA256: `0x${createHash("sha256").update(forgedOnchainBytes).digest("hex")}`,
        REGISTRY_SOURCE_VERIFICATION_PATH: forgedSourcePath,
        REGISTRY_SOURCE_VERIFICATION_SHA256: `0x${createHash("sha256").update(forgedSourceBytes).digest("hex")}`,
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /fresh full onchain release verification failed/u,
    );
    await assert.rejects(() => readFile(outputPath), /ENOENT/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
