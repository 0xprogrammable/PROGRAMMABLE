import {
  OPEN_WORLD_V2_ARTIFACTS,
  OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS,
  OPEN_WORLD_V2_SUBMISSION_FILE,
  OPEN_WORLD_V2_SUPPORTING_ARTIFACTS,
  OPEN_WORLD_V2_FEE_NOT_APPLICABLE,
  PROGRAMMABLE_FEE_V2,
  architectureSnapshotSha256,
  createOpenWorldDraftPackage,
  sha256Bytes,
  validateOpenWorldV2Package
} from "../open-world-v2-core.mjs";
import { canonicalFeeConformanceReceiptBytesV1 } from "../fee-conformance-receipt-v1-core.mjs";
import { canonicalJson } from "../submission-core.mjs";
import { canonicalJsonSha256V2 } from "../canonical-json-core.mjs";
import { hashV4PoolKey } from "../evm-encoding-core.mjs";
import { createFeeConformanceFixtureV1 } from "./fee-conformance-v1-fixture.mjs";
import { createV4HookSemanticFixture } from "./v4-hook-semantic-fixture.mjs";

const builtin = (schemaId) => ({ kind: "builtin", schemaId, path: null, sha256: null, byteLength: null });
const jsonBytes = (value) => Buffer.from(`${canonicalJson(value)}\n`, "utf8");
const clone = (value) => structuredClone(value);
const hash = (byte) => `sha256:${byte.repeat(64)}`;
const bytes32 = (byte) => `0x${byte.repeat(64)}`;
const address = (byte) => `0x${byte.repeat(40)}`;

export const TRADE_TEST_QUOTE_CALLDATA_FIXTURE_V1 = "0x11223344";
export const TRADE_TEST_QUOTE_RETURN_DATA_FIXTURE_V1 = "0xaabbccdd";
export const TRADE_TEST_EXECUTION_CALLDATA_FIXTURE_V1 = "0x55667788";
const tradeTestRevertData = Object.freeze({
  "expired-deadline-revert": "0xdead0001",
  "slippage-bound-revert": "0xdead0002",
  "funding-requirement-revert": "0xdead0003",
  "unsupported-mode-pre-effects-revert": "0xdead0004"
});

export function tradeTestRevertDataFixtureV1(scenario) {
  return tradeTestRevertData[scenario] ?? null;
}

export function createStandardTradePoolKeyFixtureV1() {
  const poolKey = {
    currency0: address("0"),
    currency1: address("1"),
    fee: 3000,
    tickSpacing: 60,
    hooks: address("3")
  };
  return { ...poolKey, poolId: hashV4PoolKey(poolKey) };
}

