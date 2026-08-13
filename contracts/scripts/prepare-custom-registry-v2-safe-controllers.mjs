import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAddress, http, keccak256 } from "viem";
import { mainnet } from "viem/chains";
import {
  SAFE_FACTORY_ABI,
  SAFE_PLAN_SCHEMA,
  SAFE_READ_ABI,
  assertSafeCostReviewEnvelope,
  assertSafeCustodyProof,
  assertSafePolicyBoundPlan,
  assertSafePreflightEnvelope,
  assertDistinctControllerOwners,
  predictSafeProxyAddress,
  safeInitializer,
  safeTransactionInput,
} from "./custom-registry-v2-safe-controller-guards.mjs";
import {
  assessDeploymentCost,
  requireDistinctRpcOrigins,
} from "./custom-registry-v2-deployment-guards.mjs";

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
const costReviewOnly = process.argv.includes("--cost-review");
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const positive = (name, maximum) => {
  const value = BigInt(required(name));
  if (value <= 0n || value > maximum)
    throw new Error(`${name} is out of range`);
  return value;
};

const rpcA = required("REGISTRY_PREFLIGHT_RPC_URL_A");
const rpcB = required("REGISTRY_PREFLIGHT_RPC_URL_B");
requireDistinctRpcOrigins(rpcA, rpcB);
const deployer = getAddress(required("REGISTRY_SAFE_DEPLOYER"));
const admin = getAddress(required("REGISTRY_ADMIN"));
const releaseOwner = getAddress(required("REGISTRY_RELEASE_OWNER"));
const roles = ["approver", "registrar", "finalizer", "revoker"];
const owners = roles.map((role) =>
  getAddress(required(`REGISTRY_${role.toUpperCase()}_SAFE_OWNER`)),
);
assertDistinctControllerOwners({ deployer, admin, releaseOwner, owners });

const custodyProofPath = path.resolve(required("REGISTRY_CUSTODY_PROOF_PATH"));
if (!custodyProofPath.startsWith("/tmp/"))
  throw new Error("custody proof must be under /tmp");
const custodyProofBytes = await readFile(custodyProofPath);
const custodyProofSha256 = `0x${createHash("sha256")
  .update(custodyProofBytes)
  .digest("hex")}`;
if (custodyProofSha256 !== required("REGISTRY_CUSTODY_PROOF_SHA256"))
  throw new Error("custody proof digest mismatch");
const custodyProof = JSON.parse(custodyProofBytes);
assertSafeCustodyProof({ proof: custodyProof, owners, deployer, admin });

const maxFeePerGas = positive(
  "REGISTRY_SAFE_MAX_FEE_PER_GAS_WEI",
  (1n << 256n) - 1n,
);
const maxPriorityFeePerGas = positive(
  "REGISTRY_SAFE_MAX_PRIORITY_FEE_PER_GAS_WEI",
  maxFeePerGas,
);
const maxTotalCostWei = positive(
  "REGISTRY_SAFE_MAX_TOTAL_COST_WEI",
  (1n << 256n) - 1n,
);
const validitySeconds = positive(
  "REGISTRY_SAFE_PREFLIGHT_VALIDITY_SECONDS",
  900n,
);
const policyBytes = await readFile(
  path.join(root, "config/custom-registry-v2-safe-controller-policy.json"),
);
const policy = JSON.parse(policyBytes);
const policySha256 = `0x${createHash("sha256").update(policyBytes).digest("hex")}`;
if (
  policy.schemaVersion !==
    "programmable.custom-registry-v2-safe-controller-policy.v1" ||
  policy.chainId !== "1" ||
  policy.safeVersion !== "1.4.1" ||
  policy.source?.repository !== "safe-fndn/safe-smart-account" ||
  policy.source?.tag !== "v1.4.1" ||
  policy.source?.commit !== "bf943f80fec5ac647159d26161446ac5d716a294" ||
  policy.deploymentInventory?.repository !== "safe-global/safe-deployments" ||
  policy.deploymentInventory?.commit !==
    "5bb0ebd7150a777f39bec4733e4d799c4b637b49" ||
  policy.deploymentInventory?.tree !==
    "9c48b5f3bd56e47239a15c8da9d2e2c4d9f87679" ||
  policy.singleton?.address !== "0x41675C099F32341bf84BFc5382aF534df5C7461a" ||
  policy.proxyFactory?.address !==
    "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67" ||
  keccak256(policy.proxyFactory?.proxyCreationCode) !==
    policy.proxyFactory?.proxyCreationCodeKeccak256 ||
  policy.proxyFactory?.proxyRuntimeCodeKeccak256 !==
    "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c" ||
  policy.proxyFactory?.proxyCreationEvent !==
    "ProxyCreation(address,address)" ||
  policy.setup?.threshold !== 1 ||
  policy.setup?.to !== "0x0000000000000000000000000000000000000000" ||
  policy.setup?.data !== "0x" ||
  policy.setup?.fallbackHandler !==
    "0x0000000000000000000000000000000000000000" ||
  policy.setup?.modules?.length !== 0 ||
  policy.setup?.guard !== "0x0000000000000000000000000000000000000000"
)
  throw new Error("Safe controller policy is invalid");
