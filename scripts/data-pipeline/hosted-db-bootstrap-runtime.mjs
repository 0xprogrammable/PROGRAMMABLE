import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { buildReviewedBootstrapPlan } from "./bootstrap-evidence.mjs";
import { canonicalJson, sha256 } from "./hosted-db-operator-core.mjs";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const RELEASE_BINDING_PATH = "config/data-pipeline-release.v1.json";
const BOOTSTRAP_CATALOG_PATH = "config/data-pipeline-bootstrap.v1.json";
const CANDIDATE_ENVIO_PATH =
  "config/data-pipeline-envio-candidate.v1.json";
const NONZERO_BYTES32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;

function exactKeys(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson(expected.slice().sort())
  ) {
    throw new Error(`${label} shape is invalid`);
  }
}

function parseObject(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

async function readRepositoryFile(relativePath) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url));
}

function candidateEnvioEvidence(value, bytes) {
  exactKeys(
    value,
    [
      "schemaVersion",
      "status",
      "deploymentLabel",
      "graphqlEndpoint",
      "sourceCommit",
      "configSha256",
      "schemaSha256",
      "handlerSha256",
      "sourceRegistrySha256",
      "eventSetSha256",
      "eventCount",
      "redactedIdentity",
      "deploymentCommitment",
      "schemaCommitment",
      "audit",
      "policy",
    ],
    "candidate Envio evidence",
  );
  exactKeys(
    value.audit,
    [
      "entityCount",
      "entityCounts",
      "coordinatorRepairCount",
      "baselineEvidenceSha256",
      "candidateAuditEvidenceSha256",
    ],
    "candidate Envio audit evidence",
  );
  exactKeys(
    value.audit.entityCounts,
    ["ClassicLaunch", "ClassicPool", "StockLaunch", "StockPool", "Token"],
    "candidate Envio entity counts",
  );
  exactKeys(
    value.policy,
    [
      "databaseMode",
      "legacyProductionDeploymentRegistered",
      "publicationAllowedBeforePromotion",
      "promotion",
    ],
    "candidate Envio policy evidence",
  );
  const commitments = [
    "configSha256",
    "schemaSha256",
    "handlerSha256",
    "sourceRegistrySha256",
    "eventSetSha256",
    "deploymentCommitment",
    "schemaCommitment",
  ];
  if (
    value.schemaVersion !== 1 ||
    value.status !== "deployed-synced-audited-not-promoted" ||
    !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(value.deploymentLabel ?? "") ||
    value.redactedIdentity !== `envio:${value.deploymentLabel}` ||
    !/^https:\/\/indexer\.hyperindex\.xyz\/[a-z0-9]{7,64}\/v1\/graphql$/u.test(
      value.graphqlEndpoint ?? "",
    ) ||
    !/^[0-9a-f]{40}$/u.test(value.sourceCommit ?? "") ||
    commitments.some((field) => !NONZERO_BYTES32.test(value[field] ?? "")) ||
    !Number.isSafeInteger(value.eventCount) ||
    value.eventCount < 1 ||
    !Number.isSafeInteger(value.audit.entityCount) ||
    value.audit.entityCount < 1 ||
    !Number.isSafeInteger(value.audit.coordinatorRepairCount) ||
    value.audit.coordinatorRepairCount < 0 ||
    Object.values(value.audit.entityCounts).some(
      (count) => !Number.isSafeInteger(count) || count < 0,
    ) ||
    Object.values(value.audit.entityCounts).reduce(
      (total, count) => total + count,
      0,
    ) !== value.audit.entityCount ||
    !NONZERO_BYTES32.test(value.audit.baselineEvidenceSha256 ?? "") ||
    !NONZERO_BYTES32.test(value.audit.candidateAuditEvidenceSha256 ?? "") ||
    value.policy.databaseMode !== "candidate-only" ||
    value.policy.legacyProductionDeploymentRegistered !== false ||
    value.policy.publicationAllowedBeforePromotion !== false ||
    value.policy.promotion !== "atomic-attestation-required"
  ) {
    throw new Error("candidate Envio evidence is incomplete");
  }
  return Object.freeze({
    path: CANDIDATE_ENVIO_PATH,
    fileSha256: sha256(bytes),
    status: value.status,
    deploymentLabel: value.deploymentLabel,
    graphqlEndpoint: value.graphqlEndpoint,
    sourceCommit: value.sourceCommit,
    redactedIdentity: value.redactedIdentity,
    deploymentCommitment: value.deploymentCommitment,
    schemaCommitment: value.schemaCommitment,
    auditEvidenceCommitment: sha256(
      `programmable:data-pipeline:envio-candidate-audit:v1\0${canonicalJson(
        value.audit,
      )}`,
    ),
    policyCommitment: sha256(
      `programmable:data-pipeline:envio-candidate-policy:v1\0${canonicalJson(
        value.policy,
      )}`,
    ),
  });
}

