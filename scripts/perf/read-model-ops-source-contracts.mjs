#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APPROVED_OPERATIONS = Object.freeze({
  legacyIndexer: Object.freeze({
    path: "/api/ops/index-v2",
    schedule: "*/5 * * * *",
    retainedUntil: "indexed-read-cutover",
    route: "app/api/ops/index-v2/route.ts",
    sha256: "2d0731780d7c1eba7bbb087ffabb751f1e948783d84954c4041a9f342abcfce0",
    schedulerWatchdog: Object.freeze({
      provider: "github-actions",
      workflow: Object.freeze({
        path: ".github/workflows/refresh-production-read-model.yml",
        sha256: "3da07d2ec2ae59991aea77da64c0552e8d9fc7ed96a7d6b9130bdc469d7cc9c6",
      }),
      nodeRuntime: Object.freeze({
        setupAction: "actions/setup-node",
        setupActionSha: "820762786026740c76f36085b0efc47a31fe5020",
        setupActionRelease: "v7.0.0",
        version: "24.14.0",
        dependencyCache: false,
      }),
      schedule: "2-57/5 * * * *",
      targetOrigin: "https://programmable.market",
      environment: "production",
      secretEnvironment: "CRON_SECRET",
      concurrencyGroup: "production-read-model-refresh",
      freshnessMaximumAgeSeconds: 600,
      rpcProof: Object.freeze({
        confirmedBlockRequired: true,
        providerPairRequired: true,
        maximumHeadAgeSeconds: 300,
        healthRoute: Object.freeze({
          path: "app/api/ops/health/route.ts",
          sha256: "fda037f55c3c633a860c11eb65a160eaffc77e66489f803e9933ad3b02926f3f",
        }),
        rpcRuntime: Object.freeze({
          path: "lib/onchain/rpc-health.ts",
          sha256: "7315f82e8d0904941c9cdd6840a79b6720e6a73a99edeb44ce71bb0486d8596e",
        }),
        deploymentConfig: Object.freeze({
          path: "lib/onchain/config.ts",
          sha256: "715ee5b492d8ec7ed9d3870286f09debb344f9cdb05556a41ab8e50d0aa23cb2",
        }),
        providerConfig: Object.freeze({
          path: "lib/onchain/website-rpc-providers.server.ts",
          sha256: "12018bf29c2521b3fbae2c64ba2e93d586e0f9978c36403f24249becb71f07ed",
        }),
      }),
    }),
    closedAlias: Object.freeze({
      path: "/api/ops/index",
      route: "app/api/ops/index/route.ts",
      status: 410,
      sha256: "bb498b00334df908029a588bec552516f281fdc0dfc3185bc5cd820984a9ee1f",
    }),
  }),
  independentCrons: Object.freeze([
    Object.freeze({
      id: "protocol-revenue",
      path: "/api/ops/protocol-revenue",
      schedule: "* * * * *",
      activationEnvironment: "PROTOCOL_REVENUE_AUTOMATION_ENABLED",
      route: Object.freeze({
        path: "app/api/ops/protocol-revenue/route.ts",
        sha256: "9a7012e88ec958c61db08295401cd1b9a932dce9bec14b85075f090782485726",
      }),
      runtime: Object.freeze({
        path: "lib/protocol-revenue/keeper-v2.server.ts",
        sha256: "8a0b48fcc3cf3034c4be422cc6e9f35f5c7c224c2c45589b34b5798a3fd5a0d8",
      }),
      dependencies: Object.freeze([
        Object.freeze({
          path: "lib/server/action-rpc-quorum.server.ts",
          sha256: "0cb84ff2a409980e84383699f73bfc1941dfe328f39e94d8e3658cc4aa4ed6f3",
        }),
      ]),
      policy: Object.freeze({
        path: "lib/protocol-revenue/keeper-policy.ts",
        sha256: "bb39f651c11e49173e5b07e42edd2bfa4a1c0e78e5b0345a47b338751e451787",
      }),
    }),
    Object.freeze({
      id: "manual-router-finality",
      path: "/api/ops/manual-router-finality",
      schedule: "* * * * *",
      activationEnvironment: "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED",
      route: Object.freeze({
        path: "app/api/ops/manual-router-finality/route.ts",
        sha256: "73bb842a0bc9436d3a41ec9797a8ba82b71c7745c534a5cb5d5aea259e270656",
      }),
      auth: Object.freeze({
        path: "lib/server/custom-launch/manual-router-cron-auth-v1.ts",
        sha256: "21f03e26d47de05c678d77aedcefb93a57aad6ae8b5ad77c2374eb6c68391ead",
      }),
      runtime: Object.freeze({
        path: "lib/server/custom-launch/manual-router-finality-worker-v1.ts",
        sha256: "58b73adac414d26b46b6e868f63e1934c08901a1c4e20eac85f377926383f277",
      }),
      dependencies: Object.freeze([
        Object.freeze({
          path: "lib/server/custom-launch/manual-router-discovery-v1.ts",
          sha256: "12685b945d26d585eedb21212d4df7a57c89aa5e23b0594aa23e23e9be3fdc79",
        }),
        Object.freeze({
          path: "lib/server/custom-launch/manual-router-finality-v1.ts",
          sha256: "f653ee2ea386740d4536445a86397ef527aa828d6e7f91f3741082d1b1f9833d",
        }),
        Object.freeze({
          path: "lib/server/custom-launch/manual-router-production-v1.ts",
          sha256: "79915b2a03b39e457ea5fd1253a58f76242510170c46dbed95654b269e5af595",
        }),
        Object.freeze({
          path: "lib/server/custom-launch/manual-router-service-v1.ts",
          sha256: "97a99851bc8eb0c60ad43d6548931da6faafb4f17f7857cdd31fd6767fe64412",
        }),
        Object.freeze({
          path: "lib/server/custom-launch/manual-router-store-v1.ts",
          sha256: "24a464017173af3bda97d6fc7d143dec27453a25315424a8348cbca2ad8acd66",
        }),
      ]),
      policy: Object.freeze({
        path: "lib/server/custom-launch/manual-router-finality-policy-v1.ts",
        sha256: "c24082d7a27f1742c6c8b9e4e86088a9d9a5c260b44061a1c86b69b9ae989343",
      }),
    }),
  ]),
  workers: Object.freeze([
    Object.freeze({
      id: "source-projector",
      path: "/api/ops/projector",
      schedule: "* * * * *",
      activationEnvironment: "PROGRAMMABLE_PROJECTOR_ACTIVE",
      route: Object.freeze({
        path: "app/api/ops/projector/route.ts",
        sha256: "9b12168cbbadf0addac351c45f71931f3c04370bcd6cabe6174d21daeb00a94d",
      }),
      runtime: Object.freeze({
        path: "lib/data-pipeline/projector-runtime-config.server.ts",
        sha256: "78483bf9b1110b4a97b719c6bb9bf9256285729e6002deb3621a9d1987373010",
      }),
      dependencies: Object.freeze([
        Object.freeze({
          path: "lib/data-pipeline/candidate-projector-runtime-binding.server.ts",
          sha256: "1d4515a3ea088ed5164f3083e6fa7e6d639e786f23b18e85b663c4395c64abf5",
        }),
      ]),
      migrations: Object.freeze([
        Object.freeze({
          path: "supabase/migrations/20260731203900_projector_runtime_singleton_lease.sql",
          sha256: "068f27a70ec6df57b84bf336fc2c46b316a7d10d40b9d489fc47e95acb6f74b0",
        }),
        Object.freeze({
          path: "supabase/migrations/20260731224000_projector_provider_evidence_binding.sql",
          sha256: "0404f7c610a34af23fe536f021927efec4e0aede235068b70be04331c58f03af",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801090000_bootstrap_dynamic_evidence_and_launch_requirements.sql",
          sha256: "e095d128feb12c8962c81be003e693dd67417cfed209144c998ab57d5e8786aa",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801091000_candidate_projector_unpromoted_gate.sql",
          sha256: "cd8b5a4aa4801ca773cb84047edbf05349288cada47d671bd47e7d997902c91f",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801092000_verify_candidate_database_promoted.sql",
          sha256: "ed5f54a374ad8178393e88a3948281ad9acba10aebbbd5209ea6793691b8c677",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801093000_bind_candidate_promotion_to_product.sql",
          sha256: "c6a032ef371b2211004c8d72c0a8c4eec4ba630776210aed48d2d054e642dbbe",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801125441_reuse_safe_head_observations.sql",
          sha256: "afbeea7bcf60e492e51bfd0c56517613f32a6f87a0182af00c48bdaef6569e74",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801144403_accept_uuid_v8_dynamic_source_lineage.sql",
          sha256: "85e0509d2a4fa49062a18d891e51cd0c64c1015926c3c3ef47a83ce16edb4170",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801155212_reuse_dual_rpc_block_evidence.sql",
          sha256: "51142370cf7fdf2bd60c2812978fe2cbbacf99f42b87c72f0ad1ac61b303cf51",
        }),
        Object.freeze({
          path: "supabase/migrations/20260801204500_reuse_dual_rpc_block_evidence_constraint.sql",
          sha256: "92cc63189b41eda613ba9da21b7ef21bee650a93f1825f5ee063727ee6c06b11",
        }),
      ]),
    }),
    Object.freeze({
      id: "market-projector",
      path: "/api/ops/market-projector",
      schedule: "* * * * *",
      activationEnvironment: "PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE",
      route: Object.freeze({
        path: "app/api/ops/market-projector/route.ts",
        sha256: "73bf9299095cfdf75d5452513ee818e161297a83c6355760ab2f79a22a13edbd",
      }),
      runtime: Object.freeze({
        path: "lib/data-pipeline/market-projector-runtime.server.ts",
        sha256: "5ce3b98d0a373c45b309011b59cc6ec7eeaef54bc112f2b55d32dca433566da0",
      }),
      migrations: Object.freeze([
        Object.freeze({
          path: "supabase/migrations/20260731223000_market_projector_contract.sql",
          sha256: "ea73f4112a53b25e72aa697d3fc0679bf9c6e7f93a496edd167803d6a7f81a24",
        }),
        Object.freeze({
          path: "supabase/migrations/20260802092800_market_projector_fast_lane.sql",
          sha256: "70c2719af30e0d3438e3de306376c7fa62d0196be98f81d7bd6b327559c14dc7",
        }),
        Object.freeze({
          path: "supabase/migrations/20260803000100_market_projector_health_view.sql",
          sha256: "946000d60600f8b144fb535579f6808b0acfd6da3331f17511f712e7bb24b2fd",
        }),
      ]),
    }),
  ]),
  eventTriggers: Object.freeze([
    Object.freeze({
      id: "quicknode-stream-projector-wake",
      path: "/api/ops/projector-wake",
      provider: "quicknode-streams",
      mode: "wake-only",
      secretEnvironment: "PROGRAMMABLE_QUICKNODE_STREAM_SECRET",
      route: Object.freeze({
        path: "app/api/ops/projector-wake/route.ts",
        sha256: "71549b17be233af2be052e1e4f948cbae37d804dc662354c6bfcd234bfdd266a",
      }),
      verifier: Object.freeze({
        path: "lib/data-pipeline/quicknode-stream-wake.server.ts",
        sha256: "b28af0bdd6860eb6f55b54ea4093a1ddbf9007667c3193f99061057e477c9153",
      }),
      canary: Object.freeze({
        path: "scripts/perf/read-model-projector-wake-canary.mjs",
        sha256: "6820b5bf29cdbf34ae7c5f1bfab55c7bccafb53a7989e09b87aad81cfa111db7",
      }),
      dependencies: Object.freeze([
        Object.freeze({
          path: "lib/data-pipeline/quicknode-wake-queue.server.ts",
          sha256: "a3743900032ff2c7b4f4636d5731d6de1d680e1f49bd0cce2365c448ea1243d0",
        }),
        Object.freeze({
          path: "lib/data-pipeline/optimistic-wake-runtime.server.ts",
          sha256: "306a06191e2d6849d8d85f6a1cf79ed027ff3ff482b8e374755935d738fa4307",
        }),
        Object.freeze({
          path: "lib/data-pipeline/optimistic-block-reader.server.ts",
          sha256: "983080e347dd9fb90daf5696f096a446f3c119a250669545dcb2208ba639b161",
        }),
        Object.freeze({
          path: "lib/data-pipeline/optimistic-market-state.server.ts",
          sha256: "88e55d7311c40ada819820c665fbe54247eb605373b5028346889e247dc790e3",
        }),
        Object.freeze({
          path: "lib/data-pipeline/optimistic-live-runtime.server.ts",
          sha256: "817b4563eb503aa761efc922c264cf1699fd2264160adfd1a5294308750533f6",
        }),
        Object.freeze({
          path: "lib/data-pipeline/read-model-real-block-sla-capture.server.ts",
          sha256: "1cadb53abb9783204fc1a2cecc83abdfb1541225d46cea3e52ebc9411769dd32",
        }),
        Object.freeze({
          path: "lib/data-pipeline/dual-rpc.ts",
          sha256: "12018866a1452d098d273e6e0f30274a4687f83a4fcba17764e2d88ca8093981",
        }),
        Object.freeze({
          path: "lib/data-pipeline/rpc-providers.server.ts",
          sha256: "d6694f99366226a64a07b28ef3646cc05556048bc1ce790f9fbac4929c3ce77c",
        }),
        Object.freeze({
          path: "app/api/ops/read-model-real-block-sla/route.ts",
          sha256: "367140b12a27068c55f2a5881e27729fbab4d1d9a6187c2148fd29bc4f075946",
        }),
        Object.freeze({
          path: "supabase/migrations/20260802104211_real_block_sla_runtime_receipts.sql",
          sha256: "0b9331f2b452084c4544b751ce1fbd41bba7e927ef81d6cddcb258c36f8729dc",
        }),
      ]),
    }),
  ]),
  releaseGates: Object.freeze({
    authOnlyWakeCanary: Object.freeze({
      purpose: "hmac-route-authentication-only",
      satisfiesRealBlockSla: false,
    }),
    realBlockSla: Object.freeze({
      requiredBeforeProductionPromotion: true,
      activity: "organic-stream-block-no-signing-or-spending",
      maximumDeliveryToFirstVisibleMs: 10_000,
      script: Object.freeze({
        path: "scripts/perf/read-model-real-block-sla-gate.mjs",
        sha256: "68cb5f77d3891070cba84f6b69f13eabb177016823f9baed6decdf62aa1a0c3a",
      }),
      schema: Object.freeze({
        path: "config/read-model-real-block-sla-db-attestation.schema.json",
        sha256: "73d78c27c6b8dc311dd50911bd4f1b4c2c44e967fd53aa5b415f566e264b69da",
      }),
    }),
  }),
});

