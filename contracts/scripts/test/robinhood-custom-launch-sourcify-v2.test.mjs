import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  lstat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { before } from "node:test";

import { keccak256 } from "viem";

import { canonicalizeJson } from "../../../packages/launch/src/canonical-json.mjs";
import {
  ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT,
  ROBINHOOD_SOURCIFY_LICENSE_NOTICE,
  ROBINHOOD_SOURCIFY_PROVIDER_CLASSIFICATION,
  attestRobinhoodSourcifyPublication,
  inspectRobinhoodSourcifyPublication,
  inspectRobinhoodSourcifyProtectedSource,
  prepareRobinhoodSourcifyPublication,
  robinhoodSourcifyPublicationAuthorizationDigest,
  submitRobinhoodSourcifyPublication,
  validateRobinhoodSourcifyPublicationPlan,
  validateRobinhoodSourcifyReadback,
} from "../robinhood-custom-launch-sourcify-v2-core.mjs";
import {
  buildRobinhoodSourcifyAttemptMarker,
  buildRobinhoodSourcifyReviewArtifact,
  commitRobinhoodSourcifyReceipt,
  openRobinhoodSourcifyRecoveryMarker,
  parseRobinhoodSourcifyArguments,
  readRobinhoodSourcifyReviewArtifact,
  reserveRobinhoodSourcifyOutput,
} from
  "../verify-robinhood-custom-launch-sourcify-v2.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const transactionHash = `0x${"3".repeat(64)}`;
const responseSha256 = `sha256:${"4".repeat(64)}`;
const sourceOrigin = Object.freeze({
  repository: "programmablehq/PROGRAMMABLE",
  protectedRef: "refs/heads/production",
  revision: "1".repeat(40),
  tree: "2".repeat(40),
  remote: "https://github.com/programmablehq/PROGRAMMABLE.git",
  liveProtectedRevision: "1".repeat(40),
  clean: true,
});

let prepared;

before(async () => {
  prepared = await prepareRobinhoodSourcifyPublication({
    repositoryRoot,
    creationTransactionHash: transactionHash,
    inspectSource: async () => sourceOrigin,
  });
});

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const nativeFileSystem = Object.freeze({
  lstat,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  randomUUID,
});

