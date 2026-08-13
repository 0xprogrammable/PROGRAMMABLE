import assert from "node:assert/strict";
import test from "node:test";

import { getAddress, keccak256 } from "viem";

import {
  assertRegistryLivePreflight,
} from "../custom-registry-v2-live-verification.mjs";

const address = (suffix) =>
  getAddress(`0x${suffix.toString(16).padStart(40, "0")}`);
const deployer = address(1);
const predictedAddress = address(2);
const singleton = address(3);
const owners = [address(10), address(11), address(12), address(13)];
const controllers = [address(20), address(21), address(22), address(23)];
const runtime = "0x60006000";
const safeRuntime = "0x6001";
const anchorHash = `0x${"11".repeat(32)}`;
const finalizedHash = `0x${"22".repeat(32)}`;

const fixture = () => ({
  providerIds: ["provider-a", "provider-b"],
  plan: {
    rpcProviders: ["provider-a", "provider-b"],
    commonFinalizedAnchor: { blockNumber: "100", blockHash: anchorHash },
    create: {
      deployer,
      exactPendingNonce: 7,
      predictedAddress,
      reviewedMaxTotalCostWei: "300",
    },
    expectedTransaction: {
      gasLimit: "100",
      maxFeePerGas: "3",
      maxPriorityFeePerGas: "1",
    },
    expectedRuntime: {
      codeKeccak256: keccak256(runtime),
      codeLength: 4,
    },
  },
  planInputs: {
    deploymentData: "0x1234",
    safeVerification: {
      finalizedAnchor: { blockNumber: "90", blockHash: `0x${"33".repeat(32)}` },
      proxyFactory: { proxyRuntimeCodeKeccak256: keccak256(safeRuntime) },
      singleton: { address: singleton },
      controllers: controllers.map((controllerAddress, index) => ({
        role: ["approver", "registrar", "finalizer", "revoker"][index],
        address: controllerAddress,
        owner: owners[index],
      })),
    },
    safePolicyBytes: Buffer.from(JSON.stringify({
      safeVersion: "1.4.1",
      storageSlots: { fallbackHandler: "0x01", guard: "0x02" },
    })),
  },
});

const client = ({ nonce = 7, simulatedRuntime = runtime, threshold = 1n } = {}) => ({
  async getBlock(parameters) {
    if (parameters.blockTag === "finalized") {
      return { number: 110n, hash: finalizedHash };
    }
    if (parameters.blockTag === "latest") {
      return { gasLimit: 1_000n, baseFeePerGas: 1n };
    }
    if (parameters.blockNumber === 100n) {
      return { number: 100n, hash: anchorHash };
    }
    if (parameters.blockNumber === 110n) {
      return { number: 110n, hash: finalizedHash };
    }
    throw new Error("unexpected block read");
  },
  async getTransactionCount({ address: target }) {
    return getAddress(target) === deployer ? nonce : 0;
  },
  async getBalance({ address: target }) {
    return getAddress(target) === deployer ? 300n : 0n;
  },
  async estimateMaxPriorityFeePerGas() {
    return 1n;
  },
  async getCode({ address: target }) {
    return controllers.includes(getAddress(target)) ? safeRuntime : "0x";
  },
  async call() {
    return { data: simulatedRuntime };
  },
  async estimateGas() {
    return 80n;
  },
  async readContract({ functionName, address: target }) {
    const controllerIndex = controllers.indexOf(getAddress(target));
    assert.notEqual(controllerIndex, -1);
    if (functionName === "VERSION") return "1.4.1";
    if (functionName === "masterCopy") return singleton;
    if (functionName === "getOwners") return [owners[controllerIndex]];
    if (functionName === "getThreshold") return threshold;
    if (functionName === "getModulesPaginated") return [[], address(1)];
    if (functionName === "getStorageAt") return `0x${"00".repeat(32)}`;
    throw new Error("unexpected Safe read");
  },
});

test("recomputes live nonce, runtime, gas, economics and every Safe controller before signing", async () => {
  const values = fixture();
  await assertRegistryLivePreflight({
    ...values,
    clients: [client(), client()],
  });
  await assert.rejects(
    () =>
      assertRegistryLivePreflight({
        ...values,
        clients: [client(), client({ nonce: 8 })],
      }),
    /live broadcast state/,
  );
  await assert.rejects(
    () =>
      assertRegistryLivePreflight({
        ...values,
        clients: [client(), client({ simulatedRuntime: "0x6002" })],
      }),
    /simulation/,
  );
  await assert.rejects(
    () =>
      assertRegistryLivePreflight({
        ...values,
        clients: [client(), client({ threshold: 2n })],
      }),
    /Safe controller post-deployment state/,
  );
});
