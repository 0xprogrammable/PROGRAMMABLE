import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import * as deployPolicy from "../../scripts/perf/read-model-deploy-policy.mjs";
// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import { PRODUCTION_RPC_ENV, runtimeProductionProviderBindingsFromUrls } from "../../scripts/perf/read-model-provider-binding.mjs";

const {
  createStagedReleaseAttestation,
  evaluateReadModelDeployPolicy,
  materializeVercelSensitiveRuntimePlaceholders,
  BITQUERY_MARKET_SECRET_ENV_NAME,
  PROJECTOR_WAKE_ROUTE,
  readReleasePolicyExpectations,
  validateStagedReleaseAttestation,
  QUICKNODE_STREAM_SECRET_ENV_NAME,
  RELEASE_GATED_FLAG_NAMES,
  REQUIRED_NON_SECRET_RUNTIME_ENV_NAMES,
  REQUIRED_SERVER_SECRET_ENV_NAMES,
  WORKER_ACTIVATION_FLAG_NAMES,
} = deployPolicy;

const ROOT = process.cwd();
const DRPC_URL = "https://lb.drpc.live/ethereum/abcdefgh";
const QUICKNODE_URL = "https://programmable.ethereum-mainnet.quiknode.pro/abcdefgh";
const EXPECTATIONS = readReleasePolicyExpectations(ROOT);
const PROVIDER_ENVIRONMENT = Object.freeze({
  [PRODUCTION_RPC_ENV.primaryProvider]: "drpc",
  [PRODUCTION_RPC_ENV.primaryUrl]: DRPC_URL,
  [PRODUCTION_RPC_ENV.secondaryProvider]: "quicknode",
  [PRODUCTION_RPC_ENV.secondaryUrl]: QUICKNODE_URL,
});
const PROVIDER_BINDINGS = runtimeProductionProviderBindingsFromUrls(
  PROVIDER_ENVIRONMENT,
);
const COMMITMENTS = Object.freeze({
  [PRODUCTION_RPC_ENV.primaryCommitment]:
    PROVIDER_BINDINGS.find(
      ({ vendorGroup }: { vendorGroup: string }) => vendorGroup === "drpc",
    ).endpointCommitment,
  [PRODUCTION_RPC_ENV.secondaryCommitment]:
    PROVIDER_BINDINGS.find(
      ({ vendorGroup }: { vendorGroup: string }) => vendorGroup === "quicknode",
    ).endpointCommitment,
});

function sensitiveProductionMetadata(name: string) {
  return {
    key: name,
    type: "sensitive",
    target: ["production"],
  };
}

function environmentFile(input: {
  indexed?: Partial<Record<string, string | undefined>>;
  workers?: Partial<Record<string, string | undefined>>;
  nonSecret?: Partial<Record<string, string | undefined>>;
  serverSecrets?: Partial<Record<string, string | undefined>>;
  includeRuntimeProviders?: boolean;
  drpcRuntime?: string | null;
} = {}) {
  const drpcRuntime = input.drpcRuntime === undefined
    ? DRPC_URL
    : input.drpcRuntime;
  const values: Record<string, string | undefined> = {
    ...Object.fromEntries(
      RELEASE_GATED_FLAG_NAMES.map((name: string) => [name, "false"]),
    ),
    ...Object.fromEntries(
      WORKER_ACTIVATION_FLAG_NAMES.map((name: string) => [name, "false"]),
    ),
    ...EXPECTATIONS,
    ...COMMITMENTS,
    ...Object.fromEntries(
      REQUIRED_SERVER_SECRET_ENV_NAMES.map((name: string) => [
        name,
        name === BITQUERY_MARKET_SECRET_ENV_NAME ? "[Sensitive]" : "",
      ]),
    ),
    [PRODUCTION_RPC_ENV.primaryProvider]: "drpc",
    [PRODUCTION_RPC_ENV.secondaryProvider]: "quicknode",
    ...(drpcRuntime === null
      ? {}
      : { [PRODUCTION_RPC_ENV.primaryUrl]: drpcRuntime }),
    ...((input.includeRuntimeProviders ?? true)
      ? { [PRODUCTION_RPC_ENV.secondaryUrl]: QUICKNODE_URL }
      : {}),
    ...input.indexed,
    ...input.workers,
    ...input.nonSecret,
    ...input.serverSecrets,
  };
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
}

