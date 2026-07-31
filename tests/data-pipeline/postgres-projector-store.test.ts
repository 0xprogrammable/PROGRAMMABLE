import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  PostgresExecutor,
  PostgresParameter,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";
import {
  createPostgresReleaseProjectionStore,
  createPostgresProjectorStore,
  type ProjectorProviderDatabaseBinding,
  type ProjectorReleaseDatabaseScope,
} from "../../lib/data-pipeline/postgres-projector";
import type { EnvioCandidate } from "../../lib/data-pipeline/envio";
import type { DualRpcCandidateWindowEvidence } from "../../lib/data-pipeline/dual-rpc";

const bytes32 = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
const address = (byte: string) => `0x${byte.repeat(40)}` as `0x${string}`;
const bytes = (hex: string) => Buffer.from(hex.slice(2), "hex");
const executionTrace = (candidateBatchSize = 0) => ({
  startedAtMs: 1,
  completedAtMs: 2,
  candidateBatchSize,
  hardDeadlineMs: 75_000,
  maxCallsPerProvider: 48,
  elapsedMs: 1,
  providerCallCounts: [0, 0] as const,
  calls: [],
});

const PROVIDERS: readonly ProjectorProviderDatabaseBinding[] = [
  {
    type: "envio_deployment",
    redactedIdentity: "envio-mainnet-v1",
    deploymentCommitment: bytes32("1"),
    schemaCommitment: bytes32("2"),
  },
  {
    type: "rpc_provider",
    redactedIdentity: "rpc:1:alchemy",
    deploymentCommitment: bytes32("3"),
    schemaCommitment: bytes32("4"),
  },
  {
    type: "rpc_provider",
    redactedIdentity: "rpc:1:quicknode",
    deploymentCommitment: bytes32("5"),
    schemaCommitment: bytes32("6"),
  },
] as const;

const RELEASE_SCOPES = [
  { releaseId: "classic-v2", modelId: "classic", sourceGroup: "core" },
  { releaseId: "classic-v3", modelId: "classic", sourceGroup: "core" },
  { releaseId: "stock-paired-v1", modelId: "stock-paired", sourceGroup: "core" },
  { releaseId: "stock-paired-v2", modelId: "stock-paired", sourceGroup: "core" },
  { releaseId: "stock-paired-v3", modelId: "stock-paired", sourceGroup: "core" },
] as const;

const IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
] as const;

const RUNTIME_FENCE = Object.freeze({
  holderId: "projector-runtime-test",
  generation: "7",
  tokenHash: bytes32("a"),
});

type QueryRecord = { text: string; values: readonly PostgresParameter[] };

class StoreExecutor implements PostgresExecutor {
  readonly queries: QueryRecord[] = [];
  readonly close = vi.fn(async () => undefined);
  commitGeneration = "8";

