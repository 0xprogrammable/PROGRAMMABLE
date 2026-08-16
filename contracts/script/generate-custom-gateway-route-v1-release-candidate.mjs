#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const contractsDirectory = resolve(scriptDirectory, "..");
const inputPath = resolve(contractsDirectory, "spec/custom-gateway-route-v1.input.json");
const outputPath = resolve(contractsDirectory, "spec/custom-gateway-route-v1.release-candidate.json");
const input = JSON.parse(readFileSync(inputPath, "utf8"));

const contracts = [
  "ProgrammableCreate2GraphDeployerV1",
  "ProgrammableRouteGatedCreate2GraphFactoryV1",
  "ProgrammableCustomLaunchGatewayV1",
  "ProgrammableCustomGatewayRoutePairCoordinatorV1",
];
const sources = [
  "script/DeployProgrammableCustomGatewayRouteV1.s.sol",
  "script/generate-custom-gateway-route-v1-release-candidate.mjs",
  "security/CUSTOM-GATEWAY-ROUTE-V1-RELEASE-CANDIDATE.md",
  "spec/custom-gateway-route-v1.input.json",
  "src/ProgrammableCreate2GraphDeployerV1.sol",
  "src/ProgrammableRouteGatedCreate2GraphFactoryV1.sol",
  "src/ProgrammableCustomLaunchGatewayV1.sol",
  "src/ProgrammableCustomGatewayRoutePairCoordinatorV1.sol",
  "src/interfaces/IProgrammableCreate2GraphDeployerV1.sol",
  "src/interfaces/IProgrammableRouteGatedCreate2GraphFactoryV1.sol",
  "src/interfaces/IProgrammableCustomLaunchGatewayV1.sol",
  "test/ProgrammableCustomGatewayRouteV1MainnetFork.t.sol",
];

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readArtifact(name) {
  const artifactPath = resolve(contractsDirectory, `out/${name}.sol/${name}.json`);
  return JSON.parse(readFileSync(artifactPath, "utf8"));
}

function canonicalAbiParameter(parameter) {
  return {
    name: parameter.name,
    type: parameter.type,
    ...(parameter.indexed === undefined ? {} : { indexed: parameter.indexed }),
    ...(parameter.components === undefined
      ? {}
      : { components: parameter.components.map(canonicalAbiParameter) }),
  };
}

function canonicalAbiEntry(entry) {
  return JSON.stringify({
    type: entry.type,
    name: entry.name,
    inputs: (entry.inputs ?? []).map(canonicalAbiParameter),
    ...(entry.outputs === undefined
      ? {}
      : { outputs: entry.outputs.map(canonicalAbiParameter) }),
    ...(entry.stateMutability === undefined ? {} : { stateMutability: entry.stateMutability }),
    ...(entry.anonymous === undefined ? {} : { anonymous: entry.anonymous }),
  });
}

function genericV2AbiParity() {
  const genericAbi = readArtifact("ProgrammableCreate2GraphDeployerV1").abi.filter(
    ({ type }) => type === "function" || type === "event" || type === "error",
  );
  const factoryAbi = readArtifact("ProgrammableRouteGatedCreate2GraphFactoryV1").abi;
  const factoryEntries = new Set(factoryAbi.map(canonicalAbiEntry));
  const missing = genericAbi.filter((entry) => !factoryEntries.has(canonicalAbiEntry(entry)));
  if (missing.length !== 0) {
    throw new Error(
      `route-gated factory ABI is missing exact Generic-v2 entries: ${missing.map(canonicalAbiEntry).join(", ")}`,
    );
  }
  const counts = genericAbi.reduce(
    (result, entry) => ({ ...result, [entry.type]: result[entry.type] + 1 }),
    { function: 0, event: 0, error: 0 },
  );
  return {
    relationship: "exact Generic-v2 function/event/error ABI entry subset of route-gated factory ABI",
    genericV2AbiSha256: sha256(Buffer.from(JSON.stringify(readArtifact("ProgrammableCreate2GraphDeployerV1").abi))),
    routeGatedFactoryAbiSha256: sha256(
      Buffer.from(JSON.stringify(readArtifact("ProgrammableRouteGatedCreate2GraphFactoryV1").abi)),
    ),
    requiredEntryCounts: counts,
    missingEntries: [],
  };
}