async function withRuntimeModules(run) {
  const vite = await createServer({
    root: workspace,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
    ssr: { noExternal: ["server-only"] },
    plugins: [
      {
        name: "hosted-db-bootstrap-server-only-boundary",
        enforce: "pre",
        resolveId(id) {
          return id === "server-only" ? "\0operator-server-only" : null;
        },
        load(id) {
          return id === "\0operator-server-only" ? "export {};" : null;
        },
      },
    ],
  });
  try {
    const [
      releaseModule,
      rpcModule,
      marketModule,
      eventModule,
      foldModule,
    ] = await Promise.all([
      vite.ssrLoadModule("/lib/data-pipeline/release-binding.server.ts"),
      vite.ssrLoadModule("/lib/data-pipeline/rpc-providers.server.ts"),
      vite.ssrLoadModule(
        "/lib/data-pipeline/market-projector-runtime.server.ts",
      ),
      vite.ssrLoadModule("/lib/data-pipeline/event-manifest.ts"),
      vite.ssrLoadModule("/lib/data-pipeline/projector-fold.ts"),
    ]);
    return await run({
      releaseModule,
      rpcModule,
      marketModule,
      eventModule,
      foldModule,
    });
  } finally {
    await vite.close();
  }
}

export async function createBootstrapPlan({
  repositoryCommit,
  environment = process.env,
  createdAt,
}) {
  const [bindingBytes, catalogBytes, candidateBytes] = await Promise.all([
    readRepositoryFile(RELEASE_BINDING_PATH),
    readRepositoryFile(BOOTSTRAP_CATALOG_PATH),
    readRepositoryFile(CANDIDATE_ENVIO_PATH),
  ]);
  const catalog = parseObject(catalogBytes, "bootstrap semantic catalog");
  const candidate = candidateEnvioEvidence(
    parseObject(candidateBytes, "candidate Envio evidence"),
    candidateBytes,
  );
  const planCreatedAt = createdAt ?? catalog.createdAt;

  return withRuntimeModules(async ({
    releaseModule,
    rpcModule,
    marketModule,
    eventModule,
    foldModule,
  }) => {
    const binding = releaseModule.getDataPipelineReleaseBinding();
    const rpcProviders = rpcModule.createProductionDualRpcProviders(environment);
    const rpcCommitments =
      rpcModule.productionRpcProjectorCommitments(environment);
    const providers = [
      Object.freeze({
        providerType: "envio_deployment",
        redactedIdentity: candidate.redactedIdentity,
        deploymentCommitment: candidate.deploymentCommitment,
        schemaCommitment: candidate.schemaCommitment,
      }),
      ...rpcProviders.map((provider) =>
        Object.freeze({
          providerType: "rpc_provider",
          redactedIdentity: `rpc:1:${provider.vendorGroup}`,
          vendor: provider.vendorGroup,
          chainId: 1,
          constructorVersion: "rpc-provider-v1",
          endpointUrlCommitment: provider.endpointCommitment,
          endpointOriginCommitment: provider.endpointOriginCommitment,
          endpointEvidenceDomain: "rpc-endpoint-commitments-v1",
          deploymentCommitment:
            rpcCommitments[provider.vendorGroup].deploymentCommitment,
          schemaCommitment:
            rpcCommitments[provider.vendorGroup].schemaCommitment,
        }),
      ),
      Object.freeze({
        providerType: "uniswap_subgraph",
        redactedIdentity:
          `uniswap-v4:ethereum:${binding.uniswapV4Subgraph.deployment}`,
        deploymentCommitment:
          marketModule.MARKET_GRAPH_DEPLOYMENT_COMMITMENT,
        schemaCommitment: marketModule.MARKET_GRAPH_SCHEMA_COMMITMENT,
        subgraphId: binding.uniswapV4Subgraph.subgraphId,
        deployment: binding.uniswapV4Subgraph.deployment,
      }),
    ];
    return buildReviewedBootstrapPlan({
      workspace,
      repositoryCommit,
      binding,
      bindingSha256: sha256(bindingBytes),
      providers,
      eventSignatures: eventModule.PROGRAMMABLE_EVENT_SIGNATURES,
      projectionRules: foldModule.projectorFoldProjectionRules(),
      createdAt: planCreatedAt,
      candidateEnvioEvidence: candidate,
    });
  });
}
