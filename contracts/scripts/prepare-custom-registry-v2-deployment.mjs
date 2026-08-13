import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  encodeDeployData,
  getAddress,
  getContractAddress,
  http,
  keccak256,
} from "viem";
import { mainnet } from "viem/chains";

import {
  REGISTRY_PREFLIGHT_SCHEMA,
  assessDeploymentCost,
  assertPredictedAddressUnoccupied,
  computeConstructorCommitment,
  requireDistinctRpcOrigins,
  sha256,
} from "./custom-registry-v2-deployment-guards.mjs";
import {
  assertRegistryDeploymentPlan,
  currentSourceIdentity,
  loadRegistryDeploymentInputs,
} from "./custom-registry-v2-deployment-plan.mjs";
import { assertCustomRegistryV2ProductionConstructor } from "./custom-registry-v2-production-policy.mjs";
import { assertDistinctControllerOwners } from "./custom-registry-v2-safe-controller-guards.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
  throw new Error("--output is required");
}
const output = path.resolve(process.argv[outputIndex + 1]);
if (!output.startsWith("/tmp/")) {
  throw new Error("preflight output must be under /tmp");
}

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const positiveInteger = (name, maximum) => {
  const raw = required(name);
  if (!/^[1-9][0-9]*$/u.test(raw)) throw new Error(`${name} is invalid`);
  const value = BigInt(raw);
  if (value > maximum) throw new Error(`${name} is out of range`);
  return value;
};
const rpcA = required("REGISTRY_PREFLIGHT_RPC_URL_A");
const rpcB = required("REGISTRY_PREFLIGHT_RPC_URL_B");
requireDistinctRpcOrigins(rpcA, rpcB);
const providerIds = [
  required("REGISTRY_RPC_PROVIDER_ID_A"),
  required("REGISTRY_RPC_PROVIDER_ID_B"),
];
if (
  providerIds[0].toLowerCase() === providerIds[1].toLowerCase() ||
  providerIds.some((value) => !/^[a-z0-9][a-z0-9._-]{2,63}$/iu.test(value))
) {
  throw new Error("two explicit distinct RPC provider identities are required");
}
const maxFeePerGas = positiveInteger(
  "REGISTRY_MAX_FEE_PER_GAS_WEI",
  (1n << 256n) - 1n,
);
const maxPriorityFeePerGas = positiveInteger(
  "REGISTRY_MAX_PRIORITY_FEE_PER_GAS_WEI",
  maxFeePerGas,
);
const maxTotalCostWei = positiveInteger(
  "REGISTRY_MAX_TOTAL_COST_WEI",
  (1n << 256n) - 1n,
);
const validitySeconds = positiveInteger(
  "REGISTRY_PREFLIGHT_VALIDITY_SECONDS",
  900n,
);
const deployer = getAddress(required("REGISTRY_DEPLOYER"));
const admin = getAddress(required("REGISTRY_ADMIN"));
const releaseOwner = getAddress(required("REGISTRY_RELEASE_OWNER"));

const safeVerificationPath = path.resolve(
  required("REGISTRY_SAFE_VERIFICATION_PATH"),
);
if (!safeVerificationPath.startsWith("/tmp/")) {
  throw new Error("Safe verification must be under /tmp");
}
const safeVerificationBytes = await readFile(safeVerificationPath);
if (
  sha256(safeVerificationBytes) !==
  required("REGISTRY_SAFE_VERIFICATION_SHA256")
) {
  throw new Error("Safe verification digest mismatch");
}
const inputs = await loadRegistryDeploymentInputs({
  root,
  safeVerificationBytes,
});
const {
  artifact,
  manifest,
  manifestBytes,
  committedAbiBytes,
  committedAbiDocument,
  safePolicyBytes,
  safeVerification,
  productionPolicy,
  productionPolicyBytes,
} = inputs;
const source = currentSourceIdentity(root);
if (!source.clean)
  throw new Error("deployment preflight requires a clean worktree");

