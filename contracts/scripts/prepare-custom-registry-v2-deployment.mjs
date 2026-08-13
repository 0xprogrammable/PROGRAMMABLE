import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
  assessDeploymentCost,
  computeConstructorCommitment,
  requireDistinctRpcOrigins,
} from "./custom-registry-v2-deployment-guards.mjs";
import {
  assertCustomRegistryV2ProductionConstructor,
  loadCustomRegistryV2ProductionPolicy,
} from "./custom-registry-v2-production-policy.mjs";
import {
  SAFE_VERIFICATION_SCHEMA,
  assertDistinctControllerOwners,
} from "./custom-registry-v2-safe-controller-guards.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1])
  throw new Error("--output is required");
const output = path.resolve(process.argv[outputIndex + 1]);
if (!output.startsWith("/tmp/"))
  throw new Error("preflight output must be under /tmp");

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const positiveInteger = (name, maximum) => {
  const value = BigInt(required(name));
  if (value <= 0n || value > maximum)
    throw new Error(`${name} is out of range`);
  return value;
};
const bytes32 = (name) => {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value))
    throw new Error(`${name} is invalid`);
  return value;
};
const rpcA = required("REGISTRY_PREFLIGHT_RPC_URL_A");
const rpcB = required("REGISTRY_PREFLIGHT_RPC_URL_B");
requireDistinctRpcOrigins(rpcA, rpcB);
const maxFeePerGas = positiveInteger(
  "REGISTRY_MAX_FEE_PER_GAS_WEI",
  (1n << 256n) - 1n,
);
const maxTotalCostWei = positiveInteger(
  "REGISTRY_MAX_TOTAL_COST_WEI",
  (1n << 256n) - 1n,
);
const validitySeconds = positiveInteger(
  "REGISTRY_PREFLIGHT_VALIDITY_SECONDS",
  900n,
);

const artifactBytes = await readFile(
  path.join(
    root,
    "contracts/out/ProgrammableCustomRegistryV2.sol/ProgrammableCustomRegistryV2.json",
  ),
);
const artifact = JSON.parse(artifactBytes);
const manifestBytes = await readFile(
  path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"),
);
const manifest = JSON.parse(manifestBytes);
const committedAbiBytes = await readFile(
  path.join(root, "docs/security/abi/ProgrammableCustomRegistryV2.json"),
);
const committedAbiDocument = JSON.parse(committedAbiBytes);
if (
  manifest.status !== "SOURCE_ONLY_NOT_DEPLOYED" ||
  manifest.activationAllowed !== false
) {
  throw new Error("source manifest is not fail-closed");
}
if (
  manifest.artifact?.creationBytecodeKeccak256 !==
    keccak256(artifact.bytecode.object) ||
  manifest.artifact?.runtimeTemplateKeccak256 !==
    keccak256(artifact.deployedBytecode.object) ||
  manifest.artifact?.abiSha256 !==
    `0x${createHash("sha256").update(committedAbiBytes).digest("hex")}` ||
  committedAbiDocument.schemaVersion !== "programmable.custom-registry-abi.v2"
)
  throw new Error("artifact does not match the source manifest");
for (const [relative, digest] of Object.entries(manifest.sourceDigests ?? {})) {
  const actual = `0x${createHash("sha256")
    .update(await readFile(path.join(root, relative)))
    .digest("hex")}`;
  if (actual !== digest)
    throw new Error(`${relative} does not match the source manifest`);
}

const safeVerificationPath = path.resolve(
  required("REGISTRY_SAFE_VERIFICATION_PATH"),
);
if (!safeVerificationPath.startsWith("/tmp/"))
  throw new Error("Safe verification must be under /tmp");
const safeVerificationBytes = await readFile(safeVerificationPath);
const safeVerificationSha256 = `0x${createHash("sha256")
  .update(safeVerificationBytes)
  .digest("hex")}`;
if (safeVerificationSha256 !== required("REGISTRY_SAFE_VERIFICATION_SHA256"))
  throw new Error("Safe verification digest mismatch");
const safeVerification = JSON.parse(safeVerificationBytes);
const safePolicyBytes = await readFile(
  path.join(root, "config/custom-registry-v2-safe-controller-policy.json"),
);
const safePolicySha256 = `0x${createHash("sha256")
  .update(safePolicyBytes)
  .digest("hex")}`;
