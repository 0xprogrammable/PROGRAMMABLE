import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  getAddress,
  hexToBigInt,
  http,
  keccak256,
} from "viem";
import { mainnet } from "viem/chains";

import {
  SAFE_FACTORY_ABI,
  SAFE_READ_ABI,
  SAFE_RECEIPTS_SCHEMA,
  SAFE_VERIFICATION_SCHEMA,
  assertProxyCreationLog,
  assertSafePreflightEnvelope,
  assertSafePolicyBoundPlan,
  assertSafeReviewedAuthorization,
  assertSafeRuntimeState,
  safeTransactionInput,
  verifySafeReviewedAuthorizationSignature,
} from "./custom-registry-v2-safe-controller-guards.mjs";
import { requireDistinctRpcOrigins } from "./custom-registry-v2-deployment-guards.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1])
  throw new Error("--output is required");
const outputPath = path.resolve(process.argv[outputIndex + 1]);
if (!outputPath.startsWith("/tmp/"))
  throw new Error("Safe verification output must be under /tmp");

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
const receiptEvidence = await readReviewed(
  "REGISTRY_SAFE_DEPLOYMENT_RECEIPTS_PATH",
  "REGISTRY_SAFE_DEPLOYMENT_RECEIPTS_SHA256",
  "Safe deployment receipts",
);
const plan = reviewed.value;
const authorization = authorized.value;
const receipts = receiptEvidence.value;
assertSafePreflightEnvelope(plan, 0, { allowExpired: true });
assertSafeReviewedAuthorization({
  authorization,
  preflightSha256: reviewed.digest,
  plan,
  nowTimestamp: 0,
  allowExpired: true,
});
await verifySafeReviewedAuthorizationSignature(authorization);
if (
  receipts.schemaVersion !== SAFE_RECEIPTS_SCHEMA ||
  receipts.status !== "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION" ||
  receipts.chainId !== 1 ||
  receipts.preflightSha256 !== reviewed.digest ||
  receipts.authorizationSha256 !== authorized.digest ||
  receipts.source?.commit !== plan.source.commit ||
  receipts.source?.tree !== plan.source.tree ||
  receipts.policySha256 !== plan.policySha256 ||
  receipts.custodyProofSha256 !== plan.custodyProofSha256 ||
  receipts.controllers?.length !== 4 ||
  new Set(receipts.controllers.map(({ transactionHash }) => transactionHash))
    .size !== 4
)
  throw new Error("Safe controller deployment evidence is invalid");

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
  throw new Error("Safe verification source identity drifted");
const policyBytes = await readFile(
  path.join(root, "config/custom-registry-v2-safe-controller-policy.json"),
);
if (
  `0x${createHash("sha256").update(policyBytes).digest("hex")}` !==
  plan.policySha256
)
  throw new Error("Safe controller policy drifted");
const manifestBytes = await readFile(
  path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"),
);
assertSafePolicyBoundPlan({
  plan,
  policy: JSON.parse(policyBytes),
  manifest: JSON.parse(manifestBytes),
  sourceManifestSha256: `0x${createHash("sha256")
    .update(manifestBytes)
    .digest("hex")}`,
});

const rpcA = process.env.REGISTRY_PREFLIGHT_RPC_URL_A;
const rpcB = process.env.REGISTRY_PREFLIGHT_RPC_URL_B;
if (!rpcA || !rpcB) throw new Error("two RPC endpoints are required");
requireDistinctRpcOrigins(rpcA, rpcB);
const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: http(url) }),
);
const finalized = await Promise.all(
  clients.map((client) => client.getBlock({ blockTag: "finalized" })),
);
if (
  finalized[0].number !== finalized[1].number ||
  finalized[0].hash !== finalized[1].hash
)
  throw new Error("independent finalized anchors disagree");
