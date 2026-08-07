#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getCreate2Address,
  keccak256,
  stringToHex,
} from "viem";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PROGRAMMABLE_CUSTOM_CANARY_PORT ?? 4178);
const CHAIN_ID = 1;
const CHAIN_ID_HEX = "0x1";
const REGISTRY_GENERATION = 1;
const REGISTRY_START_BLOCK = 25_701_139;
const MINIMUM_FINALITY_BLOCKS = 64;
const EXPECTED_ACCOUNT = "0x2bb333d48dfaf1596d9036671d2e43168994249e";
const REGISTRY = "0x17e18c88bda9bfb73924cdc989c07b0707e72671";
const REGISTRAR = "0xcc916e5200d2626edfd918dc219bc4296629e997";
const REGISTRY_POLICY_HASH =
  "0x7a814ecb2d2b8be2debb29481f25f06e976559eec41fa7c8d92e030ec69fc9ff";
const CHAIN_PROFILE_HASH =
  "0x30991a4ebef393737148f7986c880a4af602691e059ad428aa9ca17c6b4066ff";
const REGISTRY_RUNTIME_HASH =
  "0xa3276868befc509594adea6c5bd81c3c1bd013686f03fd57914fd39c917185f7";
const REGISTRAR_RUNTIME_HASH =
  "0xae00412005beb660afba47767240cf771bf3c65306d68c1a7bfcb8fe2c0450f5";
const REGISTERED_TOPIC0 =
  "0x8ee074138114415a92a0797b4f1f4c6353f8bd15d8031433abf0cc42c2dc274a";
const FINALIZED_TOPIC0 =
  "0xab930c1c165bba36257b8079ae38b6869f604910f6ffa40c956e31eb1b8ce38f";
const FIXED_RPC_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
];
const testRpcEndpoint = process.env.PROGRAMMABLE_CUSTOM_CANARY_TEST_RPC_URL;
if (testRpcEndpoint !== undefined
  && process.env.PROGRAMMABLE_CUSTOM_CANARY_ALLOW_NONPRODUCTION !== "true") {
  throw new Error("Custom canary RPC override is test-only");
}
const RPC_ENDPOINTS = testRpcEndpoint === undefined
  ? FIXED_RPC_ENDPOINTS
  : [testRpcEndpoint, testRpcEndpoint];
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");

function fail(message) {
  throw new Error(message);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

export function canonicalSha256(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(Buffer.from([0]))
    .update(canonical(value), "utf8")
    .digest("hex")}`;
}

function rawDigest(digest) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) fail("canonical digest is invalid");
  return `0x${digest.slice(7)}`;
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function rpc(endpoint, method, params = []) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) fail(`Mainnet RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) fail(`Mainnet RPC ${method} failed: ${payload.error.message}`);
  return payload.result;
}

async function reconciled(method, params = []) {
  const results = await Promise.all(RPC_ENDPOINTS.map((endpoint) => rpc(endpoint, method, params)));
  if (results.some((result) => JSON.stringify(result) !== JSON.stringify(results[0]))) {
    fail(`Independent Ethereum Mainnet RPCs disagree on ${method}`);
  }
  return results[0];
}

async function contractCall(address, abi, functionName, args = []) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await reconciled("eth_call", [{ to: address, data }, "latest"]);
  return decodeFunctionResult({ abi, functionName, data: result });
}

function zeroLeg() {
  return {
    shareBps: 0,
    recipient: ZERO_ADDRESS,
    currency: ZERO_ADDRESS,
    chargeModeId: ZERO_BYTES32,
    basisId: ZERO_BYTES32,
    roundingId: ZERO_BYTES32,
    accrualId: ZERO_BYTES32,
    claimId: ZERO_BYTES32,
    claimRightId: ZERO_BYTES32,
    controlEvidenceHash: ZERO_BYTES32,
  };
}

