import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAddress, http, keccak256 } from "viem";
import { mainnet } from "viem/chains";
import {
  SAFE_FACTORY_ABI,
  SAFE_READ_ABI,
  assertDistinctControllerOwners,
  predictSafeProxyAddress,
  safeInitializer,
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

const maxFeePerGas = positive(
  "REGISTRY_SAFE_MAX_FEE_PER_GAS_WEI",
  (1n << 256n) - 1n,
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
if (
  policy.schemaVersion !==
    "programmable.custom-registry-v2-safe-controller-policy.v1" ||
  policy.chainId !== "1" ||
  policy.safeVersion !== "1.4.1" ||
  policy.setup?.threshold !== 1 ||
  policy.setup?.to !== "0x0000000000000000000000000000000000000000" ||
  policy.setup?.data !== "0x" ||
  policy.setup?.fallbackHandler !==
    "0x0000000000000000000000000000000000000000" ||
  policy.setup?.modules?.length !== 0 ||
  policy.setup?.guard !== "0x0000000000000000000000000000000000000000"
)
  throw new Error("Safe controller policy is invalid");
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
        policy.proxyFactory.proxyCreationCodeKeccak256
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
    const observations = await Promise.all(
      clients.map(async (client) => {
        const [code, gas] = await Promise.all([
          client.getCode({ address: predictedAddress, blockTag: "latest" }),
          client.estimateContractGas({
            address: policy.proxyFactory.address,
            abi: SAFE_FACTORY_ABI,
            functionName: "createProxyWithNonce",
            args: [policy.singleton.address, initializer, BigInt(saltNonce)],
            account: deployer,
          }),
        ]);
        if (code !== undefined && code !== "0x")
          throw new Error(`predicted ${role} Safe is occupied`);
        return { gas };
      }),
    );
    return {
      role,
      owner,
      saltNonce,
      initializer,
      initializerKeccak256: keccak256(initializer),
      predictedAddress,
      expectedTransactionNonce: a.nonce + index,
      gasEstimates: observations.map(({ gas }) => gas.toString()),
      gasLimit: (
        (observations.reduce((max, { gas }) => (gas > max ? gas : max), 0n) *
          120n) /
        100n
      ).toString(),
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

const plan = {
  schemaVersion: "programmable.custom-registry-v2-safe-controller-preflight.v1",
  status: costReviewOnly
    ? "UNFUNDED_COST_REVIEW_ONLY"
    : "PREFLIGHT_ONLY_NO_TRANSACTION",
  chainId: 1,
  source: { commit: sourceCommit, tree: sourceTree },
  policySha256: `0x${createHash("sha256").update(policyBytes).digest("hex")}`,
  safeVersion: policy.safeVersion,
  singleton: policy.singleton,
  proxyFactory: policy.proxyFactory,
  storageSlots: policy.storageSlots,
  commonFinalizedAnchor: {
    blockNumber: a.finalized.number.toString(),
    blockHash: a.finalized.hash,
  },
  deployer,
  exactPendingNonce: a.nonce,
  deployerBalanceWei: a.balance.toString(),
  controllers: controllerPlans,
  totalGasLimit: totalGasLimit.toString(),
  observedFeePerGas: observedFeePerGas.toString(),
  reviewedMaxFeePerGas: maxFeePerGas.toString(),
  reviewedMaxTotalCostWei: maxTotalCostWei.toString(),
  maximumTotalCostWei: maximumTotalCostWei.toString(),
  fundingSufficient,
  expiresAtTimestamp: Math.floor(Date.now() / 1000) + Number(validitySeconds),
  signingAllowed: false,
  broadcastAllowed: false,
};
await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SAFE_CONTROLLER_PREFLIGHT ${output}\n`,
);
