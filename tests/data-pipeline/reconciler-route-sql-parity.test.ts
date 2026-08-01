import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canonicalizeFingerprintJson } from "../../lib/data-pipeline/canonical-fingerprint";
import {
  assembleReconcilerRoutesFromContributions,
  CLASSIC_V3_RECONCILER_REWARD_ALLOCATION_FIELDS,
  CLASSIC_V3_RECONCILER_REWARD_ENTITLEMENT_FIELDS,
  CLASSIC_V3_RECONCILER_REWARD_FIELDS,
  type ClassicV3ReconcilerRouteParts,
} from "../../lib/data-pipeline/classic-v3-reconciler-route-contract";
import type { ReconcilerRouteDto } from "../../lib/data-pipeline/reconciler-preparity";
import {
  CLASSIC_V3_RECONCILER_ROUTE_FIXTURE_PARTS,
  classicV3ReconcilerRouteFixture,
} from "./classic-v3-reconciler-route-fixture";

type RouteParts = Readonly<{
  tokens: readonly unknown[];
  charts: readonly unknown[];
  profiles: readonly unknown[];
  rewards: readonly unknown[];
  launches: readonly unknown[];
}>;

function routeCollection(
  routes: readonly ReconcilerRouteDto[],
  routeKey: ReconcilerRouteDto["routeKey"],
  collectionKey: string,
): readonly unknown[] {
  const route = routes.find((candidate) => candidate.routeKey === routeKey);
  if (!route) return [];
  return (route.dto as Record<string, readonly unknown[]>)[collectionKey] ?? [];
}

function routeParts(routes: readonly ReconcilerRouteDto[]): RouteParts {
  return {
    tokens: routeCollection(routes, "explore-list", "tokens"),
    charts: routeCollection(routes, "explore-chart", "charts"),
    profiles: routeCollection(routes, "creator-profile", "profiles"),
    rewards: routeCollection(routes, "classic-v3-profile", "rewards"),
    launches: routeCollection(routes, "launch-lookup", "launches"),
  };
}