export function createGenesisCanaryPublicIdentities(input) {
  const grantBindingHash = canonicalSha256(
    "programmable.custom-registry-genesis-grant.v1",
    {
      authority: "programmable",
      purpose: "production-genesis-canary",
      repository: "https://github.com/0xprogrammable/programmable",
      sourceCommit: input.sourceCommit,
      primaryContract: input.primaryContract,
    },
  );
  const projectId = canonicalSha256("programmable.custom-launch-project-id.v2", {
    launchFamily: "custom",
    grantId: "programmable-custom-registry-genesis-canary-v1",
    grantBindingHash,
  });
  const launchIdentity = {
    namespace: "eip155:1/contract",
    value: input.primaryContract,
  };
  const launchId = canonicalSha256("programmable.custom-launch-id.v2", {
    launchFamily: "custom",
    projectId,
    chainId: "1",
    launchIdentity,
  });
  return Object.freeze({ grantBindingHash, projectId, launchId, launchIdentity });
}

function atomicRequestCommitment(input) {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "address" }, { type: "uint256" }, { type: "bytes32" },
      { type: "uint256" }, { type: "bytes32" }, { type: "bytes32" },
    ],
    [
      keccak256(stringToHex("programmable.custom-atomic-request.v1")),
      input.creationCodeHash,
      input.salt,
      input.primaryContract,
      0n,
      keccak256("0x"),
      0n,
      keccak256("0x"),
      input.primaryRuntimeCodeHash,
    ],
  ));
}

