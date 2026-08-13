import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

import {
  SAFE_FACTORY_ABI,
  SAFE_RECEIPTS_SCHEMA,
  SAFE_READ_ABI,
  assertSafePolicyBoundPlan,
  assertSafePreflightEnvelope,
  assertSafeReviewedAuthorization,
  safeTransactionInput,
  verifySafeReviewedAuthorizationSignature,
} from "./custom-registry-v2-safe-controller-guards.mjs";
import { requireDistinctRpcOrigins } from "./custom-registry-v2-deployment-guards.mjs";

if (!process.argv.includes("--broadcast"))
  throw new Error("explicit --broadcast is required");
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1])
  throw new Error("--output is required");
const outputPath = path.resolve(process.argv[outputIndex + 1]);
if (!outputPath.startsWith("/tmp/"))
  throw new Error("Safe receipt output must be under /tmp");

const readReviewed = async (envPath, envDigest, label) => {
  const filePath = path.resolve(process.env[envPath] ?? "");
  if (!filePath.startsWith("/tmp/"))
    throw new Error(`${label} must be under /tmp`);
  const bytes = await readFile(filePath);
  const digest = `0x${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== process.env[envDigest])
    throw new Error(`${label} digest mismatch`);
  return { bytes, digest, value: JSON.parse(bytes) };
};
const reviewed = await readReviewed(
  "REGISTRY_SAFE_REVIEWED_PLAN_PATH",
  "REGISTRY_SAFE_REVIEWED_PLAN_SHA256",
  "reviewed Safe plan",
);
const authorized = await readReviewed(
  "REGISTRY_SAFE_BROADCAST_AUTHORIZATION_PATH",
  "REGISTRY_SAFE_BROADCAST_AUTHORIZATION_SHA256",
  "Safe broadcast authorization",
);
const plan = reviewed.value;
const authorization = authorized.value;
const nowTimestamp = Math.floor(Date.now() / 1000);
assertSafePreflightEnvelope(plan, nowTimestamp);
assertSafeReviewedAuthorization({
  authorization,
  preflightSha256: reviewed.digest,
  plan,
  nowTimestamp,
});
await verifySafeReviewedAuthorizationSignature(authorization);

const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (
  commit !== plan.source.commit ||
  tree !== plan.source.tree ||
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }) !== ""
)
  throw new Error("Safe broadcast source identity drifted");

const policyBytes = await readFile(
  path.join(root, "config/custom-registry-v2-safe-controller-policy.json"),
);
if (
  `0x${createHash("sha256").update(policyBytes).digest("hex")}` !==
  plan.policySha256
)
  throw new Error("Safe controller policy drifted");
const policy = JSON.parse(policyBytes);
const manifestBytes = await readFile(
  path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"),
);
assertSafePolicyBoundPlan({
  plan,
  policy,
  manifest: JSON.parse(manifestBytes),
  sourceManifestSha256: `0x${createHash("sha256")
    .update(manifestBytes)
    .digest("hex")}`,
});

const deployerCustody = plan.custody.roles.find(
  ({ role }) => role === "deployer",
);
if (
  deployerCustody?.service !==
    "programmable.custom-registry.v2.production-custody.20260813.deployer" ||
  getAddress(deployerCustody?.publicAddress) !== getAddress(plan.deployer)
)
  throw new Error("reviewed Safe deployer Keychain custody is invalid");
const privateKey = execFileSync(
  "security",
  [
    "find-generic-password",
    "-w",
    "-s",
    deployerCustody.service,
    "-a",
    getAddress(plan.deployer),
  ],
  { encoding: "utf8", maxBuffer: 4096 },
).trim();
if (!/^0x[0-9a-fA-F]{64}$/u.test(privateKey))
  throw new Error("Safe deployer Keychain custody item is invalid");
const account = privateKeyToAccount(privateKey);
if (getAddress(account.address) !== getAddress(plan.deployer))
  throw new Error("Safe deployer key mismatch");

const rpcA = process.env.REGISTRY_PREFLIGHT_RPC_URL_A;
const rpcB = process.env.REGISTRY_PREFLIGHT_RPC_URL_B;
if (!rpcA || !rpcB) throw new Error("two RPC endpoints are required");
requireDistinctRpcOrigins(rpcA, rpcB);
const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: http(url) }),
);
const live = await Promise.all(
  clients.map(async (client) => {
    const [
      finalized,
      latest,
      nonce,
      balance,
      priorityFee,
      singletonCode,
      version,
      factoryCode,
      proxyCreationCode,
    ] = await Promise.all([
      client.getBlock({ blockTag: "finalized" }),
      client.getBlock({ blockTag: "latest" }),
      client.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      }),
      client.getBalance({ address: account.address, blockTag: "latest" }),
      client.estimateMaxPriorityFeePerGas(),
      client.getCode({ address: plan.singleton.address, blockTag: "latest" }),
      client.readContract({
        address: plan.singleton.address,
        abi: SAFE_READ_ABI,
        functionName: "VERSION",
      }),
      client.getCode({
        address: plan.proxyFactory.address,
        blockTag: "latest",
      }),
      client.readContract({
        address: plan.proxyFactory.address,
        abi: SAFE_FACTORY_ABI,
        functionName: "proxyCreationCode",
      }),
    ]);
    const controllerState = await Promise.all(
      plan.controllers.map(async ({ predictedAddress }) => {
        const [code, nonce, balance] = await Promise.all([
          client.getCode({ address: predictedAddress, blockTag: "latest" }),
          client.getTransactionCount({
            address: predictedAddress,
            blockTag: "latest",
          }),
          client.getBalance({
            address: predictedAddress,
            blockTag: "latest",
          }),
        ]);
        return { code, nonce, balance };
      }),
    );
    return {
      finalized,
      latest,
      nonce,
      balance,
      priorityFee,
      singletonCode,
      version,
      factoryCode,
      proxyCreationCode,
      controllerState,
    };
  }),
);
const [a, b] = live;
const commonFinalizedNumber =
  a.finalized.number < b.finalized.number
    ? a.finalized.number
    : b.finalized.number;
const [commonFinalizedA, commonFinalizedB, reviewedAnchorA, reviewedAnchorB] =
  await Promise.all([
    clients[0].getBlock({ blockNumber: commonFinalizedNumber }),
    clients[1].getBlock({ blockNumber: commonFinalizedNumber }),
    clients[0].getBlock({
      blockNumber: BigInt(plan.commonFinalizedAnchor.blockNumber),
    }),
    clients[1].getBlock({
      blockNumber: BigInt(plan.commonFinalizedAnchor.blockNumber),
    }),
  ]);
if (
  commonFinalizedNumber < BigInt(plan.commonFinalizedAnchor.blockNumber) ||
  commonFinalizedA.hash !== commonFinalizedB.hash ||
  reviewedAnchorA.hash !== plan.commonFinalizedAnchor.blockHash ||
  reviewedAnchorB.hash !== plan.commonFinalizedAnchor.blockHash ||
  a.nonce !== b.nonce ||
  a.nonce !== plan.exactPendingNonce ||
  a.balance !== b.balance ||
  a.proxyCreationCode !== b.proxyCreationCode ||
  keccak256(a.singletonCode) !== plan.singleton.runtimeCodeKeccak256 ||
  keccak256(b.singletonCode) !== plan.singleton.runtimeCodeKeccak256 ||
  a.version !== plan.safeVersion ||
  b.version !== plan.safeVersion ||
  keccak256(a.factoryCode) !== plan.proxyFactory.runtimeCodeKeccak256 ||
  keccak256(b.factoryCode) !== plan.proxyFactory.runtimeCodeKeccak256 ||
  keccak256(a.proxyCreationCode) !==
    plan.proxyFactory.proxyCreationCodeKeccak256 ||
  a.controllerState.some(
    ({ code, nonce, balance }) =>
      (code && code !== "0x") || nonce !== 0 || balance !== 0n,
  ) ||
  b.controllerState.some(
    ({ code, nonce, balance }) =>
      (code && code !== "0x") || nonce !== 0 || balance !== 0n,
  )
)
  throw new Error("live Safe broadcast state drifted from reviewed plan");

const observedFeePerGas = live.reduce((maximum, observation) => {
  const observed =
    (observation.latest.baseFeePerGas ?? 0n) * 2n + observation.priorityFee;
  return observed > maximum ? observed : maximum;
}, 0n);
const maxFeePerGas = BigInt(plan.reviewedMaxFeePerGas);
if (
  observedFeePerGas > maxFeePerGas ||
  a.balance < BigInt(plan.maximumTotalCostWei) ||
  live.some((observation) =>
    plan.controllers.some(
      (controller) =>
        BigInt(controller.gasLimit) >= observation.latest.gasLimit,
    ),
  )
)
  throw new Error("live Safe broadcast economics exceed the reviewed plan");
const maxPriorityFeePerGas = BigInt(
  plan.controllers[0].expectedTransaction.maxPriorityFeePerGas,
);
if (
  maxPriorityFeePerGas > maxFeePerGas ||
  plan.controllers.some(
    (controller) =>
      controller.expectedTransaction.maxPriorityFeePerGas !==
      maxPriorityFeePerGas.toString(),
  )
)
  throw new Error("reviewed Safe priority fee is invalid");

const evidence = {
  schemaVersion: SAFE_RECEIPTS_SCHEMA,
  status: "BROADCAST_IN_PROGRESS",
  chainId: 1,
  preflightSha256: reviewed.digest,
  authorizationSha256: authorized.digest,
  source: plan.source,
  policySha256: plan.policySha256,
  custodyProofSha256: plan.custodyProofSha256,
  controllers: [],
};
const writeEvidence = async ({ create = false } = {}) => {
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    flag: create ? "wx" : "w",
    mode: 0o600,
  });
  const handle = await open(outputPath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};
await writeEvidence({ create: true });

for (const controller of plan.controllers) {
  const expectedInput = safeTransactionInput({
    singleton: plan.singleton.address,
    initializer: controller.initializer,
    saltNonce: controller.saltNonce,
  });
  if (
    controller.expectedTransaction.chainId !== 1 ||
    getAddress(controller.expectedTransaction.from) !== account.address ||
    getAddress(controller.expectedTransaction.to) !==
      getAddress(plan.proxyFactory.address) ||
    controller.expectedTransaction.input !== expectedInput ||
    controller.expectedTransaction.valueWei !== "0" ||
    controller.expectedTransaction.nonce !==
      controller.expectedTransactionNonce ||
    controller.expectedTransaction.gasLimit !== controller.gasLimit ||
    controller.expectedTransaction.maxFeePerGas !== plan.reviewedMaxFeePerGas ||
    controller.expectedTransaction.maxPriorityFeePerGas !==
      maxPriorityFeePerGas.toString()
  )
    throw new Error(`${controller.role} reviewed Safe transaction is invalid`);
  const immediate = await Promise.all(
    clients.map(async (client) => ({
      nonce: await client.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      }),
      code: await client.getCode({
        address: controller.predictedAddress,
        blockTag: "latest",
      }),
      targetNonce: await client.getTransactionCount({
        address: controller.predictedAddress,
        blockTag: "latest",
      }),
      targetBalance: await client.getBalance({
        address: controller.predictedAddress,
        blockTag: "latest",
      }),
    })),
  );
  if (
    immediate[0].nonce !== immediate[1].nonce ||
    immediate[0].nonce !== controller.expectedTransactionNonce ||
    (immediate[0].code !== undefined && immediate[0].code !== "0x") ||
    (immediate[1].code !== undefined && immediate[1].code !== "0x") ||
    immediate[0].targetNonce !== 0 ||
    immediate[1].targetNonce !== 0 ||
    immediate[0].targetBalance !== 0n ||
    immediate[1].targetBalance !== 0n
  )
    throw new Error(
      `${controller.role} Safe transaction nonce or address drifted`,
    );
  const serializedTransaction = await account.signTransaction({
    chainId: 1,
    type: "eip1559",
    to: plan.proxyFactory.address,
    data: expectedInput,
    value: 0n,
    nonce: controller.expectedTransactionNonce,
    gas: BigInt(controller.gasLimit),
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  const transactionHash = keccak256(serializedTransaction);
  const controllerEvidence = {
    role: controller.role,
    address: controller.predictedAddress,
    transactionHash,
    serializedTransaction,
    expectedTransactionNonce: controller.expectedTransactionNonce,
    transactionStatus: "SIGNED_NOT_CONFIRMED",
    blockNumber: null,
    blockHash: null,
  };
  evidence.controllers.push(controllerEvidence);
  await writeEvidence();
  const broadcastHash = await clients[0].sendRawTransaction({
    serializedTransaction,
  });
  if (broadcastHash !== transactionHash)
    throw new Error(`${controller.role} Safe transaction hash mismatch`);
  const receipt = await clients[0].waitForTransactionReceipt({
    hash: transactionHash,
    confirmations: 1,
  });
  if (receipt.status !== "success" || receipt.contractAddress !== null)
    throw new Error(`${controller.role} Safe factory transaction failed`);
  controllerEvidence.transactionStatus = "RECEIPT_CONFIRMED_SUCCESS";
  controllerEvidence.blockNumber = receipt.blockNumber.toString();
  controllerEvidence.blockHash = receipt.blockHash;
  await writeEvidence();
}
evidence.status = "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION";
await writeEvidence();
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SAFE_CONTROLLER_RECEIPTS ${outputPath}\n`,
);
