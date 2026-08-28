import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import baseReleaseBinding from "../../config/data-pipeline-release.v1.json";
// @ts-expect-error The frozen operational .mjs intentionally has no TS declaration surface.
import * as publicAvailabilityWriter from "../scripts/promote-classic-v4-public-availability.mjs";

const {
  classicV4IndexerBindingDigestForPublicAvailability,
  promoteClassicV4CatalogReleaseArtifact,
  renderClassicV4PublicAvailability,
  writeClassicV4PublicAvailabilityAtomically,
} = publicAvailabilityWriter;

const temporaryDirectories: string[] = [];
const SOURCE_MANIFEST_DIGEST = `0x${"11".repeat(32)}`;
const PUBLIC_MANIFEST_DIGEST = `0x${"22".repeat(32)}`;
const LAUNCHER = `0x${"33".repeat(20)}`;
const INDEXER_BINDING_DIGEST =
  classicV4IndexerBindingDigestForPublicAvailability(baseReleaseBinding);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function hash(byte: string) {
  return `0x${byte.repeat(64)}`;
}

function browserBinding() {
  return {
    chainId: 1,
    launcher: LAUNCHER,
    manifestDigest: PUBLIC_MANIFEST_DIGEST,
    releaseStatus: "publicly-available",
    publicAvailable: true,
    transactionHash: hash("4"),
    blockHash: hash("5"),
    blockNumber: 25_800_123,
    inputHash: hash("6"),
    launchId: hash("7"),
    stampHash: hash("8"),
    permitDigest: hash("9"),
  } as const;
}

function catalogRelease(manifestDigest = SOURCE_MANIFEST_DIGEST) {
  return {
    schemaVersion: 1,
    status: "indexer-activated",
    chainId: 1,
    manifestDigest,
    launcher: LAUNCHER,
    releaseBinding: structuredClone(baseReleaseBinding),
  } as const;
}

function plan() {
  return {
    schemaVersion: 1,
    chainId: 1,
    sourceManifestDigest: SOURCE_MANIFEST_DIGEST,
    manifestDigest: PUBLIC_MANIFEST_DIGEST,
    indexerBindingDigest: INDEXER_BINDING_DIGEST,
    release: {
      releaseStatus: "publicly-available",
      manifestDigest: PUBLIC_MANIFEST_DIGEST,
      verification: { publicAvailable: true },
    },
    browserBinding: browserBinding(),
    catalogRelease: catalogRelease(PUBLIC_MANIFEST_DIGEST),
  } as const;
}

function currentSources() {
  return {
    manifest: `${JSON.stringify(
      {
        releaseStatus: "indexer-activated",
        manifestDigest: SOURCE_MANIFEST_DIGEST,
      },
      null,
      2,
    )}\n`,
    publicReleaseBinding:
      "before\n// CLASSIC_V4_PUBLIC_RELEASE_BINDING_START\nold\n// CLASSIC_V4_PUBLIC_RELEASE_BINDING_END\nafter\n",
    catalogRelease: `${JSON.stringify(catalogRelease(), null, 2)}\n`,
  };
}

describe("Classic V4 public availability writer", () => {
  it("advances only the catalog manifest digest bound to the exact indexer release", () => {
    const promoted = promoteClassicV4CatalogReleaseArtifact({
      catalogRelease: catalogRelease(),
      sourceManifestDigest: SOURCE_MANIFEST_DIGEST,
      promotedManifestDigest: PUBLIC_MANIFEST_DIGEST,
      launcher: LAUNCHER,
      indexerBindingDigest: INDEXER_BINDING_DIGEST,
    });

    expect(promoted).toEqual(catalogRelease(PUBLIC_MANIFEST_DIGEST));
    expect(() =>
      promoteClassicV4CatalogReleaseArtifact({
        catalogRelease: catalogRelease(hash("a")),
        sourceManifestDigest: SOURCE_MANIFEST_DIGEST,
        promotedManifestDigest: PUBLIC_MANIFEST_DIGEST,
        launcher: LAUNCHER,
        indexerBindingDigest: INDEXER_BINDING_DIGEST,
      }),
    ).toThrow("indexed manifest");
    expect(() =>
      promoteClassicV4CatalogReleaseArtifact({
        catalogRelease: catalogRelease(),
        sourceManifestDigest: SOURCE_MANIFEST_DIGEST,
        promotedManifestDigest: PUBLIC_MANIFEST_DIGEST,
        launcher: LAUNCHER,
        indexerBindingDigest: hash("b"),
      }),
    ).toThrow("indexed manifest");
  });

  it("renders one public digest across the manifest, browser and catalog", () => {
    const rendered = renderClassicV4PublicAvailability(
      plan(),
      currentSources(),
    );

    expect(JSON.parse(rendered.manifest)).toEqual(plan().release);
    expect(JSON.parse(rendered.catalogRelease)).toEqual(plan().catalogRelease);
    expect(rendered.publicReleaseBinding).toContain(PUBLIC_MANIFEST_DIGEST);
    expect(rendered.publicReleaseBinding).toContain(
      'releaseStatus: "publicly-available"',
    );
    expect(rendered.publicReleaseBinding).toContain("publicAvailable: true");
    expect(rendered.publicReleaseBinding).not.toContain(
      SOURCE_MANIFEST_DIGEST,
    );
    expect(() =>
      renderClassicV4PublicAvailability(
        {
          ...plan(),
          browserBinding: {
            ...browserBinding(),
            publicAvailable: false,
          },
        },
        currentSources(),
      ),
    ).toThrow("write plan is invalid");
  });

  it("requires the exact digest acknowledgement and commits the manifest last", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "classic-v4-public-writer-test-"),
    );
    temporaryDirectories.push(directory);
    const paths = {
      manifest: path.join(directory, "manifest.json"),
      publicReleaseBinding: path.join(directory, "public-release.ts"),
      catalogRelease: path.join(directory, "catalog.json"),
    };
    const current = currentSources();
    await Promise.all([
      writeFile(paths.manifest, current.manifest, "utf8"),
      writeFile(
        paths.publicReleaseBinding,
        current.publicReleaseBinding,
        "utf8",
      ),
      writeFile(paths.catalogRelease, current.catalogRelease, "utf8"),
    ]);

    await expect(
      writeClassicV4PublicAvailabilityAtomically({
        plan: plan(),
        current,
        acknowledgement: SOURCE_MANIFEST_DIGEST,
        paths,
        lockDirectory: path.join(directory, "activation.lock"),
      }),
    ).rejects.toThrow("acknowledge-manifest-digest");
    expect(await readFile(paths.manifest, "utf8")).toBe(current.manifest);

    const steps: Array<[string, string | null]> = [];
    await writeClassicV4PublicAvailabilityAtomically({
      plan: plan(),
      current,
      acknowledgement: PUBLIC_MANIFEST_DIGEST,
      paths,
      lockDirectory: path.join(directory, "activation.lock"),
      onStep: (step: string, filename: string | null) => {
        steps.push([step, filename]);
      },
    });

    expect(steps.at(-1)).toEqual(["manifest-committed", paths.manifest]);
    expect(JSON.parse(await readFile(paths.manifest, "utf8"))).toEqual(
      plan().release,
    );
    expect(JSON.parse(await readFile(paths.catalogRelease, "utf8"))).toEqual(
      plan().catalogRelease,
    );
    expect(await readFile(paths.publicReleaseBinding, "utf8")).toContain(
      "publicAvailable: true",
    );
  });
});