async function buildPlan() {
  const sourceCommit = git("rev-parse", "HEAD");
  const productionCommit = git("rev-parse", "programmable/production");
  if (sourceCommit !== productionCommit && process.env.PROGRAMMABLE_CUSTOM_CANARY_ALLOW_NONPRODUCTION !== "true") {
    fail("Genesis canary source must be the exact published production commit");
  }
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) fail("Genesis canary source commit is invalid");
  const sourceTree = git("rev-parse", `${sourceCommit}^{tree}`);
  const [registryArtifact, registrarArtifact, canaryArtifact] = await Promise.all([
    readJson(join(repositoryRoot, "contracts/out/ProgrammableCustomRegistryV1.sol/ProgrammableCustomRegistryV1.json")),
    readJson(join(repositoryRoot, "contracts/out/ProgrammableCustomAtomicRegistrarV1.sol/ProgrammableCustomAtomicRegistrarV1.json")),
    readJson(join(repositoryRoot, "contracts/out/ProgrammableCustomRegistryGenesisCanaryV1.sol/ProgrammableCustomRegistryGenesisCanaryV1.json")),
  ]);
  const creationCode = canaryArtifact.bytecode.object.toLowerCase();
  const runtimeCode = canaryArtifact.deployedBytecode.object.toLowerCase();
  const creationCodeHash = keccak256(creationCode);
  const primaryRuntimeCodeHash = keccak256(runtimeCode);
  const salt = rawDigest(canonicalSha256(
    "programmable.custom-registry-genesis-create2-salt.v1",
    { chainId: "1", registry: REGISTRY, sourceCommit },
  ));
  const primaryContract = getCreate2Address({
    from: REGISTRAR,
    salt,
    bytecodeHash: creationCodeHash,
  }).toLowerCase();
  const identities = createGenesisCanaryPublicIdentities({ sourceCommit, primaryContract });
  const sourceClosure = {
    repository: "https://github.com/0xprogrammable/programmable",
    repositoryId: "github:0xprogrammable/programmable",
    sourceCommit,
    sourceTree,
    sourcePath: "contracts/src/ProgrammableCustomRegistryGenesisCanaryV1.sol",
  };
  const artifactClosure = {
    contract: "ProgrammableCustomRegistryGenesisCanaryV1",
    compiler: canaryArtifact.metadata?.compiler?.version ?? "solc-0.8.26",
    creationCodeHash,
    primaryRuntimeCodeHash,
    abiSha256: canonicalSha256(
      "programmable.custom-registry-genesis-canary-abi.v1",
      canaryArtifact.abi,
    ),
  };
  const permissions = {
    owner: null,
    admin: null,
    upgradeAuthority: null,
    pauseAuthority: null,
    externalCalls: false,
    mutableStorage: false,
    payableEntryPoint: false,
  };
  const feePolicy = {
    kind: 2,
    providerId: ZERO_BYTES32,
    partnerStatusId: ZERO_BYTES32,
    modelId: ZERO_BYTES32,
    modelVersion: ZERO_BYTES32,
    templateId: ZERO_BYTES32,
    templateVersion: ZERO_BYTES32,
    marketPathId: ZERO_BYTES32,
    partnerRepositoryId: ZERO_BYTES32,
    partnerCommitId: ZERO_BYTES32,
    partnerRuntimeCodeSetHash: ZERO_BYTES32,
    totalFeeBps: 0,
    nativeCustomFeeBps: 0,
    partner: zeroLeg(),
    programmable: zeroLeg(),
    activationVersion: ZERO_BYTES32,
    activationBlock: 0n,
    paused: false,
    retired: false,
    publicPolicyBindingHash: REGISTRY_POLICY_HASH,
    claimIsolationEvidenceHash: rawDigest(canonicalSha256(
      "programmable.custom-registry-no-market-claim-isolation.v1",
      { claims: [], market: null },
    )),
    accountingSafetyEvidenceHash: rawDigest(canonicalSha256(
      "programmable.custom-registry-no-market-accounting-safety.v1",
      { currencies: [], feeBps: 0 },
    )),
    verificationEvidenceHash: rawDigest(canonicalSha256(
      "programmable.custom-registry-genesis-canary-verification.v1",
      { sourceClosure, artifactClosure, permissions },
    )),
  };
  const feePolicyHash = await contractCall(
    REGISTRY,
    registryArtifact.abi,
    "computeFeePolicyHash",
    [feePolicy],
  );
  const deploymentConfigurationHash = atomicRequestCommitment({
    creationCodeHash,
    salt,
    primaryContract,
    primaryRuntimeCodeHash,
  });
  const configurationHash = rawDigest(canonicalSha256(
    "programmable.custom-registry-genesis-configuration.v1",
    {
      chainId: "1",
      registry: REGISTRY,
      registrar: REGISTRAR,
      sourceClosure,
      artifactClosure,
      permissions,
      feePolicyHash,
      primaryContract,
    },
  ));
  const approvalId = rawDigest(canonicalSha256(
    "programmable.custom-registry-genesis-approval-id.v1",
    { launchId: identities.launchId, sourceCommit, registry: REGISTRY },
  ));
  const deploymentId = rawDigest(canonicalSha256(
    "programmable.custom-registry-genesis-deployment-id.v1",
    { chainId: "1", registry: REGISTRY, registrar: REGISTRAR, primaryContract },
  ));
  const runtimeCodeSetHash = rawDigest(canonicalSha256(
    "programmable.custom-runtime-code-set.v1",
    { runtimeCodeHashes: [primaryRuntimeCodeHash] },
  ));
  const emptyAssetSetHash = keccak256(encodeAbiParameters([{ type: "address[]" }], [[]]));
  const emptyMarketSetHash = keccak256(encodeAbiParameters([{ type: "bytes32[]" }], [[]]));
  const registration = {
    chainId: 1n,
    registryGeneration: BigInt(REGISTRY_GENERATION),
    launchId: rawDigest(identities.launchId),
    projectId: rawDigest(identities.projectId),
    approvalId,
    approvalBindingHash: ZERO_BYTES32,
    repositoryId: keccak256(stringToHex(sourceClosure.repository)),
    commitId: keccak256(stringToHex(`git-sha1:${sourceCommit}`)),
    sourceCommitment: rawDigest(canonicalSha256(
      "programmable.custom-registry-genesis-source.v1",
      sourceClosure,
    )),
    buildCommitment: rawDigest(canonicalSha256(
      "programmable.custom-registry-genesis-build.v1",
      artifactClosure,
    )),
    artifactSetHash: rawDigest(canonicalSha256(
      "programmable.custom-registry-genesis-artifact-set.v1",
      { artifacts: [artifactClosure] },
    )),
    deploymentConfigurationHash,
    configurationHash,
    permissionsHash: rawDigest(canonicalSha256(
      "programmable.custom-registry-genesis-permissions.v1",
      permissions,
    )),
    deploymentId,
    deploymentSetHash: rawDigest(canonicalSha256(
      "programmable.custom-registry-genesis-deployment-set.v1",
      { contracts: [primaryContract] },
    )),
    runtimeCodeSetHash,
    primaryContract,
    primaryRuntimeCodeHash,
    launchWallet: EXPECTED_ACCOUNT,
    modelId: keccak256(stringToHex("programmable.registry-genesis-canary")),
    modelVersion: keccak256(stringToHex("1.0.0")),
    templateId: keccak256(stringToHex("programmable.registry-genesis-project-only")),
    templateVersion: keccak256(stringToHex("1.0.0")),
    providerId: ZERO_BYTES32,
    builderAttributionHash: rawDigest(canonicalSha256(
      "programmable.custom-registry-genesis-builder.v1",
      { builder: "0xprogrammable", repository: sourceClosure.repository },
    )),
    originHash: rawDigest(canonicalSha256(
      "programmable.custom-registry-genesis-origin.v1",
      { platformId: "programmable", category: "custom", origin: "programmable" },
    )),
    assetSetHash: emptyAssetSetHash,
    marketSetHash: emptyMarketSetHash,
    marketPathId: ZERO_BYTES32,
    capabilitySetHash: rawDigest(canonicalSha256(
      "programmable.custom-registry-genesis-capabilities.v1",
      { capabilities: ["registry-lifecycle-canary"] },
    )),
    reviewPolicyHash: REGISTRY_POLICY_HASH,
    securityReviewHash: rawDigest(canonicalSha256(
      "programmable.custom-registry-genesis-security-review.v1",
      { result: "approved-exact-source-runtime", sourceClosure, artifactClosure, permissions },
    )),
    reviewResultId: keccak256(stringToHex("programmable.review-result.approved-exact-source-runtime.v1")),
    reviewDeploymentBindingHash: ZERO_BYTES32,
    finalityPolicyHash: CHAIN_PROFILE_HASH,
    registeredRecordCommitment: ZERO_BYTES32,
    feePolicy,
  };
  registration.approvalBindingHash = await contractCall(
    REGISTRY,
    registryArtifact.abi,
    "computeApprovalBindingHash",
    [registration, feePolicyHash],
  );
  registration.reviewDeploymentBindingHash = await contractCall(
    REGISTRY,
    registryArtifact.abi,
    "computeReviewDeploymentBindingHash",
    [registration, feePolicyHash],
  );
  registration.registeredRecordCommitment = await contractCall(
    REGISTRY,
    registryArtifact.abi,
    "computeRegisteredRecordCommitment",
    [registration, feePolicyHash],
  );
  const registrationBindingHash = await contractCall(
    REGISTRY,
    registryArtifact.abi,
    "computeRegistrationBindingHash",
    [registration, feePolicyHash],
  );
  const currentBlocks = await Promise.all(
    RPC_ENDPOINTS.map((endpoint) => rpc(endpoint, "eth_blockNumber")),
  );
  const currentBlock = currentBlocks
    .map((value) => BigInt(value))
    .reduce((lowest, value) => value < lowest ? value : lowest);
  const authorization = {
    chainId: 1n,
    registryGeneration: BigInt(REGISTRY_GENERATION),
    approvalId,
    launchId: registration.launchId,
    approvalBindingHash: registration.approvalBindingHash,
    registrationBindingHash,
    validAfterBlock: currentBlock,
    expiresAtBlock: currentBlock + 2_048n,
    evidenceHash: rawDigest(canonicalSha256(
      "programmable.custom-registry-genesis-approval-evidence.v1",
      {
        approvalId,
        sourceClosure,
        artifactClosure,
        configurationHash,
        permissions,
        feePolicyHash,
      },
    )),
  };
  const request = {
    salt,
    creationCode,
    constructorValue: 0n,
    initializationCall: "0x",
    initializationValue: 0n,
    initializationResultHash: keccak256("0x"),
    registration,
  };
  const approvalData = encodeFunctionData({
    abi: registryArtifact.abi,
    functionName: "authorizeApproval",
    args: [authorization],
  });
  const registrationData = encodeFunctionData({
    abi: registrarArtifact.abi,
    functionName: "deployInitializeAndRegister",
    args: [request],
  });
  return Object.freeze({
    schemaVersion: "programmable.custom-registry-genesis-canary-plan.v1",
    chainId: CHAIN_ID,
    chainIdHex: CHAIN_ID_HEX,
    expectedAccount: EXPECTED_ACCOUNT,
    sourceCommit,
    sourceTree,
    registry: REGISTRY,
    registrar: REGISTRAR,
    registryStartBlock: String(REGISTRY_START_BLOCK),
    minimumFinalityBlocks: MINIMUM_FINALITY_BLOCKS,
    primaryContract,
    primaryRuntimeCodeHash,
    feePolicyHash,
    identities,
    sourceClosure,
    artifactClosure,
    permissions,
    configurationHash,
    registration,
    authorization,
    transactions: {
      approval: { label: "Authorize exact canary approval", to: REGISTRY, value: "0x0", data: approvalData },
      registration: { label: "Deploy and register atomically", to: REGISTRAR, value: "0x0", data: registrationData },
    },
    abis: { registry: registryArtifact.abi },
  });
}