export function createStandardTradeCapabilityManifestFixtureV1({
  applicationId,
  marketRef,
  chainId = "1",
  poolId = createStandardTradePoolKeyFixtureV1().poolId,
  testSourceArtifact = {
    path: "test/TradeCapabilityRoute.t.sol",
    sha256: hash("7"),
    byteLength: 4096
  },
  feeReceipt = {
    artifactId: "fee-conformance-main-market",
    path: "evidence/fee-conformance-main-market.receipt.v1.json",
    sha256: hash("a"),
    feeScopeId: "main-market-scope",
    quoteCurrency: address("0"),
    collectionProfile: "standard-amm"
  }
} = {}) {
  const router = address("4");
  const quoter = address("5");
  const permit2 = address("6");
  const modes = [
    ["zero-for-one-exact-input", "zero-for-one", "exact-input", "native-input"],
    ["zero-for-one-exact-output", "zero-for-one", "exact-output", "native-input"],
    ["one-for-zero-exact-input", "one-for-zero", "exact-input", "erc20-input"],
    ["one-for-zero-exact-output", "one-for-zero", "exact-output", "erc20-input"]
  ];
  const runner = (kind, id) => {
    const runnerTestSignature = `test_${kind}_${id.replaceAll("-", "_")}()`;
    return {
      runnerContract: "forge-test-json-v1",
      runnerTestSignature,
      command: {
        argv: [
          "forge", "test", "--offline", "--json", "-vvvv",
          "--match-path", testSourceArtifact.path,
          "--match-test", `^${runnerTestSignature.replace("()", "\\(\\)")}$`
        ],
        workingDirectory: ".",
        environmentSha256: hash("8")
      }
    };
  };
  const quoteResultBindings = [
    "manifest-sha256",
    "pool-key",
    "hook-data",
    "direction-and-amount-mode",
    "sender-and-recipient",
    "chain-and-block",
    "quoter-or-adapter",
    "slippage",
    "fee-conformance",
    "quoted-amount"
  ];
  const executionResultBindings = [
    "manifest-sha256",
    "pool-key",
    "hook-data",
    "direction-and-amount-mode",
    "sender-and-recipient",
    "chain-and-block",
    "router-or-adapter-generation",
    "funding",
    "deadline",
    "slippage",
    "fee-conformance",
    "action-and-calldata",
    "receipt",
    "pool-manager-final-deltas",
    "wallet-final-balances",
    "refund-and-dust"
  ];
  const quoteTests = modes.map(([modeRef]) => ({
    id: `quote-${modeRef}`,
    commandId: `quote-${modeRef}`,
    modeRef,
    chainId,
    environment: "local-v4-integration",
    targetAddress: quoter,
    ...runner("quote", modeRef),
    testSourceArtifact: clone(testSourceArtifact),
    resultArtifactPath: `evidence/trade/${modeRef}.quote-result.v1.json`,
    resultContract: "trade-quote-test-result-v1",
    expectedOutcome: "quote-succeeds",
    resultBindings: [...quoteResultBindings]
  }));
  const executionTests = modes.map(([modeRef]) => ({
    id: `execute-${modeRef}`,
    commandId: `execute-${modeRef}`,
    modeRef,
    chainId,
    scenario: "successful-swap",
    environment: "local-v4-integration",
    targetAddress: router,
    ...runner("execute", modeRef),
    testSourceArtifact: clone(testSourceArtifact),
    resultArtifactPath: `evidence/trade/${modeRef}.execution-result.v1.json`,
    resultContract: "trade-execution-test-result-v1",
    expectedOutcome: "swap-succeeds",
    expectedRevertDataSha256: null,
    resultBindings: [...executionResultBindings]
  }));
  const expectedRevertDataSha256 = Object.fromEntries(Object.entries(tradeTestRevertData).map(([scenario, revertData]) => [
    scenario,
    sha256Bytes(Buffer.from(revertData.slice(2), "hex"))
  ]));
  for (const [scenario, modeRef] of [
    ["expired-deadline-revert", modes[0][0]],
    ["slippage-bound-revert", modes[1][0]],
    ["funding-requirement-revert", modes[2][0]]
  ]) executionTests.push({
    id: scenario,
    commandId: scenario,
    modeRef,
    chainId,
    scenario,
    environment: "local-v4-integration",
    targetAddress: router,
    ...runner("reject", scenario),
    testSourceArtifact: clone(testSourceArtifact),
    resultArtifactPath: `evidence/trade/${scenario}.execution-result.v1.json`,
    resultContract: "trade-execution-test-result-v1",
    expectedOutcome: "reverts-before-effects",
    expectedRevertDataSha256: expectedRevertDataSha256[scenario],
    resultBindings: [...executionResultBindings]
  });

  return {
    $schema: "urn:programmable:trade-capability-manifest:1.0.0",
    schemaVersion: "1.0.0",
    contract: { id: "trade-capability-manifest-v1", version: "1.0.0" },
    manifestId: "main-market-trade-capability",
    applicationId,
    marketRef,
    status: "NOT_APPROVED",
    assurance: "SOURCE_TEST_CONTRACTS_ONLY_NOT_EXECUTION_PROOF",
    chain: {
      chainId,
      networkRef: "ethereum-mainnet",
      deploymentProfileSha256: hash("1"),
      referenceBlock: { number: "1", hash: bytes32("2"), timestamp: "1" }
    },
    source: {
      repositoryUri: "https://github.com/example/open-world-project",
      identityKind: "content-addressed-route-implementation-closure",
      routeImplementationPath: "src/TradeCapabilityRoute.sol",
      routeImplementationSha256: hash("2"),
      routeImplementationClosurePath: "evidence/trade/route-implementation-closure.v1.json",
      routeImplementationClosureSha256: hash("3")
    },
    dependencies: {
      lockfilePath: "foundry.lock",
      lockfileSha256: hash("4"),
      entries: [
        ["v4-core", "v4-core"],
        ["v4-periphery", "v4-periphery"],
        ["universal-router", "universal-router"],
        ["v4-quoter", "v4-quoter"],
        ["permit2", "permit2"],
        ["trade-integration", "trade-integration"]
      ].map(([id, role], index) => ({
        id,
        role,
        sourceUri: `https://github.com/example/${id}`,
        resolvedIdentity: `fixture-${id}-revision`,
        contentSha256: hash(String(index + 1))
      }))
    },
    poolKey: { ...createStandardTradePoolKeyFixtureV1(), poolId },
    route: {
      type: "standard-uniswap-v4",
      routeShape: "single-pool",
      generationIdentitySha256: hash("5"),
      interface: { id: "uniswap-v4-universal-router", version: "2.2.0", abiSha256: hash("6") },
      router: { address: router, runtimeCodeKeccak256: bytes32("4"), sourceDependencyRef: "universal-router", deploymentEvidenceRef: "evidence/deployments/universal-router.json" },
      quoter: { address: quoter, runtimeCodeKeccak256: bytes32("5"), sourceDependencyRef: "v4-quoter", deploymentEvidenceRef: "evidence/deployments/v4-quoter.json" },
      fundingProfiles: [
        {
          id: "native-input",
          type: "native-value",
          owner: "transaction-sender",
          token: "pool-input-currency",
          amount: "msg-value",
          nonce: "not-applicable",
          expiration: "not-applicable",
          signatureDeadline: "not-applicable",
          recipient: "router",
          permit2: { mode: "not-used", reason: "Native currency input is funded with transaction value." }
        },
        {
          id: "erc20-input",
          type: "permit2-allowance-transfer",
          owner: "transaction-sender",
          token: "pool-input-currency",
          amount: "exact-input-or-maximum-input",
          nonce: "permit2-allowance",
          expiration: "permit2-allowance",
          signatureDeadline: "execution-deadline-or-earlier",
          recipient: "router",
          permit2: {
            mode: "used",
            address: permit2,
            runtimeCodeKeccak256: bytes32("6"),
            sourceDependencyRef: "permit2",
            deploymentEvidenceRef: "evidence/deployments/permit2.json",
            erc20Input: "REQUIRED",
            nativeInput: "NOT_REQUIRED",
            approvalTarget: "PERMIT2",
            spender: router,
            mechanism: "allowance-transfer"
          }
        }
      ],
      hookData: {
        mode: "bound",
        contractId: "empty-hook-data",
        contractVersion: "1.0.0",
        contractSha256: hash("9"),
        consumer: "hook",
        encoding: "empty-bytes",
        solidityType: "bytes",
        required: false,
        maximumBytes: 0,
        example: "0x"
      }
    },
    capabilities: {
      modeMatrix: modes.map(([id, direction, amountMode, fundingProfileRef]) => ({
        id,
        direction,
        amountMode,
        support: "supported",
        fundingProfileRef,
        quoteEntrypoint: amountMode === "exact-input" ? "V4Quoter.quoteExactInputSingle" : "V4Quoter.quoteExactOutputSingle",
        executionEntrypoint: "UniversalRouter.execute"
      }))
    },
    slippage: {
      unit: "basis-points",
      minimumBps: 0,
      defaultBps: 50,
      maximumBps: 500,
      exactInputGuard: "amountOutMinimum",
      exactOutputGuard: "amountInMaximum",
      enforcement: "calldata-and-test-bound"
    },
    deadline: { required: true, unit: "seconds", maximumWindowSeconds: 1800, enforcement: "execution-calldata" },
    feeBehavior: {
      quoteAmounts: "include-all-declared-route-fees",
      exactInput: "minimum-output-after-declared-fees",
      exactOutput: "maximum-input-including-declared-fees",
      rounding: "route-defined-and-tested",
      programmableFeeV2: {
        applicability: "applicable",
        policyId: "programmable-volume-fee-v2",
        policyVersion: "2.0.0",
        policyHash: "0x03cd386824b1c0aa152200e0a470aa0c885f802e257f0f46066de508d241811e",
        rateDenominator: 1000000,
        minimumPlatformRateHundredthsOfBip: 1000,
        minimumGrossQuoteUnits: 1000,
        immutableOwner: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
        executedGrossQuoteCharge: true,
        conservation: "gross-equals-net-plus-platform-plus-project",
        receiptArtifactId: feeReceipt.artifactId,
        receiptPath: feeReceipt.path,
        receiptSha256: feeReceipt.sha256,
        feeScopeId: feeReceipt.feeScopeId,
        chainId,
        poolId,
        quoteCurrency: feeReceipt.quoteCurrency,
        collectionProfile: feeReceipt.collectionProfile
      },
      components: [
        {
          id: "v4-lp-fee",
          kind: "v4-lp",
          chargedOn: "pool-accounting",
          currencyRole: "input-currency",
          routeDefinedCurrency: null,
          chargeBase: "input-amount",
          calculation: "fixed-pips",
          ratePips: 3000,
          maximumBps: 100,
          quoteInclusion: "included",
          recipientBehavior: "lp-provider",
          policySha256: hash("b")
        },
        {
          id: "programmable-fee-v2-hook-charge",
          kind: "hook",
          chargedOn: "route-defined",
          currencyRole: "programmable-quote-currency",
          routeDefinedCurrency: null,
          chargeBase: "executed-gross-quote",
          calculation: "dynamic",
          ratePips: null,
          maximumBps: 20,
          quoteInclusion: "included",
          recipientBehavior: "hook-defined",
          policySha256: hash("c")
        }
      ]
    },
    testEvidence: { contract: "source-test-contracts-v1", semanticAdequacy: "PARTIAL_EVIDENCE", quoteTests, executionTests }
  };
}