if (
  getAddress(safeVerification.deployer) !== deployer ||
  getAddress(safeVerification.admin) !== admin ||
  getAddress(safeVerification.releaseOwner) !== releaseOwner ||
  getAddress(manifest.releaseAuthorization.owner) !== releaseOwner ||
  manifest.releaseAuthorization.maximumSigningAndFirstAttemptValiditySeconds !==
    300 ||
  manifest.releaseAuthorization.authorizationSemantics !==
    "SIGN_AND_FIRST_BROADCAST_ATTEMPT_ONLY_LATER_EXACT_RAW_REBROADCAST_AND_INCLUSION_ALLOWED"
) {
  throw new Error("deployer, admin, or release owner evidence mismatch");
}
const roleNames = ["approver", "registrar", "finalizer", "revoker"];
const controllerEvidence = roleNames.map((role) => {
  const controller = safeVerification.controllers.find(
    (candidate) => candidate.role === role,
  );
  if (!controller) throw new Error(`verified ${role} Safe is missing`);
  return controller;
});
const controllers = controllerEvidence.map(({ address }) =>
  getAddress(address),
);
const config = {
  initialAdminDelay: BigInt(
    productionPolicy.constructorPolicy.initialAdminDelaySeconds,
  ),
  initialAdmin: admin,
  initialApprover: controllers[0],
  initialRegistrar: controllers[1],
  initialFinalizer: controllers[2],
  initialRevoker: controllers[3],
  minimumFinalityBlocks: BigInt(
    productionPolicy.constructorPolicy.minimumFinalityBlocks,
  ),
  registryPolicyCommitment: productionPolicy.registryPolicyCommitment,
};
assertCustomRegistryV2ProductionConstructor(config, productionPolicy);
assertDistinctControllerOwners({
  deployer,
  admin,
  releaseOwner,
  owners: controllerEvidence.map(({ owner }) => owner),
});

const deploymentData = encodeDeployData({
  abi: committedAbiDocument.abi,
  bytecode: artifact.bytecode.object,
  args: [config],
});
const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: http(url) }),
);
const heads = await Promise.all(
  clients.map(async (client) => {
    const [chainId, finalized, latest, nonce, balance, priorityFee] =
      await Promise.all([
        client.getChainId(),
        client.getBlock({ blockTag: "finalized" }),
        client.getBlock({ blockTag: "latest" }),
        client.getTransactionCount({ address: deployer, blockTag: "pending" }),
        client.getBalance({ address: deployer, blockTag: "latest" }),
        client.estimateMaxPriorityFeePerGas(),
      ]);
    if (chainId !== 1) throw new Error("preflight endpoint is not mainnet");
    return { finalized, latest, nonce, balance, priorityFee };
  }),
);
const commonFinalizedNumber = heads.reduce(
  (minimum, { finalized }) =>
    finalized.number < minimum ? finalized.number : minimum,
  heads[0].finalized.number,
);
const anchors = await Promise.all(
  clients.map((client) =>
    client.getBlock({ blockNumber: commonFinalizedNumber }),
  ),
);
if (
  anchors[0].hash !== anchors[1].hash ||
  heads[0].nonce !== heads[1].nonce ||
  heads[0].balance !== heads[1].balance
) {
  throw new Error(
    "independent preflight chain, nonce, or balance observations disagree",
  );
}
const exactPendingNonce = heads[0].nonce;
if (!Number.isSafeInteger(exactPendingNonce)) {
  throw new Error("deployer nonce exceeds JSON safe integer range");
}
const predictedAddress = getContractAddress({
  from: deployer,
  nonce: BigInt(exactPendingNonce),
});
const observations = await Promise.all(
  clients.map(async (client, index) => {
    const [
      predictedCode,
      predictedNonce,
      predictedBalance,
      estimatedGas,
      call,
    ] = await Promise.all([
      client.getCode({ address: predictedAddress, blockTag: "latest" }),
      client.getTransactionCount({
        address: predictedAddress,
        blockTag: "latest",
      }),
      client.getBalance({ address: predictedAddress, blockTag: "latest" }),
      client.estimateGas({ account: deployer, data: deploymentData }),
      client.call({
        account: deployer,
        data: deploymentData,
        blockNumber: commonFinalizedNumber,
      }),
    ]);
    assertPredictedAddressUnoccupied({
      code: predictedCode,
      nonce: predictedNonce,
      balance: predictedBalance,
    });
    if (!call.data || call.data === "0x") {
      throw new Error("contract-creation simulation returned no runtime");
    }
    return {
      providerId: providerIds[index],
      estimatedGas,
      predictedCode: predictedCode ?? "0x",
      predictedNonce,
      predictedBalance,
      runtime: call.data,
    };
  }),
);
if (observations[0].runtime !== observations[1].runtime) {
  throw new Error("independent RPCs disagree on exact simulated runtime");
}
const expectedRuntimeCodeKeccak256 = keccak256(observations[0].runtime);
const expectedRuntimeCodeLength = (observations[0].runtime.length - 2) / 2;

const gasEstimate = observations.reduce(
  (maximum, observation) =>
    observation.estimatedGas > maximum ? observation.estimatedGas : maximum,
  0n,
);
const gasLimit = (gasEstimate * 120n + 99n) / 100n;
const minimumObservedBlockGasLimit = heads.reduce(
  (minimum, { latest }) =>
    latest.gasLimit < minimum ? latest.gasLimit : minimum,
  heads[0].latest.gasLimit,
);
const maximumObservedPriorityFee = heads.reduce(
  (maximum, { priorityFee }) => (priorityFee > maximum ? priorityFee : maximum),
  0n,
);
if (maximumObservedPriorityFee > maxPriorityFeePerGas) {
  throw new Error(
    "observed priority fee exceeds the reviewed priority ceiling",
  );
}
const maximumObservedFeePerGas = heads.reduce((maximum, { latest }) => {
  const candidate = (latest.baseFeePerGas ?? 0n) * 2n + maxPriorityFeePerGas;
  return candidate > maximum ? candidate : maximum;
}, 0n);
const maximumCostWei = assessDeploymentCost({
  gasLimit,
  blockGasLimit: minimumObservedBlockGasLimit,
  observedFeePerGas: maximumObservedFeePerGas,
  maxFeePerGas,
  maxPriorityFeePerGas,
  maxTotalCostWei,
  deployerBalance: heads[0].balance,
});

