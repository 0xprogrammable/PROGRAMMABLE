import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const BRIDGE_ROUTE_PATHS = [
  "app/api/custom-launch/v2/launch-grants/[oldGrantId]/reissue/route.ts",
  "app/api/custom-launch/v2/launch-preparations/[executionReservationId]/report/route.ts",
  "app/api/custom-launch/v2/launch-sessions/[sessionId]/authorization/route.ts",
  "app/api/custom-launch/v2/launch-sessions/[sessionId]/execution-preparation/route.ts",
  "app/api/custom-launch/v2/launch-sessions/challenges/[challengeId]/preparation/route.ts",
  "app/api/custom-launch/v2/launch-sessions/challenges/[challengeId]/wallet-authentication/route.ts",
  "app/api/custom-launch/v2/launch-sessions/challenges/route.ts",
  "app/api/custom-launch/v3/applications/[applicationHandle]/launch-authority-refresh/route.ts",
  "app/api/custom-launch/v3/applications/[applicationHandle]/launch-descriptor/route.ts",
  "app/api/custom-launch/v3/applications/[applicationHandle]/launch-eligibility/route.ts",
  "app/api/custom-launch/v3/applications/[applicationHandle]/launch-execution-status/route.ts",
  "app/api/custom-launch/v3/applications/[applicationHandle]/launch-presentation/route.ts",
  "app/api/custom-launch/v3/applications/[applicationHandle]/route.ts",
  "app/api/custom-launch/v3/applications/route.ts",
] as const;

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function numericConstant(contents: string, name: string): number {
  const match = new RegExp(`const ${name} = ([0-9_]+);`, "u").exec(contents);
  if (match?.[1] === undefined) throw new Error(`${name} is not a literal timeout`);
  return Number(match[1].replaceAll("_", ""));
}

describe("Custom launch proxy route runtime budget", () => {
  it("keeps every bridge route above readiness plus upstream timeout budgets", async () => {
    const [readinessSource, bridgeSource, ...routes] = await Promise.all([
      source("lib/server/custom-launch/deployment-readiness.ts"),
      source("lib/server/custom-launch/launch-bridge-v2.ts"),
      ...BRIDGE_ROUTE_PATHS.map(source),
    ]);
    const requiredMilliseconds = numericConstant(
      readinessSource,
      "SERVICE_TIMEOUT_MS",
    ) + numericConstant(bridgeSource, "UPSTREAM_TIMEOUT_MS");

    expect(requiredMilliseconds).toBe(17_000);
    expect(routes).toHaveLength(BRIDGE_ROUTE_PATHS.length);
    for (const [index, route] of routes.entries()) {
      expect(route, BRIDGE_ROUTE_PATHS[index]).toContain(
        "handleProductionCustomLaunchBridgeV2",
      );
      const duration = /export const maxDuration = ([0-9]+);/u.exec(route)?.[1];
      expect(duration, BRIDGE_ROUTE_PATHS[index]).toBeDefined();
      expect(Number(duration) * 1_000, BRIDGE_ROUTE_PATHS[index]).toBeGreaterThan(
        requiredMilliseconds,
      );
    }
  });
});