function publicPlan(plan) {
  return JSON.parse(JSON.stringify(plan, (_key, value) =>
    typeof value === "bigint" ? value.toString(10) : value));
}

async function runtimeHash(address) {
  const code = await reconciled("eth_getCode", [address, "latest"]);
  return code === "0x" ? null : keccak256(code);
}

async function launchLogs(topic0, launchId, blockNumber) {
  const filter = {
    address: REGISTRY,
    fromBlock: `0x${blockNumber.toString(16)}`,
    toBlock: `0x${blockNumber.toString(16)}`,
    topics: [topic0, launchId],
  };
  const logs = await Promise.all(RPC_ENDPOINTS.map((endpoint) => rpc(endpoint, "eth_getLogs", [filter])));
  const normalized = logs.map((items) => items.map((item) => ({
    address: item.address.toLowerCase(),
    blockHash: item.blockHash.toLowerCase(),
    blockNumber: item.blockNumber.toLowerCase(),
    transactionHash: item.transactionHash.toLowerCase(),
    transactionIndex: item.transactionIndex.toLowerCase(),
    logIndex: item.logIndex.toLowerCase(),
    topics: item.topics.map((topic) => topic.toLowerCase()),
    data: item.data.toLowerCase(),
  })));
  if (JSON.stringify(normalized[0]) !== JSON.stringify(normalized[1])) {
    fail("Independent Ethereum Mainnet RPCs disagree on Registry logs");
  }
  return normalized[0];
}

