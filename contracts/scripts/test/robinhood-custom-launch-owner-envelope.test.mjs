import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";

import { prepareOwnerTransactionFromCreationCode } from "../prepare-robinhood-custom-launch-owner-transaction.mjs";
import {
  assertRobinhoodFoundationRpcProviders,
  assertFreshRobinhoodFoundationOwnerEnvelope,
  prepareRobinhoodFoundationOwnerEnvelope,
  reviewedRobinhoodFoundationGasLimit,
  robinhoodFoundationRpcEndpointCommitment,
  robinhoodFoundationRpc,
} from "../robinhood-custom-launch-owner-envelope-core.mjs";
import {
  parseRobinhoodFoundationEnvelopeCli,
  writeProtectedRobinhoodFoundationOwnerEnvelope,
} from "../refresh-robinhood-custom-launch-owner-envelope.mjs";
import { verifyRobinhoodStandardJsonInputs } from "../robinhood-custom-launch-standard-json-core.mjs";
import {
  ROBINHOOD_OWNER_WALLET_REQUEST_SCHEMA,
  assertCanonicalRobinhoodOwnerWalletRequest,
  verifyRobinhoodOwnerWalletRequest,
} from "../verify-robinhood-custom-launch-owner-wallet-request.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const profileBytes = await readFile(
  path.join(
    repositoryRoot,
    "contracts/spec/robinhood-custom-launch/chain-4663.v1.json",
  ),
);
const predeploymentBytes = await readFile(
  path.join(
    repositoryRoot,
    "contracts/deployments/robinhood-custom-launch-v1.predeployment.json",
  ),
);
const profile = JSON.parse(profileBytes);
const deployment = JSON.parse(predeploymentBytes);
const verifiedCompilation = await verifyRobinhoodStandardJsonInputs({
  requireForgeArtifacts: false,
});
const OWNER_0 = "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3";
const OWNER_1 = "0x2Bb333d48DFAF1596D9036671d2E43168994249E";
const PREPARED_ADDRESSES = Object.freeze({
  permitAuthority: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
  graphFactory: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
  router: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
});
const RPC_URLS = Object.freeze([
  "https://hood-explorer-indexer.robinhood-mainnet.quiknode.pro/0123456789abcdef/",
  "https://robinhood-mainnet.g.alchemy.com/v2/abcdef0123456789",
]);
const RPC_COMMITMENTS = Object.freeze([
  robinhoodFoundationRpcEndpointCommitment({
    role: "primary",
    providerId: "quicknode",
    rpcUrl: RPC_URLS[0],
  }),
  robinhoodFoundationRpcEndpointCommitment({
    role: "secondary",
    providerId: "alchemy",
    rpcUrl: RPC_URLS[1],
  }),
]);
const HOSTED_VERIFY = Object.freeze({
  schemaVersion: "programmable.robinhood-custom-launch.hosted-verify-binding.v1",
  repository: "programmablehq/programmable",
  workflow: ".github/workflows/verify.yml",
  sourceCommit: "1".repeat(40),
  sourceTree: "2".repeat(40),
  runId: 123456,
  runAttempt: 1,
  runUrl: "https://github.com/programmablehq/PROGRAMMABLE/actions/runs/123456",
  proofCompletedAt: "2027-01-15T08:00:00.000Z",
  artifactId: 987654,
  artifactName: "production-verify-proof-123456-1",
  artifactDigest: `sha256:${"3".repeat(64)}`,
  verificationMode: "change",
});
const FIXED_TIMESTAMP = 1_800_000_000;
const EXPECTED_SIMULATION = encodeAbiParameters(
  parseAbiParameters("(bool,bytes)[]"),
  [
    [
      [
        true,
        encodeAbiParameters(parseAbiParameters("address"), [
          PREPARED_ADDRESSES.permitAuthority,
        ]),
      ],
      [true, PREPARED_ADDRESSES.graphFactory],
      [true, PREPARED_ADDRESSES.router],
    ],
  ],
);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function prepared(owner = OWNER_0) {
  return prepareOwnerTransactionFromCreationCode(owner, {
    graphCreationCode: verifiedCompilation.commitments.graph.creationCode,
    routerBaseCreationCode:
      verifiedCompilation.commitments.router.baseCreationCode,
  });
}

function walletRequest(receipt) {
  return {
    schemaVersion: ROBINHOOD_OWNER_WALLET_REQUEST_SCHEMA,
    chainId: "0x1237",
    request: {
      method: "eth_sendTransaction",
      params: [
        {
          chainId: receipt.transaction.chainId,
          from: receipt.transaction.from,
          to: receipt.transaction.to,
          value: "0x0",
          data: receipt.transaction.input,
          nonce: receipt.transaction.nonceQuantity,
          gas: receipt.transaction.gasQuantity,
          maxFeePerGas: receipt.transaction.maxFeePerGasQuantity,
          maxPriorityFeePerGas:
            receipt.transaction.maxPriorityFeePerGasQuantity,
          type: receipt.transaction.type,
        },
      ],
    },
  };
}

function dependencyBindings() {
  return {
    safeSingleton: profile.contracts.safeInfrastructure.safeSingleton,
    safeProxyFactory: profile.contracts.safeInfrastructure.safeProxyFactory,
    compatibilityFallbackHandler:
      profile.contracts.safeInfrastructure.compatibilityFallbackHandler,
    multicall3: profile.contracts.deploymentInfrastructure.multicall3,
    deterministicDeployer:
      profile.contracts.deploymentInfrastructure.deterministicDeployer,
    poolManager: profile.contracts.uniswap.poolManager,
  };
}