  async transaction<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly PostgresParameter[] = [],
      ) => {
        this.queries.push({ text, values });
        if (text === "select session_user::text as session_user") {
          return [
            { session_user: "programmable_projector_login" },
          ] as unknown as Row[];
        }
        if (text.includes("current_role::text")) {
          return [
            {
              session_user: "programmable_projector_login",
              current_role: "programmable_projector",
            },
          ] as unknown as Row[];
        }
        if (text.includes("assert_projector_runtime_lease_v1")) {
          return [{ asserted: true }] as unknown as Row[];
        }
        if (text.includes("get_projector_runtime_state_v1")) {
          const release = values[1];
          return [
            {
              epoch_id:
                release === "envio-control"
                  ? "70000000-0000-4000-8000-000000000002"
                  : "70000000-0000-4000-8000-000000000010",
              pointer_generation: "1",
              provider_deployment_ids: IDS,
              provider_types: PROVIDERS.map(({ type }) => type),
              provider_redacted_identities: PROVIDERS.map(
                ({ redactedIdentity }) => redactedIdentity,
              ),
              lease_generation: "0",
              lease_holder_id: null,
              lease_acquired_at: null,
              lease_expires_at: null,
              checkpoint_id: null,
              checkpoint_generation: "0",
              reorg_generation: "0",
              checkpoint_block_number: null,
              checkpoint_block_hash: null,
              checkpoint_cursor_block_global_log_index: null,
              checkpoint_cursor_candidate_id: null,
            },
          ] as unknown as Row[];
        }
        if (text.includes("get_envio_ingestion_cursor_v1")) {
          return [
            {
              generation: "7",
              block_number: "25650000",
              block_hash: bytes(bytes32("7")),
              block_global_log_index: "9",
              candidate_id: `1:${bytes32("7")}:${bytes32("8")}:9`,
            },
          ] as unknown as Row[];
        }
        if (text.includes("get_projector_release_manifest_v1")) {
          if (values[1] !== "classic-v3") {
            return [
              {
                epoch_id: "70000000-0000-4000-8000-000000000010",
                pointer_generation: "1",
                epoch_commitment: bytes(bytes32("9")),
                artifact_creation_code_commitment: bytes(bytes32("a")),
                source_bindings: [],
                dynamic_source_templates: [],
                projection_event_rules: [],
                launch_completeness_requirements: [],
              },
            ] as unknown as Row[];
          }
          return [
            {
              epoch_id: "70000000-0000-4000-8000-000000000010",
              pointer_generation: "1",
              epoch_commitment: bytes(bytes32("9")),
              artifact_creation_code_commitment: bytes(bytes32("a")),
              source_bindings: [
                {
                  binding_id: "20000000-0000-4000-8000-000000000001",
                  source_name: "ClassicV3RewardVaultFactory",
                  source_role: "reward_vault_factory",
                  source_type: "ethereum_contract",
                  source_address: "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a",
                  recovery_selector: null,
                  inclusive_start_block: "25640000",
                  abi_event_set_commitment: bytes32("b"),
                  artifact_creation_code_commitment: bytes32("a"),
                  binding_commitment: bytes32("c"),
                },
              ],
              dynamic_source_templates: [
                {
                  dynamic_source_template_id:
                    "30000000-0000-4000-8000-000000000001",
                  parent_factory_release_binding_id:
                    "20000000-0000-4000-8000-000000000001",
                  parent_factory_binding_commitment: bytes32("c"),
                  parent_source_role: "reward_vault_factory",
                  factory_event_type: "RewardVaultDeployed",
                  deployed_address_field: "vault",
                  deployed_source_role: "reward_vault",
                  deployed_artifact_creation_code_commitment: bytes32("d"),
                  normalized_runtime_code_hash: bytes32("e"),
                  expected_instance_runtime_code_hash: null,
                  immutable_references_commitment: bytes32("f"),
                  immutable_binding_spec: {
                    factoryConfigurationField: "configurationCommitment",
                    bindings: [
                      {
                        ordinal: "0",
                        offset: "4",
                        length: "20",
                        source: "deployed_address",
                        encoding: "address",
                      },
                    ],
                  },
                  immutable_binding_commitment: bytes32("1"),
                  runtime_code_length: "200",
                  abi_event_set_commitment: bytes32("2"),
                  template_commitment: bytes32("3"),
                },
              ],
              projection_event_rules: [],
              launch_completeness_requirements: [],
            },
          ] as unknown as Row[];
        }
        if (text.includes("get_projector_dynamic_source_attestations_v1")) {
          if (values[1] !== "classic-v3") {
            return [] as unknown as Row[];
          }
          return [
            {
              dynamic_source_attestation_id:
                "40000000-0000-4000-8000-000000000001",
              dynamic_source_template_id:
                "30000000-0000-4000-8000-000000000001",
              runtime_code_evidence_id:
                "40000000-0000-4000-8000-000000000002",
              deployed_source_address: bytes(address("a")),
              deployed_source_role: "reward_vault",
              deployment_block_number: "25645000",
              runtime_code_hash: bytes(bytes32("4")),
              normalized_runtime_code_hash: bytes(bytes32("e")),
              expected_instance_runtime_code_hash: null,
              runtime_code_length: "200",
              immutable_references_commitment: bytes(bytes32("f")),
              immutable_binding_spec: {
                factoryConfigurationField: "configurationCommitment",
                bindings: [
                  {
                    ordinal: "0",
                    offset: "4",
                    length: "20",
                    source: "deployed_address",
                    encoding: "address",
                  },
                ],
              },
              immutable_binding_commitment: bytes(bytes32("1")),
              abi_event_set_commitment: bytes(bytes32("2")),
              template_commitment: bytes(bytes32("3")),
              attestation_commitment: bytes(bytes32("5")),
              parent_factory_occurrence_id:
                "40000000-0000-4000-8000-000000000003",
              parent_factory_release_binding_id:
                "20000000-0000-4000-8000-000000000001",
              parent_factory_binding_commitment: bytes(bytes32("c")),
              dynamic_source_release_asset_binding_id:
                "40000000-0000-4000-8000-000000000004",
              launch_occurrence_id:
                "40000000-0000-4000-8000-000000000005",
              pool_occurrence_id:
                "40000000-0000-4000-8000-000000000006",
              token: bytes(address("b")),
              pool_id: bytes(bytes32("6")),
              hook: bytes(address("c")),
              quote_asset: bytes(address("d")),
              asset_binding_commitment: bytes(bytes32("7")),
            },
          ] as unknown as Row[];
        }
        if (text.includes("append_safe_head_observation")) {
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("append_dual_rpc_block_evidence")) {
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("commit_envio_ingestion_page_v1")) {
          return [{ generation: this.commitGeneration }] as unknown as Row[];
        }
        return [] as unknown as Row[];
      },
    });
  }
}