export function createTradeTestResultFixturesV1(manifest) {
  const modeById = new Map(manifest.capabilities.modeMatrix.map((mode) => [mode.id, mode]));
  const sender = address("7");
  const recipient = address("8");
  const contextFor = (test) => {
    const mode = modeById.get(test.modeRef);
    const adapter = manifest.route.type === "canonical-programmable-adapter";
    const inputCurrency = mode.direction === "zero-for-one" ? manifest.poolKey.currency0 : manifest.poolKey.currency1;
    const outputCurrency = mode.direction === "zero-for-one" ? manifest.poolKey.currency1 : manifest.poolKey.currency0;
    const amountQuoted = mode.amountMode === "exact-input" ? 1980n : 2020n;
    const amountSpecified = 2000n;
    const amountIn = mode.amountMode === "exact-input" ? amountSpecified : amountQuoted;
    const amountOut = mode.amountMode === "exact-input" ? amountQuoted : amountSpecified;
    const quoteCurrency = manifest.feeBehavior.programmableFeeV2.quoteCurrency;
    const feeComponents = manifest.feeBehavior.components.map((component) => {
      const currency = component.currencyRole === "input-currency"
        ? inputCurrency
        : component.currencyRole === "output-currency"
          ? outputCurrency
          : component.currencyRole === "programmable-quote-currency"
            ? quoteCurrency
            : component.routeDefinedCurrency;
      let baseAmount = component.chargeBase === "input-amount"
        ? amountIn
        : component.chargeBase === "output-amount"
          ? amountOut
          : component.chargeBase === "executed-gross-quote"
            ? (currency === inputCurrency ? amountIn : amountOut)
            : amountIn;
      let amount = component.calculation === "fixed-pips"
        ? (baseAmount * BigInt(component.ratePips) + 999_999n) / 1_000_000n
        : component.kind === "hook"
          ? (baseAmount * 1000n + 999_999n) / 1_000_000n
          : 0n;
      if (component.kind === "hook" && component.chargeBase === "executed-gross-quote" && currency === outputCurrency) {
        for (let index = 0; index < 4; index += 1) {
          amount = (baseAmount * 1000n + 999_999n) / 1_000_000n;
          baseAmount = amountOut + amount;
        }
      }
      return {
        componentRef: component.id,
        currency,
        chargeBase: component.chargeBase,
        baseAmount: baseAmount.toString(),
        amount: amount.toString()
      };
    });
    const totals = new Map();
    for (const component of feeComponents) {
      totals.set(component.currency, (totals.get(component.currency) ?? 0n) + BigInt(component.amount));
    }
    const feeAmounts = {
      components: feeComponents,
      totalsByCurrency: [...totals]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, amount]) => ({ currency, amount: amount.toString() }))
    };
    return {
      manifestSha256: canonicalJsonSha256V2(manifest),
      sourceTestSha256: test.testSourceArtifact.sha256,
      mode: {
        id: mode.id,
        direction: mode.direction,
        amountMode: mode.amountMode,
        fundingProfileRef: mode.fundingProfileRef
      },
      chain: {
        chainId: manifest.chain.chainId,
        blockNumber: manifest.chain.referenceBlock.number,
        blockHash: manifest.chain.referenceBlock.hash,
        blockTimestamp: manifest.chain.referenceBlock.timestamp
      },
      poolKey: clone(manifest.poolKey),
      poolKeySha256: canonicalJsonSha256V2(manifest.poolKey),
      route: {
        type: manifest.route.type,
        quoteTarget: adapter ? manifest.route.adapter.address : manifest.route.quoter.address,
        executionTarget: manifest.route.router.address,
        quoteTargetRuntimeCodeKeccak256: adapter
          ? manifest.route.adapter.runtimeCodeKeccak256
          : manifest.route.quoter.runtimeCodeKeccak256,
        executionTargetRuntimeCodeKeccak256: manifest.route.router.runtimeCodeKeccak256,
        generationIdentitySha256: manifest.route.generationIdentitySha256,
        adapterInterfaceSchemaSha256: adapter ? manifest.route.canonicalInterface.schemaSha256 : null
      },
      hookData: {
        mode: manifest.route.hookData.mode,
        contractSha256: manifest.route.hookData.contractSha256,
        encoding: manifest.route.hookData.encoding,
        valueSha256: sha256Bytes(Buffer.from(manifest.route.hookData.example.slice(2), "hex"))
      },
      limits: {
        slippageBps: manifest.slippage.defaultBps,
        deadline: test.scenario === "expired-deadline-revert" ? "1" : "2"
      },
      fee: {
        feeBehaviorSha256: canonicalJsonSha256V2(manifest.feeBehavior),
        programmableFeeApplicability: manifest.feeBehavior.programmableFeeV2.applicability,
        feeConformanceReceiptSha256: manifest.feeBehavior.programmableFeeV2.receiptSha256 ?? null,
        amounts: feeAmounts,
        quotedFeesSha256: canonicalJsonSha256V2(feeAmounts)
      },
      request: { sender, recipient, amountSpecified: amountSpecified.toString(), fundingProfileRef: mode.fundingProfileRef }
    };
  };
  const baseCallBinding = (context, entrypoint, target, calldataSha256) => ({
    target,
    entrypoint,
    poolKeySha256: context.poolKeySha256,
    direction: context.mode.direction,
    amountMode: context.mode.amountMode,
    amountSpecified: context.request.amountSpecified,
    hookDataSha256: context.hookData.valueSha256,
    slippageBps: context.limits.slippageBps,
    deadline: context.limits.deadline,
    fundingProfileRef: context.request.fundingProfileRef,
    feeBehaviorSha256: context.fee.feeBehaviorSha256,
    calldataSha256,
    reencodedCalldataSha256: calldataSha256
  });
  const seal = (value) => ({ ...value, contentSha256: canonicalJsonSha256V2(value) });
  const results = new Map();
  for (const test of manifest.testEvidence.quoteTests) {
    const mode = modeById.get(test.modeRef);
    const context = contextFor(test);
    const callDataSha256 = sha256Bytes(Buffer.from(TRADE_TEST_QUOTE_CALLDATA_FIXTURE_V1.slice(2), "hex"));
    const result = seal({
      $schema: "urn:programmable:trade-quote-test-result:1.0.0",
      schemaVersion: "1.0.0",
      contract: "trade-quote-test-result-v1",
      status: "LOCAL_EVIDENCE_NOT_APPROVAL",
      digestContract: "sha256-canonical-json-with-contentSha256-omitted",
      identity: { applicationId: manifest.applicationId, marketRef: manifest.marketRef, testId: test.id, commandId: test.commandId },
      context,
      observation: {
        callKind: "eth-call",
        callSucceeded: true,
        amountQuoted: mode.amountMode === "exact-input" ? "1980" : "2020",
        callDataSha256,
        returnDataSha256: sha256Bytes(Buffer.from(TRADE_TEST_QUOTE_RETURN_DATA_FIXTURE_V1.slice(2), "hex")),
        callBinding: baseCallBinding(context, mode.quoteEntrypoint, context.route.quoteTarget, callDataSha256),
        stateBeforeSha256: hash("5"),
        stateAfterSha256: hash("5"),
        approvalChanged: false,
        walletBalancesChanged: false,
        applicationStateChanged: false,
        finalPoolManagerDeltas: [
          { currency: manifest.poolKey.currency0, delta: "0" },
          { currency: manifest.poolKey.currency1, delta: "0" }
        ]
      }
    });
    results.set(test.resultArtifactPath, result);
  }
  for (const test of manifest.testEvidence.executionTests) {
    const reverted = test.expectedOutcome === "reverts-before-effects";
    const mode = modeById.get(test.modeRef);
    const inputCurrency = mode.direction === "zero-for-one" ? manifest.poolKey.currency0 : manifest.poolKey.currency1;
    const outputCurrency = mode.direction === "zero-for-one" ? manifest.poolKey.currency1 : manifest.poolKey.currency0;
    const amountIn = mode.amountMode === "exact-input" ? "2000" : "2020";
    const amountOut = mode.amountMode === "exact-input" ? "1980" : "2000";
    const context = contextFor(test);
    const actionPlanSha256 = hash("2");
    const calldataSha256 = sha256Bytes(Buffer.from(TRADE_TEST_EXECUTION_CALLDATA_FIXTURE_V1.slice(2), "hex"));
    const fundingWitnessSha256 = hash("4");
    const slippageGuardAmount = reverted ? "0" : mode.amountMode === "exact-input" ? "1970" : "2031";
    const adapterExecution = manifest.route.type === "canonical-programmable-adapter"
      ? (() => {
          const standardTransport = manifest.route.transport?.type === "uniswap-v4-universal-router";
          const returnedValue = standardTransport && inputCurrency === address("0")
            ? mode.amountMode === "exact-input"
              ? context.request.amountSpecified
              : slippageGuardAmount
            : "0";
          const returnedEnvelope = {
            target: manifest.route.router.address,
            value: returnedValue,
            calldataSha256,
            deadline: context.limits.deadline
          };
          return {
            buildTarget: manifest.route.adapter.address,
            buildEntrypoint: "buildExecution(bytes)",
            buildCallDataSha256: hash("6"),
            buildReturnDataSha256: hash("7"),
            returnedTarget: returnedEnvelope.target,
            returnedValue: returnedEnvelope.value,
            returnedCalldataSha256: returnedEnvelope.calldataSha256,
            returnedDeadline: returnedEnvelope.deadline,
            returnedEnvelopeDigestContract: "sha256-canonical-json-target-value-calldataSha256-deadline",
            returnedEnvelopeSha256: canonicalJsonSha256V2(returnedEnvelope)
          };
        })()
      : null;
    const callBinding = {
      ...baseCallBinding(context, mode.executionEntrypoint, context.route.executionTarget, calldataSha256),
      slippageGuardAmount,
      actionPlanSha256,
      fundingWitnessSha256,
      adapterExecution
    };
    const stateWitness = {
      approvalBeforeSha256: hash("a"),
      approvalAfterSha256: hash("a"),
      fundingBeforeSha256: hash("b"),
      fundingAfterSha256: hash("b"),
      walletBeforeSha256: hash("c"),
      walletAfterSha256: reverted ? hash("c") : hash("d"),
      lockBeforeSha256: hash("e"),
      lockAfterSha256: hash("e"),
      applicationBeforeSha256: hash("f"),
      applicationAfterSha256: hash("f")
    };
    const result = seal({
      $schema: "urn:programmable:trade-execution-test-result:1.0.0",
      schemaVersion: "1.0.0",
      contract: "trade-execution-test-result-v1",
      status: "LOCAL_EVIDENCE_NOT_APPROVAL",
      digestContract: "sha256-canonical-json-with-contentSha256-omitted",
      identity: { applicationId: manifest.applicationId, marketRef: manifest.marketRef, testId: test.id, commandId: test.commandId },
      scenario: test.scenario,
      outcome: reverted ? "reverted-before-effects" : "swap-succeeded",
      context,
      observation: {
        executionKind: "foundry-call",
        executionDigestSha256: hash("1"),
        actionPlanSha256,
        calldataSha256,
        fundingWitnessSha256,
        callBinding,
        stateWitness,
        transactionHash: null,
        receiptStatus: reverted ? "reverted-as-specified" : "success",
        gasUsed: "100000",
        amountIn: reverted ? "0" : amountIn,
        amountOut: reverted ? "0" : amountOut,
        slippageGuardAmount,
        executedFeesSha256: context.fee.quotedFeesSha256,
        finalPoolManagerDeltas: [
          { currency: manifest.poolKey.currency0, delta: "0" },
          { currency: manifest.poolKey.currency1, delta: "0" }
        ],
        walletBalances: [
          { account: sender, currency: inputCurrency, before: amountIn, after: reverted ? amountIn : "0" },
          { account: recipient, currency: outputCurrency, before: "0", after: reverted ? "0" : amountOut }
        ],
        refundAmount: !reverted && inputCurrency === address("0") && mode.amountMode === "exact-output"
          ? (2031n - BigInt(amountIn)).toString()
          : "0",
        dustAmount: "0",
        approvalChanged: false,
        fundsChangedBeforeExecution: false,
        lockStateChanged: false,
        applicationStateChanged: false,
        revertDataSha256: test.expectedRevertDataSha256
      }
    });
    results.set(test.resultArtifactPath, result);
  }
  return results;
}