if (
  safeVerification.schemaVersion !== SAFE_VERIFICATION_SCHEMA ||
  safeVerification.status !== "VERIFIED_FINALIZED_SAFE_CONTROLLERS" ||
  safeVerification.chainId !== 1 ||
  safeVerification.verified !== true ||
  safeVerification.source?.commit !==
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim() ||
  safeVerification.source?.tree !==
    execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
      cwd: root,
      encoding: "utf8",
    }).trim() ||
  safeVerification.policySha256 !== safePolicySha256 ||
  safeVerification.controllers?.length !== 4 ||
  safeVerification.controllers.some(
    ({
      runtimeCodeKeccak256,
      masterCopy,
      threshold,
      modules,
      fallbackHandler,
      guard,
    }) =>
      runtimeCodeKeccak256 !==
        safeVerification.proxyFactory.proxyRuntimeCodeKeccak256 ||
      getAddress(masterCopy) !==
        getAddress(safeVerification.singleton.address) ||
      threshold !== "1" ||
      modules?.length !== 0 ||
      fallbackHandler !== "0x0000000000000000000000000000000000000000" ||
      guard !== "0x0000000000000000000000000000000000000000",
  )
)
  throw new Error("Safe controller verification is invalid or source-drifted");

const deployer = getAddress(required("REGISTRY_DEPLOYER"));
const releaseOwner = getAddress(required("REGISTRY_RELEASE_OWNER"));
if (
  !manifest.releaseAuthorization?.owner ||
  manifest.releaseAuthorization.maximumValiditySeconds !== 300 ||
  releaseOwner !== getAddress(manifest.releaseAuthorization.owner)
) {
  throw new Error("release owner does not match the committed source manifest");
}
const verifiedController = (role) => {
  const controller = safeVerification.controllers.find(
    (candidate) => candidate.role === role,
  );
  if (!controller) throw new Error(`verified ${role} Safe is missing`);
  return getAddress(controller.address);
};
const config = {
  initialAdminDelay: positiveInteger(
    "REGISTRY_ADMIN_DELAY_SECONDS",
    (1n << 48n) - 1n,
  ),
  initialAdmin: getAddress(required("REGISTRY_ADMIN")),
  initialApprover: verifiedController("approver"),
  initialRegistrar: verifiedController("registrar"),
  initialFinalizer: verifiedController("finalizer"),
  initialRevoker: verifiedController("revoker"),
  minimumFinalityBlocks: positiveInteger(
    "REGISTRY_MINIMUM_FINALITY_BLOCKS",
    255n,
  ),
  registryPolicyCommitment: bytes32("REGISTRY_POLICY_COMMITMENT"),
};
const productionPolicy = await loadCustomRegistryV2ProductionPolicy(root);
assertCustomRegistryV2ProductionConstructor(config, productionPolicy);
const constructorCommitment = computeConstructorCommitment(config);
assertDistinctControllerOwners({
  deployer,
  admin: config.initialAdmin,
  releaseOwner,
  owners: safeVerification.controllers.map(({ owner }) => owner),
});
if (
  new Set(
    [
      config.initialAdmin,
      config.initialApprover,
      config.initialRegistrar,
      config.initialFinalizer,
      config.initialRevoker,
    ].map((value) => value.toLowerCase()),
  ).size !== 5
)
  throw new Error("admin and verified operational roles must be distinct");

const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: http(url) }),
);
const deploymentData = encodeDeployData({
  abi: committedAbiDocument.abi,
  bytecode: artifact.bytecode.object,
  args: [config],
});
const observations = await Promise.all(
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
    if (chainId !== 1)
      throw new Error("preflight endpoint is not Ethereum mainnet");
    const predictedAddress = getContractAddress({
      from: deployer,
      nonce: BigInt(nonce),
    });
    const [predictedCode, estimatedGas] = await Promise.all([
      client.getCode({ address: predictedAddress, blockTag: "latest" }),
      client.estimateGas({ account: deployer, data: deploymentData }),
    ]);
    if (predictedCode !== undefined && predictedCode !== "0x")
      throw new Error("predicted deployment address has code");
    return {
      chainId,
      finalizedBlockNumber: finalized.number,
      finalizedBlockHash: finalized.hash,
      pendingNonce: nonce,
      predictedAddress,
      estimatedGas,
      blockGasLimit: latest.gasLimit,
      baseFeePerGas: latest.baseFeePerGas,
      maxPriorityFeePerGas: priorityFee,
      deployerBalance: balance,
    };
  }),
);