function candidate(): EnvioCandidate {
  return {
    candidateId: `1:${bytes32("d")}:${bytes32("e")}:10`,
    chainId: 1,
    blockNumber: "25650001",
    blockHash: bytes32("d"),
    blockTimestamp: "1750000000",
    transactionHash: bytes32("e"),
    transactionIndex: 2,
    blockGlobalLogIndex: 10,
    sourceAddress: "0x1c6433659fcbafe482c4bc5941752a2674d17d6a",
    contractName: "ClassicV3Launcher",
    eventName: "ClassicV3TokenLaunched",
    releaseHint: { model: "classic", releaseVersion: "classic-v3" },
    orderedTopics: [bytes32("f")],
    rawData: "0x",
    decodedPayload: {},
    payloadHash: bytes32("1"),
  };
}

describe("concrete projector Postgres store", () => {
  it("rejects missing, duplicate, reordered, or wrong-model release scope sets", () => {
    const executor = new StoreExecutor();
    const create = (releaseScopes: readonly ProjectorReleaseDatabaseScope[]) =>
      createPostgresProjectorStore({
        executor,
        providers: PROVIDERS,
        releaseScopes,
        runtimeFence: RUNTIME_FENCE,
      });

    expect(() => create(RELEASE_SCOPES.slice(0, 4))).toThrow();
    expect(() =>
      create([...RELEASE_SCOPES.slice(0, 4), RELEASE_SCOPES[0]!]),
    ).toThrow();
    expect(() =>
      create([RELEASE_SCOPES[1]!, RELEASE_SCOPES[0]!, ...RELEASE_SCOPES.slice(2)]),
    ).toThrow();
    expect(() =>
      create(
        RELEASE_SCOPES.map((scope, index) =>
          index === 0 ? { ...scope, modelId: "classic-v2" } : scope,
        ),
      ),
    ).toThrow();
  });

  it("reads the neutral cursor and only asset-bound current dynamic sources", async () => {
    const executor = new StoreExecutor();
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
    });

    const plan = await store.readPlan();

    expect(plan).toMatchObject({
      cursor: { generation: "7", blockNumber: "25650000" },
      database: {
        envioProviderDeploymentId: IDS[0],
        rpcProviderDeploymentIds: [IDS[1], IDS[2]],
      },
      dynamicSources: [
        {
          attestationId: "40000000-0000-4000-8000-000000000001",
          contractName: "ClassicV3RewardVault",
          parentOccurrenceId: "40000000-0000-4000-8000-000000000003",
          expectedExactRuntimeCodeHash: bytes32("4"),
          immutableReferences: [{ start: 4, length: 20 }],
        },
      ],
    });
  });

  it("opens evidence and commits one verified page in a single final transaction", async () => {
    const executor = new StoreExecutor();
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
      uuid: (() => {
        let suffix = 1;
        return () =>
          `50000000-0000-4000-8000-${String(suffix++).padStart(12, "0")}`;
      })(),
      now: () => new Date("2026-07-31T18:00:00.000Z"),
    });
    const plan = {
      cursor: {
        generation: "7",
        blockNumber: "25650000",
        blockHash: bytes32("7"),
      blockGlobalLogIndex: 9,
      candidateId: `1:${bytes32("7")}:${bytes32("8")}:9`,
      isBlockBoundary: false,
      },
      dynamicSources: [],
      database: {
        epochId: "70000000-0000-4000-8000-000000000002",
        pointerGeneration: "1",
        envioProviderDeploymentId: IDS[0],
        rpcProviderDeploymentIds: [IDS[1], IDS[2]] as const,
      },
    };
    const item = candidate();
    const rawLogCommitment = bytes32("2");
    const evidence: DualRpcCandidateWindowEvidence = {
      chainId: 1,
      providerIdentities: ["alchemy", "quicknode"],
      providerVendorGroups: ["alchemy", "quicknode"],
      providerEndpointCommitments: [bytes32("3"), bytes32("4")],
      providerOriginCommitments: [bytes32("5"), bytes32("6")],
      providerHeads: ["25650020", "25650021"],
      safeBlockNumber: "25650008",
      safeBlockHash: bytes32("9"),
      executionTrace: executionTrace(1),
      candidates: [
        {
          chainId: 1,
          candidateId: item.candidateId,
          sourceAddress: item.sourceAddress,
          contractName: item.contractName,
          eventName: item.eventName,
          sourceKind: "static",
          model: "classic",
          releaseVersion: "classic-v3",
          payloadHash: item.payloadHash,
          rawLogCommitment,
          providerIdentities: ["alchemy", "quicknode"],
          providerVendorGroups: ["alchemy", "quicknode"],
          providerEndpointCommitments: [bytes32("3"), bytes32("4")],
          providerOriginCommitments: [bytes32("5"), bytes32("6")],
          providerHeads: ["25650020", "25650021"],
          safeBlockNumber: "25650008",
          safeBlockHash: bytes32("9"),
          candidateBlockNumber: item.blockNumber,
          candidateBlockHash: item.blockHash,
          candidateBlockTimestamp: item.blockTimestamp,
          transactionHash: item.transactionHash,
          transactionIndex: item.transactionIndex,
          receiptCommitment: bytes32("7"),
          sourceCodeHash: bytes32("8"),
          receiptLogOrdinal: 0,
        },
      ],
      coveredCandidateCount: 1,
      coverage: {
        fromBlockNumber: plan.cursor.blockNumber,
        throughBlockNumber: item.blockNumber,
        throughBlockHash: item.blockHash,
        throughBlockGlobalLogIndex: "10",
        filterCommitment: bytes32("a"),
        providerLogCommitments: [bytes32("b"), bytes32("b")],
      },
    };

    await expect(
      store.commitVerifiedPage({
        plan,
        snapshotBlock: item.blockNumber,
        candidates: [item],
        evidence,
      }),
    ).resolves.toEqual({ generation: "8" });

    const statements = executor.queries.map(({ text }) => text);
    expect(statements.some((text) => text.includes("open_run"))).toBe(true);
    expect(statements.some((text) => text.includes("append_safe_head_observation"))).toBe(true);
    expect(statements.some((text) => text.includes("append_dual_rpc_block_evidence"))).toBe(true);
    expect(statements.at(-1)).toContain("commit_envio_ingestion_page_v1");
    const commit = executor.queries.at(-1)!;
    expect(
      commit.values.some(
        (value) =>
          Array.isArray(value) &&
          value.some(
            (item) =>
              item instanceof Uint8Array &&
              `0x${Buffer.from(item).toString("hex")}` === rawLogCommitment,
          ),
      ),
    ).toBe(true);
    expect(JSON.stringify(commit.values)).not.toContain("undefined");
  });

  it("commits a verified empty page without fabricating an Envio candidate", async () => {
    const executor = new StoreExecutor();
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
      uuid: (() => {
        let suffix = 1;
        return () =>
          `60000000-0000-0000-0000-${String(suffix++).padStart(12, "0")}`;
      })(),
      now: () => new Date("2026-07-31T18:01:00.000Z"),
    });
    const plan = {
      cursor: {
        generation: "7",
        blockNumber: "25650000",
        blockHash: bytes32("7"),
        blockGlobalLogIndex: 9,
        candidateId: `1:${bytes32("7")}:${bytes32("8")}:9`,
        isBlockBoundary: false,
      },
      dynamicSources: [],
      database: {
        epochId: "70000000-0000-0000-0000-000000000002",
        pointerGeneration: "1",
        envioProviderDeploymentId: IDS[0],
        rpcProviderDeploymentIds: [IDS[1], IDS[2]] as const,
      },
    };
    const terminalHash = bytes32("c");
    const emptyCommitment = bytes32("b");
    await expect(
      store.commitVerifiedPage({
        plan,
        snapshotBlock: "25650002",
        candidates: [],
        evidence: {
          chainId: 1,
          providerIdentities: ["alchemy", "quicknode"],
          providerVendorGroups: ["alchemy", "quicknode"],
          providerEndpointCommitments: [bytes32("3"), bytes32("4")],
          providerOriginCommitments: [bytes32("5"), bytes32("6")],
          providerHeads: ["25650020", "25650021"],
          safeBlockNumber: "25650008",
          safeBlockHash: bytes32("9"),
          candidates: [],
          executionTrace: executionTrace(),
          coveredCandidateCount: 0,
          coverage: {
            fromBlockNumber: "25650000",
            throughBlockNumber: "25650002",
            throughBlockHash: terminalHash,
            throughBlockGlobalLogIndex: "4294967295",
            filterCommitment: bytes32("a"),
            providerLogCommitments: [emptyCommitment, emptyCommitment],
          },
        },
      }),
    ).resolves.toEqual({ generation: "8" });
    const commit = executor.queries.at(-1)!;
    expect(commit.text).toContain("commit_envio_ingestion_page_v1");
    expect(commit.values[8]).toBe("[]");
    expect(commit.values[14]).toEqual([]);
    expect(commit.values[15]).toEqual([]);
  });
});