export function createApplicableOpenWorldV2PrototypeFixture(applicationId) {
  const pkg = makeMultiGraphPackage(applicationId);
  const feeBundle = bindTypedFeeConformance(pkg, applicationId);
  bindTradeCapabilityManifest(pkg, feeBundle);
  pkg.submission.stage = "prototype";
  const openProfile = clone(pkg.submission.hooks[1].profileSchema);
  pkg.submission.targets = [{
    id: "prototype-runtime",
    kind: "prototype-runtime",
    profileSchema: clone(openProfile),
    profile: { description: "Runs the confirmed canonical prototype." }
  }];
  pkg.submission.implementation = {
    sourcePaths: ["src/prototype.mjs"],
    testPaths: ["test/prototype.test.mjs"],
    evidenceRefs: []
  };
  const intent = pkg.records.intentContract.value;
  intent.status = "builder-confirmed";
  intent.route = {
    id: "CUSTOM_ARCHITECTURE",
    reasons: [{ language: "en", text: "The builder confirmed this custom canonical architecture." }],
    blockedByRefs: []
  };
  intent.facts[0].kind = "confirmed-prototype";
  intent.facts[0].state = "confirmed";
  intent.facts[0].semanticPayload = { description: "Confirmed canonical prototype behavior." };
  intent.facts[0].payloadSchema = clone(openProfile);
  intent.confirmation = {
    state: "builder-confirmed",
    ideaEntryId: "original-idea",
    confirmedFactIds: [intent.facts[0].id],
    delegatedDefaultFactIds: []
  };
  const fidelity = pkg.records.intentFidelity.value;
  fidelity.overallStatus = "preserved";
  fidelity.traces[0] = {
    ...fidelity.traces[0],
    status: "preserved",
    architectureRefs: [{ collection: "components", id: "pricing-engine" }],
    implementationRefs: ["src/prototype.mjs"],
    testRefs: ["test/prototype.test.mjs"],
    difference: null
  };
  pkg.submission.supportingPackage.securityAssessment = null;
  delete pkg.supportingRecords.securityAssessment;
  rebindPackage(pkg);
  const report = validateOpenWorldV2Package({
    submission: pkg.submission,
    submissionBytes: pkg.submissionBytes,
    records: pkg.records,
    supportingRecords: pkg.supportingRecords,
    extensionSchemaBytes: pkg.extensionSchemaBytes
  });
  if (report.valid !== true) {
    throw new Error(`canonical applicable V2 fixture is invalid: ${JSON.stringify(report.findings)}`);
  }
  return freezePrototypePackage(pkg, "applicable");
}

