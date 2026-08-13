import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, getAddress, http, keccak256 } from "viem";
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
import {
  appendDurableJsonLine,
  assertExactSerializedEip1559Transaction,
  assertSignedAttemptWindow,
  loadDurableJsonLines,
  trustedNetworkTime,
} from "./custom-registry-v2-transaction-journal.mjs";

const broadcast = process.argv.includes("--broadcast");
const recover = process.argv.includes("--recover");
const rebroadcast = process.argv.includes("--rebroadcast");
if (!broadcast) throw new Error("explicit --broadcast is required");
if (rebroadcast && !recover) {
  throw new Error(
    "Safe rebroadcast requires --recover --rebroadcast --broadcast",
  );
}
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
  throw new Error("--output is required");
}
const journalPath = path.resolve(process.argv[outputIndex + 1]);
if (!journalPath.startsWith("/tmp/")) {
  throw new Error("Safe receipt journal must be under /tmp");
}
const sha256 = (bytes) =>
  `0x${createHash("sha256").update(bytes).digest("hex")}`;
const readReviewed = async (envPath, envDigest, label) => {
  const filePath = path.resolve(process.env[envPath] ?? "");
  if (!filePath.startsWith("/tmp/")) {
    throw new Error(`${label} must be under /tmp`);
  }
  const bytes = await readFile(filePath);
  const digest = sha256(bytes);
  if (digest !== process.env[envDigest]) {
    throw new Error(`${label} digest mismatch`);
  }
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
let nowTimestamp = trustedNetworkTime().adjustedTimestamp;
assertSafePreflightEnvelope(plan, nowTimestamp, { allowExpired: recover });
assertSafeReviewedAuthorization({
  authorization,
  preflightSha256: reviewed.digest,
  plan,
  nowTimestamp,
  allowExpired: recover,
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
) {
  throw new Error("Safe broadcast source identity drifted");
}
const policyBytes = await readFile(
  path.join(root, "config/custom-registry-v2-safe-controller-policy.json"),
);
if (sha256(policyBytes) !== plan.policySha256) {
  throw new Error("Safe controller policy drifted");
}
const policy = JSON.parse(policyBytes);
const manifestBytes = await readFile(
  path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"),
);
assertSafePolicyBoundPlan({
  plan,
  policy,
  manifest: JSON.parse(manifestBytes),
  sourceManifestSha256: sha256(manifestBytes),
});

const rpcA = process.env.REGISTRY_PREFLIGHT_RPC_URL_A;
const rpcB = process.env.REGISTRY_PREFLIGHT_RPC_URL_B;
if (!rpcA || !rpcB) throw new Error("two RPC endpoints are required");
requireDistinctRpcOrigins(rpcA, rpcB);
const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: http(url) }),
);
const appendJournal = (entry, create = false) =>
  appendDurableJsonLine(journalPath, entry, { create });

const validateSignedControllers = async (controllers) => {
  if (
    controllers?.length !== plan.controllers.length ||
    new Set(controllers.map(({ role }) => role)).size !==
      plan.controllers.length ||
    new Set(controllers.map(({ transactionHash }) => transactionHash)).size !==
      plan.controllers.length
  ) {
    throw new Error("Safe signed transaction set is incomplete or duplicated");
  }
  for (const expectedController of plan.controllers) {
    const signed = controllers.find(
      ({ role }) => role === expectedController.role,
    );
    if (
      !signed ||
      getAddress(signed.address) !==
        getAddress(expectedController.predictedAddress) ||
      signed.expectedTransactionNonce !==
        expectedController.expectedTransactionNonce
    ) {
      throw new Error(`${expectedController.role} signed evidence is invalid`);
    }
    await assertExactSerializedEip1559Transaction({
      serializedTransaction: signed.serializedTransaction,
      transactionHash: signed.transactionHash,
      expected: expectedController.expectedTransaction,
    });
  }
};