class ReleaseProjectionExecutor implements PostgresExecutor {
  readonly queries: QueryRecord[] = [];
  readonly close = vi.fn(async () => undefined);
  leaseGeneration = "0";
  assertRuntimeFence = true;
  decisionId: string | null = null;
  readonly candidateId = `1:${bytes32("d")}:${bytes32("e")}:10`;

  async transaction<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly PostgresParameter[] = [],
      ) => {
        this.queries.push({ text, values });
        if (text === "select session_user::text as session_user") {
          return [{ session_user: "programmable_projector_login" }] as unknown as Row[];
        }
        if (text.includes("current_role::text")) {
          return [{
            session_user: "programmable_projector_login",
            current_role: "programmable_projector",
          }] as unknown as Row[];
        }
        if (text.includes("assert_projector_runtime_lease_v1")) {
          return [{ asserted: this.assertRuntimeFence }] as unknown as Row[];
        }
        if (text.includes("get_projector_runtime_state_v1")) {
          return [{
            epoch_id: "70000000-0000-4000-8000-000000000020",
            pointer_generation: "1",
            provider_deployment_ids: IDS,
            provider_types: PROVIDERS.map(({ type }) => type),
            provider_redacted_identities: PROVIDERS.map(
              ({ redactedIdentity }) => redactedIdentity,
            ),
            lease_generation: this.leaseGeneration,
            lease_holder_id: null,
            lease_acquired_at: null,
            lease_expires_at: null,
            checkpoint_id: null,
            checkpoint_generation: "0",
            reorg_generation: "0",
            checkpoint_block_number: null,
            checkpoint_block_hash: null,
            checkpoint_cursor_block_global_log_index: null,
            checkpoint_cursor_candidate_id: null,
          }] as unknown as Row[];
        }
        if (text.includes("acquire_projector_lease")) {
          this.leaseGeneration = "1";
          return [{ acquired: true }] as unknown as Row[];
        }
        if (text.includes("get_projector_release_manifest_v1")) {
          return [{
            epoch_id: "70000000-0000-4000-8000-000000000020",
            pointer_generation: "1",
            epoch_commitment: bytes(bytes32("1")),
            artifact_creation_code_commitment: bytes(bytes32("2")),
            source_bindings: [],
            dynamic_source_templates: [],
            projection_event_rules: [],
            launch_completeness_requirements: [],
          }] as unknown as Row[];
        }
        if (text.includes("get_projector_dynamic_source_attestations_v1")) {
          return [] as unknown as Row[];
        }
        if (text.includes("list_projector_candidate_page_v1")) {
          return [{
            candidate_id: this.candidateId,
            provider_deployment_id: IDS[0],
            block_number: "25650001",
            block_hash: bytes(bytes32("d")),
            transaction_hash: bytes(bytes32("e")),
            transaction_index: "2",
            block_global_log_index: "10",
            source_address: bytes(address("1")),
            event_signature: bytes(bytes32("f")),
            event_type: "UnknownEvent",
            ordered_topics: [bytes(bytes32("f"))],
            raw_data: Buffer.alloc(0),
            decoded_payload: {},
            payload_hash: bytes(bytes32("1")),
            content_commitment: bytes(bytes32("2")),
            contract_name: "UnknownContract",
            status: "pending",
            attempt_count: "0",
          }] as unknown as Row[];
        }
        if (text.includes("open_run")) {
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("append_safe_head_observation")) {
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("append_dual_rpc_block_evidence")) {
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("ignore_envio_candidate_v1")) {
          this.decisionId = String(values[0]);
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("list_projector_candidate_dispositions_v1")) {
          return [{
            candidate_id: this.candidateId,
            block_number: "25650001",
            block_hash: bytes(bytes32("d")),
            transaction_hash: bytes(bytes32("e")),
            transaction_index: "2",
            block_global_log_index: "10",
            status: "ignored",
            attempt_count: "0",
            decision_id: this.decisionId,
            reason_code: "outside-release-manifest",
            reason_commitment: bytes(bytes32("3")),
            changed_at: "2026-07-31T18:00:00.000Z",
          }] as unknown as Row[];
        }
        if (text.includes("promote_projection_run_v2")) {
          return [{ id: values[1] }] as unknown as Row[];
        }
        if (text.includes("promote_projection_run")) {
          return [{ id: values[0] }] as unknown as Row[];
        }
        return [] as unknown as Row[];
      },
    });
  }
}