export function createNoMarketOpenWorldV2PrototypeFixture(applicationId) {
  const pkg = unpackDraft(applicationId, "Build a standalone reward service without a token, market, pool, hook, or fee-bearing execution scope.");
  const extensionSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:test:standalone-reward-service-profile:1.0.0",
    type: "object",
    additionalProperties: false,
    required: ["description"],
    properties: { description: { type: "string", minLength: 1 } }
  };
  const extensionBytes = jsonBytes(extensionSchema);
  const extensionPath = "schemas/standalone-reward-service-profile.schema.json";
  const repositoryProfile = {
    kind: "repository",
    schemaId: extensionSchema.$id,
    path: extensionPath,
    sha256: sha256Bytes(extensionBytes),
    byteLength: extensionBytes.length
  };
  pkg.extensionSchemaBytes[extensionPath] = extensionBytes;
  pkg.submission.stage = "prototype";
  pkg.submission.tradeCapability = { applicability: "no-market", facetEntryRef: "trade-capability-not-applicable", markets: [] };
  pkg.submission.project.summary = { language: "en", text: "A standalone reward service with no market or fee-bearing execution scope." };
  pkg.submission.targets = [{ id: "service-runtime", kind: "offchain-service-runtime", profileSchema: clone(repositoryProfile), profile: { description: "Runs the standalone reward service." } }];
  pkg.submission.components = [{ id: "reward-service", kind: "standalone-reward-service", profileSchema: clone(repositoryProfile), profile: { description: "Records rewards and lets users exit safely." }, implementationRefs: ["src/app.mjs"], authorityRefs: [] }];
  pkg.submission.implementation = { sourcePaths: ["src/app.mjs"], testPaths: ["test/app.test.mjs"], evidenceRefs: [] };

  const intent = pkg.records.intentContract.value;
  intent.status = "builder-confirmed";
  intent.route = { id: "CUSTOM_ARCHITECTURE", reasons: [{ language: "en", text: "The confirmed product is an offchain service with no market." }], blockedByRefs: [] };
  intent.facts[0].kind = "standalone-service";
  intent.facts[0].state = "confirmed";
  intent.facts[0].semanticPayload = { description: "Standalone reward service only; no token, market, pool, hook, or fee-bearing scope." };
  intent.facts[0].payloadSchema = clone(repositoryProfile);
  intent.confirmation = { state: "builder-confirmed", ideaEntryId: "original-idea", confirmedFactIds: [intent.facts[0].id], delegatedDefaultFactIds: [] };
  const fidelity = pkg.records.intentFidelity.value;
  fidelity.overallStatus = "preserved";
  fidelity.traces[0] = { ...fidelity.traces[0], status: "preserved", architectureRefs: [{ collection: "components", id: "reward-service" }], implementationRefs: ["src/app.mjs"], testRefs: ["test/app.test.mjs"], difference: null };
  pkg.submission.supportingPackage.securityAssessment = null;
  delete pkg.supportingRecords.securityAssessment;
  pkg.submission.programmableFee.feeScopes = [];
  pkg.submission.programmableFee.executionScopeRefs = [];
  pkg.submission.programmableFee.collectionProfileSchema = builtin(OPEN_WORLD_V2_FEE_NOT_APPLICABLE.collectionProfileSchemaId);
  pkg.submission.programmableFee.collectionProfile = clone(OPEN_WORLD_V2_FEE_NOT_APPLICABLE.collectionProfile);
  pkg.submission.programmableFee.conformance = { status: "not-applicable", evidenceRefs: [], evidenceDigests: [], scopeArtifacts: [] };
  pkg.submission.supportingPackage.feePolicy = null;
  delete pkg.supportingRecords.feePolicy;
  rebindPackage(pkg);
  const report = validateOpenWorldV2Package({ submission: pkg.submission, submissionBytes: pkg.submissionBytes, records: pkg.records, supportingRecords: pkg.supportingRecords, extensionSchemaBytes: pkg.extensionSchemaBytes });
  if (report.valid !== true) throw new Error(`canonical no-market V2 fixture is invalid: ${JSON.stringify(report.findings)}`);
  return freezePrototypePackage(pkg, "not-applicable");
}