async function finalizationTransaction(plan, registeredLog) {
  const heads = await Promise.all(RPC_ENDPOINTS.map((endpoint) => rpc(endpoint, "eth_blockNumber")));
  const lowestHead = heads.map(BigInt).reduce((lowest, value) => value < lowest ? value : lowest);
  const observedBlock = BigInt(registeredLog.blockNumber);
  if (lowestHead <= observedBlock + BigInt(MINIMUM_FINALITY_BLOCKS)) return null;
  const confirmedHead = lowestHead - 1n;
  const confirmedBlocks = await Promise.all(RPC_ENDPOINTS.map((endpoint) => rpc(
    endpoint,
    "eth_getBlockByNumber",
    [`0x${confirmedHead.toString(16)}`, false],
  )));
  const confirmedBlock = confirmedBlocks[0];
  if (confirmedBlock?.hash === undefined || confirmedBlock?.number === undefined) {
    fail("Confirmed head block is unavailable");
  }
  const confirmedIdentity = `${confirmedBlock.number}:${confirmedBlock.hash}`.toLowerCase();
  if (confirmedBlocks.some((block) =>
    `${block?.number ?? ""}:${block?.hash ?? ""}`.toLowerCase() !== confirmedIdentity
  )) {
    fail("Independent Ethereum Mainnet RPCs disagree on the confirmed head block identity");
  }
  const finalityEvidence = {
    chainId: "1",
    registry: REGISTRY,
    launchId: plan.registration.launchId,
    observedTransactionHash: registeredLog.transactionHash,
    observedBlockNumber: observedBlock.toString(10),
    observedBlockHash: registeredLog.blockHash,
    observedTransactionIndex: Number(BigInt(registeredLog.transactionIndex)),
    observedLogIndex: Number(BigInt(registeredLog.logIndex)),
    confirmedHeadBlockNumber: confirmedHead.toString(10),
    confirmedHeadBlockHash: confirmedBlock.hash.toLowerCase(),
    finalityPolicyHash: CHAIN_PROFILE_HASH,
  };
  const proof = {
    chainId: 1n,
    registryGeneration: BigInt(REGISTRY_GENERATION),
    launchId: plan.registration.launchId,
    observedBlockNumber: observedBlock,
    observedBlockHash: registeredLog.blockHash,
    observedTransactionHash: registeredLog.transactionHash,
    observedTransactionIndex: Number(BigInt(registeredLog.transactionIndex)),
    observedLogIndex: Number(BigInt(registeredLog.logIndex)),
    confirmedHeadBlockNumber: confirmedHead,
    confirmedHeadBlockHash: confirmedBlock.hash,
    finalityPolicyHash: CHAIN_PROFILE_HASH,
    finalityEvidenceHash: rawDigest(canonicalSha256(
      "programmable.custom-registry-genesis-finality-evidence.v1",
      finalityEvidence,
    )),
  };
  return {
    label: "Finalize Registry canary",
    to: REGISTRY,
    value: "0x0",
    data: encodeFunctionData({
      abi: plan.abis.registry,
      functionName: "finalizeLaunch",
      args: [proof],
    }),
    proof,
    finalityEvidence,
  };
}

