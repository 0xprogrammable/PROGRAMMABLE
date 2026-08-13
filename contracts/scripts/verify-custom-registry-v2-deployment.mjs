import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  toHex,
} from "viem";
import { mainnet } from "viem/chains";

import {
  REGISTRY_RECEIPT_SCHEMA,
  REGISTRY_VERIFICATION_SCHEMA,
  ZERO_ADDRESS,
  assertFinalizedDeploymentTransaction,
  assertPostDeploymentBinding,
  assertReviewedAuthorization,
  assertSourceVerificationBinding,
  requireDistinctRpcOrigins,
  sha256,
  verifyReviewedAuthorizationSignature,
} from "./custom-registry-v2-deployment-guards.mjs";
import {
  assertRegistryDeploymentPlan,
} from "./custom-registry-v2-deployment-plan.mjs";
import {
  assertSafeControllersAtBlock,
  commonFinalizedBlock,
} from "./custom-registry-v2-live-verification.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
  throw new Error("--output is required");
}
const outputPath = path.resolve(process.argv[outputIndex + 1]);
if (!outputPath.startsWith("/tmp/")) {
  throw new Error("Registry verification output must be under /tmp");
}
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const readEvidence = async (pathName, digestName, label) => {
  const filePath = path.resolve(required(pathName));
  if (!filePath.startsWith("/tmp/")) throw new Error(`${label} must be under /tmp`);
  const bytes = await readFile(filePath);
  const digest = sha256(bytes);
  if (digest !== required(digestName)) throw new Error(`${label} digest mismatch`);
  return { bytes, digest, value: JSON.parse(bytes) };
};