function unpackDraft(applicationId, publicIdeaText = "Build an exact canonical onchain game with fee-bearing execution.") {
  const draft = createOpenWorldDraftPackage({
    applicationId,
    publicIdeaText,
    sourceRef: "test-message"
  });
  if (draft.materializationAllowed !== true) throw new Error("failed to create V2 fixture draft");
  const files = Object.fromEntries(draft.files.map((file) => [file.path, JSON.parse(file.content)]));
  return {
    submission: files[OPEN_WORLD_V2_SUBMISSION_FILE],
    records: Object.fromEntries(Object.entries(OPEN_WORLD_V2_ARTIFACTS).map(([key, spec]) => [key, {
      value: files[spec.file],
      bytes: jsonBytes(files[spec.file])
    }])),
    supportingRecords: Object.fromEntries(Object.entries(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS).map(([key, spec]) => [key, {
      value: files[spec.file],
      bytes: jsonBytes(files[spec.file])
    }])),
    extensionSchemaBytes: {}
  };
}

function makeMultiGraphPackage(applicationId) {
  const pkg = unpackDraft(applicationId);
  const extensionSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:test:open-world-profile:1.0.0",
    type: "object",
    additionalProperties: false,
    required: ["description"],
    properties: { description: { type: "string", minLength: 1 } }
  };
  const extensionBytes = jsonBytes(extensionSchema);
  const extensionPath = "schemas/open-world-profile.schema.json";
  const repositoryProfile = {
    kind: "repository",
    schemaId: extensionSchema.$id,
    path: extensionPath,
    sha256: sha256Bytes(extensionBytes),
    byteLength: extensionBytes.length
  };
  pkg.extensionSchemaBytes[extensionPath] = extensionBytes;
  pkg.submission.assets = [
    { id: "launch-token", kind: "erc20", roleIds: ["launched", "burned", "rewarded"], profileSchema: builtin("urn:programmable:builtin:asset:erc20:1.0.0"), profile: { symbol: "WILD" }, authorityRefs: [] },
    { id: "quote-token", kind: "erc20", roleIds: ["quote", "fee-basis"], profileSchema: builtin("urn:programmable:builtin:asset:erc20:1.0.0"), profile: { symbol: "QUOTE" }, authorityRefs: [] },
    { id: "reward-badge", kind: "erc721", roleIds: ["reward", "achievement"], profileSchema: builtin("urn:programmable:builtin:asset:erc721:1.0.0"), profile: { transferable: false }, authorityRefs: [] }
  ];
  pkg.submission.hooks = [
    { id: "settlement-hook", kind: "uniswap-v4-hook", profileSchema: builtin("urn:programmable:builtin:hook:uniswap-v4:1.0.0"), profile: createV4HookSemanticFixture(permissionSet(), { purpose: "settlement" }), permissions: permissionSet(), implementationRef: null, authorityRefs: [] },
    { id: "game-engine", kind: "threejs-match-settlement-module", profileSchema: clone(repositoryProfile), profile: { description: "Settles an externally reviewed game result." }, permissions: null, implementationRef: null, authorityRefs: [] }
  ];
  pkg.submission.markets = [
    {
      id: "canonical-pool",
      kind: "uniswap-v4-canonical-pool",
      profileSchema: builtin("urn:programmable:builtin:market:uniswap-v4-canonical-pool:1.0.0"),
      profile: { chainId: "1" },
      assetRefs: ["launch-token", "quote-token"],
      hookRef: "settlement-hook",
      liquidity: { nativeAmmMode: "none", minimumInitialLiquidity: "0", sourceRefs: [], custodyRefs: [] },
      executionClass: "programmable-canonical",
      canonicalScopes: ["canonical-volume"]
    },
    {
      id: "secondary-game-market",
      kind: "threejs-game-reward-market",
      profileSchema: clone(repositoryProfile),
      profile: { description: "An external game market outside the canonical launch scope." },
      assetRefs: ["reward-badge"],
      hookRef: "game-engine",
      liquidity: { nativeAmmMode: "optional", minimumInitialLiquidity: "0", sourceRefs: [], custodyRefs: [] },
      executionClass: "external",
      canonicalScopes: []
    }
  ];
  pkg.submission.components = [{
    id: "pricing-engine",
    kind: "contract-pricing-engine",
    profileSchema: builtin("urn:programmable:builtin:component:declarative:1.0.0"),
    profile: { curve: "builder-defined" },
    implementationRefs: [],
    authorityRefs: []
  }];
  pkg.submission.valueFlows = [{
    id: "platform-fee-flow",
    kind: "canonical-platform-fee",
    profileSchema: builtin("urn:programmable:builtin:value-flow:declarative:1.0.0"),
    profile: { rateHundredthsOfBip: 1000 },
    from: { collection: "markets", id: "canonical-pool" },
    to: { collection: "authorities", id: "programmable-fee-owner" },
    assetRefs: ["quote-token"],
    authorityRefs: ["programmable-fee-owner"]
  }];
  const lifecycle = (id, kind, predecessorRefs, refs = {}) => ({
    id,
    kind,
    profileSchema: builtin("urn:programmable:builtin:lifecycle:declarative:1.0.0"),
    profile: { description: kind },
    predecessorRefs,
    assetRefs: refs.assetRefs ?? [],
    marketRefs: refs.marketRefs ?? [],
    hookRefs: refs.hookRefs ?? [],
    componentRefs: refs.componentRefs ?? [],
    valueFlowRefs: refs.valueFlowRefs ?? [],
    authorityRefs: refs.authorityRefs ?? []
  });
  pkg.submission.lifecyclePhases = [
    lifecycle("create-assets", "asset-creation", [], { assetRefs: ["launch-token", "quote-token", "reward-badge"] }),
    lifecycle("initialize-market", "market-initialization", ["create-assets"], { marketRefs: ["canonical-pool"], hookRefs: ["settlement-hook"], componentRefs: ["pricing-engine"] }),
    lifecycle("trade-and-reward", "trade-and-game-settlement", ["initialize-market"], { marketRefs: ["canonical-pool", "secondary-game-market"], hookRefs: ["settlement-hook", "game-engine"], valueFlowRefs: ["platform-fee-flow"] })
  ];
  pkg.submission.programmableFee.feeScopes = [{
    id: "canonical-volume",
    marketRef: "canonical-pool",
    chainId: "1",
    poolId: null,
    quoteAssetRef: "quote-token",
    quoteCurrency: null,
    collectionProfile: "sync-custom-zero-amm"
  }];
  pkg.submission.programmableFee.executionScopeRefs = ["canonical-volume"];
  pkg.submission.programmableFee.collectionProfileSchema = builtin("urn:programmable:builtin:fee-collection:sync-custom-zero-amm:2.0.0");
  pkg.submission.programmableFee.collectionProfile = { mode: "sync-custom-zero-amm", nativeAmmLiquidity: "0" };
  return pkg;
}

