#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as classicV4ReleaseModule from "../../lib/classic-v4-release.ts";
import * as classicV4PublicReleaseModule from "../../lib/classic-v4-public-release.ts";
import {
  CLASSIC_V4_ACTIVATION_TARGET_PATHS,
  orderClassicV4ActivationChanges,
  recoverClassicV4Activation,
  renderClassicV4PublicReleaseBindingSource,
  writeClassicV4ActivationAtomically,
} from "./activate-classic-v4.mjs";

const {
  classicV4IndexerBindingDigest,
  promoteClassicV4ReleaseToPublicAvailability,
} = classicV4ReleaseModule.default ?? classicV4ReleaseModule;
const { CLASSIC_V4_PUBLIC_RELEASE_BINDING } =
  classicV4PublicReleaseModule.default ?? classicV4PublicReleaseModule;

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const canonicalManifestPath = path.join(
  repositoryRoot,
  "contracts/deployments/mainnet-classic-v4.json",
);
const publicReleaseBindingPath = path.join(
  repositoryRoot,
  "lib/classic-v4-public-release.ts",
);
const catalogReleasePath = path.join(
  repositoryRoot,
  "config/envio-classic-v4-catalog-release.v1.json",
);

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameHex(left, right) {
  return typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase();
}

function exactDigest(value, label) {
  if (
    typeof value !== "string" ||
    !/^0x(?!0{64}$)[0-9a-fA-F]{64}$/u.test(value)
  ) {
    fail(`${label} is invalid`);
  }
  return value.toLowerCase();
}