if (process.argv.includes("--finalize-source")) {
  const onchain = await readEvidence(
    "REGISTRY_ONCHAIN_VERIFICATION_PATH",
    "REGISTRY_ONCHAIN_VERIFICATION_SHA256",
    "onchain verification",
  );
  const source = await readEvidence(
    "REGISTRY_SOURCE_VERIFICATION_PATH",
    "REGISTRY_SOURCE_VERIFICATION_SHA256",
    "source verification",
  );
  assertSourceVerificationBinding({
    onchain: onchain.value,
    source: source.value,
  });
  const standardJsonInputPath = path.resolve(
    required("REGISTRY_STANDARD_JSON_INPUT_PATH"),
  );
  const standardJsonOutputPath = path.resolve(
    required("REGISTRY_STANDARD_JSON_OUTPUT_PATH"),
  );
  if (
    !standardJsonInputPath.startsWith("/tmp/") ||
    !standardJsonOutputPath.startsWith("/tmp/") ||
    path.basename(standardJsonInputPath) !==
      source.value.compiler.standardJsonInputEvidenceFile ||
    path.basename(standardJsonOutputPath) !==
      source.value.compiler.standardJsonOutputEvidenceFile
  ) {
    throw new Error("exact standard-json evidence paths are invalid");
  }
  const [standardJsonInputBytes, standardJsonOutputBytes] = await Promise.all([
    readFile(standardJsonInputPath),
    readFile(standardJsonOutputPath),
  ]);
  if (
    sha256(standardJsonInputBytes) !==
      source.value.compiler.standardJsonInputSha256 ||
    sha256(standardJsonOutputBytes) !==
      source.value.compiler.standardJsonOutputSha256
  ) {
    throw new Error("exact standard-json evidence digest mismatch");
  }
  const standardJsonInput = JSON.parse(standardJsonInputBytes);
  const standardJsonOutput = JSON.parse(standardJsonOutputBytes);
  const reviewedArtifact = JSON.parse(
    await readFile(
      path.join(
        root,
        "contracts/out/ProgrammableCustomRegistryV2.sol/ProgrammableCustomRegistryV2.json",
      ),
    ),
  );
  const compiled =
    standardJsonOutput.contracts?.[
      "src/ProgrammableCustomRegistryV2.sol"
    ]?.ProgrammableCustomRegistryV2;
  if (
    standardJsonInput.language !== "Solidity" ||
    standardJsonInput.settings?.optimizer?.enabled !== true ||
    standardJsonInput.settings?.optimizer?.runs !== 1000 ||
    standardJsonInput.settings?.evmVersion !== "cancun" ||
    standardJsonInput.settings?.metadata?.bytecodeHash !== "none" ||
    standardJsonInput.settings?.metadata?.appendCBOR !== false ||
    standardJsonOutput.errors?.some(({ severity }) => severity === "error") ||
    `0x${compiled?.evm?.bytecode?.object ?? ""}` !==
      reviewedArtifact.bytecode.object ||
    `0x${compiled?.evm?.deployedBytecode?.object ?? ""}` !==
      reviewedArtifact.deployedBytecode.object
  ) {
    throw new Error("exact standard-json compiler evidence is invalid");
  }
  const final = {
    ...onchain.value,
    status: "VERIFIED_FINALIZED_AND_EXACT_SOURCE",
    sourceVerificationSha256: source.digest,
    sourceVerification: source.value,
    verified: true,
  };
  await writeFile(outputPath, `${JSON.stringify(final, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    `CUSTOM_REGISTRY_V2_FINAL_VERIFIED ${outputPath} ${sha256(Buffer.from(`${JSON.stringify(final, null, 2)}\n`))}\n`,
  );
  process.exit(0);
}

const reviewed = await readEvidence(
  "REGISTRY_REVIEWED_PLAN_PATH",
  "REGISTRY_REVIEWED_PLAN_SHA256",
  "reviewed plan",
);
const authorized = await readEvidence(
  "REGISTRY_BROADCAST_AUTHORIZATION_PATH",
  "REGISTRY_BROADCAST_AUTHORIZATION_SHA256",
  "broadcast authorization",
);
const safeEvidence = await readEvidence(
  "REGISTRY_SAFE_VERIFICATION_PATH",
  "REGISTRY_SAFE_VERIFICATION_SHA256",
  "Safe verification",
);
const journalPath = path.resolve(required("REGISTRY_DEPLOYMENT_JOURNAL_PATH"));
if (!journalPath.startsWith("/tmp/")) {
  throw new Error("deployment journal must be under /tmp");
}
const journalBytes = await readFile(journalPath);
if (sha256(journalBytes) !== required("REGISTRY_DEPLOYMENT_JOURNAL_SHA256")) {
  throw new Error("deployment journal digest mismatch");
}
const journal = journalBytes
  .toString("utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const header = journal[0];
const signed = journal.find((entry) => entry.event === "SIGNED_NOT_CONFIRMED");
if (
  header?.schemaVersion !== REGISTRY_RECEIPT_SCHEMA ||
  header.event !== "JOURNAL_OPEN" ||
  header.preflightSha256 !== reviewed.digest ||
  header.authorizationSha256 !== authorized.digest ||
  header.safeVerificationSha256 !== safeEvidence.digest ||
  !signed?.serializedTransaction ||
  keccak256(signed.serializedTransaction) !== signed.transactionHash ||
  journal.some(
    (entry) =>
      entry.transactionHash !== undefined &&
      entry.transactionHash !== signed.transactionHash,
  )
) {
  throw new Error("deployment receipt journal is invalid");
}

const plan = reviewed.value;
const authorization = authorized.value;
const planInputs = await assertRegistryDeploymentPlan({
  root,
  plan,
  safeVerificationBytes: safeEvidence.bytes,
  nowTimestamp: 0,
  allowExpired: true,
});
assertReviewedAuthorization({
  authorization,
  preflightSha256: reviewed.digest,
  plan,
  nowTimestamp: 0,
  allowExpired: true,
});
await verifyReviewedAuthorizationSignature(authorization);

const rpcA = required("REGISTRY_PREFLIGHT_RPC_URL_A");
const rpcB = required("REGISTRY_PREFLIGHT_RPC_URL_B");
requireDistinctRpcOrigins(rpcA, rpcB);
const providerIds = [
  required("REGISTRY_RPC_PROVIDER_ID_A"),
  required("REGISTRY_RPC_PROVIDER_ID_B"),
];
if (JSON.stringify(providerIds) !== JSON.stringify(plan.rpcProviders)) {
  throw new Error("RPC provider identity drifted from reviewed plan");
}
const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: http(url) }),
);
const finalized = await commonFinalizedBlock(clients);
const chainObservations = await Promise.all(
  clients.map(async (client) => {
    const [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash: signed.transactionHash }),
      client.getTransactionReceipt({ hash: signed.transactionHash }),
    ]);
    if (receipt.blockNumber > finalized.number) {
      throw new Error("Registry deployment has not reached common finality");
    }
    const [receiptBlock, runtime] = await Promise.all([
      client.getBlock({ blockNumber: receipt.blockNumber }),
      client.getCode({
        address: plan.create.predictedAddress,
        blockNumber: finalized.number,
      }),
    ]);
    return { transaction, receipt, receiptBlock, runtime: runtime ?? "0x" };
  }),
);
const normalizedTransaction = ({ transaction, receipt, receiptBlock, runtime }) => ({
  hash: transaction.hash,
  blockNumber: transaction.blockNumber?.toString(),
  blockHash: transaction.blockHash,
  from: getAddress(transaction.from),
  to: transaction.to,
  input: transaction.input,
  value: transaction.value.toString(),
  nonce: transaction.nonce,
  chainId: transaction.chainId,
  type: transaction.type,
  gas: transaction.gas.toString(),
  maxFeePerGas: transaction.maxFeePerGas?.toString(),
  maxPriorityFeePerGas: transaction.maxPriorityFeePerGas?.toString(),
  receiptStatus: receipt.status,
  receiptContractAddress: getAddress(receipt.contractAddress),
  receiptBlockNumber: receipt.blockNumber.toString(),
  receiptBlockHash: receipt.blockHash,
  receiptTransactionHash: receipt.transactionHash,
  receiptTransactionIndex: receipt.transactionIndex,
  receiptGasUsed: receipt.gasUsed.toString(),
  receiptEffectiveGasPrice: receipt.effectiveGasPrice.toString(),
  receiptLogs: receipt.logs.map((log) => ({
    address: getAddress(log.address),
    topics: log.topics,
    data: log.data,
    logIndex: log.logIndex,
  })),
  receiptBlockTimestamp: receiptBlock.timestamp.toString(),
  runtimeCodeKeccak256: keccak256(runtime),
});
const txA = normalizedTransaction(chainObservations[0]);
const txB = normalizedTransaction(chainObservations[1]);
if (JSON.stringify(txA) !== JSON.stringify(txB)) {
  throw new Error("independent finalized transaction or receipt evidence disagrees");
}
assertFinalizedDeploymentTransaction({
  actual: txA,
  transactionHash: signed.transactionHash,
  plan,
  authorization,
});
const runtimeA = chainObservations[0].runtime;
const runtimeB = chainObservations[1].runtime;
if (
  runtimeA !== runtimeB ||
  (runtimeA.length - 2) / 2 !== plan.expectedRuntime.codeLength
) {
  throw new Error("finalized Registry runtime bytes disagree");
}

const abi = planInputs.committedAbiDocument.abi;
const address = getAddress(plan.create.predictedAddress);
const readAll = async (client) => {
  const read = (functionName, args = undefined) =>
    client.readContract({
      address,
      abi,
      functionName,
      ...(args === undefined ? {} : { args }),
      blockNumber: finalized.number,
    });
  const roleNames = ["APPROVER_ROLE", "REGISTRAR_ROLE", "FINALIZER_ROLE", "REVOKER_ROLE"];
  const roleValues = await Promise.all(roleNames.map((name) => read(name)));
  const expectedControllers = [
    plan.constructor.initialApprover,
    plan.constructor.initialRegistrar,
    plan.constructor.initialFinalizer,
    plan.constructor.initialRevoker,
  ].map(getAddress);
  const [
    platformId,
    category,
    registryGeneration,
    standardFee,
    noMarketFee,
    schemaId,
    descriptorTypehash,
    launchIdDomain,
    standardPolicyId,
    noMarketPolicyId,
    chainId,
    adminDelay,
    admin,
    pendingAdminTuple,
    minimumFinalityBlocks,
    policy,
    approvalCount,
    registrationCount,
    transitionCount,
    defaultAdminRole,
    ...controllers
  ] = await Promise.all([
    read("PLATFORM_ID"),
    read("CATEGORY"),
    read("REGISTRY_GENERATION"),
    read("STANDARD10_PROTOCOL_FEE_BPS"),
    read("NO_MARKET0_PROTOCOL_FEE_BPS"),
    read("REGISTRY_SCHEMA_ID"),
    read("DESCRIPTOR_TYPEHASH"),
    read("LAUNCH_ID_DOMAIN"),
    read("STANDARD10_POLICY_ID"),
    read("NO_MARKET0_POLICY_ID"),
    read("CHAIN_ID"),
    read("defaultAdminDelay"),
    read("defaultAdmin"),
    read("pendingDefaultAdmin"),
    read("MINIMUM_FINALITY_BLOCKS"),
    read("REGISTRY_POLICY_COMMITMENT"),
    read("approvalCount"),
    read("registrationCount"),
    read("transitionCount"),
    read("DEFAULT_ADMIN_ROLE"),
    ...roleValues.map((role) => read("operationalController", [role])),
  ]);
  const [pendingAdmin, pendingAdminSchedule] = pendingAdminTuple;
  const pendingControllers = await Promise.all(
    roleValues.map(async (role) => {
      const pending = await read("pendingOperationalController", [role]);
      return Array.isArray(pending)
        ? { controller: pending[0], acceptAfter: pending[1] }
        : pending;
    }),
  );
  const negativeAccounts = [
    ZERO_ADDRESS,
    plan.constructor.initialAdmin,
    plan.create.deployer,
    plan.releaseAuthorization.owner,
    ...plan.safeControllers.controllers.map(({ owner }) => owner),
    ...expectedControllers,
  ].map(getAddress);
  const roleAssignments = await Promise.all(
    roleValues.map(async (role, index) => {
      const assignments = await Promise.all(
        negativeAccounts.map((candidate) => read("hasRole", [role, candidate])),
      );
      if (
        assignments.some(
          (assigned, candidateIndex) =>
            assigned !==
            (negativeAccounts[candidateIndex] === expectedControllers[index]),
        )
      ) {
        throw new Error(`unexpected positive or negative role assignment at ${index}`);
      }
      const roleAdmin = await read("getRoleAdmin", [role]);
      if (roleAdmin !== defaultAdminRole || defaultAdminRole !== `0x${"00".repeat(32)}`) {
        throw new Error(`operational role admin is invalid at ${index}`);
      }
      return {
        expectedControllerHasRole: assignments[
          negativeAccounts.indexOf(expectedControllers[index])
        ],
        zeroAddressHasRole: assignments[negativeAccounts.indexOf(ZERO_ADDRESS)],
        adminHasRole: assignments[
          negativeAccounts.indexOf(getAddress(plan.constructor.initialAdmin))
        ],
      };
    }),
  );
  const adminHasDefaultRole = await read("hasRole", [
    defaultAdminRole,
    getAddress(plan.constructor.initialAdmin),
  ]);
  if (adminHasDefaultRole !== true) {
    throw new Error("initial admin lacks the default admin role");
  }
  return {
    platformId,
    category,
    registryGeneration,
    standardFee,
    noMarketFee,
    schemaId,
    descriptorTypehash,
    launchIdDomain,
    standardPolicyId,
    noMarketPolicyId,
    chainId,
    adminDelay,
    admin,
    pendingAdmin,
    pendingAdminSchedule,
    minimumFinalityBlocks,
    policy,
    approvalCount,
    registrationCount,
    transitionCount,
    controllers,
    pendingControllers,
    roleAssignments,
  };
};
const states = await Promise.all(clients.map(readAll));
const serialize = (value) =>
  JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
if (serialize(states[0]) !== serialize(states[1])) {
  throw new Error("independent finalized Registry state observations disagree");
}
const state = states[0];
const expectedConstants = {
  platformId: "programmable",
  category: "custom",
  registryGeneration: 2n,
  standardFee: 10,
  noMarketFee: 0,
  schemaId: keccak256(toHex("programmable.custom-registry.v2")),
  descriptorTypehash: keccak256(
    toHex(
      "LaunchDescriptorV2(uint256 chainId,address launchWallet,address primaryContract,bytes32 primaryRuntimeCodeHash,bytes32 componentSetHash,bytes32 sourceArtifactHash,bytes32 configurationHash,bytes32 launchPlanHash,bytes32 projectCommitment,uint8 marketMode,uint16 protocolFeeBps)",
    ),
  ),
  launchIdDomain: keccak256(toHex("programmable.custom-launch-id.v2")),
  standardPolicyId: keccak256(
    toHex("programmable.custom.fee.standard10.v2"),
  ),
  noMarketPolicyId: keccak256(
    toHex("programmable.custom.fee.no-market0.v2"),
  ),
};
for (const [field, expected] of Object.entries(expectedConstants)) {
  if (state[field] !== expected) {
    throw new Error(`finalized Registry constant ${field} is invalid`);
  }
}
const expectedControllers = [
  plan.constructor.initialApprover,
  plan.constructor.initialRegistrar,
  plan.constructor.initialFinalizer,
  plan.constructor.initialRevoker,
].map(getAddress);
assertPostDeploymentBinding({
  actual: { runtimeA, runtimeB, ...state },
  expected: {
    ...plan.constructor,
    controllers: expectedControllers,
    runtimeCodeKeccak256: plan.expectedRuntime.codeKeccak256,
  },
});
const safeControllers = await assertSafeControllersAtBlock({
  clients,
  blockNumber: finalized.number,
  safeVerification: planInputs.safeVerification,
  safePolicy: JSON.parse(planInputs.safePolicyBytes),
});

const creationBytecodeLength = planInputs.artifact.bytecode.object.length;
if (!plan.expectedTransaction.input.startsWith(planInputs.artifact.bytecode.object)) {
  throw new Error("deployment input does not begin with exact creation bytecode");
}
const constructorArguments = `0x${plan.expectedTransaction.input.slice(creationBytecodeLength)}`;
const verification = {
  schemaVersion: REGISTRY_VERIFICATION_SCHEMA,
  status: "VERIFIED_FINALIZED_ONCHAIN_AWAITING_SOURCE",
  chainId: 1,
  source: plan.source,
  preflightSha256: reviewed.digest,
  authorizationSha256: authorized.digest,
  deploymentJournalSha256: sha256(journalBytes),
  safeVerificationSha256: safeEvidence.digest,
  contractAddress: address,
  transactionHash: signed.transactionHash,
  deploymentBlockNumber: txA.receiptBlockNumber,
  deploymentBlockHash: txA.receiptBlockHash,
  finalizedBlockNumber: finalized.number.toString(),
  finalizedBlockHash: finalized.hash,
  minimumFinalityBlocks: plan.constructor.minimumFinalityBlocks,
  runtimeCodeKeccak256: plan.expectedRuntime.codeKeccak256,
  runtimeCodeLength: plan.expectedRuntime.codeLength,
  constructorCommitment: plan.constructorCommitment,
  constructorArguments,
  registryPolicyCommitment: plan.constructor.registryPolicyCommitment,
  state: {
    platformId: state.platformId,
    category: state.category,
    registryGeneration: state.registryGeneration.toString(),
    chainId: state.chainId.toString(),
    admin: getAddress(state.admin),
    adminDelay: state.adminDelay.toString(),
    pendingAdmin: getAddress(state.pendingAdmin),
    pendingAdminSchedule: state.pendingAdminSchedule.toString(),
    controllers: expectedControllers,
    pendingControllers: state.pendingControllers.map(({ controller, acceptAfter }) => ({
      controller: getAddress(controller),
      acceptAfter: acceptAfter.toString(),
    })),
    counters: {
      approval: state.approvalCount.toString(),
      registration: state.registrationCount.toString(),
      transition: state.transitionCount.toString(),
    },
  },
  safeControllers,
  verified: false,
};
await writeFile(outputPath, `${JSON.stringify(verification, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_ONCHAIN_VERIFIED_AWAITING_SOURCE ${outputPath} ${sha256(Buffer.from(`${JSON.stringify(verification, null, 2)}\n`))}\n`,
);