function bindTypedFeeConformance(pkg, applicationId) {
  const bundle = createFeeConformanceFixtureV1({
    applicationId,
    poolId: createStandardTradePoolKeyFixtureV1().poolId
  });
  const market = pkg.submission.markets[0];
  const previousMarketId = market.id;
  market.id = bundle.receipt.scope.marketRef;
  market.canonicalScopes = [bundle.receipt.scope.feeScopeId];
  for (const phase of pkg.submission.lifecyclePhases) phase.marketRefs = phase.marketRefs.map((ref) => ref === previousMarketId ? market.id : ref);
  for (const flow of pkg.submission.valueFlows) {
    if (flow.from?.collection === "markets" && flow.from.id === previousMarketId) flow.from.id = market.id;
  }
  pkg.submission.programmableFee.feeScopes = [{
    id: bundle.receipt.scope.feeScopeId,
    marketRef: bundle.receipt.scope.marketRef,
    chainId: bundle.receipt.scope.chainId,
    poolId: bundle.receipt.scope.poolId,
    quoteAssetRef: "quote-token",
    quoteCurrency: bundle.receipt.scope.quoteCurrency,
    collectionProfile: bundle.receipt.scope.collectionProfile
  }];
  pkg.submission.programmableFee.executionScopeRefs = [bundle.receipt.scope.feeScopeId];
  pkg.submission.programmableFee.collectionProfileSchema = builtin("urn:programmable:builtin:fee-collection:standard-amm:2.0.0");
  pkg.submission.programmableFee.collectionProfile = { mode: "standard-amm", nativeAmmLiquidity: "standard-v4-pool" };
  const receiptBytes = canonicalFeeConformanceReceiptBytesV1(bundle.receipt);
  const receiptPath = "evidence/fee-conformance-main-market.receipt.v1.json";
  const vectorSetPath = "evidence/fee-conformance-main-market.vector-set.v1.json";
  const binding = (artifactType, schemaId, artifactPath, bytes) => ({
    artifactType,
    schemaId,
    path: artifactPath,
    sha256: sha256Bytes(bytes),
    byteLength: bytes.length
  });
  pkg.submission.programmableFee.conformance = {
    status: "complete",
    evidenceRefs: [...bundle.conformance.evidenceRefs],
    evidenceDigests: Object.entries(bundle.evidenceDigests)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([evidenceRef, sha256]) => ({ evidenceRef, sha256 })),
    scopeArtifacts: [{
      feeScopeRef: bundle.receipt.scope.feeScopeId,
      receipt: binding("fee-conformance-receipt", bundle.receipt.$schema, receiptPath, receiptBytes),
      vectorSet: binding("fee-conformance-vector-set", bundle.vectorSet.$schema, vectorSetPath, bundle.vectorSetBytes)
    }]
  };
  pkg.supportingRecords.feeConformance = [{
    feeScopeRef: bundle.receipt.scope.feeScopeId,
    receipt: { value: clone(bundle.receipt), bytes: Buffer.from(receiptBytes) },
    vectorSet: { value: clone(bundle.vectorSet), bytes: Buffer.from(bundle.vectorSetBytes) }
  }];
  pkg.supportingRecords.feePolicy = {
    value: feePolicyInstance(pkg.submission.programmableFee.feeScopes),
    bytes: Buffer.alloc(0)
  };
  return bundle;
}

function bindTradeCapabilityManifest(pkg, feeBundle) {
  const market = pkg.submission.markets[0];
  const feeArtifact = pkg.submission.programmableFee.conformance.scopeArtifacts[0].receipt;
  const manifest = createStandardTradeCapabilityManifestFixtureV1({
    applicationId: pkg.submission.applicationId,
    marketRef: market.id,
    chainId: market.profile.chainId,
    poolId: feeBundle.receipt.scope.poolId,
    feeReceipt: {
      artifactId: feeBundle.receipt.receiptId,
      path: `submission/${feeArtifact.path}`,
      sha256: feeArtifact.sha256,
      feeScopeId: feeBundle.receipt.scope.feeScopeId,
      quoteCurrency: feeBundle.receipt.scope.quoteCurrency,
      collectionProfile: feeBundle.receipt.scope.collectionProfile
    }
  });
  const bytes = jsonBytes(manifest);
  const manifestPath = `trade/${market.id}.trade-capability.v1.json`;
  pkg.submission.tradeCapability = {
    applicability: "tradable",
    facetEntryRef: "routing-trade-capability",
    markets: [{
      marketRef: market.id,
      routeType: manifest.route.type,
      manifest: {
        artifactType: "trade-capability-manifest",
        schemaId: manifest.$schema,
        path: manifestPath,
        sha256: sha256Bytes(bytes),
        byteLength: bytes.length
      }
    }]
  };
  pkg.supportingRecords.tradeCapabilities = [{
    marketRef: market.id,
    manifest: { value: manifest, bytes },
    quoteResults: [],
    executionResults: []
  }];
  const results = createTradeTestResultFixturesV1(manifest);
  for (const [testsKey, recordsKey] of [["quoteTests", "quoteResults"], ["executionTests", "executionResults"]]) {
    pkg.supportingRecords.tradeCapabilities[0][recordsKey] = manifest.testEvidence[testsKey].map((test) => ({
      testId: test.id,
      result: { value: results.get(test.resultArtifactPath), bytes: jsonBytes(results.get(test.resultArtifactPath)) }
    }));
  }
}