async function readState(plan) {
  const [chainId, registryHash, registrarHash, targetHash, approval, launch] =
    await Promise.all([
      reconciled("eth_chainId"),
      runtimeHash(REGISTRY),
      runtimeHash(REGISTRAR),
      runtimeHash(plan.primaryContract),
      contractCall(REGISTRY, plan.abis.registry, "approvalState", [plan.authorization.approvalId]),
      contractCall(REGISTRY, plan.abis.registry, "launchState", [plan.registration.launchId]),
    ]);
  if (chainId !== CHAIN_ID_HEX || registryHash !== REGISTRY_RUNTIME_HASH
    || registrarHash !== REGISTRAR_RUNTIME_HASH) {
    fail("Mainnet Registry runtime binding changed");
  }
  const approvalAuthorized = approval.approvalBindingHash !== ZERO_BYTES32;
  if (approvalAuthorized && (approval.launchId !== plan.registration.launchId
    || approval.approvalBindingHash !== plan.authorization.approvalBindingHash
    || approval.registrationBindingHash !== plan.authorization.registrationBindingHash)) {
    fail("Existing approval differs from the exact genesis plan");
  }
  const status = Number(launch.status);
  if (approvalAuthorized && status === 0 && approval.consumed) {
    fail("Genesis approval was consumed without a registered launch");
  }
  if ((status === 0 && targetHash !== null) || (status > 0 && targetHash !== plan.primaryRuntimeCodeHash)) {
    fail("Genesis target runtime does not match Registry lifecycle state");
  }
  const registeredLogs = status > 0
    ? await launchLogs(
        REGISTERED_TOPIC0,
        plan.registration.launchId,
        Number(launch.observedAtBlock),
      )
    : [];
  const finalizedLogs = status === 2
    ? await launchLogs(
        FINALIZED_TOPIC0,
        plan.registration.launchId,
        Number(launch.finalizedAtBlock),
      )
    : [];
  let phase;
  let nextTransaction = null;
  let remainingFinalityBlocks = 0;
  if (!approvalAuthorized) {
    phase = "approval-ready";
    nextTransaction = plan.transactions.approval;
  } else if (status === 0) {
    phase = "registration-ready";
    nextTransaction = plan.transactions.registration;
  } else if (status === 1) {
    if (registeredLogs.length !== 1) fail("Observed launch does not have one canonical registration log");
    const finalization = await finalizationTransaction(plan, registeredLogs[0]);
    if (finalization === null) {
      phase = "waiting-finality";
      const head = BigInt(await rpc(RPC_ENDPOINTS[0], "eth_blockNumber"));
      remainingFinalityBlocks = Number(
        BigInt(registeredLogs[0].blockNumber) + BigInt(MINIMUM_FINALITY_BLOCKS) + 1n - head,
      );
    } else {
      phase = "finalization-ready";
      nextTransaction = finalization;
    }
  } else if (status === 2) {
    if (registeredLogs.length !== 1 || finalizedLogs.length !== 1) {
      fail("Finalized launch does not have one canonical lifecycle event pair");
    }
    phase = "complete";
  } else {
    fail(`Genesis canary entered unexpected launch status ${status}`);
  }
  return publicPlan({
    phase,
    approvalAuthorized,
    launchStatus: status,
    observedAtBlock: launch.observedAtBlock,
    finalizedAtBlock: launch.finalizedAtBlock,
    remainingFinalityBlocks: Math.max(0, remainingFinalityBlocks),
    primaryContract: plan.primaryContract,
    registeredLog: registeredLogs[0] ?? null,
    finalizedLog: finalizedLogs[0] ?? null,
    nextTransaction,
  });
}

