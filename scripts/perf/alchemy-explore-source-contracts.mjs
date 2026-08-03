#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTES = Object.freeze([
  Object.freeze({
    id: "explore",
    path: "app/api/explore/route.ts",
    readyCache:
      "public, max-age=0, s-maxage=5, stale-while-revalidate=15",
  }),
  Object.freeze({
    id: "token-detail",
    path: "app/api/explore/token/route.ts",
    readyCache:
      "public, max-age=0, s-maxage=5, stale-while-revalidate=15",
  }),
  Object.freeze({
    id: "token-list",
    path: "app/api/indexers/v1/token-list/route.ts",
    readyCache:
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  }),
]);

const FORBIDDEN_ROUTE_BINDINGS = Object.freeze([
  "lib/data-pipeline",
  "readIndexedFeedSnapshot",
  "coordinatePublicRouteRead",
  "PROGRAMMABLE_PROJECTOR",
  "PROGRAMMABLE_QUICKNODE",
  "PROGRAMMABLE_ENVIO",
]);

function readSource(rootDirectory, path, sourceOverrides) {
  if (Object.hasOwn(sourceOverrides, path)) return sourceOverrides[path];
  return readFileSync(resolve(rootDirectory, path), "utf8");
}

export function evaluateAlchemyExploreSourceContracts(
  rootDirectory = process.cwd(),
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

  const routeSources = ROUTES.map((route) => ({
    ...route,
    source: readSource(rootDirectory, route.path, sourceOverrides),
  }));
  const responsePath = "app/api/indexers/v1/response.ts";
  const responseSource = readSource(
    rootDirectory,
    responsePath,
    sourceOverrides,
  );

  for (const route of routeSources) {
    check(
      `alchemy-${route.id}-runtime`,
      route.source.includes("readAlchemyExploreModel") &&
        FORBIDDEN_ROUTE_BINDINGS.every(
          (binding) => !route.source.includes(binding),
        ),
      `${route.id} reads directly through the Alchemy runtime without indexed infrastructure`,
    );
    check(
      `alchemy-${route.id}-cache`,
      route.source.includes(route.readyCache),
      `${route.id} retains its reviewed ready cache policy`,
    );
  }

  check(
    "alchemy-explore-provenance",
    routeSources
      .filter(({ id }) => id !== "token-list")
      .every(
        ({ source }) =>
          source.includes('"X-Programmable-Read-Source": "rpc"') &&
          source.includes('"X-Programmable-Rpc-Provider": "alchemy"'),
      ) &&
      responseSource.includes('"X-Programmable-Read-Source": "rpc"') &&
      responseSource.includes('"X-Programmable-Rpc-Provider": "alchemy"') &&
      responseSource.includes(
        '"X-Programmable-Read-Source, X-Programmable-Rpc-Provider"',
      ),
    "Alchemy public responses expose RPC source and provider provenance",
  );

  return Object.freeze({
    ok: failures.length === 0,
    checks: Object.freeze(checks),
    failures: Object.freeze(failures),
  });
}

function main() {
  const result = evaluateAlchemyExploreSourceContracts(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
