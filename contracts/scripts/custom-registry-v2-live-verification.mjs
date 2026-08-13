import { getAddress, hexToBigInt, keccak256 } from "viem";

import {
  SAFE_READ_ABI,
  assertSafeRuntimeState,
} from "./custom-registry-v2-safe-controller-guards.mjs";
import {
  assertFinalizedAnchor,
  assertLiveBinding,
  assertPredictedAddressUnoccupied,
  assessDeploymentCost,
} from "./custom-registry-v2-deployment-guards.mjs";

export async function commonFinalizedBlock(clients) {
  if (clients.length !== 2)
    throw new Error("exactly two RPC clients are required");
  const heads = await Promise.all(
    clients.map((client) => client.getBlock({ blockTag: "finalized" })),
  );
  const number =
    heads[0].number < heads[1].number ? heads[0].number : heads[1].number;
  const blocks = await Promise.all(
    clients.map((client) => client.getBlock({ blockNumber: number })),
  );
  if (blocks[0].hash !== blocks[1].hash) {
    throw new Error("independent RPCs disagree on the common finalized block");
  }
  return { number, hash: blocks[0].hash, blocks, heads };
}

async function readSafeAtBlock({ client, address, blockNumber, storageSlots }) {
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
    client.getCode({ address, blockNumber }),
    client.readContract({
      address,
      abi: SAFE_READ_ABI,
      functionName: "VERSION",
      blockNumber,
    }),
    client.readContract({
      address,
      abi: SAFE_READ_ABI,
      functionName: "masterCopy",
      blockNumber,
    }),
    client.readContract({
      address,
      abi: SAFE_READ_ABI,
      functionName: "getOwners",
      blockNumber,
    }),
    client.readContract({
      address,
      abi: SAFE_READ_ABI,
      functionName: "getThreshold",
      blockNumber,
    }),
    client.readContract({
      address,
      abi: SAFE_READ_ABI,
      functionName: "getModulesPaginated",
      args: ["0x0000000000000000000000000000000000000001", 10n],
      blockNumber,
    }),
    client.readContract({
      address,
      abi: SAFE_READ_ABI,
      functionName: "getStorageAt",
      args: [hexToBigInt(storageSlots.fallbackHandler), 1n],
      blockNumber,
    }),
    client.readContract({
      address,
      abi: SAFE_READ_ABI,
      functionName: "getStorageAt",
      args: [hexToBigInt(storageSlots.guard), 1n],
      blockNumber,
    }),
  ]);
  const [modules, nextModule] = modulesPage;
  return {
    code: code ?? "0x",
    version,
    masterCopy,
    owners,
    threshold,
    modules,
    nextModule,
    fallbackStorage,
    guardStorage,
  };
}

export async function assertSafeControllersAtBlock({
  clients,
  blockNumber,
  safeVerification,
  safePolicy,
}) {
  if (
    blockNumber < BigInt(safeVerification.finalizedAnchor.blockNumber) ||
    safePolicy?.storageSlots === undefined
  ) {
    throw new Error("Safe controller finality or storage policy is invalid");
  }
  const result = [];
  for (const controller of safeVerification.controllers) {
    const observations = await Promise.all(
      clients.map((client) =>
        readSafeAtBlock({
          client,
          address: getAddress(controller.address),
          blockNumber,
          storageSlots: safePolicy.storageSlots,
        }),
      ),
    );
    for (const observation of observations) {
      if (
        observation.code === "0x" ||
        keccak256(observation.code) !==
          safeVerification.proxyFactory.proxyRuntimeCodeKeccak256
      ) {
        throw new Error(`${controller.role} Safe runtime is invalid`);
      }
      assertSafeRuntimeState({
        actual: observation,
        expected: {
          version: safePolicy.safeVersion,
          singleton: safeVerification.singleton.address,
          owner: controller.owner,
        },
      });
    }
    const comparable = (value) => ({
      runtime: keccak256(value.code),
      version: value.version,
      masterCopy: getAddress(value.masterCopy),
      owners: value.owners.map(getAddress),
      threshold: value.threshold.toString(),
      modules: value.modules.map(getAddress),
      nextModule: getAddress(value.nextModule),
      fallbackStorage: value.fallbackStorage,
      guardStorage: value.guardStorage,
    });
    if (
      JSON.stringify(comparable(observations[0])) !==
      JSON.stringify(comparable(observations[1]))
    ) {
      throw new Error(`independent ${controller.role} Safe state disagrees`);
    }
    result.push({
      role: controller.role,
      address: getAddress(controller.address),
      owner: getAddress(controller.owner),
      runtimeCodeKeccak256: keccak256(observations[0].code),
      masterCopy: getAddress(observations[0].masterCopy),
      threshold: observations[0].threshold.toString(),
      modules: [],
      fallbackHandler: "0x0000000000000000000000000000000000000000",
      guard: "0x0000000000000000000000000000000000000000",
    });
  }
  return result;
}