function renderHtml(plan) {
  const summary = publicPlan({
    chainId: plan.chainId,
    expectedAccount: plan.expectedAccount,
    sourceCommit: plan.sourceCommit,
    registry: plan.registry,
    registrar: plan.registrar,
    primaryContract: plan.primaryContract,
    projectId: plan.identities.projectId,
    launchId: plan.identities.launchId,
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Custom Registry genesis canary</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui;color:#251e22;background:#fbfafb}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 12% 0,#f7ddea 0,transparent 31rem),#fbfafb}main{width:min(860px,calc(100% - 32px));margin:auto;padding:46px 0 64px}.brand{font-weight:750;margin-bottom:32px}.eyebrow{font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:#a5547d;font-weight:750}h1{font-size:clamp(38px,7vw,58px);line-height:1;letter-spacing:-.055em;margin:12px 0 14px;font-weight:620}.intro{max-width:700px;color:#71676d;line-height:1.6}.panel{margin-top:28px;background:#fff;border:1px solid #e8dfe4;border-radius:24px;overflow:hidden;box-shadow:0 24px 64px rgba(77,53,66,.08)}dl{display:grid;grid-template-columns:1fr 1fr;margin:0}dl div{padding:18px 20px;border-bottom:1px solid #eee6ea}dl div:nth-child(odd){border-right:1px solid #eee6ea}dt{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#968a92}dd{margin:7px 0 0;font-size:12px;overflow-wrap:anywhere}.actions{display:flex;gap:10px;padding:20px;flex-wrap:wrap}button{min-height:45px;padding:0 17px;border:0;border-radius:13px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;background:#ecc0d7;color:#351724}button.secondary{background:#f7f3f5;border:1px solid #e5dce1}button:disabled{opacity:.48;cursor:not-allowed}button:focus-visible{outline:3px solid #7b365b;outline-offset:3px}.notice{margin:0;padding:18px 20px;border-top:1px solid #eee6ea;color:#71676d;font-size:13px;line-height:1.55}.notice.error{color:#a23e4d}.notice.success{color:#246d4d}@media(max-width:620px){main{padding-top:28px}dl{grid-template-columns:1fr}dl div:nth-child(odd){border-right:0}.actions button{width:100%}}
</style></head><body><main><div class="brand">Programmable</div><p class="eyebrow">Ethereum Mainnet · Registry V1</p><h1>Genesis canary</h1><p class="intro">One project-only marker proves the complete approval, same-transaction deployment and registration, finality, Registry and public-index lifecycle. It has no owner, storage, token, pool, market or fee.</p><section class="panel"><dl><div><dt>Source commit</dt><dd>${summary.sourceCommit}</dd></div><div><dt>Registry</dt><dd>${summary.registry}</dd></div><div><dt>Primary contract</dt><dd>${summary.primaryContract}</dd></div><div><dt>Launch ID</dt><dd>${summary.launchId}</dd></div></dl><div class="actions"><button id="connect">Connect MetaMask</button><button class="secondary" id="refresh" disabled>Refresh</button><button class="secondary" id="execute" disabled>Prepare next transaction</button></div><p class="notice" id="notice" role="status" aria-live="polite">Connect the configured wallet to begin.</p></section></main><script id="plan" type="application/json">${JSON.stringify(summary)}</script><script>
const plan=JSON.parse(document.getElementById("plan").textContent);const el=Object.fromEntries(["connect","refresh","execute","notice"].map(id=>[id,document.getElementById(id)]));let provider,account,state,busy=false;function notice(message,type=""){el.notice.textContent=message;el.notice.className="notice"+(type?" "+type:"")}function buttons(){el.connect.disabled=busy||Boolean(account);el.refresh.disabled=busy||!account;el.execute.disabled=busy||!state?.nextTransaction}function metamask(){const injected=window.ethereum;if(!injected)return null;if(Array.isArray(injected.providers))return injected.providers.find(item=>item.isMetaMask)||null;return injected.isMetaMask?injected:null}async function request(method,params=[]){return provider.request({method,params})}async function ensure(){const chain=String(await request("eth_chainId")).toLowerCase();if(chain!=="0x1")throw new Error("Select Ethereum Mainnet");const accounts=await request("eth_accounts");account=String(accounts[0]||"").toLowerCase();if(account!==plan.expectedAccount)throw new Error("Select the configured Registry wallet "+plan.expectedAccount)}async function refresh(){await ensure();const response=await fetch("/state",{cache:"no-store"});state=await response.json();if(!response.ok)throw new Error(state.error||"Registry state verification failed");const labels={"approval-ready":"Exact approval is ready.","registration-ready":"Atomic deployment and registration are ready.","waiting-finality":"Waiting for "+state.remainingFinalityBlocks+" more blocks before finalization.","finalization-ready":"Finality proof is ready.",complete:"Genesis canary is finalized and independently verified."};notice(labels[state.phase],state.phase==="complete"?"success":"");el.execute.textContent=state.nextTransaction?.label||(state.phase==="complete"?"Lifecycle complete":"Prepare next transaction");buttons()}async function connect(){busy=true;buttons();try{provider=metamask();if(!provider)throw new Error("MetaMask is not available");if(!(await request("eth_accounts")).length)await request("eth_requestAccounts");await refresh();el.connect.textContent="Connected"}catch(error){account=undefined;notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}async function execute(){if(!state?.nextTransaction)return;busy=true;buttons();try{await ensure();const tx=state.nextTransaction;notice("Review the exact transaction in MetaMask.");await request("eth_call",[{from:account,to:tx.to,data:tx.data,value:tx.value},"latest"]);const hash=await request("eth_sendTransaction",[{from:account,to:tx.to,data:tx.data,value:tx.value}]);notice("Transaction submitted: "+hash);for(let attempt=0;attempt<300;attempt++){const receipt=await request("eth_getTransactionReceipt",[hash]);if(receipt){if(String(receipt.status).toLowerCase()!=="0x1")throw new Error("Transaction reverted");await refresh();return}await new Promise(resolve=>setTimeout(resolve,2000))}throw new Error("Transaction is still pending after ten minutes")}catch(error){notice(error?.message||String(error),"error")}finally{busy=false;buttons()}}el.connect.addEventListener("click",connect);el.refresh.addEventListener("click",()=>refresh().catch(error=>notice(error?.message||String(error),"error")));el.execute.addEventListener("click",execute);buttons();
</script></body></html>`;
}

async function main() {
  const plan = await buildPlan();
  const state = await readState(plan);
  if (process.argv.includes("--check")) {
    process.stdout.write(`${JSON.stringify({ plan: publicPlan(plan), state }, null, 2)}\n`);
    return;
  }
  const html = renderHtml(plan);
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET") {
        response.writeHead(405, { allow: "GET" }).end();
        return;
      }
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(html);
        return;
      }
      if (request.url === "/state") {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify(await readState(plan)));
        return;
      }
      if (request.url === "/plan") {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify(publicPlan(plan)));
        return;
      }
      response.writeHead(404).end();
    } catch (error) {
      response.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  server.listen(PORT, HOST, () => {
    process.stdout.write(`Custom Registry genesis canary: http://${HOST}:${PORT}\n`);
  });
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