const manifestBytes = await readFile(
  path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"),
);
const manifest = JSON.parse(manifestBytes);
if (
  manifest.status !== "SOURCE_ONLY_NOT_DEPLOYED" ||
  manifest.activationAllowed !== false ||
  manifest.sourceDigests?.[
    "config/custom-registry-v2-safe-controller-policy.json"
  ] !== policySha256 ||
  getAddress(manifest.releaseAuthorization?.owner) !== releaseOwner ||
  manifest.releaseAuthorization?.maximumValiditySeconds !== 300
)
  throw new Error("Safe policy or release owner is not source-manifest bound");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }) !== ""
) {
  throw new Error("Safe controller preflight requires a clean worktree");
}

const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: http(url) }),
);
const baseObservations = await Promise.all(
  clients.map(async (client) => {
    const [
      chainId,
      finalized,
      latest,
      nonce,
      balance,
      priorityFee,
      singletonCode,
      singletonVersion,
      factoryCode,
      proxyCreationCode,
    ] = await Promise.all([
      client.getChainId(),
      client.getBlock({ blockTag: "finalized" }),
      client.getBlock({ blockTag: "latest" }),
      client.getTransactionCount({ address: deployer, blockTag: "pending" }),
      client.getBalance({ address: deployer, blockTag: "latest" }),
      client.estimateMaxPriorityFeePerGas(),
      client.getCode({ address: policy.singleton.address, blockTag: "latest" }),
      client.readContract({
        address: policy.singleton.address,
        abi: SAFE_READ_ABI,
        functionName: "VERSION",
      }),
      client.getCode({
        address: policy.proxyFactory.address,
        blockTag: "latest",
      }),
      client.readContract({
        address: policy.proxyFactory.address,
        abi: SAFE_FACTORY_ABI,
        functionName: "proxyCreationCode",
      }),
    ]);
    if (
      chainId !== 1 ||
      keccak256(singletonCode) !== policy.singleton.runtimeCodeKeccak256 ||
      singletonVersion !== policy.safeVersion ||
      keccak256(factoryCode) !== policy.proxyFactory.runtimeCodeKeccak256 ||
      keccak256(proxyCreationCode) !==
        policy.proxyFactory.proxyCreationCodeKeccak256 ||
      proxyCreationCode !== policy.proxyFactory.proxyCreationCode
    )
      throw new Error("Safe singleton or factory runtime binding failed");
    return {
      finalized,
      latest,
      nonce,
      balance,
      priorityFee,
      proxyCreationCode,
      singletonVersion,
    };
  }),
);
const [a, b] = baseObservations;
if (
  a.finalized.number !== b.finalized.number ||
  a.finalized.hash !== b.finalized.hash ||
  a.nonce !== b.nonce ||
  a.balance !== b.balance ||
  a.proxyCreationCode !== b.proxyCreationCode
)
  throw new Error("independent Safe preflight observations disagree");