function wrappedHandle(handle, overrides = {}) {
  return new Proxy(handle, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function openapi() {
  return {
    info: {
      version: "2.1.0",
      description: `Sourcify API. ${ROBINHOOD_SOURCIFY_LICENSE_NOTICE}`,
    },
    paths: {
      "/v2/verify/{chainId}/{address}": { post: { responses: { 202: {} } } },
      "/v2/verify/{verificationId}": { get: { responses: { 200: {} } } },
      "/v2/contract/{chainId}/{address}": { get: { responses: { 200: {} } } },
    },
  };
}

function chains() {
  return [{ name: "Robinhood Chain", chainId: 4663, supported: true }];
}

function clone(value) {
  return structuredClone(value);
}

async function ownerOnlyTemporaryDirectory(prefix) {
  return realpath(await mkdtemp(path.join(tmpdir(), prefix)));
}

function immutableFixture(target) {
  const recompiled = Buffer.from(target.expected.runtimeRecompiled.slice(2), "hex");
  const populated = Buffer.from(recompiled);
  const immutables = {};
  const transformations = [];
  for (const [id, references] of Object.entries(target.expected.immutableReferences)) {
    const first = references[0];
    const value = `0x${createHash("sha256").update(`immutable:${id}`).digest("hex")
      .slice(0, first.length * 2)}`;
    immutables[id] = value;
    for (const reference of references) {
      Buffer.from(value.slice(2), "hex").copy(populated, reference.start);
      transformations.push({
        id,
        type: "replace",
        offset: reference.start,
        reason: "immutable",
      });
    }
  }
  return {
    onchain: `0x${populated.toString("hex")}`,
    transformations,
    transformationValues: transformations.length === 0 ? {} : { immutables },
  };
}

function exactReadback(target, overrides = {}) {
  const immutable = immutableFixture(target);
  const localTarget = clone(target);
  localTarget.planTarget.bytecode.runtimeOnchainKeccak256 = keccak256(immutable.onchain);
  localTarget.expected.runtimeOnchainHash = keccak256(immutable.onchain);
  const constructor = localTarget.expected.constructorArguments;
  const creationTransformations = constructor === "0x" ? [] : [{
    type: "insert",
    offset: (localTarget.expected.creationRecompiled.length - 2) / 2,
    reason: "constructorArguments",
  }];
  const value = {
    match: "match",
    creationMatch: "match",
    runtimeMatch: "match",
    chainId: "4663",
    address: localTarget.planTarget.address,
    verifiedAt: "2026-08-30T12:00:00.000Z",
    matchId: "123456",
    compilation: {
      language: "Solidity",
      compiler: "solc",
      compilerVersion: "0.8.26+commit.8a97fa7a",
      name: localTarget.planTarget.fullyQualifiedName.split(":").at(-1),
      fullyQualifiedName: localTarget.planTarget.fullyQualifiedName,
      compilerSettings: clone(localTarget.input.settings),
    },
    stdJsonInput: clone(localTarget.input),
    sources: Object.fromEntries(Object.entries(localTarget.input.sources).map(([name, source]) => [
      name, { content: source.content },
    ])),
    metadata: clone(localTarget.metadata),
    deployment: { transactionHash },
    creationBytecode: {
      recompiledBytecode: localTarget.expected.creationRecompiled,
      onchainBytecode: localTarget.expected.creationOnchain,
      cborAuxdata: {},
      linkReferences: {},
      transformations: creationTransformations,
      transformationValues: constructor === "0x" ? {} : {
        constructorArguments: constructor,
      },
    },
    runtimeBytecode: {
      recompiledBytecode: localTarget.expected.runtimeRecompiled,
      onchainBytecode: immutable.onchain,
      cborAuxdata: {},
      linkReferences: {},
      immutableReferences: clone(localTarget.expected.immutableReferences),
      transformations: immutable.transformations,
      transformationValues: immutable.transformationValues,
    },
  };
  for (const [pathKey, replacement] of Object.entries(overrides)) {
    const segments = pathKey.split(".");
    let cursor = value;
    for (const segment of segments.slice(0, -1)) cursor = cursor[segment];
    cursor[segments.at(-1)] = replacement;
  }
  return { target: localTarget, value };
}

function missing(target) {
  return jsonResponse({
    match: null,
    creationMatch: null,
    runtimeMatch: null,
    chainId: "4663",
    address: target.planTarget.address,
  }, 404);
}

test("plan is pinned to protected source, exact requests, and both external effects", () => {
  const plan = validateRobinhoodSourcifyPublicationPlan(prepared.plan);
  assert.equal(plan.targets[0].expectedProviderMatch, "match");
  assert.equal(plan.targets[1].providerClassification, ROBINHOOD_SOURCIFY_PROVIDER_CLASSIFICATION);
  assert.equal(plan.targets[0].bytecode.creationOnchainKeccak256,
    "0x84f7cb8e9e445d3322249dbc2b9efc65bb9c7a8ba26902aafef9b0552f4bc208");
  assert.equal(plan.targets[1].bytecode.runtimeOnchainKeccak256,
    "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388");
  assert.equal(plan.externalEffects.blockscoutReleaseAuthority, false);
  assert.match(plan.externalEffects.sourcify, /irreversible/u);
  assert.match(plan.externalEffects.blockscout, /writeOrWarn/u);
  assert.ok(plan.targets[1].requestBodyByteLength < 1024 * 1024);
  assert.equal(
    prepared.preparedTargets[1].request.creationTransactionHash,
    transactionHash,
  );
});

test("plan rejects recomputed-looking static identity drift", () => {
  const altered = clone(prepared.plan);
  altered.targets[0].fullyQualifiedName = "src/Evil.sol:Evil";
  assert.throws(() => validateRobinhoodSourcifyPublicationPlan(altered), /identity differs/u);
});

test("protected source inspection binds stable HEAD to the live remote production ref", async () => {
  const revision = "a".repeat(40);
  const tree = "b".repeat(40);
  const calls = [];
  const execute = async (_command, args) => {
    const gitArgs = args.slice(2);
    calls.push(gitArgs.join(" "));
    let stdout;
    if (gitArgs.join(" ") === "remote get-url origin") {
      stdout = "https://github.com/programmablehq/PROGRAMMABLE.git";
    } else if (gitArgs[0] === "status") {
      stdout = "";
    } else if (gitArgs.join(" ") === "rev-parse HEAD^{commit}") {
      stdout = revision;
    } else if (gitArgs.join(" ") === "rev-parse HEAD^{tree}") {
      stdout = tree;
    } else if (gitArgs.join(" ")
      === "rev-parse refs/remotes/origin/production^{commit}") {
      stdout = revision;
    } else if (gitArgs.join(" ")
      === "ls-remote --exit-code origin refs/heads/production") {
      stdout = `${revision}\trefs/heads/production`;
    } else {
      throw new Error(`unexpected Git query ${gitArgs.join(" ")}`);
    }
    return { stdout: `${stdout}\n`, stderr: "" };
  };
  const source = await inspectRobinhoodSourcifyProtectedSource({
    repositoryRoot,
    execute,
  });
  assert.equal(source.revision, revision);
  assert.equal(source.liveProtectedRevision, revision);
  assert.equal(source.tree, tree);
  assert.equal(calls.filter((call) => call === "rev-parse HEAD^{commit}").length, 2);
  assert.equal(calls.at(5), "ls-remote --exit-code origin refs/heads/production");

  await assert.rejects(inspectRobinhoodSourcifyProtectedSource({
    repositoryRoot,
    execute: async (command, args, options) => {
      const result = await execute(command, args, options);
      if (args.slice(2).join(" ")
        === "ls-remote --exit-code origin refs/heads/production") {
        return { stdout: `${"c".repeat(40)}\trefs/heads/production\n`, stderr: "" };
      }
      return result;
    },
  }), /live protected production/u);
});

for (const [index, name] of [[0, "GraphFactory"], [1, "Router"]]) {
  test(`${name} accepts provider match only with independently exact bytes`, () => {
    const fixture = exactReadback(prepared.preparedTargets[index]);
    const evidence = validateRobinhoodSourcifyReadback({
      value: fixture.value,
      responseSha256,
      prepared: fixture.target,
      creationTransactionHash: transactionHash,
    });
    assert.equal(evidence.providerClassification, ROBINHOOD_SOURCIFY_PROVIDER_CLASSIFICATION);
    assert.equal(evidence.creationMatch, "match");
    assert.equal(evidence.runtimeMatch, "match");
    assert.equal(evidence.creationOnchainKeccak256,
      fixture.target.planTarget.bytecode.creationOnchainKeccak256);
    assert.equal(evidence.runtimeOnchainKeccak256,
      fixture.target.planTarget.bytecode.runtimeOnchainKeccak256);

    const wholeSecond = exactReadback(prepared.preparedTargets[index], {
      verifiedAt: "2024-08-08T13:28:37Z",
    });
    const normalized = validateRobinhoodSourcifyReadback({
      value: wholeSecond.value,
      responseSha256,
      prepared: wholeSecond.target,
      creationTransactionHash: transactionHash,
    });
    assert.equal(normalized.verifiedAt, "2024-08-08T13:28:37.000Z");
  });
}

test("readback accepts only provider-realistic canonical UTC RFC3339 spelling", () => {
  for (const verifiedAt of [
    "2024-08-08T13:28:37.0Z",
    "2024-08-08T13:28:37+00:00",
    "2024-08-08t13:28:37z",
  ]) {
    const fixture = exactReadback(prepared.preparedTargets[0], { verifiedAt });
    assert.throws(() => validateRobinhoodSourcifyReadback({
      value: fixture.value,
      responseSha256,
      prepared: fixture.target,
      creationTransactionHash: transactionHash,
    }), /canonical UTC RFC3339/u);
  }
});

test("readback rejects false exact-match expectation and runtime-only success", () => {
  const exact = exactReadback(prepared.preparedTargets[0], { creationMatch: "exact_match" });
  assert.throws(() => validateRobinhoodSourcifyReadback({
    value: exact.value, responseSha256, prepared: exact.target,
    creationTransactionHash: transactionHash,
  }), /match\/match\/match/u);
  const runtimeOnly = exactReadback(prepared.preparedTargets[0], { creationMatch: null });
  assert.throws(() => validateRobinhoodSourcifyReadback({
    value: runtimeOnly.value, responseSha256, prepared: runtimeOnly.target,
    creationTransactionHash: transactionHash,
  }), /match\/match\/match/u);
});

test("readback rejects byte, constructor, immutable, CBOR, and library drift", () => {
  const cases = [
    ["creationBytecode.onchainBytecode", "0x00", /bytecode closure differs/u],
    ["runtimeBytecode.recompiledBytecode", "0x00", /bytecode closure differs/u],
    ["creationBytecode.transformationValues", { constructorArguments: "0x00" }, /constructor-argument/u],
    ["creationBytecode.cborAuxdata", { 1: {} }, /must be empty/u],
    ["runtimeBytecode.linkReferences", { "Evil.sol": {} }, /must be empty/u],
    ["runtimeBytecode.transformations", [{ type: "replace", offset: 0, reason: "library" }], /compiled immutables/u],
  ];
  for (const [field, replacement, expected] of cases) {
    const fixture = exactReadback(prepared.preparedTargets[1], { [field]: replacement });
    assert.throws(() => validateRobinhoodSourcifyReadback({
      value: fixture.value, responseSha256, prepared: fixture.target,
      creationTransactionHash: transactionHash,
    }), expected, field);
  }
});

test("readback rejects source, settings, metadata, and creation transaction substitution", () => {
  const cases = [
    ["stdJsonInput.language", "Yul"],
    ["compilation.compilerSettings.optimizer.runs", 999],
    ["metadata.language", "Yul"],
    ["deployment.transactionHash", `0x${"5".repeat(64)}`],
  ];
  for (const [field, replacement] of cases) {
    const fixture = exactReadback(prepared.preparedTargets[0], { [field]: replacement });
    assert.throws(() => validateRobinhoodSourcifyReadback({
      value: fixture.value, responseSha256, prepared: fixture.target,
      creationTransactionHash: transactionHash,
    }), /closure differs/u, field);
  }
});

test("review performs only bounded GETs and reports missing targets", async () => {
  const methods = [];
  const fetchMock = async (url, init) => {
    methods.push(init.method);
    if (url.endsWith("/api-docs/swagger.json")) return jsonResponse(openapi());
    if (url.endsWith("/chains")) return jsonResponse(chains());
    const target = prepared.preparedTargets.find((candidate) => url.includes(candidate.planTarget.address));
    return missing(target);
  };
  const review = await inspectRobinhoodSourcifyPublication({ prepared, request: fetchMock });
  assert.deepEqual(methods, ["GET", "GET", "GET", "GET"]);
  assert.deepEqual(review.targets.map(({ state }) => state), ["missing", "missing"]);
  assert.equal(review.externalAction, false);
  assert.equal(review.authorizationDigest,
    robinhoodSourcifyPublicationAuthorizationDigest(prepared.plan));
});

test("protected review revalidates exact legal copy, effects, API digests, and targets", async () => {
  const fetchMock = async (url) => {
    const basic = providerBasics(url);
    if (basic) return basic;
    const target = prepared.preparedTargets.find((candidate) =>
      url.includes(candidate.planTarget.address));
    return missing(target);
  };
  const review = await inspectRobinhoodSourcifyPublication({ prepared, request: fetchMock });
  const root = await ownerOnlyTemporaryDirectory("programmable-sourcify-review-test.");
  try {
    await chmod(root, 0o700);
    const file = path.join(root, "review.json");
    const write = async (value) => {
      await writeFile(file, `${canonicalizeJson(value)}\n`, { mode: 0o600 });
      await chmod(file, 0o600);
    };
    const artifact = buildRobinhoodSourcifyReviewArtifact(review);
    await write(artifact);
    assert.equal((await readRobinhoodSourcifyReviewArtifact(file)).authorization,
      review.authorizationDigest);
    for (const mutate of [
      (value) => { value.review.legalNotice = "approve source publication"; },
      (value) => { value.review.externalEffects.blockscoutReleaseAuthority = true; },
      (value) => { value.review.providerApi.openapiSha256 = "sha256:00"; },
      (value) => { value.review.targets[0].contract = "Router"; },
    ]) {
      const altered = JSON.parse(canonicalizeJson(artifact));
      mutate(altered);
      altered.reviewDigest = null;
      altered.reviewDigest = sha256(Buffer.from(canonicalizeJson(altered), "utf8"));
      await write(altered);
      await assert.rejects(readRobinhoodSourcifyReviewArtifact(file),
        /review display|review target|external effects differ/u);
    }
  } finally {
    await rm(root, { recursive: true, force: false });
  }
});

test("submit rejects legal or plan acknowledgement drift before network", async () => {
  let calls = 0;
  await assert.rejects(submitRobinhoodSourcifyPublication({
    prepared,
    authorizationDigest: `sha256:${"0".repeat(64)}`,
    licenseAcknowledgement: ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT,
    request: async () => { calls += 1; },
  }), /legal acknowledgement/u);
  assert.equal(calls, 0);
  await assert.rejects(submitRobinhoodSourcifyPublication({
    prepared,
    authorizationDigest: robinhoodSourcifyPublicationAuthorizationDigest(prepared.plan),
    licenseAcknowledgement: "yes",
    request: async () => { calls += 1; },
  }), /legal acknowledgement/u);
  assert.equal(calls, 0);
});

function fakeEvidence({ prepared: target, responseSha256: digest }) {
  return Object.freeze({
    contract: target.planTarget.contract,
    address: target.planTarget.address,
    providerMatch: "match",
    creationMatch: "match",
    runtimeMatch: "match",
    providerClassification: ROBINHOOD_SOURCIFY_PROVIDER_CLASSIFICATION,
    matchId: "123456",
    verifiedAt: "2026-08-30T12:00:00.000Z",
    responseSha256: digest,
    standardJsonInputSha256: target.planTarget.standardJsonInputSha256,
    metadataSha256: target.planTarget.metadataSha256,
    creationRecompiledKeccak256:
      target.planTarget.bytecode.creationRecompiledKeccak256,
    creationOnchainKeccak256: target.planTarget.bytecode.creationOnchainKeccak256,
    runtimeRecompiledKeccak256: target.planTarget.bytecode.runtimeRecompiledKeccak256,
    runtimeOnchainKeccak256: target.planTarget.bytecode.runtimeOnchainKeccak256,
    transformationPolicy: "constructor-arguments-and-compiled-immutables-only",
  });
}

function providerBasics(url) {
  if (url.endsWith("/api-docs/swagger.json")) return jsonResponse(openapi());
  if (url.endsWith("/chains")) return jsonResponse(chains());
  return null;
}

test("exact replay performs no POST and emits a read-only receipt", async () => {
  const methods = [];
  const fetchMock = async (url, init) => {
    methods.push(init.method);
    const basic = providerBasics(url);
    if (basic) return basic;
    return jsonResponse({ retained: true });
  };
  const receipt = await submitRobinhoodSourcifyPublication({
    prepared,
    authorizationDigest: robinhoodSourcifyPublicationAuthorizationDigest(prepared.plan),
    licenseAcknowledgement: ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT,
    request: fetchMock,
    validateReadback: fakeEvidence,
    now: () => new Date("2026-08-30T12:00:00.000Z"),
  });
  assert.equal(methods.includes("POST"), false);
  assert.deepEqual(receipt.targets.map(({ submission }) => submission), [
    "already-verified-read-only", "already-verified-read-only",
  ]);
  assert.equal(receipt.externalActionThisRun, false);
  assert.match(receipt.receiptDigest, /^sha256:[0-9a-f]{64}$/u);
});

test("202 job captures optional Blockscout side effect but does not make it authority", async () => {
  const graph = prepared.preparedTargets[0];
  let graphReads = 0;
  const methods = [];
  const verificationId = "72d12273-0723-448e-a9f6-f7957128efa5";
  const fetchMock = async (url, init) => {
    methods.push(init.method);
    const basic = providerBasics(url);
    if (basic) return basic;
    if (url.includes(`/v2/contract/4663/${graph.planTarget.address}`)) {
      graphReads += 1;
      return graphReads === 1 ? missing(graph) : jsonResponse({ retained: true });
    }
    if (url.endsWith(`/v2/verify/${verificationId}`)) {
      return jsonResponse({
        isJobCompleted: true,
        verificationId,
        contract: {
          match: "match", creationMatch: "match", runtimeMatch: "match",
          chainId: "4663", address: graph.planTarget.address,
        },
        externalVerifications: {
          blockscout: {
            verificationId: "blockscout-job-1",
            explorerUrl: `https://robinhoodchain.blockscout.com/address/${graph.planTarget.address}`,
          },
        },
      });
    }
    if (init.method === "POST") return jsonResponse({ verificationId }, 202);
    return jsonResponse({ retained: true });
  };
  const receipt = await submitRobinhoodSourcifyPublication({
    prepared,
    authorizationDigest: robinhoodSourcifyPublicationAuthorizationDigest(prepared.plan),
    licenseAcknowledgement: ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT,
    request: fetchMock,
    validateReadback: fakeEvidence,
    sleep: async () => {},
    onBeforePost: async () => {},
  });
  assert.equal(methods.filter((method) => method === "POST").length, 1);
  assert.equal(receipt.externalActionThisRun, true);
  assert.equal(receipt.targets[0].externalBlockscout.verificationId, "blockscout-job-1");
  assert.equal(receipt.externalEffects.blockscoutReleaseAuthority, false);
});

test("source drift and provider schema drift fail before the first POST", async () => {
  for (const failure of ["source", "openapi"]) {
    const methods = [];
    const fetchMock = async (url, init) => {
      methods.push(init.method);
      if (url.endsWith("/api-docs/swagger.json")) {
        const value = openapi();
        if (failure === "openapi") value.info.version = "3.0.0";
        return jsonResponse(value);
      }
      if (url.endsWith("/chains")) return jsonResponse(chains());
      const target = prepared.preparedTargets.find((candidate) =>
        url.includes(candidate.planTarget.address));
      return missing(target);
    };
    await assert.rejects(submitRobinhoodSourcifyPublication({
      prepared,
      authorizationDigest: robinhoodSourcifyPublicationAuthorizationDigest(prepared.plan),
      licenseAcknowledgement: ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT,
      request: fetchMock,
      validateReadback: fakeEvidence,
      revalidateSource: async () => {
        if (failure === "source") throw new TypeError("source changed");
      },
    }), failure === "source" ? /source changed/u : /OpenAPI/u);
    assert.equal(methods.includes("POST"), false, failure);
  }
});

test("core refuses every POST without an explicit durable checkpoint", async () => {
  let posts = 0;
  await assert.rejects(submitRobinhoodSourcifyPublication({
    prepared,
    authorizationDigest: robinhoodSourcifyPublicationAuthorizationDigest(prepared.plan),
    licenseAcknowledgement: ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT,
    request: async (url, init) => {
      const basic = providerBasics(url);
      if (basic) return basic;
      if (init.method === "POST") posts += 1;
      const target = prepared.preparedTargets.find((candidate) =>
        url.includes(candidate.planTarget.address));
      return missing(target);
    },
    validateReadback: fakeEvidence,
    revalidateSource: async () => {},
  }), /durable onBeforePost checkpoint/u);
  assert.equal(posts, 0);
});

test("concurrent 409 is success only after a fresh exact readback", async () => {
  const graph = prepared.preparedTargets[0];
  let graphReads = 0;
  let posts = 0;
  const fetchMock = async (url, init) => {
    const basic = providerBasics(url);
    if (basic) return basic;
    if (url.includes(`/v2/contract/4663/${graph.planTarget.address}`)) {
      graphReads += 1;
      return graphReads === 1 ? missing(graph) : jsonResponse({ retained: true });
    }
    if (init.method === "POST") {
      posts += 1;
      return jsonResponse({
        customCode: "already_verified",
        message: "already exact",
        errorId: "23aaf52e-168a-4cfa-8463-65ddfb792efc",
      }, 409);
    }
    return jsonResponse({ retained: true });
  };
  const receipt = await submitRobinhoodSourcifyPublication({
    prepared,
    authorizationDigest: robinhoodSourcifyPublicationAuthorizationDigest(prepared.plan),
    licenseAcknowledgement: ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT,
    request: fetchMock,
    validateReadback: fakeEvidence,
    onBeforePost: async () => {},
  });
  assert.equal(posts, 1);
  assert.equal(receipt.targets[0].submission, "concurrent-already-verified");
  assert.equal(receipt.externalActionThisRun, true);
  assert.equal(graphReads, 2);
});

test("partial success rerun skips the published target and never duplicates its POST", async () => {
  const published = new Set();
  const postCounts = new Map();
  const ids = new Map([
    [prepared.preparedTargets[0].planTarget.address,
      "72d12273-0723-448e-a9f6-f7957128efa5"],
    [prepared.preparedTargets[1].planTarget.address,
      "82d12273-0723-448e-a9f6-f7957128efa5"],
  ]);
  const fetchMock = async (url, init) => {
    const basic = providerBasics(url);
    if (basic) return basic;
    const target = prepared.preparedTargets.find((candidate) =>
      url.includes(candidate.planTarget.address));
    if (target && init.method === "GET") {
      return published.has(target.planTarget.address)
        ? jsonResponse({ retained: true })
        : missing(target);
    }
    if (init.method === "POST") {
      const address = target.planTarget.address;
      const count = (postCounts.get(address) ?? 0) + 1;
      postCounts.set(address, count);
      if (address === prepared.preparedTargets[1].planTarget.address && count === 1) {
        return jsonResponse({ customCode: "internal_error" }, 500);
      }
      published.add(address);
      return jsonResponse({ verificationId: ids.get(address) }, 202);
    }
    const job = [...ids.entries()].find(([, id]) => url.endsWith(`/v2/verify/${id}`));
    if (job) {
      return jsonResponse({
        isJobCompleted: true,
        verificationId: job[1],
        contract: {
          match: "match", creationMatch: "match", runtimeMatch: "match",
          chainId: "4663", address: job[0],
        },
      });
    }
    throw new Error(`unexpected ${init.method} ${url}`);
  };
  const inputs = {
    prepared,
    authorizationDigest: robinhoodSourcifyPublicationAuthorizationDigest(prepared.plan),
    licenseAcknowledgement: ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT,
    request: fetchMock,
    validateReadback: fakeEvidence,
    sleep: async () => {},
    revalidateSource: async () => {},
    onBeforePost: async () => {},
  };
  await assert.rejects(submitRobinhoodSourcifyPublication(inputs), /unexpected HTTP/u);
  const receipt = await submitRobinhoodSourcifyPublication(inputs);
  assert.equal(postCounts.get(prepared.preparedTargets[0].planTarget.address), 1);
  assert.equal(postCounts.get(prepared.preparedTargets[1].planTarget.address), 2);
  assert.equal(receipt.targets[0].submission, "already-verified-read-only");
  assert.equal(receipt.targets[1].submission, "submitted-and-completed");
});

function reviewedMarkerFixture() {
  return Object.freeze({
    value: Object.freeze({ reviewDigest: `sha256:${"9".repeat(64)}` }),
    plan: prepared.plan,
    authorization: robinhoodSourcifyPublicationAuthorizationDigest(prepared.plan),
  });
}

function completedJob(target, verificationId) {
  return jsonResponse({
    isJobCompleted: true,
    verificationId,
    contract: {
      match: "match",
      creationMatch: "match",
      runtimeMatch: "match",
      chainId: "4663",
      address: target.planTarget.address,
    },
  });
}

test("durable before-POST marker failure permits zero POSTs and safe abort", async () => {
  const root = await ownerOnlyTemporaryDirectory("programmable-sourcify-before-post-test.");
  try {
    const parent = path.join(root, "safe");
    await mkdir(parent, { mode: 0o700 });
    await chmod(parent, 0o700);
    const fileSystem = {
      ...nativeFileSystem,
      async open(candidate, flags, mode) {
        const handle = await open(candidate, flags, mode);
        if (candidate === parent && flags === fsConstants.O_RDONLY) {
          return wrappedHandle(handle, {
            sync: async () => { throw new Error("forced directory fsync failure"); },
          });
        }
        return handle;
      },
    };
    const output = path.join(parent, "attempt.json");
    const reservation = await reserveRobinhoodSourcifyOutput(output, {
      sourceRoot: repositoryRoot,
      temporaryRoot: "/var/empty",
      fileSystem,
    });
    let posts = 0;
    const request = async (url, init) => {
      const basic = providerBasics(url);
      if (basic) return basic;
      if (init.method === "POST") {
        posts += 1;
        return jsonResponse({ verificationId: "00000000-0000-4000-8000-000000000001" }, 202);
      }
      const target = prepared.preparedTargets.find((candidate) =>
        url.includes(candidate.planTarget.address));
      return missing(target);
    };
    const reviewed = reviewedMarkerFixture();
    await assert.rejects(submitRobinhoodSourcifyPublication({
      prepared,
      authorizationDigest: reviewed.authorization,
      licenseAcknowledgement: ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT,
      request,
      revalidateSource: async () => {},
      onBeforePost: (target, plan) => reservation.markAttempt(
        buildRobinhoodSourcifyAttemptMarker({
          reviewDigest: reviewed.value.reviewDigest,
          plan,
          authorizationDigest: reviewed.authorization,
          attemptedTargets: [target],
        }),
      ),
    }), /forced directory fsync failure/u);
    assert.equal(posts, 0);
    assert.equal(await reservation.abort(), true);
    await assert.rejects(access(output));
  } finally {
    await rm(root, { recursive: true, force: false });
  }
});

test("first publication success and second provider failure retains exact recovery marker", async () => {
  const root = await ownerOnlyTemporaryDirectory("programmable-sourcify-partial-test.");
  try {
    const parent = path.join(root, "safe");
    await mkdir(parent, { mode: 0o700 });
    await chmod(parent, 0o700);
    const output = path.join(parent, "attempt.json");
    const reservation = await reserveRobinhoodSourcifyOutput(output, {
      sourceRoot: repositoryRoot,
      temporaryRoot: "/var/empty",
    });
    const reviewed = reviewedMarkerFixture();
    const published = new Set();
    const attemptedTargets = [];
    const exactReadbackCheckpoints = [];
    let posts = 0;
    const verificationId = "00000000-0000-4000-8000-000000000001";
    const request = async (url, init) => {
      const basic = providerBasics(url);
      if (basic) return basic;
      const target = prepared.preparedTargets.find((candidate) =>
        url.includes(candidate.planTarget.address));
      if (init.method === "POST") {
        posts += 1;
        if (target === prepared.preparedTargets[1]) {
          return jsonResponse({ customCode: "internal_error" }, 500);
        }
        published.add(target.planTarget.address);
        return jsonResponse({ verificationId }, 202);
      }
      if (url.endsWith(`/v2/verify/${verificationId}`)) {
        return completedJob(prepared.preparedTargets[0], verificationId);
      }
      return published.has(target.planTarget.address)
        ? jsonResponse({ retained: true })
        : missing(target);
    };
    await assert.rejects(submitRobinhoodSourcifyPublication({
      prepared,
      authorizationDigest: reviewed.authorization,
      licenseAcknowledgement: ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT,
      request,
      validateReadback: fakeEvidence,
      sleep: async () => {},
      revalidateSource: async () => {},
      onBeforePost: async (target, plan) => {
        const marker = buildRobinhoodSourcifyAttemptMarker({
          reviewDigest: reviewed.value.reviewDigest,
          plan,
          authorizationDigest: reviewed.authorization,
          attemptedTargets: [...attemptedTargets, target],
          exactReadbackCheckpoints,
        });
        await reservation.markAttempt(marker);
        attemptedTargets.push(target);
      },
      onExactTargetReadback: async (result, plan) => {
        const marker = buildRobinhoodSourcifyAttemptMarker({
          reviewDigest: reviewed.value.reviewDigest,
          plan,
          authorizationDigest: reviewed.authorization,
          attemptedTargets,
          exactReadbackCheckpoints: [...exactReadbackCheckpoints, result],
        });
        await reservation.markAttempt(marker);
        exactReadbackCheckpoints.push(result);
      },
    }), /unexpected HTTP/u);
    assert.equal(posts, 2);
    assert.equal(await reservation.abort(), false);
    const metadata = await stat(output);
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal(metadata.nlink, 1);
    const retained = JSON.parse(await readFile(output, "utf8"));
    assert.equal(retained.externalActionPossible, true);
    assert.deepEqual(retained.attemptedTargets.map(({ contract }) => contract), [
      "graphFactory", "programmableLaunchStampRouter",
    ]);
    assert.deepEqual(
      retained.exactReadbackCheckpoints.map(({ contract }) => contract),
      ["graphFactory"],
    );
  } finally {
    await rm(root, { recursive: true, force: false });
  }
});

test("CLI forbids signing inputs and requires compound legal acknowledgement", () => {
  assert.throws(() => parseRobinhoodSourcifyArguments([
    "review", "--creation-transaction-hash", transactionHash, "--private-key", "x",
  ]), /forbidden/u);
  assert.throws(() => parseRobinhoodSourcifyArguments([
    "submit", "--review-plan", "/safe/review.json",
    "--acknowledge-publication-digest", `sha256:${"1".repeat(64)}`,
    "--acknowledge-legal-effects", "yes", "--output", "/safe/receipt.json",
  ]), /requires --acknowledge-legal-effects/u);
  const parsed = parseRobinhoodSourcifyArguments([
    "submit", "--review-plan", "/safe/review.json",
    "--acknowledge-publication-digest", `sha256:${"1".repeat(64)}`,
    "--acknowledge-legal-effects", ROBINHOOD_SOURCIFY_LICENSE_ACKNOWLEDGEMENT,
    "--output", "/safe/receipt.json",
  ]);
  assert.equal(parsed.mode, "submit");
  assert.deepEqual(parseRobinhoodSourcifyArguments([
    "recover", "--review-plan", "/safe/review.json",
    "--recovery-marker", "/safe/attempt.json",
  ]), {
    mode: "recover",
    creationTransactionHash: null,
    authorizationDigest: null,
    legalAcknowledgement: null,
    reviewPlan: "/safe/review.json",
    recoveryMarker: "/safe/attempt.json",
    output: null,
  });
  assert.throws(() => parseRobinhoodSourcifyArguments([
    "recover", "--review-plan", "/safe/review.json",
    "--recovery-marker", "/safe/attempt.json", "--output", "/safe/new.json",
  ]), /accepts only/u);
});

test("output reservation rejects occupied or unsafe targets before any external action", async () => {
  const root = await ownerOnlyTemporaryDirectory("programmable-sourcify-output-test.");
  try {
    const safeParent = path.join(root, "safe");
    const unsafeParent = path.join(root, "unsafe");
    await Promise.all([
      mkdir(safeParent, { mode: 0o700 }),
      mkdir(unsafeParent, { mode: 0o755 }),
    ]);
    await chmod(safeParent, 0o700);
    await chmod(unsafeParent, 0o755);
    const unsafeOutput = path.join(unsafeParent, "receipt.json");
    await assert.rejects(reserveRobinhoodSourcifyOutput(unsafeOutput, {
      sourceRoot: repositoryRoot,
      temporaryRoot: "/var/empty",
    }), /owner-only/u);
    await assert.rejects(access(unsafeOutput));

    const occupied = path.join(safeParent, "occupied.json");
    await writeFile(occupied, "owned\n", { mode: 0o600 });
    await assert.rejects(reserveRobinhoodSourcifyOutput(occupied, {
      sourceRoot: repositoryRoot,
      temporaryRoot: "/var/empty",
    }), /EEXIST/u);
    assert.equal(await readFile(occupied, "utf8"), "owned\n");

    const reservedPath = path.join(safeParent, "reserved.json");
    const reservation = await reserveRobinhoodSourcifyOutput(reservedPath, {
      sourceRoot: repositoryRoot,
      temporaryRoot: "/var/empty",
    });
    assert.equal((await stat(reservedPath)).size, 0);
    await reservation.abort();
    await assert.rejects(access(reservedPath));

    const committedPath = path.join(safeParent, "committed.json");
    const committed = await reserveRobinhoodSourcifyOutput(committedPath, {
      sourceRoot: repositoryRoot,
      temporaryRoot: "/var/empty",
    });
    await committed.commit({ state: "complete" });
    const committedStats = await stat(committedPath);
    assert.equal(committedStats.nlink, 1);
    assert.equal(committedStats.mode & 0o777, 0o600);
    assert.equal(await readFile(committedPath, "utf8"), '{"state":"complete"}\n');
  } finally {
    await rm(root, { recursive: true, force: false });
  }
});

test("atomic receipt sync and rename failures never delete durable publication evidence", async () => {
  for (const failure of ["temporary-sync", "rename", "post-rename-directory-sync"]) {
    const root = await ownerOnlyTemporaryDirectory(`programmable-sourcify-${failure}-test.`);
    try {
      const parent = path.join(root, "safe");
      await mkdir(parent, { mode: 0o700 });
      await chmod(parent, 0o700);
      let armed = false;
      let directorySyncs = 0;
      const fileSystem = {
        ...nativeFileSystem,
        async open(candidate, flags, mode) {
          const handle = await open(candidate, flags, mode);
          if (candidate === parent && flags === fsConstants.O_RDONLY) {
            return wrappedHandle(handle, {
              sync: async () => {
                directorySyncs += 1;
                if (armed && failure === "post-rename-directory-sync") {
                  throw new Error("forced post-rename directory sync failure");
                }
                return handle.sync();
              },
            });
          }
          if (armed && failure === "temporary-sync" && candidate.endsWith(".tmp")) {
            return wrappedHandle(handle, {
              sync: async () => { throw new Error("forced temporary sync failure"); },
            });
          }
          return handle;
        },
        async rename(from, to) {
          if (armed && failure === "rename") throw new Error("forced rename failure");
          return rename(from, to);
        },
      };
      const output = path.join(parent, "attempt.json");
      const reservation = await reserveRobinhoodSourcifyOutput(output, {
        sourceRoot: repositoryRoot,
        temporaryRoot: "/var/empty",
        fileSystem,
      });
      const reviewed = reviewedMarkerFixture();
      const marker = buildRobinhoodSourcifyAttemptMarker({
        reviewDigest: reviewed.value.reviewDigest,
        plan: reviewed.plan,
        authorizationDigest: reviewed.authorization,
        attemptedTargets: [reviewed.plan.targets[0]],
      });
      await reservation.markAttempt(marker);
      assert.equal(directorySyncs, 1);
      armed = true;
      await assert.rejects(reservation.commit({ state: "complete" }), /forced/u, failure);
      assert.equal(await reservation.abort(), false);
      const retained = JSON.parse(await readFile(output, "utf8"));
      if (failure === "post-rename-directory-sync") {
        assert.deepEqual(retained, { state: "complete" });
      } else {
        assert.equal(retained.attemptDigest, marker.attemptDigest);
      }
      assert.deepEqual(await readdir(parent), ["attempt.json"]);
      const metadata = await stat(output);
      assert.equal(metadata.nlink, 1);
      assert.equal(metadata.mode & 0o777, 0o600);
    } finally {
      await rm(root, { recursive: true, force: false });
    }
  }
});

test("post-write source drift leaves the completed receipt in place", async () => {
  const root = await ownerOnlyTemporaryDirectory("programmable-sourcify-source-drift-test.");
  try {
    const parent = path.join(root, "safe");
    await mkdir(parent, { mode: 0o700 });
    await chmod(parent, 0o700);
    const outputPath = path.join(parent, "attempt.json");
    const output = await reserveRobinhoodSourcifyOutput(outputPath, {
      sourceRoot: repositoryRoot,
      temporaryRoot: "/var/empty",
    });
    const reviewed = reviewedMarkerFixture();
    await output.markAttempt(buildRobinhoodSourcifyAttemptMarker({
      reviewDigest: reviewed.value.reviewDigest,
      plan: reviewed.plan,
      authorizationDigest: reviewed.authorization,
      attemptedTargets: [reviewed.plan.targets[0]],
    }));
    const receipt = { state: "completed-provider-readback", receiptDigest: `sha256:${"8".repeat(64)}` };
    await assert.rejects(commitRobinhoodSourcifyReceipt({
      output,
      receipt,
      expectedSource: sourceOrigin,
      inspectSource: async () => ({ ...sourceOrigin, tree: "f".repeat(40) }),
      driftMessage: "forced protected-source drift",
    }), /receipt retained/u);
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), receipt);
    assert.equal(await output.abort(), false);
  } finally {
    await rm(root, { recursive: true, force: false });
  }
});

