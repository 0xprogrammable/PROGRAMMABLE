import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
} from "viem";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  CLASSIC_V4_LIFECYCLE_ACTIONS,
  CLASSIC_V4_NEW_CONTRACTS,
  buildClassicV4LifecycleAuthorizationRequest,
  buildClassicV4LifecycleCanaryPlan,
  buildClassicV4LifecycleReleaseCandidate,
  classicV4LaunchStampRouterAbi,
  classicV4PoolId,
  digestJson,
  expectedLifecycleLaunchCalldata,
  expectedLifecycleSwapCalldata,
  hashClassicV4LaunchPermit,
  hashClassicV4LaunchResult,
  hashClassicV4StampRequest,
} from "../../../scripts/classic-v4-release-core.mjs";
import {
  CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS,
  buildClassicV4LauncherUpgradePlan,
  buildClassicV4LauncherUpgradeReceiptEvidence,
  buildClassicV4LauncherUpgradeVerificationEvidence,
} from "../../../scripts/classic-v4-launcher-upgrade-core.mjs";
import {
  CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS,
  CLASSIC_V4_LAUNCHER_ROLLFORWARD_SOURCE_TARGETS,
  createClassicV4LauncherRollforward,
  createClassicV4LauncherRollforwardPlan,
  createClassicV4LauncherRollforwardReleaseManifest,
  validateClassicV4LauncherRollforwardArtifacts,
  validateClassicV4LauncherRollforwardDeploymentEvidence,
  validateClassicV4LauncherRollforwardPlan,
  validateClassicV4LauncherRollforwardSourceEvidence,
} from "../../../scripts/classic-v4-launcher-rollforward-core.mjs";

const HASH = (label) => keccak256(stringToHex("rollforward:" + label));
const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);

function readGzipJson(base64) {
  return JSON.parse(gunzipSync(Buffer.from(base64, "base64")).toString("utf8"));
}

const BASE_PLAN = readGzipJson(
  [
    "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",
    "6vxF2nsXZBHci1umvD00vbsnqOrszJDs1txU/Z6v92XoXjLj/v4STDOiz6w0ncyB7RSMXiKzlnP/znuL/o1h4xNrBfuejvyw+YSd",
    "mej4RD7jS6EWZ0a+8fqVUdnpjP/G9SQGyuH9Oto2VwejIeZK0bmVA8Vf4M9l5dl+u9kgTtw4EC7J7U5QbPOQKxbFhksy727oW+G0",
    "926rT9FMzPfhmLdy7EEIwyY+suFlkWrgkgw767gL9kAioYyPURVKDaz24xuY40XcVIkbrJYD89iNE02uiBuyWMN3Rnb14H6vMsT7",
    "GiNfRT7f9wauJAquFMnNtF4YKQ1/Lmt/wfo9SVIPODUPHOH8tqK3KYulV9178TaNBN+whHdqwEj03n4R95EX7kN6iZRV5KedfvMO",
    "y2g3ee2P4z75J9H26wfPWfkrojo98tQn+Xb5zxhjskUbcU7aggZRVNWlsi/p4b9UlHRYIAG9uZiEnJvxxlcXY3RGidacqTXU15+u",
    "lJwBxdqsQ5SyOXTcNIcV6UIsJqSnN2NpwdpoTCtYZCBowLIHxbriZWmxJTqdc356v0CDZrPFwGpMZQrRNuNsg1KEKhoLvxcT3eP7",
    "TUFwvoXSYtZY6kODSTYUV7zNgCkLusb0XBm2VCVTyNjD2EoKqSpRQZFdugnnEtbDce0xXsbqaDB4KCaJUeehaHSpg43J61y0NSEp",
    "UeTj91WQMaDxzoailC1CJelsMFoA5vI5I0xB0+Xnf/juE/33ucTf47/E3/7j8/efPos/p5JjztX4aEvLNWlyAIKuMlYfXKkenEq2",
    "qVS1DUHJpEvWreTktZYxf6Zm//rdp0//hl/4XP9c8x9//+Hnn/7p5z/+VOKvf/n8/af/oWc+//bDv//02+fvP7X442+Vu/M5/fpz",
    "LDn+9vv5xp9+/eH3er74859+qr/+4y+//Przf8cf/7X+1x9/+LWWf/751z/UX378+S//WX/6/fP3n37/9Y/1u0+f/krd+eXH+NMf",
    "fvj3+tvvPNwYMDLGYX6TLDHZAFA91nYqJgdD4fNNe2OLxIy04JxBK51XQZnaoo+fv/vrd/8L1p5qvNe4AQA=",
  ].join(""),
);

const BASE_DEPLOYMENT = readGzipJson(
  [
    "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",
  ].join(""),
);