const officialBindings = await Promise.all(
  clients.map(async (client) => {
    const [singletonCode, singletonVersion, factoryCode, proxyCreationCode] =
      await Promise.all([
        client.getCode({
          address: plan.singleton.address,
          blockNumber: finalized[0].number,
        }),
        client.readContract({
          address: plan.singleton.address,
          abi: SAFE_READ_ABI,
          functionName: "VERSION",
          blockNumber: finalized[0].number,
        }),
        client.getCode({
          address: plan.proxyFactory.address,
          blockNumber: finalized[0].number,
        }),
        client.readContract({
          address: plan.proxyFactory.address,
          abi: SAFE_FACTORY_ABI,
          functionName: "proxyCreationCode",
          blockNumber: finalized[0].number,
        }),
      ]);
    return {
      singletonCode,
      singletonVersion,
      factoryCode,
      proxyCreationCode,
    };
  }),
);
if (
  officialBindings.some(
    ({ singletonCode, singletonVersion, factoryCode, proxyCreationCode }) =>
      keccak256(singletonCode) !== plan.singleton.runtimeCodeKeccak256 ||
      singletonVersion !== plan.safeVersion ||
      keccak256(factoryCode) !== plan.proxyFactory.runtimeCodeKeccak256 ||
      keccak256(proxyCreationCode) !==
        plan.proxyFactory.proxyCreationCodeKeccak256,
  ) ||
  officialBindings[0].singletonCode !== officialBindings[1].singletonCode ||
  officialBindings[0].factoryCode !== officialBindings[1].factoryCode ||
  officialBindings[0].proxyCreationCode !==
    officialBindings[1].proxyCreationCode
)
  throw new Error("official Safe finalized source/runtime binding failed");

