import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAnonymousGitHubExactObjectResolverV1,
  GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1,
  runBoundedExactGitProcessV1
} from "../github-exact-object-resolver.mjs";
import { GitHubPublicSourceError } from "../github-public-source-core.mjs";

const TREE_A = "b".repeat(40);
const TREE_B = "c".repeat(40);
const SPECIAL_PATH = "src/! #*?[] trailing /file ";

function gitObjectId(type, bytes) {
  return createHash("sha1")
    .update(`${type} ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

function makeFixture(options = {}) {
  const expectedTree = options.expectedTree ?? TREE_A;
  const commitTree = options.commitTree ?? expectedTree;
  const commitBytes = Buffer.from(`tree ${commitTree}\n\nresolver fixture\n`, "utf8");
  const revisionObjectId = gitObjectId("commit", commitBytes);
  const files = new Map(
    options.files ?? [
      ["contracts/Hook.sol", { mode: "100644", bytes: Buffer.from("contract Hook {}\n") }],
      [SPECIAL_PATH, { mode: "100755", bytes: Buffer.from("special literal path\n") }]
    ]
  );
  for (const value of files.values()) {
    value.objectId ??= gitObjectId("blob", value.bytes);
  }
  const request = {
    repositoryUri: "https://github.com/example/project",
    revisionObjectId,
    treeObjectId: expectedTree,
    paths: [...files.keys()].reverse(),
    timeoutMs: 10_000,
    maximumFileBytes: GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumFileBytes,
    maximumTotalBytes: GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTotalBytes
  };
  return { expectedTree, commitBytes, revisionObjectId, files, request };
}

function createFakeGit(fixture, options = {}) {
  const calls = [];
  const sparseSelections = [];
  let gitDirectory = null;

  const runGit = async (call) => {
    calls.push({
      ...call,
      args: [...call.args],
      env: { ...call.env },
      input: call.input === null ? null : Buffer.from(call.input)
    });
    const parsed = parseGitInvocation(call.args);
    const success = (stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), status = 0) => ({
      status,
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(stderr),
      timedOut: false,
      outputExceeded: false,
      temporaryBytesExceeded: false,
      fileSizeExceeded: false,
      addressSpaceExceeded: false,
      cpuExceeded: false
    });

    if (options.timeoutPhase === parsed.command) {
      return { ...success(), status: 1, timedOut: true };
    }
    if (options.outputExceededPhase === parsed.command) {
      return { ...success(), status: 1, outputExceeded: true };
    }
    if (options.resourceExceededPhase === parsed.command) {
      return { ...success(), status: 1, [options.resourceExceededFlag]: true };
    }
    if (options.oversizeTemporaryPhase === parsed.command) {
      const objectDirectory = path.join(parsed.gitDirectory, "objects", "pack");
      fs.mkdirSync(objectDirectory, { recursive: true });
      const packPath = path.join(objectDirectory, "oversized.pack");
      fs.writeFileSync(packPath, "x");
      fs.truncateSync(packPath, GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTemporaryRepositoryBytes + 1);
      return success();
    }
    if (parsed.command === "--version") {
      return success(`git version ${options.gitVersion ?? "2.50.1"}\n`);
    }
    if (parsed.command === "backfill" && parsed.arguments[0] === "-h") {
      if (options.capabilityAvailable === false) {
        return success("", "git: 'backfill' is not a git command\n", 1);
      }
      return success("", "usage: git backfill [--sparse]\n", 129);
    }
    if (options.failurePhase === parsed.command) {
      return success("", options.failureStderr ?? "untrusted upstream failure\n", 1);
    }
    if (parsed.command === "init") {
      gitDirectory = parsed.arguments.at(-1);
      fs.mkdirSync(path.join(gitDirectory, "info"), { recursive: true });
      return success();
    }
    if (parsed.command === "fetch") return success();
    if (parsed.command === "ls-tree") {
      const records = [...fixture.files.entries()]
        .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
        .map(([filePath, entry]) => Buffer.concat([
          Buffer.from(`${entry.mode} ${entry.type ?? "blob"} ${entry.objectId}\t`, "ascii"),
          Buffer.from(filePath, "utf8"),
          Buffer.from([0])
        ]));
      return success(Buffer.concat(records));
    }
    if (parsed.command === "backfill" && parsed.arguments[0] === "--sparse") {
      sparseSelections.push(fs.readFileSync(path.join(gitDirectory, "info", "sparse-checkout"), "utf8"));
      return success();
    }
    if (parsed.command === "cat-file" && parsed.arguments[0] === "--batch") {
      const objectIds = inputLines(call.input);
      if (objectIds.length === 1 && objectIds[0] === fixture.revisionObjectId) {
        return success(batchObject(fixture.revisionObjectId, "commit", fixture.commitBytes));
      }
      const byObjectId = new Map([...fixture.files.values()].map((entry) => [entry.objectId, entry]));
      return success(Buffer.concat(objectIds.map((objectId) => {
        const entry = byObjectId.get(objectId);
        return batchObject(objectId, "blob", entry?.returnedBytes ?? entry?.bytes ?? Buffer.alloc(0));
      })));
    }
    if (parsed.command === "cat-file" && parsed.arguments[0].startsWith("--batch-check=")) {
      const objectIds = inputLines(call.input);
      if (objectIds.length === 1 && objectIds[0] === fixture.expectedTree) {
        return success(`${fixture.expectedTree} tree 123\n`);
      }
      const byObjectId = new Map([...fixture.files.values()].map((entry) => [entry.objectId, entry]));
      return success(objectIds.map((objectId) => {
        const entry = byObjectId.get(objectId);
        const size = entry?.reportedSize ?? entry?.bytes.length ?? 0;
        return `${objectId} ${entry?.reportedType ?? "blob"} ${size}\n`;
      }).join(""));
    }
    return success("", "unexpected fake git invocation\n", 1);
  };

  return { calls, runGit, sparseSelections, get gitDirectory() { return gitDirectory; } };
}

function parseGitInvocation(args) {
  let index = 0;
  while (args[index] === "-c") index += 2;
  let gitDirectory = null;
  if (args[index] === "-C") {
    gitDirectory = args[index + 1];
    index += 2;
  }
  return { gitDirectory, command: args[index], arguments: args.slice(index + 1) };
}

function inputLines(input) {
  return Buffer.from(input ?? Buffer.alloc(0)).toString("ascii").trim().split("\n").filter(Boolean);
}

function batchObject(objectId, type, bytes) {
  return Buffer.concat([
    Buffer.from(`${objectId} ${type} ${bytes.length}\n`, "ascii"),
    bytes,
    Buffer.from("\n", "ascii")
  ]);
}

async function assertResolverError(promise, code, messagePattern = null) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof GitHubPublicSourceError);
    assert.equal(error.code, code);
    if (messagePattern !== null) assert.match(error.message, messagePattern);
    return true;
  });
}

test("resolves exact regular blobs through literal sparse backfill and raw batch reads", async () => {
  const fixture = makeFixture();
  const fake = createFakeGit(fixture);
  const resolver = createAnonymousGitHubExactObjectResolverV1({ runGit: fake.runGit });

  const result = await resolver(fixture.request);

  assert.deepEqual([...result.records.keys()], ["contracts/Hook.sol", SPECIAL_PATH]);
  assert.equal(result.records.get("contracts/Hook.sol").mode, "100644");
  assert.equal(result.records.get(SPECIAL_PATH).mode, "100755");
  assert.deepEqual(result.records.get(SPECIAL_PATH).bytes, Buffer.from("special literal path\n"));
  assert.equal(
    fake.sparseSelections[0],
    "/contracts/Hook.sol\n/src/\\!\\ \\#\\*\\?\\[\\]\\ trailing\\ /file\\ \n"
  );

  const invocations = fake.calls.map((call) => parseGitInvocation(call.args));
  assert.deepEqual(invocations.map((entry) => entry.command), [
    "--version",
    "backfill",
    "init",
    "fetch",
    "cat-file",
    "cat-file",
    "ls-tree",
    "backfill",
    "cat-file",
    "cat-file"
  ]);
  assert.ok(invocations.find((entry) => entry.command === "fetch").arguments.includes("--filter=blob:none"));
  assert.ok(invocations.some((entry) => entry.command === "backfill" && entry.arguments[0] === "--sparse"));
  assert.equal(invocations.some((entry) => ["checkout", "worktree", "submodule"].includes(entry.command)), false);
  assert.equal(fake.calls.some((call) => call.args.includes("--filters")), false);

  for (const call of fake.calls) {
    assert.equal("HOME" in call.env, false);
    assert.equal("GH_TOKEN" in call.env, false);
    assert.equal("GITHUB_TOKEN" in call.env, false);
    assert.equal("SSH_AUTH_SOCK" in call.env, false);
    assert.equal(call.env.GIT_CONFIG_NOSYSTEM, "1");
    assert.equal(call.env.GIT_CONFIG_GLOBAL, "/dev/null");
    assert.equal(call.env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(call.env.LANG, "C");
    assert.equal(call.env.LC_ALL, "C");
    assert.equal(call.env.LC_CTYPE, "C");
    assert.ok(call.args.includes("protocol.version=2"));
    assert.ok(call.args.includes("protocol.ext.allow=never"));
    assert.ok(call.args.includes("protocol.ssh.allow=never"));
    assert.ok(call.args.includes("core.deltaBaseCacheLimit=16m"));
    assert.ok(call.args.includes("core.packedGitWindowSize=16m"));
    assert.ok(call.args.includes("core.packedGitLimit=64m"));
    assert.ok(call.args.includes("pack.deltaCacheLimit=16m"));
    assert.ok(call.args.includes("pack.windowMemory=32m"));
    assert.ok(call.args.includes("pack.threads=1"));
    assert.ok(call.args.includes("index.threads=1"));
    assert.equal(call.maximumFileSizeBytes, GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTemporaryFileBytes);
    assert.equal(call.maximumAddressSpaceBytes, GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumAddressSpaceBytes);
    assert.equal(call.maximumCpuSeconds, GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumCpuSeconds);
  }
  const contentReads = fake.calls.filter((call) => {
    const parsed = parseGitInvocation(call.args);
    return parsed.command === "cat-file" || parsed.command === "ls-tree";
  });
  assert.ok(contentReads.every((call) => call.env.GIT_NO_LAZY_FETCH === "1"));
  const networkBackfill = fake.calls.find((call) => {
    const parsed = parseGitInvocation(call.args);
    return parsed.command === "backfill" && parsed.arguments[0] === "--sparse";
  });
  assert.equal(networkBackfill.env.GIT_NO_LAZY_FETCH, undefined);
  assert.equal(fs.existsSync(path.dirname(fake.gitDirectory)), false);
});

test("the same isolated exact-object flow is supported on macOS and Linux hosts", async (t) => {
  for (const platform of ["darwin", "linux"]) {
    await t.test(platform, async () => {
      const fixture = makeFixture({
        files: [["src/Hook.sol", { mode: "100644", bytes: Buffer.from("contract Hook {}\n") }]]
      });
      const fake = createFakeGit(fixture);
      const resolver = createAnonymousGitHubExactObjectResolverV1({ platform, runGit: fake.runGit });
      const result = await resolver(fixture.request);
      assert.deepEqual([...result.records.keys()], ["src/Hook.sol"]);
      assert.equal(result.records.get("src/Hook.sol").mode, "100644");
    });
  }
});

test("closed input and hard limits reject unsafe requests before invoking Git", async () => {
  const fixture = makeFixture();
  const fake = createFakeGit(fixture);
  const resolver = createAnonymousGitHubExactObjectResolverV1({ runGit: fake.runGit });
  const invalidRequests = [
    { ...fixture.request, repositoryUri: "http://github.com/example/project" },
    { ...fixture.request, repositoryUri: "https://github.com/Example/project" },
    { ...fixture.request, revisionObjectId: "A".repeat(40) },
    { ...fixture.request, treeObjectId: "b".repeat(39) },
    { ...fixture.request, paths: ["src/e\u0301.sol"] },
    { ...fixture.request, paths: ["src/Hook.sol", "src/Hook.sol"] },
    { ...fixture.request, paths: Array.from({ length: 513 }, (_, index) => `src/file-${index}.sol`) },
    { ...fixture.request, maximumFileBytes: GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumFileBytes + 1 },
    { ...fixture.request, maximumTotalBytes: GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTotalBytes + 1 },
    { ...fixture.request, unexpected: true }
  ];

  for (const request of invalidRequests) {
    await assertResolverError(resolver(request), "INVALID_REQUEST");
  }
  assert.equal(fake.calls.length, 0);
});

test("requires the minimum Git version and backfill capability without a per-blob fallback", async (t) => {
  const fixture = makeFixture();
  await t.test("old Git", async () => {
    const fake = createFakeGit(fixture, { gitVersion: "2.48.9" });
    const resolver = createAnonymousGitHubExactObjectResolverV1({ runGit: fake.runGit });
    await assertResolverError(
      resolver(fixture.request),
      "GITHUB_UPSTREAM_REJECTED",
      /^Exact Git object tooling is unavailable: Git 2\.49\.0 or newer is required$/u
    );
    assert.deepEqual(fake.calls.map((call) => parseGitInvocation(call.args).command), ["--version"]);
  });
  await t.test("missing backfill", async () => {
    const fake = createFakeGit(fixture, { capabilityAvailable: false });
    const resolver = createAnonymousGitHubExactObjectResolverV1({ runGit: fake.runGit });
    await assertResolverError(
      resolver(fixture.request),
      "GITHUB_UPSTREAM_REJECTED",
      /^Exact Git object tooling is unavailable: git backfill --sparse is required$/u
    );
    assert.deepEqual(fake.calls.map((call) => parseGitInvocation(call.args).command), ["--version", "backfill"]);
  });
});

test("fails closed on unsupported platforms before invoking Git", async () => {
  const fixture = makeFixture();
  const fake = createFakeGit(fixture);
  const resolver = createAnonymousGitHubExactObjectResolverV1({ platform: "win32", runGit: fake.runGit });

  await assertResolverError(
    resolver(fixture.request),
    "GITHUB_UPSTREAM_REJECTED",
    /^Exact Git object tooling is unavailable: this resolver supports macOS and Linux only$/u
  );
  assert.equal(fake.calls.length, 0);
});

test("binds the exact commit to the expected root tree", async () => {
  const fixture = makeFixture({ expectedTree: TREE_A, commitTree: TREE_B });
  const fake = createFakeGit(fixture);
  const resolver = createAnonymousGitHubExactObjectResolverV1({ runGit: fake.runGit });

  await assertResolverError(resolver(fixture.request), "GITHUB_TREE_MISMATCH");
  assert.equal(fs.existsSync(path.dirname(fake.gitDirectory)), false);
});

test("rejects symlinks, gitlinks and other non-regular tree entries", async () => {
  for (const entry of [
    { mode: "120000", type: "blob", bytes: Buffer.from("../secret") },
    { mode: "160000", type: "commit", bytes: Buffer.alloc(0) },
    { mode: "040000", type: "tree", bytes: Buffer.alloc(0) }
  ]) {
    const fixture = makeFixture({ files: [["src/value", entry]] });
    const fake = createFakeGit(fixture);
    const resolver = createAnonymousGitHubExactObjectResolverV1({ runGit: fake.runGit });
    await assertResolverError(resolver(fixture.request), "GITHUB_DECLARED_PATH_NOT_FOUND");
  }
});

test("rejects Git LFS pointers after object-id verification", async () => {
  const pointer = Buffer.from([
    "version https://git-lfs.github.com/spec/v1",
    `oid sha256:${"a".repeat(64)}`,
    "size 12345",
    ""
  ].join("\n"));
  const fixture = makeFixture({ files: [["src/Hook.sol", { mode: "100644", bytes: pointer }]] });
  const fake = createFakeGit(fixture);
  const resolver = createAnonymousGitHubExactObjectResolverV1({ runGit: fake.runGit });

  await assertResolverError(resolver(fixture.request), "GITHUB_DECLARED_PATH_NOT_FOUND", /Git LFS pointer/u);
});

test("checks per-file and aggregate sizes before reading raw blob bodies", async () => {
  const tooLargeFixture = makeFixture({
    files: [["src/Hook.sol", { mode: "100644", bytes: Buffer.from("small"), reportedSize: 11 }]]
  });
  tooLargeFixture.request.maximumFileBytes = 10;
  tooLargeFixture.request.maximumTotalBytes = 20;
  const tooLargeFake = createFakeGit(tooLargeFixture);
  const tooLargeResolver = createAnonymousGitHubExactObjectResolverV1({ runGit: tooLargeFake.runGit });
  await assertResolverError(tooLargeResolver(tooLargeFixture.request), "GITHUB_RESPONSE_TOO_LARGE");
  assert.equal(
    tooLargeFake.calls.filter((call) => {
      const parsed = parseGitInvocation(call.args);
      return parsed.command === "cat-file" && parsed.arguments[0] === "--batch";
    }).length,
    1
  );

  const aggregateFixture = makeFixture({
    files: [
      ["src/A.sol", { mode: "100644", bytes: Buffer.from("123456") }],
      ["src/B.sol", { mode: "100644", bytes: Buffer.from("abcdef") }]
    ]
  });
  aggregateFixture.request.maximumFileBytes = 10;
  aggregateFixture.request.maximumTotalBytes = 10;
  const aggregateFake = createFakeGit(aggregateFixture);
  const aggregateResolver = createAnonymousGitHubExactObjectResolverV1({ runGit: aggregateFake.runGit });
  await assertResolverError(aggregateResolver(aggregateFixture.request), "GITHUB_RESPONSE_TOO_LARGE");
});

test("recomputes every returned blob object id", async () => {
  const original = Buffer.from("trusted bytes\n");
  const fixture = makeFixture({
    files: [["src/Hook.sol", {
      mode: "100644",
      bytes: original,
      returnedBytes: Buffer.from("tampered bytes\n")
    }]]
  });
  const fake = createFakeGit(fixture);
  const resolver = createAnonymousGitHubExactObjectResolverV1({ runGit: fake.runGit });

  await assertResolverError(resolver(fixture.request), "GITHUB_PROTOCOL_ERROR", /object id/u);
});

test("maps timeout and bounded-output failures to existing public resolver errors", async () => {
  const fixture = makeFixture();
  const timeoutFake = createFakeGit(fixture, { timeoutPhase: "fetch" });
  const timeoutResolver = createAnonymousGitHubExactObjectResolverV1({ runGit: timeoutFake.runGit });
  await assertResolverError(timeoutResolver(fixture.request), "GITHUB_TIMEOUT");
  assert.equal(fs.existsSync(path.dirname(timeoutFake.gitDirectory)), false);

  const outputFake = createFakeGit(fixture, { outputExceededPhase: "ls-tree" });
  const outputResolver = createAnonymousGitHubExactObjectResolverV1({ runGit: outputFake.runGit });
  await assertResolverError(outputResolver(fixture.request), "GITHUB_RESPONSE_TOO_LARGE");
  assert.equal(fs.existsSync(path.dirname(outputFake.gitDirectory)), false);

  const storageFake = createFakeGit(fixture, { oversizeTemporaryPhase: "fetch" });
  const storageResolver = createAnonymousGitHubExactObjectResolverV1({ runGit: storageFake.runGit });
  await assertResolverError(storageResolver(fixture.request), "GITHUB_RESPONSE_TOO_LARGE", /temporary object storage/u);
  assert.equal(fs.existsSync(path.dirname(storageFake.gitDirectory)), false);

  const memoryFake = createFakeGit(fixture, {
    resourceExceededPhase: "fetch",
    resourceExceededFlag: "addressSpaceExceeded"
  });
  const memoryResolver = createAnonymousGitHubExactObjectResolverV1({ runGit: memoryFake.runGit });
  await assertResolverError(memoryResolver(fixture.request), "GITHUB_RESPONSE_TOO_LARGE", /bounded process resources/u);
  assert.equal(fs.existsSync(path.dirname(memoryFake.gitDirectory)), false);
});

test("smart-HTTP failures remain system errors and never expose Git stderr", async () => {
  const fixture = makeFixture();
  const secret = "credential=https://token@example.invalid";
  const fetchFake = createFakeGit(fixture, { failurePhase: "fetch", failureStderr: secret });
  const fetchResolver = createAnonymousGitHubExactObjectResolverV1({ runGit: fetchFake.runGit });
  await assertResolverError(fetchResolver(fixture.request), "GITHUB_UNAVAILABLE", /REST-verified exact commit/u);

  const backfillFake = createFakeGit(fixture, { failurePhase: "backfill", failureStderr: secret });
  const backfillResolver = createAnonymousGitHubExactObjectResolverV1({ runGit: backfillFake.runGit });
  await assert.rejects(backfillResolver(fixture.request), (error) => {
    assert.ok(error instanceof GitHubPublicSourceError);
    assert.equal(error.code, "GITHUB_UPSTREAM_REJECTED");
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test("an oversized temporary pack is killed, cleaned up, and never leaks stderr", async (t) => {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    t.skip("POSIX-only resolver");
    return;
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable pack cap "));
  const temporaryRoot = path.join(fixtureRoot, "temporary");
  const fakeExecutable = path.join(fixtureRoot, "fake git pack.sh");
  const processPidPath = path.join(fixtureRoot, "process.pid");
  fs.mkdirSync(temporaryRoot);
  const secret = "credential=https://token@example.invalid";
  const script = `#!/bin/bash
previous=""
penultimate=""
git_directory=""
expect_git_directory=0
saw_fetch=0
saw_init=0
for argument in "$@"; do
  penultimate="$previous"
  previous="$argument"
  if [[ "$expect_git_directory" == "1" ]]; then
    git_directory="$argument"
    expect_git_directory=0
  elif [[ "$argument" == "-C" ]]; then
    expect_git_directory=1
  fi
  [[ "$argument" == "fetch" ]] && saw_fetch=1
  [[ "$argument" == "init" ]] && saw_init=1
done
if [[ "$previous" == "--version" ]]; then
  printf 'git version 2.50.1\\n'
  exit 0
fi
if [[ "$penultimate" == "backfill" && "$previous" == "-h" ]]; then
  printf 'usage: git backfill [--sparse]\\n' >&2
  exit 129
fi
if [[ "$saw_init" == "1" ]]; then
  mkdir -p "$previous/info"
  exit 0
fi
if [[ "$saw_fetch" == "1" && -n "$git_directory" ]]; then
  trap '' TERM HUP
  printf '%s\\n' "$$" > ${shellQuote(processPidPath)}
  pack_directory="$git_directory/objects/pack"
  mkdir -p "$pack_directory"
  dd if=/dev/zero of="$pack_directory/oversized-a.pack" bs=1048576 count=34 2>/dev/null
  dd if=/dev/zero of="$pack_directory/oversized-b.pack" bs=1048576 count=34 2>/dev/null
  printf '%s' ${shellQuote(secret)} >&2
  while :; do sleep 1; done
fi
exit 1
`;
  fs.writeFileSync(fakeExecutable, script, { encoding: "utf8", mode: 0o700 });
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const fixture = makeFixture();
  const resolver = createAnonymousGitHubExactObjectResolverV1({
    gitExecutable: fakeExecutable,
    temporaryDirectoryRoot: temporaryRoot
  });
  await assert.rejects(resolver(fixture.request), (error) => {
    assert.ok(error instanceof GitHubPublicSourceError);
    assert.equal(error.code, "GITHUB_RESPONSE_TOO_LARGE");
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  assert.equal(fs.existsSync(processPidPath), true);
  await waitForProcessExit(Number(fs.readFileSync(processPidPath, "utf8").trim()));
  assert.deepEqual(fs.readdirSync(temporaryRoot), []);
});

test("bounded runner enforces hard file and output limits", async (t) => {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    t.skip("POSIX-only resolver");
    return;
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable exact limits "));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const oversizedPath = path.join(fixtureRoot, "oversized.pack");
  const fileWriter = writeExecutable(fixtureRoot, "write-too-much.sh", [
    "#!/bin/bash",
    `dd if=/dev/zero of=${shellQuote(oversizedPath)} bs=1048576 count=4 status=none`,
    ""
  ].join("\n"));
  const fileResult = await runBoundedExactGitProcessV1(boundedRunnerOptions(fixtureRoot, fileWriter, {
    maximumFileSizeBytes: 64 * 1024
  }));
  assert.notEqual(fileResult.status, 0);
  assert.equal(fileResult.fileSizeExceeded, true);
  assert.ok(fs.statSync(oversizedPath).size <= 64 * 1024);

  const outputWriter = writeExecutable(fixtureRoot, "write-output.sh", [
    "#!/bin/bash",
    "while :; do printf 'untrusted-output-0123456789\\n'; done",
    ""
  ].join("\n"));
  const outputResult = await runBoundedExactGitProcessV1(boundedRunnerOptions(fixtureRoot, outputWriter, {
    maximumOutputBytes: 8 * 1024
  }));
  assert.equal(outputResult.outputExceeded, true);
  assert.equal(outputResult.cpuExceeded, false);
  assert.ok(outputResult.stdout.length + outputResult.stderr.length <= 8 * 1024);
});

test("bounded runner kills a TERM-resistant process tree on timeout", async (t) => {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    t.skip("POSIX-only resolver");
    return;
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable exact timeout tree "));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const childPidPath = path.join(fixtureRoot, "child.pid");
  const executable = writeExecutable(fixtureRoot, "spawn-resistant-child.sh", [
    "#!/bin/bash",
    "trap '' TERM HUP",
    "sleep 30 &",
    `printf '%s\\n' "$!" > ${shellQuote(childPidPath)}`,
    "wait",
    ""
  ].join("\n"));
  const result = await runBoundedExactGitProcessV1(boundedRunnerOptions(fixtureRoot, executable, {
    timeoutMs: 250
  }));
  assert.equal(result.timedOut, true);
  assert.equal(result.cpuExceeded, false);
  await waitForProcessExit(Number(fs.readFileSync(childPidPath, "utf8").trim()));
});

test("bounded runner kills an orphaned helper after a successful leader exit", async (t) => {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    t.skip("POSIX-only resolver");
    return;
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable exact orphan tree "));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const childPidPath = path.join(fixtureRoot, "child.pid");
  const executable = writeExecutable(fixtureRoot, "leave-resistant-child.sh", [
    "#!/bin/bash",
    "trap '' TERM HUP",
    "sleep 30 </dev/null >/dev/null 2>&1 &",
    `printf '%s\\n' "$!" > ${shellQuote(childPidPath)}`,
    "exit 0",
    ""
  ].join("\n"));
  const result = await runBoundedExactGitProcessV1(boundedRunnerOptions(fixtureRoot, executable));
  assert.equal(result.status, 0);
  assert.equal(result.timedOut, false);
  await waitForProcessExit(Number(fs.readFileSync(childPidPath, "utf8").trim()));
});

test("bounded runner enforces the inherited CPU limit", async (t) => {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    t.skip("POSIX-only resolver");
    return;
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable exact cpu "));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const executable = writeExecutable(fixtureRoot, "consume-cpu.sh", [
    "#!/bin/bash",
    "while :; do :; done",
    ""
  ].join("\n"));
  const result = await runBoundedExactGitProcessV1(boundedRunnerOptions(fixtureRoot, executable, {
    maximumCpuSeconds: 1,
    timeoutMs: 5_000
  }));
  assert.notEqual(result.status, 0);
  assert.equal(result.cpuExceeded, true);
  assert.equal(result.timedOut, false);
});

test("bounded runner classifies an unrequested hard SIGKILL as a resource limit", async (t) => {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    t.skip("POSIX-only resolver");
    return;
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable exact hard kill "));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const executable = writeExecutable(fixtureRoot, "hard-kill.sh", [
    "#!/bin/bash",
    "kill -KILL $$",
    ""
  ].join("\n"));
  const result = await runBoundedExactGitProcessV1(boundedRunnerOptions(fixtureRoot, executable));
  assert.notEqual(result.status, 0);
  assert.equal(result.signal, "SIGKILL");
  assert.equal(result.cpuExceeded, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.outputExceeded, false);
  assert.equal(result.temporaryBytesExceeded, false);
});

test("Linux bounded runner hard-stops address-space expansion", {
  skip: process.platform !== "linux" || !fs.existsSync("/usr/bin/perl")
}, async (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable exact address space "));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const executable = writeExecutable(fixtureRoot, "expand-memory.pl", [
    "#!/usr/bin/perl",
    "my $payload = 'x' x (256 * 1024 * 1024);",
    "print STDERR 'allocation unexpectedly succeeded: ' . length($payload) . \"\\n\";",
    ""
  ].join("\n"));
  const result = await runBoundedExactGitProcessV1(boundedRunnerOptions(fixtureRoot, executable, {
    maximumAddressSpaceBytes: 96 * 1024 * 1024,
    maximumCpuSeconds: 4,
    timeoutMs: 5_000
  }));
  assert.notEqual(result.status, 0);
  assert.equal(result.addressSpaceExceeded, true);
  assert.doesNotMatch(result.stderr.toString("utf8"), /allocation unexpectedly succeeded/u);
});

test("default process runner uses the sanitized environment and no shell expansion", async (t) => {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    t.skip("POSIX-only resolver");
    return;
  }
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable fake git "));
  const fakeExecutable = path.join(fixtureRoot, "fake git tool; literal.sh");
  const logPath = path.join(fixtureRoot, "calls.tsv");
  const script = `#!/bin/bash
previous=""
penultimate=""
saw_init=0
for argument in "$@"; do
  penultimate="$previous"
  previous="$argument"
  [[ "$argument" == "init" ]] && saw_init=1
done
is_version=0
is_backfill_help=0
[[ "$previous" == "--version" ]] && is_version=1
[[ "$penultimate" == "backfill" && "$previous" == "-h" ]] && is_backfill_help=1
printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' \
  "$is_version" "$is_backfill_help" "$saw_init" \
  "\${HOME+x}" "\${GH_TOKEN+x}" "\${GITHUB_TOKEN+x}" "\${SSH_AUTH_SOCK+x}" \
  "$GIT_TERMINAL_PROMPT" "$GIT_CONFIG_GLOBAL" "$LANG" "$LC_ALL:$LC_CTYPE" \
  >> ${shellQuote(logPath)}
if [[ "$is_version" == "1" ]]; then
  printf 'git version 2.50.1\\n'
  exit 0
fi
if [[ "$is_backfill_help" == "1" ]]; then
  printf 'usage: git backfill [--sparse]\\n' >&2
  exit 129
fi
exit 1
`;
  fs.writeFileSync(fakeExecutable, script, { encoding: "utf8", mode: 0o700 });
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const resolver = createAnonymousGitHubExactObjectResolverV1({ gitExecutable: fakeExecutable });
  const fixture = makeFixture();
  await assertResolverError(
    resolver(fixture.request),
    "GITHUB_UPSTREAM_REJECTED",
    /^Exact Git object tooling is unavailable:/u
  );

  const calls = fs.readFileSync(logPath, "utf8").trim().split("\n").map((line) => {
    const fields = line.split("\t");
    assert.equal(fields.length, 11);
    return fields;
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.slice(0, 3)), [
    ["1", "0", "0"],
    ["0", "1", "0"],
    ["0", "0", "1"]
  ]);
  for (const call of calls) {
    assert.deepEqual(call.slice(3, 7), ["", "", "", ""]);
    assert.deepEqual(call.slice(7), ["0", "/dev/null", "C", "C:C"]);
  }
});

function boundedRunnerOptions(root, gitExecutable, overrides = {}) {
  return {
    gitExecutable,
    args: [],
    cwd: null,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      LANG: "C",
      LC_ALL: "C",
      LC_CTYPE: "C"
    },
    input: null,
    timeoutMs: 5_000,
    maximumOutputBytes: 65_536,
    monitoredDirectory: root,
    maximumTemporaryBytes: 2 * 1024 * 1024,
    maximumFileSizeBytes: GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTemporaryFileBytes,
    maximumAddressSpaceBytes: GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumAddressSpaceBytes,
    maximumCpuSeconds: 4,
    ...overrides
  };
}

function writeExecutable(root, name, source) {
  const target = path.join(root, name);
  fs.writeFileSync(target, source, { encoding: "utf8", mode: 0o700 });
  fs.chmodSync(target, 0o700);
  return target;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function waitForProcessExit(pid) {
  assert.ok(Number.isInteger(pid) && pid > 1);
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`descendant process ${pid} survived bounded process-group cleanup`);
}
