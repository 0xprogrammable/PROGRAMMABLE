import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import baseReleaseBinding from "../../config/data-pipeline-release.v1.json";
import {
  CLASSIC_V4_DIGEST_DOMAINS,
  digestJson,
} from "../../scripts/classic-v4-digest.mjs";

import {
  buildClassicV4CatalogReleaseArtifact,
  createClassicV4IndexerActivatedManifest,
  main,
  orderClassicV4ActivationChanges,
  recoverClassicV4Activation,
  renderClassicV4Activation,
  writeClassicV4ActivationAtomically,
} from "../scripts/activate-classic-v4.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Classic V4 browser release activation", () => {
  it("keeps the base browser trust root disabled", async () => {
    const source = await readFile(
      new URL("../../lib/classic-v4-public-release.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("// CLASSIC_V4_PUBLIC_RELEASE_BINDING_START");
    const end = source.indexOf("// CLASSIC_V4_PUBLIC_RELEASE_BINDING_END");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const bindingBlock = source.slice(start, end);
    expect(bindingBlock).toMatch(/\|\s*null\s*=\s*null;/u);
    expect(bindingBlock).not.toContain("launcher:");
  });

  it("refuses activation without an immutable Envio release audit", async () => {
    await expect(main(["--write"])).rejects.toThrow("--release-audit");
    await expect(
      main(["--catalog-release-binding", "/tmp/hand-authored-binding.json"]),
    ).rejects.toThrow("Unknown argument");
  });

  it("binds the browser only to the resulting indexer-activated digest", () => {
    const baseManifest = {
      schemaVersion: 1,
      releaseStatus: "deployment-source-and-lifecycle-verified",
      verification: {
        indexerActivated: false,
        publicAvailable: false,
      },
      indexerHandoff: {
        indexerBindingDigest: null,
        activated: false,
      },
      manifestDigest: `0x${"11".repeat(32)}`,
    };
    const launcher = `0x${"44".repeat(20)}`;
    const hook = `0x${"83".repeat(19)}cc`;
    const launchAnchor = {
      transactionHash: `0x${"71".repeat(32)}`,
      blockHash: `0x${"72".repeat(32)}`,
      blockNumber: 25_700_200,
      inputHash: `0x${"73".repeat(32)}`,
      launchId: `0x${"74".repeat(32)}`,
      stampHash: `0x${"75".repeat(32)}`,
      permitDigest: `0x${"76".repeat(32)}`,
    };
    const sources = [
      {
        contractName: "ClassicV4Hook",
        address: hook,
        startBlock: 25_700_101,
        runtimeCodeHash: `0x${"83".repeat(32)}`,
      },
      {
        contractName: "ClassicV4Launcher",
        address: launcher,
        startBlock: 25_700_103,
        runtimeCodeHash: `0x${"44".repeat(32)}`,
      },
    ];
    const dataPipelineReleaseFragment = {
      model: "classic",
      releaseVersion: "classic-v4",
      activationBlock: 25_700_103,
      sourceContracts: [
        "ClassicV3RewardVaultFactory",
        "ClassicV3VestingWalletFactory",
        "ClassicV4Hook",
        "ClassicV4Launcher",
      ],
      dynamicContracts: ["ClassicV3RewardVault"],
    };
    const reviewedReleaseBinding = {
      ...structuredClone(baseReleaseBinding),
      envio: {
        ...structuredClone(baseReleaseBinding.envio),
        deploymentLabel: "production-classic-v4-a1b2c3d",
        graphqlEndpoint: baseReleaseBinding.envio.graphqlEndpoint,
        sourceCommit: "b".repeat(40),
        configSha256: `0x${"b1".repeat(32)}`,
        sourceRegistrySha256: `0x${"b2".repeat(32)}`,
        eventSetSha256: `0x${"b3".repeat(32)}`,
        eventCount: baseReleaseBinding.envio.eventCount + 9,
      },
      sources: [...structuredClone(baseReleaseBinding.sources), ...sources],
      releases: [
        ...structuredClone(baseReleaseBinding.releases),
        dataPipelineReleaseFragment,
      ],
    };
    const indexerBindingDigest = digestJson(
      reviewedReleaseBinding,
      CLASSIC_V4_DIGEST_DOMAINS.releaseBinding,
    );
    const activatedManifest = createClassicV4IndexerActivatedManifest(
      baseManifest,
      indexerBindingDigest,
    );
    const { manifestDigest, ...activatedCore } = activatedManifest;

    expect(baseManifest.releaseStatus).toBe(
      "deployment-source-and-lifecycle-verified",
    );
    expect(activatedManifest).toMatchObject({
      releaseStatus: "indexer-activated",
      verification: { indexerActivated: true, publicAvailable: false },
      indexerHandoff: { indexerBindingDigest, activated: true },
    });
    expect(manifestDigest).toBe(
      digestJson(activatedCore, CLASSIC_V4_DIGEST_DOMAINS.releaseManifest),
    );
    expect(manifestDigest).not.toBe(baseManifest.manifestDigest);

    const planCore = {
      manifestDigest,
      indexerBindingDigest,
      sources,
      publicReleaseBinding: {
        chainId: 1,
        launcher,
        manifestDigest,
        releaseStatus: "indexer-activated",
        publicAvailable: false,
        ...launchAnchor,
      },
      activatedManifest,
      dataPipelineReleaseFragment,
    };
    const catalogReleaseArtifact = buildClassicV4CatalogReleaseArtifact(
      planCore,
      baseReleaseBinding,
      reviewedReleaseBinding,
    );
    const plan = { ...planCore, catalogReleaseArtifact };
    const current = {
      releaseMap:
        "before\n// CLASSIC_V4_ACTIVATION_START\nold\n// CLASSIC_V4_ACTIVATION_END\nafter\n",
      envioConfig:
        "before\n      # CLASSIC_V4_ACTIVATION_START\nold\n      # CLASSIC_V4_ACTIVATION_END\nafter\n",
      publicReleaseBinding:
        "before\n// CLASSIC_V4_PUBLIC_RELEASE_BINDING_START\nold\n// CLASSIC_V4_PUBLIC_RELEASE_BINDING_END\nafter\n",
      catalogRelease: `${JSON.stringify(
        {
          schemaVersion: 1,
          status: "inactive",
          chainId: 1,
          manifestDigest: null,
          launcher: null,
          releaseBinding: null,
        },
        null,
        2,
      )}\n`,
    };
    const rendered = renderClassicV4Activation(plan, current);

    expect(rendered.publicReleaseBinding).toContain(launcher);
    expect(rendered.publicReleaseBinding).toContain(manifestDigest);
    expect(rendered.publicReleaseBinding).toContain(
      'releaseStatus: "indexer-activated"',
    );
    expect(rendered.publicReleaseBinding).toContain("publicAvailable: false");
    for (const value of [
      launchAnchor.transactionHash,
      launchAnchor.blockHash,
      launchAnchor.inputHash,
      launchAnchor.launchId,
      launchAnchor.stampHash,
      launchAnchor.permitDigest,
    ]) {
      expect(rendered.publicReleaseBinding).toContain(value);
    }
    expect(rendered.publicReleaseBinding).toContain("blockNumber: 25_700_200");
    expect(rendered.publicReleaseBinding).not.toContain(
      baseManifest.manifestDigest,
    );
    expect(JSON.parse(rendered.manifest)).toEqual(activatedManifest);
    expect(JSON.parse(rendered.catalogRelease)).toEqual({
      schemaVersion: 1,
      status: "indexer-activated",
      chainId: 1,
      manifestDigest,
      launcher,
      releaseBinding: reviewedReleaseBinding,
    });
    expect(() =>
      buildClassicV4CatalogReleaseArtifact(planCore, baseReleaseBinding, {
        ...reviewedReleaseBinding,
        envio: {
          ...reviewedReleaseBinding.envio,
          eventSetSha256: baseReleaseBinding.envio.eventSetSha256,
        },
      }),
    ).toThrow("independently promoted");
    expect(() =>
      buildClassicV4CatalogReleaseArtifact(planCore, baseReleaseBinding, {
        ...reviewedReleaseBinding,
        envio: {
          ...reviewedReleaseBinding.envio,
          handlerSha256: `0x${"c4".repeat(32)}`,
        },
      }),
    ).toThrow("binding digest");
    expect(() =>
      renderClassicV4Activation(
        {
          ...plan,
          publicReleaseBinding: {
            chainId: 1,
            launcher,
            manifestDigest,
            releaseStatus: "indexer-activated",
            publicAvailable: false,
          },
        },
        current,
      ),
    ).toThrow("finalized launch anchor");
  });

  it("keeps the manifest as the single final activation commit point", () => {
    const ordered = orderClassicV4ActivationChanges([
      { filename: "manifest", commitPoint: true },
      { filename: "catalog" },
      { filename: "browser" },
    ]);
    expect(ordered.map(({ filename }) => filename)).toEqual([
      "catalog",
      "browser",
      "manifest",
    ]);
    expect(() =>
      orderClassicV4ActivationChanges([{ filename: "manifest" }]),
    ).toThrow("exactly one manifest commit point");
    expect(() =>
      orderClassicV4ActivationChanges([
        { filename: "first", commitPoint: true },
        { filename: "second", commitPoint: true },
      ]),
    ).toThrow("exactly one manifest commit point");
  });

  it("stages all files before changing any activation target", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "classic-v4-activation-test-"),
    );
    temporaryDirectories.push(directory);
    const first = path.join(directory, "first.txt");
    const second = path.join(directory, "second.txt");
    const lockDirectory = path.join(directory, "activation.lock");
    await Promise.all([
      writeFile(first, "first-before", "utf8"),
      writeFile(second, "second-before", "utf8"),
    ]);

    await expect(
      writeClassicV4ActivationAtomically(
        [
          { filename: first, before: "stale", after: "first-after" },
          {
            filename: second,
            before: "second-before",
            after: "second-after",
            commitPoint: true,
          },
        ],
        { lockDirectory },
      ),
    ).rejects.toThrow("inputs changed");
    await expect(readFile(first, "utf8")).resolves.toBe("first-before");
    await expect(readFile(second, "utf8")).resolves.toBe("second-before");

    await writeClassicV4ActivationAtomically(
      [
        { filename: first, before: "first-before", after: "first-after" },
        {
          filename: second,
          before: "second-before",
          after: "second-after",
          commitPoint: true,
        },
      ],
      { lockDirectory },
    );
    await expect(readFile(first, "utf8")).resolves.toBe("first-after");
    await expect(readFile(second, "utf8")).resolves.toBe("second-after");
  });

  it("holds an exclusive writer lock against concurrent activation", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "classic-v4-activation-lock-test-"),
    );
    temporaryDirectories.push(directory);
    const support = path.join(directory, "support.txt");
    const manifest = path.join(directory, "manifest.txt");
    const lockDirectory = path.join(directory, "activation.lock");
    await Promise.all([
      writeFile(support, "support-before", "utf8"),
      writeFile(manifest, "manifest-before", "utf8"),
    ]);
    let releasePrepared!: () => void;
    const prepared = new Promise<void>((resolve) => {
      releasePrepared = resolve;
    });
    let announcePrepared!: () => void;
    const announced = new Promise<void>((resolve) => {
      announcePrepared = resolve;
    });
    const changes = [
      { filename: support, before: "support-before", after: "support-after" },
      {
        filename: manifest,
        before: "manifest-before",
        after: "manifest-after",
        commitPoint: true,
      },
    ];
    const firstWriter = writeClassicV4ActivationAtomically(changes, {
      lockDirectory,
      onStep: async (step) => {
        if (step !== "prepared") return;
        announcePrepared();
        await prepared;
      },
    });
    await announced;
    await expect(
      writeClassicV4ActivationAtomically(changes, { lockDirectory }),
    ).rejects.toThrow(/locked by live process/u);
    releasePrepared();
    await firstWriter;
  });

  it("recovers a process crash before the manifest commit point by rolling back", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "classic-v4-activation-recovery-test-"),
    );
    temporaryDirectories.push(directory);
    const support = path.join(directory, "support.txt");
    const manifest = path.join(directory, "manifest.txt");
    const lockDirectory = path.join(directory, "activation.lock");
    await Promise.all([
      writeFile(support, "support-before", "utf8"),
      writeFile(manifest, "manifest-before", "utf8"),
    ]);
    const changes = [
      { filename: support, before: "support-before", after: "support-after" },
      {
        filename: manifest,
        before: "manifest-before",
        after: "manifest-after",
        commitPoint: true,
      },
    ];
    await expect(
      writeClassicV4ActivationAtomically(changes, {
        lockDirectory,
        onStep: (step) => {
          if (step === "support-applied") {
            throw Object.assign(new Error("simulated process crash"), {
              simulatesProcessCrash: true,
            });
          }
        },
      }),
    ).rejects.toThrow("simulated process crash");
    await expect(readFile(support, "utf8")).resolves.toBe("support-after");
    await expect(readFile(manifest, "utf8")).resolves.toBe("manifest-before");

    await expect(
      recoverClassicV4Activation({
        lockDirectory,
        expectedTargets: [support, manifest],
        isProcessAlive: () => false,
      }),
    ).resolves.toBe("rolled-back");
    await expect(readFile(support, "utf8")).resolves.toBe("support-before");
    await expect(readFile(manifest, "utf8")).resolves.toBe("manifest-before");
  });

  it("recognizes a durable manifest commit after a process crash", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "classic-v4-activation-commit-test-"),
    );
    temporaryDirectories.push(directory);
    const support = path.join(directory, "support.txt");
    const manifest = path.join(directory, "manifest.txt");
    const lockDirectory = path.join(directory, "activation.lock");
    await Promise.all([
      writeFile(support, "support-before", "utf8"),
      writeFile(manifest, "manifest-before", "utf8"),
    ]);
    const changes = [
      { filename: support, before: "support-before", after: "support-after" },
      {
        filename: manifest,
        before: "manifest-before",
        after: "manifest-after",
        commitPoint: true,
      },
    ];
    await expect(
      writeClassicV4ActivationAtomically(changes, {
        lockDirectory,
        onStep: (step) => {
          if (step === "manifest-committed") {
            throw Object.assign(new Error("simulated committed crash"), {
              simulatesProcessCrash: true,
            });
          }
        },
      }),
    ).rejects.toThrow("simulated committed crash");

    await expect(
      recoverClassicV4Activation({
        lockDirectory,
        expectedTargets: [support, manifest],
        isProcessAlive: () => false,
      }),
    ).resolves.toBe("cleaned-committed");
    await expect(readFile(support, "utf8")).resolves.toBe("support-after");
    await expect(readFile(manifest, "utf8")).resolves.toBe("manifest-after");
  });
});
