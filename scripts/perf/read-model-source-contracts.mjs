import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import typescript from "typescript";

const ts = typescript;

function readSource(rootDirectory, path, sourceOverrides) {
  if (Object.hasOwn(sourceOverrides, path)) return sourceOverrides[path];
  return readFileSync(resolve(rootDirectory, path), "utf8");
}

function parseTypeScript(path, source) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visitTree(node, visitor) {
  if (!node) return true;
  if (visitor(node) === false) return false;
  let keepWalking = true;
  node.forEachChild((child) => {
    if (keepWalking && visitTree(child, visitor) === false) {
      keepWalking = false;
    }
  });
  return keepWalking;
}

function findNode(node, predicate) {
  let match;
  visitTree(node, (candidate) => {
    if (!predicate(candidate)) return true;
    match = candidate;
    return false;
  });
  return match;
}

function propertyName(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return undefined;
}

function findVariableInitializer(sourceFile, name) {
  const declaration = findNode(
    sourceFile,
    (node) =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name,
  );
  return declaration?.initializer;
}

function staticNumber(sourceFile, expression, seen = new Set()) {
  if (!expression) return undefined;
  if (ts.isParenthesizedExpression(expression)) {
    return staticNumber(sourceFile, expression.expression, seen);
  }
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (ts.isPrefixUnaryExpression(expression)) {
    const operand = staticNumber(sourceFile, expression.operand, seen);
    if (operand === undefined) return undefined;
    if (expression.operator === ts.SyntaxKind.MinusToken) return -operand;
    if (expression.operator === ts.SyntaxKind.PlusToken) return operand;
    return undefined;
  }
  if (ts.isIdentifier(expression)) {
    if (seen.has(expression.text)) return undefined;
    const nextSeen = new Set(seen).add(expression.text);
    return staticNumber(
      sourceFile,
      findVariableInitializer(sourceFile, expression.text),
      nextSeen,
    );
  }
  if (!ts.isBinaryExpression(expression)) return undefined;
  const left = staticNumber(sourceFile, expression.left, seen);
  const right = staticNumber(sourceFile, expression.right, seen);
  if (left === undefined || right === undefined) return undefined;
  switch (expression.operatorToken.kind) {
    case ts.SyntaxKind.PlusToken:
      return left + right;
    case ts.SyntaxKind.MinusToken:
      return left - right;
    case ts.SyntaxKind.AsteriskToken:
      return left * right;
    case ts.SyntaxKind.SlashToken:
      return right === 0 ? undefined : left / right;
    default:
      return undefined;
  }
}

function constantNumber(sourceFile, name) {
  return staticNumber(sourceFile, findVariableInitializer(sourceFile, name));
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function expressionPath(expression) {
  const current = unwrapExpression(expression);
  if (!current) return undefined;
  if (ts.isIdentifier(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) {
    const owner = expressionPath(current.expression);
    return owner ? `${owner}.${current.name.text}` : undefined;
  }
  if (
    ts.isElementAccessExpression(current) &&
    ts.isStringLiteral(current.argumentExpression)
  ) {
    const owner = expressionPath(current.expression);
    return owner ? `${owner}.${current.argumentExpression.text}` : undefined;
  }
  return undefined;
}

function findFunctionLike(sourceFile, name) {
  const declaration = findNode(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node)) return node.name?.text === name;
    return (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      Boolean(node.initializer) &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    );
  });
  if (!declaration) return undefined;
  return ts.isVariableDeclaration(declaration)
    ? declaration.initializer
    : declaration;
}

function containsIdentifier(node, name) {
  return Boolean(
    findNode(node, (candidate) =>
      ts.isIdentifier(candidate) && candidate.text === name,
    ),
  );
}

function identifierCount(node, name) {
  let count = 0;
  visitTree(node, (candidate) => {
    if (ts.isIdentifier(candidate) && candidate.text === name) count += 1;
    return true;
  });
  return count;
}

function containsExpressionPath(node, path) {
  return Boolean(
    findNode(
      node,
      (candidate) => expressionPath(candidate) === path,
    ),
  );
}

function containsCall(node, path) {
  return Boolean(
    findNode(
      node,
      (candidate) =>
        ts.isCallExpression(candidate) &&
        expressionPath(candidate.expression) === path,
    ),
  );
}