function feePolicyInstance(scopes) {
  return {
    $schema: "urn:programmable:fee-policy-v2:1.0.0",
    schemaVersion: "1.0.0",
    policyId: PROGRAMMABLE_FEE_V2.policyId,
    policyVersion: PROGRAMMABLE_FEE_V2.policyVersion,
    policyHashPreimage: PROGRAMMABLE_FEE_V2.policyHashPreimage,
    policyHash: PROGRAMMABLE_FEE_V2.policyHash,
    platform: { owner: PROGRAMMABLE_FEE_V2.owner, immutable: true, rateUnit: "hundredths-of-bip", rate: 1000, claimAuthority: "owner-only", claimAvailability: "anytime-from-funded-liability" },
    basis: { metric: "executed-gross-quote-volume", excludedEvents: ["order-deposit", "unfilled", "canceled", "refunded"], partialFillRule: "each-executed-fill-counted-once" },
    economics: { formula: "effective=max(selectedTotalAtExecution,1000);platform=1000;project=effective-1000", maximumUserFundedTotalRateExclusive: 1000000, externallyFundedRateRule: "uint256-rate-custom-reviewed-segregated-funding-only", exactOutputRule: "verified-gross-witness" },
    accounting: { rounding: "cumulative-independent-platform-project-remainders", remainderScope: "chain-pool-quote-currency-lifetime", fragmentationResistantPlatformFee: true, claimResetsRemainders: false, claimableOnlyWhenFullyFunded: true, crossScopeNetting: false },
    collectionProfiles: ["standard-amm", "sync-custom-zero-amm", "async-fill-batch", "custom-reviewed"],
    feeScopes: scopes.map(({ id, chainId, poolId, quoteCurrency, collectionProfile }) => ({ id, chainId, poolId, quoteCurrency, collectionProfile }))
  };
}

function rebindPackage(pkg) {
  const ideaBytes = jsonBytes(pkg.records.ideaSource.value);
  pkg.records.ideaSource.bytes = ideaBytes;
  pkg.records.intentContract.value.ideaSourceSha256 = sha256Bytes(ideaBytes);
  const intentBytes = jsonBytes(pkg.records.intentContract.value);
  pkg.records.intentContract.bytes = intentBytes;
  pkg.records.architectureDecisions.value.intentContractSha256 = sha256Bytes(intentBytes);
  const architectureBytes = jsonBytes(pkg.records.architectureDecisions.value);
  pkg.records.architectureDecisions.bytes = architectureBytes;
  pkg.records.intentFidelity.value.inputDigests = {
    ideaSourceSha256: sha256Bytes(ideaBytes),
    intentContractSha256: sha256Bytes(intentBytes),
    architectureDecisionsSha256: sha256Bytes(architectureBytes),
    architectureSnapshotSha256: architectureSnapshotSha256(pkg.submission)
  };
  pkg.records.intentFidelity.bytes = jsonBytes(pkg.records.intentFidelity.value);
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_ARTIFACTS)) pkg.submission.intentPackage[key] = artifactBinding(spec, pkg.records[key].bytes);
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS)) {
    if (key === "securityAssessment" && !pkg.supportingRecords.securityAssessment) continue;
    pkg.supportingRecords[key].bytes = jsonBytes(pkg.supportingRecords[key].value);
    pkg.submission.supportingPackage[key] = artifactBinding(spec, pkg.supportingRecords[key].bytes);
  }
  if (pkg.supportingRecords.feePolicy) {
    pkg.supportingRecords.feePolicy.bytes = jsonBytes(pkg.supportingRecords.feePolicy.value);
    pkg.submission.supportingPackage.feePolicy = artifactBinding(
      OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS.feePolicy,
      pkg.supportingRecords.feePolicy.bytes
    );
  }
  pkg.submissionBytes = jsonBytes(pkg.submission);
}

function freezePrototypePackage(pkg, feeApplicability) {
  const files = new Map();
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_ARTIFACTS)) files.set(spec.file, pkg.records[key].bytes);
  for (const [key, spec] of Object.entries(OPEN_WORLD_V2_SUPPORTING_ARTIFACTS)) if (pkg.supportingRecords[key]) files.set(spec.file, pkg.supportingRecords[key].bytes);
  if (pkg.supportingRecords.feePolicy) files.set(OPEN_WORLD_V2_OPTIONAL_SUPPORTING_ARTIFACTS.feePolicy.file, pkg.supportingRecords.feePolicy.bytes);
  for (const [relativePath, bytes] of Object.entries(pkg.extensionSchemaBytes)) files.set(relativePath, bytes);
  for (const [index, declaration] of (pkg.submission.programmableFee.conformance.scopeArtifacts ?? []).entries()) {
    const record = pkg.supportingRecords.feeConformance[index];
    files.set(declaration.receipt.path, record.receipt.bytes);
    files.set(declaration.vectorSet.path, record.vectorSet.bytes);
  }
  for (const [index, declaration] of (pkg.submission.tradeCapability.markets ?? []).entries()) {
    const record = pkg.supportingRecords.tradeCapabilities[index];
    files.set(declaration.manifest.path, record.manifest.bytes);
    for (const [testsKey, recordsKey] of [["quoteTests", "quoteResults"], ["executionTests", "executionResults"]]) {
      for (const [testIndex, test] of record.manifest.value.testEvidence[testsKey].entries()) files.set(test.resultArtifactPath, record[recordsKey][testIndex].result.bytes);
    }
  }
  files.set(OPEN_WORLD_V2_SUBMISSION_FILE, pkg.submissionBytes);
  return Object.freeze({ submission: clone(pkg.submission), files, feeApplicability });
}

function artifactBinding(spec, bytes) {
  return {
    artifactType: spec.artifactType,
    schemaId: spec.schemaId,
    path: spec.file,
    sha256: sha256Bytes(bytes),
    byteLength: bytes.length
  };
}

function permissionSet() {
  return {
    beforeInitialize: false,
    afterInitialize: false,
    beforeAddLiquidity: false,
    afterAddLiquidity: false,
    beforeRemoveLiquidity: false,
    afterRemoveLiquidity: false,
    beforeSwap: false,
    afterSwap: true,
    beforeDonate: false,
    afterDonate: false,
    beforeSwapReturnDelta: false,
    afterSwapReturnDelta: false,
    afterAddLiquidityReturnDelta: false,
    afterRemoveLiquidityReturnDelta: false
  };
}