function parseArguments(argv) {
  const options = { write: false, acknowledgement: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--write") {
      options.write = true;
      continue;
    }
    const [key, inlineValue] = argument.split("=", 2);
    if (key !== "--acknowledge-manifest-digest") {
      fail(`Unknown argument: ${argument}`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    options.acknowledgement = value.toLowerCase();
  }
  return options;
}

async function readJson(filename, label) {
  let source;
  try {
    source = await readFile(filename, "utf8");
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  try {
    return { source, value: JSON.parse(source) };
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

export function promoteClassicV4CatalogReleaseArtifact(input) {
  const catalog = input.catalogRelease;
  if (
    !isRecord(catalog) ||
    Object.keys(catalog).sort().join(":") !==
      [
        "chainId",
        "launcher",
        "manifestDigest",
        "releaseBinding",
        "schemaVersion",
        "status",
      ].sort().join(":") ||
    catalog.schemaVersion !== 1 ||
    catalog.status !== "indexer-activated" ||
    catalog.chainId !== 1 ||
    !sameHex(catalog.manifestDigest, input.sourceManifestDigest) ||
    !sameHex(catalog.launcher, input.launcher) ||
    !isRecord(catalog.releaseBinding) ||
    !sameHex(
      classicV4IndexerBindingDigest(catalog.releaseBinding),
      input.indexerBindingDigest,
    )
  ) {
    fail("Classic V4 catalog release is not bound to the indexed manifest");
  }
  return Object.freeze({
    ...catalog,
    manifestDigest: exactDigest(
      input.promotedManifestDigest,
      "public Classic V4 manifest digest",
    ),
  });
}

export function buildClassicV4PublicAvailabilityPlan(
  indexedManifest,
  trustedIndexerBinding,
  catalogRelease,
) {
  const promotion = promoteClassicV4ReleaseToPublicAvailability(
    indexedManifest,
    trustedIndexerBinding,
  );
  if (!promotion) {
    fail(
      "Classic V4 public availability requires the exact indexer-activated manifest and browser binding",
    );
  }
  const sourceManifestDigest = exactDigest(
    indexedManifest.manifestDigest,
    "indexer-activated Classic V4 manifest digest",
  );
  const manifestDigest = exactDigest(
    promotion.release.manifestDigest,
    "public Classic V4 manifest digest",
  );
  const indexerBindingDigest = exactDigest(
    promotion.release.indexerHandoff.indexerBindingDigest,
    "Classic V4 indexer binding digest",
  );
  const promotedCatalogRelease = promoteClassicV4CatalogReleaseArtifact({
    catalogRelease,
    sourceManifestDigest,
    promotedManifestDigest: manifestDigest,
    launcher: promotion.release.addresses.launcher,
    indexerBindingDigest,
  });
  return Object.freeze({
    schemaVersion: 1,
    chainId: 1,
    sourceManifestDigest,
    manifestDigest,
    indexerBindingDigest,
    release: promotion.release,
    browserBinding: promotion.browserBinding,
    catalogRelease: promotedCatalogRelease,
  });
}

export function renderClassicV4PublicAvailability(plan, current) {
  if (
    !isRecord(plan) ||
    plan.schemaVersion !== 1 ||
    plan.chainId !== 1 ||
    !sameHex(plan.release?.manifestDigest, plan.manifestDigest) ||
    !sameHex(plan.browserBinding?.manifestDigest, plan.manifestDigest) ||
    !sameHex(plan.catalogRelease?.manifestDigest, plan.manifestDigest) ||
    plan.release?.releaseStatus !== "publicly-available" ||
    plan.release?.verification?.publicAvailable !== true ||
    plan.browserBinding?.releaseStatus !== "publicly-available" ||
    plan.browserBinding?.publicAvailable !== true
  ) {
    fail("Classic V4 public availability write plan is invalid");
  }
  return Object.freeze({
    manifest: `${JSON.stringify(plan.release, null, 2)}\n`,
    publicReleaseBinding: renderClassicV4PublicReleaseBindingSource(
      plan.browserBinding,
      current.publicReleaseBinding,
    ),
    catalogRelease: `${JSON.stringify(plan.catalogRelease, null, 2)}\n`,
  });
}

export async function writeClassicV4PublicAvailabilityAtomically(input) {
  if (
    input.acknowledgement?.toLowerCase() !==
      input.plan.manifestDigest.toLowerCase()
  ) {
    fail(
      "--write requires --acknowledge-manifest-digest for this exact public manifest",
    );
  }
  const rendered = renderClassicV4PublicAvailability(
    input.plan,
    input.current,
  );
  await writeClassicV4ActivationAtomically(
    orderClassicV4ActivationChanges([
      {
        filename: input.paths.publicReleaseBinding,
        before: input.current.publicReleaseBinding,
        after: rendered.publicReleaseBinding,
      },
      {
        filename: input.paths.catalogRelease,
        before: input.current.catalogRelease,
        after: rendered.catalogRelease,
      },
      {
        filename: input.paths.manifest,
        before: input.current.manifest,
        after: rendered.manifest,
        commitPoint: true,
      },
    ]),
    {
      lockDirectory: input.lockDirectory,
      onStep: input.onStep,
    },
  );
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.write) {
    await recoverClassicV4Activation({
      expectedTargets: CLASSIC_V4_ACTIVATION_TARGET_PATHS,
    });
  }
  const [manifestInput, publicReleaseBindingSource, catalogInput] =
    await Promise.all([
      readJson(canonicalManifestPath, "Classic V4 release manifest"),
      readFile(publicReleaseBindingPath, "utf8"),
      readJson(catalogReleasePath, "Classic V4 catalog release"),
    ]);
  const plan = buildClassicV4PublicAvailabilityPlan(
    manifestInput.value,
    CLASSIC_V4_PUBLIC_RELEASE_BINDING,
    catalogInput.value,
  );
  const current = Object.freeze({
    manifest: manifestInput.source,
    publicReleaseBinding: publicReleaseBindingSource,
    catalogRelease: catalogInput.source,
  });
  const rendered = renderClassicV4PublicAvailability(plan, current);
  const changed =
    rendered.manifest !== current.manifest ||
    rendered.publicReleaseBinding !== current.publicReleaseBinding ||
    rendered.catalogRelease !== current.catalogRelease;

  if (options.write) {
    await writeClassicV4PublicAvailabilityAtomically({
      plan,
      current,
      acknowledgement: options.acknowledgement,
      paths: {
        manifest: canonicalManifestPath,
        publicReleaseBinding: publicReleaseBindingPath,
        catalogRelease: catalogReleasePath,
      },
    });
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: options.write ? "write" : "check",
        changed,
        plan: {
          schemaVersion: plan.schemaVersion,
          chainId: plan.chainId,
          sourceManifestDigest: plan.sourceManifestDigest,
          manifestDigest: plan.manifestDigest,
          indexerBindingDigest: plan.indexerBindingDigest,
          browserBinding: plan.browserBinding,
        },
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `Classic V4 public availability failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
