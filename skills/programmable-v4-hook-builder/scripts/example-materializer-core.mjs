import fs from "node:fs";
import path from "node:path";
import { validateAgainstSchema } from "./submission-core.mjs";

const exampleIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function listExampleIds(skillRoot) {
  const examplesDirectory = path.join(skillRoot, "assets", "examples");

  return fs.readdirSync(examplesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -".json".length))
    .filter((id) => exampleIdPattern.test(id))
    .sort();
}

export function materializeExample({ skillRoot, exampleId, stepId = null }) {
  if (!exampleIdPattern.test(exampleId ?? "")) {
    throw new Error("Example id must contain only lowercase letters, digits and single hyphens.");
  }

  const examplesDirectory = path.join(skillRoot, "assets", "examples");
  const fixturePath = path.join(examplesDirectory, `${exampleId}.json`);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Unknown example id: ${exampleId}`);
  }

  const fixture = readJson(fixturePath);
  validateFixture(fixture, exampleId);

  const selectedStepId = stepId ?? fixture.steps.at(-1).id;
  if (!fixture.steps.some((step) => step.id === selectedStepId)) {
    throw new Error(`Unknown step "${selectedStepId}" for example "${exampleId}".`);
  }

  const template = readJson(path.join(skillRoot, "assets", "templates", "submission.example.json"));
  const schema = readJson(path.join(skillRoot, "references", "submission.schema.json"));
  let submission = buildExampleBaseline(template);

  for (const step of fixture.steps) {
    submission = overlay(submission, step.patch);
    const schemaErrors = validateAgainstSchema(submission, schema);
    if (schemaErrors.length > 0) {
      throw new Error(
        `Example ${exampleId}/${step.id} does not match the submission schema:\n${schemaErrors.map(formatSchemaError).join("\n")}`
      );
    }
    if (step.id === selectedStepId) return submission;
  }

  throw new Error(`Unable to materialize example "${exampleId}".`);
}

export function serializeSubmission(submission) {
  return `${JSON.stringify(submission, null, 2)}\n`;
}

export function buildExampleBaseline(template) {
  const submission = structuredClone(template);
  submission.assets[1].initialSupply = "1000000000000000000000000000";
  submission.launchLifecycle = completeLaunchLifecycle();
  submission.model = {
    id: "swap-observer",
    name: "Swap Observer",
    summary: "Record a pool-scoped aggregate after each completed swap without changing price, fees or settlement.",
    userOutcome: "A creator launches a standard token whose canonical pool exposes transparent aggregate swap activity.",
    category: "market-structure",
    whyV4: "The aggregate is updated atomically after the canonical pool completes each swap and remains scoped by PoolId."
  };
  submission.pool = {
    currency0: "eth",
    currency1: "launched-token",
    orderingRule: "Sort currencies by canonical Uniswap address ordering; native ETH is the zero address.",
    tickSpacing: 60,
    lpFee: {
      classification: "lp-fee",
      mode: "static",
      hundredthsOfBip: 3000,
      initialHundredthsOfBip: null,
      initializationPath: null,
      applicationMode: null,
      overrideFlagPolicy: null,
      persistentUpdateActor: null,
      persistentUpdateCallSites: [],
      rateLimit: null,
      updatePath: null,
      minimum: null,
      maximum: null,
      inputMetric: null,
      referenceAsset: null,
      measurementUnit: null,
      observationMode: null,
      observationWindow: null,
      curve: null,
      updateCadence: null,
      liquidityDecreaseBehavior: null,
      manipulationResistance: null,
      failureRule: null,
      recipient: "pool-liquidity-providers"
    },
    canonical: true,
    alternativePools: "Only the recorded PoolKey is canonical; other pools do not receive or imply this behavior."
  };
  submission.hook.base = "Pinned OpenZeppelin BaseHook from the Programmable-tested baseline.";
  submission.hook.upgradeable = false;
  submission.hook.sharedAcrossPools = false;
  submission.hook.poolNamespace = "All state is keyed by PoolId and the launcher binds one hook instance to one canonical PoolKey.";
  submission.hook.poolAdmission = {
    enforcement: "The launch factory records the exact PoolKey during initialization and every callback rejects any different PoolId.",
    factoryOrRegistry: "The immutable Programmable launch factory is the only initializer accepted by this hook instance.",
    alternativePoolBehavior: "Alternative pools may exist but cannot enter this hook's state namespace or inherit its recorded behavior.",
    rejectionRule: "Any unregistered PoolId or mismatched PoolKey reverts before state or value changes."
  };
  for (const permission of Object.keys(submission.hook.permissions)) {
    submission.hook.permissions[permission] = false;
  }
  submission.hook.permissions.afterSwap = true;
  submission.hook.callbackPolicies = [{
    callback: "afterSwap",
    necessity: "The hook records one pool-scoped aggregate only after a completed swap.",
    allowedReverts: "Only invalid PoolId admission or an atomic storage failure may revert the complete action.",
    userExitImpact: "This callback does not govern withdrawals, claims or removal of a liquidity position.",
    noSelfCallImpact: "The model does not initiate a same-hook PoolManager action and never relies on recursive callbacks."
  }];
  submission.hook.hookData = {
    used: false,
    schema: null,
    identitySource: null,
    trustedRouterDeploymentRecordId: null,
    callbackSenderRule: null,
    validation: null
  };
  submission.hook.feeMechanism = {
    used: false,
    classification: "none",
    chargedCurrency: null,
    swapQuadrants: {
      zeroForOneExactInput: null,
      zeroForOneExactOutput: null,
      oneForZeroExactInput: null,
      oneForZeroExactOutput: null
    },
    maximumHundredthsOfBip: null,
    collectionPath: null,
    collectionValueFlowId: null,
    liabilityKeyDimensions: [],
    collectionEvent: null,
    recipients: [],
    ownership: null,
    claimPolicy: null
  };
  submission.hook.customAccounting = {
    used: false,
    backingSource: null,
    conservationEquation: null,
    settlement: null,
    partialFillBehavior: null,
    liabilityNamespace: null,
    liabilityKeyDimensions: [],
    crossPoolNetting: null,
    duplicateCurrencyPolicy: null,
    failureIsolation: null,
    withdrawalOrdering: null
  };
  submission.hook.returnDeltaAccounting.used = false;
  for (const policy of Object.values(submission.hook.postReturnDeltaAccounting)) {
    policy.used = false;
  }
  submission.hook.erc6909Claims.used = false;
  submission.hook.nestedActions.used = false;
  submission.hook.nestedActions.directPoolManagerCalls = false;
  submission.hook.nestedActions.routerCalls = false;
  submission.hook.nestedActions.allowedActions = [];
  submission.valueFlows = [{
    id: "swap-observation",
    action: "swap observation",
    asset: "both declared pool currencies",
    from: "PoolManager accounting",
    to: "PoolManager accounting without hook custody",
    amountRule: "The hook returns zero deltas and records only aggregate metadata after the swap.",
    settlement: "The standard PoolManager and router settle the swap; the hook transfers no value.",
    failure: "A storage write failure reverts the complete swap and cannot create a partial state transition."
  }];
  submission.operations.monitoring = "Index the declared event and alert on callback reverts or an unexpected hook permission mask.";
  submission.operations.incidentResponse = "The immutable model has no pause or upgrade path; publish a new version only for future pools.";
  submission.integration = {
    routerGeneration: "V2_2_0",
    routerDependencyId: null,
    permit2DependencyId: null,
    stateViewDependencyId: null,
    quoterDependencyId: null,
    sdkDependencies: [],
    routerActionProfile: {
      routerVersionExplicit: null,
      universalRouterCommand: null,
      v4Actions: [],
      settlementMode: null,
      permit2Mode: null,
      finalSwapDeltaValidated: null
    },
    appSourcePaths: [],
    integrationTestPaths: [],
    quoteExecutionParity: null,
    swapModes: [
      "zeroForOne-exactInput",
      "zeroForOne-exactOutput",
      "oneForZero-exactInput",
      "oneForZero-exactOutput"
    ],
    partialFills: "The hook does not alter partial fills; router and PoolManager semantics remain authoritative.",
    slippage: "The router binds the user-specified minimum output or maximum input for the complete route.",
    deadline: "The router command uses a user-visible finite deadline bound to the transaction intent.",
    permit2: "Permit2 approvals bind token, amount, spender, nonce, chain and expiration.",
    stateReads: "StateView and quote reads use the exact PoolKey at one coherent block.",
    events: ["SwapAggregateUpdated(bytes32 indexed poolId,uint256 swapCount)"]
  };
  attachStageProfiles(submission);
  for (const policy of Object.values(submission.capabilities)) {
    policy.used = false;
  }
  submission.risk = {
    dimensions: {
      complexity: 1,
      customMath: 0,
      externalDependencies: 0,
      externalLiquidity: 0,
      valueAtRisk: 0,
      teamMaturity: 1,
      upgradeability: 0,
      autonomy: 0,
      priceImpact: 0
    },
    rationales: {
      complexity: "One afterSwap callback performs one bounded storage update and returns the standard selector.",
      customMath: "No custom pricing, curve, conversion or arithmetic beyond a checked aggregate counter is used.",
      externalDependencies: "The observer relies only on authenticated PoolManager callback context and no external service.",
      externalLiquidity: "The hook never holds liquidity, a position, PoolManager claim or beneficiary currency balances.",
      valueAtRisk: "The hook changes no settlement delta and takes custody of no user or liquidity-provider asset.",
      teamMaturity: "A conservative nonzero process score is retained until an independent review establishes maturity.",
      upgradeability: "The hook and launched token are immutable and expose no proxy, upgrade or rescue authority.",
      autonomy: "No keeper, scheduler, oracle or autonomous state transition can change pool behavior.",
      priceImpact: "The callback returns zero deltas and does not change LP fees, price formation or route execution."
    },
    declaredTotal: 2,
    declaredTier: "low",
    featureTriggers: []
  };
  submission.disclosures = ["The hook records aggregate activity and does not identify an end user behind a router."];
  submission.unresolved = [];
  return submission;
}

export function overlay(target, patch) {
  if (Array.isArray(patch)) return structuredClone(patch);
  if (patch === null || typeof patch !== "object") return patch;

  const result = isPlainObject(target) ? structuredClone(target) : {};
  for (const [key, value] of Object.entries(patch)) {
    result[key] = overlay(result[key], value);
  }
  return result;
}

function validateFixture(fixture, expectedId) {
  if (!isPlainObject(fixture) || fixture.fixtureVersion !== 1) {
    throw new Error(`Example "${expectedId}" must use fixtureVersion 1.`);
  }
  if (fixture.id !== expectedId) {
    throw new Error(`Example id "${fixture.id ?? ""}" does not match file id "${expectedId}".`);
  }
  if (typeof fixture.name !== "string" || typeof fixture.description !== "string") {
    throw new Error(`Example "${expectedId}" needs a name and description.`);
  }
  if (!Array.isArray(fixture.steps) || fixture.steps.length === 0) {
    throw new Error(`Example "${expectedId}" needs at least one step.`);
  }

  const stepIds = new Set();
  for (const step of fixture.steps) {
    if (!exampleIdPattern.test(step?.id ?? "") || stepIds.has(step.id) || !isPlainObject(step.patch)) {
      throw new Error(`Example "${expectedId}" contains an invalid or duplicate step.`);
    }
    stepIds.add(step.id);
  }
}

function attachStageProfiles(submission) {
  submission.integration.routingAndDiscoverability = {
    routingMode: "programmable-app",
    allowlistTriggers: {
      usesDeltaFlag: false,
      addressStartsWith91: false,
      targetsMajorPair: false,
      permissionedPool: false
    },
    uniswapRoutingStatus: "not-applicable",
    hookRegistryStatus: "not-submitted",
    customHookDataRequired: false,
    standardRouterCompatible: true,
    permissionedRouting: {
      required: false,
      minimumRouterGeneration: null,
      adapterCurrencyUsed: null,
      allowedWrapperBindings: null,
      positionManagerBinding: null,
      routingAllowlistRequiredPerChain: null
    },
    sourcePaths: [],
    testPaths: []
  };
  submission.integration.dataReconstruction = {
    mode: "events-with-confirmed-reads",
    eventCoverage: "Declared lifecycle events reconstruct every launch and aggregate update; confirmed StateView reads reconcile current pool state.",
    cursor: "block-number-transaction-index-log-index",
    startBlockPolicy: "Begin at the reviewed launcher and hook deployment blocks, then process every matching log in canonical chain order.",
    finalityDepth: 12,
    reorgPolicy: "Store checkpoint block hashes, roll back every orphaned log and derived row, then replay from the last matching ancestor.",
    backfillPolicy: "Backfill bounded block ranges from the exact deployment blocks, persist progress after each range and retry failed ranges without skipping logs.",
    checkpointPolicy: "Persist the finalized block number, block hash and last transaction and log indexes after one atomic database commit.",
    freshnessTargetSeconds: 30,
    staleAfterSeconds: 120,
    freshnessMeasurement: "Measure lag from the latest finalized indexed block timestamp to the latest finalized chain block and expose the value with every response.",
    reconciliation: "Recompute event-derived aggregates against confirmed StateView and contract reads; quarantine mismatches instead of publishing partial state.",
    reserveReconstruction: {
      used: false,
      balanceSources: [],
      liabilitySources: [],
      attributionKeys: [],
      solvencyEquation: null,
      poolLiquidityTreatment: null,
      donationAndDustPolicy: null,
      reconciliation: null
    },
    sourcePaths: [],
    testPaths: []
  };
  submission.integration.platformHandoff = {
    intended: true,
    websiteRegistryPath: null,
    uiSourcePaths: [],
    apiSourcePaths: [],
    indexerSourcePaths: [],
    testPaths: [],
    reviewStatus: "not-requested",
    maintainerReviewRequired: true,
    selfApproval: false,
    availabilityClaimed: false,
    handoffNotes: "Programmable maintainers review and integrate the isolated package; a successful preflight does not mutate the registry or expose the model."
  };
}

function completeLaunchLifecycle() {
  return {
    tokenCreation: lifecyclePhase("The launch factory deploys one immutable fixed-supply token.", "The exact fixed supply is minted once to the launch flow before ownership-free completion."),
    poolInitialization: lifecyclePhase("The launch factory initializes the admitted canonical PoolKey.", "The factory supplies the initial price and exact hook address without transferring user custody."),
    liquidityFormation: lifecyclePhase("The launch transaction creates the canonical initial liquidity position.", "Declared launch assets enter the exact canonical pool under the model's immutable position policy."),
    initialTransaction: lifecyclePhase("The creator may execute an explicitly quoted initial transaction.", "Any optional initial transaction uses the same router, slippage and settlement rules as later trading."),
    trading: lifecyclePhase("An authenticated router and PoolManager execute each supported swap quadrant.", "The PoolManager settles both currencies while the hook applies only its declared behavior."),
    feesAndClaims: lifecyclePhase("Pool liquidity providers receive the declared LP fee through core accounting.", "The hook creates no beneficiary liability or separate claim."),
    dependencyFailure: lifecyclePhase("The transaction caller encounters an atomic failure from one pinned dependency.", "A dependency failure reverts the complete action and leaves no partial hook or asset custody state."),
    retirement: lifecyclePhase("Users stop selecting this immutable model for new launches.", "Existing pools retain immutable behavior and users keep the declared exit paths.")
  };
}

function lifecyclePhase(actor, valueFlow) {
  return {
    applicable: true,
    actor,
    valueFlow,
    custody: "Every asset holder and PoolManager liability is explicit in the value-flow records.",
    failure: "Failure reverts the complete transaction unless a separately tested permissionless retry path is named.",
    event: "Emit or preserve one indexable event containing the model version and exact PoolId.",
    notApplicableReason: null
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatSchemaError(error) {
  if (!isPlainObject(error)) return String(error);
  return `${error.code ?? "SCHEMA_ERROR"} ${error.path ?? "$"}: ${error.message ?? "Schema validation failed."}`;
}

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, "utf8"));
}