function mockRpc(options = {}) {
  const methodInventory = [];
  const requestInventory = [];
  const pendingOwnerNonceReads = new Map();
  const pendingBlockReads = new Map();
  const callReads = new Map();
  const estimateReads = new Map();
  const codeByAddress = new Map();
  const hashByCode = new Map();
  Object.entries(dependencyBindings()).forEach(([key, binding], index) => {
    const code = `0x61${(index + 1).toString(16).padStart(4, "0")}`;
    codeByAddress.set(binding.address.toLowerCase(), { key, code });
    hashByCode.set(code, binding.runtimeCodeHash);
  });
  Object.entries(PREPARED_ADDRESSES).forEach(([key, address]) => {
    codeByAddress.set(address.toLowerCase(), { key, code: "0x" });
  });
  const providerOption = (providerId) => options.providers?.[providerId] ?? {};
  const block = (number, hashByte, timestamp = FIXED_TIMESTAMP) => ({
    number: `0x${number.toString(16)}`,
    hash: `0x${hashByte.repeat(32)}`,
    timestamp: `0x${timestamp.toString(16)}`,
    gasLimit: "0x1c9c380",
  });
  const pendingBlock = (providerId) => {
    const count = (pendingBlockReads.get(providerId) ?? 0) + 1;
    pendingBlockReads.set(providerId, count);
    const provider = providerOption(providerId);
    return {
      parentHash:
        count > 1 && provider.closingParentHash
          ? provider.closingParentHash
          : (provider.pendingParentHash ?? `0x${"aa".repeat(32)}`),
      timestamp:
        count > 1 && provider.closingPendingTimestamp
          ? provider.closingPendingTimestamp
          : (provider.pendingTimestamp ?? `0x${FIXED_TIMESTAMP.toString(16)}`),
      gasLimit:
        count > 1 && provider.closingPendingGasLimit
          ? provider.closingPendingGasLimit
          : (provider.pendingGasLimit ?? "0x1c9c380"),
      baseFeePerGas:
        count > 1 && provider.closingBaseFeePerGas
          ? provider.closingBaseFeePerGas
          : (provider.baseFeePerGas ?? "0x3b9aca00"),
    };
  };
  const rpcClient = async ({ providerId, method, params }) => {
    methodInventory.push(method);
    requestInventory.push({ providerId, method, params: structuredClone(params) });
    const provider = providerOption(providerId);
    if (method === "eth_chainId") return provider.chainId ?? "0x1237";
    if (method === "eth_getBlockByNumber") {
      if (params[0] === "latest") {
        return providerId === "quicknode"
          ? block(1_000, "11")
          : block(provider.headNumber ?? 1_002, "22");
      }
      if (params[0] === "pending") return pendingBlock(providerId);
      return block(
        1_000,
        provider.commonHashByte ?? "33",
        provider.commonTimestamp ?? FIXED_TIMESTAMP,
      );
    }
    if (method === "eth_getTransactionCount") {
      const address = params[0].toLowerCase();
      const target = codeByAddress.get(address);
      if (
        target &&
        Object.values(PREPARED_ADDRESSES).some(
          (value) => value.toLowerCase() === address,
        )
      ) {
        return provider.targetNonceKey === target.key ? "0x1" : "0x0";
      }
      if (params[1] === "latest") return provider.latestNonce ?? "0x7";
      const count = (pendingOwnerNonceReads.get(providerId) ?? 0) + 1;
      pendingOwnerNonceReads.set(providerId, count);
      return count > 1 && provider.closingNonce
        ? provider.closingNonce
        : (provider.pendingNonce ?? "0x7");
    }
    if (method === "eth_getCode") {
      const entry = codeByAddress.get(params[0].toLowerCase());
      assert.ok(entry, `unexpected code address ${params[0]}`);
      if (provider.codeDriftKey === entry.key) return "0x6000";
      if (provider.occupiedCodeKey === entry.key) return "0x6001";
      return entry.code;
    }
    if (method === "eth_call") {
      const count = (callReads.get(providerId) ?? 0) + 1;
      callReads.set(providerId, count);
      return count > 1 && provider.closingCallResult !== undefined
        ? provider.closingCallResult
        : (provider.callResult ?? EXPECTED_SIMULATION);
    }
    if (method === "eth_estimateGas") {
      const count = (estimateReads.get(providerId) ?? 0) + 1;
      estimateReads.set(providerId, count);
      return count > 1 && provider.closingEstimate !== undefined
        ? provider.closingEstimate
        : (provider.estimate ?? "0x6d66aa");
    }
    if (method === "eth_gasPrice") return provider.gasPrice ?? "0x77359400";
    if (method === "eth_maxPriorityFeePerGas") {
      return provider.priorityFee ?? "0x0";
    }
    assert.fail(`unexpected RPC method ${method}`);
  };
  return {
    rpcClient,
    runtimeCodeHash: (code) => hashByCode.get(code) ?? keccak256(code),
    methodInventory,
    requestInventory,
  };
}

async function prepareEnvelope({
  owner = OWNER_0,
  options = {},
  ceilings = {},
} = {}) {
  const mock = mockRpc(options);
  const receipt = await prepareRobinhoodFoundationOwnerEnvelope({
    owner,
    prepared: prepared(owner),
    profile,
    deployment,
    chainProfileSha256: sha256(profileBytes),
    predeploymentSha256: sha256(predeploymentBytes),
    source: {
      commit: "1".repeat(40),
      tree: "2".repeat(40),
      clean: true,
    },
    hostedVerify: HOSTED_VERIFY,
    rpcUrls: RPC_URLS,
    rpcEndpointCommitments: RPC_COMMITMENTS,
    maximumFeePerGasWei: ceilings.maximumFeePerGasWei ?? "3000000000",
    maximumPriorityFeePerGasWei:
      ceilings.maximumPriorityFeePerGasWei ?? "1000000000",
    maximumGasCostWei: ceilings.maximumGasCostWei ?? "30000000000000000",
    rpcClient: mock.rpcClient,
    runtimeCodeHash: mock.runtimeCodeHash,
    clock: () => FIXED_TIMESTAMP * 1_000,
  });
  return { receipt, ...mock };
}