if (recover) {
  const records = await loadDurableJsonLines(journalPath);
  const [header, signedSet] = records;
  const signedSets = records.filter(
    ({ event }) => event === "SIGNED_SET_NOT_CONFIRMED",
  );
  const firstAttemptSets = records.filter(
    ({ event }) => event === "FIRST_BROADCAST_ATTEMPT_SET",
  );
  if (
    header?.schemaVersion !== SAFE_RECEIPTS_SCHEMA ||
    header.event !== "JOURNAL_OPEN" ||
    header.preflightSha256 !== reviewed.digest ||
    header.authorizationSha256 !== authorized.digest ||
    signedSet?.event !== "SIGNED_SET_NOT_CONFIRMED" ||
    signedSets.length !== 1 ||
    firstAttemptSets.length !== 1 ||
    records.indexOf(firstAttemptSets[0]) !== 2
  ) {
    throw new Error("Safe recovery journal is invalid");
  }
  await validateSignedControllers(signedSet.controllers);
  const firstAttempt = firstAttemptSets[0];
  assertSignedAttemptWindow({
    authorization,
    signedAt: signedSet.signedAtTimestamp,
    firstAttemptAt: firstAttempt.firstAttemptAtTimestamp,
  });
  if (
    JSON.stringify(firstAttempt.transactionHashes) !==
    JSON.stringify(
      signedSet.controllers.map(({ transactionHash }) => transactionHash),
    )
  ) {
    throw new Error("Safe first-attempt set differs from signed set");
  }
  const discovered = await Promise.all(
    signedSet.controllers.map(async (signed) => {
      const providers = await Promise.all(
        clients.map(async (client) => {
          try {
            const transaction = await client.getTransaction({
              hash: signed.transactionHash,
            });
            return {
              found: true,
              blockNumber: transaction.blockNumber?.toString() ?? null,
            };
          } catch {
            return { found: false, blockNumber: null };
          }
        }),
      );
      return { role: signed.role, providers };
    }),
  );
  const missing = signedSet.controllers.filter((signed) => {
    const observation = discovered.find(({ role }) => role === signed.role);
    return !observation.providers.some(({ found }) => found);
  });
  await appendJournal({
    event: "RECOVERY_DISCOVERY",
    observedAtTimestamp: nowTimestamp,
    controllers: discovered,
  });
  if (missing.length === 0) {
    process.stdout.write("CUSTOM_REGISTRY_V2_SAFE_RECOVERY_FOUND_ALL\n");
    process.exit(0);
  }
  if (!rebroadcast) {
    process.stdout.write(
      `CUSTOM_REGISTRY_V2_SAFE_RECOVERY_MISSING ${missing.map(({ role }) => role).join(",")}\n`,
    );
    process.exit(2);
  }
  const responses = await Promise.all(
    missing.map(async (signed) => ({
      role: signed.role,
      results: await Promise.allSettled(
        clients.map((client) =>
          client.sendRawTransaction({
            serializedTransaction: signed.serializedTransaction,
          }),
        ),
      ),
    })),
  );
  await appendJournal({
    event: "RECOVERY_EXACT_REBROADCAST",
    observedAtTimestamp: trustedNetworkTime().adjustedTimestamp,
    controllers: responses.map(({ role, results }) => ({
      role,
      results: results.map((result, index) => ({
        provider: index,
        status: result.status,
        ...(result.status === "fulfilled"
          ? { transactionHash: result.value }
          : { errorName: result.reason?.name ?? "Error" }),
      })),
    })),
  });
  for (const { role, results } of responses) {
    const expectedHash = missing.find(
      (entry) => entry.role === role,
    ).transactionHash;
    if (
      !results.some(
        (result) =>
          result.status === "fulfilled" && result.value === expectedHash,
      )
    ) {
      throw new Error(`${role} exact recovery transaction was not accepted`);
    }
  }
  process.stdout.write("CUSTOM_REGISTRY_V2_SAFE_RECOVERY_REBROADCAST\n");
  process.exit(0);
}