const [a, b] = observations;
if (
  a.finalizedBlockNumber !== b.finalizedBlockNumber ||
  a.finalizedBlockHash !== b.finalizedBlockHash ||
  a.pendingNonce !== b.pendingNonce ||
  a.predictedAddress !== b.predictedAddress ||
  a.blockGasLimit !== b.blockGasLimit ||
  a.baseFeePerGas !== b.baseFeePerGas ||
  a.maxPriorityFeePerGas !== b.maxPriorityFeePerGas ||
  a.deployerBalance !== b.deployerBalance
) {
  throw new Error("independent preflight observations disagree");
}
if (!Number.isSafeInteger(Number(a.pendingNonce)))
  throw new Error("deployer nonce exceeds JSON safe integer range");
const gasLimit =
  (observations.reduce(
    (maximum, observation) =>
      observation.estimatedGas > maximum ? observation.estimatedGas : maximum,
    0n,
  ) *
    120n) /
  100n;
const observedFeePerGas = (a.baseFeePerGas ?? 0n) * 2n + a.maxPriorityFeePerGas;
const maximumCostWei = assessDeploymentCost({
  gasLimit,
  blockGasLimit: a.blockGasLimit,
  observedFeePerGas,
  maxFeePerGas,
  maxTotalCostWei,
  deployerBalance: a.deployerBalance,
});
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const status = execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
});
if (status !== "")
  throw new Error("deployment preflight requires a clean worktree");

const plan = {
  schemaVersion: "programmable.custom-registry-deployment-preflight.v2",
  status: "PREFLIGHT_ONLY_NO_TRANSACTION",
  source: {
    commit: sourceCommit,
    tree: sourceTree,
    sourceManifestSha256: `0x${createHash("sha256").update(manifestBytes).digest("hex")}`,
    creationBytecodeKeccak256: keccak256(artifact.bytecode.object),
  },
  chainId: 1,
  commonFinalizedAnchor: {
    blockNumber: a.finalizedBlockNumber.toString(),
    blockHash: a.finalizedBlockHash,
  },
  expiresAtTimestamp: Math.floor(Date.now() / 1000) + Number(validitySeconds),
  create: {
    kind: "CREATE",
    deployer,
    exactPendingNonce: Number(a.pendingNonce),
    predictedAddress: a.predictedAddress,
    gasEstimates: observations.map((observation) =>
      observation.estimatedGas.toString(),
    ),
    gasLimit: gasLimit.toString(),
    blockGasLimit: a.blockGasLimit.toString(),
    observedFeePerGas: observedFeePerGas.toString(),
    reviewedMaxFeePerGas: maxFeePerGas.toString(),
    reviewedMaxTotalCostWei: maxTotalCostWei.toString(),
    maximumCostWei: maximumCostWei.toString(),
    deployerBalanceWei: a.deployerBalance.toString(),
  },
  constructor: config,
  constructorCommitment,
  productionPolicy: {
    document: path.relative(root, productionPolicy.documentPath),
    registryPolicyCommitment: productionPolicy.registryPolicyCommitment,
  },
  safeControllers: {
    verificationSha256: safeVerificationSha256,
    policySha256: safePolicySha256,
    custodyProofSha256: safeVerification.custodyProofSha256,
    finalizedAnchor: safeVerification.finalizedAnchor,
    controllers: safeVerification.controllers.map(
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
    maximumValiditySeconds:
      manifest.releaseAuthorization.maximumValiditySeconds,
  },
  broadcastAllowed: false,
  signingAllowed: false,
};

await writeFile(
  output,
  `${JSON.stringify(plan, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
  {
    flag: "wx",
    mode: 0o600,
  },
);
process.stdout.write(`CUSTOM_REGISTRY_V2_DEPLOYMENT_PREFLIGHT ${output}\n`);