const BASE_SOURCE = readGzipJson(
  [
    "H4sIAAAAAAAAE9VXy24bRxC86ysInmNr+jUP3fREAiRBgBg6JMihZ7rHIiyRyi4lxDD878FStGQjoiQjAQLzQnKmq2pmu7oIftib",
    "zeZju/ArPfdhXKyW84MZfDettgtdLH+w++/Xl7o8Wbz1cT0/mM3DX1ogV4jZuYJplZKzJ4NAxq2wpCyxU2IxqCVziZElS0xYkL1r",
    "0vmGdVzdDM2PV1dXi/WVLz9xxxhr1oxYwMFiTwUoREu9lNRKr6EoWZFKpUUIDRQ5BKqsQXqNsOVe6/pmnBhvfVj0hdt8ezNv79wO",
    "N2IYML4K+RXmN4EOBA8Cvg6cftuWrpbrQdt6YvmwN5vNZvOL1erdmbb1anh/vzibzdVs8HG8O389DaocMhxWyZEQjo5FoKTTmIDk",
    "GAqYEB6WjcgG/knoZ73yieN0fXE8uK5Xw5n79w+S5/yA6X+2qV3zcWj7u+tfj6vLg5fQ+bKtzO14tRzXw820fTi8vZmasr3VQ6n5",
    "9eXq/bT1ZtDlqG1955zp6kQeiErNiI6JiAAbCfXEHSN5jO7iYOiUoFvyGKBjAUFgliqPiRxdrtq7+cEMJQtAoPuShw5f6bpdPGCv",
    "h9XtwnyY9n7fLs7um7UpWW6f9K+TAxf9/T34SebN5s1wOe1crNfX48H+/rhleG1+uz/6cOvD/i3uf2rpPux/hSPudT5uP/2xef94",
    "d4B5v2vfTucdnpwVEWU+O0lnIRTKATmYxJMEdnbYjzgGDK19hfNebLldXvsqk4XnX8zMTawlaZUkUw6Tm8xD1rIbVCR1LhGD9k5q",
    "tXqGIso9EjmX1gpRim0XvmMuMfViXRs1RaDMVYpFS9IyhFjJtaK+aEgoVw8ViTPUDuQg0VpxidLE2aT1QgETBmrkSXv3mhSiVzbr",
    "3vrzQ0LpGxySF5v3mSG5Xo2L6WH/cqnLpQ87h+Uk99zlWDJh5GxSVDpH6fnEAhpFSXjCh/GJYTm+1HFctF++FDyHxydmV/VmbJ6n",
    "+m8CWgEUBLsCW5fuAFQiMSkFrFkipmxNcpLe0SN01RwtpFKbxtbwBQHN36L3XuyFZ7x3qTfLdvGE6UC7hNyLnpWNYk+1J8CjZFgS",
    "n7CfpsMYM+w23U9+5T9uZM7pcaN9XrEx1+OQ/y2MqyFEAbLELbcO3DonTh5VNTKG3iO7F39a2jGEkLOJNCoK0GMoLj3GlLCocam7",
    "kGr9Lmi6pf550FgC69rrNmh24W1jlvZPs9i9WYz13/+Y7NR3hFradELtVkt1DJ6RIgD1EGOtucXYeRdeSNnAo1bITLkYSYaQRWui",
    "ZiRcKgaDnfpYQEvvEKQYoljAClEKU8iBOUcObFVCelEgxVCrQBVEr5zEQLxipmhZMQZibkAVAiBTyT3HZtmSGTPWJFgfFfkykCR8",
    "g4H04pzYFUh721Ca+3SxZfPP/72Jc4qaGDBxSkVwaj1LrdKKc0tERUM2kJaxt5yZqDelioUlYOjzvY97fwNLpJFUPQ4AAA==",
  ].join(""),
);

function txHash(label) {
  return keccak256(stringToHex(`classic-v4-test:${label}`));
}

const classicLauncherAbi = parseAbi([
  "function launchFor(address launchWallet,(string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps,(uint8 mode,uint16 durationDays,uint16 cliffDays) initialBuyCustody) parameters) payable returns ((address token,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,address initialBuyCustody,bytes32 poolId,bytes32 launchHash) result)",
]);
const classicRouteParameters = parseAbiParameters(
  "(address launcher,bytes32 launcherRuntimeCodeHash,(string name,string symbol,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] rewardBeneficiaries,uint16[] rewardSharesBps,(uint8 mode,uint16 durationDays,uint16 cliffDays) initialBuyCustody) parameters,(address token,address rewardVault,address positionRecipient,uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount,address initialBuyCustody,bytes32 poolId,bytes32 launchHash) expectedResult) route",
);

function classicLaunchAuthorization(
  manifest,
  wallet,
  {
    token = "0x0000000000000000000000000000000000000001",
    rewardVault = "0x0000000000000000000000000000000000000002",
    positionRecipient = "0x0000000000000000000000000000000000000003",
    blockNumber = "25851219",
    blockTimestamp = "1788000000",
  } = {},
) {
  const request = buildClassicV4LifecycleAuthorizationRequest(manifest, wallet);
  const direct = decodeFunctionData({
    abi: classicLauncherAbi,
    data: request.launcherCalldata,
  });
  assert.equal(direct.functionName, "launchFor");
  const poolKey = {
    currency0: "0x0000000000000000000000000000000000000000",
    currency1: token,
    fee: 0,
    tickSpacing: 200,
    hooks: request.feeHook,
  };
  const result = {
    token,
    rewardVault,
    positionRecipient,
    positionTokenId: 0n,
    tokenLiquidityAmount: 999_999_999n * 10n ** 18n,
    lockedTokenDust: 1n * 10n ** 18n,
    initialBuyNativeAmount: BigInt(request.valueWei),
    initialBuyTokenAmount: 123_000n * 10n ** 18n,
    initialBuyCustody: "0x0000000000000000000000000000000000000000",
    poolId: classicV4PoolId(poolKey),
    launchHash: txHash("router-launch-hash"),
  };
  const components = [
    {
      resultIndex: 0,
      account: token,
      runtimeCodeHash: txHash("router-token-runtime"),
      kind: 1,
      scope: 1,
    },
    {
      resultIndex: 1,
      account: rewardVault,
      runtimeCodeHash: txHash("router-vault-runtime"),
      kind: 0,
      scope: 1,
    },
    {
      resultIndex: 2,
      account: positionRecipient,
      runtimeCodeHash: txHash("router-position-runtime"),
      kind: 0,
      scope: 1,
    },
    {
      resultIndex: 255,
      account: request.feeHook,
      runtimeCodeHash: request.feeHookRuntimeCodeHash,
      kind: 2,
      scope: 2,
    },
  ].sort((left, right) =>
    BigInt(left.account) < BigInt(right.account) ? -1 : 1,
  );
  const stampRequest = {
    launchId: txHash("router-launch-id"),
    token,
    tokenRuntimeCodeHash: components.find((item) => item.resultIndex === 0)
      .runtimeCodeHash,
    poolKey,
    hookRuntimeCodeHash: request.feeHookRuntimeCodeHash,
    components,
  };
  const routePayload = encodeAbiParameters(classicRouteParameters, [
    {
      launcher: request.launcher,
      launcherRuntimeCodeHash: request.launcherRuntimeCodeHash,
      parameters: direct.args[1],
      expectedResult: result,
    },
  ]);
  const validAfter = (BigInt(blockTimestamp) - 30n).toString();
  const deadline = (BigInt(blockTimestamp) + 300n).toString();
  const permit = {
    chainId: 1n,
    router: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
    launchWallet: request.launchWallet,
    kind: 2,
    routePayloadHash: keccak256(routePayload),
    expectedResultHash: hashClassicV4LaunchResult(result),
    stampRequestHash: hashClassicV4StampRequest(stampRequest),
    nonce: txHash("router-permit-nonce"),
    validAfter: BigInt(validAfter),
    deadline: BigInt(deadline),
    value: BigInt(request.valueWei),
  };
  const signature = `0x${"0".repeat(63)}1${"0".repeat(63)}2${"1b"}`;
  const calldata = encodeFunctionData({
    abi: classicV4LaunchStampRouterAbi,
    functionName: "launchAndStampV1",
    args: [permit, stampRequest, routePayload, signature],
  });
  return {
    schemaVersion: "programmable.classic-launch-authorization.v1",
    chainId: "1",
    releaseManifestDigest: request.releaseManifestDigest,
    predictedToken: token,
    predictedHook: request.feeHook,
    permitDigest: hashClassicV4LaunchPermit(permit),
    validAfter,
    deadline,
    simulation: {
      blockNumber,
      blockHash: txHash("router-simulation-block"),
      blockTimestamp,
      gasEstimate: "2000000",
      stampHash: txHash("router-stamp-hash"),
    },
    transaction: {
      chainId: "1",
      from: request.launchWallet,
      to: permit.router,
      valueWei: request.valueWei,
      calldata,
      gasLimit: "2400000",
    },
  };
}