function containsAwaitedCall(node, path) {
  return Boolean(
    findNode(node, (candidate) => {
      if (!ts.isAwaitExpression(candidate)) return false;
      const expression = unwrapExpression(candidate.expression);
      return (
        ts.isCallExpression(expression) &&
        expressionPath(expression.expression) === path
      );
    }),
  );
}

function containsComparison(node, leftPath, operator, rightPath) {
  return Boolean(
    findNode(node, (candidate) => {
      if (!ts.isBinaryExpression(candidate)) return false;
      return (
        expressionPath(candidate.left) === leftPath &&
        candidate.operatorToken.kind === operator &&
        expressionPath(candidate.right) === rightPath
      );
    }),
  );
}

function objectLiteral(expression) {
  const current = unwrapExpression(expression);
  if (!current) return undefined;
  if (ts.isObjectLiteralExpression(current)) return current;
  if (
    ts.isCallExpression(current) &&
    expressionPath(current.expression) === "Object.freeze"
  ) {
    return objectLiteral(current.arguments[0]);
  }
  return undefined;
}

function objectPropertyNames(object) {
  if (!object) return new Set();
  return new Set(
    object.properties
      .map((property) => propertyName(property.name))
      .filter(Boolean),
  );
}

function hasObjectPropertyMapping(node, property, valuePath) {
  return Boolean(
    findNode(node, (candidate) => {
      if (!ts.isObjectLiteralExpression(candidate)) return false;
      return candidate.properties.some((member) => {
        if (
          !ts.isPropertyAssignment(member) &&
          !ts.isShorthandPropertyAssignment(member)
        ) {
          return false;
        }
        if (propertyName(member.name) !== property) return false;
        return ts.isShorthandPropertyAssignment(member)
          ? member.name.text === valuePath
          : expressionPath(member.initializer) === valuePath;
      });
    }),
  );
}

function typeLiteralPropertyNames(sourceFile, typeName) {
  const declaration = findNode(
    sourceFile,
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === typeName,
  );
  if (!declaration) return new Set();
  let type = declaration.type;
  if (
    ts.isTypeReferenceNode(type) &&
    expressionPath(type.typeName) === "Readonly" &&
    type.typeArguments?.length === 1
  ) {
    type = type.typeArguments[0];
  }
  if (!ts.isTypeLiteralNode(type)) return new Set();
  return new Set(type.members.map((member) => propertyName(member.name)).filter(Boolean));
}

function containsConditionalDelete(functionNode, parameterName, guardName) {
  return Boolean(
    findNode(functionNode, (node) => {
      if (!ts.isIfStatement(node) || !containsIdentifier(node.expression, guardName)) {
        return false;
      }
      return Boolean(
        findNode(
          node.thenStatement,
          (candidate) =>
            ts.isCallExpression(candidate) &&
            expressionPath(candidate.expression) === "canonical.delete" &&
            candidate.arguments.length === 1 &&
            expressionPath(candidate.arguments[0]) === parameterName,
        ),
      );
    }),
  );
}

