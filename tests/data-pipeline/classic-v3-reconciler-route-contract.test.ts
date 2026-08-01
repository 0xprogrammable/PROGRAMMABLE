import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertClassicV3ReconcilerRouteSet,
  CLASSIC_V3_RECONCILER_ROUTE_CONTRACT,
} from "../../lib/data-pipeline/classic-v3-reconciler-route-contract";
import { RECONCILER_ROUTE_KEYS } from "../../lib/data-pipeline/reconciler-preparity";
import {
  classicV3ReconcilerRouteFixture,
  ROUTE_FIXTURE_ADDRESS,
} from "./classic-v3-reconciler-route-fixture";

describe("Classic V3 reconciler route contract", () => {
  it("assembles and validates the exact six-route DTO set", () => {
    const routes = classicV3ReconcilerRouteFixture();

    expect(routes.map(({ routeKey }) => routeKey)).toEqual(
      RECONCILER_ROUTE_KEYS,
    );
    expect(routes.every(({ comparedCount }) => comparedCount === 1)).toBe(true);
    expect(routes.every(({ dto }) =>
      (dto as { contractVersion: string }).contractVersion ===
        CLASSIC_V3_RECONCILER_ROUTE_CONTRACT
    )).toBe(true);
    expect(JSON.stringify(routes[0]!.dto)).toBe(JSON.stringify(routes[1]!.dto));
    expect(assertClassicV3ReconcilerRouteSet(routes)).toBe(routes);
  });

  it.each([
    {
      label: "extra token fields",
      routeIndex: 0,
      mutate: (dto: Record<string, unknown>) => ({
        ...dto,
        tokens: [{
          ...((dto.tokens as readonly Record<string, unknown>[])[0]!),
          unreviewedMetadata: true,
        }],
      }),
    },
    {
      label: "incomplete chart state",
      routeIndex: 2,
      mutate: (dto: Record<string, unknown>) => ({
        ...dto,
        charts: [{ tokenAddress: ROUTE_FIXTURE_ADDRESS }],
      }),
    },
    {
      label: "mutable reward beneficiary field",
      routeIndex: 4,
      mutate: (dto: Record<string, unknown>) => {
        const reward = (dto.rewards as readonly Record<string, unknown>[])[0]!;
        const allocation = (
          reward.allocations as readonly Record<string, unknown>[]
        )[0]!;
        return {
          ...dto,
          rewards: [{
            ...reward,
            allocations: [{ ...allocation, beneficiary: ROUTE_FIXTURE_ADDRESS }],
          }],
        };
      },
    },
    {
      label: "incorrect contract version",
      routeIndex: 5,
      mutate: (dto: Record<string, unknown>) => ({
        ...dto,
        contractVersion: "unreviewed",
      }),
    },
  ])("fails closed on $label", ({ routeIndex, mutate }) => {
    const routes = classicV3ReconcilerRouteFixture().map((route) => ({
      ...route,
      dto: structuredClone(route.dto),
    }));
    routes[routeIndex] = {
      ...routes[routeIndex]!,
      dto: mutate(routes[routeIndex]!.dto as Record<string, unknown>),
    };

    expect(() => assertClassicV3ReconcilerRouteSet(routes)).toThrow();
  });

  it("rejects divergence between list and token detail bytes", () => {
    const routes = classicV3ReconcilerRouteFixture().map((route) => ({
      ...route,
      dto: structuredClone(route.dto),
    }));
    const detail = routes[1]!.dto as {
      contractVersion: string;
      tokens: Array<Record<string, unknown>>;
    };
    detail.tokens[0]!.name = "Different";

    expect(() => assertClassicV3ReconcilerRouteSet(routes)).toThrow();
  });
});