test("reviewed gas headroom is exact and fails instead of clamping", () => {
  assert.equal(reviewedRobinhoodFoundationGasLimit(7_169_706n), 8_653_648n);
  assert.throws(
    () => reviewedRobinhoodFoundationGasLimit(9_000_000n),
    /10,000,000 gas cap/u,
  );
  assert.throws(
    () => reviewedRobinhoodFoundationGasLimit(1n << 64n),
    /exceeds uint64/u,
  );
});

test("both reviewed owners produce a protected, digest-bound envelope", async () => {
  for (const owner of [OWNER_0, OWNER_1]) {
    const { receipt, methodInventory } = await prepareEnvelope({ owner });
    assert.equal(receipt.state, "prepared-not-signed-not-broadcast");
    assert.equal(receipt.transaction.from.toLowerCase(), owner.toLowerCase());
    assert.equal(receipt.transaction.to, deployment.atomicOwnerTransaction.to);
    assert.equal(receipt.transaction.valueWei, "0");
    assert.equal(
      receipt.transaction.inputKeccak256,
      deployment.atomicOwnerTransaction.dataHash,
    );
    assert.equal(receipt.transaction.gasLimit, "8653648");
    assert.equal(receipt.observation.ttlSeconds, 300);
    assert.equal(receipt.gasPolicy.balanceReadPerformed, false);
    assert.equal(receipt.gasPolicy.fundingVerified, false);
    assert.equal(receipt.signingAllowed, false);
    assert.equal(receipt.broadcastAllowed, false);
    assert.match(receipt.receiptDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.ok(!methodInventory.includes("eth_getBalance"));
    assert.ok(!methodInventory.some((method) => /send|sign/iu.test(method)));
    const rendered = JSON.stringify(receipt);
    assert.ok(!rendered.includes("0123456789abcdef"));
    assert.ok(!rendered.includes("abcdef0123456789"));
  }
});

test("moving pending heads and provider fee differences use conservative maxima", async () => {
  const openingParents = [
    `0x${"a1".repeat(32)}`,
    `0x${"b2".repeat(32)}`,
  ];
  const closingParents = [
    `0x${"c3".repeat(32)}`,
    `0x${"d4".repeat(32)}`,
  ];
  const { receipt } = await prepareEnvelope({
    ceilings: { maximumFeePerGasWei: "4000000000" },
    options: {
      providers: {
        quicknode: {
          pendingParentHash: openingParents[0],
          pendingTimestamp: `0x${FIXED_TIMESTAMP.toString(16)}`,
          baseFeePerGas: "0x3b9aca00",
          closingParentHash: closingParents[0],
          closingPendingTimestamp: `0x${(FIXED_TIMESTAMP + 2).toString(16)}`,
          closingBaseFeePerGas: "0x4190ab00",
          gasPrice: "0xcaa7e200",
          priorityFee: "0x5f5e100",
        },
        alchemy: {
          pendingParentHash: openingParents[1],
          pendingTimestamp: `0x${(FIXED_TIMESTAMP + 1).toString(16)}`,
          baseFeePerGas: "0x47868c00",
          closingParentHash: closingParents[1],
          closingPendingTimestamp: `0x${(FIXED_TIMESTAMP + 3).toString(16)}`,
          closingBaseFeePerGas: "0x53724e00",
          gasPrice: "0xa0eebb00",
          priorityFee: "0x1dcd6500",
        },
      },
    },
  });

  assert.deepEqual(receipt.observation.openingPendingBlocks, [
    {
      providerId: "quicknode",
      parentHash: openingParents[0],
      blockTimestamp: FIXED_TIMESTAMP.toString(),
      gasLimit: "30000000",
      baseFeePerGas: "1000000000",
    },
    {
      providerId: "alchemy",
      parentHash: openingParents[1],
      blockTimestamp: (FIXED_TIMESTAMP + 1).toString(),
      gasLimit: "30000000",
      baseFeePerGas: "1200000000",
    },
  ]);
  assert.deepEqual(receipt.observation.closingPendingBlocks, [
    {
      providerId: "quicknode",
      parentHash: closingParents[0],
      blockTimestamp: (FIXED_TIMESTAMP + 2).toString(),
      gasLimit: "30000000",
      baseFeePerGas: "1100000000",
    },
    {
      providerId: "alchemy",
      parentHash: closingParents[1],
      blockTimestamp: (FIXED_TIMESTAMP + 3).toString(),
      gasLimit: "30000000",
      baseFeePerGas: "1400000000",
    },
  ]);
  assert.ok(!Object.hasOwn(receipt.observation, "pendingBlock"));
  assert.deepEqual(receipt.simulation.closingGasEstimates, [
    "7169706",
    "7169706",
  ]);
  assert.equal(receipt.gasPolicy.observedPendingBaseFeePerGasWei, "1400000000");
  assert.equal(receipt.gasPolicy.observedGasPriceWei, "3400000000");
  assert.equal(receipt.gasPolicy.observedMaxPriorityFeePerGasWei, "500000000");
  assert.equal(receipt.transaction.maxPriorityFeePerGas, "500000000");
  assert.equal(receipt.transaction.maxFeePerGas, "3400000000");
  assert.equal(receipt.checks.movingPendingHeadsTolerated, true);
  assert.equal(receipt.checks.stateRelevantOpeningAgreement, true);
  assert.equal(receipt.checks.stateRelevantClosingAgreement, true);
  assert.equal(receipt.checks.closingSimulationAgreement, true);
  assert.equal(receipt.checks.closingGasAgreement, true);
  assert.equal(receipt.checks.closingFeeCeilingUsesProviderMaxima, true);
  assert.ok(!Object.hasOwn(receipt.checks, "pendingBlockAgreement"));
  assert.ok(!Object.hasOwn(receipt.checks, "closingFeeAgreement"));
});

test("implementation inventory contains no balance, signing, or broadcast primitive", async () => {
  const [core, refresh] = await Promise.all([
    readFile(
      path.join(
        repositoryRoot,
        "contracts/scripts/robinhood-custom-launch-owner-envelope-core.mjs",
      ),
      "utf8",
    ),
    readFile(
      path.join(
        repositoryRoot,
        "contracts/scripts/refresh-robinhood-custom-launch-owner-envelope.mjs",
      ),
      "utf8",
    ),
  ]);
  const implementation = `${core}\n${refresh}`;
  assert.doesNotMatch(
    implementation,
    /["'](?:eth_getBalance|eth_sendRawTransaction|eth_sendTransaction|eth_sign|eth_signTransaction|personal_sign)["']/u,
  );
  assert.doesNotMatch(
    implementation,
    /createWalletClient|privateKeyToAccount|signTransaction|sendRawTransaction/u,
  );
  const actionTimeStart = core.indexOf(
    "export async function verifyRobinhoodFoundationOwnerWalletActionTimeState",
  );
  const actionTimeEnd = core.indexOf("\nfunction exactSource", actionTimeStart);
  assert.ok(actionTimeStart >= 0 && actionTimeEnd > actionTimeStart);
  const actionTimeImplementation = core.slice(actionTimeStart, actionTimeEnd);
  assert.deepEqual(
    [
      ...new Set(
        [...actionTimeImplementation.matchAll(/"(eth_[A-Za-z0-9]+)"/gu)].map(
          ([, method]) => method,
        ),
      ),
    ].sort(),
    [
      "eth_call",
      "eth_chainId",
      "eth_estimateGas",
      "eth_getTransactionCount",
    ],
  );
  assert.match(actionTimeImplementation, /readCodes\(/u);
  assert.doesNotMatch(
    actionTimeImplementation,
    /eth_getBalance|eth_send|eth_sign|wallet_|personal_|signTransaction|requestPermissions/iu,
  );
  assert.match(core, /ALLOWED_OWNERS\.includes/u);
  assert.doesNotMatch(
    core,
    /ALLOWED_OWNERS(?:\[[^\]]+\]|\.(?:at|find|findIndex|pop|shift)\()/u,
  );
});

test("provider pins accept the exact Robinhood QuickNode host and reject cross-network or unsafe endpoints", () => {
  assert.deepEqual(
    assertRobinhoodFoundationRpcProviders({
      rpcUrls: [
        "https://hood-explorer-indexer-alt.robinhood-mainnet.quiknode.pro/credential_0123456789/",
        RPC_URLS[1],
      ],
      endpointCommitments: [
        robinhoodFoundationRpcEndpointCommitment({
          role: "primary",
          providerId: "quicknode",
          rpcUrl:
            "https://hood-explorer-indexer-alt.robinhood-mainnet.quiknode.pro/credential_0123456789/",
        }),
        RPC_COMMITMENTS[1],
      ],
    }),
    [
      {
        role: "primary",
        providerId: "quicknode",
        trustDomain: "quicknode.com",
        authentication: "provider-credential",
        endpointCommitment: robinhoodFoundationRpcEndpointCommitment({
          role: "primary",
          providerId: "quicknode",
          rpcUrl:
            "https://hood-explorer-indexer-alt.robinhood-mainnet.quiknode.pro/credential_0123456789/",
        }),
      },
      {
        role: "secondary",
        providerId: "alchemy",
        trustDomain: "alchemy.com",
        authentication: "provider-credential",
        endpointCommitment: RPC_COMMITMENTS[1],
      },
    ],
  );
  const invalid = [
    ["https://rpc.mainnet.chain.robinhood.com", RPC_URLS[1]],
    ["https://lb.drpc.live/robinhood/0123456789abcdef", RPC_URLS[1]],
    [
      "http://hood-explorer-indexer.robinhood-mainnet.quiknode.pro/0123456789abcdef/",
      RPC_URLS[1],
    ],
    [
      "https://user:secret@hood-explorer-indexer.robinhood-mainnet.quiknode.pro/0123456789abcdef/",
      RPC_URLS[1],
    ],
    [
      "https://hood-explorer-indexer.robinhood-mainnet.quiknode.pro/",
      RPC_URLS[1],
    ],
    [
      "https://docs-demo.robinhood-mainnet.quiknode.pro/0123456789abcdef/",
      RPC_URLS[1],
    ],
    [
      "https://hood-explorer-indexer.robinhood-mainnet.quiknode.pro/short/",
      RPC_URLS[1],
    ],
    [
      "https://hood-explorer-indexer.robinhood-mainnet.quiknode.pro/0123456789abcdef",
      RPC_URLS[1],
    ],
    [
      "https://hood-explorer-indexer.robinhood-mainnet.quiknode.pro:443/0123456789abcdef/",
      RPC_URLS[1],
    ],
    [
      "https://hood-explorer-indexer.robinhood-mainnet.quiknode.pro/0123456789abcdef/extra/",
      RPC_URLS[1],
    ],
    [
      "https://hood-explorer-indexer.quiknode.pro/0123456789abcdef/",
      RPC_URLS[1],
    ],
    [
      "https://hood-explorer-indexer.ethereum-mainnet.quiknode.pro/0123456789abcdef/",
      RPC_URLS[1],
    ],
    [
      "https://hood-explorer-indexer-.robinhood-mainnet.quiknode.pro/0123456789abcdef/",
      RPC_URLS[1],
    ],
    [`${RPC_URLS[0]}?extra=1`, RPC_URLS[1]],
    [
      RPC_URLS[0],
      "https://robinhood-mainnet.g.alchemy.com/v1/abcdef0123456789",
    ],
    [RPC_URLS[0], "https://robinhood-mainnet.g.alchemy.com/v2/DOCS_DEMO"],
    [RPC_URLS[0], `${RPC_URLS[1]}#fragment`],
  ];
  for (const rpcUrls of invalid) {
    assert.throws(() =>
      assertRobinhoodFoundationRpcProviders({
        rpcUrls,
        endpointCommitments: RPC_COMMITMENTS,
      }),
    );
  }
  assert.throws(
    () =>
      assertRobinhoodFoundationRpcProviders({
        rpcUrls: RPC_URLS,
        endpointCommitments: [RPC_COMMITMENTS[1], RPC_COMMITMENTS[0]],
      }),
    /reviewed commitment/u,
  );
});

test("provider commitment helper separates review derivation from live exact matching", () => {
  const helper = path.join(
    repositoryRoot,
    "contracts/scripts/commit-robinhood-custom-launch-provider-endpoints.mjs",
  );
  const baseEnvironment = { ...process.env };
  delete baseEnvironment.ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY;
  delete baseEnvironment.ROBINHOOD_MAINNET_RPC_COMMITMENT_SECONDARY;
  const environment = {
    ...baseEnvironment,
    ROBINHOOD_MAINNET_RPC_URL_PRIMARY: RPC_URLS[0],
    ROBINHOOD_MAINNET_RPC_URL_SECONDARY: RPC_URLS[1],
  };
  const derived = spawnSync(process.execPath, [helper], {
    cwd: repositoryRoot,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(derived.status, 0, derived.stderr);
  assert.equal(
    derived.stdout,
    [
      `ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY=${RPC_COMMITMENTS[0]}`,
      `ROBINHOOD_MAINNET_RPC_COMMITMENT_SECONDARY=${RPC_COMMITMENTS[1]}`,
      "",
    ].join("\n"),
  );

  const matched = spawnSync(process.execPath, [helper], {
    cwd: repositoryRoot,
    env: {
      ...environment,
      ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY: RPC_COMMITMENTS[0],
      ROBINHOOD_MAINNET_RPC_COMMITMENT_SECONDARY: RPC_COMMITMENTS[1],
    },
    encoding: "utf8",
  });
  assert.equal(matched.status, 0, matched.stderr);
  assert.equal(
    matched.stdout,
    "ROBINHOOD_RPC_PROVIDER_COMMITMENTS_MATCH_REVIEW\n",
  );

  const substituted = spawnSync(process.execPath, [helper], {
    cwd: repositoryRoot,
    env: {
      ...environment,
      ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY: `sha256:${"0".repeat(64)}`,
      ROBINHOOD_MAINNET_RPC_COMMITMENT_SECONDARY: RPC_COMMITMENTS[1],
    },
    encoding: "utf8",
  });
  assert.notEqual(substituted.status, 0);
  assert.equal(substituted.stdout, "");
  assert.doesNotMatch(substituted.stderr, /0123456789abcdef|abcdef0123456789/u);
});

test("preflight fails closed on provider, pin, vacancy, nonce, simulation, and gas drift", async (t) => {
  const cases = [
    ["chain", { providers: { alchemy: { chainId: "0x1" } } }, /not Robinhood/u],
    [
      "head gap",
      { providers: { alchemy: { headNumber: 1_005 } } },
      /heads exceed/u,
    ],
    [
      "anchor",
      { providers: { alchemy: { commonHashByte: "44" } } },
      /common fixed block/u,
    ],
    [
      "dependency code",
      { providers: { alchemy: { codeDriftKey: "poolManager" } } },
      /runtime code hash drifted/u,
    ],
    [
      "occupied target",
      { providers: { quicknode: { occupiedCodeKey: "router" } } },
      /predicted address is occupied/u,
    ],
    [
      "target nonce",
      { providers: { quicknode: { targetNonceKey: "graphFactory" } } },
      /nonce is non-zero/u,
    ],
    [
      "owner pending",
      { providers: { alchemy: { pendingNonce: "0x8" } } },
      /nonce disagrees/u,
    ],
    [
      "simulation",
      { providers: { alchemy: { callResult: "0x" } } },
      /pending state, simulation, or gas/u,
    ],
    [
      "estimate",
      { providers: { alchemy: { estimate: "0x6d66ab" } } },
      /pending state, simulation, or gas/u,
    ],
    [
      "closing nonce",
      { providers: { quicknode: { closingNonce: "0x8" } } },
      /state changed/u,
    ],
    [
      "closing simulation",
      { providers: { quicknode: { closingCallResult: "0x" } } },
      /simulation|state changed/u,
    ],
    [
      "closing gas estimate",
      { providers: { quicknode: { closingEstimate: "0x6d66ab" } } },
      /gas|state changed/u,
    ],
  ];
  for (const [name, options, pattern] of cases) {
    await t.test(name, async () => {
      await assert.rejects(() => prepareEnvelope({ options }), pattern);
    });
  }
});

test("owner fee and total-cost ceilings fail closed", async () => {
  await assert.rejects(
    () => prepareEnvelope({ ceilings: { maximumFeePerGasWei: "1999999999" } }),
    /fees exceed/u,
  );
  await assert.rejects(
    () =>
      prepareEnvelope({
        ceilings: {
          maximumPriorityFeePerGasWei: "0",
          maximumFeePerGasWei: "3000000000",
        },
        options: {
          providers: {
            quicknode: { priorityFee: "0x1" },
            alchemy: { priorityFee: "0x1" },
          },
        },
      }),
    /fees exceed/u,
  );
  await assert.rejects(
    () => prepareEnvelope({ ceilings: { maximumGasCostWei: "1" } }),
    /gas cost exceeds/u,
  );
  await assert.rejects(
    () =>
      prepareEnvelope({
        ceilings: { maximumFeePerGasWei: "9".repeat(79) },
      }),
    /canonical decimal/u,
  );
});

test("RPC transport is strict, bounded, and redacts endpoint/error content", async () => {
  const secret = "credential-canary-0123456789";
  const responseBudget = { consumed: 0, limit: 4 * 1024 * 1024 };
  const result = await robinhoodFoundationRpc({
    providerId: "quicknode",
    rpcUrl: `https://hood-explorer-indexer.robinhood-mainnet.quiknode.pro/${secret}/`,
    method: "eth_chainId",
    responseBudget,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1237" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
  });
  assert.equal(result, "0x1237");
  await assert.rejects(
    () =>
      robinhoodFoundationRpc({
        providerId: "quicknode",
        rpcUrl: `https://hood-explorer-indexer.robinhood-mainnet.quiknode.pro/${secret}/`,
        method: "eth_chainId",
        responseBudget: { consumed: 0, limit: 4 * 1024 * 1024 },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              error: { message: `raw-${secret}` },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      }),
    (error) => {
      assert.ok(!error.message.includes(secret));
      assert.ok(!error.message.includes("raw-"));
      return true;
    },
  );
});

test("CLI parser accepts only the five non-signing review inputs", () => {
  const valid = [
    "--owner",
    OWNER_0,
    "--max-fee-per-gas-wei",
    "3000000000",
    "--max-priority-fee-per-gas-wei",
    "0",
    "--max-total-cost-wei",
    "30000000000000000",
    "--output",
    "/protected/envelope.json",
  ];
  assert.equal(parseRobinhoodFoundationEnvelopeCli(valid).owner, OWNER_0);
  assert.throws(() =>
    parseRobinhoodFoundationEnvelopeCli([
      ...valid.slice(0, -2),
      "--private-key",
      "secret",
    ]),
  );
  assert.throws(() =>
    parseRobinhoodFoundationEnvelopeCli([...valid, "--broadcast", "true"]),
  );
});

test("canonical action-time wallet request binds every type-2 field and rejects extras", async () => {
  const { receipt } = await prepareEnvelope();
  const request = walletRequest(receipt);
  const summary = assertCanonicalRobinhoodOwnerWalletRequest(receipt, request);
  assert.equal(summary.receiptDigest, receipt.receiptDigest);
  assert.equal(summary.calldataHash, receipt.transaction.inputKeccak256);
  assert.equal(summary.sourceCommit, receipt.source.commit);
  assert.equal(
    summary.ownerMaximumGasCostWei,
    receipt.gasPolicy.ownerMaximumGasCostWei,
  );
  assert.ok(!JSON.stringify(summary).includes(receipt.transaction.input));
  assert.ok(!JSON.stringify(summary).includes(RPC_URLS[0]));
  const transactionKeys = Object.keys(request.request.params[0]);
  for (const key of transactionKeys) {
    const mutated = structuredClone(request);
    mutated.request.params[0][key] =
      key === "from" ? OWNER_1 : `${mutated.request.params[0][key]}0`;
    assert.throws(
      () => assertCanonicalRobinhoodOwnerWalletRequest(receipt, mutated),
      /differs|canonical/u,
      key,
    );
  }
  const extra = structuredClone(request);
  extra.request.params[0].gasPrice = "0x1";
  assert.throws(
    () => assertCanonicalRobinhoodOwnerWalletRequest(receipt, extra),
    /key inventory/u,
  );
});

test("read-only action-time verifier rebinds source, hosted CI, endpoints, and live chain state", async () => {
  const { receipt } = await prepareEnvelope();
  const root = await mkdtemp(
    path.join(os.homedir(), ".robinhood-wallet-request-test-"),
  );
  await chmod(root, 0o700);
  const envelopePath = path.join(root, "envelope.json");
  const walletRequestPath = path.join(root, "wallet-request.json");
  const env = {
    ROBINHOOD_OWNER_ENVELOPE_ROOT: root,
    ROBINHOOD_MAINNET_RPC_URL_PRIMARY: RPC_URLS[0],
    ROBINHOOD_MAINNET_RPC_URL_SECONDARY: RPC_URLS[1],
    ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY: RPC_COMMITMENTS[0],
    ROBINHOOD_MAINNET_RPC_COMMITMENT_SECONDARY: RPC_COMMITMENTS[1],
  };
  try {
    await Promise.all([
      writeFile(envelopePath, `${JSON.stringify(receipt, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      }),
      writeFile(
        walletRequestPath,
        `${JSON.stringify(walletRequest(receipt), null, 2)}\n`,
        { mode: 0o600, flag: "wx" },
      ),
    ]);
    const actionTimeMock = mockRpc();
    const verified = await verifyRobinhoodOwnerWalletRequest({
      envelopePath,
      walletRequestPath,
      env,
      nowMilliseconds: FIXED_TIMESTAMP * 1_000,
      sourceIdentity: () => ({
        commit: receipt.source.commit,
        tree: receipt.source.tree,
        clean: true,
      }),
      hostedVerifyResolver: async ({ expectedHostedVerify }) => {
        assert.equal(
          JSON.stringify(expectedHostedVerify),
          JSON.stringify(receipt.hostedVerify),
        );
        return receipt.hostedVerify;
      },
      rpcClient: actionTimeMock.rpcClient,
      clock: () => FIXED_TIMESTAMP * 1_000,
    });
    assert.equal(verified.receiptDigest, receipt.receiptDigest);
    assert.deepEqual(verified.actionTimeState, {
      chainId: "0x1237",
      ownerNonce: receipt.transaction.nonce,
      providerCount: 2,
      preparedAddressCount: 3,
      pendingSimulationVerified: true,
      pendingGasEstimate: receipt.simulation.agreedGasEstimate,
      closingSimulationVerified: true,
      closingGasEstimate: receipt.simulation.agreedGasEstimate,
      closingVacancyVerified: true,
      rpcResponseBytesConsumed: 0,
    });
    assert.ok(
      !actionTimeMock.methodInventory.some((method) => /send|sign/iu.test(method)),
    );
    assert.deepEqual(
      [...new Set(actionTimeMock.methodInventory)].sort(),
      [
        "eth_call",
        "eth_chainId",
        "eth_estimateGas",
        "eth_getCode",
        "eth_getTransactionCount",
      ],
    );
    const requestsByProvider = Object.fromEntries(
      ["quicknode", "alchemy"].map((providerId) => [
        providerId,
        actionTimeMock.requestInventory
          .filter((request) => request.providerId === providerId)
          .map(({ method, params }) => ({ method, params })),
      ]),
    );
    assert.equal(requestsByProvider.quicknode.length, 21);
    assert.deepEqual(requestsByProvider.quicknode, requestsByProvider.alchemy);
    assert.ok(
      actionTimeMock.requestInventory.every(
        ({ method }) =>
          !/eth_getBalance|eth_send|wallet_|personal_|sign/iu.test(method),
      ),
    );
    await assert.rejects(
      () =>
        verifyRobinhoodOwnerWalletRequest({
          envelopePath,
          walletRequestPath,
          env: {
            ...env,
            ROBINHOOD_MAINNET_RPC_URL_PRIMARY:
              "https://hood-explorer-indexer.robinhood-mainnet.quiknode.pro/substitute_0123456789/",
          },
          nowMilliseconds: FIXED_TIMESTAMP * 1_000,
          sourceIdentity: () => ({
            commit: receipt.source.commit,
            tree: receipt.source.tree,
            clean: true,
          }),
          hostedVerifyResolver: async () => receipt.hostedVerify,
          rpcClient: mockRpc().rpcClient,
          clock: () => FIXED_TIMESTAMP * 1_000,
        }),
      /reviewed commitment/u,
    );
    await assert.rejects(
      () =>
        verifyRobinhoodOwnerWalletRequest({
          envelopePath,
          walletRequestPath,
          env,
          nowMilliseconds: FIXED_TIMESTAMP * 1_000,
          sourceIdentity: () => ({
            commit: "4".repeat(40),
            tree: receipt.source.tree,
            clean: true,
          }),
          hostedVerifyResolver: async () => ({
            ...receipt.hostedVerify,
            sourceCommit: "4".repeat(40),
          }),
          rpcClient: mockRpc().rpcClient,
          clock: () => FIXED_TIMESTAMP * 1_000,
        }),
      /protected source differs/u,
    );
    const actionTimeDriftCases = [
      [
        "chain",
        { providers: { alchemy: { chainId: "0x1" } } },
        /action-time chain/u,
      ],
      [
        "owner pending nonce",
        { providers: { alchemy: { pendingNonce: "0x8" } } },
        /action-time chain or owner nonce/u,
      ],
      [
        "target code",
        { providers: { quicknode: { occupiedCodeKey: "router" } } },
        /predicted address is occupied/u,
      ],
      [
        "target nonce",
        { providers: { quicknode: { targetNonceKey: "graphFactory" } } },
        /nonce is non-zero/u,
      ],
      [
        "simulation",
        { providers: { alchemy: { callResult: "0x" } } },
        /simulation return commitment/u,
      ],
      [
        "gas estimate",
        { providers: { alchemy: { estimate: "0x6d66ab" } } },
        /simulation or gas/u,
      ],
      [
        "closing owner nonce",
        { providers: { quicknode: { closingNonce: "0x8" } } },
        /state changed during wallet verification/u,
      ],
    ];
    for (const [name, rpcOptions, pattern] of actionTimeDriftCases) {
      await assert.rejects(
        () =>
          verifyRobinhoodOwnerWalletRequest({
            envelopePath,
            walletRequestPath,
            env,
            nowMilliseconds: FIXED_TIMESTAMP * 1_000,
            sourceIdentity: () => ({
              commit: receipt.source.commit,
              tree: receipt.source.tree,
              clean: true,
            }),
            hostedVerifyResolver: async () => receipt.hostedVerify,
            rpcClient: mockRpc(rpcOptions).rpcClient,
            clock: () => FIXED_TIMESTAMP * 1_000,
          }),
        pattern,
        name,
      );
    }
    let guardedSourceReads = 0;
    await assert.rejects(
      () =>
        verifyRobinhoodOwnerWalletRequest({
          envelopePath,
          walletRequestPath,
          env,
          nowMilliseconds: FIXED_TIMESTAMP * 1_000,
          sourceIdentity: () => {
            guardedSourceReads += 1;
            return {
              commit:
                guardedSourceReads === 1
                  ? receipt.source.commit
                  : "4".repeat(40),
              tree: receipt.source.tree,
              clean: true,
            };
          },
          hostedVerifyResolver: async () => receipt.hostedVerify,
          rpcClient: mockRpc().rpcClient,
          clock: () => FIXED_TIMESTAMP * 1_000,
        }),
      /source changed during action-time/u,
    );
    assert.equal(guardedSourceReads, 2);
    let guardedHostedReads = 0;
    await assert.rejects(
      () =>
        verifyRobinhoodOwnerWalletRequest({
          envelopePath,
          walletRequestPath,
          env,
          nowMilliseconds: FIXED_TIMESTAMP * 1_000,
          sourceIdentity: () => ({
            commit: receipt.source.commit,
            tree: receipt.source.tree,
            clean: true,
          }),
          hostedVerifyResolver: async () => {
            guardedHostedReads += 1;
            return guardedHostedReads === 1
              ? receipt.hostedVerify
              : {
                  ...receipt.hostedVerify,
                  artifactDigest: `sha256:${"4".repeat(64)}`,
                };
          },
          rpcClient: mockRpc().rpcClient,
          clock: () => FIXED_TIMESTAMP * 1_000,
        }),
      /hosted Verify proof changed during action-time/u,
    );
    assert.equal(guardedHostedReads, 2);

    let finalSourceReads = 0;
    await assert.rejects(
      () =>
        verifyRobinhoodOwnerWalletRequest({
          envelopePath,
          walletRequestPath,
          env,
          nowMilliseconds: FIXED_TIMESTAMP * 1_000,
          sourceIdentity: () => {
            finalSourceReads += 1;
            return {
              commit:
                finalSourceReads < 3
                  ? receipt.source.commit
                  : "4".repeat(40),
              tree: receipt.source.tree,
              clean: true,
            };
          },
          hostedVerifyResolver: async () => receipt.hostedVerify,
          rpcClient: mockRpc().rpcClient,
          clock: () => FIXED_TIMESTAMP * 1_000,
        }),
      /source changed during hosted Verify revalidation/u,
    );
    assert.equal(finalSourceReads, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("action-time closing simulation and gas drift fail closed", async (t) => {
  const { receipt } = await prepareEnvelope();
  const root = await mkdtemp(
    path.join(os.homedir(), ".robinhood-wallet-closing-test-"),
  );
  await chmod(root, 0o700);
  const envelopePath = path.join(root, "envelope.json");
  const walletRequestPath = path.join(root, "wallet-request.json");
  const env = {
    ROBINHOOD_OWNER_ENVELOPE_ROOT: root,
    ROBINHOOD_MAINNET_RPC_URL_PRIMARY: RPC_URLS[0],
    ROBINHOOD_MAINNET_RPC_URL_SECONDARY: RPC_URLS[1],
    ROBINHOOD_MAINNET_RPC_COMMITMENT_PRIMARY: RPC_COMMITMENTS[0],
    ROBINHOOD_MAINNET_RPC_COMMITMENT_SECONDARY: RPC_COMMITMENTS[1],
  };
  try {
    await Promise.all([
      writeFile(envelopePath, `${JSON.stringify(receipt, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      }),
      writeFile(
        walletRequestPath,
        `${JSON.stringify(walletRequest(receipt), null, 2)}\n`,
        { mode: 0o600, flag: "wx" },
      ),
    ]);
    const cases = [
      [
        "closing eth_call drift",
        { providers: { quicknode: { closingCallResult: "0x" } } },
        /simulation|state changed during wallet verification/u,
      ],
      [
        "closing eth_estimateGas drift",
        { providers: { quicknode: { closingEstimate: "0x6d66ab" } } },
        /gas|state changed during wallet verification/u,
      ],
    ];
    for (const [name, rpcOptions, pattern] of cases) {
      await t.test(name, async () => {
        await assert.rejects(
          () =>
            verifyRobinhoodOwnerWalletRequest({
              envelopePath,
              walletRequestPath,
              env,
              nowMilliseconds: FIXED_TIMESTAMP * 1_000,
              sourceIdentity: () => ({
                commit: receipt.source.commit,
                tree: receipt.source.tree,
                clean: true,
              }),
              hostedVerifyResolver: async () => receipt.hostedVerify,
              rpcClient: mockRpc(rpcOptions).rpcClient,
              clock: () => FIXED_TIMESTAMP * 1_000,
            }),
          pattern,
        );
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("freshness validation and protected output reject tampering, expiry, and overwrite", async () => {
  const { receipt } = await prepareEnvelope();
  assert.equal(
    assertFreshRobinhoodFoundationOwnerEnvelope(
      receipt,
      FIXED_TIMESTAMP * 1_000,
    ),
    receipt.receiptDigest,
  );
  assert.throws(
    () =>
      assertFreshRobinhoodFoundationOwnerEnvelope(
        {
          ...receipt,
          transaction: { ...receipt.transaction, valueWei: "1" },
        },
        FIXED_TIMESTAMP * 1_000,
      ),
    /digest-invalid/u,
  );
  for (const unsafe of [
    { status: "READY_TO_SIGN" },
    { privateKeyAccepted: true },
    { gasPolicy: { ...receipt.gasPolicy, balanceReadPerformed: true } },
    {
      hostedVerify: {
        ...receipt.hostedVerify,
        sourceTree: "4".repeat(40),
      },
    },
  ]) {
    assert.throws(
      () =>
        assertFreshRobinhoodFoundationOwnerEnvelope(
          { ...receipt, ...unsafe },
          FIXED_TIMESTAMP * 1_000,
        ),
      /stale, unsafe, or digest-invalid/u,
    );
  }
  assert.throws(
    () =>
      assertFreshRobinhoodFoundationOwnerEnvelope(
        receipt,
        (receipt.observation.expiresAtTimestamp - 59) * 1_000,
      ),
    /stale/u,
  );

  const root = await mkdtemp(
    path.join(os.homedir(), ".robinhood-owner-envelope-test-"),
  );
  await chmod(root, 0o700);
  const candidate = path.join(root, "owner-envelope.json");
  try {
    const output = await writeProtectedRobinhoodFoundationOwnerEnvelope({
      candidate,
      configuredRoot: root,
      receipt,
      nowMilliseconds: FIXED_TIMESTAMP * 1_000,
    });
    const metadata = await lstat(output);
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal(metadata.nlink, 1);
    await assert.rejects(
      () =>
        writeProtectedRobinhoodFoundationOwnerEnvelope({
          candidate,
          configuredRoot: root,
          receipt,
          nowMilliseconds: FIXED_TIMESTAMP * 1_000,
        }),
      /already exists/u,
    );

    const guardedCandidate = path.join(root, "guarded-owner-envelope.json");
    let guardCalls = 0;
    await assert.rejects(
      () =>
        writeProtectedRobinhoodFoundationOwnerEnvelope({
          candidate: guardedCandidate,
          configuredRoot: root,
          receipt,
          nowMilliseconds: FIXED_TIMESTAMP * 1_000,
          sourceGuard: () => {
            guardCalls += 1;
            if (guardCalls === 2) throw new Error("source changed after write");
          },
        }),
      /source changed after write/u,
    );
    assert.equal(guardCalls, 2);
    await assert.rejects(
      () => lstat(guardedCandidate),
      (error) => error?.code === "ENOENT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