const controllerPlans = await Promise.all(
  roles.map(async (role, index) => {
    const owner = owners[index];
    const initializer = safeInitializer(owner, policy.setup);
    const saltNonce = policy.roles[role].saltNonce;
    const predictedAddress = predictSafeProxyAddress({
      factory: policy.proxyFactory.address,
      singleton: policy.singleton.address,
      proxyCreationCode: a.proxyCreationCode,
      initializer,
      saltNonce,
    });
    const transactionInput = safeTransactionInput({
      singleton: policy.singleton.address,
      initializer,
      saltNonce,
    });
    const observations = await Promise.all(
      clients.map(async (client) => {
        const [code, nonce, balance, gas] = await Promise.all([
          client.getCode({ address: predictedAddress, blockTag: "latest" }),
          client.getTransactionCount({
            address: predictedAddress,
            blockTag: "latest",
          }),
          client.getBalance({
            address: predictedAddress,
            blockTag: "latest",
          }),
          client.estimateContractGas({
            address: policy.proxyFactory.address,
            abi: SAFE_FACTORY_ABI,
            functionName: "createProxyWithNonce",
            args: [policy.singleton.address, initializer, BigInt(saltNonce)],
            account: deployer,
          }),
        ]);
        if (
          (code !== undefined && code !== "0x") ||
          nonce !== 0 ||
          balance !== 0n
        )
          throw new Error(`predicted ${role} Safe is occupied or prefunded`);
        return { gas, nonce, balance };
      }),
    );
    const gasLimit =
      (observations.reduce((max, { gas }) => (gas > max ? gas : max), 0n) *
        120n) /
      100n;
    return {
      role,
      owner,
      saltNonce,
      initializer,
      initializerKeccak256: keccak256(initializer),
      predictedAddress,
      expectedTransactionNonce: a.nonce + index,
      expectedTransaction: {
        chainId: 1,
        from: deployer,
        to: policy.proxyFactory.address,
        input: transactionInput,
        valueWei: "0",
        nonce: a.nonce + index,
        gasLimit: gasLimit.toString(),
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      },
      gasEstimates: observations.map(({ gas }) => gas.toString()),
      predictedAddressNonces: observations.map(({ nonce }) => nonce),
      predictedAddressBalancesWei: observations.map(({ balance }) =>
        balance.toString(),
      ),
      gasLimit: gasLimit.toString(),
    };
  }),
);
if (
  new Set(
    controllerPlans.map(({ predictedAddress }) =>
      predictedAddress.toLowerCase(),
    ),
  ).size !== roles.length
) {
  throw new Error("predicted Safe controller addresses are not distinct");
}
const totalGasLimit = controllerPlans.reduce(
  (sum, controller) => sum + BigInt(controller.gasLimit),
  0n,
);
const observedFeePerGas = baseObservations.reduce((max, observation) => {
  const observed =
    (observation.latest.baseFeePerGas ?? 0n) * 2n + observation.priorityFee;
  return observed > max ? observed : max;
}, 0n);
const minimumBlockGasLimit = baseObservations.reduce(
  (minimum, observation) =>
    observation.latest.gasLimit < minimum
      ? observation.latest.gasLimit
      : minimum,
  a.latest.gasLimit,
);
const maximumSingleGasLimit = controllerPlans.reduce(
  (max, controller) =>
    BigInt(controller.gasLimit) > max ? BigInt(controller.gasLimit) : max,
  0n,
);
assessDeploymentCost({
  gasLimit: maximumSingleGasLimit,
  blockGasLimit: minimumBlockGasLimit,
  observedFeePerGas,
  maxFeePerGas,
  maxTotalCostWei,
  deployerBalance: costReviewOnly ? maxTotalCostWei : a.balance,
});
const maximumTotalCostWei = totalGasLimit * maxFeePerGas;
if (maximumTotalCostWei > maxTotalCostWei)
  throw new Error("Safe controller aggregate cost ceiling is insufficient");
const fundingSufficient = a.balance >= maximumTotalCostWei;
if (!costReviewOnly && !fundingSufficient)
  throw new Error("Safe controller deployer balance is insufficient");

const createdAtTimestamp = Math.floor(Date.now() / 1000);
const plan = {
  schemaVersion: SAFE_PLAN_SCHEMA,
  status: costReviewOnly
    ? "UNFUNDED_COST_REVIEW_ONLY"
    : "PREFLIGHT_ONLY_NO_TRANSACTION",
  chainId: 1,
  source: { commit: sourceCommit, tree: sourceTree },
  sourceManifestSha256: `0x${createHash("sha256")
    .update(manifestBytes)
    .digest("hex")}`,
  policySha256,
  custodyProofSha256,
  custody: {
    inventorySha256: custodyProof.inventorySha256,
    roles: custodyProof.roles.map(
      ({ role, publicAddress, service, readbackSha256 }) => ({
        role,
        publicAddress,
        service,
        readbackSha256,
      }),
    ),
  },
  safeVersion: policy.safeVersion,
  singleton: policy.singleton,
  proxyFactory: {
    ...policy.proxyFactory,
  },
  storageSlots: policy.storageSlots,
  commonFinalizedAnchor: {
    blockNumber: a.finalized.number.toString(),
    blockHash: a.finalized.hash,
  },
  deployer,
  admin,
  releaseAuthorization: {
    owner: releaseOwner,
    maximumValiditySeconds:
      manifest.releaseAuthorization.maximumValiditySeconds,
  },
  exactPendingNonce: a.nonce,
  deployerBalanceWei: a.balance.toString(),
  controllers: controllerPlans,
  totalGasLimit: totalGasLimit.toString(),
  observedFeePerGas: observedFeePerGas.toString(),
  reviewedMaxFeePerGas: maxFeePerGas.toString(),
  reviewedMaxTotalCostWei: maxTotalCostWei.toString(),
  maximumTotalCostWei: maximumTotalCostWei.toString(),
  fundingSufficient,
  createdAtTimestamp,
  validitySeconds: Number(validitySeconds),
  expiresAtTimestamp: createdAtTimestamp + Number(validitySeconds),
  signingAllowed: false,
  broadcastAllowed: false,
};
assertSafePolicyBoundPlan({
  plan,
  policy,
  manifest,
  sourceManifestSha256: plan.sourceManifestSha256,
});
if (costReviewOnly) assertSafeCostReviewEnvelope(plan);
else assertSafePreflightEnvelope(plan, createdAtTimestamp);
await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SAFE_CONTROLLER_PREFLIGHT ${output}\n`,
);