const deployerCustody = plan.custody.roles.find(
  ({ role }) => role === "deployer",
);
if (
  deployerCustody?.service !==
    "programmable.custom-registry.v2.production-custody.20260813.deployer" ||
  getAddress(deployerCustody?.publicAddress) !== getAddress(plan.deployer)
) {
  throw new Error("reviewed Safe deployer Keychain custody is invalid");
}
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
if (!/^0x[0-9a-fA-F]{64}$/u.test(privateKey)) {
  throw new Error("Safe deployer Keychain custody item is invalid");
}
const account = privateKeyToAccount(privateKey);
if (getAddress(account.address) !== getAddress(plan.deployer)) {
  throw new Error("Safe deployer key mismatch");
}

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
        const [code, targetNonce, targetBalance] = await Promise.all([
          client.getCode({ address: predictedAddress, blockTag: "latest" }),
          client.getTransactionCount({
            address: predictedAddress,
            blockTag: "latest",
          }),
          client.getBalance({ address: predictedAddress, blockTag: "latest" }),
        ]);
        return { code, nonce: targetNonce, balance: targetBalance };
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
const [commonA, commonB, anchorA, anchorB] = await Promise.all([
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
  commonA.hash !== commonB.hash ||
  anchorA.hash !== plan.commonFinalizedAnchor.blockHash ||
  anchorB.hash !== plan.commonFinalizedAnchor.blockHash ||
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
  [...a.controllerState, ...b.controllerState].some(
    ({ code, nonce, balance }) =>
      (code && code !== "0x") || nonce !== 0 || balance !== 0n,
  )
) {
  throw new Error("live Safe broadcast state drifted from reviewed plan");
}
const observedFeePerGas = live.reduce((maximum, observation) => {
  const observed =
    (observation.latest.baseFeePerGas ?? 0n) * 2n + observation.priorityFee;
  return observed > maximum ? observed : maximum;
}, 0n);
const maxFeePerGas = BigInt(plan.reviewedMaxFeePerGas);
const maxPriorityFeePerGas = BigInt(
  plan.controllers[0].expectedTransaction.maxPriorityFeePerGas,
);
if (
  observedFeePerGas > maxFeePerGas ||
  a.balance < BigInt(plan.maximumTotalCostWei) ||
  maxPriorityFeePerGas > maxFeePerGas ||
  live.some((observation) =>
    plan.controllers.some(
      (controller) =>
        BigInt(controller.gasLimit) >= observation.latest.gasLimit,
    ),
  )
) {
  throw new Error("live Safe broadcast economics exceed the reviewed plan");
}

const signingTime = trustedNetworkTime();
assertSignedAttemptWindow({
  authorization,
  signedAt: signingTime.adjustedTimestamp,
  firstAttemptAt: signingTime.adjustedTimestamp,
});
const signedControllers = [];
for (const controller of plan.controllers) {
  const expectedInput = safeTransactionInput({
    singleton: plan.singleton.address,
    initializer: controller.initializer,
    saltNonce: controller.saltNonce,
  });
  if (controller.expectedTransaction.input !== expectedInput) {
    throw new Error(`${controller.role} reviewed Safe transaction is invalid`);
  }
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
  signedControllers.push({
    role: controller.role,
    address: controller.predictedAddress,
    transactionHash,
    serializedTransaction,
    expectedTransactionNonce: controller.expectedTransactionNonce,
  });
}
await validateSignedControllers(signedControllers);
await appendJournal(
  {
    schemaVersion: SAFE_RECEIPTS_SCHEMA,
    event: "JOURNAL_OPEN",
    chainId: 1,
    preflightSha256: reviewed.digest,
    authorizationSha256: authorized.digest,
    source: plan.source,
    policySha256: plan.policySha256,
    custodyProofSha256: plan.custodyProofSha256,
    authorizationSemantics: authorization.authorizationSemantics,
    openedAtTimestamp: signingTime.adjustedTimestamp,
  },
  true,
);
await appendJournal({
  event: "SIGNED_SET_NOT_CONFIRMED",
  signedAtTimestamp: signingTime.adjustedTimestamp,
  trustedTime: signingTime,
  controllers: signedControllers,
});
const firstAttemptTime = trustedNetworkTime();
assertSignedAttemptWindow({
  authorization,
  signedAt: signingTime.adjustedTimestamp,
  firstAttemptAt: firstAttemptTime.adjustedTimestamp,
});
await appendJournal({
  event: "FIRST_BROADCAST_ATTEMPT_SET",
  firstAttemptAtTimestamp: firstAttemptTime.adjustedTimestamp,
  trustedTime: firstAttemptTime,
  transactionHashes: signedControllers.map(
    ({ transactionHash }) => transactionHash,
  ),
});
const responses = await Promise.all(
  signedControllers.map(async (signed) => ({
    role: signed.role,
    results: await Promise.allSettled(
      clients.map((client) =>
        client.sendRawTransaction({
          serializedTransaction: signed.serializedTransaction,
        }),
      ),
    ),
  })),
);
await appendJournal({
  event: "BROADCAST_PROVIDER_RESPONSES",
  observedAtTimestamp: trustedNetworkTime().adjustedTimestamp,
  controllers: responses.map(({ role, results }) => ({
    role,
    results: results.map((result, index) => ({
      provider: index,
      status: result.status,
      ...(result.status === "fulfilled"
        ? { transactionHash: result.value }
        : { errorName: result.reason?.name ?? "Error" }),
    })),
  })),
});
for (const { role, results } of responses) {
  const expectedHash = signedControllers.find(
    (entry) => entry.role === role,
  ).transactionHash;
  if (
    !results.some(
      (result) =>
        result.status === "fulfilled" && result.value === expectedHash,
    )
  ) {
    throw new Error(`${role} exact Safe transaction was not accepted`);
  }
}
const receipts = await Promise.all(
  signedControllers.map(async (signed) => {
    const receipt = await Promise.any(
      clients.map((client) =>
        client.waitForTransactionReceipt({
          hash: signed.transactionHash,
          confirmations: 1,
        }),
      ),
    );
    if (receipt.status !== "success" || receipt.contractAddress !== null) {
      throw new Error(`${signed.role} Safe factory transaction failed`);
    }
    return {
      role: signed.role,
      transactionHash: signed.transactionHash,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
    };
  }),
);
await appendJournal({
  event: "RECEIPTS_SEEN_AWAITING_FINALIZED_VERIFICATION",
  observedAtTimestamp: trustedNetworkTime().adjustedTimestamp,
  controllers: receipts,
});
await appendJournal({
  event: "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
  observedAtTimestamp: trustedNetworkTime().adjustedTimestamp,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SAFE_CONTROLLER_RECEIPTS ${journalPath}\n`,
);