function bytecodeSummary(name) {
  const artifact = readArtifact(name);
  const creationHex = artifact.bytecode.object.slice(2);
  const runtimeHex = artifact.deployedBytecode.object.slice(2);
  const cast = spawnSync("cast", ["keccak", `0x${runtimeHex}`], { encoding: "utf8" });
  if (cast.status !== 0) throw new Error(`cast keccak failed for ${name}: ${cast.stderr}`);
  const immutableReferenceSlots = Object.values(
    artifact.deployedBytecode.immutableReferences ?? {},
  ).flat().map(({ start, length }) => ({ start, length })).sort(
    (left, right) => left.start - right.start || left.length - right.length,
  );
  return {
    contract: name,
    abiSha256: sha256(Buffer.from(JSON.stringify(artifact.abi))),
    creationByteLength: creationHex.length / 2,
    creationBytecodeSha256: sha256(Buffer.from(creationHex, "hex")),
    runtimeTemplateByteLength: runtimeHex.length / 2,
    runtimeTemplateSha256: sha256(Buffer.from(runtimeHex, "hex")),
    runtimeTemplateKeccak256: cast.stdout.trim(),
    // Foundry's object keys are compilation-unit AST IDs and therefore unstable. Runtime patch
    // locations are the release-relevant information and are deterministic across compile units.
    immutableReferenceSlots,
  };
}

const manifest = {
  schemaVersion: "programmable.custom-gateway-route-release-candidate.v1",
  status: "LOCAL_RELEASE_CANDIDATE_NOT_DEPLOYED",
  productionActivation: "NOT_AUTHORIZED",
  inputs: input,
  sourceClosure: sources.map((path) => ({
    path,
    sha256: sha256(readFileSync(resolve(contractsDirectory, path))),
  })),
  artifacts: contracts.map(bytecodeSummary),
  genericV2AbiParity: genericV2AbiParity(),
  deploymentAddressPlan: {
    operatorTransactionCount: 1,
    transaction: "Deploy ProgrammableCustomGatewayRoutePairCoordinatorV1(bytes32 authenticatedAdapterBindingHash)",
    coordinatorAddress: "derive from the authorized operator address and exact transaction nonce before signing",
    children: [
      { nonce: 1, contract: "ProgrammableCreate2GraphDeployerV1" },
      { nonce: 2, contract: "ProgrammableRouteGatedCreate2GraphFactoryV1" },
      { nonce: 3, contract: "ProgrammableCustomLaunchGatewayV1" },
    ],
    postDeploymentReadbacks: [
      "all four addresses have code",
      "implementation extcodehash equals 0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
      "factory AUTHORIZED_GATEWAY equals gateway",
      "gateway FACTORY equals factory and FACTORY_RUNTIME_CODE_HASH equals factory extcodehash",
      "factory and gateway bind Registry V2 and canonical PoolManager addresses and extcodehashes",
      "factory and gateway expose the same authenticated route adapter binding hash",
      "source verification and compiler settings reproduce every runtime",
    ],
  },
  perLaunchLifecycle: [
    "derive the execution-bound approvalId with Gateway.computeExecutionApprovalId from the exact descriptor, Generic-v2 graph commitment, expected graph deployment accumulator, primary index, route adapter release and approval window",
    "APPROVER_ROLE controller calls RegistryV2.authorizeApproval for that exact approvalId and descriptor hash with at least the Gateway's 13-block execution-to-registration safety margin remaining",
    "approved launchWallet sends one transaction to Gateway.executeApprovedGraph with exact value and reviewed calldata",
    "after the user transaction reaches the operational confirmation policy, REGISTRAR_ROLE controller calls RegistryV2.registerLaunch with fresh registration evidence",
    "after at least 12 more blocks and within the native blockhash window, FINALIZER_ROLE controller calls RegistryV2.finalizeLaunch with canonical block hashes and fresh finality evidence",
  ],
  requiredInternalInterfaceDelta: [
    "target the Gateway rather than the ungated Generic-v2 factory",
    "retain the Generic-v2 GRAPH_DEPLOYMENT_ACCUMULATOR_TYPEHASH and MAX_INITIALIZER_REVERT_BYTES compatibility getters and values",
    "set GraphAuthorization.authorizedLauncher to the Gateway while preserving the current Generic-v2 routeNamespace and routeNonce derivations",
    "pass the independent Registry approvalId beside the preserved Generic-v2 routeNonce in the Gateway execution tuple",
    "preserve the current descriptor.launchPlanHash as the SHA-256 digest of the authenticated launch/plan.json artifact",
    "derive the Registry approvalId with Gateway.computeExecutionApprovalId after the exact Generic-v2 graph and expected graph deployment accumulator are frozen",
    "supply and atomically verify that approval-bound preflight compiler-derived expected graph deployment accumulator",
    "authorize the exact Registry-v2 descriptor before exposing the browser-wallet transaction",
    "parse the Gateway event only from the frozen Gateway address, Generic-v2 target and summary events only from the frozen route-gated factory address, and Registry events only from the canonical Registry address before register/finalize",
    "keep the authenticated route-adapter, artifact, calldata and runtime equivalence checks in the registrar/finality verifier in addition to the Gateway's execution-bound approvalId check",
  ],
  excludedActions: ["wallet signature", "transaction broadcast", "deployment", "Registry write", "push", "merge"],
};

const output = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes("--write")) writeFileSync(outputPath, output);
else process.stdout.write(output);