function withDigest(value, domain) {
  return { ...value, evidenceDigest: digestJson(value, domain) };
}
function lifecycleEvidence(plan, deployment, source) {
  const operatorWallet = plan.deployer;
  const canaryToken = "0x0000000000000000000000000000000000000001";
  const rewardVault = "0x0000000000000000000000000000000000000002";
  const positionRecipient = "0x0000000000000000000000000000000000000003";
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  const releaseCandidate = buildClassicV4LifecycleReleaseCandidate(
    plan,
    deployment,
    source,
  );
  const authorization = classicLaunchAuthorization(
    releaseCandidate,
    operatorWallet,
  );
  const canary = buildClassicV4LifecycleCanaryPlan(
    releaseCandidate,
    operatorWallet,
    authorization,
  );
  const canaryPoolId = classicV4PoolId({
    currency0: zeroAddress,
    currency1: canaryToken,
    fee: 0,
    tickSpacing: 200,
    hooks: canary.feeHook,
  });
  const verificationBlock = 25_851_240;
  const timestamps = Object.fromEntries(
    CLASSIC_V4_LIFECYCLE_ACTIONS.map((name, index) => [
      name,
      (1_788_000_000n + BigInt(index) * 12n).toString(),
    ]),
  );
  const actionEvents = {
    launch: [
      "ProgrammableComponentStampedV1.token",
      "ProgrammableComponentStampedV1.rewardVault",
      "ProgrammableComponentStampedV1.positionRecipient",
      "ProgrammableComponentStampedV1.feeHook",
      "ProgrammableLaunchRouteStampedV1",
      "ProgrammableLaunchStampedV1",
      "MemeTokenLaunchedV2",
      "MemeLiquidityConfiguredV2",
      "MemeCreatorInitialBuyV2",
      "MemeCreatorInitialBuyCustodyV2",
      "PoolRegistered",
      "PoolFeeDisclosure",
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    buyExactInput: [
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    buyExactOutput: [
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    sellExactInput: [
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    sellExactOutput: [
      "NativeSwapFeesAccrued",
      "HookFee",
      "HookSwap",
      "PoolManagerSwap",
    ],
    creatorClaim: [
      "CreatorFeesClaimed",
      "CreatorFeesCheckpointed",
      "BeneficiaryFeesClaimed",
    ],
    launcherClaim: ["LauncherFeesClaimed"],
  };
  const actions = Object.fromEntries(
    CLASSIC_V4_LIFECYCLE_ACTIONS.map((name, index) => {
      const blockNumber = 25_851_220 + index;
      const swapIdentity = {
        buyExactInput: ["buy", "exact-input"],
        buyExactOutput: ["buy", "exact-output"],
        sellExactInput: ["sell", "exact-input"],
        sellExactOutput: ["sell", "exact-output"],
      }[name];
      const values = {
        launch: canary.launchFixture.initialBuyWei,
        buyExactInput: canary.swapFixture.buyExactInput.amountIn,
        buyExactOutput: "1010000000",
        sellExactInput: "0",
        sellExactOutput: "0",
        creatorClaim: "0",
        launcherClaim: "0",
      };
      const target =
        name === "launch"
          ? canary.launchStampRouterBinding.address
          : swapIdentity
            ? canary.dependencies.universalRouter
            : name === "creatorClaim"
              ? rewardVault
              : canary.feeHook;
      return [
        name,
        {
          transactionHash: txHash(`action:${name}`),
          inputHash: txHash(`input:${name}`),
          blockNumber,
          blockHash: txHash(`block:${name}`),
          blockTimestamp: timestamps[name],
          transactionIndex: index,
          nonce: name === "launcherClaim" ? 77 : 100 + index,
          from:
            name === "launcherClaim"
              ? plan.launcherFeeRecipient
              : operatorWallet,
          to: target,
          value: values[name],
          confirmations: verificationBlock - blockNumber + 1,
          success: true,
          events: Object.fromEntries(
            actionEvents[name].map((event, eventIndex) => [event, eventIndex]),
          ),
          ...(swapIdentity
            ? { side: swapIdentity[0], exactness: swapIdentity[1] }
            : {}),
        },
      ];
    }),
  );
  const grossSplit = (gross, bps) => {
    const total = (gross * BigInt(bps)) / 10_000n;
    const launcher = (gross * 10n) / 10_000n;
    return { creator: total - launcher, launcher, total };
  };
  const netSplit = (net, bps) => {
    const denominator = 10_000n - BigInt(bps);
    const gross = (net * 10_000n + denominator - 1n) / denominator;
    const total = gross - net;
    const launcher = (gross * 10n) / 10_000n;
    return { creator: total - launcher, launcher, total, gross };
  };
  const buyExactInputFee = grossSplit(100_000_000_000_000n, 100);
  const buyExactOutputFee = netSplit(990_000_000n, 100);
  const sellExactInputFee = grossSplit(1_000_000_000n, 200);
  const sellExactOutputFee = netSplit(1_000_000_000n, 200);
  const swapRows = {
    buyExactInput: {
      side: "buy",
      exactness: "exact-input",
      poolAmount0: "-99000000000000",
      poolAmount1: "70000000000000000000000",
      grossNativeAmount: "100000000000000",
      inputBound: "100000000000000",
      outputBound: "69300000000000000000000",
      quotedAmount: "70000000000000000000000",
      fee: buyExactInputFee,
    },
    buyExactOutput: {
      side: "buy",
      exactness: "exact-output",
      poolAmount0: "-990000000",
      poolAmount1: "1000000000000000000",
      grossNativeAmount: buyExactOutputFee.gross.toString(),
      inputBound: "1010000000",
      outputBound: "1000000000000000000",
      quotedAmount: "1000000000",
      fee: buyExactOutputFee,
    },
    sellExactInput: {
      side: "sell",
      exactness: "exact-input",
      poolAmount0: "1000000000",
      poolAmount1: "-1000000000000000000",
      grossNativeAmount: "1000000000",
      inputBound: "1000000000000000000",
      outputBound: "970200000",
      quotedAmount: "980000000",
      fee: sellExactInputFee,
    },
    sellExactOutput: {
      side: "sell",
      exactness: "exact-output",
      poolAmount0: sellExactOutputFee.gross.toString(),
      poolAmount1: "-750000000000000000000",
      grossNativeAmount: sellExactOutputFee.gross.toString(),
      inputBound: "757500000000000000000",
      outputBound: "1000000000",
      quotedAmount: "750000000000000000000",
      fee: sellExactOutputFee,
    },
  };
  const swaps = Object.fromEntries(
    Object.entries(swapRows).map(([name, row]) => {
      const exactInput = row.exactness === "exact-input";
      return [
        name,
        {
          side: row.side,
          exactness: row.exactness,
          poolAmount0: row.poolAmount0,
          poolAmount1: row.poolAmount1,
          grossNativeAmount: row.grossNativeAmount,
          creatorFee: row.fee.creator.toString(),
          launcherFee: row.fee.launcher.toString(),
          totalFee: row.fee.total.toString(),
          appliedTotalSwapFeeBps: row.side === "buy" ? 100 : 200,
          inputBound: row.inputBound,
          outputBound: row.outputBound,
          routerDeadline: (BigInt(timestamps[name]) + 300n).toString(),
          executionPath: "single-hop-all",
          quote: {
            policy: canary.swapFixture.quotePolicy,
            function: `V4Quoter.${
              exactInput ? "quoteExactInputSingle" : "quoteExactOutputSingle"
            }`,
            blockNumber: actions[name].blockNumber - 1,
            blockHash: txHash(`quote-block:${name}`),
            exactAmount: exactInput
              ? canary.swapFixture[name].amountIn
              : canary.swapFixture[name].amountOut,
            quotedAmount: row.quotedAmount,
            gasEstimate: "100000",
            slippageBps: 100,
            bound: exactInput ? row.outputBound : row.inputBound,
          },
        },
      ];
    }),
  );
  actions.launch.inputHash = keccak256(expectedLifecycleLaunchCalldata(canary));
  for (const name of [
    "buyExactInput",
    "buyExactOutput",
    "sellExactInput",
    "sellExactOutput",
  ]) {
    actions[name].inputHash = keccak256(
      expectedLifecycleSwapCalldata(
        canary,
        canaryToken,
        swaps[name].side,
        swaps[name].exactness,
        swaps[name],
      ),
    );
  }
  actions.creatorClaim.inputHash = keccak256(
    encodeFunctionData({
      abi: parseAbi(["function claim() returns (uint256)"]),
      functionName: "claim",
    }),
  );
  actions.launcherClaim.inputHash = keccak256(
    encodeFunctionData({
      abi: parseAbi(["function claimLauncherFees() returns (uint256)"]),
      functionName: "claimLauncherFees",
    }),
  );
  const initialFee = grossSplit(
    BigInt(canary.launchFixture.initialBuyWei),
    100,
  );
  const creatorTotal =
    initialFee.creator +
    Object.values(swapRows).reduce((sum, row) => sum + row.fee.creator, 0n);
  const launcherTotal =
    initialFee.launcher +
    Object.values(swapRows).reduce((sum, row) => sum + row.fee.launcher, 0n);
  const hookSnapshot = (registered, creator, launcher) => ({
    rewardVault: registered ? rewardVault : zeroAddress,
    registrar: registered ? plan.predictedAddresses.launcher : zeroAddress,
    buySwapFeeBps: registered ? 100 : 0,
    sellSwapFeeBps: registered ? 200 : 0,
    registered,
    creatorFeesAccrued: creator.toString(),
    launcherFeesAccrued: launcher.toString(),
    totalNativeFeesAccrued: (creator + launcher).toString(),
    poolManagerNativeClaims: (creator + launcher).toString(),
    poolManagerTokenClaims: "0",
    rawNativeBalance: "0",
  });
  const vaultSnapshot = (amount) => ({
    totalCreatorFeesReceived: amount.toString(),
    totalCreatorFeesClaimed: amount.toString(),
    beneficiaryClaimed: amount.toString(),
    beneficiaryClaimable: "0",
    rawNativeBalance: "0",
  });
  return withDigest(
    {
      schemaVersion: 1,
      chainId: 1,
      planDigest: plan.planDigest,
      sourceCommitment: plan.sourceCommitment,
      status: "verified-current-release",
      checkedAt: "2026-08-30T10:10:00.000Z",
      independentRpcCount: 2,
      releaseEligible: true,
      canaryPlanDigest: canary.planDigest,
      launchAuthorization: canary.launchAuthorization,
      launchAuthorizationDigest: canary.launchAuthorizationDigest,
      releaseBindingDigest: releaseCandidate.releaseBindingDigest,
      deploymentEvidenceDigest: deployment.evidenceDigest,
      sourceEvidenceDigest: source.evidenceDigest,
      verificationBlock,
      verificationBlockHash: txHash("lifecycle-verification-block"),
      latestLifecycleBlock: actions.launcherClaim.blockNumber,
      confirmations: actions.launcherClaim.confirmations,
      operatorWallet,
      launcher: plan.predictedAddresses.launcher,
      feeHook: plan.predictedAddresses.feeHook,
      canaryToken,
      rewardVault,
      poolId: canaryPoolId,
      positionRecipient,
      positionTokenId: "42",
      actions,
      swaps,
      claims: {
        creator: {
          amount: creatorTotal.toString(),
          vaultCheckpointAmount: creatorTotal.toString(),
          beneficiaryAmount: creatorTotal.toString(),
        },
        launcher: { amount: launcherTotal.toString() },
      },
      postState: {
        launchMappings: {
          launchHash: txHash("launch-hash"),
          rewardVault,
          initialBuyCustody: zeroAddress,
        },
        poolFeeConfig: {
          rewardVault,
          registrar: plan.predictedAddresses.launcher,
          buySwapFeeBps: 100,
          sellSwapFeeBps: 200,
          registered: true,
          creatorFeesAccrued: "0",
        },
        rewardVault: {
          configurationHash: txHash("vault-config"),
          activeConfigurationHash: txHash("vault-active-config"),
          configurationEpoch: 1,
          beneficiary: operatorWallet,
          shareBps: 10_000,
        },
        positionLock: {
          owner: positionRecipient,
          approved: zeroAddress,
          tokenId: "42",
          positionLiquidity: "1000000",
          activePoolLiquidity: "1000000",
          tickLower: 174_800,
          tickUpper: 204_200,
          manager: plan.officialDependencies.positionManager.address,
          operator: zeroAddress,
          timelockBlockNumber: ((1n << 256n) - 1n).toString(),
          feeRecipient: operatorWallet,
          factoryConfigurationHash: txHash("forwarder-config"),
        },
        tokenCustody: {
          totalSupply: (1_000_000_000n * 10n ** 18n).toString(),
          lockedTokenDust: "1",
          launcherBalance: "0",
          positionManagerBalance: "0",
        },
        derivedCodeHashes: {
          token: txHash("token-code"),
          rewardVault: txHash("vault-code"),
          positionForwarder: txHash("forwarder-code"),
          rewardVaultPredeployed: false,
          positionForwarderPredeployed: false,
        },
      },
      feeConservation: {
        creatorAccrualTotal: creatorTotal.toString(),
        launcherAccrualTotal: launcherTotal.toString(),
        totalAccrual: (creatorTotal + launcherTotal).toString(),
        checkpoints: {
          preLaunch: {
            blockNumber: actions.launch.blockNumber - 1,
            hook: hookSnapshot(false, 0n, 0n),
          },
          beforeCreatorClaim: {
            blockNumber: actions.creatorClaim.blockNumber - 1,
            hook: hookSnapshot(true, creatorTotal, launcherTotal),
            vault: vaultSnapshot(0n),
          },
          afterCreatorClaim: {
            blockNumber: actions.creatorClaim.blockNumber,
            hook: hookSnapshot(true, 0n, launcherTotal),
            vault: vaultSnapshot(creatorTotal),
          },
          beforeLauncherClaim: {
            blockNumber: actions.launcherClaim.blockNumber - 1,
            hook: hookSnapshot(true, 0n, launcherTotal),
          },
          final: {
            blockNumber: verificationBlock,
            hook: hookSnapshot(true, 0n, 0n),
            vault: vaultSnapshot(creatorTotal),
          },
        },
      },
      observations: {
        exclusiveHookActivity: {
          fromBlock: actions.launch.blockNumber,
          toBlock: verificationBlock,
          nativeAccrualEvents: 5,
          creatorClaimEvents: 1,
          launcherClaimEvents: 1,
        },
        sellApprovals: Object.fromEntries(
          ["sellExactInput", "sellExactOutput"].map((name) => [
            name,
            {
              blockNumber: actions[name].blockNumber - 1,
              erc20AllowanceToPermit2: swaps[name].inputBound,
              permit2AllowanceToRouter: swaps[name].inputBound,
              permit2Expiration: (BigInt(timestamps[name]) + 1_000n).toString(),
              permit2Nonce: "1",
              requiredAmount: swaps[name].inputBound,
            },
          ]),
        ),
      },
      invariants: {
        launchVerified: true,
        positionLockVerified: true,
        buyExactInputVerified: true,
        buyExactOutputVerified: true,
        sellExactInputVerified: true,
        sellExactOutputVerified: true,
        creatorClaimVerified: true,
        launcherClaimVerified: true,
        feeConservationVerified: true,
      },
    },
    CLASSIC_V4_DIGEST_DOMAINS.lifecycleEvidence,
  );
}

function launcherArtifactFixture() {
  return {
    bytecode: { object: "0x60006000556001600055" },
    deployedBytecode: {
      object: "0x6001600055",
      immutableReferences: {},
    },
    metadata: JSON.stringify({
      compiler: { version: "0.8.26+commit.8a97fa7a" },
      settings: {
        optimizer: { enabled: true, runs: 1_000 },
        evmVersion: "cancun",
        metadata: { bytecodeHash: "none", appendCBOR: false },
      },
      sources: {
        "src/MemeLaunchV4.sol": { keccak256: HASH("launcher-source") },
        "lib/v4-core/src/interfaces/IPoolManager.sol": {
          keccak256: HASH("launcher-dependency"),
        },
      },
    }),
  };
}

function upgradeFixture() {
  const artifact = launcherArtifactFixture();
  const plan = buildClassicV4LauncherUpgradePlan({
    artifact,
    releaseCommit: COMMIT,
    releaseTree: TREE,
    repositoryClean: true,
    startingNonce: 351,
    observedAtBlock: BASE_DEPLOYMENT.verificationBlock + 1,
    observedAtBlockHash: HASH("upgrade-observed-block"),
    sourcePinsDigest: HASH("source-pins"),
    snapshot: {
      independentRpcCount: 2,
      freshDeterministicBuild: true,
      sourcePinsVerified: true,
      dependencyRuntimeVerified: true,
      dependencyBindingsVerified: true,
      canonicalRouterVerified: true,
      constructorSimulationVerified: true,
      predictedAddressVacant: true,
      deployerNonceReconciled: true,
      deployerBalanceVerified: true,
      estimatedGas: "1200000",
      reviewedGasLimit: "1500000",
      gasPriceWei: "20000000000",
      deployerBalanceWei: "100000000000000000",
      requiredBalanceWei: "30000000000000000",
    },
  });
  const transactionHash = HASH("upgrade-transaction");
  const blockNumber = BASE_DEPLOYMENT.verificationBlock + 2;
  const blockHash = HASH("upgrade-receipt-block");
  const transaction = {
    hash: transactionHash,
    from: plan.deployer,
    to: null,
    nonce: "0x15f",
    value: "0x0",
    gas: `0x${BigInt(plan.transaction.gasLimit).toString(16)}`,
    input: plan.transaction.data,
    blockNumber: "0x" + blockNumber.toString(16),
    blockHash,
  };
  const receipt = {
    status: "0x1",
    transactionHash,
    from: plan.deployer,
    to: null,
    contractAddress: plan.predictedAddress,
    blockNumber: transaction.blockNumber,
    blockHash,
    gasUsed: "0x124f80",
    effectiveGasPrice: "0x4a817c800",
  };
  const receiptEvidence = buildClassicV4LauncherUpgradeReceiptEvidence({
    plan,
    transactionHash,
    transaction,
    receipt,
  });
  const verificationEvidence =
    buildClassicV4LauncherUpgradeVerificationEvidence({
      plan,
      receiptEvidence,
      verificationBlock: blockNumber + 11,
      verificationBlockHash: HASH("upgrade-verification-block"),
      verificationTimestamp: Math.floor(
        Date.parse("2026-08-29T08:00:00.000Z") / 1_000,
      ),
      runtimeCode: artifact.deployedBytecode.object,
      artifact,
    });
  return { artifact, plan, receiptEvidence, verificationEvidence };
}

function parentBundleFixture() {
  const upgrade = upgradeFixture();
  const body = {
    schemaVersion: 1,
    base: {
      plan: structuredClone(BASE_PLAN),
      deploymentEvidence: structuredClone(BASE_DEPLOYMENT),
      sourceEvidence: structuredClone(BASE_SOURCE),
    },
    launcherUpgrade: {
      plan: upgrade.plan,
      receiptEvidence: upgrade.receiptEvidence,
      verificationEvidence: upgrade.verificationEvidence,
    },
  };
  return {
    bundle: {
      ...body,
      bundleDigest: digestJson(
        body,
        CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.parentBundle,
      ),
    },
    upgrade,
  };
}

function commonDeploymentFixture(plan) {
  const parents = plan.parentBundle;
  const base = parents.base.deploymentEvidence;
  const receipt = parents.launcherUpgrade.receiptEvidence;
  const finality = parents.launcherUpgrade.verificationEvidence;
  const contracts = Object.fromEntries(
    CLASSIC_V4_NEW_CONTRACTS.map((name) => {
      if (name !== "launcher") {
        const record = structuredClone(base.contracts[name]);
        record.confirmations =
          finality.verificationBlock - record.blockNumber + 1;
        return [name, record];
      }
      return [
        name,
        {
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          confirmations: finality.verificationBlock - receipt.blockNumber + 1,
          address: receipt.contractAddress,
          nonce: receipt.nonce,
          from: receipt.from,
          to: receipt.to,
          dataHash: receipt.dataHash,
          value: receipt.value,
          runtimeCodeHash: finality.runtimeCodeHash,
          runtimeTemplateHash: finality.runtimeTemplateHash,
        },
      ];
    }),
  );
  return withDigest(
    {
      schemaVersion: 1,
      chainId: 1,
      planDigest: plan.planDigest,
      sourceCommitment: plan.sourceCommitment,
      status: "finalized",
      checkedAt: finality.checkedAt,
      verificationBlock: finality.verificationBlock,
      verificationBlockHash: finality.verificationBlockHash,
      independentRpcCount: 2,
      deploymentLive: true,
      runtimeCodeVerified: true,
      constructorBindingsVerified: true,
      contracts,
    },
    CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence,
  );
}

function commonSourceFixture(plan, deployment) {
  const contracts = Object.fromEntries(
    CLASSIC_V4_NEW_CONTRACTS.map((name) => {
      if (name !== "launcher") {
        return [
          name,
          structuredClone(
            plan.parentBundle.base.sourceEvidence.contracts[name],
          ),
        ];
      }
      const target = CLASSIC_V4_LAUNCHER_ROLLFORWARD_SOURCE_TARGETS.launcher;
      return [
        name,
        {
          address: deployment.contracts.launcher.address,
          contractName: target.contractName,
          fqcn: target.fqcn,
          encodedConstructorArguments: plan.constructorArguments.launcher,
          deploymentTransaction: deployment.contracts.launcher.transactionHash,
          deploymentBlock: deployment.contracts.launcher.blockNumber,
          status: "match",
          providers: [
            {
              name: "Sourcify",
              status: "match",
              url:
                "https://sourcify.dev/server/v2/contract/1/" +
                deployment.contracts.launcher.address,
            },
          ],
        },
      ];
    }),
  );
  return withDigest(
    {
      schemaVersion: 1,
      chainId: 1,
      planDigest: plan.planDigest,
      sourceCommitment: plan.sourceCommitment,
      status: "verified",
      checkedAt: new Date(
        Date.parse(deployment.checkedAt) + 1_000,
      ).toISOString(),
      contracts,
    },
    CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
  );
}

function compositeFixture() {
  const { bundle, upgrade } = parentBundleFixture();
  const plan = createClassicV4LauncherRollforwardPlan({
    parentBundle: bundle,
  });
  const deployment = commonDeploymentFixture(plan);
  const source = commonSourceFixture(plan, deployment);
  return { bundle, upgrade, plan, deployment, source };
}

function redigest(value, domain) {
  const unsigned = structuredClone(value);
  delete unsigned.evidenceDigest;
  value.evidenceDigest = digestJson(unsigned, domain);
  return value;
}

function redigestAttackerPlan(
  plan,
  mutate = (basePlan) => {
    basePlan.releaseCommit = "3".repeat(40);
  },
) {
  const changed = structuredClone(plan);
  const parents = changed.parentBundle;
  mutate(parents.base.plan);
  const basePlan = structuredClone(parents.base.plan);
  delete basePlan.planDigest;
  parents.base.plan.planDigest = digestJson(
    basePlan,
    CLASSIC_V4_DIGEST_DOMAINS.preparationPlan,
  );
  parents.base.deploymentEvidence.planDigest = parents.base.plan.planDigest;
  redigest(
    parents.base.deploymentEvidence,
    CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence,
  );
  parents.base.sourceEvidence.planDigest = parents.base.plan.planDigest;
  redigest(
    parents.base.sourceEvidence,
    CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence,
  );
  const unsignedBundle = structuredClone(parents);
  delete unsignedBundle.bundleDigest;
  parents.bundleDigest = digestJson(
    unsignedBundle,
    CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.parentBundle,
  );
  changed.sourceCommitment = digestJson(
    {
      parentBundleDigest: parents.bundleDigest,
      releaseCommit: changed.releaseCommit,
      releaseTree: changed.releaseTree,
      predictedAddresses: changed.predictedAddresses,
      runtimeTemplates: changed.runtimeTemplates,
      constructorArguments: changed.constructorArguments,
      router: changed.router,
      sourceTargets: changed.sourceTargets,
    },
    CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.sourceCommitment,
  );
  const unsignedPlan = structuredClone(changed);
  delete unsignedPlan.planDigest;
  changed.planDigest = digestJson(
    unsignedPlan,
    CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.preparationPlan,
  );
  return changed;
}

function redigestUpgradeAttack(bundle, mutate) {
  const changed = structuredClone(bundle);
  const upgrade = changed.launcherUpgrade;
  mutate(changed);
  const unsignedPlan = structuredClone(upgrade.plan);
  delete unsignedPlan.planDigest;
  upgrade.plan.planDigest = digestJson(
    unsignedPlan,
    CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.preparationPlan,
  );
  upgrade.receiptEvidence.planDigest = upgrade.plan.planDigest;
  redigest(
    upgrade.receiptEvidence,
    CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.receiptEvidence,
  );
  upgrade.verificationEvidence.planDigest = upgrade.plan.planDigest;
  upgrade.verificationEvidence.receiptEvidenceDigest =
    upgrade.receiptEvidence.evidenceDigest;
  redigest(
    upgrade.verificationEvidence,
    CLASSIC_V4_LAUNCHER_UPGRADE_DIGEST_DOMAINS.verificationEvidence,
  );
  const unsignedBundle = structuredClone(changed);
  delete unsignedBundle.bundleDigest;
  changed.bundleDigest = digestJson(
    unsignedBundle,
    CLASSIC_V4_LAUNCHER_ROLLFORWARD_DIGEST_DOMAINS.parentBundle,
  );
  return changed;
}

test("creates a composite from canonical parents and fresh all-four evidence", () => {
  const fixture = compositeFixture();
  const composite = createClassicV4LauncherRollforward({
    parentBundle: fixture.bundle,
    commonHeadDeploymentEvidence: fixture.deployment,
    commonHeadSourceEvidence: fixture.source,
  });

  assert.deepEqual(composite.plan, fixture.plan);
  assert.equal(composite.deploymentEvidence, fixture.deployment);
  assert.equal(composite.sourceEvidence, fixture.source);
  assert.equal(
    composite.plan.predictedAddresses.launcher,
    fixture.upgrade.plan.predictedAddress,
  );
  assert.deepEqual(Object.keys(composite.plan.parentBundle).sort(), [
    "base",
    "bundleDigest",
    "launcherUpgrade",
    "schemaVersion",
  ]);
});

test("rejects a redigested composite whose embedded base lineage was forged", () => {
  const { plan } = compositeFixture();
  const attacked = redigestAttackerPlan(plan);
  assert.throws(
    () => validateClassicV4LauncherRollforwardPlan(attacked),
    /canonical deployed release/,
  );
});

test("rejects a redigested base preflight envelope drift", () => {
  const { plan } = compositeFixture();
  const attacked = redigestAttackerPlan(plan, (basePlan) => {
    basePlan.preflight.freshDeterministicBuild = false;
  });
  assert.throws(
    () => validateClassicV4LauncherRollforwardPlan(attacked),
    /canonical deployed release/,
  );
});

test("rejects a redigested upgrade transaction with forged CREATE ancestry", () => {
  const { bundle } = compositeFixture();
  const attacked = redigestUpgradeAttack(bundle, (changed) => {
    changed.launcherUpgrade.plan.transaction.predictedAddress =
      "0x0000000000000000000000000000000000000001";
  });
  assert.throws(
    () =>
      createClassicV4LauncherRollforwardPlan({
        parentBundle: attacked,
      }),
    /launcher upgrade parent differs/,
  );
});

test("requires the upgrade nonce and receipt block to follow all four base deployments", () => {
  const { bundle } = compositeFixture();
  const reusedNonce = redigestUpgradeAttack(bundle, (changed) => {
    const base = changed.base.plan;
    const upgrade = changed.launcherUpgrade;
    const nonce = base.transactions.at(-1).nonce;
    const address = getContractAddress({
      from: upgrade.plan.deployer,
      nonce: BigInt(nonce),
    });
    upgrade.plan.startingNonce = nonce;
    upgrade.plan.predictedAddress = address;
    upgrade.plan.transaction.nonce = nonce;
    upgrade.plan.transaction.predictedAddress = address;
    upgrade.receiptEvidence.nonce = nonce;
    upgrade.receiptEvidence.contractAddress = address;
    upgrade.verificationEvidence.contractAddress = address;
  });
  assert.throws(
    () => createClassicV4LauncherRollforwardPlan({ parentBundle: reusedNonce }),
    /launcher upgrade parent differs/,
  );

  const staleReceipt = redigestUpgradeAttack(bundle, (changed) => {
    const baseLauncher = changed.base.deploymentEvidence.contracts.launcher;
    const upgrade = changed.launcherUpgrade;
    upgrade.receiptEvidence.blockNumber = baseLauncher.blockNumber;
    upgrade.receiptEvidence.blockHash = baseLauncher.blockHash;
    upgrade.verificationEvidence.confirmations =
      upgrade.verificationEvidence.verificationBlock -
      baseLauncher.blockNumber +
      1;
  });
  assert.throws(
    () =>
      createClassicV4LauncherRollforwardPlan({ parentBundle: staleReceipt }),
    /launcher upgrade parent differs/,
  );
});

test("rejects a redigested zero-gas upgrade preflight envelope", () => {
  const { bundle } = compositeFixture();
  const attacked = redigestUpgradeAttack(bundle, (changed) => {
    const plan = changed.launcherUpgrade.plan;
    plan.preflight.estimatedGas = "0";
    plan.preflight.reviewedGasLimit = "0";
    plan.transaction.gasLimit = "0";
  });
  assert.throws(
    () => createClassicV4LauncherRollforwardPlan({ parentBundle: attacked }),
    /Invalid launcher estimated gas/,
  );
});

test("requires the exact upgrade finality block and hash for the common head", () => {
  const { plan, deployment } = compositeFixture();
  const later = structuredClone(deployment);
  later.verificationBlock += 1;
  later.verificationBlockHash = HASH("later-common-head");
  for (const contract of Object.values(later.contracts)) {
    contract.confirmations += 1;
  }
  redigest(later, CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence);
  assert.throws(
    () => validateClassicV4LauncherRollforwardDeploymentEvidence(plan, later),
    /fresh common-head replay/,
  );

  const wrongHash = structuredClone(deployment);
  wrongHash.verificationBlockHash = HASH("wrong-common-head");
  redigest(wrongHash, CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence);
  assert.throws(
    () =>
      validateClassicV4LauncherRollforwardDeploymentEvidence(plan, wrongHash),
    /fresh common-head replay/,
  );
});

test("rejects stale or drifted fresh evidence even after redigesting it", () => {
  const { plan, deployment, source } = compositeFixture();
  const stale = structuredClone(deployment);
  stale.checkedAt = plan.parentBundle.base.deploymentEvidence.checkedAt;
  redigest(stale, CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence);
  assert.throws(
    () => validateClassicV4LauncherRollforwardDeploymentEvidence(plan, stale),
    /fresh common-head replay/,
  );

  const drifted = structuredClone(deployment);
  drifted.contracts.positionPlanner.runtimeCodeHash = HASH("runtime-drift");
  redigest(drifted, CLASSIC_V4_DIGEST_DOMAINS.deploymentEvidence);
  assert.throws(
    () => validateClassicV4LauncherRollforwardDeploymentEvidence(plan, drifted),
    /fresh common-head replay/,
  );

  const projected = structuredClone(source);
  projected.contracts.launcher.contractName = "MemeLaunchV3";
  projected.contracts.launcher.fqcn = "src/MemeLaunchV3.sol:MemeLaunchV3";
  redigest(projected, CLASSIC_V4_DIGEST_DOMAINS.sourceEvidence);
  assert.throws(
    () =>
      validateClassicV4LauncherRollforwardSourceEvidence(
        plan,
        deployment,
        projected,
      ),
    /source identity differs/,
  );
});

test("artifact validation fails closed without the sealed base artifact context", () => {
  const { plan, upgrade } = compositeFixture();
  const mixed = {
    hookFactory: {},
    feeHook: {},
    positionPlanner: {},
    launcher: upgrade.artifact,
  };
  assert.throws(
    () => validateClassicV4LauncherRollforwardArtifacts(plan, mixed),
    /base artifacts keys differ/,
  );
});

test("creates a V1 manifest through the composite validator injection", () => {
  const { bundle, plan, deployment, source } = compositeFixture();
  const composite = createClassicV4LauncherRollforward({
    parentBundle: bundle,
    commonHeadDeploymentEvidence: deployment,
    commonHeadSourceEvidence: source,
  });
  const lifecycle = lifecycleEvidence(
    composite.plan,
    composite.deploymentEvidence,
    composite.sourceEvidence,
  );
  const manifest = createClassicV4LauncherRollforwardReleaseManifest({
    plan,
    deploymentEvidence: deployment,
    sourceEvidence: source,
    lifecycleEvidence: lifecycle,
    capturedAt: "2026-08-30T10:20:00.000Z",
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.internalContractRelease, "classic-v4");
  assert.equal(manifest.addresses.launcher, plan.predictedAddresses.launcher);
  assert.equal(
    manifest.lifecycleEvidence.evidenceDigest,
    lifecycle.evidenceDigest,
  );
});