export async function assertRegistryLivePreflight({
  clients,
  providerIds,
  plan,
  planInputs,
}) {
  if (
    JSON.stringify(providerIds) !== JSON.stringify(plan.rpcProviders) ||
    new Set(providerIds.map((value) => value.toLowerCase())).size !== 2
  ) {
    throw new Error("RPC provider identity drifted from reviewed plan");
  }
  const reviewedAnchors = await Promise.all(
    clients.map((client) =>
      client.getBlock({
        blockNumber: BigInt(plan.commonFinalizedAnchor.blockNumber),
      }),
    ),
  );
  assertFinalizedAnchor({
    anchor: plan.commonFinalizedAnchor,
    observations: reviewedAnchors,
  });
  const finalized = await commonFinalizedBlock(clients);
  const live = await Promise.all(
    clients.map(async (client) => {
      const [
        latest,
        nonce,
        balance,
        priorityFee,
        predictedCode,
        predictedNonce,
        predictedBalance,
        simulated,
        estimatedGas,
      ] = await Promise.all([
        client.getBlock({ blockTag: "latest" }),
        client.getTransactionCount({
          address: plan.create.deployer,
          blockTag: "pending",
        }),
        client.getBalance({
          address: plan.create.deployer,
          blockTag: "latest",
        }),
        client.estimateMaxPriorityFeePerGas(),
        client.getCode({
          address: plan.create.predictedAddress,
          blockTag: "latest",
        }),
        client.getTransactionCount({
          address: plan.create.predictedAddress,
          blockTag: "latest",
        }),
        client.getBalance({
          address: plan.create.predictedAddress,
          blockTag: "latest",
        }),
        client.call({
          account: plan.create.deployer,
          data: planInputs.deploymentData,
          blockNumber: finalized.number,
        }),
        client.estimateGas({
          account: plan.create.deployer,
          data: planInputs.deploymentData,
        }),
      ]);
      return {
        finalized: { number: finalized.number, hash: finalized.hash },
        latest,
        nonce,
        balance,
        priorityFee,
        predictedCode: predictedCode ?? "0x",
        predictedNonce,
        predictedBalance,
        simulatedRuntime: simulated.data,
        estimatedGas,
      };
    }),
  );
  assertLiveBinding({ first: live[0], second: live[1], plan });
  assertPredictedAddressUnoccupied(
    {
      code: live[0].predictedCode,
      nonce: live[0].predictedNonce,
      balance: live[0].predictedBalance,
    },
    {
      code: live[1].predictedCode,
      nonce: live[1].predictedNonce,
      balance: live[1].predictedBalance,
    },
  );
  if (
    live.some(
      ({ simulatedRuntime, estimatedGas }) =>
        !simulatedRuntime ||
        keccak256(simulatedRuntime) !== plan.expectedRuntime.codeKeccak256 ||
        (simulatedRuntime.length - 2) / 2 !== plan.expectedRuntime.codeLength ||
        estimatedGas > BigInt(plan.expectedTransaction.gasLimit),
    )
  ) {
    throw new Error("exact deployment simulation or gas estimate drifted");
  }
  const minimumBlockGasLimit = live.reduce(
    (minimum, { latest }) =>
      latest.gasLimit < minimum ? latest.gasLimit : minimum,
    live[0].latest.gasLimit,
  );
  const maximumObservedFeePerGas = live.reduce((maximum, observation) => {
    const observed =
      (observation.latest.baseFeePerGas ?? 0n) * 2n + observation.priorityFee;
    return observed > maximum ? observed : maximum;
  }, 0n);
  assessDeploymentCost({
    gasLimit: BigInt(plan.expectedTransaction.gasLimit),
    blockGasLimit: minimumBlockGasLimit,
    observedFeePerGas: maximumObservedFeePerGas,
    maxFeePerGas: BigInt(plan.expectedTransaction.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(plan.expectedTransaction.maxPriorityFeePerGas),
    maxTotalCostWei: BigInt(plan.create.reviewedMaxTotalCostWei),
    deployerBalance: live[0].balance,
  });
  const safeControllers = await assertSafeControllersAtBlock({
    clients,
    blockNumber: finalized.number,
    safeVerification: planInputs.safeVerification,
    safePolicy: JSON.parse(planInputs.safePolicyBytes),
  });
  return { finalized, live, safeControllers };
}