export function evaluateReadModelSourceContracts(
  rootDirectory,
  profile,
  options = {},
) {
  const sourceOverrides = options.sourceOverrides ?? {};
  const checks = [];
  const failures = [];
  const check = (id, condition, detail) => {
    const status = condition ? "pass" : "fail";
    checks.push({ id, status, detail });
    if (!condition) failures.push({ id, detail });
  };

  const source = (path) => readSource(rootDirectory, path, sourceOverrides);
  const dualRpc = source("lib/data-pipeline/dual-rpc.ts");
  const dualRpcAst = parseTypeScript("dual-rpc.ts", dualRpc);
  const rpcPolicyFunction = findFunctionLike(dualRpcAst, "rpcExecutionPolicy");
  const retryTracedRpcFunction = findFunctionLike(dualRpcAst, "retryTracedRpc");
  const withinRpcDeadlineFunction = findFunctionLike(
    dualRpcAst,
    "withinRpcDeadline",
  );
  const performanceCapture = source(
    "lib/data-pipeline/read-model-performance-capture.server.ts",
  );
  const performanceCaptureAst = parseTypeScript(
    "read-model-performance-capture.server.ts",
    performanceCapture,
  );
  const releaseProfile = profile.profileId === "read-model-release-v1";
  const candidateConstant = releaseProfile
    ? "RELEASE_REQUIRED_CANDIDATE_COUNT"
    : "SMOKE_REQUIRED_CANDIDATE_COUNT";
  const callBudgetConstant = releaseProfile
    ? "RELEASE_MAX_CALLS_PER_PROVIDER"
    : "SMOKE_MAX_CALLS_PER_PROVIDER";
  check(
    "source-rpc-concurrency",
    constantNumber(dualRpcAst, "DEFAULT_RPC_CONCURRENCY") ===
      profile.projector.rpc.maxConcurrencyPerProvider &&
      containsIdentifier(rpcPolicyFunction, "DEFAULT_RPC_CONCURRENCY") &&
      containsIdentifier(dualRpcAst, "maxConcurrency") &&
      containsExpressionPath(dualRpcAst, "policy.maxConcurrency"),
    "dual-RPC concurrency matches the load profile",
  );
  check(
    "source-rpc-attempts",
    constantNumber(dualRpcAst, "DEFAULT_RPC_ATTEMPTS") ===
      profile.projector.rpc.maxAttemptsPerCall &&
      containsIdentifier(rpcPolicyFunction, "DEFAULT_RPC_ATTEMPTS") &&
      containsExpressionPath(retryTracedRpcFunction, "policy.maxAttempts"),
    "dual-RPC retry attempts match the load profile",
  );
  check(
    "source-rpc-candidate-cap",
    constantNumber(performanceCaptureAst, candidateConstant) ===
      profile.projector.maximumCandidateBatchSize &&
      identifierCount(performanceCaptureAst, candidateConstant) > 1,
    "the measured candidate batch matches the load profile",
  );
  check(
    "source-rpc-hard-deadline",
    constantNumber(dualRpcAst, "DEFAULT_RPC_DEADLINE_MS") ===
      profile.projector.hardDeadlineMs &&
      constantNumber(performanceCaptureAst, "HARD_DEADLINE_MS") ===
        profile.projector.hardDeadlineMs &&
      containsIdentifier(rpcPolicyFunction, "DEFAULT_RPC_DEADLINE_MS") &&
      identifierCount(performanceCaptureAst, "HARD_DEADLINE_MS") > 1 &&
      containsCall(withinRpcDeadlineFunction, "Promise.race") &&
      containsCall(withinRpcDeadlineFunction, "setTimeout") &&
      containsIdentifier(withinRpcDeadlineFunction, "deadlineAt"),
    "dual-RPC runtime enforces the hard deadline",
  );
  check(
    "source-rpc-global-call-budget",
    constantNumber(performanceCaptureAst, callBudgetConstant) ===
      profile.projector.rpc.maxCallsPerProviderPerRun &&
      constantNumber(dualRpcAst, "DEFAULT_MAXIMUM_PROVIDER_CALLS") >=
        profile.projector.rpc.smokeFirstAttemptCallsPerProvider &&
      containsIdentifier(
        rpcPolicyFunction,
        "DEFAULT_MAXIMUM_PROVIDER_CALLS",
      ) &&
      containsComparison(
        retryTracedRpcFunction,
        "context.callCount",
        ts.SyntaxKind.GreaterThanEqualsToken,
        "policy.maxCallsPerProvider",
      ) &&
      identifierCount(performanceCaptureAst, callBudgetConstant) > 1,
    "the runtime and measured trace enforce a per-provider call budget",
  );
  const executionTraceProperty = findNode(
    dualRpcAst,
    (node) =>
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === "executionTrace" &&
      Boolean(objectLiteral(node.initializer)),
  );
  const executionTraceProperties = objectPropertyNames(
    executionTraceProperty
      ? objectLiteral(executionTraceProperty.initializer)
      : undefined,
  );
  const traceTypeProperties = typeLiteralPropertyNames(
    dualRpcAst,
    "DualRpcCallTrace",
  );
  check(
    "source-rpc-raw-trace",
    [
      "startedAtMs",
      "completedAtMs",
      "candidateBatchSize",
      "hardDeadlineMs",
      "maxCallsPerProvider",
      "elapsedMs",
      "providerCallCounts",
      "calls",
    ].every((name) => executionTraceProperties.has(name)) &&
      [
        "providerIdentity",
        "providerVendorGroup",
        "providerEndpointCommitment",
        "providerOriginCommitment",
        "operation",
        "attempt",
        "startedOffsetMs",
        "durationMs",
        "outcome",
      ].every((name) => traceTypeProperties.has(name)) &&
      hasObjectPropertyMapping(
        retryTracedRpcFunction,
        "providerEndpointCommitment",
        "context.providerEndpointCommitment",
      ) &&
      hasObjectPropertyMapping(
        retryTracedRpcFunction,
        "providerOriginCommitment",
        "context.providerOriginCommitment",
      ) &&
      containsExpressionPath(performanceCaptureAst, "result.executionTrace"),
    "dual-RPC output includes raw commitment-bound call traces",
  );

  const rpcProviders = source("lib/data-pipeline/rpc-providers.server.ts");
  check(
    "source-rpc-timeout",
    rpcProviders.includes(
      `timeout: ${profile.projector.rpc.perCallTimeoutMs.toLocaleString("en-US").replace(",", "_")}`,
    ),
    "RPC timeout matches the load profile",
  );

  const projectorRoute = source("app/api/ops/projector/route.ts");
  check(
    "source-hosting-deadline",
    projectorRoute.includes(
      `export const maxDuration = ${profile.projector.hostingDeadlineMs / 1_000};`,
    ),
    "hosting deadline leaves the required projector reserve",
  );

  const dataPipelineConfig = source("lib/data-pipeline/config.ts");
  check(
    "source-dependency-timeouts",
    dataPipelineConfig.includes("timeoutMs: 2_000;") &&
      dataPipelineConfig.includes("statementTimeoutMs: 1_000;"),
    "Envio and Postgres calls retain bounded timeouts",
  );

  const publicCacheSources = [
    ["exploreList", "app/api/explore/route.ts"],
    ["tokenDetail", "app/api/explore/token/route.ts"],
    ["tokenChart", "app/api/explore/token/chart/route.ts"],
    ["creatorProfile", "app/api/explore/profile/route.ts"],
    ["classicProfile", "app/api/profile/classic-v3/route.ts"],
    ["stockProfile", "app/api/profile/stock-paired/route.ts"],
    ["classicLaunchLookup", "app/api/profile/classic-v3/route.ts"],
    [
      "stockLaunchLookup",
      "app/api/explore/launch/stock-paired/route.ts",
    ],
    ["tokenList", "app/api/indexers/v1/token-list/route.ts"],
    ["health", "app/api/ops/health/route.ts"],
  ];
  for (const [contractName, path] of publicCacheSources) {
    const routeSource = source(path);
    check(
      `source-cache-${contractName}`,
      routeSource.includes(profile.cacheContracts[contractName]),
      `${contractName} cache policy matches the load profile`,
    );
  }

  const publicIndexerRoute = source("app/api/indexers/v1/tokens/route.ts");
  const publicIndexerResponse = source("app/api/indexers/v1/response.ts");
  check(
    "source-cache-publicIndexer",
    publicIndexerRoute.includes("indexedFeedHeaders(snapshot)") &&
      publicIndexerResponse.includes(
        `export const INDEXER_READY_CACHE_CONTROL =\n  "${profile.cacheContracts.publicIndexer}";`,
      ) &&
      publicIndexerResponse.includes(
        "cacheControl = INDEXER_READY_CACHE_CONTROL",
      ),
    "publicIndexer cache policy matches the response helper used by the route",
  );
  const deployPolicy = source("scripts/perf/read-model-deploy-policy.mjs");
  check(
    "source-public-indexer-activation-gate",
    deployPolicy.includes('"INDEXED_PUBLIC_INDEXER_FEED_READS_ENABLED"') &&
      deployPolicy.includes("RELEASE_GATED_FLAG_NAMES") &&
      deployPolicy.includes("evidenceRequired"),
    "public indexer feed activation remains behind signed release evidence",
  );

  const readModelMigration = source(
    "supabase/migrations/20260731175501_atomic_empty_envio_coverage_pages.sql",
  );
  check(
    "source-reorg-exact-current",
    /create view programmable_private\.route_eligibility_current_exact_v1/iu.test(
      readModelMigration,
    ) &&
      /current_checkpoint\.checkpoint_generation\s*=\s*checkpoint\.checkpoint_generation/iu.test(
        readModelMigration,
      ) &&
      /current_checkpoint\.reorg_generation\s*=\s*checkpoint\.reorg_generation/iu.test(
        readModelMigration,
      ) &&
      /current_epoch\.generation\s*=\s*route\.pointer_generation/iu.test(
        readModelMigration,
      ),
    "indexed routes reject stale checkpoint, epoch and reorg generations",
  );

  const accountMutation = source("app/api/explore/profile/claim/route.ts");
  check(
    "source-cache-account-mutation",
    accountMutation.includes('"Cache-Control": "no-store"'),
    "account mutations are not cached",
  );
  const transactionPreparation = source("app/api/trade/prepare/route.ts");
  check(
    "source-cache-transaction-preparation",
    transactionPreparation.includes('"Cache-Control": "no-store"'),
    "transaction preparation is not cached",
  );

  const capture = source("scripts/perf/read-model-capture.mjs");
  const captureRoute = source(
    "app/api/ops/read-model-performance-capture/route.ts",
  );
  check(
    "source-release-capture-auth",
    capture.includes('"x-programmable-release-capture-signature"') &&
      capture.includes("const releaseSignature = createHmac(") &&
      capture.includes('.update(requestBody, "utf8")') &&
      captureRoute.includes("RELEASE_RATE_LIMIT_MS = 30_000") &&
      captureRoute.includes("RELEASE_REPLAY_TTL_MS = 60_000") &&
      captureRoute.includes('createHmac("sha256", secret)') &&
      captureRoute.includes("timingSafeEqual(expected, provided)"),
    "the 32-candidate release capture is HMAC-bound, replay-limited and rate-limited",
  );
  check(
    "source-release-probe-transport",
    capture.includes('headers["x-programmable-shadow-probe-signature"]') &&
      capture.includes('headers["x-programmable-shadow-probe"] = "1"') &&
      !capture.includes("x-programmable-shadow-probe-token"),
    "release probes send a signed capability and never transmit the secret",
  );
  check(
    "source-real-corpus-selection",
    capture.includes(
      "capturedRuntime.datasetManifest.keys.tokenAddresses",
    ) &&
      capture.includes(
        "capturedRuntime.datasetManifest.keys.accountAddresses",
      ) &&
      capture.includes("capturedRuntime.datasetManifest.keys.classicLaunches") &&
      capture.includes("capturedRuntime.datasetManifest.keys.stockLaunches") &&
      capture.includes('"accessEvidence"') &&
      !capture.includes("eligibleLaunches.map("),
    "the throughput run repeats attested deterministic samples instead of padding to cardinality",
  );
  const releaseProbe = source("scripts/perf/read-model-release-probe.mjs");
  check(
    "source-release-probe-payload",
    releaseProbe.includes(
      'const RELEASE_PROBE_SIGNATURE_VERSION = "programmable-release-probe-v1";',
    ) &&
      releaseProbe.includes("`${RELEASE_PROBE_SIGNATURE_VERSION}\\n${route}\\n${input.nonce}`") &&
      releaseProbe.includes('tokenDetail: "explore-token"') &&
      releaseProbe.includes('classicLaunchLookup: "launch-lookup"'),
    "release-probe HMACs are versioned and bound to the exact indexed route and nonce",
  );

  const routeCoordinator = source(
    "lib/data-pipeline/route-coordinator.server.ts",
  );
  const routeCoordinatorAst = parseTypeScript(
    "route-coordinator.server.ts",
    routeCoordinator,
  );
  const authorizeReleaseProbe = findFunctionLike(
    routeCoordinatorAst,
    "authorizeRouteReleaseProbe",
  );
  check(
    "source-release-probe-freshness",
    constantNumber(routeCoordinatorAst, "RELEASE_PROBE_MAX_AGE_MS") ===
      5 * 60 * 1_000 &&
      constantNumber(
        routeCoordinatorAst,
        "RELEASE_PROBE_MAX_FUTURE_SKEW_MS",
      ) === 30 * 1_000 &&
      containsIdentifier(authorizeReleaseProbe, "RELEASE_PROBE_MAX_AGE_MS") &&
      containsIdentifier(
        authorizeReleaseProbe,
        "RELEASE_PROBE_MAX_FUTURE_SKEW_MS",
      ) &&
      containsAwaitedCall(authorizeReleaseProbe, "consumeReleaseProbeNonce"),
    "release probes have a five-minute TTL, 30-second future skew, and await the distributed consume",
  );

  const nonceConsumer = source(
    "lib/data-pipeline/release-probe-nonce.server.ts",
  );
  const nonceConsumerAst = parseTypeScript(
    "release-probe-nonce.server.ts",
    nonceConsumer,
  );
  const nonceMigration = source(
    "supabase/migrations/20260731202904_release_probe_nonce_consumption.sql",
  );
  check(
    "source-release-probe-distributed-replay",
    findVariableInitializer(nonceConsumerAst, "RELEASE_PROBE_ROLE")?.text ===
      "programmable_release_probe_nonce" &&
      findVariableInitializer(nonceConsumerAst, "RELEASE_PROBE_LOGIN")?.text ===
        "programmable_release_probe_nonce_login" &&
      containsIdentifier(nonceConsumerAst, "releaseProbeConnectionString") &&
      /maxConnections\s*:\s*1\b/u.test(nonceConsumer) &&
      /primary\s+key\s*\(\s*route_key\s*,\s*nonce_digest\s*\)/iu.test(
        nonceMigration,
      ) &&
      /expires_at\s*<=\s*issued_at\s*\+\s*interval\s*'5 minutes'/iu.test(
        nonceMigration,
      ) &&
      /session_user::text\s*<>\s*'programmable_release_probe_nonce_login'/iu.test(
        nonceMigration,
      ) &&
      /active_role\s+is\s+distinct\s+from\s+'programmable_release_probe_nonce'/iu.test(
        nonceMigration,
      ),
    "one dedicated database identity atomically consumes each route-bound nonce",
  );

  const publicRouteReadiness = source(
    "lib/data-pipeline/public-route-readiness.server.ts",
  );
  const publicRouteReadinessAst = parseTypeScript(
    "public-route-readiness.server.ts",
    publicRouteReadiness,
  );
  const preparePublicRouteRequest = findFunctionLike(
    publicRouteReadinessAst,
    "preparePublicRouteRequest",
  );
  check(
    "source-release-probe-private-failure",
    containsAwaitedCall(
      preparePublicRouteRequest,
      "authorizeRouteReleaseProbe",
    ) &&
      /status\s*:\s*503\b/u.test(publicRouteReadiness) &&
      /["']Cache-Control["']\s*:\s*["']private, no-store["']/u.test(
        publicRouteReadiness,
      ) &&
      /["']Retry-After["']\s*:\s*["']1["']/u.test(publicRouteReadiness),
    "nonce-store failures stay private and fail closed with a retryable 503",
  );
  check(
    "source-release-probe-replay-validation",
    containsConditionalDelete(
      preparePublicRouteRequest,
      "SHADOW_PROBE_QUERY_PARAMETER",
      "releaseProbe",
    ),
    "only an authorized probe removes the reserved query parameter; replays reach ordinary validation",
  );

  const releaseProbeResponseFunction = findFunctionLike(
    routeCoordinatorAst,
    "releaseProbeResponse",
  );
  const fallbackResponseFunction = findFunctionLike(
    routeCoordinatorAst,
    "fallbackResponse",
  );
  check(
    "source-release-probe-selected-provenance",
    containsIdentifier(releaseProbeResponseFunction, "response") &&
      containsCall(fallbackResponseFunction, "provenanceHeaders") &&
      routeCoordinator
        .toLowerCase()
        .includes("x-programmable-read-source") &&
      !containsIdentifier(releaseProbeResponseFunction, "PROJECTION_HEADERS") &&
      !/headers\.delete\(\s*["']x-programmable-read-source["']\s*\)/iu.test(
        routeCoordinator,
      ),
    "release probes retain the selected indexed, RPC, or blob provenance header",
  );

  return {
    ok: failures.length === 0,
    checks,
    failures,
  };
}