test("read-only recovery rejects tamper and missing targets, then atomically emits receipt", async () => {
  const root = await ownerOnlyTemporaryDirectory("programmable-sourcify-recovery-test.");
  try {
    const parent = path.join(root, "safe");
    await mkdir(parent, { mode: 0o700 });
    await chmod(parent, 0o700);
    const reviewed = reviewedMarkerFixture();
    const marker = buildRobinhoodSourcifyAttemptMarker({
      reviewDigest: reviewed.value.reviewDigest,
      plan: reviewed.plan,
      authorizationDigest: reviewed.authorization,
      attemptedTargets: [reviewed.plan.targets[0]],
    });

    const tamperedPath = path.join(parent, "tampered.json");
    await writeFile(tamperedPath, `${canonicalizeJson({
      ...marker,
      planDigest: `sha256:${"0".repeat(64)}`,
    })}\n`, { mode: 0o600 });
    await assert.rejects(openRobinhoodSourcifyRecoveryMarker(tamperedPath, reviewed, {
      sourceRoot: repositoryRoot,
      temporaryRoot: "/var/empty",
    }), /attempt marker differs/u);

    const outputPath = path.join(parent, "attempt.json");
    const initial = await reserveRobinhoodSourcifyOutput(outputPath, {
      sourceRoot: repositoryRoot,
      temporaryRoot: "/var/empty",
    });
    await initial.markAttempt(marker);
    const recovery = await openRobinhoodSourcifyRecoveryMarker(outputPath, reviewed, {
      sourceRoot: repositoryRoot,
      temporaryRoot: "/var/empty",
    });
    const missingMethods = [];
    await assert.rejects(attestRobinhoodSourcifyPublication({
      prepared,
      request: async (url, init) => {
        missingMethods.push(init.method);
        const basic = providerBasics(url);
        if (basic) return basic;
        const target = prepared.preparedTargets.find((candidate) =>
          url.includes(candidate.planTarget.address));
        return missing(target);
      },
      validateReadback: fakeEvidence,
    }), /remains missing/u);
    assert.equal(missingMethods.includes("POST"), false);
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).attemptDigest,
      marker.attemptDigest);

    const methods = [];
    const receipt = await attestRobinhoodSourcifyPublication({
      prepared,
      request: async (url, init) => {
        methods.push(init.method);
        const basic = providerBasics(url);
        return basic ?? jsonResponse({ retained: true });
      },
      validateReadback: fakeEvidence,
      now: () => new Date("2026-08-30T12:00:00.000Z"),
    });
    assert.equal(methods.includes("POST"), false);
    assert.equal(receipt.externalActionThisRun, false);
    assert.deepEqual(receipt.targets.map(({ submission }) => submission), [
      "recovered-read-only", "recovered-read-only",
    ]);
    await recovery.output.commit(receipt);
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).receiptDigest,
      receipt.receiptDigest);
    assert.equal(await recovery.output.abort(), false);
  } finally {
    await rm(root, { recursive: true, force: false });
  }
});

test("canonical request bodies bind exact Standard JSON bytes and no credentials", async () => {
  for (const target of prepared.preparedTargets) {
    const bytes = await readFile(path.join(repositoryRoot, target.planTarget.standardJsonInputPath));
    assert.equal(target.planTarget.standardJsonInputSha256, sha256(bytes));
    assert.equal(target.planTarget.requestBodySha256, sha256(target.requestBytes));
    assert.equal(target.requestBytes.includes(Buffer.from("apiKey")), false);
    assert.equal(target.requestBytes.includes(Buffer.from("rpcUrl")), false);
    assert.equal(canonicalizeJson(target.request).includes(transactionHash), true);
  }
});
