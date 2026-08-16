import { CliFailure, MAX_APPLICATION_BYTES, canonicalJson, createGhTransport, fs, path, prepareApplicationV3Revision, sha256Bytes, validatePublicPrApplicationV3 } from "./open-world-shared.mjs";

export function installOpenWorldPrepareRevisionCommand(runtime) {
  const assertSnapshotUnchanged = (...args) => runtime.assertSnapshotUnchanged(...args);
  const discoverApplicationV3PrepareRevision = (...args) => runtime.discoverApplicationV3PrepareRevision(...args);
  const dryRunMaterialization = (...args) => runtime.dryRunMaterialization(...args);
  const materializePackageAsync = (...args) => runtime.materializePackageAsync(...args);
  const pathsOverlap = (...args) => runtime.pathsOverlap(...args);
  const planNewExternalOutputDirectory = (...args) => runtime.planNewExternalOutputDirectory(...args);
  const prepareRevisionNetworkFailure = (...args) => runtime.prepareRevisionNetworkFailure(...args);
  const publicFileRecord = (...args) => runtime.publicFileRecord(...args);
  const readJsonValueSnapshot = (...args) => runtime.readJsonValueSnapshot(...args);
  const resolveOptionalSourceRootMappings = (...args) => runtime.resolveOptionalSourceRootMappings(...args);
  const resolveRegularFileAnywhere = (...args) => runtime.resolveRegularFileAnywhere(...args);
  const resolveRoot = (...args) => runtime.resolveRoot(...args);
  const resolveSourceRootMappings = (...args) => runtime.resolveSourceRootMappings(...args);
  const verifyApplicationV3LocalPrepareSources = (...args) => runtime.verifyApplicationV3LocalPrepareSources(...args);

  async function executePrepareRevision(options, positionals) {
    if (options.output === null) {
      throw new CliFailure("USAGE_ERROR", "prepare-revision requires --output <absolute-new-directory>");
    }
    if (!Array.isArray(options.sourceRoots) || options.sourceRoots.length === 0) {
      throw new CliFailure("USAGE_ERROR", "prepare-revision requires at least one --source-root <repository-ref=git-root>");
    }
    if (options.write && options.dryRun) {
      throw new CliFailure("USAGE_ERROR", "--write and --dry-run are mutually exclusive");
    }
    const repositoryRoot = resolveRoot(options.repositoryRoot);
    const draftPath = resolveRegularFileAnywhere(repositoryRoot, positionals[0], "Application V3 revision draft");
    const draftSnapshot = readJsonValueSnapshot(
      draftPath,
      "Application V3 revision draft",
      MAX_APPLICATION_BYTES,
      { requireObject: true }
    );
    if (draftSnapshot.text !== `${canonicalJson(draftSnapshot.document)}\n`) {
      throw new CliFailure("APPLICATION_V3_DRAFT_INVALID", "the revision draft must be canonical UTF-8 JSON with one final newline", { exitCode: 1 });
    }
    const applicationDraft = draftSnapshot.document;
    try {
      prepareApplicationV3Revision({ applicationDraft, predecessor: { kind: "none" } });
    } catch (error) {
      throw new CliFailure(
        typeof error?.code === "string" ? error.code : "APPLICATION_V3_DRAFT_INVALID",
        "the revision draft fails the complete local Application V3 preflight",
        { exitCode: 1 }
      );
    }
    const sourceRoots = resolveSourceRootMappings(options.sourceRoots, repositoryRoot, applicationDraft);
    const predecessorSourceRoots = resolveOptionalSourceRootMappings(
      options.predecessorSourceRoots ?? [],
      repositoryRoot,
      "--predecessor-source-root"
    );
    for (const { root } of [...sourceRoots.values(), ...predecessorSourceRoots.values()]) {
      if (pathsOverlap(root, draftPath)) {
        throw new CliFailure("APPLICATION_DERIVED_INPUT_PATH_INVALID", "the revision draft must stay outside every source repository", { exitCode: 1 });
      }
    }
    const draftRoot = fs.realpathSync(path.dirname(draftPath));
    const prepareSourceWorktrees = [
      repositoryRoot,
      ...[...sourceRoots.values(), ...predecessorSourceRoots.values()].map(({ root }) => root)
    ];
    const outputPlan = planNewExternalOutputDirectory(options.output, [
      repositoryRoot,
      draftRoot,
      ...[...sourceRoots.values(), ...predecessorSourceRoots.values()].map(({ root }) => root)
    ], prepareSourceWorktrees);
    const localReplay = await verifyApplicationV3LocalPrepareSources({
      application: applicationDraft,
      sourceRoots
    });
    assertSnapshotUnchanged(draftSnapshot, "Application V3 revision draft");
    let transport;
    let initial;
    try {
      transport = createGhTransport();
      initial = await discoverApplicationV3PrepareRevision({
        applicationDraft,
        transport,
        localReplay,
        currentSourceRoots: sourceRoots,
        predecessorSourceRoots
      });
    } catch (error) {
      throw prepareRevisionNetworkFailure(error);
    }
    const prepared = prepareApplicationV3Revision({
      applicationDraft,
      predecessor: initial.predecessor
    });
    if (validatePublicPrApplicationV3(prepared.application)?.valid !== true) {
      throw new CliFailure("PREPARE_REVISION_RESULT_INVALID", "the derived revision failed the complete Application V3 contract", { exitCode: 1 });
    }
    const applicationBytes = Buffer.from(`${canonicalJson(prepared.application)}\n`, "utf8");
    const records = [Object.freeze({
      path: "application.v3.json",
      bytes: applicationBytes,
      byteLength: applicationBytes.length,
      sha256: sha256Bytes(applicationBytes)
    })];
    const assertLocalSnapshot = async () => {
      assertSnapshotUnchanged(draftSnapshot, "Application V3 revision draft");
      const replay = await verifyApplicationV3LocalPrepareSources({ application: applicationDraft, sourceRoots });
      if (canonicalJson(replay) !== canonicalJson(localReplay)) {
        throw new CliFailure("APPLICATION_SOURCE_CHANGED", "the complete exact local source replay changed before materialization", { exitCode: 1 });
      }
      assertSnapshotUnchanged(draftSnapshot, "Application V3 revision draft");
    };
    await assertLocalSnapshot();
    const beforeCommit = async () => {
      await assertLocalSnapshot();
      let refreshed;
      try {
        refreshed = await discoverApplicationV3PrepareRevision({
          applicationDraft,
          transport,
          localReplay,
          currentSourceRoots: sourceRoots,
          predecessorSourceRoots
        });
      } catch (error) {
        throw prepareRevisionNetworkFailure(error);
      }
      const replayed = prepareApplicationV3Revision({
        applicationDraft,
        predecessor: refreshed.predecessor
      });
      const replayedBytes = Buffer.from(`${canonicalJson(replayed.application)}\n`, "utf8");
      if (
        refreshed.snapshotSha256 !== initial.snapshotSha256
        || canonicalJson(replayed.plan) !== canonicalJson(prepared.plan)
        || !replayedBytes.equals(applicationBytes)
        || validatePublicPrApplicationV3(replayed.application)?.valid !== true
      ) {
        throw new CliFailure("PREPARE_REVISION_SNAPSHOT_CHANGED", "the complete GitHub or derived revision snapshot changed before atomic rename", { exitCode: 1 });
      }
      await assertLocalSnapshot();
    };
    const materialization = options.write
      ? await materializePackageAsync(outputPlan, records, "prepared Application V3 revision", beforeCommit)
      : dryRunMaterialization(outputPlan.parent, outputPlan, records);
    return {
      action: "prepare-revision",
      contract: "public-pr-application-v3-revision-preparation",
      applicationId: prepared.application.applicationId,
      applicationRevision: prepared.application.applicationRevision,
      mode: prepared.plan.mode,
      lineage: prepared.application.lineage,
      target: prepared.plan.target,
      predecessor: prepared.plan.predecessor,
      sourceChanged: prepared.plan.sourceChanged,
      preparedDraftSha256: prepared.plan.preparedDraftSha256,
      planSha256: prepared.plan.planSha256,
      githubSnapshotSha256: initial.snapshotSha256,
      dryRun: !options.write,
      readOnly: !options.write,
      files: records.map(publicFileRecord),
      materialization,
      writePerformed: options.write,
      networkAccessed: true,
      candidateCodeExecuted: false,
      externalActionsPerformed: [],
      approvalGranted: false,
      launchAuthorizationGranted: false,
      nextAction: options.write
        ? "Review the derived root, then assemble it with every unchanged exact application-package sibling before submit or update; this root-only command made no GitHub write."
        : "Review the derived revision and hashes, then rerun with --write to create this exact root-only local artifact; it is not yet a transport package."
    };
  }

  Object.assign(runtime, {
    executePrepareRevision
  });
}