describe("SQL and live route corpus contract", () => {
  const database = new PGlite();

  beforeAll(async () => {
    await database.exec(`
      create role programmable_migrator nologin;
      create role programmable_reconciler nologin;
      create role programmable_projector nologin;
      create role programmable_api_reader nologin;
      create role programmable_profile_binder nologin;
      create role programmable_profile_recovery nologin;
      create role programmable_profile_writer nologin;
      create role programmable_maintenance nologin;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema programmable_private authorization programmable_migrator;
    `);
    await database.exec(await readFile(resolve(
      "supabase/migrations/20260731225000_reconciler_route_corpus.sql",
    ), "utf8"));
  }, 30_000);

  afterAll(async () => database.close());

  async function sqlRoutes(
    parts: RouteParts,
  ): Promise<readonly ReconcilerRouteDto[]> {
    const result = await database.query<{
      route_key: ReconcilerRouteDto["routeKey"];
      compared_count: string | number;
      dto: ReconcilerRouteDto["dto"];
    }>(`
      select route_key, compared_count, dto
      from programmable_private.assemble_reconciler_routes_v1(
        $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb
      )
    `, [
      JSON.stringify(parts.tokens),
      JSON.stringify(parts.charts),
      JSON.stringify(parts.profiles),
      JSON.stringify(parts.rewards),
      JSON.stringify(parts.launches),
    ]);
    return result.rows.map((row) => ({
      routeKey: row.route_key,
      comparedCount: Number(row.compared_count),
      dto: row.dto,
    }));
  }

  async function expectCanonicalParity(
    liveRoutes: readonly ReconcilerRouteDto[],
    parts: RouteParts = routeParts(liveRoutes),
  ): Promise<void> {
    const indexedRoutes = await sqlRoutes(parts);

    expect(indexedRoutes.map((route) =>
      canonicalizeFingerprintJson(route)
    )).toEqual(liveRoutes.map((route) =>
      canonicalizeFingerprintJson(route)
    ));
  }

  it("produces byte-identical Classic V3 DTOs for every route", async () => {
    await expectCanonicalParity(
      classicV3ReconcilerRouteFixture(),
      CLASSIC_V3_RECONCILER_ROUTE_FIXTURE_PARTS,
    );
  });

  it("builds the SQL Classic V3 reward with the exact runtime field contract", async () => {
    const expected = CLASSIC_V3_RECONCILER_ROUTE_FIXTURE_PARTS.rewards[0] as
      Record<string, unknown>;
    const allocations = (expected.allocations as Array<Record<string, unknown>>)
      .map((allocation) => ({
        ...allocation,
        claimableWei: "legacy-field-must-not-escape",
        claimedWei: "legacy-field-must-not-escape",
      }));
    const result = await database.query<{ reward: Record<string, unknown> }>(`
      select programmable_private.build_classic_v3_reconciler_reward_v1(
        pg_catalog.decode($1::text, 'hex'),
        pg_catalog.decode($2::text, 'hex'),
        pg_catalog.decode($3::text, 'hex'),
        $4::text,
        $5::text,
        pg_catalog.decode($6::text, 'hex'),
        $7::integer,
        $8::integer,
        $9::integer,
        pg_catalog.decode($10::text, 'hex'),
        pg_catalog.decode($11::text, 'hex'),
        $12::bigint,
        $13::numeric,
        $14::numeric,
        $15::numeric,
        $16::jsonb,
        $17::jsonb,
        $18::jsonb
      ) as reward
    `, [
      String(expected.vaultAddress).slice(2),
      String(expected.poolId).slice(2),
      String(expected.tokenAddress).slice(2),
      expected.tokenName,
      expected.tokenSymbol,
      String(expected.launchTransactionHash).slice(2),
      expected.buySwapFeeBps,
      expected.sellSwapFeeBps,
      expected.launcherFeeBps,
      String(expected.configurationHash).slice(2),
      String(expected.activeConfigurationHash).slice(2),
      expected.configurationEpoch,
      expected.totalCreatorFeesReceivedWei,
      expected.totalCreatorFeesClaimedWei,
      expected.pendingCreatorFeesWei,
      JSON.stringify(allocations),
      JSON.stringify(expected.entitlements),
      JSON.stringify(expected.events),
    ]);
    const reward = result.rows[0]!.reward;

    expect(Object.keys(reward).sort()).toEqual(
      [...CLASSIC_V3_RECONCILER_REWARD_FIELDS].sort(),
    );
    expect(Object.keys(
      (reward.allocations as Array<Record<string, unknown>>)[0]!,
    ).sort()).toEqual(
      [...CLASSIC_V3_RECONCILER_REWARD_ALLOCATION_FIELDS].sort(),
    );
    expect(Object.keys(
      (reward.entitlements as Array<Record<string, unknown>>)[0]!,
    ).sort()).toEqual(
      [...CLASSIC_V3_RECONCILER_REWARD_ENTITLEMENT_FIELDS].sort(),
    );
    expect(canonicalizeFingerprintJson(reward as never)).toEqual(
      canonicalizeFingerprintJson(expected as never),
    );

    const parts: ClassicV3ReconcilerRouteParts = {
      ...CLASSIC_V3_RECONCILER_ROUTE_FIXTURE_PARTS,
      rewards: [reward as never],
    };
    await expectCanonicalParity(classicV3ReconcilerRouteFixture(), parts);
  });

  it.each([
    { releaseVersion: "classic-v2", modelId: "classic" },
    { releaseVersion: "stock-paired-v1", modelId: "stock-paired" },
    { releaseVersion: "stock-paired-v2", modelId: "stock-paired" },
    { releaseVersion: "stock-paired-v3", modelId: "stock-paired" },
  ] as const)(
    "produces byte-identical $releaseVersion DTOs for every applicable route",
    async ({ releaseVersion, modelId }) => {
      const source = CLASSIC_V3_RECONCILER_ROUTE_FIXTURE_PARTS;
      const token = structuredClone(source.tokens[0]!) as Record<string, unknown>;
      const chart = structuredClone(source.charts[0]!) as Record<string, unknown>;
      token.releaseVersion = releaseVersion;
      token.modelId = modelId;
      chart.releaseVersion = releaseVersion;
      chart.modelId = modelId;
      if (releaseVersion === "classic-v2") {
        token.rewardVaultAddress = null;
      } else {
        const quoteAsset = `0x${"ab".repeat(20)}`;
        token.quoteAssetAddress = quoteAsset;
        chart.quoteAssetAddress = quoteAsset;
        (chart.volume as Record<string, unknown>).quoteAssetAddress = quoteAsset;
      }
      const liveRoutes = assembleReconcilerRoutesFromContributions([{
        tokens: [token] as never,
        charts: [chart] as never,
      }]);

      await expectCanonicalParity(liveRoutes);
    },
  );
});