const verifiedControllers = [];
for (const controller of plan.controllers) {
  const evidence = receipts.controllers.find(
    ({ role }) => role === controller.role,
  );
  const expectedInput = safeTransactionInput({
    singleton: plan.singleton.address,
    initializer: controller.initializer,
    saltNonce: controller.saltNonce,
  });
  if (
    !evidence ||
    getAddress(evidence.address) !== getAddress(controller.predictedAddress) ||
    evidence.expectedTransactionNonce !== controller.expectedTransactionNonce ||
    evidence.transactionStatus !== "RECEIPT_CONFIRMED_SUCCESS" ||
    controller.expectedTransaction.chainId !== 1 ||
    getAddress(controller.expectedTransaction.from) !==
      getAddress(plan.deployer) ||
    getAddress(controller.expectedTransaction.to) !==
      getAddress(plan.proxyFactory.address) ||
    controller.expectedTransaction.input !== expectedInput ||
    controller.expectedTransaction.valueWei !== "0" ||
    controller.expectedTransaction.nonce !==
      controller.expectedTransactionNonce ||
    controller.expectedTransaction.gasLimit !== controller.gasLimit ||
    controller.expectedTransaction.maxFeePerGas !== plan.reviewedMaxFeePerGas
  )
    throw new Error(
      `reviewed Safe transaction is invalid for ${controller.role}`,
    );

  const observations = await Promise.all(
    clients.map(async (client) => {
      const [transaction, receipt] = await Promise.all([
        client.getTransaction({ hash: evidence.transactionHash }),
        client.getTransactionReceipt({ hash: evidence.transactionHash }),
      ]);
      if (
        receipt.status !== "success" ||
        receipt.contractAddress !== null ||
        receipt.blockNumber > finalized[0].number ||
        receipt.blockNumber.toString() !== evidence.blockNumber ||
        receipt.blockHash !== evidence.blockHash ||
        transaction.blockNumber !== receipt.blockNumber ||
        transaction.blockHash !== receipt.blockHash ||
        getAddress(transaction.from) !== getAddress(plan.deployer) ||
        transaction.to === null ||
        getAddress(transaction.to) !== getAddress(plan.proxyFactory.address) ||
        transaction.input !== expectedInput ||
        transaction.value !== 0n ||
        transaction.nonce !== controller.expectedTransactionNonce ||
        transaction.chainId !== 1 ||
        transaction.gas !== BigInt(controller.expectedTransaction.gasLimit) ||
        transaction.maxFeePerGas !==
          BigInt(controller.expectedTransaction.maxFeePerGas) ||
        transaction.maxPriorityFeePerGas !==
          BigInt(controller.expectedTransaction.maxPriorityFeePerGas)
      )
        throw new Error(`factory transaction mismatch for ${controller.role}`);
      assertProxyCreationLog({
        logs: receipt.logs,
        factory: plan.proxyFactory.address,
        proxy: controller.predictedAddress,
        singleton: plan.singleton.address,
      });
      const receiptBlock = await client.getBlock({
        blockNumber: receipt.blockNumber,
      });
      if (
        receiptBlock.timestamp > BigInt(plan.expiresAtTimestamp) ||
        receiptBlock.timestamp > BigInt(authorization.expiresAtTimestamp)
      )
        throw new Error(
          `${controller.role} transaction missed authorization window`,
        );

      const [
        code,
        version,
        masterCopy,
        owners,
        threshold,
        modulesPage,
        fallbackStorage,
        guardStorage,
      ] = await Promise.all([
        client.getCode({
          address: controller.predictedAddress,
          blockNumber: finalized[0].number,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "VERSION",
          blockNumber: finalized[0].number,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "masterCopy",
          blockNumber: finalized[0].number,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getOwners",
          blockNumber: finalized[0].number,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getThreshold",
          blockNumber: finalized[0].number,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getModulesPaginated",
          args: ["0x0000000000000000000000000000000000000001", 10n],
          blockNumber: finalized[0].number,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getStorageAt",
          args: [hexToBigInt(plan.storageSlots.fallbackHandler), 1n],
          blockNumber: finalized[0].number,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getStorageAt",
          args: [hexToBigInt(plan.storageSlots.guard), 1n],
          blockNumber: finalized[0].number,
        }),
      ]);
      if (
        !code ||
        code === "0x" ||
        keccak256(code) !== plan.proxyFactory.proxyRuntimeCodeKeccak256
      )
        throw new Error(
          `${controller.role} official SafeProxy runtime mismatch`,
        );
      const [modules, nextModule] = modulesPage;
      assertSafeRuntimeState({
        actual: {
          version,
          masterCopy,
          owners,
          threshold,
          modules,
          nextModule,
          fallbackStorage,
          guardStorage,
        },
        expected: {
          version: plan.safeVersion,
          singleton: plan.singleton.address,
          owner: controller.owner,
        },
      });
      return {
        transactionHash: transaction.hash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        runtimeCodeKeccak256: keccak256(code),
        owner: getAddress(owners[0]),
        threshold,
      };
    }),
  );
  const [a, b] = observations;
  if (
    a.transactionHash !== b.transactionHash ||
    a.blockNumber !== b.blockNumber ||
    a.blockHash !== b.blockHash ||
    a.runtimeCodeKeccak256 !== b.runtimeCodeKeccak256 ||
    a.owner !== b.owner ||
    a.threshold !== b.threshold
  )
    throw new Error(
      `independent ${controller.role} Safe observations disagree`,
    );
  verifiedControllers.push({
    role: controller.role,
    address: controller.predictedAddress,
    owner: controller.owner,
    transactionHash: a.transactionHash,
    blockNumber: a.blockNumber.toString(),
    blockHash: a.blockHash,
    runtimeCodeKeccak256: a.runtimeCodeKeccak256,
    masterCopy: plan.singleton.address,
    threshold: "1",
    modules: [],
    fallbackHandler: "0x0000000000000000000000000000000000000000",
    guard: "0x0000000000000000000000000000000000000000",
  });
}

const verification = {
  schemaVersion: SAFE_VERIFICATION_SCHEMA,
  status: "VERIFIED_FINALIZED_SAFE_CONTROLLERS",
  chainId: 1,
  source: plan.source,
  preflightSha256: reviewed.digest,
  authorizationSha256: authorized.digest,
  receiptsSha256: receiptEvidence.digest,
  policySha256: plan.policySha256,
  custodyProofSha256: plan.custodyProofSha256,
  proxyFactory: plan.proxyFactory,
  singleton: plan.singleton,
  finalizedAnchor: {
    blockNumber: finalized[0].number.toString(),
    blockHash: finalized[0].hash,
  },
  controllers: verifiedControllers,
  verified: true,
};
await writeFile(outputPath, `${JSON.stringify(verification, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SAFE_CONTROLLERS_VERIFIED ${outputPath}\n`,
);