const isolated = [
  deployer,
  admin,
  releaseOwner,
  ...controllerEvidence.map(({ owner }) => owner),
  ...controllers,
  predictedAddress,
].map((value) => getAddress(value).toLowerCase());
if (new Set(isolated).size !== isolated.length) {
  throw new Error("Registry deployment identities are not fully isolated");
}

const createdAtTimestamp = Math.floor(Date.now() / 1000);
const serializedConfig = Object.fromEntries(
  Object.entries(config).map(([key, value]) => [
    key,
    typeof value === "bigint" ? value.toString() : value,
  ]),
);
const plan = {
  schemaVersion: REGISTRY_PREFLIGHT_SCHEMA,
  status: "PREFLIGHT_ONLY_NO_TRANSACTION",
  source: {
    commit: source.commit,
    tree: source.tree,
    sourceManifestSha256: sha256(manifestBytes),
    committedAbiSha256: sha256(committedAbiBytes),
    creationBytecodeKeccak256: keccak256(artifact.bytecode.object),
    deploymentDataKeccak256: keccak256(deploymentData),
  },
  chainId: 1,
  rpcProviders: providerIds,
  commonFinalizedAnchor: {
    blockNumber: commonFinalizedNumber.toString(),
    blockHash: anchors[0].hash,
  },
  createdAtTimestamp,
  expiresAtTimestamp: createdAtTimestamp + Number(validitySeconds),
  create: {
    kind: "CREATE",
    deployer,
    exactPendingNonce,
    predictedAddress,
    gasEstimates: observations.map(({ providerId, estimatedGas }) => ({
      providerId,
      gas: estimatedGas.toString(),
    })),
    gasLimit: gasLimit.toString(),
    minimumObservedBlockGasLimit: minimumObservedBlockGasLimit.toString(),
    maximumObservedFeePerGas: maximumObservedFeePerGas.toString(),
    maximumObservedPriorityFeePerGas: maximumObservedPriorityFee.toString(),
    reviewedMaxFeePerGas: maxFeePerGas.toString(),
    reviewedMaxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    reviewedMaxTotalCostWei: maxTotalCostWei.toString(),
    maximumCostWei: maximumCostWei.toString(),
    deployerBalanceWei: heads[0].balance.toString(),
    expectedRuntimeCodeKeccak256,
    expectedRuntimeCodeLength,
  },
  expectedTransaction: {
    type: "eip1559",
    chainId: 1,
    from: deployer,
    to: null,
    input: deploymentData,
    valueWei: "0",
    nonce: exactPendingNonce,
    gasLimit: gasLimit.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
  },
  expectedRuntime: {
    derivedBy: "dual-rpc-eth_call-contract-creation-at-common-finalized-anchor",
    codeKeccak256: expectedRuntimeCodeKeccak256,
    codeLength: expectedRuntimeCodeLength,
  },
  constructor: serializedConfig,
  constructorCommitment: computeConstructorCommitment(config),
  productionPolicy: {
    document: path.relative(root, productionPolicy.documentPath),
    documentSha256: sha256(productionPolicyBytes),
    registryPolicyCommitment: productionPolicy.registryPolicyCommitment,
  },
  safeControllers: {
    verificationSha256: sha256(safeVerificationBytes),
    policySha256: sha256(safePolicyBytes),
    custodyProofSha256: safeVerification.custodyProofSha256,
    finalizedAnchor: safeVerification.finalizedAnchor,
    controllers: controllerEvidence.map(
      ({ role, address, owner, transactionHash, runtimeCodeKeccak256 }) => ({
        role,
        address,
        owner,
        transactionHash,
        runtimeCodeKeccak256,
      }),
    ),
  },
  releaseAuthorization: {
    owner: releaseOwner,
    maximumSigningAndFirstAttemptValiditySeconds: 300,
    authorizationSemantics:
      manifest.releaseAuthorization.authorizationSemantics,
  },
  broadcastAllowed: false,
  signingAllowed: false,
};

await assertRegistryDeploymentPlan({
  root,
  plan,
  safeVerificationBytes,
  nowTimestamp: createdAtTimestamp,
});
await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_DEPLOYMENT_PREFLIGHT ${output} ${sha256(Buffer.from(`${JSON.stringify(plan, null, 2)}\n`))}\n`,
);
