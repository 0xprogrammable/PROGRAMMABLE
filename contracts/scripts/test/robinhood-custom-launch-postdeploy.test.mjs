import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  keccak256,
  padHex,
  stringToHex,
  toHex,
} from "viem";

import { canonicalizeJson } from "../../../packages/launch/src/canonical-json.mjs";
import { sha256Digest } from "../../../packages/launch/src/io.mjs";
import { computeV4SourceClosureDigest } from "../../../scripts/programmable-launch-v4-release-binding.mjs";
import {
  ROBINHOOD_CAPTURE_AUTHORIZATION_SCHEMA,
  ROBINHOOD_CAPTURE_ATTESTATION_BUNDLE_PATH,
  ROBINHOOD_CAPTURE_CLOSURE_SCHEMA,
  ROBINHOOD_CAPTURE_PROFILE_DIGEST,
  ROBINHOOD_CAPTURE_SCHEMA,
  ROBINHOOD_CAPTURE_WORKFLOW,
  ROBINHOOD_CAPTURE_PATH,
  ROBINHOOD_PRODUCTION_REF,
  ROBINHOOD_PRODUCTION_REPOSITORY,
  ROBINHOOD_PRODUCTION_REPOSITORY_ID,
  ROBINHOOD_SEQUENCER_INBOX,
  ROBINHOOD_SOURCE_VERIFY_ATTESTATION_BUNDLE_PATH,
  ROBINHOOD_SOURCE_VERIFY_PROOF_PATH,
  SEQUENCER_BATCH_DELIVERED_TOPIC,
  buildRobinhoodCaptureAuthorization,
  buildRobinhoodPostdeploymentInput,
  buildRobinhoodPublicRpcEntry,
  computeRobinhoodCaptureClosureDigest,
  createRobinhoodResponseBudget,
  freshVerifyRobinhoodProviderReadbacks,
  freshVerifyRobinhoodSourcify,
  readRobinhoodBoundedResponse,
  sha256CaptureBytes,
  testOnlyFramedCaptureDigest,
} from "../robinhood-custom-launch-capture-v2.mjs";
import {
  ROBINHOOD_LIVE_DEPLOYMENT_PATH,
  ROBINHOOD_PREDEPLOYMENT_PATH,
  ROBINHOOD_BACKEND_PHASE_A_STAGE_BUNDLE_PATH,
  ROBINHOOD_BACKEND_PHASE_A_STAGE_ATTESTATION_PATH,
  ROBINHOOD_BACKEND_PHASE_A_PRODUCTION_CAPTURE_PATH,
  ROBINHOOD_BACKEND_PHASE_A_PRODUCTION_CAPTURE_ATTESTATION_PATH,
  materializeRobinhoodStageBundle,
  materializeRobinhoodPromotionBundle,
  verifyRobinhoodStageBundle,
  verifyRobinhoodPromotionBundle,
} from "../robinhood-custom-launch-postdeploy-core.mjs";
import {
  ROBINHOOD_BACKEND_AUTHORIZATION_SCHEMA,
  ROBINHOOD_BACKEND_AUTHORIZATION_PATH,
  ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH,
  ROBINHOOD_BACKEND_AUTHORIZATION_WORKFLOW,
  ROBINHOOD_BACKEND_ATTESTATION_BUNDLE_PATH,
  ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY,
  ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_OIDC_ISSUER,
  ROBINHOOD_BACKEND_CAPTURE_SOURCE_REF,
  ROBINHOOD_BACKEND_CAPTURE_TRIGGER,
  ROBINHOOD_BACKEND_CAPTURE_TRUST_CLASS,
  ROBINHOOD_BACKEND_CAPTURE_AUTHORIZATION_SCHEMA,
  ROBINHOOD_BACKEND_CAPTURE_WORKFLOW,
  ROBINHOOD_BACKEND_CAPTURE_WORKFLOW_NAME,
  ROBINHOOD_BACKEND_COSIGN_LINUX_AMD64_SHA256,
  ROBINHOOD_BACKEND_COSIGN_VERSION,
  ROBINHOOD_BACKEND_PROMOTION_INPUT_PATH,
  ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH,
  buildRobinhoodBackendAuthorization,
  buildRobinhoodBackendCosignVerifyBlobArgs,
  buildRobinhoodBackendCaptureAuthorization,
  buildRobinhoodBackendPromotionFixture,
  buildRobinhoodBackendPromotionInput,
  buildRobinhoodBackendPromotionPublicInput,
  buildRobinhoodBackendPromotionPublicInputFromPrivate,
  freshVerifyRobinhoodBackendPromotionInput,
  validateRobinhoodBackendCaptureAuthorization,
  validateRobinhoodBackendPromotionInput,
  validateRobinhoodBackendPromotionPublicInput,
  validateSigstoreMessageBundleV03,
  SIGSTORE_BUNDLE_V03_MEDIA_TYPE,
} from "../robinhood-backend-promotion-v1.mjs";
import { runRobinhoodPostdeploymentCli } from "../finalize-robinhood-custom-launch-deployment.mjs";
import { validateRobinhoodCaptureEndpoint } from
  "../capture-robinhood-custom-launch-postdeployment.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const bindingPath = "docs/operations/releases/custom-launch-v4/cli-release-binding.json";
const sourcePaths = [
  "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
  "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
  "contracts/src/ProgrammableCreate2GraphDeployerV1.sol",
  "contracts/src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol",
];
const template = JSON.parse(await readFile(path.join(repositoryRoot, bindingPath), "utf8"));
const postdeploymentSchemaNames = [
  "cli-release-binding", "stage-bundle", "backend-promotion-input",
  "backend-promotion-public-input", "backend-capture-authorization",
  "backend-release-authorization", "promotion-bundle",
];
const postdeploymentSchemas = await Promise.all(postdeploymentSchemaNames.map(async (name) =>
  JSON.parse(await readFile(path.join(
    repositoryRoot,
    `docs/operations/releases/custom-launch-v4/${name}.schema.json`,
  ), "utf8"))));
const postdeploymentAjv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
});
for (const schema of postdeploymentSchemas) postdeploymentAjv.addSchema(schema);
const machinePaths = template.machineContracts.map(({ path: relativePath }) => relativePath);
const OBSERVED_AT = "2026-08-29T18:00:00.000Z";
const EXPIRES_AT = "2026-08-29T18:20:00.000Z";
const BLOCK_NUMBER = "49230000";
const BLOCK_HASH = hash32("l2-deployment-block");
const PREDECESSOR_HASH = hash32("l2-predecessor-block");
const RAW_SIGNED_TRANSACTION = "0xdeadbeef";
const TRANSACTION_HASH = keccak256(RAW_SIGNED_TRANSACTION);
const OWNER = "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const SAFE_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const SAFE_FALLBACK = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c";
const SAFE_OWNERS = [
  OWNER,
  "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
];
const OWNER_CALLDATA_HASH =
  "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9";
const ROUTER_READ_ABI = [
  { type: "function", name: "PERMIT_AUTHORITY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "PERMIT_AUTHORITY_RUNTIME_CODE_HASH", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "GRAPH_FACTORY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "GRAPH_FACTORY_RUNTIME_CODE_HASH", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "POOL_MANAGER", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "POOL_MANAGER_RUNTIME_CODE_HASH", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "CHAIN_ID", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];
const SAFE_READ_ABI = [
  { type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "getModulesPaginated", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "address[]" }, { type: "address" }],
  },
];
const SAFE_MODULES_END_SENTINEL = "0x0000000000000000000000000000000000000001";
const SAFE_SINGLETON_STORAGE_SLOT = `0x${"0".repeat(64)}`;
const SAFE_FALLBACK_HANDLER_STORAGE_SLOT = keccak256(
  stringToHex("fallback_manager.handler.address"),
);
const SAFE_GUARD_STORAGE_SLOT = keccak256(stringToHex("guard_manager.guard.address"));