function readSource(rootDirectory, path, overrides) {
  if (Object.hasOwn(overrides, path)) return overrides[path];
  try {
    return readFileSync(resolve(rootDirectory, path), "utf8");
  } catch {
    return null;
  }
}

function parseJson(source) {
  if (typeof source !== "string") return null;
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function sha256(source) {
  return typeof source === "string"
    ? createHash("sha256").update(source, "utf8").digest("hex")
    : null;
}

function exactCronMap(vercel) {
  if (!vercel || !Array.isArray(vercel.crons)) return null;
  const entries = new Map();
  for (const cron of vercel.crons) {
    if (
      !cron ||
      typeof cron.path !== "string" ||
      typeof cron.schedule !== "string" ||
      entries.has(cron.path)
    ) {
      return null;
    }
    entries.set(cron.path, cron.schedule);
  }
  return entries;
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function includesEverySourceFragment(source, fragments) {
  return typeof source === "string" &&
    fragments.every((fragment) => source.includes(fragment));
}

export const POST_PROMOTION_CURRENT_EVIDENCE_SOURCE_GUARDS = Object.freeze([
  "function hasUnevidencedBitqueryFdv",
  "if (depth > 12) return true",
  "if (seen.has(value)) return true",
  "object.fdvUsdWad !== undefined",
  "object.marketCapUsdWad !== undefined",
  'object.metric === "fdv"',
  'object.status === "available" || object.valueUsdWad !== undefined',
  "function exactCanonicalClassicNativeToken",
  'token?.exploreKind !== "token"',
  'token.launchModel !== "classic"',
  'token.liquidityPath === "meme"',
  "token.launchStampProvenance === undefined",
  'token.liquidityPath === "programmable-v4"',
  'stamp?.schemaVersion === "programmable.launch-stamp-provenance.v1"',
  'stamp.kind === "classic"',
  "stamp.chainId === 1",
  "sameBytes32(stamp.poolId, poolId)",
  "sameAddress(stamp.poolKey?.currency0, NATIVE_CURRENCY)",
  "sameAddress(stamp.poolKey?.currency1, tokenAddress)",
  "sameAddress(stamp.poolKey?.hooks, token?.hookAddress)",
  "tokenAddress === GOLDEN_TOKEN_ADDRESS",
  'valuation?.status !== "available"',
  'valuation.metric !== "fdv"',
  'valuation.supplyBasis !== "total"',
  'valuation.currency !== "usd"',
  'valuation.source !== "stateview-chainlink"',
  'valuation.freshness !== "current"',
  "token.fdvUsdWad !== valuation.valueWad",
  "!positiveInteger(valuation.asOfBlock)",
  "!exactBytes32(valuation.asOfBlockHash)",
  "!currentMarketEvidenceTime(valuation.asOfTime)",
  'valuation.lagBlocks !== "0"',
  '"programmable.stateview-chainlink-price-evidence.v1"',
  'price?.source !== "uniswap-v4-stateview-chainlink-v1"',
  'price.chainId !== "1"',
  "!sameAddress(price.tokenAddress, tokenAddress)",
  "!sameAddress(price.quoteAddress, NATIVE_CURRENCY)",
  "!sameBytes32(price.poolId, market?.primaryPoolId)",
  "price.stateViewAddress?.toLowerCase() !== MAINNET_STATE_VIEW",
  "MAINNET_STATE_VIEW_RUNTIME_CODE_HASH",
  "price.blockNumber !== valuation.asOfBlock",
  "!sameBytes32(price.blockHash, valuation.asOfBlockHash)",
  "!exactUnixTimestamp(price.blockTimestamp)",
  "price.blockTime !== valuation.asOfTime",
  "Number(BigInt(price.blockTimestamp)) * 1_000",
  "!positiveInteger(price.sqrtPriceX96)",
  "!positiveInteger(price.activeLiquidity)",
  "!positiveInteger(price.activeVirtualToken0Wei)",
  "!positiveInteger(price.activeVirtualLiquidityUsdWad)",
  '"stateview-active-liquidity-virtual-depth-usd"',
  "!positiveInteger(price.tokenPriceEthWei)",
  "!positiveInteger(price.tokenPriceUsdWad)",
  "price.totalSupplyRaw !== token.totalSupplyRaw",
  "price.tokenDecimals !== token.tokenDecimals",
  "price.fdvUsdWad !== valuation.valueWad",
  "quote?.feedAddress?.toLowerCase() !== MAINNET_ETH_USD_FEED",
  "!positiveInteger(quote.roundId)",
  "!positiveInteger(quote.answeredInRound)",
  "BigInt(quote.answeredInRound) < BigInt(quote.roundId)",
  "!positiveInteger(quote.answer)",
  "quote.decimals !== 8",
  "!exactUnixTimestamp(quote.updatedAt)",
  "Number(BigInt(quote.updatedAt)) * 1_000",
  "!positiveInteger(token.totalSupplyRaw)",
  "token.tokenDecimals < 0",
  "token.tokenDecimals > 255",
  'market?.schemaVersion !== "programmable.market-data.v1"',
  'market.source !== "bitquery"',
  'market.status !== "current"',
  "!currentMarketTime(market.generatedAt)",
  "!exactBytes32(market.primaryPoolId)",
  "!sameBytes32(token.poolId, market.primaryPoolId)",
  'primary?.identity?.chainId !== "1"',
  "!sameAddress(primary.identity.tokenAddress, tokenAddress)",
  "!sameBytes32(primary.identity.poolId, market.primaryPoolId)",
  'primary.identity.protocol !== "uniswap_v4"',
  'primary.source !== "bitquery"',
  'primary.status !== "current"',
  "hasUnevidencedBitqueryFdv(market)",
  'liquidity?.source !== "official-uniswap-v4-subgraph"',
  'liquidity.identity?.chainId !== "1"',
  'liquidity.identity.protocol !== "uniswap_v4"',
  "!sameBytes32(liquidity.identity.poolId, market.primaryPoolId)",
  "!sameAddress(liquidity.identity.tokenAddress, tokenAddress)",
  "liquidity.identity.quoteAddress, price.quoteAddress",
  'liquidity.valueBasis !== "official-subgraph-pool-tvl-usd"',
  "liquidity.reportedPoolBalances?.token0?.address",
  "liquidity.reportedPoolBalances?.token1?.address",
  "liquidity.reportedPoolBalances.token0.decimals !== 18",
  "liquidity.reportedPoolBalances.token1.decimals !== token.tokenDecimals",
  "!unsignedDecimal(liquidity.reportedPoolBalances.token0.amountDecimal)",
  "!unsignedDecimal(liquidity.reportedPoolBalances.token1.amountDecimal)",
  "!positiveDecimal(liquidity.reportedPoolBalances.token0.amountDecimal)",
  "!positiveDecimal(liquidity.reportedPoolBalances.token1.amountDecimal)",
  "BigInt(liquidity.tvlUsdWad) < MINIMUM_PUBLIC_FDV_LIQUIDITY_USD_WAD",
  'liquidity.freshness !== "current"',
  "provenance?.subgraphId !== OFFICIAL_V4_SUBGRAPH_ID",
  "provenance?.deployment !== OFFICIAL_V4_SUBGRAPH_DEPLOYMENT",
  "!positiveInteger(provenance.indexedBlockNumber)",
  "!exactBytes32(provenance.indexedBlockHash)",
  "!exactUnixTimestamp(provenance.indexedBlockTimestamp)",
  "!currentMarketEvidenceTime(provenance.indexedBlockTime)",
  "!positiveInteger(provenance.referenceHeadBlockNumber)",
  "!exactBytes32(provenance.referenceHeadBlockHash)",
  "!unsignedInteger(provenance.lagBlocks)",
  "valuation.asOfBlock === provenance.referenceHeadBlockNumber",
  "valuation.asOfBlockHash, provenance.referenceHeadBlockHash",
  "lagBlocks === referenceBlock - indexedBlock",
  "lagBlocks <= OFFICIAL_V4_LIQUIDITY_MAXIMUM_LAG_BLOCKS",
  "provenance.indexedBlockHash,",
  "provenance.indexedBlockTime ===",
  "indexedTimestamp <= valuationTimeSeconds",
  "feedUpdatedAt <= valuationTimeSeconds",
  "valuationTimeSeconds - feedUpdatedAt <= 7_200n",
  "expectedFdvUsdWad.toString() === valuation.valueWad",
  "expectedTokenPriceEthWei.toString() === price.tokenPriceEthWei",
  "expectedTokenPriceUsdWad.toString() === price.tokenPriceUsdWad",
  "activeVirtualToken0Wei.toString() === price.activeVirtualToken0Wei",
  "expectedActiveVirtualLiquidityUsdWad >=",
  "price.activeVirtualLiquidityUsdWad",
  "verifyCurrentPublicOnchainEvidenceV1",
  '"eth_getBlockByNumber"',
  '"eth_getCode"',
  '"eth_call"',
  "requireCanonical: true",
  "keccak256(stateViewCode)",
  "sameCurrentEvidenceObservation(first, second)",
  "first.blockHash !== valuation.asOfBlockHash.toLowerCase()",
  "first.stateViewRuntimeCodeHash !== MAINNET_STATE_VIEW_RUNTIME_CODE_HASH",
  "first.sqrtPriceX96.toString() !== price.sqrtPriceX96",
  "first.activeLiquidity.toString() !== price.activeLiquidity",
  "first.totalSupplyRaw.toString() !== price.totalSupplyRaw",
  "first.feedDecimals !== quote.decimals",
  "first.roundId.toString() !== quote.roundId",
  "first.answeredInRound.toString() !== quote.answeredInRound",
  "providerCount: observations.length",
]);

export const POST_PROMOTION_GLOBAL_RANKING_SOURCE_GUARDS = Object.freeze([
  "total > MAXIMUM_EXPLORE_TOKENS",
  "totalPages !== Math.ceil(total / EXPLORE_PAGE_SIZE)",
  "responses.length !== totalPages",
  'page?.status !== "ready"',
  'page?.sort !== "market-cap"',
  "page?.page !== index + 1",
  "page?.pageSize !== EXPLORE_PAGE_SIZE",
  "page?.total !== total",
  "page?.totalPages !== totalPages",
  "pageTokens.length !== expectedLength",
  '"programmable.explore-data-quality.v1"',
  "quality.available + quality.unavailable !== pageTokens.length",
  "quality.stale > quality.available",
  "quality.unknown !== 0",
  'response.headers.readSource !== "operational+durable+postgres"',
  "response.headers.rpcProvider !== null",
  "response.headers.marketAsOf !== (quality.asOfTime ?? null)",
  "!exactCurrentPublicMarketHeaders(response)",
  "!currentMarketEvidenceTime(quality.asOfTime)",
  "token.valuation.asOfBlock !== quality.asOfBlock",
  'response.headers.marketSource !== "bitquery"',
  "response.headers.valuationBlock !== null",
  "ids.has(token.id)",
  "addresses.has(address)",
  "tokens.length !== total",
  "!UNAVAILABLE_VALUATION_REASONS.has(valuation.reason)",
  "token?.fdvUsdWad !== undefined",
  "hasUnevidencedBitqueryFdv(token?.marketData)",
  'valuation.source === "bitquery"',
  "return null;",
  'valuation.source !== "stateview-chainlink"',
  "sawNonCurrent",
  "!exactCurrentPublicFdvLiquidity(token)",
  "value > previousCurrentFdv",
  "return currentCount > 0 ? { currentToken, tokens } : null;",
]);

export const POST_PROMOTION_DETAIL_CHART_SOURCE_GUARDS = Object.freeze([
  "!sameAddress(detailToken?.tokenAddress, exploreToken?.tokenAddress)",
  "!sameAddress(detailToken?.hookAddress, exploreToken?.hookAddress)",
  "detailToken?.launchModel !== exploreToken?.launchModel",
  "detailToken?.liquidityPath !== exploreToken?.liquidityPath",
  "detailToken?.marketData?.primaryPoolId,",
  "exploreToken?.marketData?.primaryPoolId,",
  "detailToken?.valuation?.priceEvidence?.quoteAddress,",
  "exploreToken?.valuation?.priceEvidence?.quoteAddress,",
  "!exactCurrentPublicMarketHeaders(response)",
  "!exactCurrentPublicFdvLiquidity(detailToken)",
  "detailBlock < exploreBlock",
  "Date.parse(detailToken.valuation.asOfTime) <",
  "detailBlock !== exploreBlock",
  "JSON.stringify(detailToken.valuation)",
  "JSON.stringify(detailToken.liquidityEvidence)",
  'response.headers.marketSource !== "bitquery"',
  'response.headers.priceSource !== "bitquery"',
  'chart.readStatus !== "live"',
  '["ready", "insufficient-history"].includes(chart.status)',
  "chart.truncated !== false",
  "chart.identity?.chainId !== \"1\"",
  "!sameAddress(chart.identity?.tokenAddress, tokenAddress)",
  "!sameBytes32(chart.identity?.poolId, poolId)",
  "!sameAddress(chart.identity?.quoteAddress, quoteAddress)",
  'chart.identity?.protocol !== "uniswap_v4"',
  "chart.range !== range",
  "chart.points.length < 2 || chart.swapCount < 2",
  "chart.points.length !== 1 || chart.swapCount !== 1",
  'chart.valuation?.status !== "unavailable"',
  'chart.valuation?.reason !== "source-unavailable"',
  '"fdvUsdWad" in chart',
  '"valuationMetric" in chart',
  "chart.asOfTime !== chart.points.at(-1)?.observedAt",
  "response.headers.marketAsOf !== chart.asOfTime",
  "requireCurrentAsOf && !currentMarketTime(chart.asOfTime)",
  'point?.valueSemantics !== "period-median"',
  "time !== bucketEnd",
  "bucketStart >= bucketEnd",
  "observedAt < bucketStart",
  "observedAt > bucketEnd",
  "!positiveDecimal(point?.priceQuote)",
  'typeof point?.quoteSymbol !== "string"',
  "point?.priceUsd !== undefined",
  "point?.ohlcUsd !== undefined",
  "point?.ohlcQuote !== undefined",
  "point.tradeCount < 1",
  "bucketStart < previousBucketEnd",
  "block <= previousBlock",
  "totalTrades === chart.swapCount",
]);

export const STAGED_MARKET_EVIDENCE_SOURCE_GUARDS = Object.freeze([
  "const hasUnevidencedBitqueryFdv = (",
  "if (depth > 12) return true",
  "if (seen.has(value)) return true",
  "value.fdvUsdWad !== undefined",
  "value.marketCapUsdWad !== undefined",
  'value.metric === "fdv"',
  'value.status === "available" ||',
  "const exactCanonicalClassicNativeToken = (",
  'token?.exploreKind !== "token"',
  'token.launchModel !== "classic"',
  'token.liquidityPath === "meme"',
  "token.launchStampProvenance === undefined",
  'token.liquidityPath === "programmable-v4"',
  '"programmable.launch-stamp-provenance.v1"',
  'stamp.kind === "classic"',
  "stamp.chainId === 1",
  "sameBytes32(stamp.poolId, poolId)",
  "sameAddress(stamp.poolKey?.currency0, nativeCurrency)",
  "sameAddress(stamp.poolKey?.currency1, tokenAddress)",
  "sameAddress(stamp.poolKey?.hooks, token?.hookAddress)",
  'valuation.source !== "stateview-chainlink"',
  'valuation.freshness !== "current"',
  "token.fdvUsdWad !== valuation.valueWad",
  "!positiveInteger(valuation.asOfBlock)",
  "!exactBytes32(valuation.asOfBlockHash)",
  "!currentMarketEvidenceTime(valuation.asOfTime)",
  'valuation.lagBlocks !== "0"',
  '"programmable.stateview-chainlink-price-evidence.v1"',
  'price?.source !== "uniswap-v4-stateview-chainlink-v1"',
  "!sameAddress(price.tokenAddress, tokenAddress)",
  "!sameAddress(price.quoteAddress, nativeCurrency)",
  "!sameBytes32(price.poolId, market?.primaryPoolId)",
  "price.stateViewAddress?.toLowerCase() !== mainnetStateView",
  "mainnetStateViewRuntimeCodeHash",
  "price.blockNumber !== valuation.asOfBlock",
  "!sameBytes32(price.blockHash, valuation.asOfBlockHash)",
  "!exactUnixTimestamp(price.blockTimestamp)",
  "price.blockTime !== valuation.asOfTime",
  "!positiveInteger(price.sqrtPriceX96)",
  "!positiveInteger(price.activeLiquidity)",
  "!positiveInteger(price.activeVirtualToken0Wei)",
  "!positiveInteger(price.activeVirtualLiquidityUsdWad)",
  '"stateview-active-liquidity-virtual-depth-usd"',
  "!positiveInteger(price.tokenPriceEthWei)",
  "!positiveInteger(price.tokenPriceUsdWad)",
  "price.totalSupplyRaw !== token.totalSupplyRaw",
  "price.tokenDecimals !== token.tokenDecimals",
  "price.fdvUsdWad !== valuation.valueWad",
  "quote?.feedAddress?.toLowerCase() !== mainnetEthUsdFeed",
  "!positiveInteger(quote.roundId)",
  "!positiveInteger(quote.answeredInRound)",
  "BigInt(quote.answeredInRound) < BigInt(quote.roundId)",
  "!positiveInteger(quote.answer)",
  "quote.decimals !== 8",
  "quote.updatedAtTime !==",
  "!exactCanonicalClassicNativeToken(",
  'market.source !== "bitquery"',
  'market.status !== "current"',
  "!currentMarketTime(market.generatedAt)",
  "!sameBytes32(token.poolId, market.primaryPoolId)",
  "!sameAddress(primary.identity.tokenAddress, tokenAddress)",
  "!sameBytes32(primary.identity.poolId, market.primaryPoolId)",
  'primary.identity.protocol !== "uniswap_v4"',
  'primary.source !== "bitquery"',
  'primary.status !== "current"',
  "hasUnevidencedBitqueryFdv(market)",
  'liquidity?.source !== "official-uniswap-v4-subgraph"',
  'liquidity.identity.protocol !== "uniswap_v4"',
  "!sameBytes32(liquidity.identity.poolId, market.primaryPoolId)",
  "!sameAddress(liquidity.identity.tokenAddress, tokenAddress)",
  'liquidity.valueBasis !== "official-subgraph-pool-tvl-usd"',
  "liquidity.reportedPoolBalances?.token0?.address",
  "liquidity.reportedPoolBalances?.token1?.address",
  "BigInt(liquidity.tvlUsdWad) <",
  'liquidity.freshness !== "current"',
  "provenance?.subgraphId !== officialV4SubgraphId",
  "provenance?.deployment !== officialV4SubgraphDeployment",
  "!currentMarketEvidenceTime(provenance.indexedBlockTime)",
  "valuation.asOfBlock === provenance.referenceHeadBlockNumber",
  "valuation.asOfBlockHash,",
  "lagBlocks === referenceBlock - indexedBlock",
  "lagBlocks <= 64n",
  "indexedTimestamp <= valuationTimeSeconds",
  "feedUpdatedAt <= valuationTimeSeconds",
  "valuationTimeSeconds - feedUpdatedAt <= 7_200n",
  "expectedFdvUsdWad.toString() === valuation.valueWad",
  "expectedTokenPriceEthWei.toString() ===",
  "expectedTokenPriceUsdWad.toString() ===",
  "activeVirtualToken0Wei.toString() ===",
  "expectedActiveVirtualLiquidityUsdWad >=",
  "marketCapTotal > maximumMarketCapTokens",
  "marketCapTotalPages !==",
  "marketCapPages.push(await requestJson(",
  "page.total !== marketCapTotal",
  "page.totalPages !== marketCapTotalPages",
  "page.tokens.length !== expectedPageLength",
  "valuationQuality.available + valuationQuality.unavailable !==",
  "valuationQuality.unknown !== 0",
  "page.__marketHeaders?.marketSource !==",
  "page.__marketHeaders?.valuationBlock !== null",
  "seenMarketCapIds.has(token.id)",
  "seenMarketCapAddresses.has(address)",
  "marketCapTokens.length !== marketCapTotal",
  "hasUnevidencedBitqueryFdv(token?.marketData)",
  'valuation.source === "bitquery"',
  "sawNonCurrentFdv",
  "value > previousCurrentFdv",
  "if (currentFdvCount < 1) {",
  "!sameAddress(",
  "currentFdvDetail.token?.hookAddress",
  "currentFdvDetail.token?.launchModel !==",
  "currentFdvDetail.token?.liquidityPath !==",
  "currentFdvDetail.token?.marketData?.primaryPoolId",
  "currentFdvDetail.token?.valuation?.priceEvidence?.quoteAddress",
  "detailValuationBlock < exploreValuationBlock",
  "Date.parse(currentFdvDetail.token.valuation.asOfTime) <",
  "sameValuationSnapshot",
  "JSON.stringify(currentFdvDetail.token.valuation)",
  "JSON.stringify(currentFdvDetail.token.liquidityEvidence)",
  'for (const range of ["1h", "1d", "1w", "all"])',
  "verifyCurrentPublicOnchainEvidenceV1({",
  '"https://ethereum-rpc.publicnode.com"',
  '"https://rpc.mevblocker.io"',
  '"programmable.current-market-independent-proof.v1"',
  "independentCurrentProof.providerCount !== 2",
  'currentChart.readStatus !== "live"',
  '["ready", "insufficient-history"].includes(',
  "currentChart.truncated !== false",
  "currentChart.identity.quoteAddress",
  "currentFdvToken.valuation.priceEvidence.quoteAddress",
  'currentChart.valuation?.status !== "unavailable"',
  'currentChart.valuation?.reason !== "source-unavailable"',
  '"fdvUsdWad" in currentChart',
  '"valuationMetric" in currentChart',
  "chartPoints.at(-1)?.observedAt",
  "!currentMarketTime(currentChart.asOfTime)",
  'point?.valueSemantics !== "period-median"',
  "pointTime !== bucketEnd",
  "observedAt < bucketStart",
  "observedAt > bucketEnd",
  "!positiveDecimal(point?.priceQuote)",
  'typeof point?.quoteSymbol !== "string"',
  "point?.priceUsd !== undefined",
  "point?.ohlcUsd !== undefined",
  "point?.ohlcQuote !== undefined",
  "bucketStart < previousBucketEnd",
  "observedTrades !== currentChart.swapCount",
]);

function expectedDigest(path, approved, overrides) {
  return overrides?.[path] ?? approved;
}

function sourceBindingMatches(source, binding, expectedSha256Overrides) {
  return (
    binding &&
    typeof binding.path === "string" &&
    typeof binding.sha256 === "string" &&
    sha256(source(binding.path)) ===
      expectedDigest(binding.path, binding.sha256, expectedSha256Overrides)
  );
}

function routeIsAuthenticatedAndFailClosed(source, requireCutover = false) {
  const directSecretBounds =
    /Buffer\.byteLength\(secret,\s*["']utf8["']\)\s*<\s*32/u.test(source) &&
    /Buffer\.byteLength\(secret,\s*["']utf8["']\)\s*>\s*1_024/u.test(source);
  const namedSecretBounds =
    /const\s+secretLength\s*=\s*secret\s*\?\s*Buffer\.byteLength\(secret,\s*["']utf8["']\)\s*:\s*0/u.test(source) &&
    /secretLength\s*<\s*32/u.test(source) &&
    /secretLength\s*>\s*1_024/u.test(source);
  const standardAuthorization =
    /matchesBearer\(request,\s*process\.env\.CRON_SECRET\)/u.test(source) ||
    /const\s+secret\s*=\s*process\.env\.CRON_SECRET/u.test(source) ||
    /const\s+secret\s*=\s*environment\.CRON_SECRET/u.test(source);
  const cutoverAuthorization =
    /PROGRAMMABLE_CUTOVER_BACKFILL_ACTIVE\s*===\s*["']true["']/u.test(source) &&
    /process\.env\.PROGRAMMABLE_CUTOVER_OPERATOR_SECRET/u.test(source) &&
    /x-programmable-cutover-mode/u.test(source) &&
    /raw-backfill-v1/u.test(source);
  return (
    typeof source === "string" &&
    /request\.headers\.get\(["']authorization["']\)/u.test(source) &&
    (directSecretBounds || namedSecretBounds) &&
    /authorization(?:\?\.|\.)startsWith\(["']Bearer ["']\)/u.test(source) &&
    /provided\.length\s*===\s*expected\.length/u.test(source) &&
    /timingSafeEqual\(provided,\s*expected\)/u.test(source) &&
    standardAuthorization &&
    (!requireCutover ||
      (cutoverAuthorization &&
        /mode\s*===\s*["']cutover["']/u.test(source))) &&
    (/if\s*\(\s*!isAuthorized\(request\)\s*\)/u.test(source) ||
      /if\s*\(\s*!isManualRouterFinalityCronAuthorizedV1\(request\)\s*\)/u.test(source) ||
      /if\s*\(\s*mode\s*===\s*null\s*\)/u.test(source)) &&
    /status\s*:\s*401\b/u.test(source) &&
    /status\s*:\s*503\b/u.test(source) &&
    /["']Cache-Control["']\s*:\s*["']no-store["']/u.test(source)
  );
}

function routeIsPermanentlyClosed(source, binding) {
  return (
    typeof source === "string" &&
    binding?.status === 410 &&
    source.includes('code: "legacy_index_route_closed"') &&
    /status\s*:\s*410\b/u.test(source) &&
    /["']Cache-Control["']\s*:\s*["']no-store["']/u.test(source)
  );
}

function legacySchedulerWatchdogIsFailClosed(
  workflowSource,
  binding,
  source,
  expectedSha256Overrides,
) {
  const pinnedNodeSetup = [
    "      - name: Install pinned Node.js runtime",
    `        uses: ${binding?.nodeRuntime?.setupAction}@${binding?.nodeRuntime?.setupActionSha} # ${binding?.nodeRuntime?.setupActionRelease}`,
    "        with:",
    `          node-version: ${binding?.nodeRuntime?.version}`,
    `          cache: ${binding?.nodeRuntime?.dependencyCache}`,
  ].join("\n");
  const pinnedNodeSetupIndex = workflowSource?.indexOf(pinnedNodeSetup) ?? -1;
  const watchdogStepIndex =
    workflowSource?.indexOf("      - name: Refresh and prove durable freshness") ?? -1;
  return (
    typeof workflowSource === "string" &&
    binding?.provider === "github-actions" &&
    binding.schedule === "2-57/5 * * * *" &&
    binding.targetOrigin === "https://programmable.market" &&
    binding.environment === "production" &&
    binding.secretEnvironment === "CRON_SECRET" &&
    binding.concurrencyGroup === "production-read-model-refresh" &&
    binding.freshnessMaximumAgeSeconds === 600 &&
    binding.nodeRuntime?.setupAction === "actions/setup-node" &&
    binding.nodeRuntime?.setupActionSha ===
      "820762786026740c76f36085b0efc47a31fe5020" &&
    binding.nodeRuntime?.setupActionRelease === "v7.0.0" &&
    binding.nodeRuntime?.version === "24.14.0" &&
    binding.nodeRuntime?.dependencyCache === false &&
    binding.rpcProof?.confirmedBlockRequired === true &&
    binding.rpcProof?.providerPairRequired === true &&
    binding.rpcProof?.maximumHeadAgeSeconds === 300 &&
    sourceBindingMatches(source, binding.rpcProof?.healthRoute, expectedSha256Overrides) &&
    sourceBindingMatches(source, binding.rpcProof?.rpcRuntime, expectedSha256Overrides) &&
    sourceBindingMatches(
      source,
      binding.rpcProof?.deploymentConfig,
      expectedSha256Overrides,
    ) &&
    sourceBindingMatches(
      source,
      binding.rpcProof?.providerConfig,
      expectedSha256Overrides,
    ) &&
    workflowSource.includes('name: Refresh production read model') &&
    workflowSource.includes('    - cron: "2-57/5 * * * *"') &&
    workflowSource.includes("  workflow_dispatch:") &&
    workflowSource.includes("permissions: {}") &&
    workflowSource.includes("  group: production-read-model-refresh") &&
    workflowSource.includes("  cancel-in-progress: false") &&
    workflowSource.includes("github.repository == '0xprogrammable/programmable'") &&
    workflowSource.includes("github.ref == 'refs/heads/production'") &&
    workflowSource.includes("    timeout-minutes: 9") &&
    workflowSource.includes("      name: production") &&
    pinnedNodeSetupIndex >= 0 &&
    pinnedNodeSetupIndex < watchdogStepIndex &&
    workflowSource.match(/uses:\s*actions\/setup-node@/gu)?.length === 1 &&
    workflowSource.includes("CRON_SECRET: ${{ secrets.CRON_SECRET }}") &&
    workflowSource.includes("TARGET_ORIGIN: https://programmable.market") &&
    workflowSource.includes('targetOrigin !== "https://programmable.market"') &&
    workflowSource.includes("secretBytes < 32") &&
    workflowSource.includes("secretBytes > 1_024") &&
    workflowSource.includes('/[\\r\\n]/u.test(cronSecret ?? "")') &&
    workflowSource.includes('"/api/ops/index-v2"') &&
    workflowSource.includes("headers.authorization = `Bearer ${cronSecret}`") &&
    workflowSource.includes('redirect: "error"') &&
    workflowSource.includes("signal: AbortSignal.timeout(timeoutMs)") &&
    workflowSource.includes("const MAXIMUM_JSON_BYTES = 64 * 1024") &&
    workflowSource.includes("bytes > MAXIMUM_JSON_BYTES") &&
    workflowSource.includes("refresh.response.status !== 200") &&
    workflowSource.includes('includes("no-store")') &&
    workflowSource.includes("refresh.body?.ok !== true") &&
    workflowSource.includes("refresh.body.portfolioHistory.blockNumber !==") &&
    workflowSource.includes("refresh.body.portfolioHistory.tokenCount !==") &&
    workflowSource.includes('refresh.body.portfolioHistory.status === "empty"') &&
    workflowSource.includes("health.response.status === 200") &&
    workflowSource.includes('health.body?.status === "healthy"') &&
    workflowSource.includes('health.body.indexSource === "durable"') &&
    workflowSource.includes('health.body.indexedReadModel?.status === "disabled"') &&
    workflowSource.includes("healthBlock >= refreshBlock") &&
    workflowSource.includes("index.ageSeconds <= MAXIMUM_FRESH_AGE_SECONDS") &&
    workflowSource.includes('rpc?.status === "healthy"') &&
    workflowSource.includes('rpc?.read?.status === "available"') &&
    workflowSource.includes('rpc?.quorum?.status === "verified"') &&
    workflowSource.includes("confirmedBlockNumber >= healthBlock") &&
    workflowSource.includes("confirmedBlockNumber >= refreshBlock") &&
    workflowSource.includes("HEX32.test(confirmedBlock?.hash)") &&
    workflowSource.includes('confirmedBlock.hash !== `0x${"00".repeat(32)}`') &&
    workflowSource.includes('rpc?.freshness?.maxHeadAgeSeconds === 300') &&
    workflowSource.includes('primary?.status === "available"') &&
    workflowSource.includes('secondary?.status === "available"') &&
    workflowSource.includes("primaryHead >= confirmedBlockNumber") &&
    workflowSource.includes("secondaryHead >= confirmedBlockNumber") &&
    !workflowSource.includes("actions/checkout") &&
    !workflowSource.includes("VERCEL_TOKEN") &&
    !workflowSource.includes("VERCEL_AUTOMATION_BYPASS_SECRET") &&
    !workflowSource.includes("pull_request") &&
    !workflowSource.includes("contents: write")
  );
}

function activationIsExplicitAndSafe(source, environmentName) {
  return (
    typeof source === "string" &&
    source.includes(`env.${environmentName}`) &&
    /===\s*["']false["']/u.test(source) &&
    /(?:===|!==)\s*["']true["']/u.test(source) &&
    /===\s*undefined/u.test(source) &&
    /status\s*:\s*["']disabled["']|return\s+["']disabled["']/u.test(source) &&
    /invalidRuntimeConfig|invalidInput|throw\s+/u.test(source)
  );
}

function eventTriggerIsAuthenticatedAndBound(route, verifier, trigger) {
  return (
    typeof route === "string" &&
    typeof verifier === "string" &&
    trigger?.provider === "quicknode-streams" &&
    trigger?.mode === "wake-only" &&
    trigger?.secretEnvironment === "PROGRAMMABLE_QUICKNODE_STREAM_SECRET" &&
    route.includes("await verifyQuickNodeStreamWake(request, {") &&
    route.includes("enqueueConfiguredQuickNodeWake") &&
    route.includes("acknowledgeConfiguredQuickNodeWake") &&
    route.includes("consumeConfiguredRealBlockSlaProviderRetryOnce") &&
    route.includes("PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE") &&
    route.includes("processDurableWakeJob") &&
    route.includes("processNextConfiguredQuickNodeWake") &&
    route.includes("createConfiguredOptimisticWakeFirstStage") &&
    route.includes("after(() => runDurableWakeWorker") &&
    route.includes("runConfiguredProjectorCycle()") &&
    route.includes("runConfiguredMarketProjectorFastLaneCycle()") &&
    route.includes("export const POST = createProjectorWakePost({") &&
    /status\s*:\s*202\b/u.test(route) &&
    /["']Cache-Control["']\s*:\s*["']no-store["']/u.test(route) &&
    verifier.includes("PROGRAMMABLE_QUICKNODE_STREAM_SECRET") &&
    verifier.includes('exactHeader(request, "x-qn-nonce"') &&
    verifier.includes('exactHeader(request, "x-qn-timestamp"') &&
    verifier.includes('exactHeader(request, "x-qn-signature"') &&
    verifier.includes('createHmac("sha256", secret)') &&
    verifier.includes("timingSafeEqual(provided, expected)") &&
    verifier.includes("MAXIMUM_TIMESTAMP_AGE_SECONDS") &&
    verifier.includes("MAXIMUM_ENCODED_BODY_BYTES") &&
    verifier.includes("maxOutputLength: MAXIMUM_DECODED_BODY_BYTES")
  );
}

function eventTriggerCanaryIsFailClosed(source, trigger) {
  return (
    typeof source === "string" &&
    trigger?.canary?.path ===
      "scripts/perf/read-model-projector-wake-canary.mjs" &&
    source.includes(
      'export const PROJECTOR_WAKE_ROUTE = "/api/ops/projector-wake"',
    ) &&
    source.includes('"PROGRAMMABLE_QUICKNODE_STREAM_SECRET"') &&
    source.includes('"VERCEL_AUTOMATION_BYPASS_SECRET"') &&
    source.includes('"x-vercel-protection-bypass"') &&
    source.includes('createHmac("sha256", secret)') &&
    source.includes('id: "invalid-signature"') &&
    source.includes('id: "stale-timestamp"') &&
    source.includes('id: "valid-delivery"') &&
    source.includes("status: 401") &&
    source.includes("status: 202") &&
    source.includes('"cache-control"') &&
    source.includes('hostname.endsWith(".vercel.app")') &&
    !source.includes("NEXT_PUBLIC_PROGRAMMABLE_QUICKNODE_STREAM_SECRET") &&
    !source.includes("NEXT_PUBLIC_VERCEL_AUTOMATION_BYPASS_SECRET")
  );
}

function realBlockSlaGateIsFailClosed(source, schema, gate) {
  const schemaValue = parseJson(schema);
  return (
    typeof source === "string" &&
    gate?.requiredBeforeProductionPromotion === true &&
    gate?.activity === "organic-stream-block-no-signing-or-spending" &&
    gate?.maximumDeliveryToFirstVisibleMs === 10_000 &&
    source.includes("REAL_BLOCK_SLA_MAXIMUM_LATENCY_MS = 10_000") &&
    source.includes("verifyRealBlockSlaDatabaseAttestation") &&
    source.includes("DB-authored promotion attestation required") &&
    source.includes("attestationHmacSha256") &&
    source.includes("dynamic provider call count") &&
    source.includes("same-market public surfaces") &&
    source.includes("API body digest") &&
    source.includes("real-block SLA latency") &&
    source.includes("maximumEvidenceAgeMs") &&
    source.includes('evidence.kind !== "programmable-real-block-sla-db-attestation"') &&
    source.includes("evidence.schemaVersion !== 2") &&
    source.includes("initialNonceDigest") &&
    source.includes("duplicateNonceDigest") &&
    source.includes("runtime.initialResponseStatus !== 503") &&
    source.includes("runtime.duplicateResponseStatus !== 202") &&
    source.includes("metadataProviderCallCountA") &&
    source.includes("metadataProviderCallCountB") &&
    schemaValue?.properties?.kind?.const ===
      "programmable-real-block-sla-db-attestation" &&
    schemaValue?.properties?.schemaVersion?.const === 2 &&
    schemaValue?.properties?.runtimeReceipt?.type === "object" &&
    schemaValue?.properties?.runtimeReceipt?.properties?.initialResponseStatus
      ?.const === 503 &&
    schemaValue?.properties?.runtimeReceipt?.properties?.duplicateResponseStatus
      ?.const === 202 &&
    schemaValue?.properties?.runtimeReceipt?.properties?.markets?.items
      ?.properties?.releaseVersion?.enum?.length === 3 &&
    schemaValue?.properties?.apiObservations?.minItems === 2 &&
    schemaValue?.properties?.apiObservations?.maxItems === 2 &&
    schemaValue?.properties?.attestationHmacSha256?.$ref === "#/$defs/bytes32"
  );
}

function exactEmptyEnvironmentKey(source, name) {
  if (typeof source !== "string") return false;
  const matches = source.match(new RegExp(`^${name}=$`, "gmu")) ?? [];
  return matches.length === 1 && !source.includes(`NEXT_PUBLIC_${name}`);
}

function exactFalseEnvironmentKey(source, name) {
  if (typeof source !== "string") return false;
  const matches = source.match(new RegExp(`^${name}=false$`, "gmu")) ?? [];
  return matches.length === 1 && !source.includes(`NEXT_PUBLIC_${name}`);
}

const EXACT_MANUAL_VERCEL_PROMOTION =
  'vercel promote "$STAGED_DEPLOYMENT_ID" --yes --token="$VERCEL_TOKEN"';
const EXACT_REAL_BLOCK_SLA_OUTPUT =
  "/secure/cutover/real-block-sla-db-attestation.json";
const MANUAL_PROMOTION_SEQUENCE = Object.freeze([
  "npm run perf:read-model:real-block-sla-operator --",
  "npm run perf:read-model:real-block-sla --",
  "npm run perf:read-model:staged-deployment --",
  EXACT_MANUAL_VERCEL_PROMOTION,
  "npm run perf:read-model:post-promotion --",
]);

function manualPromotionSequenceIsFailClosed(source) {
  if (typeof source !== "string") return false;
  let inShellFence = false;
  const shellCommands = [];
  for (const sourceLine of source.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (line === "```sh" || line === "```bash") {
      inShellFence = true;
      continue;
    }
    if (line.startsWith("```")) {
      inShellFence = false;
      continue;
    }
    if (inShellFence && line.length > 0) shellCommands.push(line);
  }
  let previousIndex = -1;
  for (const command of MANUAL_PROMOTION_SEQUENCE) {
    const commandIndex = shellCommands.findIndex(
      (line, index) => index > previousIndex && line.startsWith(command),
    );
    if (commandIndex < 0) return false;
    previousIndex = commandIndex;
  }
  const activePromotionCommands = shellCommands.filter((line) =>
    /\bvercel\s+promote(?:\s|$)/u.test(line)
  );
  return activePromotionCommands.length === 1 &&
    activePromotionCommands[0] === EXACT_MANUAL_VERCEL_PROMOTION;
}

function migrationContract(id, source) {
  if (typeof source !== "string") return false;
  if (id === "source-projector-lease") {
    return (
      source.includes("try_acquire_projector_runtime_lease_v1") &&
      source.includes("release_projector_runtime_lease_v1") &&
      /force row level security/iu.test(source)
    );
  }
  if (id === "source-projector-provider-evidence") {
    return (
      source.includes("projection_provider_execution_evidence") &&
      source.includes("reward_snapshot_provider_evidence") &&
      source.includes("projection_publication_provider_bindings") &&
      /force row level security/iu.test(source)
    );
  }
  if (id === "source-projector-safe-head-reuse") {
    return (
      source.includes("append_or_reuse_safe_head_observation_v1") &&
      source.includes(
        "safe_head_observations_epoch_id_content_fingerprint_key",
      ) &&
      source.includes("for key share") &&
      source.includes("safe-head fingerprint replay conflicts with stored evidence") &&
      /security definer/iu.test(source)
    );
  }
  if (id === "source-projector-dynamic-lineage") {
    return (
      source.includes("accept_uuid_v8_dynamic_source_lineage") ||
      (source.includes("dynamic_source") &&
        source.includes("uuid") &&
        /security definer/iu.test(source))
    );
  }
  if (id === "source-projector-block-evidence-reuse") {
    return (
      source.includes("append_or_reuse_dual_rpc_block_evidence_v1") &&
      source.includes(
        "dual_rpc_block_evidence_epoch_id_content_fingerprint_key",
      ) &&
      source.includes("block-evidence fingerprint replay conflicts with stored evidence") &&
      /security definer/iu.test(source)
    );
  }
  if (id === "source-projector-block-evidence-conflict-fence") {
    return (
      source.includes("append_or_reuse_dual_rpc_block_evidence_v1") &&
      source.includes(
        "dual_rpc_block_evidence_epoch_id_content_fingerprint_key",
      ) &&
      source.includes(
        "dual_rpc_block_evidence_observation_id_block_number_key",
      ) &&
      source.includes("for key share") &&
      /security definer/iu.test(source)
    );
  }
  if (id === "market-projector-fast-lane") {
    return (
      source.includes("list_market_projector_fast_lane_v1") &&
      source.includes("assert_market_projector_fast_lane_v1") &&
      source.includes("try_lock_market_projector_pool_v1") &&
      source.includes("projector_checkpoint_current") &&
      source.includes("market_projector_cursor_current") &&
      source.includes("chain_event_current_canonical") &&
      source.includes("market_block_closes") &&
      source.includes("source_checkpoint_block_hash") &&
      /security definer/iu.test(source) &&
      /grant execute[\s\S]*to programmable_reconciler/iu.test(source)
    );
  }
  if (id === "candidate-control-bootstrap") {
    return (
      source.includes("candidate_database_control") &&
      source.includes("initialize_candidate_database") &&
      source.includes("attest_candidate_database_promotion") &&
      source.includes("enforce_candidate_database_promotion") &&
      /force row level security/iu.test(source)
    );
  }
  if (id === "candidate-unpromoted-gate") {
    return (
      source.includes("verify_candidate_database_unpromoted_v1") &&
      source.includes("envio:production-7f24e63") &&
      source.includes("programmable_private.assert_caller('programmable_projector')") &&
      /grant execute[\s\S]*to programmable_projector/iu.test(source)
    );
  }
  if (id === "candidate-promoted-gate") {
    return (
      source.includes("verify_candidate_database_promoted_v1") &&
      source.includes("envio:production-7f24e63") &&
      source.includes("programmable_private.assert_caller('programmable_projector')") &&
      /grant execute[\s\S]*to programmable_projector/iu.test(source)
    );
  }
  if (id === "candidate-product-binding") {
    return (
      source.includes("candidate_database_control_product_binding") &&
      source.includes("product_commit") &&
      source.includes("staged_deployment_id") &&
      source.includes("verify_candidate_database_promoted_v2") &&
      source.includes("candidate product-bound promotion CAS lost") &&
      /validate constraint candidate_database_control_product_binding/iu.test(source)
    );
  }
  if (id === "market-projector") {
    return (
      source.includes("market_projector_cursor_history") &&
      source.includes("market_snapshot_lineage_memberships") &&
      source.includes("market_candle_lineage_memberships") &&
      source.includes("try_acquire_market_projector_runtime_lease_v1") &&
      source.includes("assert_market_projector_runtime_lease_v1") &&
      source.includes("release_market_projector_runtime_lease_v1") &&
      source.includes("projector_checkpoint_current") &&
      /cursor_block_global_log_index\s*<>\s*4294967295/iu.test(source) &&
      /cursor_candidate_id\s*<>\s*'empty-page'/iu.test(source) &&
      /force row level security/iu.test(source)
    );
  }
  return false;
}

export function evaluateReadModelOperationsSourceContracts(
  rootDirectory,
  options = {},
) {
  const overrides = options.sourceOverrides ?? {};
  const expectedSha256Overrides = options.expectedSha256Overrides ?? {};
  const source = (path) => readSource(rootDirectory, path, overrides);
  const checks = [];
  const failures = [];
  const check = (id, condition, detail) => {
    const status = condition ? "pass" : "fail";
    checks.push({ id, status, detail });
    if (!condition) failures.push({ id, detail });
  };

  const operations = parseJson(source("config/read-model-operations.v1.json"));
  const vercel = parseJson(source("vercel.json"));
  const crons = exactCronMap(vercel);
  const workers = Array.isArray(operations?.workers) ? operations.workers : [];
  const eventTriggers = Array.isArray(operations?.eventTriggers)
    ? operations.eventTriggers
    : [];
  const releaseGates = operations?.releaseGates;
  const unscheduled = Array.isArray(operations?.unscheduled)
    ? operations.unscheduled
    : [];
  const approvedCrons = new Map([
    [APPROVED_OPERATIONS.legacyIndexer.path, APPROVED_OPERATIONS.legacyIndexer.schedule],
    ...APPROVED_OPERATIONS.workers.map((worker) => [worker.path, worker.schedule]),
    ...APPROVED_OPERATIONS.independentCrons.map((cron) => [cron.path, cron.schedule]),
  ]);

  check(
    "ops-config-schema",
    operations?.schemaVersion === 1 &&
      exactJson(operations?.legacyIndexer, APPROVED_OPERATIONS.legacyIndexer) &&
      exactJson(workers, APPROVED_OPERATIONS.workers) &&
      exactJson(eventTriggers, APPROVED_OPERATIONS.eventTriggers) &&
      exactJson(releaseGates, APPROVED_OPERATIONS.releaseGates),
    "the manifest exactly binds the reviewed indexers, workers, event trigger and release gates",
  );
  check(
    "ops-cron-exact-set",
    crons !== null &&
      crons.size === approvedCrons.size &&
      [...approvedCrons].every(
        ([path, schedule]) => crons.get(path) === schedule,
      ),
    "Vercel has only the independently approved schedules",
  );
  for (const approvedCron of APPROVED_OPERATIONS.independentCrons) {
    const route = source(approvedCron.route.path);
    const auth = approvedCron.auth ? source(approvedCron.auth.path) : "";
    const runtime = source(approvedCron.runtime.path);
    check(
      `ops-${approvedCron.id}-schedule`,
      crons?.get(approvedCron.path) === approvedCron.schedule,
      `${approvedCron.id} has its independently fixed production schedule`,
    );
    check(
      `ops-${approvedCron.id}-source-digests`,
      sourceBindingMatches(source, approvedCron.route, expectedSha256Overrides) &&
        (!approvedCron.auth
          || sourceBindingMatches(source, approvedCron.auth, expectedSha256Overrides)) &&
        sourceBindingMatches(source, approvedCron.runtime, expectedSha256Overrides) &&
        (approvedCron.dependencies ?? []).every((binding) =>
          sourceBindingMatches(source, binding, expectedSha256Overrides)
        ) &&
        sourceBindingMatches(source, approvedCron.policy, expectedSha256Overrides),
      `${approvedCron.id} route, runtime and policy match reviewed bytes`,
    );
    check(
      `ops-${approvedCron.id}-route-auth`,
      routeIsAuthenticatedAndFailClosed(`${route}\n${auth}`),
      `${approvedCron.id} requires the bounded timing-safe cron secret and fails closed`,
    );
    check(
      `ops-${approvedCron.id}-activation`,
      runtime.includes(`env.${approvedCron.activationEnvironment}`) &&
        runtime.includes(`env.${approvedCron.activationEnvironment} !== "true"`) &&
        exactFalseEnvironmentKey(source(".env.example"), approvedCron.activationEnvironment),
      `${approvedCron.id} is disabled by default behind one server-only activation flag`,
    );
  }
  check(
    "ops-legacy-cron-preserved",
    crons?.get(APPROVED_OPERATIONS.legacyIndexer.path) ===
      APPROVED_OPERATIONS.legacyIndexer.schedule &&
      sha256(source(APPROVED_OPERATIONS.legacyIndexer.route)) ===
        expectedDigest(
          APPROVED_OPERATIONS.legacyIndexer.route,
          APPROVED_OPERATIONS.legacyIndexer.sha256,
          expectedSha256Overrides,
        ),
    "the five-minute legacy route remains byte-bound until indexed-read cutover",
  );
  const schedulerWatchdog = operations?.legacyIndexer?.schedulerWatchdog;
  check(
    "ops-legacy-scheduler-watchdog",
    exactJson(
      schedulerWatchdog,
      APPROVED_OPERATIONS.legacyIndexer.schedulerWatchdog,
    ) &&
      sourceBindingMatches(
        source,
        schedulerWatchdog?.workflow,
        expectedSha256Overrides,
      ) &&
      legacySchedulerWatchdogIsFailClosed(
        source(APPROVED_OPERATIONS.legacyIndexer.schedulerWatchdog.workflow.path),
        schedulerWatchdog,
        source,
        expectedSha256Overrides,
      ),
    "the generic GitHub watchdog refreshes only the public durable read model and proves freshness plus RPC quorum",
  );
  const closedLegacyAlias = APPROVED_OPERATIONS.legacyIndexer.closedAlias;
  check(
    "ops-legacy-alias-closed",
    !crons?.has(closedLegacyAlias.path) &&
      exactJson(
        operations?.legacyIndexer?.closedAlias,
        closedLegacyAlias,
      ) &&
      sha256(source(closedLegacyAlias.route)) === closedLegacyAlias.sha256 &&
      routeIsPermanentlyClosed(
        source(closedLegacyAlias.route),
        closedLegacyAlias,
      ),
    "the former legacy writer alias is byte-bound to a permanent 410 response",
  );

  for (const approvedWorker of APPROVED_OPERATIONS.workers) {
    const worker = workers.find(({ id }) => id === approvedWorker.id);
    const route = source(approvedWorker.route.path);
    const runtime = source(approvedWorker.runtime.path);
    check(
      `ops-${approvedWorker.id}-schedule`,
      worker?.path === approvedWorker.path &&
        worker?.schedule === approvedWorker.schedule &&
        crons?.get(approvedWorker.path) === approvedWorker.schedule,
      `${approvedWorker.id} has its independently fixed production schedule`,
    );
    check(
      `ops-${approvedWorker.id}-source-digests`,
      sourceBindingMatches(source, worker?.route, expectedSha256Overrides) &&
      sourceBindingMatches(source, worker?.runtime, expectedSha256Overrides) &&
        (approvedWorker.dependencies ?? []).every((binding, index) =>
          sourceBindingMatches(
            source,
            worker?.dependencies?.[index],
            expectedSha256Overrides,
          ),
        ) &&
        approvedWorker.migrations.every((binding, index) =>
          sourceBindingMatches(
            source,
            worker?.migrations?.[index],
            expectedSha256Overrides,
          ),
        ),
      `${approvedWorker.id} route, runtime and migrations match reviewed bytes`,
    );
    check(
      `ops-${approvedWorker.id}-route-auth`,
      routeIsAuthenticatedAndFailClosed(
        route,
        approvedWorker.id === "source-projector",
      ),
      `${approvedWorker.id} reads Authorization, compares CRON_SECRET safely and fails closed`,
    );
    check(
      `ops-${approvedWorker.id}-activation`,
      worker?.activationEnvironment === approvedWorker.activationEnvironment &&
        activationIsExplicitAndSafe(runtime, approvedWorker.activationEnvironment),
      `${approvedWorker.id} is false by default and only exact true activates work`,
    );
    const runtimeBinding = approvedWorker.id === "source-projector"
      ? typeof runtime === "string" &&
        runtime.includes("createProjectorRuntimeLeaseController") &&
        /leaseController\.tryAcquire\(\)/u.test(runtime) &&
        /acquisition\.status\s*===\s*["']busy["']/u.test(runtime)
      : typeof runtime === "string" &&
        /store\.tryAcquireLease\(\)/u.test(runtime) &&
        /store\.releaseLease\(lease\)/u.test(runtime) &&
        /status\s*:\s*["']busy["']/u.test(runtime) &&
        runtime.includes("sourceCheckpointGeneration");
    check(
      `ops-${approvedWorker.id}-runtime-binding`,
      runtimeBinding,
      `${approvedWorker.id} executes through its singleton lease and checkpoint binding`,
    );
  }

  const approvedTrigger = APPROVED_OPERATIONS.eventTriggers[0];
  const eventTrigger = eventTriggers.find(({ id }) => id === approvedTrigger.id);
  check(
    "ops-quicknode-stream-wake-binding",
    eventTriggers.length === 1 &&
      eventTrigger?.path === approvedTrigger.path &&
      !crons?.has(approvedTrigger.path) &&
      sourceBindingMatches(source, eventTrigger?.route, expectedSha256Overrides) &&
      sourceBindingMatches(source, eventTrigger?.verifier, expectedSha256Overrides) &&
      sourceBindingMatches(source, eventTrigger?.canary, expectedSha256Overrides) &&
      (eventTrigger?.dependencies ?? []).length ===
        (approvedTrigger.dependencies ?? []).length &&
      (approvedTrigger.dependencies ?? []).every((binding, index) =>
        sourceBindingMatches(
          source,
          eventTrigger?.dependencies?.[index],
          expectedSha256Overrides,
        ) && exactJson(binding, eventTrigger?.dependencies?.[index])
      ) &&
      eventTriggerIsAuthenticatedAndBound(
        source(approvedTrigger.route.path),
        source(approvedTrigger.verifier.path),
        eventTrigger,
      ) &&
      eventTriggerCanaryIsFailClosed(
        source(approvedTrigger.canary.path),
        eventTrigger,
      ),
    "the unscheduled QuickNode webhook is HMAC-authenticated and only wakes the fenced projectors",
  );

  const approvedRealBlockSla = APPROVED_OPERATIONS.releaseGates.realBlockSla;
  const realBlockSla = releaseGates?.realBlockSla;
  check(
    "ops-real-block-sla-gate-binding",
    releaseGates?.authOnlyWakeCanary?.satisfiesRealBlockSla === false &&
      sourceBindingMatches(
        source,
        realBlockSla?.script,
        expectedSha256Overrides,
      ) &&
      sourceBindingMatches(
        source,
        realBlockSla?.schema,
        expectedSha256Overrides,
      ) &&
      realBlockSlaGateIsFailClosed(
        source(approvedRealBlockSla.script.path),
        source(approvedRealBlockSla.schema.path),
        realBlockSla,
      ),
    "auth-only probes stay separate and production promotion requires exact real-block SLA evidence",
  );

  check(
    "ops-reconciler-unscheduled",
    unscheduled.length === 1 &&
      unscheduled[0]?.path === "/api/ops/reconcile-preparity" &&
      !crons?.has(unscheduled[0].path) &&
      ![...(crons?.keys() ?? [])].some((path) => /reconcil/iu.test(path)),
    "the reconciler stays unscheduled until every active release family is supported",
  );

  const sourceWorker = workers.find(({ id }) => id === "source-projector");
  const marketWorker = workers.find(({ id }) => id === "market-projector");
  check(
    "ops-source-projector-migrations",
    sourceWorker?.dependencies?.length === 1 &&
      source(sourceWorker.dependencies[0]?.path)?.includes(
        "verify_candidate_database_promoted_v2",
      ) &&
      sourceWorker?.migrations?.length === 10 &&
      migrationContract(
        "source-projector-lease",
        source(sourceWorker.migrations[0]?.path),
      ) &&
      migrationContract(
        "source-projector-provider-evidence",
        source(sourceWorker.migrations[1]?.path),
      ) &&
      migrationContract(
        "candidate-control-bootstrap",
        source(sourceWorker.migrations[2]?.path),
      ) &&
      migrationContract(
        "candidate-unpromoted-gate",
        source(sourceWorker.migrations[3]?.path),
      ) &&
      migrationContract(
        "candidate-promoted-gate",
        source(sourceWorker.migrations[4]?.path),
      ) &&
      migrationContract(
        "candidate-product-binding",
        source(sourceWorker.migrations[5]?.path),
      ) &&
      migrationContract(
        "source-projector-safe-head-reuse",
        source(sourceWorker.migrations[6]?.path),
      ) &&
      migrationContract(
        "source-projector-dynamic-lineage",
        source(sourceWorker.migrations[7]?.path),
      ) &&
      migrationContract(
        "source-projector-block-evidence-reuse",
        source(sourceWorker.migrations[8]?.path),
      ) &&
      migrationContract(
        "source-projector-block-evidence-conflict-fence",
        source(sourceWorker.migrations[9]?.path),
      ),
    "the source worker is byte-bound to its runtime selector, database fence and provider evidence",
  );
  check(
    "ops-market-projector-migration",
    marketWorker?.migrations?.length === 3 &&
      migrationContract(
        "market-projector",
        source(marketWorker.migrations[0]?.path),
      ) &&
      migrationContract(
        "market-projector-fast-lane",
        source(marketWorker.migrations[1]?.path),
      ) &&
      source(marketWorker.migrations[2]?.path)?.includes(
        "market_projector_health_v1",
      ),
    "the market worker is bound to exact lineage, terminal checkpoint and lease SQL",
  );

  const deployWorkflow = source(".github/workflows/deploy-production.yml") ?? "";
  const verifyWorkflow = source(".github/workflows/verify.yml") ?? "";
  const packageJson = parseJson(source("package.json"));
  const deployPolicy = source("scripts/perf/read-model-deploy-policy.mjs") ?? "";
  const wakeCanary = source(approvedTrigger.canary.path) ?? "";
  const environmentExample = source(".env.example") ?? "";
  const realBlockSlaOperator = source(
    "scripts/perf/read-model-real-block-sla-operator.mjs",
  ) ?? "";
  const postPromotion = source("scripts/perf/read-model-post-promotion.mjs") ?? "";
  const postCurrentEvidenceStart = postPromotion.indexOf(
    "function exactCanonicalClassicNativeToken",
  );
  const postCurrentEvidenceEnd = postPromotion.indexOf(
    "function exactExploreRanking",
  );
  const postCurrentEvidenceBlock =
    postCurrentEvidenceStart >= 0 &&
      postCurrentEvidenceEnd > postCurrentEvidenceStart
      ? postPromotion.slice(postCurrentEvidenceStart, postCurrentEvidenceEnd)
      : "";
  const postGlobalRankingEnd = postPromotion.indexOf(
    "function exactCurrentPublicDetail",
  );
  const postGlobalRankingBlock =
    postCurrentEvidenceEnd >= 0 &&
      postGlobalRankingEnd > postCurrentEvidenceEnd
      ? postPromotion.slice(postCurrentEvidenceEnd, postGlobalRankingEnd)
      : "";
  const postDetailChartEnd = postPromotion.indexOf("function publicChecks");
  const postDetailChartBlock =
    postGlobalRankingEnd >= 0 && postDetailChartEnd > postGlobalRankingEnd
      ? postPromotion.slice(postGlobalRankingEnd, postDetailChartEnd)
      : "";
  const bitqueryGoldenParity = source(
    "scripts/perf/bitquery-golden-market-parity.mjs",
  ) ?? "";
  const bitqueryHistoricalRelease = source(
    "scripts/perf/bitquery-historical-release-gate.mjs",
  ) ?? "";
  const productionBinding = source(
    "scripts/perf/read-model-production-binding.mjs",
  ) ?? "";
  const operationsRunbook = source(
    "docs/operations/read-model-scheduler-cutover.md",
  ) ?? "";
  const productionCutoverRunbook = source(
    "docs/data-pipeline/PRODUCTION-CUTOVER-OPERATOR.md",
  ) ?? "";
  check(
    "ops-package-verify-binding",
    packageJson?.scripts?.verify?.includes("npm run perf:read-model:ops-gate") === true,
    "the canonical local verification command runs the operations source contract",
  );
  check(
    "ops-real-block-sla-package-binding",
    packageJson?.scripts?.["perf:read-model:real-block-sla"] ===
      `node ${approvedRealBlockSla.script.path}`,
    "the immutable real-block SLA verifier has one reviewed operator command",
  );
  check(
    "ops-real-block-sla-operator-binding",
    packageJson?.scripts?.["perf:read-model:real-block-sla-operator"] ===
      "node scripts/perf/read-model-real-block-sla-operator.mjs" &&
      realBlockSlaOperator.includes(
        "REAL_BLOCK_SLA_OPERATOR_MAXIMUM_WAIT_MS = 5 * 60 * 1_000",
      ) &&
      realBlockSlaOperator.includes('body: { armId, challenge }') &&
      realBlockSlaOperator.includes('open(absolutePath, "wx", 0o600)') &&
      realBlockSlaOperator.includes("verifyRealBlockSlaDatabaseAttestation") &&
      realBlockSlaOperator.includes("runtime.repositoryCommit !== input.expectedRepositoryCommit") &&
      realBlockSlaOperator.includes("runtime.deploymentId !== input.deploymentId") &&
      realBlockSlaOperator.includes("runtime.deploymentOrigin !== input.targetUrl") &&
      realBlockSlaOperator.includes("runtime.projectId !== input.projectId") &&
      realBlockSlaOperator.includes("runtime.streamId !== input.streamId") &&
      realBlockSlaOperator.includes("![0, 409, 503].includes(result.status)") &&
      !realBlockSlaOperator.includes('"--probe-token"') &&
      !realBlockSlaOperator.includes('"--automation-bypass-secret"') &&
      operationsRunbook.includes(
        "npm run perf:read-model:real-block-sla-operator --",
      ) &&
      productionCutoverRunbook.includes(
        "npm run perf:read-model:real-block-sla-operator --",
      ) &&
      operationsRunbook.includes(
        `--output ${EXACT_REAL_BLOCK_SLA_OUTPUT}`,
      ) &&
      productionCutoverRunbook.includes(
        `--output ${EXACT_REAL_BLOCK_SLA_OUTPUT}`,
      ) &&
      operationsRunbook.includes(
        `--evidence ${EXACT_REAL_BLOCK_SLA_OUTPUT}`,
      ) &&
      productionCutoverRunbook.includes(
        `--evidence ${EXACT_REAL_BLOCK_SLA_OUTPUT}`,
      ),
    "the operator arms and polls the exact staged deployment before writing one private evidence file",
  );
  check(
    "ops-quicknode-stream-env-contract",
    exactEmptyEnvironmentKey(
      environmentExample,
      approvedTrigger.secretEnvironment,
    ) &&
      exactFalseEnvironmentKey(
        environmentExample,
        "PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE",
      ) &&
      deployPolicy.includes("PROJECTOR_WAKE_ROUTE") &&
      deployPolicy.includes("QUICKNODE_STREAM_SECRET_ENV_NAME") &&
      deployPolicy.includes('from "./read-model-projector-wake-canary.mjs"') &&
      deployPolicy.includes("wake_route=${result.wakeRoute}") &&
      deployPolicy.includes("wake_canary_required=${result.wakeCanaryRequired}") &&
      deployPolicy.includes("invalidServerSecretEnvironmentNames"),
    "the stream secret name is documented without a value and is fail-closed in deploy policy",
  );
  check(
    "ops-vercel-sensitive-runtime-metadata",
    deployWorkflow.includes(
      "Capture sensitive production environment metadata",
    ) &&
      deployWorkflow.includes(
        'vercel env ls production --format json --token="$VERCEL_TOKEN" > "$RUNNER_TEMP/vercel-production-env-metadata.json"',
      ) &&
      (deployWorkflow.match(/--sensitive-env-metadata/gu) ?? []).length === 2 &&
      deployPolicy.includes(
        "materializeVercelSensitiveRuntimePlaceholders",
      ) &&
      deployPolicy.includes(
        'BITQUERY_MARKET_SECRET_ENV_NAME = "BITQUERY_OAUTH_TOKEN"',
      ) &&
      exactEmptyEnvironmentKey(environmentExample, "BITQUERY_OAUTH_TOKEN") &&
      deployPolicy.includes(
        "...new Set([BITQUERY_MARKET_SECRET_ENV_NAME, ...emptyNames])",
      ) &&
      deployPolicy.includes("validateRequiredServerSecrets") &&
      deployPolicy.includes(": [BITQUERY_MARKET_SECRET_ENV_NAME];") &&
      deployPolicy.includes('matches[0].type !== "sensitive"') &&
      deployPolicy.includes('matches[0].target[0] !== "production"') &&
      deployPolicy.includes('Object.hasOwn(matches[0], "value")'),
    "Bitquery always requires exact value-free sensitive production metadata",
  );
  const stagedWakeGate = deployWorkflow.indexOf(
    "Gate exact staged QuickNode wake route",
  );
  const stagedWakeGateEnd = deployWorkflow.indexOf(
    "Attest exact staged release policy",
  );
  const stagedWakeGateBlock =
    stagedWakeGate >= 0 && stagedWakeGateEnd > stagedWakeGate
      ? deployWorkflow.slice(stagedWakeGate, stagedWakeGateEnd)
      : "";
  check(
    "ops-quicknode-stream-stage-gate",
    packageJson?.scripts?.["perf:read-model:wake-canary"] ===
      `node ${approvedTrigger.canary.path}` &&
      wakeCanary.includes("projectorWakeCanaryArgumentsFrom") &&
      stagedWakeGate > deployWorkflow.indexOf("Resolve exact staged deployment") &&
      stagedWakeGate < stagedWakeGateEnd &&
      stagedWakeGateBlock.includes(
        "if: needs.release-gate.outputs.verified_read_model == 'true' && steps.read-model-policy.outputs.wake_canary_required == 'true'",
      ) &&
      stagedWakeGateBlock.includes(
        "PROGRAMMABLE_QUICKNODE_STREAM_SECRET: ${{ secrets.PROGRAMMABLE_QUICKNODE_STREAM_SECRET }}",
      ) &&
      stagedWakeGateBlock.includes(
        "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
      ) &&
      stagedWakeGateBlock.includes(
        "STAGED_TARGET_URL: ${{ steps.staged-deployment.outputs.target_url }}",
      ) &&
      stagedWakeGateBlock.includes("npm run perf:read-model:wake-canary --") &&
      stagedWakeGateBlock.includes('--target-url "$STAGED_TARGET_URL"'),
    "an active fast lane must pass the exact unaliased staged wake canary before attestation",
  );
  const stagedBitquerySmoke = deployWorkflow.indexOf(
    "Smoke staged public market APIs",
  );
  const stagedBitquerySmokeEnd = deployWorkflow.indexOf(
    "Record registry identity and combined market path",
  );
  const stagedBitquerySmokeBlock =
    stagedBitquerySmoke >= 0 && stagedBitquerySmokeEnd > stagedBitquerySmoke
      ? deployWorkflow.slice(stagedBitquerySmoke, stagedBitquerySmokeEnd)
      : "";
  check(
    "ops-protected-bitquery-stage-smoke",
    stagedBitquerySmoke > stagedWakeGateEnd &&
      includesEverySourceFragment(
        stagedBitquerySmokeBlock,
        STAGED_MARKET_EVIDENCE_SOURCE_GUARDS,
      ) &&
      stagedBitquerySmokeBlock.includes(
        "if: needs.release-gate.outputs.verified_read_model == 'true'",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
      ) &&
      stagedBitquerySmokeBlock.includes(
        '"https://ethereum-rpc.publicnode.com"',
      ) &&
      stagedBitquerySmokeBlock.includes('"https://rpc.mevblocker.io"') &&
      stagedBitquerySmokeBlock.includes("rpcUrls: independentRpcUrls") &&
      !stagedBitquerySmokeBlock.includes("MAINNET_RPC_URL_A") &&
      !stagedBitquerySmokeBlock.includes("MAINNET_RPC_URL_B") &&
      !stagedBitquerySmokeBlock.includes(
        "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT",
      ) &&
      !stagedBitquerySmokeBlock.includes(
        "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT",
      ) &&
      !stagedBitquerySmokeBlock.includes(
        "runtimeProductionProviderBindingsFromUrls",
      ) &&
      !stagedBitquerySmokeBlock.includes(
        '"./scripts/perf/read-model-provider-binding.mjs"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        "process.env.VERCEL_AUTOMATION_BYPASS_SECRET",
      ) &&
      stagedBitquerySmokeBlock.includes(
        'Buffer.byteLength(\n            automationBypassSecret ?? "",\n            "utf8",\n          )',
      ) &&
      stagedBitquerySmokeBlock.includes("automationBypassSecretLength < 32") &&
      stagedBitquerySmokeBlock.includes("automationBypassSecretLength > 512") &&
      stagedBitquerySmokeBlock.includes(
        "/[\\r\\n]/.test(automationBypassSecret)",
      ) &&
      stagedBitquerySmokeBlock.includes(
        '"x-vercel-protection-bypass": automationBypassSecret',
      ) &&
      stagedBitquerySmokeBlock.includes("headers: bitquerySmokeRequestHeaders") &&
      stagedBitquerySmokeBlock.includes(
        "STAGED_TARGET_URL: ${{ steps.staged-deployment.outputs.target_url }}",
      ) &&
      stagedBitquerySmokeBlock.includes(
        'readSources: Object.freeze(["operational+durable+postgres"]),',
      ) &&
      stagedBitquerySmokeBlock.includes("rpcProviders: null") &&
      stagedBitquerySmokeBlock.includes(
        'marketSources: Object.freeze([currentPublicMarketSource]),',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'priceSources: Object.freeze(["stateview-chainlink"]),',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'dataQualities: Object.freeze(["complete", "partial", "stale"]),',
      ) &&
      stagedBitquerySmokeBlock.includes(
        "const bitqueryChartContract = Object.freeze({",
      ) &&
      stagedBitquerySmokeBlock.includes(
        'response.headers.get(\n                  "x-programmable-market-source",',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'response.headers.get(\n                  "x-programmable-price-source",',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'response.headers.get(\n                  "x-programmable-market-as-of",',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'response.headers.get(\n                  "x-programmable-data-quality",',
      ) &&
      stagedBitquerySmokeBlock.includes(
        "!headerMatches(rpcProvider, contract.rpcProviders)",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "!headerMatches(marketSource, contract.marketSources)",
      ) &&
      !stagedBitquerySmokeBlock.includes(
        'response.headers.get("x-programmable-rpc-provider") !== "alchemy"',
      ) &&
      !stagedBitquerySmokeBlock.includes("alchemyIdentityContract") &&
      !stagedBitquerySmokeBlock.includes("/api/indexers/v1/token-list") &&
      stagedBitquerySmokeBlock.includes(
        '`/api/explore?limit=${marketCapPageSize}&page=1&sort=market-cap`,\n            currentPublicMarketContract,',
      ) &&
      stagedBitquerySmokeBlock.includes(
        "marketCapTotal > maximumMarketCapTokens",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "marketCapTokens.length !== marketCapTotal",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "seenMarketCapIds.has(token.id)",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "seenMarketCapAddresses.has(address)",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "entry.launchCategoryProvenance.blockNumber",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "entry.launchCategoryProvenance.transactionIndex",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "entry.launchCategoryProvenance.logIndex",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "staged Bitquery newest entry has no canonical launch order",
      ) &&
      stagedBitquerySmokeBlock.includes("coordinates === null") &&
      stagedBitquerySmokeBlock.includes("const newestPageSize = 100") &&
      stagedBitquerySmokeBlock.includes("seenNewestIds") &&
      stagedBitquerySmokeBlock.includes("newestTokens.length !== newestTotal") &&
      stagedBitquerySmokeBlock.includes("launchChainId(entry) !== newestChainId") &&
      stagedBitquerySmokeBlock.includes("sort=oldest") &&
      stagedBitquerySmokeBlock.includes(
        "staged Bitquery oldest page is not ordered oldest-first",
      ) &&
      stagedBitquerySmokeBlock.includes("/api/explore/token?address=") &&
      stagedBitquerySmokeBlock.includes(
        "/api/explore?limit=20&page=1&q=${goldenTokenAddress}&sort=market-cap",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "staged Explore exposed the non-public PCAN release canary",
      ) &&
      stagedBitquerySmokeBlock.includes("goldenSearch.total !== 0") &&
      stagedBitquerySmokeBlock.includes(
        "/api/explore/token/chart?address=${goldenTokenAddress}&range=all",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "`/api/explore/token/chart?address=${goldenTokenAddress}&range=all`,\n            bitqueryChartContract,",
      ) &&
      stagedBitquerySmokeBlock.includes(
        '"0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        '"0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'goldenMarket?.schemaVersion !== "programmable.market-data.v1"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'goldenChart.schemaVersion !== "programmable.market-chart.v1"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        "goldenChart.identity?.quoteAddress,\n              goldenQuoteAddress",
      ) &&
      stagedBitquerySmokeBlock.includes(
        '"staged Bitquery Highest FDV is not monotonically descending"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        '"staged Bitquery Explore exposed unevidenced numeric FDV"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'valuation.reason === "waiting-for-first-trade"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'tokenAddress === goldenTokenAddress',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'valuation.source !== "stateview-chainlink"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'price?.source !== "uniswap-v4-stateview-chainlink-v1"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'liquidity?.source !== "official-uniswap-v4-subgraph"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        "provenance?.subgraphId !== officialV4SubgraphId",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "provenance?.deployment !== officialV4SubgraphDeployment",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "BigInt(liquidity.tvlUsdWad) <",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "minimumPublicFdvLiquidityUsdWad",
      ) &&
      stagedBitquerySmokeBlock.includes(
        'token.launchModel !== "classic"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'liquidity.valueBasis !== "official-subgraph-pool-tvl-usd"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        "lagBlocks <= 64n",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "valuation.asOfBlock === provenance.referenceHeadBlockNumber",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "expectedFdvUsdWad.toString() === valuation.valueWad",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "expectedActiveVirtualLiquidityUsdWad >=",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "price.activeVirtualLiquidityUsdWad",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "price.activeVirtualToken0Wei",
      ) &&
      stagedBitquerySmokeBlock.includes(
        '"stateview-active-liquidity-virtual-depth-usd"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        '"staged public current FDV lacks exact StateView, Chainlink and official v4 liquidity evidence"',
      ) &&
      stagedBitquerySmokeBlock.includes("if (currentFdvCount < 1) {") &&
      stagedBitquerySmokeBlock.includes(
        '"staged public market path has no current non-PCAN FDV bound to fresh official v4 liquidity"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        '"staged current detail does not independently prove an equal or newer evidence bundle"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'goldenValuation.metric !== "fdv"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'goldenValuation.supplyBasis !== "total"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        '"./scripts/perf/bitquery-golden-market-parity.mjs"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        '"./scripts/perf/bitquery-historical-release-gate.mjs"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        "await verifyBitqueryGoldenMarketExecutionV1({",
      ) &&
      bitqueryGoldenParity.includes(
        '"https://rpc.mevblocker.io"',
      ) &&
      bitqueryGoldenParity.includes(
        '"https://mainnet.gateway.tenderly.co"',
      ) &&
      !bitqueryGoldenParity.includes("ethereum-rpc.publicnode.com") &&
      !bitqueryGoldenParity.includes("MAINNET_STATE_VIEW") &&
      !bitqueryGoldenParity.includes("Q192") &&
      bitqueryGoldenParity.includes(
        "const MAXIMUM_EXECUTION_USD_DEVIATION_BPS = 25n",
      ) &&
      bitqueryGoldenParity.includes("const MINIMUM_CONFIRMATIONS = 12n") &&
      bitqueryGoldenParity.includes(
        '"event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)"',
      ) &&
      bitqueryGoldenParity.includes(
        'const MAINNET_POOL_MANAGER = "0x000000000004444c5dc75cb358380d2e3de08a90"',
      ) &&
      bitqueryGoldenParity.includes(
        '"eth_getTransactionReceipt"',
      ) &&
      bitqueryGoldenParity.includes("swapLogs.length !== 1") &&
      bitqueryGoldenParity.includes('eventName: "Swap"') &&
      bitqueryGoldenParity.includes("strict: true") &&
      bitqueryGoldenParity.includes(
        "observation.poolId !== expected.poolId",
      ) &&
      bitqueryGoldenParity.includes(
        "rpcQuantity(receipt?.status, \"receipt status\") !== 1n",
      ) &&
      bitqueryGoldenParity.includes("blockHash,") &&
      bitqueryGoldenParity.includes("requireCanonical: true") &&
      bitqueryGoldenParity.includes("sameObservation(first, second)") &&
      bitqueryGoldenParity.includes(
        "first.amount0 >= 0n",
      ) &&
      bitqueryGoldenParity.includes(
        "first.amount1 !== tokenAmountRaw",
      ) &&
      bitqueryGoldenParity.includes("provider-local trade ordinal") &&
      bitqueryGoldenParity.includes("bitqueryTradeOrdinal,") &&
      bitqueryGoldenParity.includes(
        "receiptLogIndex: Number(first.logIndex)",
      ) &&
      bitqueryGoldenParity.includes(
        "executionPriceQuoteWad !== priceQuoteWad",
      ) &&
      bitqueryGoldenParity.includes(
        "executionNativeAmountWei * 10n ** BigInt(tokenDecimals)",
      ) &&
      bitqueryGoldenParity.includes(
        "executionPriceQuoteWad * first.answer",
      ) &&
      bitqueryGoldenParity.includes(
        "observation.answeredInRound < observation.roundId",
      ) &&
      bitqueryGoldenParity.includes(
        "tradeTime !== Number(first.blockTimestamp) * 1_000",
      ) &&
      !bitqueryGoldenParity.includes("pool?.liquidity?.valueUsdWad") &&
      bitqueryGoldenParity.includes(
        "Bitquery golden execution does not match its receipt witness",
      ) &&
      bitqueryHistoricalRelease.includes(
        "const MAXIMUM_STALE_AGE_MS = 24 * 60 * 60_000",
      ) &&
      bitqueryHistoricalRelease.includes(
        "const MAXIMUM_DEFERRED_PCAN_AGE_MS = 96 * 60 * 60_000",
      ) &&
      bitqueryHistoricalRelease.includes(
        "maximumDeferredPcanAgeMs: MAXIMUM_DEFERRED_PCAN_AGE_MS",
      ) &&
      bitqueryHistoricalRelease.includes(
        "nowMs - Date.parse(valuation.asOfTime) > MAXIMUM_DEFERRED_PCAN_AGE_MS",
      ) &&
      bitqueryHistoricalRelease.includes(
        'throw new Error("historical PCAN release evidence exceeds the 96 hour ceiling")',
      ) &&
      bitqueryHistoricalRelease.includes(
        "export function classifyBitqueryStaleMarketReleaseV1",
      ) &&
      bitqueryHistoricalRelease.includes(
        "export function verifyBitqueryHistoricalGoldenReleaseV2",
      ) &&
      bitqueryHistoricalRelease.includes(
        'parity?.schemaVersion !== "programmable.bitquery-golden-market-execution.v1"',
      ) &&
      bitqueryHistoricalRelease.includes(
        'market?.schemaVersion !== "programmable.market-data.v1"',
      ) &&
      bitqueryHistoricalRelease.includes(
        "poolValuation.valueUsdWad !== expectedValue",
      ) &&
      bitqueryHistoricalRelease.includes(
        'chart?.valuation?.status !== "unavailable"',
      ) &&
      bitqueryHistoricalRelease.includes(
        'chart.valuation.reason !== "source-unavailable"',
      ) &&
      bitqueryHistoricalRelease.includes(
        '"fdvUsdWad" in chart',
      ) &&
      bitqueryHistoricalRelease.includes(
        '"valuationMetric" in chart',
      ) &&
      bitqueryHistoricalRelease.includes(
        "parity.transactionHash !== trade?.transactionHash?.toLowerCase()",
      ) &&
      bitqueryHistoricalRelease.includes(
        "parity.bitqueryTradeOrdinal !== trade?.logIndex",
      ) &&
      bitqueryHistoricalRelease.includes(
        "parity.executionPriceQuoteWad !== trade?.priceQuoteWad",
      ) &&
      bitqueryHistoricalRelease.includes(
        "parity.chainlink?.feedAddress !== MAINNET_ETH_USD_FEED",
      ) &&
      bitqueryHistoricalRelease.includes(
        "BigInt(parity.chainlink.answeredInRound) < BigInt(parity.chainlink.roundId)",
      ) &&
      bitqueryHistoricalRelease.includes(
        "chart?.identity?.poolId !== GOLDEN_POOL_ID",
      ) &&
      bitqueryHistoricalRelease.includes(
        "chart?.identity?.quoteAddress !== GOLDEN_QUOTE_ADDRESS",
      ) &&
      bitqueryHistoricalRelease.includes(
        "lastPoint?.blockNumber !== expectedBlock",
      ) &&
      bitqueryHistoricalRelease.includes(
        "chart.asOfTime !== lastPoint?.observedAt",
      ) &&
      bitqueryHistoricalRelease.includes("!periodMedianIsPositive") &&
      bitqueryHistoricalRelease.includes(
        'lastPoint?.valueSemantics !== "period-median"',
      ) &&
      bitqueryHistoricalRelease.includes("parity.confirmations < MINIMUM_CONFIRMATIONS") &&
      stagedBitquerySmokeBlock.includes(
        "const historicalPaidPathVerified =",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "verifyBitqueryHistoricalGoldenReleaseV2({",
      ) &&
      stagedBitquerySmokeBlock.includes(
        '"programmable.bitquery-historical-release.v2"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        "historicalGoldenRelease.confirmations >= 12",
      ) &&
      stagedBitquerySmokeBlock.includes(
        'goldenChart.readStatus !== "live"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        'goldenChart.readStatus === "live"',
      ) &&
      !stagedBitquerySmokeBlock.includes(
        "currentFdvCount < 1 && !historicalPaidPathVerified",
      ) &&
      stagedBitquerySmokeBlock.includes(
        "goldenChart.asOfTime !== goldenChart.points.at(-1)?.observedAt",
      ) &&
      stagedBitquerySmokeBlock.includes(
        'point?.valueSemantics !== "period-median"',
      ) &&
      stagedBitquerySmokeBlock.includes(
        '"staged PCAN chart is not a strictly ordered positive history"',
      ) &&
      (stagedBitquerySmokeBlock.match(/\bfetch\(/gu) ?? []).length === 1 &&
      !stagedBitquerySmokeBlock.includes("/api/ops/health") &&
      !stagedBitquerySmokeBlock.includes("/api/explore/profile") &&
      !/\b(?:database|projector|quicknode|envio|real-block|sla)\b/iu.test(
        stagedBitquerySmokeBlock,
      ) &&
      !stagedBitquerySmokeBlock.includes(
        "NEXT_PUBLIC_VERCEL_AUTOMATION_BYPASS_SECRET",
      ) &&
      !stagedBitquerySmokeBlock.includes("${automationBypassSecret}") &&
      !stagedBitquerySmokeBlock.includes("console."),
    "the staged API smoke binds current StateView and Chainlink FDV to official v4 liquidity while retaining Bitquery trade and chart provenance",
  );
  const stagedReadModelCapture = deployWorkflow.indexOf(
    "Capture staged read-model evidence",
  );
  const stagedReadModelCaptureEnd = deployWorkflow.indexOf(
    "Preserve staged read-model evidence",
  );
  const stagedReadModelCaptureBlock =
    stagedReadModelCapture >= 0 && stagedReadModelCaptureEnd > stagedReadModelCapture
      ? deployWorkflow.slice(stagedReadModelCapture, stagedReadModelCaptureEnd)
      : "";
  check(
    "ops-protected-indexed-stage-capture",
    stagedReadModelCapture > stagedBitquerySmokeEnd &&
      stagedReadModelCaptureBlock.includes(
        "if: needs.release-gate.outputs.verified_read_model == 'true' && steps.read-model-policy.outputs.mode == 'indexed-or-shadow'",
      ) &&
      stagedReadModelCaptureBlock.includes(
        "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
      ) &&
      stagedReadModelCaptureBlock.includes(
        "PROGRAMMABLE_READ_MODEL_TARGET_URL: ${{ steps.staged-deployment.outputs.target_url }}",
      ) &&
      stagedReadModelCaptureBlock.includes(
        "PROGRAMMABLE_READ_MODEL_VERCEL_DEPLOYMENT_ID: ${{ steps.staged-deployment.outputs.deployment_id }}",
      ) &&
      !stagedReadModelCaptureBlock.includes(
        "NEXT_PUBLIC_VERCEL_AUTOMATION_BYPASS_SECRET",
      ),
    "the indexed staged capture receives the protected deployment bypass only inside its exact step",
  );
  const exactVerifyProofGateStart = deployWorkflow.indexOf("  release-gate:");
  const exactVerifyProofGateEnd = deployWorkflow.indexOf("  deploy:");
  const exactVerifyProofGate =
    exactVerifyProofGateStart >= 0 && exactVerifyProofGateEnd > exactVerifyProofGateStart
      ? deployWorkflow.slice(exactVerifyProofGateStart, exactVerifyProofGateEnd)
      : "";
  check(
    "ops-exact-release-dependency",
    deployWorkflow.includes("needs: release-gate") &&
      deployWorkflow.includes("needs.release-gate.outputs.verified_sha") &&
      exactVerifyProofGate.includes(
        "node scripts/production-verify-proof.mjs resolve",
      ) &&
      exactVerifyProofGate.includes(
        "artifact-ids: ${{ steps.resolve-proof.outputs.artifact_id }}",
      ) &&
      exactVerifyProofGate.includes(
        "run-id: ${{ steps.resolve-proof.outputs.verify_run_id }}",
      ) &&
      exactVerifyProofGate.includes("attestations: read") &&
      exactVerifyProofGate.includes("digest-mismatch: error") &&
      exactVerifyProofGate.includes("gh attestation verify") &&
      exactVerifyProofGate.includes(
        '--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/verify.yml"',
      ) &&
      exactVerifyProofGate.includes('--source-ref "$GITHUB_REF"') &&
      exactVerifyProofGate.includes('--source-digest "$GITHUB_SHA"') &&
      exactVerifyProofGate.includes('--signer-digest "$GITHUB_SHA"') &&
      exactVerifyProofGate.includes("--deny-self-hosted-runners") &&
      exactVerifyProofGate.includes(
        "node scripts/production-verify-proof.mjs verify",
      ) &&
      deployWorkflow.includes(
        "name: Revalidate exact Verify proof after production approval",
      ) &&
      deployWorkflow.includes(
        'test "$REVALIDATED_ARTIFACT_ID" = "$EXPECTED_ARTIFACT_ID"',
      ) &&
      deployWorkflow.includes(
        'test "$REVALIDATED_ARTIFACT_DIGEST" = "$EXPECTED_ARTIFACT_DIGEST"',
      ) &&
      !exactVerifyProofGate.includes("npm ci") &&
      !exactVerifyProofGate.includes("pnpm --dir indexer") &&
      !exactVerifyProofGate.includes("npm run verify") &&
      !exactVerifyProofGate.includes("npm run contracts:verify:ci") &&
      deployWorkflow.includes(
        '--meta githubCommitSha="$GITHUB_SHA" --env VERCEL_GIT_COMMIT_SHA="$GITHUB_SHA"',
      ) &&
      deployWorkflow.indexOf("Verify Sigstore provenance and exact proof contents") <
        deployWorkflow.indexOf("vercel build --prod") &&
      deployWorkflow.indexOf(
        "Confirm consumed Verify proof identity after production approval",
      ) < deployWorkflow.indexOf("Pull production configuration"),
    "production staging consumes a fresh exact-SHA full Verify attestation before build",
  );
  check(
    "ops-verify-workflow-binding",
    verifyWorkflow.includes("npm run perf:read-model:ops-gate") &&
      verifyWorkflow.includes("name: Bind production Verify proof") &&
      verifyWorkflow.includes("needs:\n      - scope\n      - secret-scan") &&
      verifyWorkflow.includes(
        "PRODUCTION_VERIFY_INDEXER_RESULT: ${{ needs.scope.outputs.indexer == 'true' && needs.indexer.result || 'skipped' }}",
      ) &&
      verifyWorkflow.includes(
        "PRODUCTION_VERIFY_DATABASE_PGLITE_RESULT: ${{ needs.scope.outputs.database == 'true' && needs.database-pglite.result || 'skipped' }}",
      ) &&
      verifyWorkflow.includes(
        "PRODUCTION_VERIFY_INTERFACE_RESULT: ${{ needs.scope.outputs.interface == 'true' && needs.interface.result || 'skipped' }}",
      ) &&
      verifyWorkflow.includes(
        "PRODUCTION_VERIFY_CONTRACTS_RESULT: ${{ needs.scope.outputs.contracts == 'true' && needs.contracts.result || 'skipped' }}",
      ) &&
      verifyWorkflow.includes(
        "PRODUCTION_VERIFY_SCOPE_READ_MODEL: ${{ needs.scope.outputs.read_model }}",
      ) &&
      verifyWorkflow.includes(
        "uses: actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26",
      ) &&
      verifyWorkflow.includes(
        "production-verify-proof-${{ github.run_id }}-${{ github.run_attempt }}",
      ),
    "production pushes attest the same complete operations contract consumed by staging",
  );
  check(
    "ops-post-promotion-binding",
    deployWorkflow.includes('id: production-before') &&
      deployWorkflow.includes('--reject-git-head "$GITHUB_SHA"') &&
      deployWorkflow.indexOf("id: production-before") <
        deployWorkflow.indexOf("id: deploy") &&
      deployWorkflow.includes(
        "DEPLOYMENT_ID: ${{ steps.staged-deployment.outputs.deployment_id }}",
      ) &&
      deployWorkflow.includes("Stage-only: no production promotion was attempted.") &&
      !deployWorkflow.includes("vercel promote") &&
      !deployWorkflow.includes("vercel rollback") &&
      operationsRunbook.includes("stage-only and must never call `vercel promote`") &&
      manualPromotionSequenceIsFailClosed(operationsRunbook) &&
      manualPromotionSequenceIsFailClosed(productionCutoverRunbook) &&
      postPromotion.includes("verifyProductionDeploymentBinding") &&
      productionBinding.includes("resolveProductionBinding") &&
      postPromotion.includes('"/api/ops/health"') &&
      postPromotion.includes(
        "`/api/explore?limit=${EXPLORE_PAGE_SIZE}&page=1&sort=market-cap`",
      ) &&
      postPromotion.includes(
        '"0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce"',
      ) &&
      postPromotion.includes(
        '"0x5c5a3ebee6840640642ba2bea526621a4962d2c89c388c36a2edb4725802a229"',
      ) &&
      postPromotion.includes("exactBitqueryHeaders") &&
      postPromotion.includes("exactExploreRanking") &&
      postPromotion.includes("exactCurrentPublicFdvLiquidity") &&
      postPromotion.includes("exactGoldenDetail") &&
      postPromotion.includes("exactGoldenSearch") &&
      postPromotion.includes("exactGoldenChart") &&
      postPromotion.includes("quoteAddress: GOLDEN_QUOTE_ADDRESS") &&
      postPromotion.includes(
        'Object.freeze(["1h", "1d", "1w", "all"])',
      ) &&
      includesEverySourceFragment(
        postCurrentEvidenceBlock,
        POST_PROMOTION_CURRENT_EVIDENCE_SOURCE_GUARDS,
      ) &&
      includesEverySourceFragment(
        postGlobalRankingBlock,
        POST_PROMOTION_GLOBAL_RANKING_SOURCE_GUARDS,
      ) &&
      includesEverySourceFragment(
        postDetailChartBlock,
        POST_PROMOTION_DETAIL_CHART_SOURCE_GUARDS,
      ) &&
      postPromotion.includes('chart.readStatus !== "live"') &&
      postPromotion.includes("verifyBitqueryGoldenMarketExecutionV1") &&
      postPromotion.includes("verifyBitqueryHistoricalGoldenReleaseV2") &&
      !postPromotion.includes(
        "verifyBitqueryGoldenMarketExecutionV1({\n      token: responses[4].body?.token,\n      fetchImpl,\n      rpcUrls:",
      ) &&
      postPromotion.includes('id: "production-bitquery-canary-hidden"') &&
      postPromotion.includes(
        "return currentCount > 0 ? { currentToken, tokens } : null;",
      ) &&
      postPromotion.includes(
        'tokenAddress === GOLDEN_TOKEN_ADDRESS',
      ) &&
      postPromotion.includes(
        '!sameBytes32(primary.identity.poolId, market.primaryPoolId)',
      ) &&
      postPromotion.includes(
        'primary.identity.protocol !== "uniswap_v4"',
      ) &&
      postPromotion.includes(
        'liquidity?.source !== "official-uniswap-v4-subgraph"',
      ) &&
      postPromotion.includes(
        "provenance?.subgraphId !== OFFICIAL_V4_SUBGRAPH_ID",
      ) &&
      postPromotion.includes(
        "provenance?.deployment !== OFFICIAL_V4_SUBGRAPH_DEPLOYMENT",
      ) &&
      postPromotion.includes(
        "BigInt(liquidity.tvlUsdWad) < MINIMUM_PUBLIC_FDV_LIQUIDITY_USD_WAD",
      ) &&
      postPromotion.includes(
        'token.launchModel !== "classic"',
      ) &&
      postPromotion.includes(
        'liquidity.valueBasis !== "official-subgraph-pool-tvl-usd"',
      ) &&
      postPromotion.includes(
        "lagBlocks <= OFFICIAL_V4_LIQUIDITY_MAXIMUM_LAG_BLOCKS",
      ) &&
      postPromotion.includes(
        "valuation.asOfBlock === provenance.referenceHeadBlockNumber",
      ) &&
      postPromotion.includes(
        "expectedFdvUsdWad.toString() === valuation.valueWad",
      ) &&
      postPromotion.includes(
        "expectedActiveVirtualLiquidityUsdWad >=",
      ) &&
      postPromotion.includes(
        "price.activeVirtualLiquidityUsdWad",
      ) &&
      postPromotion.includes(
        "price.activeVirtualToken0Wei",
      ) &&
      postPromotion.includes(
        '"stateview-active-liquidity-virtual-depth-usd"',
      ) &&
      postPromotion.includes(
        'id: "production-current-public-detail"',
      ) &&
      postPromotion.includes(
        'id: "production-current-public-bitquery-charts"',
      ) &&
      postPromotion.includes("MAXIMUM_EXPLORE_TOKENS") &&
      postPromotion.includes("responses.length !== totalPages") &&
      postPromotion.includes(
        'valuation.source !== "stateview-chainlink"',
      ) &&
      postPromotion.includes(
        'price?.source !== "uniswap-v4-stateview-chainlink-v1"',
      ) &&
      postPromotion.includes(
        'currentMarketEvidenceTime(quality.asOfTime)',
      ) &&
      postPromotion.includes(
        'id: "production-bitquery-golden-independent-parity"',
      ) &&
      postPromotion.includes('response.headers.get("x-programmable-market-source")') &&
      postPromotion.includes('response.headers.get("x-programmable-price-source")') &&
      postPromotion.includes('response.headers.get("x-programmable-market-as-of")') &&
      postPromotion.includes('"x-programmable-valuation-block"') &&
      postPromotion.includes('response.headers.get("x-programmable-data-quality")') &&
      !postPromotion.includes("/api/indexers/v1/token-list") &&
      postPromotion.includes("verifyLiveCacheAndKeyContracts"),
    "the workflow is stage-only and both operator runbooks require the exact SLA-gated deployment promotion sequence",
  );
  check(
    "ops-vercel-project-prerequisite",
    /Auto-assign Custom Production\s+Domains/u.test(operationsRunbook) &&
      operationsRunbook.includes("only the reviewed manual") &&
      productionBinding.includes("rejectGitHead") &&
      productionBinding.includes("automatic production-domain assignment"),
    "the external Vercel auto-assignment prerequisite is documented and detected fail-closed",
  );

  return { ok: failures.length === 0, checks, failures };
}

function main() {
  const result = evaluateReadModelOperationsSourceContracts(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