describe("release-scoped projector Postgres commit", () => {
  it("atomically checkpoints an irrelevant candidate as ignored", async () => {
    const executor = new ReleaseProjectionExecutor();
    let sequence = 1;
    const store = createPostgresReleaseProjectionStore({
      executor,
      providers: PROVIDERS,
      scope: {
        releaseId: "classic-v2",
        modelId: "classic",
        sourceGroup: "core",
      },
      runtimeFence: RUNTIME_FENCE,
      uuid: () =>
        `80000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
      now: () => new Date("2026-07-31T18:00:00.000Z"),
    });
    const plan = await store.readProjectionPlan();
    expect(plan).not.toBeNull();
    expect(plan?.entries[0]?.action).toBe("ignore");
    const item = plan!.entries[0]!.candidate;
    const projection = {
      plan: plan!,
      freshCandidates: [{
        ...item,
        blockTimestamp: "1750000000",
        releaseHint: { model: "unresolved", releaseVersion: "unresolved" },
      }],
      ignoredCandidateIds: [item.candidateId],
      evidence: {
        chainId: 1,
        providerIdentities: ["alchemy", "quicknode"],
        providerVendorGroups: ["alchemy", "quicknode"],
        providerEndpointCommitments: [bytes32("3"), bytes32("5")],
        providerOriginCommitments: [bytes32("4"), bytes32("6")],
        providerHeads: ["25650020", "25650021"],
        safeBlockNumber: "25650008",
        safeBlockHash: bytes32("9"),
        executionTrace: executionTrace(1),
        candidates: [{
          chainId: 1,
          candidateId: item.candidateId,
          sourceAddress: item.sourceAddress,
          contractName: item.contractName,
          eventName: item.eventName,
          sourceKind: "static",
          model: "unresolved",
          releaseVersion: "unresolved",
          payloadHash: item.payloadHash,
          rawLogCommitment: bytes32("2"),
          providerIdentities: ["alchemy", "quicknode"],
          providerVendorGroups: ["alchemy", "quicknode"],
          providerEndpointCommitments: [bytes32("3"), bytes32("5")],
          providerOriginCommitments: [bytes32("4"), bytes32("6")],
          providerHeads: ["25650020", "25650021"],
          safeBlockNumber: "25650008",
          safeBlockHash: bytes32("9"),
          candidateBlockNumber: item.blockNumber,
          candidateBlockHash: item.blockHash,
          candidateBlockTimestamp: "1750000000",
          transactionHash: item.transactionHash,
          transactionIndex: item.transactionIndex,
          receiptCommitment: bytes32("7"),
          sourceCodeHash: bytes32("8"),
          receiptLogOrdinal: 0,
        }],
      },
      fold: { occurrences: [], facts: [], launches: [], knownPools: [] },
      rewardSnapshot: null,
    } as const;

    executor.assertRuntimeFence = false;
    const staleQueryStart = executor.queries.length;
    await expect(store.commitVerifiedProjection(projection)).rejects.toThrow();
    const staleStatements = executor.queries
      .slice(staleQueryStart)
      .map(({ text }) => text);
    expect(
      staleStatements.some((text) => text.includes("promote_projection_run")),
    ).toBe(false);
    expect(staleStatements.some((text) => text.includes("open_run"))).toBe(false);

    executor.assertRuntimeFence = true;
    const result = await store.commitVerifiedProjection(projection);

    expect(result).toEqual({ checkpointGeneration: "1" });
    const statements = executor.queries.map(({ text }) => text);
    expect(statements.some((text) => text.includes("ignore_envio_candidate_v1"))).toBe(true);
    expect(statements.at(-1)).toContain("promote_projection_run");
    const promotion = executor.queries.at(-1)!;
    expect(promotion.values[21]).toEqual([
      "classic-v3-profile",
      "creator-profile",
      "explore-chart",
      "explore-list",
      "explore-token",
      "launch-lookup",
    ]);
  });
});