describe("read-model production deploy policy", () => {
  it("attests current Vercel empty sensitive values from exact production metadata", () => {
    const contents = environmentFile({
      workers: { PROGRAMMABLE_PROJECTOR_ACTIVE: "true" },
      drpcRuntime: null,
      includeRuntimeProviders: false,
      serverSecrets: { [BITQUERY_MARKET_SECRET_ENV_NAME]: "" },
    }).concat(
      "\nPROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL=\nPROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL=",
    );
    const metadata = JSON.stringify({
      envs: [
        {
          key: "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL",
          type: "sensitive",
          target: ["production"],
        },
        {
          key: "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL",
          type: "sensitive",
          target: ["production"],
        },
        ...REQUIRED_SERVER_SECRET_ENV_NAMES.map(sensitiveProductionMetadata),
      ],
    });
    const materialized = materializeVercelSensitiveRuntimePlaceholders(
      contents,
      metadata,
    );
    expect(materialized).toContain(
      'PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL="[Sensitive]"',
    );
    expect(materialized).toContain(
      `${QUICKNODE_STREAM_SECRET_ENV_NAME}="[Sensitive]"`,
    );
    expect(
      evaluateReadModelDeployPolicy(materialized, COMMITMENTS, EXPECTATIONS),
    ).toMatchObject({
      policyReady: true,
      commitmentsReady: true,
      runtimeProviderBinding: "deferred-stage",
    });
  });

  it("rejects missing, non-sensitive, preview or value-bearing Vercel metadata", () => {
    const contents = environmentFile({ drpcRuntime: null }).concat(
      "\nPROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL=",
    );
    for (const entry of [
      undefined,
      {
        key: "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL",
        type: "plain",
        target: ["production"],
      },
      {
        key: "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL",
        type: "sensitive",
        target: ["preview"],
      },
      {
        key: "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL",
        type: "sensitive",
        target: ["production"],
        value: "must-not-be-present",
      },
    ]) {
      expect(() =>
        materializeVercelSensitiveRuntimePlaceholders(
          contents,
          JSON.stringify({
            envs: [
              ...(entry ? [entry] : []),
              ...REQUIRED_SERVER_SECRET_ENV_NAMES.map(
                sensitiveProductionMetadata,
              ),
            ],
          }),
        ),
      ).toThrow(/exact sensitive production metadata/u);
    }
  });

  it("requires exact sensitive QuickNode stream-secret metadata", () => {
    const contents = environmentFile();
    const exact = sensitiveProductionMetadata(
      QUICKNODE_STREAM_SECRET_ENV_NAME,
    );
    const otherSecrets = REQUIRED_SERVER_SECRET_ENV_NAMES
      .filter((name: string) => name !== QUICKNODE_STREAM_SECRET_ENV_NAME)
      .map(sensitiveProductionMetadata);
    for (const envs of [
      otherSecrets,
      [...otherSecrets, { ...exact, type: "plain" }],
      [...otherSecrets, { ...exact, type: "encrypted" }],
      [...otherSecrets, { ...exact, target: ["preview"] }],
      [...otherSecrets, { ...exact, target: ["production", "preview"] }],
      [...otherSecrets, { ...exact, value: "must-not-be-present" }],
      [...otherSecrets, exact, exact],
    ]) {
      expect(() =>
        materializeVercelSensitiveRuntimePlaceholders(
          contents,
          JSON.stringify({ envs }),
        ),
      ).toThrow(/exact sensitive production metadata/u);
    }
  });

  it("requires Bitquery as exact sensitive production metadata in every mode", () => {
    expect(BITQUERY_MARKET_SECRET_ENV_NAME).toBe("BITQUERY_OAUTH_TOKEN");
    expect(REQUIRED_SERVER_SECRET_ENV_NAMES).toContain(
      BITQUERY_MARKET_SECRET_ENV_NAME,
    );
    const otherSecrets = REQUIRED_SERVER_SECRET_ENV_NAMES
      .filter((name: string) => name !== BITQUERY_MARKET_SECRET_ENV_NAME)
      .map(sensitiveProductionMetadata);
    const exact = sensitiveProductionMetadata(BITQUERY_MARKET_SECRET_ENV_NAME);
    const withoutBitqueryLine = environmentFile({
      serverSecrets: { [BITQUERY_MARKET_SECRET_ENV_NAME]: undefined },
    });
    for (const entry of [
      undefined,
      { ...exact, type: "plain" },
      { ...exact, target: ["preview"] },
      { ...exact, target: ["production", "preview"] },
      { ...exact, value: "must-not-be-present" },
    ]) {
      expect(() =>
        materializeVercelSensitiveRuntimePlaceholders(
          withoutBitqueryLine,
          JSON.stringify({ envs: [...otherSecrets, ...(entry ? [entry] : [])] }),
        )
      ).toThrow(/BITQUERY_OAUTH_TOKEN is not exact sensitive production metadata/u);
    }
    expect(() =>
      materializeVercelSensitiveRuntimePlaceholders(
        withoutBitqueryLine,
        JSON.stringify({ envs: [...otherSecrets, exact, exact] }),
      )
    ).toThrow(/BITQUERY_OAUTH_TOKEN is not exact sensitive production metadata/u);

    const materialized = materializeVercelSensitiveRuntimePlaceholders(
      withoutBitqueryLine,
      JSON.stringify({ envs: [...otherSecrets, exact] }),
    );
    expect(materialized).toContain('BITQUERY_OAUTH_TOKEN="[Sensitive]"');
    expect(
      evaluateReadModelDeployPolicy(materialized, COMMITMENTS, EXPECTATIONS),
    ).toMatchObject({
      mode: "direct-rpc",
      policyReady: true,
      invalidServerSecretEnvironmentNames: [],
    });

    const missingRuntimeToken = evaluateReadModelDeployPolicy(
      withoutBitqueryLine,
      COMMITMENTS,
      EXPECTATIONS,
    );
    expect(missingRuntimeToken.policyReady).toBe(false);
    expect(missingRuntimeToken.invalidServerSecretEnvironmentNames).toEqual([
      BITQUERY_MARKET_SECRET_ENV_NAME,
    ]);
  });

  it("preserves a materialized QuickNode stream secret byte-for-byte", () => {
    const contents = environmentFile({
      serverSecrets: {
        [QUICKNODE_STREAM_SECRET_ENV_NAME]: "x".repeat(32),
      },
    });
    expect(
      materializeVercelSensitiveRuntimePlaceholders(
        contents,
        JSON.stringify({
          envs: [sensitiveProductionMetadata(BITQUERY_MARKET_SECRET_ENV_NAME)],
        }),
      ),
    ).toBe(contents);
  });

  it("binds dRPC-only to exact false indexed flags and disabled workers", () => {
    const policy = evaluateReadModelDeployPolicy(
      environmentFile({
        workers: { PROGRAMMABLE_PROJECTOR_ACTIVE: undefined },
      }),
      COMMITMENTS,
      EXPECTATIONS,
    );
    expect(policy).toMatchObject({
      mode: "direct-rpc",
      evidenceRequired: false,
      policyReady: true,
      commitmentsReady: true,
      indexedFlags: Object.fromEntries(
        RELEASE_GATED_FLAG_NAMES.map((name: string) => [name, false]),
      ),
      workerActivationFlags: {
        PROGRAMMABLE_PROJECTOR_ACTIVE: false,
        PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE: false,
      },
    });
  });

  it("requires one exact dRPC Mainnet RPC for dRPC-only", () => {
    for (const drpcRuntime of [
      null,
      "",
      "https://programmable.ethereum-mainnet.quiknode.pro/abcdefgh",
      "https://lb.drpc.live/ethereum/docs-demo",
    ]) {
      const policy = evaluateReadModelDeployPolicy(
        environmentFile({ drpcRuntime }),
        COMMITMENTS,
        EXPECTATIONS,
      );
      expect(policy).toMatchObject({
        mode: "direct-rpc",
        policyReady: false,
      });
      expect(policy.invalidProductionRpcRuntimeEnvironmentNames).toContain(
        "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL",
      );
    }

    expect(
      evaluateReadModelDeployPolicy(
        environmentFile({
          drpcRuntime: "[Sensitive]",
          includeRuntimeProviders: false,
        }).concat(
          '\nPROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL="[Sensitive]"',
        ),
        COMMITMENTS,
        EXPECTATIONS,
      ),
    ).toMatchObject({
      mode: "direct-rpc",
      policyReady: true,
      runtimeProviderBinding: "deferred-stage",
    });
  });

  it("treats either active worker as an evidence-gated runtime", () => {
    for (const worker of WORKER_ACTIVATION_FLAG_NAMES) {
      const policy = evaluateReadModelDeployPolicy(
        environmentFile({
          workers: { [worker]: "true" },
          serverSecrets: {
            [QUICKNODE_STREAM_SECRET_ENV_NAME]: "[sensitive]",
          },
          includeRuntimeProviders: true,
        }),
        COMMITMENTS,
        EXPECTATIONS,
      );
      expect(policy).toMatchObject({
        mode: "indexed-or-shadow",
        evidenceRequired: true,
        policyReady: true,
        commitmentsReady: true,
        runtimeProviderBinding: "verified",
        wakeRoute: "/api/ops/projector-wake",
        wakeCanaryRequired: true,
        streamSecretReady: true,
      });
      expect(policy.nonLegacyFlags).toContain(worker);
    }
  });

  it("requires a bounded server-only stream secret for an active worker", () => {
    for (const value of [undefined, "too-short", "x".repeat(1_025)]) {
      const policy = evaluateReadModelDeployPolicy(
        environmentFile({
          workers: { PROGRAMMABLE_PROJECTOR_ACTIVE: "true" },
          serverSecrets: {
            [QUICKNODE_STREAM_SECRET_ENV_NAME]: value,
          },
          includeRuntimeProviders: true,
        }),
        COMMITMENTS,
        EXPECTATIONS,
      );
      expect(policy).toMatchObject({
        policyReady: false,
        wakeCanaryRequired: true,
        streamSecretReady: false,
        invalidServerSecretEnvironmentNames: [
          QUICKNODE_STREAM_SECRET_ENV_NAME,
        ],
      });
    }

    for (const value of ["[sensitive]", "x".repeat(32)]) {
      const policy = evaluateReadModelDeployPolicy(
        environmentFile({
          workers: { PROGRAMMABLE_PROJECTOR_ACTIVE: "true" },
          serverSecrets: {
            [QUICKNODE_STREAM_SECRET_ENV_NAME]: value,
          },
          includeRuntimeProviders: true,
        }),
        COMMITMENTS,
        EXPECTATIONS,
      );
      expect(policy).toMatchObject({
        policyReady: true,
        wakeCanaryRequired: true,
        streamSecretReady: true,
        invalidServerSecretEnvironmentNames: [],
      });
    }
  });

  it("fails closed on ambiguous flags and missing or drifted provenance", () => {
    const ambiguous = evaluateReadModelDeployPolicy(
      environmentFile({
        workers: { PROGRAMMABLE_PROJECTOR_ACTIVE: "TRUE" },
        includeRuntimeProviders: true,
      }),
      COMMITMENTS,
      EXPECTATIONS,
    );
    expect(ambiguous.policyReady).toBe(false);
    expect(ambiguous.invalidFlagNames).toEqual([
      "PROGRAMMABLE_PROJECTOR_ACTIVE",
    ]);

    const missingIndexedFlag = environmentFile()
      .split("\n")
      .filter((line) => !line.startsWith(`${RELEASE_GATED_FLAG_NAMES[0]}=`))
      .join("\n");
    const missing = evaluateReadModelDeployPolicy(
      missingIndexedFlag,
      COMMITMENTS,
      EXPECTATIONS,
    );
    expect(missing.policyReady).toBe(false);
    expect(missing.invalidFlagNames).toContain(RELEASE_GATED_FLAG_NAMES[0]);

    for (const name of REQUIRED_NON_SECRET_RUNTIME_ENV_NAMES) {
      const drifted = evaluateReadModelDeployPolicy(
        environmentFile({
          indexed: { [RELEASE_GATED_FLAG_NAMES[0]]: "true" },
          nonSecret: { [name]: undefined },
          includeRuntimeProviders: true,
        }),
        COMMITMENTS,
        EXPECTATIONS,
      );
      expect(drifted.policyReady).toBe(false);
      expect(drifted.invalidNonSecretEnvironmentNames).toContain(name);
    }
    const wrongGraph = evaluateReadModelDeployPolicy(
      environmentFile({
        indexed: { [RELEASE_GATED_FLAG_NAMES[0]]: "true" },
        nonSecret: {
          PROGRAMMABLE_UNISWAP_GRAPH_SCHEMA_COMMITMENT: `0x${"00".repeat(32)}`,
        },
        includeRuntimeProviders: true,
      }),
      COMMITMENTS,
      EXPECTATIONS,
    );
    expect(wrongGraph.policyReady).toBe(false);
    expect(wrongGraph.invalidNonSecretEnvironmentNames).toContain(
      "PROGRAMMABLE_UNISWAP_GRAPH_SCHEMA_COMMITMENT",
    );
  });

  it("creates a canonical non-secret attestation for the exact staged target", () => {
    const policy = evaluateReadModelDeployPolicy(
      environmentFile(),
      COMMITMENTS,
      EXPECTATIONS,
    );
    const result = createStagedReleaseAttestation({
      policy,
      verifiedSha: "a".repeat(40),
      vercelProjectId: "prj_1234567890abcdef",
      stagedDeploymentId: `dpl_${"b".repeat(24)}`,
      stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
      productionOrigin: "https://programmable.market",
      expectedMode: "direct-rpc",
      timestamp: "2026-08-01T12:34:56.000Z",
    });
    expect(JSON.parse(result.json)).toEqual({
      schemaVersion: 1,
      verifiedSha: "a".repeat(40),
      vercelProjectId: "prj_1234567890abcdef",
      stagedDeploymentId: `dpl_${"b".repeat(24)}`,
      stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
      productionOrigin: "https://programmable.market",
      policyMode: "direct-rpc",
      indexedFlags: policy.indexedFlags,
      workerActivationFlags: policy.workerActivationFlags,
      timestamp: "2026-08-01T12:34:56.000Z",
    });
    expect(result.sha256).toBe(
      createHash("sha256").update(result.json, "utf8").digest("hex"),
    );
    expect(result.json).not.toMatch(/(?:password|postgresql:\/\/)/iu);
    expect(
      validateStagedReleaseAttestation(JSON.parse(result.json), {
        verifiedSha: "a".repeat(40),
        vercelProjectId: "prj_1234567890abcdef",
        stagedDeploymentId: `dpl_${"b".repeat(24)}`,
        stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
        productionOrigin: "https://programmable.market",
        nowMs: Date.parse("2026-08-01T12:35:00.000Z"),
      }),
    ).toEqual(JSON.parse(result.json));
  });

  it("rejects stale, mutated or publicly exposed cutover attestations", () => {
    const policy = evaluateReadModelDeployPolicy(
      environmentFile({
        indexed: Object.fromEntries(
          RELEASE_GATED_FLAG_NAMES.map((name: string) => [
            name,
            name === "INDEXED_READ_SHADOW_COMPARE_ENABLED" ? "false" : "true",
          ]),
        ),
        workers: Object.fromEntries(
          WORKER_ACTIVATION_FLAG_NAMES.map((name: string) => [name, "true"]),
        ),
        serverSecrets: {
          [QUICKNODE_STREAM_SECRET_ENV_NAME]: "[sensitive]",
        },
        includeRuntimeProviders: true,
      }),
      COMMITMENTS,
      EXPECTATIONS,
    );
    const value = JSON.parse(
      createStagedReleaseAttestation({
        policy,
        verifiedSha: "a".repeat(40),
        vercelProjectId: "prj_1234567890abcdef",
        stagedDeploymentId: `dpl_${"b".repeat(24)}`,
        stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
        productionOrigin: "https://programmable.market",
        expectedMode: "indexed-or-shadow",
        timestamp: "2026-08-01T12:34:56.000Z",
      }).json,
    );
    const expected = {
      verifiedSha: value.verifiedSha,
      vercelProjectId: value.vercelProjectId,
      stagedDeploymentId: value.stagedDeploymentId,
      stagedDeploymentUrl: value.stagedDeploymentUrl,
      productionOrigin: value.productionOrigin,
      requireWorkersActive: true,
      requireIndexedRoutesActive: true,
      nowMs: Date.parse("2026-08-01T12:35:00.000Z"),
    };
    expect(() =>
      validateStagedReleaseAttestation(
        { ...value, verifiedSha: "c".repeat(40) },
        expected,
      ),
    ).toThrow("verifiedSha does not match");
    expect(() =>
      validateStagedReleaseAttestation(
        {
          ...value,
          indexedFlags: {
            ...value.indexedFlags,
            INDEXED_EXPLORE_LIST_READS_ENABLED: false,
          },
        },
        expected,
      ),
    ).toThrow("does not activate exact indexed routes");
    expect(() =>
      validateStagedReleaseAttestation(value, {
        ...expected,
        nowMs: Date.parse("2026-08-02T12:35:00.000Z"),
      }),
    ).toThrow("timestamp is invalid");
  });

  it("rejects an attestation for a different mode, target or project", () => {
    const policy = evaluateReadModelDeployPolicy(
      environmentFile(),
      COMMITMENTS,
      EXPECTATIONS,
    );
    const valid = {
      policy,
      verifiedSha: "a".repeat(40),
      vercelProjectId: "prj_1234567890abcdef",
      stagedDeploymentId: `dpl_${"b".repeat(24)}`,
      stagedDeploymentUrl: "https://programmable-stage-abc.vercel.app",
      productionOrigin: "https://programmable.market",
      expectedMode: "direct-rpc",
      timestamp: "2026-08-01T12:34:56.000Z",
    };
    expect(() =>
      createStagedReleaseAttestation({
        ...valid,
        expectedMode: "indexed-or-shadow",
      }),
    ).toThrow("runtime mode");
    expect(() =>
      createStagedReleaseAttestation({
        ...valid,
        stagedDeploymentUrl: "https://programmable.market",
      }),
    ).toThrow("deployment-specific Vercel host");
    expect(() =>
      createStagedReleaseAttestation({
        ...valid,
        productionOrigin: "https://programmable.market/",
      }),
    ).toThrow("canonical Programmable domain");
    expect(() =>
      createStagedReleaseAttestation({
        ...valid,
        productionOrigin: "https://programmable.family",
      }),
    ).toThrow("canonical Programmable domain");
    expect(() =>
      createStagedReleaseAttestation({
        ...valid,
        vercelProjectId: "other-project",
      }),
    ).toThrow("project ID");
  });

  it("publishes every exact non-secret runtime name in the env schema", () => {
    const example = readFileSync(resolve(ROOT, ".env.example"), "utf8");
    for (const name of [
      ...WORKER_ACTIVATION_FLAG_NAMES,
      ...REQUIRED_NON_SECRET_RUNTIME_ENV_NAMES,
      ...REQUIRED_SERVER_SECRET_ENV_NAMES,
    ]) {
      expect(example.match(new RegExp(`^${name}=`, "gmu"))).toHaveLength(1);
      expect(example).not.toContain(`NEXT_PUBLIC_${name}`);
    }
    for (const [name, value] of Object.entries(EXPECTATIONS)) {
      expect(example).toContain(`${name}=${value}`);
    }
    expect(example).toContain(`${QUICKNODE_STREAM_SECRET_ENV_NAME}=\n`);
    expect(PROJECTOR_WAKE_ROUTE).toBe("/api/ops/projector-wake");
  });

  it.skip("retired multi-provider market evidence stage contract", () => {
    const workflow = readFileSync(
      resolve(ROOT, ".github/workflows/deploy-production.yml"),
      "utf8",
    );
    expect(workflow).toContain("Attest exact staged release policy");
    expect(workflow).toContain(
      "Capture sensitive production environment metadata",
    );
    expect(workflow).toContain(
      'vercel env ls production --format json --token="$VERCEL_TOKEN" | node scripts/bind-vercel-sensitive-production-metadata.mjs',
    );
    expect(workflow).not.toContain(
      'vercel env ls production --format json --token="$VERCEL_TOKEN" >',
    );
    expect(workflow).toContain(
      'vercel env ls production --format json --token="$VERCEL_TOKEN" |',
    );
    expect(workflow).toContain("set -o pipefail");
    expect(workflow).toContain(
      '--metadata-file "$RUNNER_TEMP/vercel-production-env-metadata.json"',
    );
    expect(workflow).not.toContain(
      '> "$RUNNER_TEMP/vercel-production-env-metadata.json"',
    );
    expect(workflow.match(/--sensitive-env-metadata/g)).toHaveLength(2);
    expect(workflow).toContain("staged-release-attestation.json");
    expect(workflow).toContain("attestation_sha256");
    expect(workflow).toContain("Smoke staged public market APIs");
    expect(workflow).toContain(
      "if: needs.release-gate.outputs.verified_read_model == 'true' && steps.read-model-policy.outputs.mode == 'direct-rpc'",
    );
    expect(workflow).toContain(
      '"x-vercel-protection-bypass": automationBypassSecret',
    );
    expect(workflow).toContain("headers: bitquerySmokeRequestHeaders");
    expect(workflow).toContain(
      'readSources: Object.freeze(["operational+durable+postgres"]),',
    );
    expect(workflow).toContain(
      'marketSources: Object.freeze([currentPublicMarketSource]),',
    );
    expect(workflow).toContain(
      'priceSources: Object.freeze(["stateview-chainlink"]),',
    );
    expect(workflow).toContain(
      'dataQualities: Object.freeze(["complete", "partial", "stale"]),',
    );
    expect(workflow).toContain("rpcProviders: null");
    expect(workflow).not.toContain("drpcIdentityContract");
    expect(workflow).toContain('"x-programmable-market-source",');
    expect(workflow).toContain('"x-programmable-price-source",');
    expect(workflow).toContain('"x-programmable-market-as-of",');
    expect(workflow).toContain('"x-programmable-data-quality",');
    expect(workflow).toContain(
      "!headerMatches(rpcProvider, contract.rpcProviders)",
    );
    expect(workflow).toContain(
      "!headerMatches(marketSource, contract.marketSources)",
    );
    expect(workflow).toContain(
      "!headerMatches(priceSource, contract.priceSources)",
    );
    expect(workflow).not.toContain(
      'response.headers.get("x-programmable-rpc-provider") !== "drpc"',
    );
    expect(workflow).not.toContain('"/api/indexers/v1/token-list"');
    expect(workflow).toContain(
      '`/api/explore?limit=${marketCapPageSize}&page=1&sort=market-cap`,\n            currentPublicMarketContract,',
    );
    expect(workflow).toContain("marketCapTotal > maximumMarketCapTokens");
    expect(workflow).toContain("marketCapTokens.length !== marketCapTotal");
    expect(workflow).toContain("seenMarketCapIds.has(token.id)");
    expect(workflow).toContain("seenMarketCapAddresses.has(address)");
    expect(workflow).toContain("entry.launchCategoryProvenance.blockNumber");
    expect(workflow).toContain(
      "entry.launchCategoryProvenance.transactionIndex",
    );
    expect(workflow).toContain("entry.launchCategoryProvenance.logIndex");
    expect(workflow).toContain(
      "staged Bitquery newest entry has no canonical launch order",
    );
    expect(workflow).toContain("coordinates === null");
    expect(workflow).toContain("const newestPageSize = 100");
    expect(workflow).toContain("seenNewestIds");
    expect(workflow).toContain("newestTokens.length !== newestTotal");
    expect(workflow).toContain("launchChainId(entry) !== newestChainId");
    expect(workflow).toContain("sort=oldest");
    expect(workflow).toContain(
      "staged Bitquery oldest page is not ordered oldest-first",
    );
    expect(workflow).toContain("/api/explore/token?address=");
    expect(workflow).toContain(
      "/api/explore/token/chart?address=${goldenTokenAddress}&range=all",
    );
    expect(workflow).toContain(
      "staged Explore exposed the non-public PCAN release canary",
    );
    expect(workflow).toContain("goldenSearch.total !== 0");
    expect(workflow).toContain(
      '"0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce"',
    );
    expect(workflow).toContain(
      '"0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229"',
    );
    expect(workflow).toContain(
      'goldenMarket?.schemaVersion !== "programmable.market-data.v1"',
    );
    expect(workflow).toContain(
      'goldenChart.schemaVersion !== "programmable.market-chart.v1"',
    );
    expect(workflow).toContain(
      "goldenChart.identity?.quoteAddress,\n              goldenQuoteAddress",
    );
    expect(workflow).toContain(
      "staged Bitquery Highest FDV is not monotonically descending",
    );
    expect(workflow).toContain(
      "staged Bitquery Explore exposed unevidenced numeric FDV",
    );
    expect(workflow).toContain(
      'valuation.reason === "waiting-for-first-trade"',
    );
    expect(workflow).toContain("if (currentFdvCount < 1) {");
    expect(workflow).toContain(
      "staged public market path has no current non-PCAN FDV bound to fresh official v4 liquidity",
    );
    expect(workflow).toContain(
      'valuation.source !== "stateview-chainlink"',
    );
    expect(workflow).toContain(
      'price?.source !== "uniswap-v4-stateview-chainlink-v1"',
    );
    expect(workflow).toContain(
      'liquidity?.source !== "official-uniswap-v4-subgraph"',
    );
    expect(workflow).toContain(
      "provenance?.subgraphId !== officialV4SubgraphId",
    );
    expect(workflow).toContain(
      "provenance?.deployment !== officialV4SubgraphDeployment",
    );
    expect(workflow).toContain(
      "BigInt(liquidity.tvlUsdWad) <",
    );
    expect(workflow).toContain(
      'token.launchModel !== "classic"',
    );
    expect(workflow).toContain(
      "staged current detail does not independently prove an equal or newer evidence bundle",
    );
    expect(workflow).toContain("price.activeVirtualToken0Wei");
    expect(workflow).toContain(
      '"stateview-active-liquidity-virtual-depth-usd"',
    );
    expect(workflow).toContain(
      'goldenValuation.metric !== "fdv"',
    );
    expect(workflow).toContain(
      'goldenValuation.supplyBasis !== "total"',
    );
    expect(workflow).toContain(
      '"./scripts/perf/bitquery-golden-market-parity.mjs"',
    );
    expect(workflow).toContain(
      '"./scripts/perf/bitquery-historical-release-gate.mjs"',
    );
    expect(workflow).toContain(
      "await verifyBitqueryGoldenMarketExecutionV1({",
    );
    expect(workflow).toContain("const historicalPaidPathVerified =");
    expect(workflow).toContain(
      "verifyBitqueryHistoricalGoldenReleaseV2({",
    );
    expect(workflow).toContain(
      "historicalGoldenRelease.confirmations >= 12",
    );
    expect(workflow).toContain('goldenChart.readStatus !== "live"');
    expect(workflow).toContain('goldenChart.readStatus === "live"');
    expect(workflow).not.toContain(
      "currentFdvCount < 1 && !historicalPaidPathVerified",
    );
    expect(workflow).toContain(
      "goldenChart.asOfTime !== goldenChart.points.at(-1)?.observedAt",
    );
    expect(workflow).toContain(
      'goldenChart.valuation?.status !== "unavailable"',
    );
    expect(workflow).toContain(
      'goldenChart.valuation?.reason !== "source-unavailable"',
    );
    expect(workflow).toContain('"fdvUsdWad" in goldenChart');
    expect(workflow).toContain('"valuationMetric" in goldenChart');
    expect(workflow).toContain(
      'point?.valueSemantics !== "period-median"',
    );
    expect(workflow).toContain(
      "staged PCAN chart is not a strictly ordered positive history",
    );
    const bitquerySmoke = workflow.slice(
      workflow.indexOf("Smoke staged public market APIs"),
      workflow.indexOf("Record registry identity and combined market path"),
    );
    expect(bitquerySmoke).toContain(
      'vercel env run --environment=production --token="$VERCEL_TOKEN" --',
    );
    expect(bitquerySmoke).toContain(
      "VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}",
    );
    expect(bitquerySmoke).not.toContain(
      "node --env-file=.vercel/.env.production.local",
    );
    expect(bitquerySmoke).toContain("runtimeProductionProviderEndpoints");
    expect(bitquerySmoke).not.toContain("ethereum-rpc.publicnode.com");
    expect(bitquerySmoke).not.toContain("rpc.mevblocker.io");
    expect(bitquerySmoke).toContain("rpcUrls: independentRpcUrls");
    expect(bitquerySmoke).not.toContain("MAINNET_RPC_URL_A");
    expect(bitquerySmoke).not.toContain("MAINNET_RPC_URL_B");
    expect(bitquerySmoke).not.toContain(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT",
    );
    expect(bitquerySmoke).not.toContain(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT",
    );
    expect(bitquerySmoke).not.toContain(
      "runtimeProductionProviderBindingsFromUrls",
    );
    expect(bitquerySmoke).toContain(
      '"./scripts/perf/read-model-provider-binding.mjs"',
    );
    expect(bitquerySmoke).toContain(
      "/api/explore?limit=20&page=1&q=${goldenTokenAddress}&sort=market-cap",
    );
    expect(bitquerySmoke.match(/historicalBitqueryMarketContract/g)).toHaveLength(3);
    expect(bitquerySmoke.match(/bitqueryChartContract/g)).toHaveLength(3);
    expect(bitquerySmoke).not.toContain("drpcIdentityContract");
    expect(bitquerySmoke).not.toContain("/api/ops/health");
    expect(bitquerySmoke).not.toContain("/api/explore/profile");
    expect(bitquerySmoke).not.toMatch(
      /\b(?:database|projector|quicknode|envio|real-block|sla)\b/iu,
    );
    expect(workflow).toContain("Reverify staged candidate binding");
    expect(workflow).toContain("Record staged candidate handoff");
    expect(workflow).toContain(
      "Stage-only: no production promotion was attempted.",
    );
    expect(workflow).not.toContain("vercel promote");
    expect(workflow).not.toContain("vercel rollback");
  });
});