const ROOTS = Object.freeze({
  programmableLaunchStampRouter: root(
    "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
    "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
  ),
  permitAuthority: root(
    "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
    "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  ),
  graphFactory: root(
    "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
    "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  ),
  poolManager: root(
    "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
  ),
  positionManager: root(
    "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
    "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2",
  ),
  stateView: root(
    "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
    "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6",
  ),
  v4Quoter: root(
    "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
    "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6",
  ),
  permit2: root(
    "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca",
  ),
  universalRouter: root(
    "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
    "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
  ),
});
const EXTERNAL = Object.freeze({
  poolManager: deployment("0x4fb28d4935866f462582c6c931c6f2705e55f5be5eb178c7d8d9329a95c44c41", "9070"),
  positionManager: deployment("0x228c18ada6cb46b4fbcc18f4ec1519953415393e256fa8349aafbd5a2db037c8", "9073"),
  stateView: deployment("0x3d61e2c9eeb482385b1aa436b9e8f812167ea579cc390e4f93bc5abde00582f4", "9075"),
  v4Quoter: deployment("0x6bf436d72a17f87284ddcab43094689bd320dfb39b535213b9a0b669fabc4ab4", "9074"),
  universalRouter: deployment("0xdfb76494e158d8dea4376160315239271636a18515207fd4526e574bc7eeb456", "3347899"),
});
const EXTERNAL_NAMES = Object.freeze(Object.keys(EXTERNAL));
const EXTERNAL_RAW_TRANSACTIONS = Object.freeze(Object.fromEntries(
  EXTERNAL_NAMES.map((contract, index) => [contract, `0x7f${(index + 1).toString(16).padStart(2, "0")}00`]),
));
const EXTERNAL_CREATE2_INPUTS = Object.freeze(Object.fromEntries(
  EXTERNAL_NAMES.map((contract, index) => [
    contract,
    `0x${"0".repeat(64)}60${(index + 1).toString(16).padStart(2, "0")}`,
  ]),
));

const SAFE_SETUP_ABI = [{
  type: "event",
  name: "SafeSetup",
  inputs: [
    { indexed: true, name: "initiator", type: "address" },
    { indexed: false, name: "owners", type: "address[]" },
    { indexed: false, name: "threshold", type: "uint256" },
    { indexed: false, name: "initializer", type: "address" },
    { indexed: false, name: "fallbackHandler", type: "address" },
  ],
}];
const PROXY_CREATION_ABI = [{
  type: "event",
  name: "ProxyCreation",
  inputs: [
    { indexed: true, name: "proxy", type: "address" },
    { indexed: false, name: "singleton", type: "address" },
  ],
}];

function externalRawVariant(rawTransaction) {
  if (typeof rawTransaction !== "string") return null;
  const match = /^0x7f([0-9a-f]{2})([0-9a-f]{2})$/u.exec(rawTransaction);
  if (match === null) return null;
  const index = Number.parseInt(match[1], 16) - 1;
  return index >= 0 && index < EXTERNAL_NAMES.length
    ? { contract: EXTERNAL_NAMES[index], variant: Number.parseInt(match[2], 16), index }
    : null;
}

const testCaptureDependencies = Object.freeze({
  allowTestOnly: true,
  now: () => new Date("2026-08-29T18:01:00.000Z"),
  hashSignedTransaction: (rawTransaction) => {
    const external = externalRawVariant(rawTransaction);
    if (external === null) return keccak256(rawTransaction);
    return external.variant === 1
      ? hash32("wrong-external-raw-hash")
      : EXTERNAL[external.contract].transactionHash;
  },
  decodeSignedTransaction: async (rawTransaction) => {
    const external = externalRawVariant(rawTransaction);
    if (external === null) {
      return {
        chainId: 4663n,
        from: OWNER,
        to: MULTICALL3,
        input: "0x82ad56cb00",
        value: 0n,
        nonce: 7n,
      };
    }
    let input = EXTERNAL_CREATE2_INPUTS[external.contract];
    if (external.variant === 3) input = "0x00";
    if (external.variant === 4) input = `0x${"0".repeat(63)}1${input.slice(66)}`;
    if (external.variant === 5) input = `0x${"0".repeat(64)}`;
    if (external.variant === 6) input = `0x${"0".repeat(64)}dead`;
    return {
      chainId: 4663n,
      from: external.variant === 2 ? SAFE_SINGLETON : OWNER,
      to: getAddress(CREATE2_DEPLOYER),
      input,
      value: 0n,
      nonce: BigInt(external.index + 1),
    };
  },
  deriveCreate2Address: (_deployer, _salt, initCode, expected) =>
    initCode === "0xdead" ? ROOTS.graphFactory.address : expected,
  hashCalldata: () => OWNER_CALLDATA_HASH,
  calldataBytes: () => 33_412,
  hashRuntimeCode: (code, expected) => {
    const empty =
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
    return (code === "0x") === (expected === empty) ? expected : keccak256(code);
  },
  runtimeCodeBytes: (code, expected) => expected ?? code.length / 2 - 1,
});

test("bounded capture reader cancels byte and chunk floods before allocation", async () => {
  let reads = 0;
  let cancelled = false;
  const reader = {
    read: async () => (reads++ < 16_385
      ? { done: false, value: Uint8Array.of(1) }
      : { done: true, value: undefined }),
    cancel: async () => { cancelled = true; },
    releaseLock: () => {},
  };
  await assert.rejects(() => readRobinhoodBoundedResponse({
    headers: new Headers(),
    body: { getReader: () => reader },
  }, {
    label: "chunk flood",
    maximumBytes: 32_768,
    budget: createRobinhoodResponseBudget(65_536),
  }), /chunk|capture budget/u);
  assert.equal(cancelled, true);

  let lengthCancelled = false;
  await assert.rejects(() => readRobinhoodBoundedResponse({
    headers: new Headers({ "content-length": "1025" }),
    body: {
      cancel: async () => { lengthCancelled = true; },
      getReader: () => { throw new Error("must not read oversized response"); },
    },
  }, {
    label: "declared flood",
    maximumBytes: 1_024,
    budget: createRobinhoodResponseBudget(2_048),
  }), /Content-Length/u);
  assert.equal(lengthCancelled, true);
});

test("checked-in postdeployment handoff schemas compile under strict Ajv", async () => {
  for (const schema of postdeploymentSchemas) {
    assert.equal(typeof postdeploymentAjv.getSchema(schema.$id), "function", schema.$id);
  }
});

test("public v3 RPC evidence drops provider bytes and credential-like endpoint components", async () => {
  const fixture = await fixtureRepository();
  const canary = "provider-secret-canary-do-not-publish";
  try {
    const built = await buildInput(fixture, {
      rpcResultCanary: canary,
      l1ConfirmationsCanary: canary,
    });
    const bundle = await materialize(fixture, built);
    assert.equal(JSON.stringify(built.input).includes(canary), false);
    assert.equal(JSON.stringify(bundle).includes(canary), false);
    assert.deepEqual(Object.keys(built.input.capture.l2ProviderReadbacks[0].entries[2]), [
      "key", "method", "params", "requestId", "requestSha256", "normalizedResultSha256",
      "result",
    ]);
    assert.equal(
      JSON.stringify(built.input.capture.l2ProviderReadbacks[0].entries[2].result).includes(canary),
      false,
    );
    assert.equal(
      JSON.stringify(built.input.capture.ethereumProviderReadbacks[0].entries[2].result)
        .includes(canary),
      false,
    );
    const ambiguous = Buffer.from(JSON.stringify({
      jsonrpc: "2.0", id: 1, result: "0x1", error: { message: canary },
    }), "utf8");
    assert.throws(() => buildRobinhoodPublicRpcEntry({
      key: "chainId", method: "eth_chainId", params: [], requestId: 1,
      responseBytes: ambiguous,
    }), /contain exactly|successful JSON-RPC/u);

    const endpointCanary = "credentialslug-do-not-publish";
    assert.equal(validateRobinhoodCaptureEndpoint(
      `https://${endpointCanary}.g.alchemy.com/v2/${endpointCanary}?token=${endpointCanary}`,
      "robinhood",
      "alchemy",
    ), true);
    const publicIdentity = built.input.capture.l2ProviderReadbacks[1].identity;
    assert.equal(JSON.stringify(publicIdentity).includes(endpointCanary), false);
    assert.deepEqual(Object.keys(publicIdentity), [
      "role", "providerId", "trustDomain", "authentication", "observedAt",
    ]);
    assert.throws(() => validateRobinhoodCaptureEndpoint(
      `https://${endpointCanary}:password@rpc.drpc.org/`, "robinhood", "drpc",
    ), /endpoint pin/u);
    assert.throws(() => validateRobinhoodCaptureEndpoint(
      `https://rpc.drpc.org/#${endpointCanary}`, "robinhood", "drpc",
    ), /endpoint pin/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("authenticated raw capture deterministically materializes a closed test-only bundle", async () => {
  const fixture = await fixtureRepository();
  try {
    const built = await buildInput(fixture);
    const bundle = await materialize(fixture, built);
    const repeated = await materialize(fixture, built);
    assert.deepEqual(repeated, bundle);
    const verified = await verify(fixture, built, bundle);
    assert.equal(verified.structurallyValid, true);
    assert.equal(verified.releaseReady, false);
    assert.equal(verified.authorizationClass, "test-only");
    assert.equal(bundle.state, "test-only-structural");
    assert.equal(bundle.artifacts.cliReleaseBinding.value.releaseReady, false);
    assert.equal(bundle.artifacts.cliReleaseBinding.value.evidence.manifest, null);
    assert.equal(bundle.artifacts.cliReleaseBinding.value.evidence.backend, null);
    assert.deepEqual(bundle.artifacts.cliReleaseBinding.value.blockers,
      ["releaseManifestEvidence", "backendReleaseEvidence"]);
    assert.equal(bundle.finalizedBindings.releaseManifestDigest, null);
    assert.deepEqual(Object.keys(bundle), [
      "schemaVersion", "state", "releaseReady", "publicAuthorization", "publicWrites",
      "chainDeploymentId", "inputEvidenceDigest",
      "preparedArtifact", "captureAuthorization", "captureClosure", "sourceVerification",
      "sourceClosure", "backendReleaseAssets", "finalizedBindings", "artifacts", "consumerInputs",
      "stageBundleDigest",
    ]);
    assert.equal(bundle.captureClosure.postingEvent.batchNumber, "153046");
    assert.equal(bundle.captureClosure.sourcify[0].creationMatch, "exact_match");
    assert.equal(bundle.captureClosure.sourcify[0].runtimeMatch, "exact_match");
    assert.equal(bundle.sourceClosure.revision, fixture.revision);
    assert.equal(bundle.sourceClosure.protectedRef, "refs/heads/production");
    assert.equal(bundle.consumerInputs.indexer.captureClosureDigest,
      bundle.captureClosure.captureClosureDigest);
    assert.equal(bundle.backendReleaseAssets.state, "phase-a-closed");
    assert.equal(bundle.consumerInputs.backend.publicAuthorization, false);
    assert.deepEqual(bundle.artifacts.backendRelease.standardJsonInputs.map(({ path: value }) => value), [
      "release/assets/robinhood-v4/ProgrammableLaunchStampRouterV1.standard-input.json",
      "release/assets/robinhood-v4/ProgrammableCreate2GraphDeployerV1.standard-input.json",
    ]);
    await assert.rejects(
      readFile(path.join(fixture.root, ROBINHOOD_LIVE_DEPLOYMENT_PATH)),
      /ENOENT/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("authenticated Phase A replays from exact #1 Git blobs across distinct #2 and #3", async () => {
  const fixture = await fixtureRepository();
  try {
    const built = await buildInput(fixture);
    const bundle = await materialize(fixture, built);
    await mkdir(path.join(fixture.root, ".evidence"), { recursive: true });
    await writeFile(path.join(fixture.root, ".evidence", "producer"), "#2\n", "utf8");
    runGit(fixture.root, ["add", "-A"]);
    runGit(fixture.root, [
      "-c", "commit.gpgsign=false",
      "-c", "user.name=Programmable Release Test",
      "-c", "user.email=release-test@programmable.invalid",
      "commit", "-m", "import exact Phase A evidence",
    ]);
    const producerRevision = runGit(fixture.root, ["rev-parse", "HEAD^{commit}"]);
    const producerTree = runGit(fixture.root, ["rev-parse", "HEAD^{tree}"]);
    runGit(fixture.root, ["update-ref", "refs/remotes/origin/production", producerRevision]);
    runGit(fixture.root, ["checkout", "--detach", producerRevision]);
    await assert.rejects(() => materialize(fixture, built),
      /HEAD and protected origin\/production at revision/u);
    assert.equal((await verify(fixture, built, bundle)).structurallyValid, true);

    await writeFile(
      path.join(fixture.root, bindingPath),
      `${JSON.stringify(bundle.artifacts.cliReleaseBinding.value, null, 2)}\n`,
      "utf8",
    );
    await writeFile(path.join(fixture.root, ".evidence", "final"), "#3\n", "utf8");
    runGit(fixture.root, ["add", "-A"]);
    runGit(fixture.root, [
      "-c", "commit.gpgsign=false",
      "-c", "user.name=Programmable Release Test",
      "-c", "user.email=release-test@programmable.invalid",
      "commit", "-m", "land final evidence binding",
    ]);
    const evidenceRevision = runGit(fixture.root, ["rev-parse", "HEAD^{commit}"]);
    const evidenceTree = runGit(fixture.root, ["rev-parse", "HEAD^{tree}"]);
    runGit(fixture.root, ["update-ref", "refs/remotes/origin/production", evidenceRevision]);
    runGit(fixture.root, ["checkout", "--detach", evidenceRevision]);
    await assert.rejects(() => materialize(fixture, built),
      /HEAD and protected origin\/production at revision|source Git binding failed/u);
    assert.equal((await verify(fixture, built, bundle)).structurallyValid, true);
    assert.notEqual(producerRevision, fixture.revision);
    assert.notEqual(evidenceRevision, producerRevision);
    assert.equal(new Set([fixture.tree, producerTree, evidenceTree]).size, 3);
    assert.notEqual(
      sha256Digest(await readFile(path.join(fixture.root, bindingPath))),
      bundle.artifacts.cliReleaseBinding.replacesSha256,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("legacy caller summaries and unsigned production-shaped input never become release ready", async () => {
  const fixture = await fixtureRepository();
  try {
    await assert.rejects(
      materializeRobinhoodStageBundle({
        repositoryRoot: fixture.root,
        input: {
          schemaVersion: "programmable.robinhood-custom-launch.postdeployment-input.v1",
          chainDeploymentId: "robinhood-mainnet-custom-launch-v1",
          providers: [],
          ethereumFinality: {},
          sourceVerification: {},
          sourceClosure: {},
        },
      }),
      /stage source revision|exactly|capture/u,
    );
    const built = await buildInput(fixture);
    await assert.rejects(
      materializeRobinhoodStageBundle({
        repositoryRoot: fixture.root,
        input: built.input,
        inputBytes: built.bytes,
        captureAuthorization: built.authorization,
        captureDependencies: { ...testCaptureDependencies, allowTestOnly: false },
      }),
      /authorization|test-only/u,
    );
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "assemble-stage", "--input", built.path, "--repository-root", fixture.root,
      ]),
      /portable capture\/stage\/source attestations|protected GitHub context/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("test-only Phase B remains closed and canonical apply rejects it", async () => {
  const fixture = await fixtureRepository();
  try {
    const built = await buildInput(fixture);
    const stageResult = await runRobinhoodPostdeploymentCli([
      "assemble-stage", "--input", built.path, "--repository-root", fixture.root,
    ], cliDependencies(built));
    const stageBytes = await readFile(stageResult.outputPath);
    const stage = JSON.parse(stageBytes.toString("utf8"));
    const baselineBackend = testBackendEvidence(stage);
    const backend = testBackendEvidence(stage, { privateCanaries: true });
    assert.deepEqual(
      backend.input,
      baselineBackend.input,
      "private provider canaries cannot alter the public backend projection",
    );
    assert.equal(
      backend.inputBytes.equals(baselineBackend.inputBytes),
      true,
      "private provider canaries must preserve exact public bytes",
    );
    const backendPath = path.join(fixture.root, ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH);
    const authorizationPath = path.join(fixture.root, ROBINHOOD_BACKEND_AUTHORIZATION_PATH);
    const authorizationAttestationPath = path.join(
      fixture.root,
      ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH,
    );
    const attestationPath = path.join(fixture.root, ROBINHOOD_BACKEND_ATTESTATION_BUNDLE_PATH);
    await mkdir(path.dirname(backendPath), { recursive: true });
    await writeFile(backendPath, backend.inputBytes);
    await writeFile(attestationPath, backend.attestationBundleBytes);
    await writeFile(authorizationPath, `${JSON.stringify(backend.authorization, null, 2)}\n`);
    await writeFile(authorizationAttestationPath, backend.attestationBundleBytes);
    const validateStage = postdeploymentAjv.getSchema(
      "https://programmable.market/schemas/releases/custom-launch-v4/stage-bundle.schema.json",
    );
    const validateBackend = postdeploymentAjv.getSchema(
      "https://programmable.market/schemas/releases/custom-launch-v4/backend-promotion-public-input.schema.json",
    );
    assert.equal(validateStage(stage), true, JSON.stringify(validateStage.errors));
    assert.equal(validateBackend(backend.input), true, JSON.stringify(validateBackend.errors));
    const dependencies = {
      ...cliDependencies(built),
      authorizeBackendCapture: async () => backend.captureAuthorization,
      authorizeBackendPromotion: async () => ({ authorization: backend.authorization }),
      backendDependencies: backend.dependencies,
    };
    const promotion = await runRobinhoodPostdeploymentCli([
      "promote",
      "--stage", stageResult.outputPath,
      "--capture", built.path,
      "--backend-input", backendPath,
      "--backend-attestation-bundle", attestationPath,
      "--backend-authorization", authorizationPath,
      "--backend-authorization-attestation-bundle", authorizationAttestationPath,
      "--repository-root", fixture.root,
    ], dependencies);
    assert.equal(promotion.releaseReady, false);
    assert.equal(promotion.publicAuthorization, false);
    assert.equal(promotion.publicWrites, false);
    const bundle = JSON.parse(await readFile(promotion.outputPath, "utf8"));
    const validatePromotion = postdeploymentAjv.getSchema(
      "https://programmable.market/schemas/releases/custom-launch-v4/promotion-bundle.schema.json",
    );
    assert.equal(validatePromotion(bundle), true, JSON.stringify(validatePromotion.errors));
    assert.equal(bundle.state, "test-only-finalized");
    assert.equal(bundle.releaseReady, false);
    assert.equal(bundle.publicAuthorization, false);
    assert.equal(bundle.publicWrites, false);
    assert.equal(bundle.artifacts.cliReleaseBinding.value.releaseReady, false);
    assert.deepEqual(bundle.artifacts.cliReleaseBinding.value.blockers,
      ["releaseManifestEvidence"]);
    assert.equal(bundle.artifacts.cliReleaseBinding.value.evidence.manifest, null);
    assert.equal(bundle.finalizedBindings.releaseManifestDigest, null);
    assert.equal(bundle.consumerInputs.indexer.publicAuthorization, false);
    assert.equal(bundle.consumerInputs.cli.publicWrites, false);
    const publicBytes = await readFile(promotion.outputPath, "utf8");
    for (const privateKey of [
      "bodyBytesBase64", "sanitizedBytesBase64", "private_ip", "instance_id",
      "metadata", "config", "env",
    ]) {
      assert.equal(publicBytes.includes(`\"${privateKey}\"`), false,
        `public bundle leaked private backend field ${privateKey}`);
    }
    assert.deepEqual(Object.keys(bundle.backendPromotionBinding), [
      "schemaVersion", "publicArtifact", "publicInputDigest",
      "readbackReceipts", "backendPromotionInputDigest", "backendSource",
      "captureAuthorization", "runtimeReadiness", "flyControlPlane",
      "backendReleaseEvidenceDigest",
    ]);
    const verified = await runRobinhoodPostdeploymentCli([
      "verify-promotion",
      "--bundle", promotion.outputPath,
      "--stage", stageResult.outputPath,
      "--capture", built.path,
      "--backend-input", backendPath,
      "--backend-attestation-bundle", attestationPath,
      "--backend-authorization", authorizationPath,
      "--backend-authorization-attestation-bundle", authorizationAttestationPath,
      "--repository-root", fixture.root,
    ], dependencies);
    assert.equal(verified.releaseReady, false);
    const assetOutputRoot = await mkdtemp(path.join(os.tmpdir(), "programmable-assets-"));
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "materialize-release-assets",
        "--bundle", promotion.outputPath,
        "--stage", stageResult.outputPath,
        "--capture", built.path,
        "--backend-input", backendPath,
        "--backend-attestation-bundle", attestationPath,
        "--backend-authorization", authorizationPath,
        "--backend-authorization-attestation-bundle", authorizationAttestationPath,
        "--asset-output-root", assetOutputRoot,
        "--repository-root", fixture.root,
      ], dependencies),
      /non-production promotion bundle cannot materialize/u,
    );
    assert.deepEqual(await readdir(assetOutputRoot), []);
    await rm(assetOutputRoot, { recursive: true, force: true });
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "apply",
        "--bundle", promotion.outputPath,
        "--stage", stageResult.outputPath,
        "--capture", built.path,
        "--backend-input", backendPath,
        "--backend-attestation-bundle", attestationPath,
        "--backend-authorization", authorizationPath,
        "--backend-authorization-attestation-bundle", authorizationAttestationPath,
        "--repository-root", fixture.root,
      ], dependencies),
      /non-production promotion bundle/u,
    );
    await assert.rejects(
      readFile(path.join(fixture.root, ROBINHOOD_LIVE_DEPLOYMENT_PATH)),
      /ENOENT/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("apply replays old authenticated backend evidence but still requires fresh wall-clock state", async () => {
  const fixture = await fixtureRepository();
  try {
    const physicalRepositoryRoot = await realpath(fixture.root);
    const built = await buildInput(fixture);
    const captureAuthorization = buildRobinhoodCaptureAuthorization({
      ...structuredClone(built.authorization),
      trustClass: "github-artifact-attestation",
      verificationDigest: null,
    });
    const captureDependencies = {
      authorizeCapture: async () => captureAuthorization,
      captureDependencies: testCaptureDependencies,
    };
    const stageResult = await runRobinhoodPostdeploymentCli([
      "assemble-stage", "--input", built.path, "--repository-root", fixture.root,
    ], captureDependencies);
    const stage = JSON.parse(await readFile(stageResult.outputPath, "utf8"));
    const backend = testBackendEvidence(stage);
    const backendCaptureAuthorization = buildRobinhoodBackendCaptureAuthorization({
      ...structuredClone(backend.captureAuthorization),
      trustClass: ROBINHOOD_BACKEND_CAPTURE_TRUST_CLASS,
      verificationDigest: null,
    });
    const distinctRevision =
      `${fixture.revision[0] === "a" ? "b" : "a"}${fixture.revision.slice(1)}`;
    const distinctTree = `${fixture.tree[0] === "c" ? "d" : "c"}${fixture.tree.slice(1)}`;
    const backendAuthorization = buildRobinhoodBackendAuthorization({
      ...structuredClone(backend.authorization),
      trustClass: "github-artifact-attestation",
      producerRevision: distinctRevision,
      producerTree: distinctTree,
      authorizationDigest: null,
    });
    const backendPath = path.join(fixture.root, ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH);
    const backendAttestationPath = path.join(
      fixture.root,
      ROBINHOOD_BACKEND_ATTESTATION_BUNDLE_PATH,
    );
    const authorizationPath = path.join(fixture.root, ROBINHOOD_BACKEND_AUTHORIZATION_PATH);
    const authorizationAttestationPath = path.join(
      fixture.root,
      ROBINHOOD_BACKEND_AUTHORIZATION_ATTESTATION_PATH,
    );
    await mkdir(path.dirname(backendPath), { recursive: true });
    await writeFile(backendPath, backend.inputBytes);
    await writeFile(backendAttestationPath, backend.attestationBundleBytes);
    await writeFile(authorizationPath, `${JSON.stringify(backendAuthorization, null, 2)}\n`);
    await writeFile(authorizationAttestationPath, backend.attestationBundleBytes);
    const promotionDependencies = {
      ...captureDependencies,
      authorizeBackendCapture: async () => backendCaptureAuthorization,
      authorizeBackendPromotion: async () => ({ authorization: backendAuthorization }),
      backendDependencies: { now: backend.dependencies.now },
    };
    const evidenceArgs = [
      "--stage", stageResult.outputPath,
      "--capture", built.path,
      "--backend-input", backendPath,
      "--backend-attestation-bundle", backendAttestationPath,
      "--backend-authorization", authorizationPath,
      "--backend-authorization-attestation-bundle", authorizationAttestationPath,
    ];
    const promotionResult = await runRobinhoodPostdeploymentCli([
      "promote", ...evidenceArgs, "--repository-root", fixture.root,
    ], promotionDependencies);
    assert.equal(promotionResult.releaseReady, true);
    const promotion = JSON.parse(await readFile(promotionResult.outputPath, "utf8"));
    const liveBytes = Buffer.from(
      `${JSON.stringify(promotion.artifacts.liveDeployment.value, null, 2)}\n`,
      "utf8",
    );
    const bindingBytes = Buffer.from(
      `${JSON.stringify(promotion.artifacts.cliReleaseBinding.value, null, 2)}\n`,
      "utf8",
    );
    const livePath = path.join(fixture.root, promotion.artifacts.liveDeployment.path);
    await mkdir(path.dirname(livePath), { recursive: true });
    await writeFile(livePath, liveBytes);
    await writeFile(path.join(fixture.root, bindingPath), bindingBytes);

    const wallClock = () => new Date("2026-08-29T18:00:00Z");
    let freshBackendCalls = 0;
    const applyDependencies = {
      ...promotionDependencies,
      backendDependencies: { now: wallClock },
      freshNow: wallClock,
      freshVerifyProviders: async ({ now }) => {
        assert.equal(now().toISOString(), "2026-08-29T18:00:00.000Z");
        return {
          freshReadbackDigest: digest("fresh-apply-providers"),
          observedAt: "2026-08-29T18:00:00.000Z",
        };
      },
      freshVerifySourcify: async ({ now }) => {
        assert.equal(now().toISOString(), "2026-08-29T18:00:00.000Z");
        return {
          sourceVerificationClosureDigest: digest("fresh-apply-sourcify"),
          observedAt: "2026-08-29T18:00:00.000Z",
        };
      },
      freshVerifyBackend: async ({ now }) => {
        freshBackendCalls += 1;
        assert.equal(now().toISOString(), "2026-08-29T18:00:00.000Z");
        return {
          freshBackendReadbackDigest: digest("fresh-apply-backend"),
          observedAt: "2026-08-29T18:00:00.000Z",
        };
      },
      requireReleaseReady: ({ repositoryRoot: checkedRoot }) => {
        assert.equal(checkedRoot, physicalRepositoryRoot);
        return { bindingSha256: sha256Digest(bindingBytes) };
      },
    };
    const applyArgs = [
      "apply", "--bundle", promotionResult.outputPath, ...evidenceArgs,
      "--repository-root", physicalRepositoryRoot,
    ];
    const applied = await runRobinhoodPostdeploymentCli(applyArgs, applyDependencies);
    assert.equal(applied.releaseReady, true);
    assert.equal(applied.replayed, false);
    assert.equal(applied.freshBackendReadbackDigest, digest("fresh-apply-backend"));
    assert.equal(applied.freshObservedAt, "2026-08-29T18:00:00.000Z");
    assert.equal(freshBackendCalls, 1);
    await assert.rejects(
      runRobinhoodPostdeploymentCli(applyArgs, {
        ...applyDependencies,
        freshVerifyBackend: async ({ now }) => {
          assert.equal(now().toISOString(), "2026-08-29T18:00:00.000Z");
          throw new TypeError("fresh backend drift");
        },
      }),
      /fresh backend drift/u,
    );
    const oldObservedAt = "2026-08-29T17:59:00.000Z";
    await assert.rejects(
      runRobinhoodPostdeploymentCli(applyArgs, {
        ...applyDependencies,
        freshVerifyProviders: async () => ({
          freshReadbackDigest: digest("old-fresh-apply-providers"),
          observedAt: oldObservedAt,
        }),
        freshVerifySourcify: async () => ({
          sourceVerificationClosureDigest: digest("old-fresh-apply-sourcify"),
          observedAt: oldObservedAt,
        }),
        freshVerifyBackend: async () => ({
          freshBackendReadbackDigest: digest("old-fresh-apply-backend"),
          observedAt: oldObservedAt,
        }),
      }),
      /do not match the apply verification instant/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("backend raw promotion input rejects fake summaries, ref swaps, and incomplete Fly closure", async () => {
  const fixture = await fixtureRepository();
  try {
    const built = await buildInput(fixture);
    const stage = await materialize(fixture, built);
    const baseline = testBackendEvidence(stage);
    assert.match(baseline.evidence.backendReleaseEvidenceDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.throws(() => buildRobinhoodBackendPromotionPublicInputFromPrivate({
      privateInput: baseline.privateInput,
      privateInputBytes: Buffer.from("{}\n", "utf8"),
      stageBundle: stage,
      now: baseline.dependencies.now,
    }), /bytes differ from the validated value/u);
    assert.throws(() => buildRobinhoodBackendPromotionPublicInputFromPrivate({
      privateInput: baseline.privateInput,
      privateInputBytes: Buffer.from([0xff]),
      stageBundle: stage,
      now: baseline.dependencies.now,
    }), /utf-8/iu);

    for (const [label, mutate] of [
      ["OpenAPI", (value) => { value.openApiSha256 = `sha256:${"a".repeat(64)}`; }],
      ["finality", (value) => { value.finalityPolicy.policyId = "caller-authored"; }],
    ]) {
      const drift = structuredClone(baseline.privateInput);
      const readiness = responseBody(drift.readinessReadback);
      mutate(readiness);
      replaceResponseBody(drift.readinessReadback, readiness);
      const driftInput = buildRobinhoodBackendPromotionInput(drift);
      assert.throws(() => validateRobinhoodBackendPromotionInput({
        input: driftInput,
        stageBundle: stage,
        now: baseline.dependencies.now,
      }), /OpenAPI\/finality policy differs/u, label);
    }

    const appName = structuredClone(baseline.privateInput);
    const appBody = responseBody(appName.flyReadbacks[1]);
    appBody.app_name = appBody.name;
    delete appBody.name;
    replaceResponseBody(appName.flyReadbacks[1], appBody);
    const appNameInput = buildRobinhoodBackendPromotionInput(appName);
    assert.throws(() => validateRobinhoodBackendPromotionInput({
      input: appNameInput,
      stageBundle: stage,
      now: baseline.dependencies.now,
    }), /Fly app identity/u);

    const failedLatest = structuredClone(baseline.privateInput);
    const releaseBody = responseBody(failedLatest.flyReadbacks[0]);
    const older = releaseBody.data.app.releasesUnprocessed.nodes[0];
    releaseBody.data.app.releasesUnprocessed.nodes.push({
      ...structuredClone(older),
      id: "release_124",
      version: 124,
      status: "failed",
      stable: false,
      createdAt: "2026-08-29T12:00:00Z",
    });
    releaseBody.data.app.releasesUnprocessed.totalCount = 2;
    replaceResponseBody(failedLatest.flyReadbacks[0], releaseBody);
    const failedLatestInput = buildRobinhoodBackendPromotionInput(failedLatest);
    assert.throws(() => validateRobinhoodBackendPromotionInput({
      input: failedLatestInput,
      stageBundle: stage,
      now: baseline.dependencies.now,
    }), /absolute latest release is not complete and stable/u);

    assert.throws(() => validateRobinhoodBackendPromotionInput({
      input: baseline.privateInput,
      stageBundle: stage,
      now: () => new Date("2026-08-29T12:16:01Z"),
    }), /stale or future-dated/u);

    const wrongCaptureRef = buildRobinhoodBackendCaptureAuthorization({
      ...structuredClone(baseline.captureAuthorization),
      sourceRef: "refs/heads/production",
      verificationDigest: null,
    });
    await assert.rejects(() => materializeRobinhoodPromotionBundle({
      repositoryRoot: fixture.root,
      stageBundle: stage,
      input: built.input,
      inputBytes: built.bytes,
      captureAuthorization: built.authorization,
      captureDependencies: testCaptureDependencies,
      backendPromotionInput: baseline.input,
      backendPromotionInputBytes: baseline.inputBytes,
      backendAttestationBundleBytes: baseline.attestationBundleBytes,
      backendCaptureAuthorization: wrongCaptureRef,
      backendAuthorization: baseline.authorization,
      backendDependencies: baseline.dependencies,
    }), /protected backend source/u);

    for (const verifiedAt of ["2026-08-29T11:59:59Z", "2026-08-29T12:10:01Z"]) {
      const invalidClock = buildRobinhoodBackendCaptureAuthorization({
        ...structuredClone(baseline.captureAuthorization),
        verifiedAt,
        verificationDigest: null,
      });
      await assert.rejects(() => materializeRobinhoodPromotionBundle({
        repositoryRoot: fixture.root,
        stageBundle: stage,
        input: built.input,
        inputBytes: built.bytes,
        captureAuthorization: built.authorization,
        captureDependencies: testCaptureDependencies,
        backendPromotionInput: baseline.input,
        backendPromotionInputBytes: baseline.inputBytes,
        backendAttestationBundleBytes: baseline.attestationBundleBytes,
        backendCaptureAuthorization: invalidClock,
        backendAuthorization: baseline.authorization,
        backendDependencies: baseline.dependencies,
      }), /authorization time.*capture window/u);
    }

    const reorderedPublic = structuredClone(baseline.input);
    [reorderedPublic.readbackReceipts.fly[0], reorderedPublic.readbackReceipts.fly[1]] =
      [reorderedPublic.readbackReceipts.fly[1], reorderedPublic.readbackReceipts.fly[0]];
    const reorderedPublicInput = buildRobinhoodBackendPromotionPublicInput(reorderedPublic);
    assert.throws(() => validateRobinhoodBackendPromotionPublicInput({
      input: reorderedPublicInput,
      stageBundle: stage,
      now: baseline.dependencies.now,
    }), /safe receipt|incomplete|digest/u);

    const wrongFinalRef = buildRobinhoodBackendAuthorization({
      ...structuredClone(baseline.authorization),
      sourceRef: "refs/heads/main",
      authorizationDigest: null,
    });
    await assert.rejects(() => materializeRobinhoodPromotionBundle({
      repositoryRoot: fixture.root,
      stageBundle: stage,
      input: built.input,
      inputBytes: built.bytes,
      captureAuthorization: built.authorization,
      captureDependencies: testCaptureDependencies,
      backendPromotionInput: baseline.input,
      backendPromotionInputBytes: baseline.inputBytes,
      backendAttestationBundleBytes: baseline.attestationBundleBytes,
      backendCaptureAuthorization: baseline.captureAuthorization,
      backendAuthorization: wrongFinalRef,
      backendDependencies: baseline.dependencies,
    }), /exact production evidence/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("fresh backend replay re-reads the full readiness and Fly inventory", async () => {
  const fixture = await fixtureRepository();
  try {
    const built = await buildInput(fixture);
    const stage = await materialize(fixture, built);
    const backend = testBackendEvidence(stage);
    const fresh = await freshVerifyRobinhoodBackendPromotionInput({
      stageBundle: stage,
      capturedInput: backend.input,
      fetch: freshBackendFetch(backend.privateInput, {
        responseDate: "Sat, 29 Aug 2026 18:00:00 GMT",
      }),
      flyApiToken: "protected-test-token-value",
      now: () => new Date("2026-08-29T18:00:00Z"),
    });
    assert.equal(fresh.observedAt, "2026-08-29T18:00:00.000Z");
    assert.match(fresh.freshBackendReadbackDigest, /^sha256:[0-9a-f]{64}$/u);
    const privateCanary = await freshVerifyRobinhoodBackendPromotionInput({
      stageBundle: stage,
      capturedInput: backend.input,
      fetch: freshBackendFetch(backend.privateInput, {
        privateCanaries: true,
        responseDate: "Sat, 29 Aug 2026 18:00:00 GMT",
      }),
      flyApiToken: "protected-test-token-value",
      now: () => new Date("2026-08-29T18:00:00Z"),
    });
    assert.equal(
      privateCanary.backendPromotionInputDigest,
      fresh.backendPromotionInputDigest,
      "fresh backend output must expose the semantic public digest, never the raw-private digest",
    );
    assert.equal(privateCanary.freshBackendReadbackDigest, fresh.freshBackendReadbackDigest);
    const later = await freshVerifyRobinhoodBackendPromotionInput({
      stageBundle: stage,
      capturedInput: backend.input,
      fetch: freshBackendFetch(backend.privateInput, {
        responseDate: "Sat, 29 Aug 2026 18:01:00 GMT",
      }),
      flyApiToken: "protected-test-token-value",
      now: () => new Date("2026-08-29T18:01:00Z"),
    });
    assert.equal(later.observedAt, "2026-08-29T18:01:00.000Z");
    assert.notEqual(
      later.freshBackendReadbackDigest,
      fresh.freshBackendReadbackDigest,
      "an older backend freshness digest must not replay at a later observation instant",
    );
    await assert.rejects(() => freshVerifyRobinhoodBackendPromotionInput({
      stageBundle: stage,
      capturedInput: backend.input,
      fetch: freshBackendFetch(backend.privateInput, {
        driftMachineImage: true,
        responseDate: "Sat, 29 Aug 2026 18:00:00 GMT",
      }),
      flyApiToken: "protected-test-token-value",
      now: () => new Date("2026-08-29T18:00:00Z"),
    }), /machine identity|fresh backend\/Fly readback differs/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects recomputed adversarial raw capture variants", async () => {
  const cases = [
    ["empty Safe logs", { emptySafeLogs: true }, /SafeSetup \+ ProxyCreation/u],
    ["raw tx hash", { wrongTransactionHash: true }, /raw signed transaction/u],
    ["receipt inclusion", { wrongReceiptBlock: true }, /transaction, and receipt disagree/u],
    ["receipt log inclusion", { wrongReceiptLogBlock: true }, /outside the exact receipt inclusion/u],
    ["NodeInterface calldata", { wrongNodeCalldata: true }, /pinned eth_call/u],
    ["batch disagreement", { secondBatchNumber: "153047" }, /L2 providers disagree/u],
    ["wrong SequencerInbox", { wrongSequencerInbox: true }, /pinned.*batch|SequencerInbox/iu],
    ["posting receipt target", { wrongPostingReceiptTarget: true }, /posting receipt.*inclusion/u],
    ["finalized reorg", { finalizedRereadHash: hash32("reorg") }, /changed on reread/u],
    ["partial Sourcify", { sourcifyMatch: "match" }, /exact creation-and-runtime/u],
    ["wrong Sourcify address", { wrongSourcifyAddress: true }, /exact creation-and-runtime/u],
    ["reordered inventory", { reorderL2Inventory: true }, /missing or reorders/u],
    ["late external code", { lateExternalCode: true }, /runtime code hash|transition/u],
    ["preexisting external code", { preexistingExternalCode: true }, /runtime code hash|transition/u],
    ["wrong external receipt block", { lateExternalReceipt: true }, /OwnershipTransferred|CREATE2 deployment transition/u],
    ["external block-hash relabel", { externalBlockHashRelabel: true }, /OwnershipTransferred|CREATE2 deployment transition/u],
    ["wrong external CREATE2 deployer", { wrongExternalDeployer: true }, /CREATE2 deployment transition/u],
    ["wrong external raw transaction hash", { wrongExternalRawHash: true }, /CREATE2 deployment transition/u],
    ["wrong external recovered signer", { wrongExternalSigner: true }, /CREATE2 deployment transition/u],
    ["wrong external decoded input", { wrongExternalInput: true }, /CREATE2 calldata|CREATE2 deployment transition/u],
    ["wrong external CREATE2 salt", { wrongExternalSalt: true }, /salt\/initcode/u],
    ["empty external CREATE2 initcode", { emptyExternalInitCode: true }, /calldata|salt\/initcode/u],
    ["wrong external CREATE2 derived address", { wrongExternalDerivedAddress: true }, /CREATE2 deployment transition/u],
    ["wrong external receipt target", { wrongExternalReceiptTarget: true }, /CREATE2 deployment transition/u],
    ["wrong external transaction block", { lateExternalTransaction: true }, /CREATE2 deployment transition/u],
    ["wrong CREATE2 deployer runtime", { wrongCreate2DeployerCode: true }, /runtime code hash/u],
    ["numeric deployment state ref", { numericDeploymentStateRef: true }, /pinned eth_getCode/u],
    ["numeric predecessor state ref", { numericPredecessorStateRef: true }, /pinned eth_getCode/u],
    ["requireCanonical false", { falseCanonicalStateRef: true }, /pinned eth_getCode/u],
    ["requireCanonical omitted", { missingCanonicalStateRef: true }, /pinned eth_getCode/u],
    ["D and D-1 state refs swapped", { swappedStateBlockRefs: true }, /pinned eth_getCode/u],
    ["PoolManager ownership log extra", { extraExternalReceiptLog: true }, /OwnershipTransferred/u],
    ["PoolManager ownership log address", { wrongPoolManagerLogAddress: true }, /OwnershipTransferred/u],
    ["PoolManager ownership log topic", { wrongPoolManagerLogTopic: true }, /OwnershipTransferred/u],
    ["PoolManager ownership log owner", { wrongPoolManagerLogOwner: true }, /OwnershipTransferred/u],
    ["PoolManager ownership log index", { wrongPoolManagerLogIndex: true }, /OwnershipTransferred/u],
    ["PoolManager ownership log data", { wrongPoolManagerLogData: true }, /OwnershipTransferred/u],
    ["PoolManager ownership log inclusion", { wrongPoolManagerLogInclusion: true }, /OwnershipTransferred/u],
    ["extra Safe receipt log", { extraSafeReceiptLog: true }, /SafeSetup \+ ProxyCreation/u],
    ["extra posting receipt log", { extraPostingReceiptLog: true }, /SequencerBatchDelivered/u],
  ];
  for (const [label, options, expected] of cases) {
    const fixture = await fixtureRepository();
    try {
      await assert.rejects(async () => {
        const built = await buildInput(fixture, options);
        await materialize(fixture, built);
      }, expected, label);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

test("bundle verification rejects capture, consumer, and digest substitution", async () => {
  const fixture = await fixtureRepository();
  try {
    const built = await buildInput(fixture);
    const bundle = await materialize(fixture, built);
    const consumerTamper = structuredClone(bundle);
    consumerTamper.consumerInputs.indexer.router.startBlock = "1";
    await assert.rejects(() => verify(fixture, built, consumerTamper), /differs/u);
    const captureTamper = structuredClone(bundle);
    captureTamper.captureClosure.postingEvent.afterAcc = hash32("tamper");
    await assert.rejects(() => verify(fixture, built, captureTamper), /differs/u);
    const digestTamper = structuredClone(bundle);
    digestTamper.stageBundleDigest = `sha256:${"0".repeat(64)}`;
    await assert.rejects(() => verify(fixture, built, digestTamper), /differs/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("CLI exclusively creates only the canonical bundle and rejects protected/symlink aliases", async () => {
  const fixture = await fixtureRepository();
  const outside = await mkdtemp(path.join(os.tmpdir(), "programmable-postdeploy-output-"));
  try {
    const built = await buildInput(fixture);
    const dependencies = cliDependencies(built);
    const assembled = await runRobinhoodPostdeploymentCli([
      "assemble-stage", "--input", built.path, "--repository-root", fixture.root,
    ], dependencies);
    assert.equal(assembled.releaseReady, false);
    assert.equal(assembled.wroteLiveArtifacts, false);
    const preparedBefore = await readFile(path.join(
      fixture.root,
      ROBINHOOD_PREDEPLOYMENT_PATH,
    ));
    const bindingBefore = await readFile(path.join(fixture.root, bindingPath));
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "apply", "--bundle", assembled.outputPath, "--capture", built.path,
        "--repository-root", fixture.root,
      ], dependencies),
      /Usage/u,
    );
    assert.deepEqual(await readFile(path.join(
      fixture.root,
      ROBINHOOD_PREDEPLOYMENT_PATH,
    )), preparedBefore);
    assert.deepEqual(await readFile(path.join(fixture.root, bindingPath)), bindingBefore);
    await assert.rejects(
      readFile(path.join(fixture.root, ROBINHOOD_LIVE_DEPLOYMENT_PATH)),
      /ENOENT/u,
    );
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "assemble-stage", "--input", built.path,
        "--output", path.join(fixture.root, ROBINHOOD_PREDEPLOYMENT_PATH),
        "--repository-root", fixture.root,
      ], dependencies),
      /canonical path|symbolic-link parent/u,
    );
    await symlink(outside, path.join(fixture.root, "output-link"));
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "assemble-stage", "--input", built.path,
        "--output", path.join(fixture.root, "output-link", "bundle.json"),
        "--repository-root", fixture.root,
      ], dependencies),
      /canonical path|symbolic-link parent/u,
    );
    const captureAlias = path.join(fixture.root, "capture-alias.json");
    await symlink(built.path, captureAlias);
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "verify-stage",
        "--stage", assembled.outputPath,
        "--capture", captureAlias,
        "--repository-root", fixture.root,
      ], dependencies),
      /must be a bounded regular file/u,
    );
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "assemble-stage", "--input", built.path, "--repository-root", fixture.root,
      ], dependencies),
      /EEXIST/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("phase-A staging copies exact backend assets and rejects missing, tampered, or escaped targets", async () => {
  const fixture = await fixtureRepository();
  const backendRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "programmable-backend-assets-")),
  );
  const escapedRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "programmable-backend-escape-")),
  );
  const outside = await mkdtemp(path.join(os.tmpdir(), "programmable-backend-outside-"));
  try {
    const built = await buildInput(fixture);
    const dependencies = cliDependencies(built);
    const captureAttestationPath = path.join(
      fixture.root,
      "programmable-postdeployment-capture.attestation.json",
    );
    const stageAttestationPath = path.join(
      fixture.root,
      "programmable-stage-bundle.attestation.json",
    );
    await writeFile(captureAttestationPath, built.attestationBundleBytes);
    await writeFile(stageAttestationPath, dependencies.stageAttestationBundleBytes);
    const portableStageArguments = [
      "--capture-attestation-bundle", captureAttestationPath,
      "--stage-attestation-bundle", stageAttestationPath,
    ];
    const assembled = await runRobinhoodPostdeploymentCli([
      "assemble-stage", "--input", built.path, "--repository-root", fixture.root,
    ], dependencies);
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "stage-backend-assets",
        "--stage", assembled.outputPath,
        "--capture", built.path,
        "--stage-attestation-bundle", stageAttestationPath,
        "--backend-service-root", backendRoot,
        "--repository-root", fixture.root,
      ], dependencies),
      /Usage:/u,
    );
    const staged = await runRobinhoodPostdeploymentCli([
      "stage-backend-assets",
      "--stage", assembled.outputPath,
      "--capture", built.path,
      ...portableStageArguments,
      "--backend-service-root", backendRoot,
      "--repository-root", fixture.root,
    ], dependencies);
    assert.equal(staged.releaseReady, false);
    assert.deepEqual(staged.assets.map((asset) => asset.path), [
      "release/robinhood-v4-chain-deployment.v1.json",
      "release/robinhood-v4-prepared-root-source-manifest.v1.json",
      "release/assets/robinhood-v4/ProgrammableLaunchStampRouterV1.standard-input.json",
      "release/assets/robinhood-v4/ProgrammableCreate2GraphDeployerV1.standard-input.json",
      ROBINHOOD_BACKEND_PHASE_A_PRODUCTION_CAPTURE_PATH,
      ROBINHOOD_BACKEND_PHASE_A_PRODUCTION_CAPTURE_ATTESTATION_PATH,
      ROBINHOOD_BACKEND_PHASE_A_STAGE_BUNDLE_PATH,
      ROBINHOOD_BACKEND_PHASE_A_STAGE_ATTESTATION_PATH,
    ]);
    for (const asset of staged.assets) {
      assert.equal(sha256Digest(await readFile(asset.output)), asset.sha256);
    }
    const stagedPhaseA = staged.assets.find(
      (asset) => asset.path === ROBINHOOD_BACKEND_PHASE_A_STAGE_BUNDLE_PATH,
    );
    const stagedPhaseAAttestation = staged.assets.find(
      (asset) => asset.path === ROBINHOOD_BACKEND_PHASE_A_STAGE_ATTESTATION_PATH,
    );
    assert.ok(stagedPhaseA);
    assert.ok(stagedPhaseAAttestation);
    const stagedCapture = staged.assets.find(
      (asset) => asset.path === ROBINHOOD_BACKEND_PHASE_A_PRODUCTION_CAPTURE_PATH,
    );
    const stagedCaptureAttestation = staged.assets.find(
      (asset) => asset.path
        === ROBINHOOD_BACKEND_PHASE_A_PRODUCTION_CAPTURE_ATTESTATION_PATH,
    );
    assert.ok(stagedCapture);
    assert.ok(stagedCaptureAttestation);
    assert.deepEqual(await readFile(stagedCapture.output), built.bytes);
    assert.deepEqual(
      await readFile(stagedCaptureAttestation.output),
      built.attestationBundleBytes,
    );
    assert.deepEqual(await readFile(stagedPhaseA.output), await readFile(assembled.outputPath));
    assert.deepEqual(
      await readFile(stagedPhaseAAttestation.output),
      dependencies.stageAttestationBundleBytes,
    );
    const signedStage = JSON.parse(await readFile(assembled.outputPath, "utf8"));
    const bridgedCapture = JSON.parse(await readFile(stagedCapture.output, "utf8"));
    assert.equal(
      bridgedCapture.schemaVersion,
      "programmable.robinhood-custom-launch.postdeployment-input.v3",
    );
    assert.equal(
      bridgedCapture.capture.schemaVersion,
      "programmable.robinhood-custom-launch.production-capture.v3",
    );
    assert.equal(
      sha256CaptureBytes(await readFile(stagedCapture.output)),
      signedStage.captureAuthorization.subjectSha256,
    );
    assert.equal(
      sha256Digest(await readFile(stagedCaptureAttestation.output)),
      signedStage.captureAuthorization.attestationBundleSha256,
    );
    assert.equal(
      computeRobinhoodCaptureClosureDigest(bridgedCapture.capture),
      bridgedCapture.capture.captureClosureDigest,
    );
    const stagedDescriptor = staged.assets.find(
      (asset) => asset.path === "release/robinhood-v4-chain-deployment.v1.json",
    );
    assert.ok(stagedDescriptor);
    assert.deepEqual(
      await readFile(stagedDescriptor.output),
      Buffer.from(`${JSON.stringify(
        signedStage.artifacts.backendRelease.chainDeployment.value,
        null,
        2,
      )}\n`, "utf8"),
    );
    const descriptor = JSON.parse(await readFile(stagedDescriptor.output, "utf8"));
    const ethereumFinality = descriptor.deploymentEvidence.ethereumFinalityEvidence;
    for (const field of [
      "captureClosureDigest", "postingEventDigest", "l1EvidenceDigest",
    ]) {
      assert.match(ethereumFinality[field], /^sha256:[0-9a-f]{64}$/u, field);
    }
    const substitutedCaptureAttestationPath = path.join(
      fixture.root,
      "substituted-capture.attestation.json",
    );
    await writeFile(
      substitutedCaptureAttestationPath,
      Buffer.from("substituted-capture-attestation\n", "utf8"),
    );
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "stage-backend-assets",
        "--stage", assembled.outputPath,
        "--capture", built.path,
        "--capture-attestation-bundle", substitutedCaptureAttestationPath,
        "--stage-attestation-bundle", stageAttestationPath,
        "--backend-service-root", backendRoot,
        "--repository-root", fixture.root,
      ], dependencies),
      /capture attestation differs from the authenticated closure/u,
    );
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "stage-backend-assets",
        "--stage", assembled.outputPath,
        "--capture", built.path,
        ...portableStageArguments,
        "--backend-service-root", fixture.root,
        "--repository-root", fixture.root,
      ], dependencies),
      /outside the PROGRAMMABLE repository/u,
    );
    const rootAlias = path.join(escapedRoot, "backend-root-link");
    await symlink(outside, rootAlias);
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "stage-backend-assets",
        "--stage", assembled.outputPath,
        "--capture", built.path,
        ...portableStageArguments,
        "--backend-service-root", rootAlias,
        "--repository-root", fixture.root,
      ], dependencies),
      /backend service root must be a physical directory/u,
    );
    await writeFile(staged.assets[2].output, "tampered\n", "utf8");
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "stage-backend-assets",
        "--stage", assembled.outputPath,
        "--capture", built.path,
        ...portableStageArguments,
        "--backend-service-root", backendRoot,
        "--repository-root", fixture.root,
      ], dependencies),
      /existing backend release asset.*differs/u,
    );
    const missing = JSON.parse(await readFile(assembled.outputPath, "utf8"));
    missing.artifacts.backendRelease.standardJsonInputs.pop();
    const missingPath = path.join(fixture.root, "missing-backend-asset-bundle.json");
    await writeFile(missingPath, `${JSON.stringify(missing, null, 2)}\n`, "utf8");
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "stage-backend-assets",
        "--stage", missingPath,
        "--capture", built.path,
        ...portableStageArguments,
        "--backend-service-root", escapedRoot,
        "--repository-root", fixture.root,
      ], dependencies),
      /differs/u,
    );
    await symlink(outside, path.join(escapedRoot, "release"));
    await assert.rejects(
      runRobinhoodPostdeploymentCli([
        "stage-backend-assets",
        "--stage", assembled.outputPath,
        "--capture", built.path,
        ...portableStageArguments,
        "--backend-service-root", escapedRoot,
        "--repository-root", fixture.root,
      ], dependencies),
      /symbolic link/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(backendRoot, { recursive: true, force: true });
    await rm(escapedRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("backend capture authorization requires exact standardized keyless Sigstore bytes", async () => {
  const fixture = await fixtureRepository();
  try {
    const built = await buildInput(fixture);
    const stage = await materialize(fixture, built);
    const backend = testBackendEvidence(stage);
    const productionAuthorization = buildRobinhoodBackendCaptureAuthorization({
      ...structuredClone(backend.captureAuthorization),
      trustClass: ROBINHOOD_BACKEND_CAPTURE_TRUST_CLASS,
      verificationDigest: null,
    });
    assert.doesNotThrow(() => validateRobinhoodBackendCaptureAuthorization({
      authorization: productionAuthorization,
      inputBytes: backend.inputBytes,
      attestationBundleBytes: backend.attestationBundleBytes,
      input: backend.input,
    }));
    assert.deepEqual(buildRobinhoodBackendCosignVerifyBlobArgs({
      subjectPath: "/tmp/backend-promotion-input.public.json",
      bundlePath: "/tmp/backend-promotion-input.attestation.json",
      sourceCommit: backend.input.backendSource.sourceCommit,
    }), [
      "verify-blob",
      "--bundle", "/tmp/backend-promotion-input.attestation.json",
      "--certificate-identity", ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY,
      "--certificate-oidc-issuer", ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_OIDC_ISSUER,
      "--certificate-github-workflow-name", ROBINHOOD_BACKEND_CAPTURE_WORKFLOW_NAME,
      "--certificate-github-workflow-repository", backend.input.backendSource.repository,
      "--certificate-github-workflow-ref", ROBINHOOD_BACKEND_CAPTURE_SOURCE_REF,
      "--certificate-github-workflow-sha", backend.input.backendSource.sourceCommit,
      "--certificate-github-workflow-trigger", ROBINHOOD_BACKEND_CAPTURE_TRIGGER,
      "/tmp/backend-promotion-input.public.json",
    ]);
    assert.equal(buildRobinhoodBackendCosignVerifyBlobArgs({
      subjectPath: "/tmp/backend-promotion-input.public.json",
      bundlePath: "/tmp/backend-promotion-input.attestation.json",
      sourceCommit: backend.input.backendSource.sourceCommit,
    }).some((argument) => argument.startsWith("--insecure")), false);

    const authorizationMutations = [
      ["legacy trust", { trustClass: "github-artifact-attestation" }],
      ["legacy schema", {
        schemaVersion: "programmable.robinhood-custom-launch.backend-capture-authorization.v2",
      }],
      ["legacy bundle", {
        bundleMediaType: "application/vnd.dev.sigstore.bundle+json;version=0.2",
      }],
      ["old verifier", {
        verifier: { ...productionAuthorization.verifier, version: "v3.1.2" },
      }],
      ["verifier digest", {
        verifier: { ...productionAuthorization.verifier, sha256: digest("wrong-cosign") },
      }],
      ["certificate identity", { certificateIdentity: "https://github.com/attacker" }],
      ["certificate issuer", { certificateOidcIssuer: "https://issuer.invalid" }],
      ["workflow name", { certificateGithubWorkflowName: "Attacker workflow" }],
      ["workflow repository", { certificateGithubWorkflowRepository: "attacker/repo" }],
      ["workflow ref", { certificateGithubWorkflowRef: "refs/heads/unprotected" }],
      ["workflow SHA", { certificateGithubWorkflowSha: "1".repeat(40) }],
      ["workflow trigger", { certificateGithubWorkflowTrigger: "push" }],
    ];
    for (const [label, override] of authorizationMutations) {
      assert.throws(() => {
        const candidate = buildRobinhoodBackendCaptureAuthorization({
          ...structuredClone(productionAuthorization),
          ...override,
          verificationDigest: null,
        });
        validateRobinhoodBackendCaptureAuthorization({
          authorization: candidate,
          inputBytes: backend.inputBytes,
          attestationBundleBytes: backend.attestationBundleBytes,
          input: backend.input,
        });
      }, /protected backend source|authorization/u, label);
    }

    const legacyBundle = Buffer.from(JSON.stringify({
      mediaType: "application/vnd.dev.sigstore.bundle+json;version=0.2",
      verificationMaterial: { certificate: { rawBytes: "dGVzdA==" }, tlogEntries: [{}] },
      messageSignature: {
        messageDigest: {
          algorithm: "SHA2_256",
          digest: createHash("sha256").update(backend.inputBytes).digest("base64"),
        },
        signature: "dGVzdA==",
      },
    }), "utf8");
    assert.throws(() => validateSigstoreMessageBundleV03({
      bundleBytes: legacyBundle,
      subjectBytes: backend.inputBytes,
    }), /standardized v0\.3/u);

    const publicKeyBundle = JSON.parse(backend.attestationBundleBytes.toString("utf8"));
    delete publicKeyBundle.verificationMaterial.certificate;
    publicKeyBundle.verificationMaterial.publicKey = { hint: "dGVzdA==" };
    assert.throws(() => validateSigstoreMessageBundleV03({
      bundleBytes: Buffer.from(JSON.stringify(publicKeyBundle), "utf8"),
      subjectBytes: backend.inputBytes,
    }), /keyless certificate/u);

    assert.throws(() => validateSigstoreMessageBundleV03({
      bundleBytes: backend.attestationBundleBytes,
      subjectBytes: Buffer.from("substituted backend public input\n", "utf8"),
    }), /exact subject bytes/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("fresh apply-time provider replay revalidates the complete raw inventory and rejects drift", async () => {
  const fixture = await fixtureRepository();
  try {
    const built = await buildInput(fixture);
    const bundle = await materialize(fixture, built);
    const rpcUrls = {
      robinhood: [
        "https://robinhood.drpc.org/protected-test-key",
        "https://robinhood.g.alchemy.com/v2/protected-test-key",
      ],
      ethereum: [
        "https://ethereum.drpc.org/protected-test-key",
        "https://ethereum.quiknode.pro/protected-test-key",
      ],
    };
    const replayed = await freshVerifyRobinhoodProviderReadbacks({
      capture: built.input.capture,
      captureClosure: bundle.captureClosure,
      rpcUrls,
      fetch: freshRpcFetch(built),
      ...testCaptureDependencies,
      now: () => new Date("2026-08-29T18:02:00.000Z"),
    });
    assert.equal(replayed.batchNumber, "153046");
    assert.equal(replayed.observedAt, "2026-08-29T18:02:00.000Z");
    assert.match(replayed.freshReadbackDigest, /^sha256:[0-9a-f]{64}$/u);
    const later = await freshVerifyRobinhoodProviderReadbacks({
      capture: built.input.capture,
      captureClosure: bundle.captureClosure,
      rpcUrls,
      fetch: freshRpcFetch(built),
      ...testCaptureDependencies,
      now: () => new Date("2026-08-29T18:03:00.000Z"),
    });
    assert.notEqual(
      later.freshReadbackDigest,
      replayed.freshReadbackDigest,
      "an older provider freshness digest must not replay at a later observation instant",
    );
    await assert.rejects(
      freshVerifyRobinhoodProviderReadbacks({
        capture: built.input.capture,
        captureClosure: bundle.captureClosure,
        rpcUrls,
        fetch: freshRpcFetch(built, { secondL2Batch: "153047" }),
        ...testCaptureDependencies,
        now: () => new Date("2026-08-29T18:04:00.000Z"),
      }),
      /fresh.*L2|providers disagree|batch/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("fresh Sourcify normalization ignores provider-only canaries and binds its observation time", async () => {
  const fixture = await fixtureRepository();
  try {
    const built = await buildInput(fixture);
    const bundle = await materialize(fixture, built);
    const verifyAt = async (observedAt, providerOnlyCanary = false) =>
      freshVerifyRobinhoodSourcify({
        repositoryRoot: fixture.root,
        captureClosure: bundle.captureClosure,
        readFile: (root, relativePath) => readFileSync(path.join(root, relativePath)),
        fetch: await freshSourcifyFetch(fixture, { providerOnlyCanary }),
        now: () => new Date(observedAt),
      });
    const baseline = await verifyAt("2026-08-29T18:05:00.000Z");
    const canary = await verifyAt("2026-08-29T18:05:00.000Z", true);
    assert.equal(baseline.observedAt, "2026-08-29T18:05:00.000Z");
    assert.deepEqual(
      Buffer.from(`${JSON.stringify(canary.responses)}\n`, "utf8"),
      Buffer.from(`${JSON.stringify(baseline.responses)}\n`, "utf8"),
      "provider-only raw fields must not alter normalized public Sourcify bytes",
    );
    assert.equal(
      canary.sourceVerificationClosureDigest,
      baseline.sourceVerificationClosureDigest,
      "provider-only raw fields must not alter the public Sourcify digest",
    );
    const later = await verifyAt("2026-08-29T18:06:00.000Z");
    assert.notEqual(
      later.sourceVerificationClosureDigest,
      baseline.sourceVerificationClosureDigest,
      "an older Sourcify freshness digest must not replay at a later observation instant",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function fixtureRepository() {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "programmable-robinhood-postdeploy-"));
  for (const relativePath of [
    ROBINHOOD_PREDEPLOYMENT_PATH,
    bindingPath,
    ...sourcePaths,
    ...machinePaths,
  ]) {
    const destination = path.join(rootPath, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(repositoryRoot, relativePath), destination);
  }
  runGit(rootPath, ["init", "-b", "temporary-local-branch"]);
  runGit(rootPath, ["add", "-A"]);
  runGit(rootPath, [
    "-c", "commit.gpgsign=false",
    "-c", "user.name=Programmable Release Test",
    "-c", "user.email=release-test@programmable.invalid",
    "commit", "-m", "fixture",
  ]);
  const revision = runGit(rootPath, ["rev-parse", "HEAD"]);
  runGit(rootPath, ["update-ref", "refs/remotes/origin/production", revision]);
  runGit(rootPath, ["checkout", "--detach", revision]);
  return {
    root: rootPath,
    revision,
    tree: runGit(rootPath, ["rev-parse", "HEAD^{tree}"]),
  };
}

async function buildInput(fixture, options = {}) {
  const safeLogs = options.emptySafeLogs ? [] : buildSafeLogs();
  const normalizedLogs = safeLogs.map((log) => ({
    address: log.address,
    topics: [...log.topics],
    data: log.data,
    logIndex: BigInt(log.logIndex).toString(10),
  }));
  const atomicNames = ["permitAuthority", "graphFactory", "programmableLaunchStampRouter"];
  const externalNames = ["poolManager", "positionManager", "stateView", "v4Quoter", "universalRouter"];
  const providers = [
    { providerId: "drpc", trustDomain: "drpc.org" },
    { providerId: "alchemy", trustDomain: "alchemy.com" },
  ].map((provider) => ({
    ...provider,
    transaction: {
      hash: TRANSACTION_HASH,
      from: OWNER,
      to: MULTICALL3,
      valueWei: "0",
      selector: "0x82ad56cb",
      calldataHash: OWNER_CALLDATA_HASH,
      calldataBytes: 33_412,
      nonce: "7",
      transactionIndex: "2",
      blockNumber: BLOCK_NUMBER,
      blockHash: BLOCK_HASH,
    },
    receipt: {
      transactionHash: TRANSACTION_HASH,
      from: OWNER,
      to: MULTICALL3,
      status: "1",
      transactionIndex: "2",
      blockNumber: BLOCK_NUMBER,
      blockHash: BLOCK_HASH,
      logs: normalizedLogs,
    },
    multicall3: {
      address: MULTICALL3,
      runtimeCodeHash:
        "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891",
    },
    atomicRoots: atomicNames.map((contract) => ({
      contract,
      address: ROOTS[contract].address,
      preDeploymentBlockNumber: (BigInt(BLOCK_NUMBER) - 1n).toString(10),
      preDeploymentBlockHash: PREDECESSOR_HASH,
      preDeploymentRuntimeCodeHash:
        "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
      deploymentBlockNumber: BLOCK_NUMBER,
      deploymentBlockHash: BLOCK_HASH,
      deploymentRuntimeCodeHash: ROOTS[contract].runtimeCodeHash,
    })),
    routerState: {
      address: ROOTS.programmableLaunchStampRouter.address,
      runtimeCodeHash: ROOTS.programmableLaunchStampRouter.runtimeCodeHash,
      chainId: "4663",
      permitAuthority: ROOTS.permitAuthority.address,
      permitAuthorityRuntimeCodeHash: ROOTS.permitAuthority.runtimeCodeHash,
      graphFactory: ROOTS.graphFactory.address,
      graphFactoryRuntimeCodeHash: ROOTS.graphFactory.runtimeCodeHash,
      poolManager: ROOTS.poolManager.address,
      poolManagerRuntimeCodeHash: ROOTS.poolManager.runtimeCodeHash,
    },
    safeState: {
      blockNumber: BLOCK_NUMBER,
      blockHash: BLOCK_HASH,
      proxyAddress: ROOTS.permitAuthority.address,
      proxyRuntimeCodeHash: ROOTS.permitAuthority.runtimeCodeHash,
      singleton: {
        address: SAFE_SINGLETON,
        runtimeCodeHash:
          "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4",
        version: "1.4.1",
      },
      fallbackHandler: SAFE_FALLBACK,
      fallbackHandlerRuntimeCodeHash:
        "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9",
      owners: [...SAFE_OWNERS],
      threshold: 1,
      nonce: "0",
      modules: [],
      modulesNext: "0x0000000000000000000000000000000000000001",
      guard: null,
      singletonSlot: "0x00000000000000000000000041675c099f32341bf84bfc5382af534df5c7461a",
      fallbackHandlerSlot:
        "0x000000000000000000000000fd0732dc9e303f09fcef3a7388ad10a83459ec99",
      guardSlot: `0x${"0".repeat(64)}`,
    },
    permit2Genesis: {
      address: ROOTS.permit2.address,
      blockNumber: "0",
      blockHash: hash32("genesis"),
      runtimeCodeHash: ROOTS.permit2.runtimeCodeHash,
      runtimeCodeBytes: 9_152,
    },
    externalRoots: externalNames.map((contract, index) => ({
      contract,
      address: ROOTS[contract].address,
      preStartBlockNumber: (BigInt(EXTERNAL[contract].startBlock) - 1n).toString(10),
      preStartBlockHash: externalBlockHash(BigInt(EXTERNAL[contract].startBlock) - 1n),
      preStartBlockRuntimeCodeHash:
        "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
      runtimeCodeHash: ROOTS[contract].runtimeCodeHash,
      transactionHash: EXTERNAL[contract].transactionHash,
      rawTransactionDigest:
        externalRawTransactionEntry(contract, index, options).normalizedResultSha256,
      transactionDigest:
        externalTransactionEntry(contract, index, options).normalizedResultSha256,
      startBlock: EXTERNAL[contract].startBlock,
      blockHash: externalBlockHash(EXTERNAL[contract].startBlock),
      transactionReceiptDigest:
        externalReceiptEntry(contract, index, options).normalizedResultSha256,
    })),
  }));

  const sourcifyResponses = await Promise.all([
    sourcifyResponse(fixture, {
      contract: "graphFactory",
      address: ROOTS.graphFactory.address,
      name: "ProgrammableCreate2GraphDeployerV1",
      fullyQualifiedName:
        "src/ProgrammableCreate2GraphDeployerV1.sol:ProgrammableCreate2GraphDeployerV1",
      standardJsonInputPath: sourcePaths[0],
    }, options, 0),
    sourcifyResponse(fixture, {
      contract: "programmableLaunchStampRouter",
      address: ROOTS.programmableLaunchStampRouter.address,
      name: "ProgrammableLaunchStampRouterV1",
      fullyQualifiedName:
        "src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol:ProgrammableLaunchStampRouterV1",
      standardJsonInputPath: sourcePaths[1],
    }, options, 1),
  ]);
  const sourcifyNormalized = sourcifyResponses.map(({ normalized }) => normalized);
  const sourceVerificationClosureDigest = framed(
    "programmable.robinhood-custom-launch.sourcify-response-closure.v4",
    sourcifyNormalized,
  );
  const sourceEntries = await Promise.all([...sourcePaths].sort(bufferCompare).map(async (relativePath) => {
    const bytes = await readFile(path.join(fixture.root, relativePath));
    return { path: relativePath, byteLength: String(bytes.byteLength), sha256: sha256Digest(bytes) };
  }));
  const sourceClosure = {
    schemaVersion: "programmable.launch-cli-v4-source-closure.v1",
    repository: ROBINHOOD_PRODUCTION_REPOSITORY,
    repositoryId: ROBINHOOD_PRODUCTION_REPOSITORY_ID,
    branch: "production",
    protectedRef: ROBINHOOD_PRODUCTION_REF,
    revision: fixture.revision,
    tree: fixture.tree,
    foundationSourceCommitment:
      "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730",
    entries: sourceEntries,
    sourceVerificationClosureDigest,
    sourceClosureDigest: null,
  };
  sourceClosure.sourceClosureDigest = computeV4SourceClosureDigest(sourceClosure);
  const sourceOrigin = {
    repository: ROBINHOOD_PRODUCTION_REPOSITORY,
    repositoryId: ROBINHOOD_PRODUCTION_REPOSITORY_ID,
    protectedRef: ROBINHOOD_PRODUCTION_REF,
    revision: fixture.revision,
    tree: fixture.tree,
    sourceClosureDigest: sourceClosure.sourceClosureDigest,
  };

  const l2Providers = providers.map((provider, index) => l2Capture(
    provider,
    index,
    safeLogs,
    options,
  ));
  if (options.reorderL2Inventory) {
    [l2Providers[0].entries[0], l2Providers[0].entries[1]] =
      [l2Providers[0].entries[1], l2Providers[0].entries[0]];
    l2Providers[0].inventoryDigest = rpcInventory("robinhood", l2Providers[0]).inventoryDigest;
  }
  const ethereumProviders = [0, 1].map((index) => l1Capture(index, options));
  const inventorySubject = [
    ...l2Providers.map((provider) => rpcInventory("robinhood", provider)),
    ...ethereumProviders.map((provider) => rpcInventory("ethereum", provider)),
    ...sourcifyNormalized.map((entry) => ({
      layer: "sourcify",
      contract: entry.contract,
      normalizedVerificationDigest: entry.normalizedVerificationDigest,
    })),
  ];
  const captureInventoryDigest = framed(
    "programmable.robinhood-custom-launch.capture-inventory.v4",
    inventorySubject,
  );
  const capture = {
    schemaVersion: ROBINHOOD_CAPTURE_SCHEMA,
    captureId: createHash("sha256").update(canonicalizeJson({
      revision: fixture.revision,
      tree: fixture.tree,
      observedAt: OBSERVED_AT,
      captureInventoryDigest,
    }), "utf8").digest("hex"),
    observedAt: OBSERVED_AT,
    expiresAt: EXPIRES_AT,
    profileDigest: ROBINHOOD_CAPTURE_PROFILE_DIGEST,
    sourceOrigin,
    l2ProviderReadbacks: l2Providers,
    ethereumProviderReadbacks: ethereumProviders,
    sourcifyResponses: sourcifyResponses.map(({ normalized }) => normalized),
    captureInventoryDigest,
    captureClosureDigest: null,
  };
  capture.captureClosureDigest = computeRobinhoodCaptureClosureDigest(capture);
  const input = {
    schemaVersion: "programmable.robinhood-custom-launch.postdeployment-input.v3",
    chainDeploymentId: "robinhood-mainnet-custom-launch-v1",
    providers,
    sourceClosure: {
      repository: ROBINHOOD_PRODUCTION_REPOSITORY,
      branch: "production",
      revision: fixture.revision,
      tree: fixture.tree,
    },
    capture,
  };
  const bytes = Buffer.from(`${JSON.stringify(input, null, 2)}\n`, "utf8");
  const attestationBundleBytes = Buffer.from("test-only-capture-attestation\n", "utf8");
  const trustedRootBytes = Buffer.from("test-only-capture-trusted-root\n", "utf8");
  const inputPath = path.join(fixture.root, "postdeployment-capture.json");
  await import("node:fs/promises").then(({ writeFile }) => writeFile(inputPath, bytes));
  const authorization = buildRobinhoodCaptureAuthorization({
    schemaVersion: ROBINHOOD_CAPTURE_AUTHORIZATION_SCHEMA,
    trustClass: "test-only",
    subjectPath: ROBINHOOD_CAPTURE_PATH,
    subjectSha256: sha256CaptureBytes(bytes),
    attestationBundlePath: ROBINHOOD_CAPTURE_ATTESTATION_BUNDLE_PATH,
    attestationBundleSha256: sha256Digest(attestationBundleBytes),
    trustedRootSource: "github-cli-embedded-tuf",
    trustedRootSha256: sha256Digest(trustedRootBytes),
    productionVerifyProofPath: ROBINHOOD_SOURCE_VERIFY_PROOF_PATH,
    productionVerifyProofByteLength: "128",
    productionVerifyProofSha256: digest("test-production-verify-proof"),
    productionVerifyAttestationBundlePath:
      ROBINHOOD_SOURCE_VERIFY_ATTESTATION_BUNDLE_PATH,
    productionVerifyAttestationBundleByteLength: "256",
    productionVerifyAttestationBundleSha256:
      digest("test-production-verify-attestation"),
    productionVerifyRunId: "1001",
    productionVerifyRunAttempt: "1",
    productionVerifyArtifactId: "2002",
    productionVerifyArtifactDigest: digest("test-production-verify-artifact"),
    repository: ROBINHOOD_PRODUCTION_REPOSITORY,
    repositoryId: ROBINHOOD_PRODUCTION_REPOSITORY_ID,
    workflow: ROBINHOOD_CAPTURE_WORKFLOW,
    sourceRef: ROBINHOOD_PRODUCTION_REF,
    sourceRevision: fixture.revision,
    sourceTree: fixture.tree,
    sourceClosureDigest: sourceClosure.sourceClosureDigest,
    verifiedAt: OBSERVED_AT,
    verificationDigest: null,
  });
  return {
    input,
    bytes,
    path: inputPath,
    authorization,
    attestationBundleBytes,
    trustedRootBytes,
  };
}

function l2Capture(provider, index, safeLogs, options) {
  const blockHex = toQuantity(BLOCK_NUMBER);
  const predecessorHex = toQuantity((BigInt(BLOCK_NUMBER) - 1n).toString(10));
  const deploymentRef = Object.freeze({ blockHash: BLOCK_HASH, requireCanonical: true });
  const predecessorRef = Object.freeze({ blockHash: PREDECESSOR_HASH, requireCanonical: true });
  const genesisRef = Object.freeze({ blockHash: hash32("genesis"), requireCanonical: true });
  const batchNumber = index === 1 && options.secondBatchNumber
    ? options.secondBatchNumber : "153046";
  const rpcTransactionHash = options.wrongTransactionHash ? hash32("wrong-tx") : TRANSACTION_HASH;
  const receiptBlockHash = options.wrongReceiptBlock ? hash32("wrong-receipt-block") : BLOCK_HASH;
  const rawReceiptLogs = safeLogs.map((log) => ({
    ...log,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: "0x2",
    blockNumber: blockHex,
    blockHash: options.wrongReceiptLogBlock ? hash32("wrong-receipt-log-block") : receiptBlockHash,
    removed: false,
  }));
  if (options.extraSafeReceiptLog) {
    rawReceiptLogs.push({
      ...rawReceiptLogs[0],
      address: ROOTS.poolManager.address,
      data: stringToHex("provider-secret-safe-log"),
      logIndex: "0x2",
    });
  }
  const entries = [
    rpcEntry("chainId", "eth_chainId", [], "0x1237", 1),
    rpcEntry("rawTransaction", "eth_getRawTransactionByHash", [TRANSACTION_HASH],
      RAW_SIGNED_TRANSACTION, 2),
    rpcEntry("transaction", "eth_getTransactionByHash", [TRANSACTION_HASH], {
      hash: rpcTransactionHash,
      from: OWNER,
      to: MULTICALL3,
      input: "0x82ad56cb00",
      value: "0x0",
      nonce: "0x7",
      transactionIndex: "0x2",
      blockNumber: blockHex,
      blockHash: BLOCK_HASH,
      chainId: "0x1237",
    }, 3, options.rpcResultCanary ? { providerSecret: options.rpcResultCanary } : {}),
    rpcEntry("receipt", "eth_getTransactionReceipt", [TRANSACTION_HASH], {
      transactionHash: TRANSACTION_HASH,
      from: OWNER,
      to: MULTICALL3,
      contractAddress: null,
      status: "0x1",
      transactionIndex: "0x2",
      blockNumber: blockHex,
      blockHash: receiptBlockHash,
      logs: rawReceiptLogs,
    }, 4),
    rpcEntry("deploymentBlock", "eth_getBlockByNumber", [blockHex, false], {
      number: blockHex, hash: BLOCK_HASH, parentHash: PREDECESSOR_HASH,
    }, 5),
    rpcEntry("predecessorBlock", "eth_getBlockByNumber", [predecessorHex, false], {
      number: predecessorHex, hash: PREDECESSOR_HASH, parentHash: hash32("l2-parent"),
    }, 6),
    rpcEntry("genesisBlock", "eth_getBlockByNumber", ["0x0", false], {
      number: "0x0", hash: hash32("genesis"), parentHash: `0x${"0".repeat(64)}`,
    }, 38),
    rpcEntry("multicall3Code", "eth_getCode", [
      MULTICALL3,
      options.numericDeploymentStateRef ? blockHex : deploymentRef,
    ], "0x01", 7),
    rpcEntry("prePermitAuthorityCode", "eth_getCode", [ROOTS.permitAuthority.address, predecessorRef], "0x", 8),
    rpcEntry("preGraphFactoryCode", "eth_getCode", [ROOTS.graphFactory.address, predecessorRef], "0x", 9),
    rpcEntry("preRouterCode", "eth_getCode", [ROOTS.programmableLaunchStampRouter.address, predecessorRef], "0x", 10),
    rpcEntry("permitAuthorityCode", "eth_getCode", [ROOTS.permitAuthority.address, deploymentRef], "0x01", 11),
    rpcEntry("graphFactoryCode", "eth_getCode", [ROOTS.graphFactory.address, deploymentRef], "0x01", 12),
    rpcEntry("routerCode", "eth_getCode", [
      ROOTS.programmableLaunchStampRouter.address,
      options.falseCanonicalStateRef
        ? { blockHash: BLOCK_HASH, requireCanonical: false }
        : options.missingCanonicalStateRef
          ? { blockHash: BLOCK_HASH }
          : options.swappedStateBlockRefs
            ? predecessorRef
            : deploymentRef,
    ], "0x01", 13),
    rpcEntry("safeSingletonCode", "eth_getCode", [SAFE_SINGLETON, deploymentRef], "0x01", 14),
    rpcEntry("safeFallbackHandlerCode", "eth_getCode", [SAFE_FALLBACK, deploymentRef], "0x01", 15),
    rpcEntry("permit2GenesisCode", "eth_getCode", [ROOTS.permit2.address, genesisRef], "0x01", 16),
    ...["poolManager", "positionManager", "stateView", "v4Quoter", "universalRouter"]
      .flatMap((contract, externalIndex) => {
        const startBlock = BigInt(EXTERNAL[contract].startBlock);
        const startTag = toQuantity(startBlock);
        const predecessorTag = toQuantity(startBlock - 1n);
        const title = `${contract[0].toUpperCase()}${contract.slice(1)}`;
        const predecessorHash = externalBlockHash(startBlock - 1n);
        const blockHash = options.externalBlockHashRelabel && contract === "poolManager"
          ? hash32("external-relabel") : externalBlockHash(startBlock);
        const startRef = Object.freeze({ blockHash, requireCanonical: true });
        const predecessorStartRef = Object.freeze({
          blockHash: predecessorHash, requireCanonical: true,
        });
        return [
          externalRawTransactionEntry(contract, externalIndex, options),
          externalTransactionEntry(contract, externalIndex, options),
          externalReceiptEntry(contract, externalIndex, options),
          rpcEntry(`${contract}Block`, "eth_getBlockByNumber", [
            startTag, false,
          ], {
            number: startTag,
            hash: blockHash,
            parentHash: predecessorHash,
          }, 72 + externalIndex * 10),
          rpcEntry(`${contract}PredecessorBlock`, "eth_getBlockByNumber", [
            predecessorTag, false,
          ], {
            number: predecessorTag,
            hash: predecessorHash,
            parentHash: externalBlockHash(startBlock - 2n),
          }, 73 + externalIndex * 10),
          rpcEntry(`${contract}Create2DeployerCode`, "eth_getCode", [
            CREATE2_DEPLOYER, startRef,
          ], options.wrongCreate2DeployerCode && contract === "poolManager" ? "0x" : "0x01",
          74 + externalIndex * 10),
          rpcEntry(`pre${title}Code`, "eth_getCode", [
            ROOTS[contract].address,
            options.numericPredecessorStateRef && contract === "poolManager"
              ? predecessorTag : predecessorStartRef,
          ], options.preexistingExternalCode && contract === "poolManager" ? "0x01" : "0x",
          75 + externalIndex * 10),
          rpcEntry(`${contract}Code`, "eth_getCode", [ROOTS[contract].address, startRef],
            options.lateExternalCode && contract === "poolManager" ? "0x" : "0x01",
            76 + externalIndex * 10),
        ];
      }),
    viewRpcEntry("routerPermitAuthority", ROUTER_READ_ABI, "PERMIT_AUTHORITY", [],
      ROOTS.programmableLaunchStampRouter.address, deploymentRef, ROOTS.permitAuthority.address, 22),
    viewRpcEntry("routerPermitAuthorityCodeHash", ROUTER_READ_ABI,
      "PERMIT_AUTHORITY_RUNTIME_CODE_HASH", [], ROOTS.programmableLaunchStampRouter.address,
      deploymentRef, ROOTS.permitAuthority.runtimeCodeHash, 23),
    viewRpcEntry("routerGraphFactory", ROUTER_READ_ABI, "GRAPH_FACTORY", [],
      ROOTS.programmableLaunchStampRouter.address, deploymentRef, ROOTS.graphFactory.address, 24),
    viewRpcEntry("routerGraphFactoryCodeHash", ROUTER_READ_ABI,
      "GRAPH_FACTORY_RUNTIME_CODE_HASH", [], ROOTS.programmableLaunchStampRouter.address,
      deploymentRef, ROOTS.graphFactory.runtimeCodeHash, 25),
    viewRpcEntry("routerPoolManager", ROUTER_READ_ABI, "POOL_MANAGER", [],
      ROOTS.programmableLaunchStampRouter.address, deploymentRef, ROOTS.poolManager.address, 26),
    viewRpcEntry("routerPoolManagerCodeHash", ROUTER_READ_ABI,
      "POOL_MANAGER_RUNTIME_CODE_HASH", [], ROOTS.programmableLaunchStampRouter.address,
      deploymentRef, ROOTS.poolManager.runtimeCodeHash, 27),
    viewRpcEntry("routerChainId", ROUTER_READ_ABI, "CHAIN_ID", [],
      ROOTS.programmableLaunchStampRouter.address, deploymentRef, 4663n, 28),
    viewRpcEntry("safeOwners", SAFE_READ_ABI, "getOwners", [], ROOTS.permitAuthority.address,
      deploymentRef, SAFE_OWNERS, 29),
    viewRpcEntry("safeThreshold", SAFE_READ_ABI, "getThreshold", [],
      ROOTS.permitAuthority.address, deploymentRef, 1n, 30),
    viewRpcEntry("safeNonce", SAFE_READ_ABI, "nonce", [], ROOTS.permitAuthority.address,
      deploymentRef, 0n, 31),
    viewRpcEntry("safeModules", SAFE_READ_ABI, "getModulesPaginated",
      [SAFE_MODULES_END_SENTINEL, 16n], ROOTS.permitAuthority.address, deploymentRef,
      [[], SAFE_MODULES_END_SENTINEL], 32),
    viewRpcEntry("safeVersion", [{
      type: "function", name: "VERSION", stateMutability: "view",
      inputs: [], outputs: [{ type: "string" }],
    }], "VERSION", [], ROOTS.permitAuthority.address, deploymentRef, "1.4.1", 39),
    rpcEntry("safeSingletonSlot", "eth_getStorageAt", [
      ROOTS.permitAuthority.address, SAFE_SINGLETON_STORAGE_SLOT, deploymentRef,
    ], provider.safeState.singletonSlot, 33),
    rpcEntry("safeFallbackHandlerSlot", "eth_getStorageAt", [
      ROOTS.permitAuthority.address, SAFE_FALLBACK_HANDLER_STORAGE_SLOT, deploymentRef,
    ], provider.safeState.fallbackHandlerSlot, 34),
    rpcEntry("safeGuardSlot", "eth_getStorageAt", [
      ROOTS.permitAuthority.address, SAFE_GUARD_STORAGE_SLOT, deploymentRef,
    ], provider.safeState.guardSlot, 35),
    rpcEntry("findBatchContainingBlock", "eth_call", [{
      to: "0x00000000000000000000000000000000000000C8",
      data: options.wrongNodeCalldata
        ? `0x81f1adaf${"0".repeat(64)}`
        : `0x81f1adaf${padHex(toHex(BigInt(BLOCK_NUMBER)), { size: 32 }).slice(2)}`,
    }, deploymentRef], abiWord(batchNumber), 36),
    rpcEntry("getL1Confirmations", "eth_call", [{
      to: "0x00000000000000000000000000000000000000C8",
      data: `0xe5ca238c${BLOCK_HASH.slice(2)}`,
    }, deploymentRef], index === 1 && options.l1ConfirmationsCanary
      ? `0x${Buffer.from(options.l1ConfirmationsCanary, "utf8").toString("hex").padEnd(64, "0").slice(0, 64)}`
      : abiWord("12"), 37),
  ];
  const orderedEntries = reindexRpcEntries(entries);
  const captured = {
    identity: {
      role: index === 0 ? "primary" : "secondary",
      providerId: provider.providerId,
      trustDomain: provider.trustDomain,
      authentication: "provider-credential",
      observedAt: OBSERVED_AT,
    },
    entries: orderedEntries,
    inventoryDigest: null,
    normalizedStateDigest: framed(
      "programmable.robinhood-custom-launch.normalized-l2-state.v1",
      provider,
    ),
  };
  captured.inventoryDigest = rpcInventory("robinhood", captured).inventoryDigest;
  return captured;
}

function l1Capture(index, options) {
  const batchNumber = "153046";
  const postingHash = hash32("l1-posting-transaction");
  const postingBlockHash = hash32("l1-posting-block");
  const postingBlock = 30_000_000n;
  const finalizedHash = hash32("l1-finalized-block");
  const rereadHash = index === 1 && options.finalizedRereadHash
    ? options.finalizedRereadHash : finalizedHash;
  const sequencer = options.wrongSequencerInbox ? ROOTS.poolManager.address : ROBINHOOD_SEQUENCER_INBOX;
  const beforeAcc = hash32("before-acc");
  const afterAcc = hash32("after-acc");
  const data = encodeAbiParameters([
    { type: "bytes32" },
    { type: "uint256" },
    {
      type: "tuple",
      components: [
        { name: "delayBlocks", type: "uint64" },
        { name: "futureBlocks", type: "uint64" },
        { name: "delaySeconds", type: "uint64" },
        { name: "futureSeconds", type: "uint64" },
      ],
    },
    { type: "uint8" },
  ], [hash32("delayed-acc"), 4n, {
    delayBlocks: 1n, futureBlocks: 2n, delaySeconds: 3n, futureSeconds: 4n,
  }, 0]);
  const log = {
    address: sequencer,
    topics: [
      SEQUENCER_BATCH_DELIVERED_TOPIC,
      padHex(toHex(BigInt(batchNumber)), { size: 32 }),
      beforeAcc,
      afterAcc,
    ],
    data,
    transactionHash: postingHash,
    transactionIndex: "0x3",
    blockNumber: toQuantity(postingBlock),
    blockHash: postingBlockHash,
    logIndex: "0x9",
    removed: false,
  };
  const finalizedBlock = {
    number: toQuantity(postingBlock + 12n),
    hash: finalizedHash,
    parentHash: hash32("finalized-parent"),
  };
  const entries = [
    rpcEntry("chainId", "eth_chainId", [], "0x1", 1),
    rpcEntry("postingLogs", "eth_getLogs", [{
      address: sequencer,
      fromBlock: toQuantity(postingBlock),
      toBlock: toQuantity(postingBlock),
      topics: [SEQUENCER_BATCH_DELIVERED_TOPIC, padHex(toHex(BigInt(batchNumber)), { size: 32 })],
    }], [log], 2),
    rpcEntry("postingReceipt", "eth_getTransactionReceipt", [postingHash], {
      transactionHash: postingHash,
      from: OWNER,
      to: options.wrongPostingReceiptTarget ? ROOTS.poolManager.address : ROBINHOOD_SEQUENCER_INBOX,
      contractAddress: null,
      status: "0x1",
      transactionIndex: "0x3",
      blockNumber: toQuantity(postingBlock),
      blockHash: postingBlockHash,
      logs: options.extraPostingReceiptLog ? [log, {
        ...log,
        address: ROOTS.poolManager.address,
        data: stringToHex("provider-secret-posting-log"),
        logIndex: "0xa",
      }] : [log],
    }, 3, options.rpcResultCanary ? { providerSecret: options.rpcResultCanary } : {}),
    rpcEntry("postingBlock", "eth_getBlockByHash", [postingBlockHash, false], {
      number: toQuantity(postingBlock),
      hash: postingBlockHash,
      parentHash: hash32("posting-parent"),
    }, 4),
    rpcEntry("finalizedTag", "eth_getBlockByNumber", ["finalized", false], finalizedBlock, 5),
    rpcEntry("finalizedReread", "eth_getBlockByNumber", ["finalized", false], {
      ...finalizedBlock,
      hash: rereadHash,
    }, 6),
  ];
  const orderedEntries = reindexRpcEntries(entries);
  const captured = {
    identity: {
      role: index === 0 ? "primary" : "secondary",
      providerId: index === 0 ? "drpc" : "quicknode",
      trustDomain: index === 0 ? "drpc.org" : "quicknode.com",
      authentication: "provider-credential",
      observedAt: OBSERVED_AT,
    },
    entries: orderedEntries,
    inventoryDigest: null,
  };
  captured.inventoryDigest = rpcInventory("ethereum", captured).inventoryDigest;
  return captured;
}

async function sourcifyResponse(fixture, target, options, index) {
  const localBytes = await readFile(path.join(fixture.root, target.standardJsonInputPath));
  const stdJsonInput = JSON.parse(localBytes.toString("utf8"));
  const sources = Object.fromEntries(Object.entries(stdJsonInput.sources).map(([name, value]) => [
    name, { content: value.content },
  ]));
  const address = index === 0 && options.wrongSourcifyAddress
    ? ROOTS.poolManager.address : target.address;
  const response = {
    match: options.sourcifyMatch ?? "exact_match",
    creationMatch: options.sourcifyMatch ?? "exact_match",
    runtimeMatch: options.sourcifyMatch ?? "exact_match",
    chainId: "4663",
    address,
    verifiedAt: "2026-08-29T17:55:00.000Z",
    matchId: String(index + 100),
    compilation: {
      language: "Solidity",
      compiler: "solc",
      compilerVersion: "0.8.26+commit.8a97fa7a",
      compilerSettings: stdJsonInput.settings,
      name: target.name,
      fullyQualifiedName: target.fullyQualifiedName,
    },
    sources,
    stdJsonInput,
    metadata: { compiler: { version: "0.8.26+commit.8a97fa7a" }, language: "Solidity" },
  };
  const responseBytes = Buffer.from(JSON.stringify(response), "utf8");
  const responseSha256 = sha256Digest(responseBytes);
  const raw = {
    contract: target.contract,
    urlPath: `/server/v2/contract/4663/${target.address}?fields=all`,
    httpStatus: 200,
    contentType: "application/json",
    responseBase64: responseBytes.toString("base64"),
    responseSha256,
  };
  const normalized = {
    contract: target.contract,
    provider: "sourcify-v2",
    chainId: "4663",
    address: response.address,
    match: response.match,
    creationMatch: response.creationMatch,
    runtimeMatch: response.runtimeMatch,
    observedAt: OBSERVED_AT,
    compiler: {
      language: "Solidity",
      compiler: "solc",
      compilerVersion: "0.8.26+commit.8a97fa7a",
      name: target.name,
      fullyQualifiedName: target.fullyQualifiedName,
      compilerSettingsDigest: framed(
        "programmable.robinhood-custom-launch.sourcify-compiler-settings.v1",
        stdJsonInput.settings,
      ),
    },
    sourceFilesDigest: framed(
      "programmable.robinhood-custom-launch.sourcify-source-files.v1",
      sources,
    ),
    standardJsonInputPath: target.standardJsonInputPath,
    standardJsonInputSha256: sha256Digest(localBytes),
    urlPath: raw.urlPath,
    httpStatus: 200,
    contentType: "application/json",
    normalizedVerificationDigest: null,
  };
  normalized.normalizedVerificationDigest = framed(
    "programmable.robinhood-custom-launch.sourcify-normalized-response.v1",
    { ...normalized, normalizedVerificationDigest: null },
  );
  return { raw, normalized };
}

async function freshSourcifyFetch(fixture, { providerOnlyCanary = false } = {}) {
  const targets = [
    {
      contract: "graphFactory",
      address: ROOTS.graphFactory.address,
      name: "ProgrammableCreate2GraphDeployerV1",
      fullyQualifiedName:
        "src/ProgrammableCreate2GraphDeployerV1.sol:ProgrammableCreate2GraphDeployerV1",
      standardJsonInputPath: sourcePaths[0],
    },
    {
      contract: "programmableLaunchStampRouter",
      address: ROOTS.programmableLaunchStampRouter.address,
      name: "ProgrammableLaunchStampRouterV1",
      fullyQualifiedName:
        "src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol:ProgrammableLaunchStampRouterV1",
      standardJsonInputPath: sourcePaths[1],
    },
  ];
  const byUrl = new Map();
  for (const [index, target] of targets.entries()) {
    const { raw } = await sourcifyResponse(fixture, target, {}, index);
    const value = JSON.parse(Buffer.from(raw.responseBase64, "base64").toString("utf8"));
    if (providerOnlyCanary) {
      value.providerOnlyCanary = `must-not-publish-${index}`;
      value.metadata = {
        ...value.metadata,
        providerPrivateMetadata: { token: `must-not-publish-${index}` },
      };
    }
    byUrl.set(`https://sourcify.dev${raw.urlPath}`, Buffer.from(JSON.stringify(value), "utf8"));
  }
  return async (url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.headers.accept, "application/json");
    assert.equal(init.redirect, "error");
    const bytes = byUrl.get(String(url));
    if (bytes === undefined) throw new Error(`unexpected fresh Sourcify URL ${url}`);
    return new Response(bytes, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };
}

function buildSafeLogs() {
  return [
    {
      address: ROOTS.permitAuthority.address,
      topics: encodeEventTopics({
        abi: SAFE_SETUP_ABI,
        eventName: "SafeSetup",
        args: { initiator: SAFE_FACTORY },
      }),
      data: encodeAbiParameters([
        { type: "address[]" }, { type: "uint256" }, { type: "address" }, { type: "address" },
      ], [SAFE_OWNERS, 1n, "0x0000000000000000000000000000000000000000", SAFE_FALLBACK]),
      logIndex: "0x0",
    },
    {
      address: SAFE_FACTORY,
      topics: encodeEventTopics({
        abi: PROXY_CREATION_ABI,
        eventName: "ProxyCreation",
        args: { proxy: ROOTS.permitAuthority.address },
      }),
      data: encodeAbiParameters([{ type: "address" }], [SAFE_SINGLETON]),
      logIndex: "0x1",
    },
  ];
}

function rpcEntry(key, method, params, result, id, responseExtras = {}) {
  const response = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result }), "utf8");
  const rawResponse = Buffer.from(JSON.stringify({
    jsonrpc: "2.0", id, result: { ...result, ...responseExtras },
  }), "utf8");
  return buildRobinhoodPublicRpcEntry({
    key,
    method,
    params,
    requestId: id,
    responseBytes: Object.keys(responseExtras).length === 0 ? response : rawResponse,
  });
}

function reindexRpcEntries(entries) {
  return entries.map((entry, index) => rpcEntry(
    entry.key,
    entry.method,
    entry.params,
    entry.result,
    index + 1,
  ));
}

function replaceRpcResult(provider, key, result) {
  const index = provider.entries.findIndex((entry) => entry.key === key);
  assert.notEqual(index, -1, `missing fixture RPC entry ${key}`);
  const current = provider.entries[index];
  provider.entries[index] = rpcEntry(
    current.key,
    current.method,
    current.params,
    result,
    current.requestId,
  );
  provider.inventoryDigest = rpcInventory("robinhood", provider).inventoryDigest;
  return provider.entries[index];
}

function externalReceiptEntry(contract, index, options = {}) {
  const startBlock = BigInt(EXTERNAL[contract].startBlock)
    + (options.lateExternalReceipt && contract === "poolManager" ? 1n : 0n);
  const transactionIndex = contract === "poolManager" ? "0x1" : "0x0";
  const blockHash = options.externalReceiptBlockRelabel && contract === "poolManager"
    ? hash32("external-relabel") : externalBlockHash(startBlock);
  const poolManagerLog = {
    address: options.wrongPoolManagerLogAddress ? ROOTS.graphFactory.address : ROOTS.poolManager.address,
    topics: [
      options.wrongPoolManagerLogTopic
        ? hash32("wrong-ownership-topic")
        : "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0",
      `0x${"0".repeat(64)}`,
      options.wrongPoolManagerLogOwner
        ? `0x${"0".repeat(63)}1`
        : "0x0000000000000000000000009701fb0ade1e269c8f64ec0c7b3cfadb31a13a52",
    ],
    data: options.wrongPoolManagerLogData ? "0x00" : "0x",
    transactionHash: options.wrongPoolManagerLogInclusion
      ? hash32("wrong-pool-manager-log-transaction") : EXTERNAL[contract].transactionHash,
    transactionIndex: options.wrongPoolManagerLogIndex ? "0x0" : transactionIndex,
    blockNumber: toQuantity(startBlock),
    blockHash,
    logIndex: "0x0",
    removed: false,
  };
  const logs = contract === "poolManager" ? [poolManagerLog] : [];
  if (options.extraExternalReceiptLog && contract === "poolManager") {
    logs.push({
      ...poolManagerLog,
      address: ROOTS.graphFactory.address,
      data: stringToHex("provider-secret-external-log"),
      logIndex: "0x1",
    });
  }
  return rpcEntry(`${contract}Receipt`, "eth_getTransactionReceipt", [
    EXTERNAL[contract].transactionHash,
  ], {
    transactionHash: EXTERNAL[contract].transactionHash,
    from: OWNER,
    to: options.wrongExternalReceiptTarget && contract === "poolManager"
      ? ROOTS.poolManager.address : CREATE2_DEPLOYER,
    contractAddress: null,
    status: "0x1",
    transactionIndex,
    blockNumber: toQuantity(startBlock),
    blockHash,
    logs,
  }, 100 + index);
}

function externalRawTransactionEntry(contract, index, options = {}) {
  let variant = 0;
  if (contract === "poolManager") {
    if (options.wrongExternalRawHash) variant = 1;
    if (options.wrongExternalSigner) variant = 2;
    if (options.wrongExternalInput) variant = 3;
    if (options.wrongExternalSalt) variant = 4;
    if (options.emptyExternalInitCode) variant = 5;
    if (options.wrongExternalDerivedAddress) variant = 6;
  }
  const rawTransaction = variant === 0
    ? EXTERNAL_RAW_TRANSACTIONS[contract]
    : `${EXTERNAL_RAW_TRANSACTIONS[contract].slice(0, -2)}${variant.toString(16).padStart(2, "0")}`;
  return rpcEntry(`${contract}RawTransaction`, "eth_getRawTransactionByHash", [
    EXTERNAL[contract].transactionHash,
  ], rawTransaction, 80 + index);
}

function externalTransactionEntry(contract, index, options = {}) {
  const startBlock = BigInt(EXTERNAL[contract].startBlock)
    + (options.lateExternalTransaction && contract === "poolManager" ? 1n : 0n);
  return rpcEntry(`${contract}Transaction`, "eth_getTransactionByHash", [
    EXTERNAL[contract].transactionHash,
  ], {
    hash: EXTERNAL[contract].transactionHash,
    from: OWNER,
    to: options.wrongExternalDeployer && contract === "poolManager"
      ? ROOTS.poolManager.address : CREATE2_DEPLOYER,
    input: options.wrongExternalInput && contract === "poolManager"
      ? "0x00"
      : options.wrongExternalSalt && contract === "poolManager"
        ? `0x${"0".repeat(63)}1${EXTERNAL_CREATE2_INPUTS[contract].slice(66)}`
        : options.emptyExternalInitCode && contract === "poolManager"
          ? `0x${"0".repeat(64)}`
          : options.wrongExternalDerivedAddress && contract === "poolManager"
            ? `0x${"0".repeat(64)}dead`
            : EXTERNAL_CREATE2_INPUTS[contract],
    value: "0x0",
    nonce: `0x${(index + 1).toString(16)}`,
    transactionIndex: contract === "poolManager" ? "0x1" : "0x0",
    blockNumber: toQuantity(startBlock),
    blockHash: externalBlockHash(startBlock),
    chainId: "0x1237",
  }, 90 + index);
}

function viewRpcEntry(key, abi, functionName, args, target, blockTag, result, id) {
  return rpcEntry(key, "eth_call", [{
    to: target,
    data: encodeFunctionData({ abi, functionName, args }),
  }, blockTag], encodeFunctionResult({ abi, functionName, result }), id);
}

function rpcInventory(layer, provider) {
  const entries = provider.entries.map((entry) => ({
    key: entry.key,
    method: entry.method,
    paramsSha256: framed("programmable.robinhood-custom-launch.rpc-params.v1", entry.params),
    requestSha256: entry.requestSha256,
    normalizedResultSha256: entry.normalizedResultSha256,
  }));
  return {
    layer,
    providerId: provider.identity.providerId,
    trustDomain: provider.identity.trustDomain,
    entries,
    inventoryDigest: framed("programmable.robinhood-custom-launch.rpc-inventory.v3", entries),
  };
}

async function materialize(fixture, built) {
  return materializeRobinhoodStageBundle({
    repositoryRoot: fixture.root,
    input: built.input,
    inputBytes: built.bytes,
    captureAuthorization: built.authorization,
    captureDependencies: testCaptureDependencies,
  });
}

async function rebuildWithProductionInputBuilder(fixture, input) {
  return buildRobinhoodPostdeploymentInput({
    repositoryRoot: fixture.root,
    revision: fixture.revision,
    tree: fixture.tree,
    observedAt: OBSERVED_AT,
    expiresAt: EXPIRES_AT,
    providers: input.providers,
    l2ProviderReadbacks: input.capture.l2ProviderReadbacks,
    ethereumProviderReadbacks: input.capture.ethereumProviderReadbacks,
    sourcifyResponses: input.capture.sourcifyResponses,
    readFile: (root, relativePath) => readFile(path.join(root, relativePath)),
    testOnlyDependencies: testCaptureDependencies,
  });
}

async function verify(fixture, built, bundle) {
  return verifyRobinhoodStageBundle({
    repositoryRoot: fixture.root,
    bundle,
    input: built.input,
    inputBytes: built.bytes,
    captureAuthorization: built.authorization,
    captureDependencies: testCaptureDependencies,
  });
}

function cliDependencies(built) {
  return {
    allowTestOnly: true,
    authorizeCapture: async () => built.authorization,
    captureDependencies: testCaptureDependencies,
    stageAttestationBundleBytes: Buffer.from(
      "test-only-portable-phase-a-stage-attestation\n",
      "utf8",
    ),
  };
}

function testBackendEvidence(stageBundle, { privateCanaries = false } = {}) {
  const stageBundleBytes = Buffer.from(`${JSON.stringify(stageBundle, null, 2)}\n`, "utf8");
  let privateInput = buildRobinhoodBackendPromotionFixture(stageBundle);
  if (privateCanaries) {
    const candidate = structuredClone(privateInput);
    const machine = responseBody(candidate.flyReadbacks[3]);
    machine.private_ip = "fdaa:0:canary::2";
    machine.instance_id = "private-instance-canary";
    machine.config.env = { PRIVATE_CANARY: "must-not-publish" };
    replaceResponseBody(candidate.flyReadbacks[3], machine);
    privateInput = buildRobinhoodBackendPromotionInput(candidate);
  }
  const privateInputBytes = Buffer.from(`${JSON.stringify(privateInput, null, 2)}\n`, "utf8");
  const input = buildRobinhoodBackendPromotionPublicInputFromPrivate({
    privateInput,
    privateInputBytes,
    stageBundle,
    now: () => new Date("2026-08-29T12:01:00Z"),
  });
  const inputBytes = Buffer.from(`${JSON.stringify(input, null, 2)}\n`, "utf8");
  const attestationBundleBytes = fakeSigstoreMessageBundle(inputBytes);
  const dependencies = {
    allowTestOnly: true,
    allowTestOnlyPromotion: true,
    now: () => new Date("2026-08-29T12:01:00Z"),
  };
  const validated = validateRobinhoodBackendPromotionPublicInput({
    input,
    stageBundle,
    now: dependencies.now,
  });
  const captureAuthorization = buildRobinhoodBackendCaptureAuthorization({
    schemaVersion: ROBINHOOD_BACKEND_CAPTURE_AUTHORIZATION_SCHEMA,
    trustClass: "test-only",
    subjectPath: ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH,
    subjectSha256: sha256Digest(inputBytes),
    attestationBundlePath: ROBINHOOD_BACKEND_ATTESTATION_BUNDLE_PATH,
    attestationBundleSha256: sha256Digest(attestationBundleBytes),
    bundleMediaType: SIGSTORE_BUNDLE_V03_MEDIA_TYPE,
    verifier: {
      name: "cosign",
      version: ROBINHOOD_BACKEND_COSIGN_VERSION,
      sha256: ROBINHOOD_BACKEND_COSIGN_LINUX_AMD64_SHA256,
    },
    certificateIdentity: ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_IDENTITY,
    certificateOidcIssuer: ROBINHOOD_BACKEND_CAPTURE_CERTIFICATE_OIDC_ISSUER,
    certificateGithubWorkflowName: ROBINHOOD_BACKEND_CAPTURE_WORKFLOW_NAME,
    certificateGithubWorkflowRepository: input.backendSource.repository,
    certificateGithubWorkflowRef: ROBINHOOD_BACKEND_CAPTURE_SOURCE_REF,
    certificateGithubWorkflowSha: input.backendSource.sourceCommit,
    certificateGithubWorkflowTrigger: ROBINHOOD_BACKEND_CAPTURE_TRIGGER,
    repository: input.backendSource.repository,
    repositoryId: "1318883798",
    workflow: ROBINHOOD_BACKEND_CAPTURE_WORKFLOW,
    sourceRef: ROBINHOOD_BACKEND_CAPTURE_SOURCE_REF,
    sourceRevision: input.backendSource.sourceCommit,
    sourceTree: input.backendSource.sourceTree,
    verifiedAt: input.observedAt,
    verificationDigest: null,
  });
  const authorization = buildRobinhoodBackendAuthorization({
    schemaVersion: ROBINHOOD_BACKEND_AUTHORIZATION_SCHEMA,
    trustClass: "test-only",
    repository: "programmablehq/PROGRAMMABLE",
    repositoryId: "1314365508",
    workflow: ROBINHOOD_BACKEND_AUTHORIZATION_WORKFLOW,
    sourceRef: "refs/heads/production",
    producerRevision: stageBundle.sourceClosure.revision,
    producerTree: stageBundle.sourceClosure.tree,
    stageSourceRevision: stageBundle.sourceClosure.revision,
    stageSourceTree: stageBundle.sourceClosure.tree,
    stageBundlePath: "release/robinhood-chain-4663/programmable-stage-bundle.json",
    stageBundleSha256: sha256Digest(stageBundleBytes),
    stageBundleDigest: stageBundle.stageBundleDigest,
    backendPromotionPublicInputPath: ROBINHOOD_BACKEND_PROMOTION_PUBLIC_INPUT_PATH,
    backendPromotionPublicInputSha256: sha256Digest(inputBytes),
    backendPromotionPublicInputDigest: input.publicInputDigest,
    chainDeploymentDescriptorDigest:
      validated.backendReleaseEvidence.chainDeploymentDescriptorDigest,
    backendPromotionInputDigest:
      validated.backendReleaseEvidence.backendPromotionInputDigest,
    backendReleaseEvidenceDigest:
      validated.backendReleaseEvidence.backendReleaseEvidenceDigest,
    runtimeReadinessNormalizedResponseSha256:
      validated.backendReleaseEvidence.runtimeReadiness.normalizedResponseSha256,
    flySafeReadbacksDigest:
      validated.backendReleaseEvidence.flyControlPlane.safeReadbacksDigest,
    observedAt: input.observedAt,
    authorizationDigest: null,
  });
  return {
    input,
    inputBytes,
    privateInput,
    privateInputBytes,
    attestationBundleBytes,
    stageBundleBytes,
    evidence: validated.backendReleaseEvidence,
    captureAuthorization,
    authorization,
    dependencies,
  };
}

function responseBody(readback) {
  return JSON.parse(Buffer.from(readback.response.bodyBytesBase64, "base64").toString("utf8"));
}

function replaceResponseBody(readback, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  readback.response.bodyBytesBase64 = bytes.toString("base64");
  readback.response.bodyByteLength = String(bytes.byteLength);
  readback.response.bodySha256 = sha256Digest(bytes);
}

function freshBackendFetch(input, {
  driftMachineImage = false,
  privateCanaries = false,
  responseDate = "Sat, 29 Aug 2026 12:01:00 GMT",
} = {}) {
  const byTarget = new Map([
    [`https://${input.readinessReadback.request.hostname}${input.readinessReadback.request.path}`,
      input.readinessReadback],
    ...input.flyReadbacks.map((entry) => [
      `https://${entry.request.hostname}${entry.request.path}`,
      entry,
    ]),
  ]);
  return async (url, init) => {
    const readback = byTarget.get(String(url));
    if (readback === undefined) throw new Error(`unexpected fresh backend URL ${url}`);
    assert.equal(init.redirect, "error");
    if (readback.request.authentication === "fly-api-token-redacted") {
      assert.equal(init.headers.authorization, "Bearer protected-test-token-value");
    } else {
      assert.equal(init.headers.authorization, undefined);
    }
    let body = Buffer.from(readback.response.bodyBytesBase64, "base64");
    if (driftMachineImage && readback.kind.startsWith("machine:")) {
      const value = JSON.parse(body.toString("utf8"));
      value.image_ref.digest = `sha256:${"a".repeat(64)}`;
      body = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    }
    if (privateCanaries && readback.kind.startsWith("machine:")) {
      const value = JSON.parse(body.toString("utf8"));
      value.private_ip = "fdaa:0:fresh-canary::2";
      value.instance_id = "fresh-private-instance-canary";
      value.config.env = { PRIVATE_CANARY: "must-not-publish" };
      body = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    }
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        date: responseDate,
        "x-request-id": `fresh-${readback.kind.replaceAll(":", "-")}`,
      },
    });
  };
}

function freshRpcFetch(built, options = {}) {
  const providersByHostname = new Map([
    ["robinhood.drpc.org", built.input.capture.l2ProviderReadbacks[0]],
    ["robinhood.g.alchemy.com", built.input.capture.l2ProviderReadbacks[1]],
    ["ethereum.drpc.org", built.input.capture.ethereumProviderReadbacks[0]],
    ["ethereum.quiknode.pro", built.input.capture.ethereumProviderReadbacks[1]],
  ]);
  return async (urlValue, init) => {
    const url = new URL(urlValue);
    const request = JSON.parse(Buffer.from(init.body).toString("utf8"));
    const provider = providersByHostname.get(url.hostname);
    if (provider === undefined) throw new Error(`unexpected test RPC ${url.hostname}`);
    const entry = provider.entries.find((candidate) =>
      candidate.method === request.method
      && canonicalizeJson(candidate.params) === canonicalizeJson(request.params));
    if (entry === undefined) throw new Error(`unexpected test RPC method ${request.method}`);
    const result = options.secondL2Batch !== undefined
      && url.hostname === "robinhood.g.alchemy.com"
      && entry.key === "findBatchContainingBlock"
      ? abiWord(options.secondL2Batch)
      : entry.result;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function framed(domain, value) {
  return testOnlyFramedCaptureDigest(domain, value);
}

function root(address, runtimeCodeHash) {
  return Object.freeze({ address, runtimeCodeHash });
}

function deployment(transactionHash, startBlock) {
  return Object.freeze({ transactionHash, startBlock });
}

function runGit(rootPath, args) {
  return execFileSync("git", ["-C", rootPath, ...args], { encoding: "utf8" }).trim();
}

function hash32(label) {
  return keccak256(stringToHex(label));
}

function externalBlockHash(blockNumber) {
  if (BigInt(blockNumber) === 9_070n) {
    return "0x9165e92381503c5e0cd1afc3e3647089d93a301c3e010722dbaf6e605d4ce38c";
  }
  return hash32(`external-block-${BigInt(blockNumber).toString(10)}`);
}

function digest(label) {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function fakeSigstoreMessageBundle(subjectBytes) {
  return Buffer.from(`${JSON.stringify({
    mediaType: SIGSTORE_BUNDLE_V03_MEDIA_TYPE,
    verificationMaterial: {
      certificate: {
        rawBytes: Buffer.from("test-only-certificate", "utf8").toString("base64"),
      },
      tlogEntries: [{}],
    },
    messageSignature: {
      messageDigest: {
        algorithm: "SHA2_256",
        digest: createHash("sha256").update(subjectBytes).digest("base64"),
      },
      signature: Buffer.from("test-only-signature", "utf8").toString("base64"),
    },
  }, null, 2)}\n`, "utf8");
}

function abiWord(value) {
  return padHex(toHex(BigInt(value)), { size: 32 });
}

function toQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function bufferCompare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
