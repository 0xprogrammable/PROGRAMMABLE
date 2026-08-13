import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  getAddress,
  hexToBigInt,
  http,
  keccak256,
} from "viem";
import { mainnet } from "viem/chains";
import {
  SAFE_READ_ABI,
  assertSafeRuntimeState,
} from "./custom-registry-v2-safe-controller-guards.mjs";
import { requireDistinctRpcOrigins } from "./custom-registry-v2-deployment-guards.mjs";

const planPath = path.resolve(
  process.env.REGISTRY_SAFE_REVIEWED_PLAN_PATH ?? "",
);
const receiptsPath = path.resolve(
  process.env.REGISTRY_SAFE_DEPLOYMENT_RECEIPTS_PATH ?? "",
);
if (!planPath.startsWith("/tmp/") || !receiptsPath.startsWith("/tmp/")) {
  throw new Error("reviewed plan and receipts must be under /tmp");
}
const plan = JSON.parse(await readFile(planPath));
const receipts = JSON.parse(await readFile(receiptsPath));
if (
  plan.schemaVersion !==
    "programmable.custom-registry-v2-safe-controller-preflight.v1" ||
  receipts.schemaVersion !==
    "programmable.custom-registry-v2-safe-controller-receipts.v1" ||
  receipts.controllers?.length !== 4
)
  throw new Error("Safe controller deployment evidence is invalid");
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
) {
  throw new Error("independent finalized anchors disagree");
}
for (const controller of plan.controllers) {
  const receiptEvidence = receipts.controllers.find(
    ({ role }) => role === controller.role,
  );
  if (
    !receiptEvidence ||
    getAddress(receiptEvidence.address) !==
      getAddress(controller.predictedAddress)
  ) {
    throw new Error(`missing receipt evidence for ${controller.role}`);
  }
  const observations = await Promise.all(
    clients.map(async (client) => {
      const receipt = await client.getTransactionReceipt({
        hash: receiptEvidence.transactionHash,
      });
      if (receipt.status !== "success" || receipt.contractAddress !== null) {
        throw new Error(`invalid factory receipt for ${controller.role}`);
      }
      if (receipt.blockNumber > finalized[0].number) {
        throw new Error(`${controller.role} Safe receipt is not finalized`);
      }
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
          blockTag: "latest",
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "VERSION",
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "masterCopy",
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getOwners",
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getThreshold",
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getModulesPaginated",
          args: ["0x0000000000000000000000000000000000000001", 10n],
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getStorageAt",
          args: [hexToBigInt(plan.storageSlots.fallbackHandler), 1n],
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getStorageAt",
          args: [hexToBigInt(plan.storageSlots.guard), 1n],
        }),
      ]);
      if (!code || code === "0x")
        throw new Error(`${controller.role} Safe has no runtime code`);
      const [modules, nextModule] = modulesPage;
      const actual = {
        version,
        masterCopy,
        owners,
        threshold,
        modules,
        nextModule,
        fallbackStorage,
        guardStorage,
      };
      assertSafeRuntimeState({
        actual,
        expected: {
          version: plan.safeVersion,
          singleton: plan.singleton.address,
          owner: controller.owner,
        },
      });
      return {
        runtimeCodeKeccak256: keccak256(code),
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
      };
    }),
  );
  if (
    observations[0].runtimeCodeKeccak256 !==
      observations[1].runtimeCodeKeccak256 ||
    observations[0].blockNumber !== observations[1].blockNumber ||
    observations[0].blockHash !== observations[1].blockHash
  )
    throw new Error(
      `independent ${controller.role} Safe observations disagree`,
    );
}
process.stdout.write("CUSTOM_REGISTRY_V2_SAFE_CONTROLLERS_VERIFIED\n");
