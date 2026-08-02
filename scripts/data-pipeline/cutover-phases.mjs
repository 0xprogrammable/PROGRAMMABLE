import { canonicalJson, sha256 } from "./hosted-db-operator-core.mjs";

const BYTES32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,80}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RELEASES = Object.freeze([
  Object.freeze({ releaseId: "classic-v2", modelId: "classic" }),
  Object.freeze({ releaseId: "classic-v3", modelId: "classic" }),
  Object.freeze({ releaseId: "stock-paired-v1", modelId: "stock-paired" }),
  Object.freeze({ releaseId: "stock-paired-v2", modelId: "stock-paired" }),
  Object.freeze({ releaseId: "stock-paired-v3", modelId: "stock-paired" }),
]);

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function integer(value, label, { positive = false } = {}) {
  const text = typeof value === "bigint" ? value.toString() : String(value);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text) || (positive && text === "0")) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function bytes32(value, label) {
  const result = typeof value === "string" ? value.toLowerCase() : "";
  if (!BYTES32.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function isoTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function commitEvidence(payload) {
  return Object.freeze({
    ...payload,
    evidenceSha256: sha256(canonicalJson(payload)),
  });
}

export function assertCandidateFence(value, expectedState = "fenced") {
  const input = object(value, "candidate database fence");
  const publicationCount = Number(integer(input.publicationCount, "publication count"));
  const promoted = input.promoted === true;
  if (
    input.databaseMode !== "candidate-only" ||
    typeof input.envioProviderDeploymentId !== "string" ||
    !UUID.test(input.envioProviderDeploymentId) ||
    !Number.isSafeInteger(publicationCount) ||
    publicationCount < 0
  ) {
    throw new Error("candidate database fence is invalid");
  }
  if (expectedState === "fenced" && (promoted || publicationCount !== 0)) {
    throw new Error("candidate database publication fence is not closed");
  }
  if (expectedState === "attested" && !promoted) {
    throw new Error("candidate database promotion is not attested");
  }
  if (
    promoted &&
    (!COMMIT.test(input.productCommit ?? "") ||
      !DEPLOYMENT_ID.test(input.stagedDeploymentId ?? ""))
  ) {
    throw new Error("candidate database deployment binding is invalid");
  }
  if (
    !promoted &&
    (input.productCommit !== null || input.stagedDeploymentId !== null)
  ) {
    throw new Error("fenced candidate database already has a deployment binding");
  }
  return Object.freeze({
    databaseMode: "candidate-only",
    envioProviderDeploymentId: input.envioProviderDeploymentId,
    promoted,
    publicationCount,
    promotionAttestationCommitment:
      input.promotionAttestationCommitment === null ||
      input.promotionAttestationCommitment === undefined
        ? null
        : bytes32(
            input.promotionAttestationCommitment,
            "database promotion attestation",
          ),
    productCommit: input.productCommit,
    stagedDeploymentId: input.stagedDeploymentId,
  });
}

export async function runFencedRawBackfill(input) {
  const maximumCycles = input.maximumCycles ?? 256;
  if (!Number.isSafeInteger(maximumCycles) || maximumCycles < 1 || maximumCycles > 4096) {
    throw new Error("raw backfill cycle bound is invalid");
  }
  const before = assertCandidateFence(await input.inspectFence(), "fenced");
  const cycles = [];
  let terminal = false;
  for (let index = 0; index < maximumCycles; index += 1) {
    const raw = object(await input.runRawCycle(), "raw backfill result");
    const candidateCount = Number(integer(raw.candidateCount ?? 0, "candidate count"));
    if (!Number.isSafeInteger(candidateCount) || candidateCount < 0) {
      throw new Error("raw backfill result is invalid");
    }
    if (
      ![
        "committed",
        "committed-empty",
        "recovered-reorg",
        "staged-dynamic-parent",
        "idle",
      ].includes(raw.status)
    ) {
      throw new Error("raw backfill failed");
    }
    cycles.push(Object.freeze({
      ordinal: index + 1,
      status: raw.status,
      candidateCount,
      snapshotBlock: integer(raw.snapshotBlock, "raw snapshot block"),
      ...(raw.generation === undefined
        ? {}
        : { generation: integer(raw.generation, "raw cursor generation") }),
    }));
    if (raw.status === "idle") {
      terminal = true;
      break;
    }
  }
  if (!terminal) throw new Error("raw backfill did not reach an idle boundary");
  const after = assertCandidateFence(await input.inspectFence(), "fenced");
  if (
    before.envioProviderDeploymentId !== after.envioProviderDeploymentId ||
    before.publicationCount !== after.publicationCount
  ) {
    throw new Error("candidate database fence changed during raw backfill");
  }
  const payload = {
    kind: "programmable-candidate-raw-backfill-evidence",
    schemaVersion: 1,
    candidateEndpointIdentity: input.candidateEndpointIdentity,
    envioProviderDeploymentId: before.envioProviderDeploymentId,
    startedAt: isoTimestamp(input.startedAt, "raw backfill start"),
    completedAt: isoTimestamp(input.completedAt(), "raw backfill completion"),
    cycleCount: cycles.length,
    candidateCount: cycles.reduce((sum, cycle) => sum + cycle.candidateCount, 0),
    terminalStatus: "idle",
    publicationFence: "closed",
    cycles: Object.freeze(cycles),
  };
  return commitEvidence(payload);
}

export function checkpointRequestsFromRows(rows, maximumEntityCount = 10_000) {
  if (
    !Array.isArray(rows) ||
    !Number.isSafeInteger(maximumEntityCount) ||
    maximumEntityCount < 1 ||
    maximumEntityCount > 10_000
  ) {
    throw new Error("checkpoint inventory is invalid");
  }
  const requests = rows.map((rowValue) => {
    const row = object(rowValue, "checkpoint row");
    const releaseId = String(row.release_id ?? row.releaseId ?? "");
    const modelId = String(row.model_id ?? row.modelId ?? "");
    const expected = RELEASES.find(
      (release) => release.releaseId === releaseId && release.modelId === modelId,
    );
    const epochId = String(row.epoch_id ?? row.epochId ?? "");
    const checkpointId = String(row.checkpoint_id ?? row.checkpointId ?? "");
    const blockHash = String(
      row.checkpoint_block_hash ?? row.checkpointBlockHash ?? row.block_hash ?? row.blockHash ?? "",
    ).toLowerCase();
    if (
      !expected ||
      !UUID.test(epochId) ||
      !UUID.test(checkpointId) ||
      !BYTES32.test(blockHash)
    ) {
      throw new Error("checkpoint row is invalid");
    }
    return Object.freeze({
      chainId: integer(row.chain_id ?? row.chainId, "checkpoint chain"),
      releaseId,
      modelId,
      sourceGroup: String(row.source_group ?? row.sourceGroup ?? ""),
      epochId,
      pointerGeneration: integer(
        row.pointer_generation ?? row.pointerGeneration,
        "checkpoint pointer generation",
        { positive: true },
      ),
      checkpointId,
      checkpointBlockNumber: integer(
        row.block_number ?? row.checkpointBlockNumber,
        "checkpoint block",
      ),
      checkpointBlockHash: blockHash,
      maximumEntityCount,
    });
  });
  if (
    requests.length !== RELEASES.length ||
    requests.some((request) => request.chainId !== "1" || request.sourceGroup !== "core") ||
    RELEASES.some(
      (release) =>
        requests.filter(
          (request) =>
            request.releaseId === release.releaseId && request.modelId === release.modelId,
        ).length !== 1,
    )
  ) {
    throw new Error("checkpoint inventory is incomplete or duplicated");
  }
  return Object.freeze(
    [...requests].sort(
      (left, right) =>
        RELEASES.findIndex(({ releaseId }) => releaseId === left.releaseId) -
        RELEASES.findIndex(({ releaseId }) => releaseId === right.releaseId),
    ),
  );
}

function sourceCaughtUp(result) {
  return result?.ok === true && result?.readiness?.status === "caught-up" &&
    result.readiness.activationReady === true && result.readiness.lagging === false;
}

function marketCaughtUp(result) {
  return result?.caughtUp === true && result?.lagBlocks === "0";
}

export async function runPostAttestationStagedGates(input) {
  const fence = assertCandidateFence(await input.inspectFence(), "attested");
  if (
    fence.productCommit !== input.productCommit ||
    fence.stagedDeploymentId !== input.stagedDeploymentId
  ) {
    throw new Error("staged runtime does not match the database deployment binding");
  }
  const maximumWorkerCycles = input.maximumWorkerCycles ?? 256;
  if (
    !Number.isSafeInteger(maximumWorkerCycles) ||
    maximumWorkerCycles < 1 ||
    maximumWorkerCycles > 4096
  ) {
    throw new Error("worker cycle bound is invalid");
  }
  let source;
  let sourceCycles = 0;
  for (; sourceCycles < maximumWorkerCycles; sourceCycles += 1) {
    source = await input.runSourceProjector();
    if (sourceCaughtUp(source)) break;
    if (source?.ok !== true || source?.status === "disabled") {
      throw new Error("source projector failed before catch-up");
    }
  }
  if (!sourceCaughtUp(source)) throw new Error("source projector did not catch up");

  let market;
  let marketCycles = 0;
  for (; marketCycles < maximumWorkerCycles; marketCycles += 1) {
    market = await input.runMarketProjector();
    if (marketCaughtUp(market)) break;
    if (market?.status === "disabled") {
      throw new Error("market projector is disabled");
    }
  }
  if (!marketCaughtUp(market)) throw new Error("market projector did not catch up");

  const checkpoints = checkpointRequestsFromRows(await input.readCheckpoints());
  const reconciliations = [];
  for (const request of checkpoints) {
    const result = object(await input.runReconciler(request), "reconciler result");
    if (
      result.ok !== true ||
      result.status !== "succeeded" ||
      result.mismatchCount !== 0 ||
      result.checkpointId !== request.checkpointId ||
      result.checkpointBlockNumber !== request.checkpointBlockNumber ||
      String(result.checkpointBlockHash).toLowerCase() !== request.checkpointBlockHash
    ) {
      throw new Error(`reconciler parity failed: ${request.releaseId}`);
    }
    reconciliations.push(Object.freeze({
      releaseId: request.releaseId,
      checkpointId: request.checkpointId,
      checkpointBlockNumber: request.checkpointBlockNumber,
      checkpointBlockHash: request.checkpointBlockHash,
      routeCount: Number(integer(result.routeCount, "reconciler route count", { positive: true })),
      mismatchCount: 0,
    }));
  }
  const load = object(await input.runLoadGate(), "load gate result");
  if (load.status !== "accepted" || load.releaseEvidenceAccepted !== true) {
    throw new Error("staged load and parity evidence was rejected");
  }
  const payload = {
    kind: "programmable-post-attestation-staged-gate-evidence",
    schemaVersion: 1,
    candidateEndpointIdentity: input.candidateEndpointIdentity,
    stagedDeploymentId: input.stagedDeploymentId,
    productCommit: input.productCommit,
    envioProviderDeploymentId: fence.envioProviderDeploymentId,
    databasePromotionAttestationCommitment:
      fence.promotionAttestationCommitment,
    sourceProjectorCycles: sourceCycles + 1,
    marketProjectorCycles: marketCycles + 1,
    reconciliations: Object.freeze(reconciliations),
    loadEvidenceCommitment: bytes32(load.evidenceSha256, "load evidence commitment"),
    completedAt: isoTimestamp(input.completedAt(), "staged gate completion"),
  };
  return commitEvidence(payload);
}

export const CUTOVER_RELEASES = RELEASES;
