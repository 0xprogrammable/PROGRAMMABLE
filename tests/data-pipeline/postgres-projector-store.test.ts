import { describe, expect, it, vi } from "vitest";
import { concat, encodeAbiParameters, keccak256, toBytes } from "viem";

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
import { projectorOccurrenceUuid } from "../../lib/data-pipeline/projector-ids";
import { foldProjectorRewardState } from "../../lib/data-pipeline/projector-reward-fold";
import { runtimeBytecodeEvidence } from "../../lib/data-pipeline/runtime-bytecode";

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
const RPC_EVIDENCE_BINDINGS = [
  {
    identity: "alchemy",
    vendorGroup: "alchemy",
    endpointCommitment: bytes32("3"),
    endpointOriginCommitment: bytes32("4"),
  },
  {
    identity: "quicknode",
    vendorGroup: "quicknode",
    endpointCommitment: bytes32("5"),
    endpointOriginCommitment: bytes32("6"),
  },
] as const;

const projectionExecutionTrace = {
  startedAtMs: 1,
  completedAtMs: 2,
  candidateBatchSize: 1,
  hardDeadlineMs: 75_000,
  maxCallsPerProvider: 48,
  elapsedMs: 1,
  providerCallCounts: [1, 1] as const,
  calls: RPC_EVIDENCE_BINDINGS.map((binding) => ({
    providerIdentity: binding.identity,
    providerVendorGroup: binding.vendorGroup,
    providerEndpointCommitment: binding.endpointCommitment,
    providerOriginCommitment: binding.endpointOriginCommitment,
    operation: "getChainId" as const,
    attempt: 1,
    startedOffsetMs: 0,
    durationMs: 1,
    outcome: "success" as const,
  })),
};

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
  transactionCount = 0;
  commitGeneration = "8";
  cursorBlockNumber = "25650000";
  includeHistoricalStock = false;
  provisionalRows: readonly Record<string, unknown>[] = [];
  provisionalActivationRows: readonly Record<string, unknown>[] = [];
  pendingActivationResolutionRows: readonly Record<string, unknown>[] = [];
  reorgTargetRows: readonly Record<string, unknown>[] = [];
  reorgRecoveryRows: readonly Record<string, unknown>[] = [{
    cursor_generation: "8",
    reorg_generation: "1",
    release_checkpoint_count: "5",
  }];
  omitReorgGeneration = false;
  classicNormalizedRuntimeCodeHash = bytes32("e");
  classicImmutableReferencesCommitment = bytes32("f");
  reusedSafeHeadObservationId: string | null = null;

  async transaction<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
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
          const row: Record<string, unknown> = {
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
          };
          if (this.omitReorgGeneration) delete row.reorg_generation;
          return [row] as unknown as Row[];
        }
        if (text.includes("get_envio_ingestion_cursor_v1")) {
          return [
            {
              generation: "7",
              block_number: this.cursorBlockNumber,
              block_hash: bytes(bytes32("7")),
              block_global_log_index: "9",
              candidate_id: `1:${bytes32("7")}:${bytes32("8")}:9`,
            },
          ] as unknown as Row[];
        }
        if (text.includes("get_projector_release_manifest_v1")) {
          if (values[1] === "stock-paired-v1" && this.includeHistoricalStock) {
            return [
              {
                epoch_id: "70000000-0000-4000-8000-000000000010",
                pointer_generation: "1",
                epoch_commitment: bytes(bytes32("9")),
                artifact_creation_code_commitment: bytes(bytes32("a")),
                source_bindings: [
                  {
                    binding_id: "21000000-0000-4000-8000-000000000001",
                    source_name: "StockV1RewardVaultFactory",
                    source_role: "vault_factory",
                    source_type: "ethereum_contract",
                    source_address:
                      "0xd430d9162c153afdf9e4caca6d2317e72a044441",
                    inclusive_start_block: "25637469",
                    abi_event_set_commitment: bytes32("4"),
                    binding_commitment: bytes32("5"),
                  },
                ],
                dynamic_source_templates: [
                  {
                    dynamic_source_template_id:
                      "31000000-0000-4000-8000-000000000001",
                    parent_factory_release_binding_id:
                      "21000000-0000-4000-8000-000000000001",
                    parent_factory_binding_commitment: bytes32("5"),
                    parent_source_role: "vault_factory",
                    factory_event_type: "QuoteAssetFeeSplitVaultDeployed",
                    deployed_address_field: "vault",
                    deployed_source_role: "reward_vault",
                    deployed_artifact_creation_code_commitment: bytes32("6"),
                    normalized_runtime_code_hash: bytes32("7"),
                    expected_instance_runtime_code_hash: null,
                    immutable_references_commitment: bytes32("8"),
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
                    immutable_binding_commitment: bytes32("9"),
                    runtime_code_length: "220",
                    abi_event_set_commitment: bytes32("a"),
                    template_commitment: bytes32("b"),
                  },
                ],
                projection_event_rules: [],
                launch_completeness_requirements: [],
              },
            ] as unknown as Row[];
          }
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
                  source_role: "vault_factory",
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
                  parent_source_role: "vault_factory",
                  factory_event_type: "ClassicRewardVaultDeployed",
                  deployed_address_field: "vault",
                  deployed_source_role: "reward_vault",
                  deployed_artifact_creation_code_commitment: bytes32("d"),
                  normalized_runtime_code_hash:
                    this.classicNormalizedRuntimeCodeHash,
                  expected_instance_runtime_code_hash: null,
                  immutable_references_commitment:
                    this.classicImmutableReferencesCommitment,
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
          if (values[1] === "stock-paired-v1" && this.includeHistoricalStock) {
            return [
              {
                dynamic_source_attestation_id:
                  "41000000-0000-4000-8000-000000000001",
                dynamic_source_template_id:
                  "31000000-0000-4000-8000-000000000001",
                runtime_code_evidence_id:
                  "41000000-0000-4000-8000-000000000002",
                deployed_source_address: bytes(address("e")),
                deployed_source_role: "reward_vault",
                deployment_block_number: "25646000",
                runtime_code_hash: bytes(bytes32("c")),
                normalized_runtime_code_hash: bytes(bytes32("7")),
                expected_instance_runtime_code_hash: null,
                runtime_code_length: "220",
                immutable_references_commitment: bytes(bytes32("8")),
                immutable_binding_commitment: bytes(bytes32("9")),
                abi_event_set_commitment: bytes(bytes32("a")),
                template_commitment: bytes(bytes32("b")),
                parent_factory_occurrence_id:
                  "41000000-0000-4000-8000-000000000003",
                parent_factory_release_binding_id:
                  "21000000-0000-4000-8000-000000000001",
                parent_factory_binding_commitment: bytes(bytes32("5")),
              },
            ] as unknown as Row[];
          }
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
              normalized_runtime_code_hash: bytes(
                this.classicNormalizedRuntimeCodeHash,
              ),
              expected_instance_runtime_code_hash: null,
              runtime_code_length: "200",
              immutable_references_commitment: bytes(
                this.classicImmutableReferencesCommitment,
              ),
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
        if (text.includes("get_current_provisional_dynamic_sources_v1")) {
          return this.provisionalRows as unknown as Row[];
        }
        if (
          text.includes(
            "get_current_provisional_activation_boundaries_v1",
          )
        ) {
          return this.provisionalActivationRows as unknown as Row[];
        }
        if (text.includes("resolve_pending_dynamic_source_activations_v1")) {
          return this.pendingActivationResolutionRows as unknown as Row[];
        }
        if (text.includes("get_projector_reorg_generation_v1")) {
          return [{ generation: "0" }] as unknown as Row[];
        }
        if (text.includes("get_projector_reorg_targets_v1")) {
          return this.reorgTargetRows as unknown as Row[];
        }
        if (text.includes("recover_projector_reorg_v1")) {
          return this.reorgRecoveryRows as unknown as Row[];
        }
        if (
          text.includes("open_run") ||
          text.includes("append_dual_rpc_runtime_code_evidence") ||
          text.includes("stage_verified_dynamic_parents_v2") ||
          text.includes("stage_provisional_parent_receipt_ordinals_v1") ||
          text.includes("append_run_outcome")
        ) {
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("append_or_reuse_safe_head_observation_v1")) {
          return [{
            id: this.reusedSafeHeadObservationId ?? values[0],
          }] as unknown as Row[];
        }
        if (text.includes("append_or_reuse_dual_rpc_block_evidence_v1")) {
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("append_projection_provider_execution_evidence_v1")) {
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

function reorgPlan() {
  return {
    cursor: {
      generation: "7",
      blockNumber: "25650000",
      blockHash: bytes32("7"),
      blockGlobalLogIndex: 9,
      candidateId: `1:${bytes32("7")}:${bytes32("8")}:9`,
      isBlockBoundary: false,
    },
    dynamicSources: [],
    provisionalSourceAddresses: [],
    dynamicSourceTemplates: [],
    database: {
      epochId: "70000000-0000-4000-8000-000000000002",
      pointerGeneration: "1",
      reorgGeneration: "0",
      envioProviderDeploymentId: IDS[0],
      rpcProviderDeploymentIds: [IDS[1], IDS[2]] as const,
    },
  } as const;
}

function reorgRecovery() {
  return {
    action: "rewind-and-replay" as const,
    expectedGeneration: "7",
    nextGeneration: "8",
    targetHistoryGeneration: "6",
    targetBlockNumber: "25650000",
    targetBlockHash: bytes32("7"),
    targetBlockGlobalLogIndex: 9,
    targetCandidateId: `1:${bytes32("7")}:${bytes32("8")}:9`,
    genesisPointId: null,
    expectedReorgGeneration: "0",
    nextReorgGeneration: "1",
    providerIdentities: [
      "rpc:1:alchemy",
      "rpc:1:quicknode",
    ] as const,
    providerEndpointCommitments: [bytes32("3"), bytes32("5")] as const,
    providerOriginCommitments: [bytes32("4"), bytes32("6")] as const,
    providerBlockHashes: [bytes32("7"), bytes32("7")] as const,
    providerBlockTimestamps: ["1750000000", "1750000000"] as const,
    providerChainIds: [1, 1] as const,
    providerHeads: ["25650020", "25650021"] as const,
    finalityDepth: "12" as const,
    safeBlockNumber: "25650008",
    safeBlockHash: bytes32("9"),
    providerSafeBlockHashes: [bytes32("9"), bytes32("9")] as const,
    checkedDepth: 1,
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
    expect(plan.dynamicSourceTemplates).toMatchObject([
      {
        contractName: "ClassicV3RewardVault",
        parentFactoryContractName: "ClassicV3RewardVaultFactory",
        factoryEventName: "ClassicRewardVaultDeployed",
        database: {
          scope: { releaseId: "classic-v3" },
          reorgGeneration: "0",
        },
      },
    ]);
  });

  it("rejects runtime state without an explicit reorg generation", async () => {
    const executor = new StoreExecutor();
    executor.omitReorgGeneration = true;
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
    });

    await expect(store.readPlan()).rejects.toMatchObject({
      disposition: "fatal-codec-or-caller",
    });
  });

  it("reads bounded reorg history together with the registered genesis anchor", async () => {
    const executor = new StoreExecutor();
    executor.reorgTargetRows = [
      {
        target_kind: "history",
        history_generation: "6",
        block_number: "25650000",
        block_hash: bytes(bytes32("7")),
        block_global_log_index: "9",
        candidate_id: `1:${bytes32("7")}:${bytes32("8")}:9`,
        genesis_point_id: null,
        current_reorg_generation: "0",
      },
      {
        target_kind: "genesis",
        history_generation: "0",
        block_number: "0",
        block_hash: bytes(bytes32("1")),
        block_global_log_index: null,
        candidate_id: null,
        genesis_point_id: "70000000-0000-4000-8000-000000000006",
        current_reorg_generation: "0",
      },
    ];
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
    });

    await expect(store.readReorgRecoveryState({
      plan: reorgPlan(),
      maximumDepth: 128,
    })).resolves.toEqual({
      ancestors: [{
        kind: "history",
        historyGeneration: "6",
        blockNumber: "25650000",
        blockHash: bytes32("7"),
        blockGlobalLogIndex: 9,
        candidateId: `1:${bytes32("7")}:${bytes32("8")}:9`,
      }],
      genesis: {
        kind: "genesis",
        historyGeneration: "0",
        genesisPointId: "70000000-0000-4000-8000-000000000006",
        blockNumber: "0",
        blockHash: bytes32("1"),
        blockGlobalLogIndex: null,
        candidateId: null,
      },
      currentReorgGeneration: "0",
    });
    const query = executor.queries.find(({ text }) =>
      text.includes("get_projector_reorg_targets_v1"),
    );
    expect(query?.values).toEqual([IDS[0], "canonical-events", 128]);
  });

  it("persists one CAS-bound recovery and all provider evidence in one transaction", async () => {
    const executor = new StoreExecutor();
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
      uuid: (() => {
        let suffix = 1;
        return () =>
          `62000000-0000-4000-8000-${String(suffix++).padStart(12, "0")}`;
      })(),
      now: () => new Date("2026-08-01T03:00:00.000Z"),
    });

    await expect(store.recoverCanonicalReorg({
      plan: reorgPlan(),
      recovery: reorgRecovery(),
    })).resolves.toEqual({
      generation: "8",
      reorgGeneration: "1",
      releaseCheckpointCount: 5,
    });
    expect(executor.transactionCount).toBe(1);
    const statements = executor.queries.map(({ text }) => text);
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining("assert_projector_runtime_lease_v1"),
      expect.stringContaining("open_run"),
      expect.stringContaining("append_or_reuse_safe_head_observation_v1"),
      expect.stringContaining("append_or_reuse_dual_rpc_block_evidence_v1"),
      expect.stringContaining("append_run_outcome"),
      expect.stringContaining("recover_projector_reorg_v1"),
    ]));
    expect(statements.at(-1)).toContain("recover_projector_reorg_v1");
    const recoveryQuery = executor.queries.at(-1)!;
    expect(recoveryQuery.values.slice(7, 12)).toEqual([
      "7",
      "8",
      "6",
      "0",
      "1",
    ]);
    expect(recoveryQuery.values.slice(17, 19)).toEqual([
      RUNTIME_FENCE.holderId,
      RUNTIME_FENCE.generation,
    ]);
    expect(
      Buffer.from(recoveryQuery.values[19] as Uint8Array),
    ).toEqual(bytes(RUNTIME_FENCE.tokenHash));
  });

  it("rejects a recovery result that does not advance every release checkpoint", async () => {
    const executor = new StoreExecutor();
    executor.reorgRecoveryRows = [{
      cursor_generation: "8",
      reorg_generation: "1",
      release_checkpoint_count: "4",
    }];
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
    });

    await expect(store.recoverCanonicalReorg({
      plan: reorgPlan(),
      recovery: reorgRecovery(),
    })).rejects.toMatchObject({ disposition: "fatal-codec-or-caller" });
  });

  it("keeps historical Stock lineage readable without exposing a Stock discovery template", async () => {
    const executor = new StoreExecutor();
    executor.includeHistoricalStock = true;
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
    });

    const plan = await store.readPlan();

    expect(plan.dynamicSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attestationId: "41000000-0000-4000-8000-000000000001",
          contractName: "StockV1RewardVault",
          releaseVersion: "stock-paired-v1",
        }),
      ]),
    );
    expect(plan.dynamicSourceTemplates).toHaveLength(1);
    expect(plan.dynamicSourceTemplates[0]?.contractName).toBe(
      "ClassicV3RewardVault",
    );
  });

  it("carries an exact current Classic provisional lineage into dynamic coverage", async () => {
    const executor = new StoreExecutor();
    executor.provisionalRows = [
      {
        provisional_page_id: "42000000-0000-4000-8000-000000000001",
        provisional_lineage_id: "42000000-0000-4000-8000-000000000002",
        release_epoch_id: "70000000-0000-4000-8000-000000000010",
        release_pointer_generation: "1",
        ingestion_epoch_id: "70000000-0000-4000-8000-000000000002",
        ingestion_pointer_generation: "1",
        reorg_generation: "0",
        snapshot_block_number: "25650001",
        snapshot_block_hash: bytes(bytes32("d")),
        expected_cursor_generation: "7",
        expected_cursor_block_hash: bytes(bytes32("7")),
        envio_provider_deployment_id: IDS[0],
        rpc_provider_a_id: IDS[1],
        rpc_provider_b_id: IDS[2],
        provisional_coverage_commitment: bytes(bytes32("1")),
        runtime_code_evidence_id:
          "42000000-0000-4000-8000-000000000003",
        dynamic_source_template_id:
          "30000000-0000-4000-8000-000000000001",
        dynamic_source_attestation_id:
          "42000000-0000-4000-8000-000000000004",
        deployed_source_address: bytes(address("f")),
        contract_name: "ClassicV3RewardVault",
        model: "classic",
        release_version: "classic-v3",
        factory_address: bytes(
          "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a",
        ),
        factory_contract_name: "ClassicV3RewardVaultFactory",
        factory_candidate_id: `1:${bytes32("d")}:${bytes32("e")}:4`,
        factory_block_number: "25650001",
        factory_block_hash: bytes(bytes32("d")),
        factory_block_global_log_index: "4",
        parent_candidate_commitment: bytes(bytes32("2")),
        expected_exact_runtime_code_hash: bytes(bytes32("6")),
        expected_normalized_runtime_code_hash: bytes(bytes32("e")),
        expected_immutable_references_commitment: bytes(bytes32("f")),
        expected_runtime_byte_length: "200",
        immutable_references: [{ start: "4", length: "20" }],
        staged_at: "2026-08-01T02:00:00.000Z",
      },
    ];
    executor.provisionalActivationRows = [
      {
        provisional_lineage_id:
          "42000000-0000-4000-8000-000000000002",
        dynamic_source_attestation_id:
          "42000000-0000-4000-8000-000000000004",
        deployed_source_address: bytes(address("f")),
        activation_candidate_id:
          `1:${bytes32("d")}:${bytes32("e")}:10`,
        activation_occurrence_id:
          "42000000-0000-4000-8000-000000000005",
        activation_block_number: "25650001",
        activation_block_hash: bytes(bytes32("d")),
        activation_block_global_log_index: "10",
      },
    ];
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
    });

    const plan = await store.readPlan();

    expect(plan.dynamicSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceAddress: address("f"),
          contractName: "ClassicV3RewardVault",
          factoryBlockNumber: "25650001",
          activationBlockNumber: "25650001",
          activationBlockGlobalLogIndex: "10",
        }),
      ]),
    );
    expect(plan.provisionalSourceAddresses).toEqual([address("f")]);
  });

  it("retains a future lineage across a cursor advance but rejects it after its block", async () => {
    const executor = new StoreExecutor();
    executor.provisionalRows = [
      {
        provisional_page_id: "42000000-0000-4000-8000-000000000001",
        provisional_lineage_id: "42000000-0000-4000-8000-000000000002",
        release_epoch_id: "70000000-0000-4000-8000-000000000010",
        release_pointer_generation: "1",
        ingestion_epoch_id: "70000000-0000-4000-8000-000000000002",
        ingestion_pointer_generation: "1",
        reorg_generation: "0",
        snapshot_block_number: "25650001",
        snapshot_block_hash: bytes(bytes32("d")),
        expected_cursor_generation: "6",
        expected_cursor_block_hash: bytes(bytes32("7")),
        envio_provider_deployment_id: IDS[0],
        rpc_provider_a_id: IDS[1],
        rpc_provider_b_id: IDS[2],
        provisional_coverage_commitment: bytes(bytes32("1")),
        runtime_code_evidence_id:
          "42000000-0000-4000-8000-000000000003",
        dynamic_source_template_id:
          "30000000-0000-4000-8000-000000000001",
        dynamic_source_attestation_id:
          "42000000-0000-4000-8000-000000000004",
        deployed_source_address: bytes(address("f")),
        contract_name: "ClassicV3RewardVault",
        model: "classic",
        release_version: "classic-v3",
        factory_address: bytes(
          "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a",
        ),
        factory_contract_name: "ClassicV3RewardVaultFactory",
        factory_candidate_id: `1:${bytes32("d")}:${bytes32("e")}:4`,
        factory_block_number: "25650001",
        factory_block_hash: bytes(bytes32("d")),
        factory_block_global_log_index: "4",
        parent_candidate_commitment: bytes(bytes32("2")),
        expected_exact_runtime_code_hash: bytes(bytes32("6")),
        expected_normalized_runtime_code_hash: bytes(bytes32("e")),
        expected_immutable_references_commitment: bytes(bytes32("f")),
        expected_runtime_byte_length: "200",
        immutable_references: [{ start: "4", length: "20" }],
        staged_at: "2026-08-01T02:00:00.000Z",
      },
    ];
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
    });

    await expect(store.readPlan()).resolves.toMatchObject({
      provisionalSourceAddresses: [address("f")],
    });

    executor.cursorBlockNumber = "25650002";
    await expect(store.readPlan()).rejects.toMatchObject({
      disposition: "fatal-codec-or-caller",
    });
  });

  it("resolves pending activations across more than one candidate page", async () => {
    const executor = new StoreExecutor();
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
    });
    const plan = await store.readPlan();
    executor.queries.splice(0);

    await expect(
      store.resolvePendingDynamicSourceActivations({
        expectedCursorGeneration: plan.cursor.generation,
        expectedCursorBlockHash: plan.cursor.blockHash,
        expectedReorgGeneration: plan.database.reorgGeneration,
        candidates: Array.from({ length: 33 }, candidate),
      }),
    ).resolves.toEqual([]);

    expect(
      executor.queries.some(({ text }) =>
        text.includes("resolve_pending_dynamic_source_activations_v1")
      ),
    ).toBe(true);
  });

  it("defers a staged activation until its parent enters the candidate window", async () => {
    const executor = new StoreExecutor();
    executor.pendingActivationResolutionRows = [{
      parent_candidate_id: `1:${bytes32("a")}:${bytes32("b")}:11`,
    }];
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
    });
    const plan = await store.readPlan();

    await expect(
      store.resolvePendingDynamicSourceActivations({
        expectedCursorGeneration: plan.cursor.generation,
        expectedCursorBlockHash: plan.cursor.blockHash,
        expectedReorgGeneration: plan.database.reorgGeneration,
        candidates: [candidate()],
      }),
    ).resolves.toEqual([]);
  });

  it("ignores a permissionless vault deployment without a launcher event", async () => {
    const executor = new StoreExecutor();
    const parentCandidateId = `1:${bytes32("d")}:${bytes32("e")}:10`;
    executor.pendingActivationResolutionRows = [{
      parent_candidate_id: parentCandidateId,
      source_address: bytes(address("f")),
      dynamic_source_template_id:
        "30000000-0000-4000-8000-000000000001",
      release_epoch_id: "70000000-0000-4000-8000-000000000010",
      release_pointer_generation: "1",
      reorg_generation: "0",
      parent_receipt_log_ordinal: "10",
    }];
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
    });
    const plan = await store.readPlan();
    const template = plan.dynamicSourceTemplates[0]!;
    const parent: EnvioCandidate = {
      ...candidate(),
      candidateId: parentCandidateId,
      sourceAddress: template.parentFactoryAddress,
      contractName: template.parentFactoryContractName,
      eventName: template.factoryEventName,
      decodedPayload: {
        vault: address("f"),
        configurationCommitment: bytes32("9"),
      },
    };

    await expect(
      store.resolvePendingDynamicSourceActivations({
        expectedCursorGeneration: plan.cursor.generation,
        expectedCursorBlockHash: plan.cursor.blockHash,
        expectedReorgGeneration: plan.database.reorgGeneration,
        candidates: [parent],
      }),
    ).resolves.toEqual([]);
  });

  it("stages one exact Classic parent and runtime without advancing the ingestion cursor", async () => {
    const executor = new StoreExecutor();
    const sourceAddress = address("f");
    const rawRuntimeBytes = Buffer.alloc(200, 0x60);
    bytes(sourceAddress).copy(rawRuntimeBytes, 4);
    const rawRuntimeCode = `0x${rawRuntimeBytes.toString("hex")}` as const;
    const canonicalRuntimeEvidence = runtimeBytecodeEvidence({
      runtimeBytecode: rawRuntimeCode,
      expectedByteLength: 200,
      immutableReferences: [{ start: 4, length: 20 }],
    });
    executor.classicNormalizedRuntimeCodeHash =
      canonicalRuntimeEvidence.normalizedRuntimeCodeHash;
    executor.classicImmutableReferencesCommitment =
      canonicalRuntimeEvidence.immutableReferencesCommitment;
    const store = createPostgresProjectorStore({
      executor,
      providers: PROVIDERS,
      releaseScopes: RELEASE_SCOPES,
      runtimeFence: RUNTIME_FENCE,
      now: () => new Date("2026-08-01T02:00:00.000Z"),
    });
    const plan = await store.readPlan();
    executor.queries.splice(0);
    const template = plan.dynamicSourceTemplates[0]!;
    const runtimeCodeHash = keccak256(rawRuntimeCode);
    const immutableValuesCommitment = keccak256(
      concat([
        toBytes("programmable:data-pipeline:immutable-values:v1\0"),
        encodeAbiParameters([{ type: "bytes[]" }], [[sourceAddress]]),
      ]),
    );
    const parent: EnvioCandidate = {
      candidateId: `1:${bytes32("d")}:${bytes32("e")}:10`,
      chainId: 1,
      blockNumber: "25650001",
      blockHash: bytes32("d"),
      blockTimestamp: "1750000000",
      transactionHash: bytes32("e"),
      transactionIndex: 2,
      blockGlobalLogIndex: 10,
      sourceAddress: template.parentFactoryAddress,
      contractName: template.parentFactoryContractName,
      eventName: template.factoryEventName,
      releaseHint: { model: "classic", releaseVersion: "classic-v3" },
      orderedTopics: [bytes32("f")],
      rawData: "0x",
      decodedPayload: {
        vault: sourceAddress,
        configurationCommitment: bytes32("9"),
      },
      payloadHash: bytes32("1"),
    };
    const evidence: DualRpcCandidateWindowEvidence = {
      chainId: 1,
      providerIdentities: ["alchemy", "quicknode"],
      providerVendorGroups: ["alchemy", "quicknode"],
      providerEndpointCommitments: [bytes32("3"), bytes32("4")],
      providerOriginCommitments: [bytes32("5"), bytes32("6")],
      providerHeads: ["25650020", "25650021"],
      safeBlockNumber: "25650008",
      safeBlockHash: bytes32("9"),
      executionTrace: projectionExecutionTrace,
      candidates: [
        {
          chainId: 1,
          candidateId: parent.candidateId,
          sourceAddress: parent.sourceAddress,
          contractName: parent.contractName,
          eventName: parent.eventName,
          sourceKind: "static",
          model: "classic",
          releaseVersion: "classic-v3",
          payloadHash: parent.payloadHash,
          rawLogCommitment: bytes32("2"),
          providerIdentities: ["alchemy", "quicknode"],
          providerVendorGroups: ["alchemy", "quicknode"],
          providerEndpointCommitments: [bytes32("3"), bytes32("4")],
          providerOriginCommitments: [bytes32("5"), bytes32("6")],
          providerHeads: ["25650020", "25650021"],
          safeBlockNumber: "25650008",
          safeBlockHash: bytes32("9"),
          candidateBlockNumber: parent.blockNumber,
          candidateBlockHash: parent.blockHash,
          candidateBlockTimestamp: parent.blockTimestamp,
          transactionHash: parent.transactionHash,
          transactionIndex: parent.transactionIndex,
          receiptCommitment: bytes32("7"),
          sourceCodeHash: bytes32("8"),
          receiptLogOrdinal: 0,
        },
      ],
      coveredCandidateCount: 1,
      coverage: {
        fromBlockNumber: parent.blockNumber,
        throughBlockNumber: parent.blockNumber,
        throughBlockHash: parent.blockHash,
        throughBlockGlobalLogIndex: String(0xffff_ffff),
        filterCommitment: bytes32("a"),
        providerLogCommitments: [bytes32("2"), bytes32("2")],
      },
    };
    const runtimeObservation = {
      chainId: 1 as const,
      parentCandidateId: parent.candidateId,
      sourceAddress,
      deploymentBlockNumber: parent.blockNumber,
      deploymentBlockHash: parent.blockHash,
      providerIdentities: ["alchemy", "quicknode"] as const,
      providerVendorGroups: ["alchemy", "quicknode"] as const,
      providerEndpointCommitments: [bytes32("3"), bytes32("4")] as const,
      providerOriginCommitments: [bytes32("5"), bytes32("6")] as const,
      rawRuntimeCodeA: rawRuntimeCode,
      rawRuntimeCodeB: rawRuntimeCode,
      runtimeCodeHashA: runtimeCodeHash,
      runtimeCodeHashB: runtimeCodeHash,
      normalizedRuntimeCodeHashA:
        template.expectedNormalizedRuntimeCodeHash,
      normalizedRuntimeCodeHashB:
        template.expectedNormalizedRuntimeCodeHash,
      runtimeByteLengthA: "200",
      runtimeByteLengthB: "200",
      immutableReferences: template.immutableReferences,
      immutableReferencesCommitment:
        template.expectedImmutableReferencesCommitment,
      immutableValues: [sourceAddress],
      immutableValuesCommitment,
      reconstructedRuntimeCode: rawRuntimeCode,
      reconstructedRuntimeCodeHash: runtimeCodeHash,
      factoryConfigurationCommitment: bytes32("9"),
      deferredAllocationEvidenceCommitment: null,
      template,
      startedAtMs: 1,
      completedAtMs: 2,
      elapsedMs: 1,
      hardDeadlineMs: 75_000,
      providerCallCounts: [1, 1] as const,
    };
    const stageInput = {
      plan,
      snapshotBlock: parent.blockNumber,
      candidates: [parent],
      evidence,
      runtimeObservations: [runtimeObservation],
      blockComplete: false,
    } as const;

    await expect(
      store.stageVerifiedDynamicParents({
        ...stageInput,
        runtimeObservations: [{
          ...runtimeObservation,
          immutableValuesCommitment: bytes32("8"),
        }],
      }),
    ).rejects.toMatchObject({ disposition: "fatal-codec-or-caller" });
    expect(
      executor.queries.some(({ text }) => text.includes("open_run")),
    ).toBe(false);

    await expect(
      store.stageVerifiedDynamicParents(stageInput),
    ).resolves.toBeUndefined();

    const statements = executor.queries.map(({ text }) => text);
    expect(statements.some((text) =>
      text.includes("append_dual_rpc_runtime_code_evidence"),
    )).toBe(true);
    const runtimeWrite = executor.queries.find(({ text }) =>
      text.includes("append_dual_rpc_runtime_code_evidence"),
    );
    expect(runtimeWrite?.values).toHaveLength(24);
    expect(Buffer.from(runtimeWrite?.values[2] as Uint8Array)).toEqual(
      bytes(sourceAddress),
    );
    expect(runtimeWrite?.values[4]).toBe(IDS[1]);
    expect(runtimeWrite?.values[5]).toBe(IDS[2]);
    expect(runtimeWrite?.values[10]).toBe("200");
    expect(runtimeWrite?.values[11]).toBe("200");
    expect(
      (runtimeWrite?.values[15] as readonly Uint8Array[]).map((value) =>
        Buffer.from(value)
      ),
    ).toEqual([bytes(sourceAddress)]);
    expect(Buffer.from(runtimeWrite?.values[16] as Uint8Array)).toEqual(
      bytes(immutableValuesCommitment),
    );
    expect(runtimeWrite?.values[22]).toEqual(runtimeWrite?.values[21]);
    const stage = executor.queries.find(({ text }) =>
      text.includes("stage_verified_dynamic_parents_v2"),
    );
    expect(stage?.values[22]).toMatchObject({
      kind: "programmable-postgres-json-v1",
    });
    expect(stage?.values[24]).toMatchObject({
      kind: "programmable-postgres-json-v1",
    });
    expect(stage?.values[25]).toMatchObject({
      kind: "programmable-postgres-json-v1",
    });
    expect(stage?.values).toHaveLength(27);
    expect(stage?.values.slice(2, 10)).toEqual([
      "classic-v3",
      "classic",
      "core",
      "projector-v1",
      "70000000-0000-4000-8000-000000000010",
      "1",
      "0",
      "7",
    ]);
    expect(stage?.values[11]).toBe(IDS[0]);
    expect(stage?.values[12]).toBe("canonical-events");
    expect(stage?.values.slice(13, 15)).toEqual([IDS[1], IDS[2]]);
    expect(stage?.values[17]).toBe(parent.blockNumber);
    expect(
      (stage?.values[20] as readonly Uint8Array[]).map((value) =>
        Buffer.from(value)
      ),
    ).toEqual([bytes(bytes32("2"))]);
    expect(stage?.values[21]).toEqual(stage?.values[20]);
    expect(statements.some((text) =>
      text.includes("commit_envio_ingestion_page_v1"),
    )).toBe(false);
    expect(statements.at(-1)).toContain("append_run_outcome");
  });

  it("opens evidence and commits one verified page in a single final transaction", async () => {
    const executor = new StoreExecutor();
    executor.reusedSafeHeadObservationId =
      "49000000-0000-4000-8000-000000000001";
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
      provisionalSourceAddresses: [],
      dynamicSourceTemplates: [],
      database: {
        epochId: "70000000-0000-4000-8000-000000000002",
        pointerGeneration: "1",
        reorgGeneration: "0",
        envioProviderDeploymentId: IDS[0],
        rpcProviderDeploymentIds: [IDS[1], IDS[2]] as const,
      },
    };
    const first = candidate();
    const second: EnvioCandidate = {
      ...candidate(),
      candidateId: `1:${bytes32("c")}:${bytes32("b")}:11`,
      blockNumber: "25650002",
      blockHash: bytes32("c"),
      blockTimestamp: "1750000012",
      transactionHash: bytes32("b"),
      transactionIndex: 0,
      blockGlobalLogIndex: 11,
      payloadHash: bytes32("2"),
    };
    const firstRawLogCommitment = bytes32("2");
    const secondRawLogCommitment = bytes32("1");
    const evidence: DualRpcCandidateWindowEvidence = {
      chainId: 1,
      providerIdentities: ["alchemy", "quicknode"],
      providerVendorGroups: ["alchemy", "quicknode"],
      providerEndpointCommitments: [bytes32("3"), bytes32("4")],
      providerOriginCommitments: [bytes32("5"), bytes32("6")],
      providerHeads: ["25650020", "25650021"],
      safeBlockNumber: "25650008",
      safeBlockHash: bytes32("9"),
      executionTrace: executionTrace(2),
      candidates: [
        {
          chainId: 1,
          candidateId: first.candidateId,
          sourceAddress: first.sourceAddress,
          contractName: first.contractName,
          eventName: first.eventName,
          sourceKind: "static",
          model: "classic",
          releaseVersion: "classic-v3",
          payloadHash: first.payloadHash,
          rawLogCommitment: firstRawLogCommitment,
          providerIdentities: ["alchemy", "quicknode"],
          providerVendorGroups: ["alchemy", "quicknode"],
          providerEndpointCommitments: [bytes32("3"), bytes32("4")],
          providerOriginCommitments: [bytes32("5"), bytes32("6")],
          providerHeads: ["25650020", "25650021"],
          safeBlockNumber: "25650008",
          safeBlockHash: bytes32("9"),
          candidateBlockNumber: first.blockNumber,
          candidateBlockHash: first.blockHash,
          candidateBlockTimestamp: first.blockTimestamp,
          transactionHash: first.transactionHash,
          transactionIndex: first.transactionIndex,
          receiptCommitment: bytes32("7"),
          sourceCodeHash: bytes32("8"),
          receiptLogOrdinal: 0,
        },
        {
          chainId: 1,
          candidateId: second.candidateId,
          sourceAddress: second.sourceAddress,
          contractName: second.contractName,
          eventName: second.eventName,
          sourceKind: "static",
          model: "classic",
          releaseVersion: "classic-v3",
          payloadHash: second.payloadHash,
          rawLogCommitment: secondRawLogCommitment,
          providerIdentities: ["alchemy", "quicknode"],
          providerVendorGroups: ["alchemy", "quicknode"],
          providerEndpointCommitments: [bytes32("3"), bytes32("4")],
          providerOriginCommitments: [bytes32("5"), bytes32("6")],
          providerHeads: ["25650020", "25650021"],
          safeBlockNumber: "25650008",
          safeBlockHash: bytes32("9"),
          candidateBlockNumber: second.blockNumber,
          candidateBlockHash: second.blockHash,
          candidateBlockTimestamp: second.blockTimestamp,
          transactionHash: second.transactionHash,
          transactionIndex: second.transactionIndex,
          receiptCommitment: bytes32("6"),
          sourceCodeHash: bytes32("8"),
          receiptLogOrdinal: 0,
        },
      ],
      coveredCandidateCount: 2,
      coverage: {
        fromBlockNumber: plan.cursor.blockNumber,
        throughBlockNumber: second.blockNumber,
        throughBlockHash: second.blockHash,
        throughBlockGlobalLogIndex: "11",
        filterCommitment: bytes32("a"),
        providerLogCommitments: [bytes32("b"), bytes32("b")],
      },
    };

    await expect(
      store.commitVerifiedPage({
        plan,
        snapshotBlock: second.blockNumber,
        candidates: [first, second],
        evidence,
        blockComplete: true,
      }),
    ).resolves.toEqual({ generation: "8" });

    const statements = executor.queries.map(({ text }) => text);
    expect(statements.some((text) => text.includes("open_run"))).toBe(true);
    expect(
      statements.some((text) =>
        text.includes("append_or_reuse_safe_head_observation_v1")
      ),
    ).toBe(true);
    expect(statements.some((text) => text.includes("append_or_reuse_dual_rpc_block_evidence_v1"))).toBe(true);
    const blockWrites = executor.queries.filter(({ text }) =>
      text.includes("append_or_reuse_dual_rpc_block_evidence_v1"),
    );
    expect(blockWrites.map(({ values }) => values[3])).toEqual([
      first.blockNumber,
      second.blockNumber,
    ]);
    expect(blockWrites.every(({ values }) =>
      values[1] === executor.reusedSafeHeadObservationId
    )).toBe(true);
    expect(statements.at(-1)).toContain("commit_envio_ingestion_page_v1");
    const commit = executor.queries.at(-1)!;
    expect(commit.values[9]).toBe(executor.reusedSafeHeadObservationId);
    expect(
      commit.values.some(
        (value) =>
          Array.isArray(value) &&
          value.some(
            (item) =>
              item instanceof Uint8Array &&
              `0x${Buffer.from(item).toString("hex")}` ===
                firstRawLogCommitment,
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
      provisionalSourceAddresses: [],
      dynamicSourceTemplates: [],
      database: {
        epochId: "70000000-0000-0000-0000-000000000002",
        pointerGeneration: "1",
        reorgGeneration: "0",
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
        blockComplete: true,
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
    expect(commit.values[8]).toEqual({
      kind: "programmable-postgres-json-v1",
      value: [],
    });
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
  readonly decisionIds = new Map<string, string>();
  candidateRows: readonly Record<string, unknown>[] | null = null;
  checkpointRow: Record<string, unknown> | null = null;
  manifestRow: Record<string, unknown> | null = null;
  dynamicRows: readonly Record<string, unknown>[] | null = null;
  poolBaselineRow: Record<string, unknown> | null = null;
  rewardStateActiveRows: readonly Record<string, unknown>[] | null = null;
  rewardStateBalanceRows: readonly Record<string, unknown>[] | null = null;
  ingestionCursorRow: Record<string, unknown> | null = null;
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
            checkpoint_id: this.checkpointRow?.checkpoint_id ?? null,
            checkpoint_generation:
              this.checkpointRow?.checkpoint_generation ?? "0",
            reorg_generation: "0",
            checkpoint_block_number:
              this.checkpointRow?.checkpoint_block_number ?? null,
            checkpoint_block_hash:
              this.checkpointRow?.checkpoint_block_hash ?? null,
            checkpoint_cursor_block_global_log_index:
              this.checkpointRow?.checkpoint_cursor_block_global_log_index ??
              null,
            checkpoint_cursor_candidate_id:
              this.checkpointRow?.checkpoint_cursor_candidate_id ?? null,
          }] as unknown as Row[];
        }
        if (text.includes("get_envio_ingestion_cursor_v1")) {
          if (this.ingestionCursorRow) {
            return [this.ingestionCursorRow] as unknown as Row[];
          }
          const terminal = this.candidateRows?.at(-1);
          return [{
            generation: "8",
            block_number: terminal?.block_number ?? "25650001",
            block_hash: terminal?.block_hash ?? bytes(bytes32("d")),
            block_global_log_index: null,
            candidate_id: null,
          }] as unknown as Row[];
        }
        if (text.includes("acquire_projector_lease")) {
          this.leaseGeneration = "1";
          return [{ acquired: true }] as unknown as Row[];
        }
        if (text.includes("get_projector_release_manifest_v1")) {
          if (this.manifestRow) {
            return [this.manifestRow] as unknown as Row[];
          }
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
          return (this.dynamicRows ?? []) as unknown as Row[];
        }
        if (text.includes("list_projector_candidate_page_v1")) {
          if (this.candidateRows) {
            const afterCandidateId = values[11];
            const limit = Number(values[12]);
            const afterIndex = afterCandidateId === null
              ? -1
              : this.candidateRows.findIndex(
                (row) => row.candidate_id === afterCandidateId,
              );
            return this.candidateRows.slice(
              afterIndex + 1,
              afterIndex + 1 + limit,
            ) as unknown as Row[];
          }
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
        if (text.includes("append_or_reuse_safe_head_observation_v1")) {
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("append_or_reuse_dual_rpc_block_evidence_v1")) {
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("append_projection_provider_execution_evidence_v1")) {
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("get_projector_pool_baseline_by_id_v1")) {
          return (this.poolBaselineRow ? [this.poolBaselineRow] : []) as unknown as Row[];
        }
        if (text.includes("get_projector_reward_state_by_vault_v1")) {
          return (this.rewardStateActiveRows ?? []) as unknown as Row[];
        }
        if (text.includes("get_projector_reward_balances_by_vault_v1")) {
          return (this.rewardStateBalanceRows ?? []) as unknown as Row[];
        }
        if (text.includes("resolve_envio_candidate")) {
          this.decisionIds.set(String(values[2]), String(values[0]));
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("append_chain_event_occurrence")) {
          return [{ id: values[1] }] as unknown as Row[];
        }
        if (
          text.includes("append_creator_fee_checkpoint_fact") ||
          text.includes("stage_current_reward_snapshot_v2") ||
          text.includes("append_reward_snapshot_provider_evidence_v1")
        ) {
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("get_staged_reward_folded_commitment_v1")) {
          return [{ commitment: bytes(bytes32("c")) }] as unknown as Row[];
        }
        if (text.includes("ignore_envio_candidate_v1")) {
          this.decisionId = String(values[0]);
          this.decisionIds.set(String(values[2]), String(values[0]));
          return [{ id: values[0] }] as unknown as Row[];
        }
        if (text.includes("list_projector_candidate_dispositions_v1")) {
          if (this.candidateRows) {
            const afterCandidateId = values[11];
            const limit = Number(values[12]);
            const afterIndex = afterCandidateId === null
              ? -1
              : this.candidateRows.findIndex(
                (row) => row.candidate_id === afterCandidateId,
              );
            return this.candidateRows
              .slice(afterIndex + 1, afterIndex + 1 + limit)
              .map((row) => ({
                candidate_id: row.candidate_id,
                block_number: row.block_number,
                block_hash: row.block_hash,
                transaction_hash: row.transaction_hash,
                transaction_index: row.transaction_index,
                block_global_log_index: row.block_global_log_index,
                status: "ignored",
                attempt_count: "0",
                decision_id: this.decisionIds.get(String(row.candidate_id)),
                reason_code: "outside-release-manifest",
                reason_commitment: bytes(bytes32("3")),
                changed_at: "2026-07-31T18:00:00.000Z",
              })) as unknown as Row[];
          }
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
        if (text.includes("promote_projection_run_v3")) {
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
  it("completes a transaction larger than 32 rows and advances to the following transaction", async () => {
    const executor = new ReleaseProjectionExecutor();
    const blockHash = bytes32("d");
    const firstTransactionHash = bytes32("e");
    const candidateRow = (
      index: number,
      transactionHash: `0x${string}`,
      transactionIndex: number,
      candidateBlockHash: `0x${string}` = blockHash,
      candidateBlockNumber = "25650001",
    ) => ({
      candidate_id: `1:${candidateBlockHash}:${transactionHash}:${index}`,
      provider_deployment_id: IDS[0],
      block_number: candidateBlockNumber,
      block_hash: bytes(candidateBlockHash),
      transaction_hash: bytes(transactionHash),
      transaction_index: String(transactionIndex),
      block_global_log_index: String(index),
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
    });
    executor.candidateRows = [
      ...Array.from({ length: 40 }, (_, index) =>
        candidateRow(index, firstTransactionHash, 1)
      ),
      candidateRow(40, bytes32("a"), 2, bytes32("c"), "25650002"),
      candidateRow(41, bytes32("b"), 3, bytes32("c"), "25650002"),
    ];
    let sequence = 1;
    const store = createPostgresReleaseProjectionStore({
      executor,
      providers: PROVIDERS,
      rpcEvidenceBindings: RPC_EVIDENCE_BINDINGS,
      scope: {
        releaseId: "classic-v2",
        modelId: "classic",
        sourceGroup: "core",
      },
      runtimeFence: RUNTIME_FENCE,
      uuid: () =>
        `81000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
      now: () => new Date("2026-07-31T18:00:00.000Z"),
    });

    const oversized = await store.readProjectionPlan();
    expect(oversized).toMatchObject({ batchKind: "oversized-transaction" });
    expect(oversized?.entries).toHaveLength(40);
    expect(
      new Set(oversized?.entries.map(({ candidate }) =>
        candidate.transactionHash
      )),
    ).toEqual(new Set([firstTransactionHash]));

    const terminal = oversized!.entries.at(-1)!.candidate;
    executor.checkpointRow = {
      checkpoint_id: "82000000-0000-4000-8000-000000000001",
      checkpoint_generation: "1",
      checkpoint_block_number: terminal.blockNumber,
      checkpoint_block_hash: bytes(terminal.blockHash),
      checkpoint_cursor_block_global_log_index:
        String(terminal.blockGlobalLogIndex),
      checkpoint_cursor_candidate_id: terminal.candidateId,
    };
    const following = await store.readProjectionPlan();
    expect(following).toMatchObject({ batchKind: "normal" });
    expect(following?.entries.map(({ candidate }) =>
      candidate.blockGlobalLogIndex
    )).toEqual([40, 41]);
  });

  it("trims a normal page to a provider block terminal", async () => {
    const executor = new ReleaseProjectionExecutor();
    const firstBlockHash = bytes32("c");
    const secondBlockHash = bytes32("d");
    const candidateRow = (
      index: number,
      blockHash: `0x${string}`,
      blockNumber: string,
    ) => ({
      candidate_id: `1:${blockHash}:${bytes32(String(index % 10))}:${index}`,
      provider_deployment_id: IDS[0],
      block_number: blockNumber,
      block_hash: bytes(blockHash),
      transaction_hash: bytes(bytes32(String(index % 10))),
      transaction_index: String(index),
      block_global_log_index: String(index),
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
    });
    executor.candidateRows = [
      ...Array.from({ length: 20 }, (_value, index) =>
        candidateRow(index, firstBlockHash, "25650001")
      ),
      ...Array.from({ length: 20 }, (_value, index) =>
        candidateRow(index + 20, secondBlockHash, "25650002")
      ),
    ];
    const store = createPostgresReleaseProjectionStore({
      executor,
      providers: PROVIDERS,
      rpcEvidenceBindings: RPC_EVIDENCE_BINDINGS,
      scope: {
        releaseId: "classic-v2",
        modelId: "classic",
        sourceGroup: "core",
      },
      runtimeFence: RUNTIME_FENCE,
      uuid: () => "81500000-0000-4000-8000-000000000001",
      now: () => new Date("2026-07-31T18:00:00.000Z"),
    });

    const plan = await store.readProjectionPlan();
    expect(plan).toMatchObject({ batchKind: "normal" });
    expect(plan?.entries).toHaveLength(20);
    expect(new Set(plan?.entries.map(({ candidate }) => candidate.blockHash)))
      .toEqual(new Set([firstBlockHash]));
  });

  it("completes an oversized multi-transaction block atomically", async () => {
    const executor = new ReleaseProjectionExecutor();
    const blockHash = bytes32("d");
    executor.candidateRows = Array.from({ length: 40 }, (_value, index) => ({
      candidate_id: `1:${blockHash}:${bytes32(String(index % 10))}:${index}`,
      provider_deployment_id: IDS[0],
      block_number: "25650001",
      block_hash: bytes(blockHash),
      transaction_hash: bytes(bytes32(String(index % 10))),
      transaction_index: String(index),
      block_global_log_index: String(index),
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
    }));
    const store = createPostgresReleaseProjectionStore({
      executor,
      providers: PROVIDERS,
      rpcEvidenceBindings: RPC_EVIDENCE_BINDINGS,
      scope: {
        releaseId: "classic-v2",
        modelId: "classic",
        sourceGroup: "core",
      },
      runtimeFence: RUNTIME_FENCE,
      uuid: () => "81600000-0000-4000-8000-000000000001",
      now: () => new Date("2026-07-31T18:00:00.000Z"),
    });

    const plan = await store.readProjectionPlan();
    expect(plan).toMatchObject({ batchKind: "oversized-block" });
    expect(plan?.entries).toHaveLength(40);
    expect(new Set(plan?.entries.map(({ candidate }) => candidate.blockHash)))
      .toEqual(new Set([blockHash]));
  });

  it.each([500, 501, 4_096])(
    "pages exact dispositions for a %i-candidate atomic transaction",
    async (candidateCount) => {
      const executor = new ReleaseProjectionExecutor();
      const blockHash = bytes32("d");
      const transactionHash = bytes32("e");
      executor.candidateRows = Array.from(
        { length: candidateCount },
        (_value, index) => ({
          candidate_id: `1:${blockHash}:${transactionHash}:${index}`,
          provider_deployment_id: IDS[0],
          block_number: "25650001",
          block_hash: bytes(blockHash),
          transaction_hash: bytes(transactionHash),
          transaction_index: "2",
          block_global_log_index: String(index),
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
        }),
      );
      let sequence = 1;
      const store = createPostgresReleaseProjectionStore({
        executor,
        providers: PROVIDERS,
        rpcEvidenceBindings: RPC_EVIDENCE_BINDINGS,
        scope: {
          releaseId: "classic-v2",
          modelId: "classic",
          sourceGroup: "core",
        },
        runtimeFence: RUNTIME_FENCE,
        uuid: () =>
          `83000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
        now: () => new Date("2026-07-31T18:00:00.000Z"),
      });
      const plan = await store.readProjectionPlan();
      expect(plan).toMatchObject({ batchKind: "oversized-transaction" });
      expect(plan?.entries).toHaveLength(candidateCount);
      const freshCandidates = plan!.entries.map(({ candidate }) => ({
        ...candidate,
        blockTimestamp: "1750000000",
        releaseHint: { model: "unresolved" as const, releaseVersion: "unresolved" },
      }));
      const evidence = {
        chainId: 1 as const,
        providerIdentities: ["alchemy", "quicknode"] as const,
        providerVendorGroups: ["alchemy", "quicknode"] as const,
        providerEndpointCommitments: [bytes32("3"), bytes32("5")] as const,
        providerOriginCommitments: [bytes32("4"), bytes32("6")] as const,
        providerHeads: ["25650020", "25650021"] as const,
        safeBlockNumber: "25650008",
        safeBlockHash: bytes32("9"),
        executionTrace: {
          ...projectionExecutionTrace,
          candidateBatchSize: candidateCount,
        },
        candidates: freshCandidates.map((candidate) => ({
          chainId: 1 as const,
          candidateId: candidate.candidateId,
          sourceAddress: candidate.sourceAddress,
          contractName: candidate.contractName,
          eventName: candidate.eventName,
          sourceKind: "static" as const,
          model: "unresolved" as const,
          releaseVersion: "unresolved",
          payloadHash: candidate.payloadHash,
          rawLogCommitment: bytes32("2"),
          providerIdentities: ["alchemy", "quicknode"] as const,
          providerVendorGroups: ["alchemy", "quicknode"] as const,
          providerEndpointCommitments: [bytes32("3"), bytes32("5")] as const,
          providerOriginCommitments: [bytes32("4"), bytes32("6")] as const,
          providerHeads: ["25650020", "25650021"] as const,
          safeBlockNumber: "25650008",
          safeBlockHash: bytes32("9"),
          candidateBlockNumber: candidate.blockNumber,
          candidateBlockHash: candidate.blockHash,
          candidateBlockTimestamp: candidate.blockTimestamp,
          transactionHash: candidate.transactionHash,
          transactionIndex: candidate.transactionIndex,
          receiptCommitment: bytes32("7"),
          sourceCodeHash: bytes32("8"),
          receiptLogOrdinal: 0,
        })),
      };
      const result = await store.commitVerifiedProjection({
        plan: plan!,
        freshCandidates,
        ignoredCandidateIds: freshCandidates.map(({ candidateId }) =>
          candidateId
        ),
        evidence,
        fold: { occurrences: [], facts: [], launches: [], knownPools: [] },
        rewardSnapshot: null,
      });

      expect(result).toEqual({ checkpointGeneration: "1" });
      const dispositionQueries = executor.queries.filter(({ text }) =>
        text.includes("list_projector_candidate_dispositions_v1")
      );
      expect(dispositionQueries).toHaveLength(Math.ceil(candidateCount / 500));
      expect(dispositionQueries.at(-1)?.values[11]).toBe(
        candidateCount <= 500
          ? null
          : executor.candidateRows[
            Math.floor((candidateCount - 1) / 500) * 500 - 1
          ]?.candidate_id,
      );
    },
    30_000,
  );

  it("atomically checkpoints an irrelevant candidate as ignored", async () => {
    const executor = new ReleaseProjectionExecutor();
    let sequence = 1;
    const store = createPostgresReleaseProjectionStore({
      executor,
      providers: PROVIDERS,
      rpcEvidenceBindings: RPC_EVIDENCE_BINDINGS,
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
        executionTrace: projectionExecutionTrace,
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

    for (const forgedEvidence of [
      {
        ...projection.evidence,
        providerEndpointCommitments: [bytes32("0"), bytes32("5")],
      },
      {
        ...projection.evidence,
        executionTrace: {
          ...projection.evidence.executionTrace,
          calls: projection.evidence.executionTrace.calls.map((call, index) =>
            index === 0
              ? { ...call, providerIdentity: "substituted-provider" }
              : call
          ),
        },
      },
      {
        ...projection.evidence,
        executionTrace: {
          ...projection.evidence.executionTrace,
          candidateBatchSize: 0,
        },
      },
    ]) {
      const queryStart = executor.queries.length;
      await expect(
        store.commitVerifiedProjection({
          ...projection,
          evidence: forgedEvidence,
        } as never),
      ).rejects.toThrow();
      expect(
        executor.queries
          .slice(queryStart)
          .some(({ text }) => text.includes("open_run")),
      ).toBe(false);
    }

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

  it("does not treat an empty candidate fetch as a complete block", async () => {
    const executor = new ReleaseProjectionExecutor();
    const blockHash = bytes32("d");
    const transactionHash = bytes32("e");
    executor.candidateRows = Array.from({ length: 33 }, (_value, index) => ({
      candidate_id: `1:${blockHash}:${transactionHash}:${index}`,
      provider_deployment_id: IDS[0],
      block_number: "25650001",
      block_hash: bytes(blockHash),
      transaction_hash: bytes(transactionHash),
      transaction_index: "1",
      block_global_log_index: String(index),
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
    }));
    executor.ingestionCursorRow = {
      generation: "8",
      block_number: "25650001",
      block_hash: bytes(blockHash),
      block_global_log_index: "32",
      candidate_id: `1:${blockHash}:${transactionHash}:32`,
    };
    let sequence = 1;
    const store = createPostgresReleaseProjectionStore({
      executor,
      providers: PROVIDERS,
      rpcEvidenceBindings: RPC_EVIDENCE_BINDINGS,
      scope: {
        releaseId: "classic-v2",
        modelId: "classic",
        sourceGroup: "core",
      },
      runtimeFence: RUNTIME_FENCE,
      uuid: () =>
        `84000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
      now: () => new Date("2026-07-31T18:00:00.000Z"),
    });

    await expect(store.readProjectionPlan()).resolves.toBeNull();
    expect(
      executor.queries.some(({ text }) => text.includes("open_run")),
    ).toBe(false);
  });

  it("persists a 49-account reward snapshot through the exact v2/v3 contracts", async () => {
    const executor = new ReleaseProjectionExecutor();
    const rewardVault = address("a");
    const poolId = bytes32("6");
    const configurationHash = bytes32("4");
    const blockHash = bytes32("d");
    const transactionHashes = [bytes32("e"), bytes32("f")] as const;
    const eventSignature = bytes32("9");
    const candidateRows = transactionHashes.map((transactionHash, index) => ({
      candidate_id: `1:${blockHash}:${transactionHash}:${10 + index}`,
      provider_deployment_id: IDS[0],
      block_number: "25650001",
      block_hash: bytes(blockHash),
      transaction_hash: bytes(transactionHash),
      transaction_index: String(index + 1),
      block_global_log_index: String(index + 10),
      source_address: bytes(rewardVault),
      event_signature: bytes(eventSignature),
      event_type: "CreatorFeesCheckpointed",
      ordered_topics: [bytes(eventSignature)],
      raw_data: Buffer.alloc(0),
      decoded_payload: {
        poolId,
        configurationEpoch: "1",
        amount: "10",
        totalCreatorFeesReceived: String((index + 1) * 10),
      },
      payload_hash: bytes(bytes32(index === 0 ? "1" : "2")),
      content_commitment: bytes(bytes32(index === 0 ? "3" : "4")),
      contract_name: "ClassicV3RewardVault",
      status: "pending",
      attempt_count: "0",
    }));
    executor.candidateRows = candidateRows;
    executor.manifestRow = {
      epoch_id: "70000000-0000-4000-8000-000000000020",
      pointer_generation: "1",
      epoch_commitment: bytes(bytes32("1")),
      artifact_creation_code_commitment: bytes(bytes32("2")),
      source_bindings: [{
        binding_id: "20000000-0000-4000-8000-000000000001",
        source_name: "ClassicV3RewardVaultFactory",
        source_role: "vault_factory",
        source_type: "ethereum_contract",
        source_address: "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a",
        inclusive_start_block: "25640000",
        abi_event_set_commitment: bytes32("b"),
        binding_commitment: bytes32("c"),
      }],
      dynamic_source_templates: [{
        dynamic_source_template_id:
          "30000000-0000-4000-8000-000000000001",
        parent_factory_release_binding_id:
          "20000000-0000-4000-8000-000000000001",
        parent_factory_binding_commitment: bytes32("c"),
        parent_source_role: "vault_factory",
        factory_event_type: "ClassicRewardVaultDeployed",
        deployed_address_field: "vault",
        deployed_source_role: "reward_vault",
        deployed_artifact_creation_code_commitment: bytes32("d"),
        normalized_runtime_code_hash: bytes32("e"),
        expected_instance_runtime_code_hash: null,
        immutable_references_commitment: bytes32("f"),
        immutable_binding_spec: {
          factoryConfigurationField: "configurationCommitment",
          bindings: [{
            ordinal: "0",
            offset: "4",
            length: "20",
            source: "deployed_address",
            encoding: "address",
          }],
        },
        immutable_binding_commitment: bytes32("1"),
        runtime_code_length: "200",
        abi_event_set_commitment: bytes32("2"),
        template_commitment: bytes32("3"),
      }],
      projection_event_rules: [{
        projection_event_rule_id:
          "30000000-0000-4000-8000-000000000002",
        projection_kind: "creator-fee-checkpoint",
        source_role: "reward_vault",
        event_type: "CreatorFeesCheckpointed",
        rule_commitment: bytes32("4"),
      }],
      launch_completeness_requirements: [],
    };
    executor.dynamicRows = [{
      dynamic_source_attestation_id:
        "40000000-0000-4000-8000-000000000001",
      dynamic_source_template_id:
        "30000000-0000-4000-8000-000000000001",
      runtime_code_evidence_id:
        "40000000-0000-4000-8000-000000000002",
      deployed_source_address: bytes(rewardVault),
      deployed_source_role: "reward_vault",
      deployment_block_number: "25645000",
      runtime_code_hash: bytes(bytes32("5")),
      normalized_runtime_code_hash: bytes(bytes32("e")),
      expected_instance_runtime_code_hash: null,
      runtime_code_length: "200",
      immutable_references_commitment: bytes(bytes32("f")),
      immutable_binding_spec: {
        bindings: [{
          ordinal: "0",
          offset: "4",
          length: "20",
          source: "deployed_address",
          encoding: "address",
        }],
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
      launch_occurrence_id: "40000000-0000-4000-8000-000000000005",
      pool_occurrence_id: "40000000-0000-4000-8000-000000000006",
      token: bytes(address("b")),
      pool_id: bytes(poolId),
      hook: bytes(address("c")),
      quote_asset: bytes(address("d")),
      asset_binding_commitment: bytes(bytes32("7")),
    }];
    executor.poolBaselineRow = {
      pool_projection_id: "50000000-0000-4000-8000-000000000001",
      launch_projection_id: "50000000-0000-4000-8000-000000000002",
      token: bytes(address("b")),
      creator: bytes(address("8")),
      reward_vault: bytes(rewardVault),
      currency0: bytes(address("b")),
      currency1: bytes(address("0")),
      pool_key_fee: "10000",
      tick_spacing: "200",
      hook: bytes(address("c")),
      pool_fee_configuration_id: null,
      buy_swap_fee_bps: null,
      sell_swap_fee_bps: null,
      buy_creator_fee_bps: null,
      sell_creator_fee_bps: null,
      launcher_fee_bps: null,
      transfer_tax_bps: null,
      lp_fee_pips: null,
      last_source_occurrence_id:
        "50000000-0000-4000-8000-000000000003",
    };
    const beneficiary = `0x${"1".padStart(40, "0")}` as `0x${string}`;
    const rewardHeader = {
      chain_id: "1",
      release_id: "classic-v3",
      model_id: "classic",
      source_group: "core",
      epoch_id: "70000000-0000-4000-8000-000000000020",
      pointer_generation: "1",
      checkpoint_id: "51000000-0000-4000-8000-000000000001",
      projector_version: "projector-v1",
      checkpoint_generation: "1",
      reorg_generation: "0",
      checkpoint_block_number: "25650000",
      checkpoint_block_hash: bytes(bytes32("7")),
      reward_vault_projection_id:
        "51000000-0000-4000-8000-000000000002",
      allocation_fact_id: "51000000-0000-4000-8000-000000000003",
      allocation_evidence_id: "51000000-0000-4000-8000-000000000004",
      vault: bytes(rewardVault),
      pool_id: bytes(poolId),
      quote_asset: null,
      configuration_hash: bytes(configurationHash),
      active_configuration_hash: bytes(configurationHash),
      total_creator_fees_received: "0",
      configuration_epoch: "1",
      baseline_projection_run_id:
        "51000000-0000-4000-8000-000000000005",
      baseline_publication_commitment: bytes(bytes32("8")),
      baseline_promoted_block_number: "25650000",
      baseline_promoted_block_hash: bytes(bytes32("7")),
      vault_source_occurrence_id:
        "51000000-0000-4000-8000-000000000006",
      vault_source_logical_event_id:
        "51000000-0000-4000-8000-000000000007",
      vault_source_block_hash: bytes(bytes32("7")),
    };
    executor.rewardStateActiveRows = [{
      ...rewardHeader,
      allocation_index: "0",
      beneficiary: bytes(beneficiary),
      payout_address: bytes(beneficiary),
      share_bps: "10000",
      claimable_accrued: "0",
      claimed_total: "0",
      balance_projection_run_id:
        "51000000-0000-4000-8000-000000000008",
      balance_publication_commitment: bytes(bytes32("8")),
      balance_promoted_block_number: "25650000",
      balance_promoted_block_hash: bytes(bytes32("7")),
      allocation_source_occurrence_id:
        "51000000-0000-4000-8000-000000000009",
      allocation_source_logical_event_id:
        "51000000-0000-4000-8000-000000000010",
      allocation_source_block_hash: bytes(bytes32("7")),
      balance_source_occurrence_id:
        "51000000-0000-4000-8000-000000000011",
      balance_source_logical_event_id:
        "51000000-0000-4000-8000-000000000012",
      balance_source_block_hash: bytes(bytes32("7")),
      verified_at: "2026-07-31T17:00:00.000Z",
    }];
    executor.rewardStateBalanceRows = [{
      ...rewardHeader,
      account_reward_balance_id:
        "52000000-0000-4000-8000-000000000001",
      account: bytes(beneficiary),
      payout_address: bytes(beneficiary),
      payout_source_kind: "initial",
      payout_configuration_epoch: "1",
      claimable_accrued: "0",
      claimed_total: "0",
      balance_projection_run_id:
        "52000000-0000-4000-8000-000000000002",
      balance_publication_commitment: bytes(bytes32("8")),
      balance_promoted_block_number: "25650000",
      balance_promoted_block_hash: bytes(bytes32("7")),
      payout_projection_run_id:
        "52000000-0000-4000-8000-000000000003",
      payout_publication_commitment: bytes(bytes32("8")),
      payout_promoted_block_number: "25650000",
      payout_promoted_block_hash: bytes(bytes32("7")),
      payout_source_occurrence_id:
        "52000000-0000-4000-8000-000000000004",
      payout_source_logical_event_id:
        "52000000-0000-4000-8000-000000000005",
      payout_source_block_hash: bytes(bytes32("7")),
      balance_source_occurrence_id:
        "52000000-0000-4000-8000-000000000006",
      balance_source_logical_event_id:
        "52000000-0000-4000-8000-000000000007",
      balance_source_block_hash: bytes(bytes32("7")),
      verified_at: "2026-07-31T17:00:00.000Z",
    }];

    let sequence = 1;
    const store = createPostgresReleaseProjectionStore({
      executor,
      providers: PROVIDERS,
      rpcEvidenceBindings: RPC_EVIDENCE_BINDINGS,
      scope: {
        releaseId: "classic-v3",
        modelId: "classic",
        sourceGroup: "core",
      },
      runtimeFence: RUNTIME_FENCE,
      uuid: () =>
        `83000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
      now: () => new Date("2026-07-31T18:00:00.000Z"),
    });
    const plan = await store.readProjectionPlan();
    expect(plan).toMatchObject({ batchKind: "reward-block" });
    expect(plan?.entries).toHaveLength(2);

    const freshCandidates = plan!.entries.map(({ candidate }, index) => ({
      ...candidate,
      blockTimestamp: "1750000000",
      releaseHint: {
        model: "classic" as const,
        releaseVersion: "classic-v3",
      },
      decodedPayload: {
        poolId,
        configurationEpoch: "1",
        amount: "10",
        totalCreatorFeesReceived: String((index + 1) * 10),
      },
    }));
    const occurrenceIds = freshCandidates.map((candidate) =>
      projectorOccurrenceUuid({
        transactionHash: candidate.transactionHash,
        receiptLogOrdinal: "0",
        blockHash: candidate.blockHash,
      })
    );
    const baseline = {
      vault: rewardVault,
      poolId,
      configurationEpoch: "1",
      activeConfigurationHash: configurationHash,
      totalCreatorFeesReceived: "0",
      allocations: [{
        allocationIndex: 0,
        beneficiary,
        payoutAddress: beneficiary,
        shareBps: "10000",
      }],
      balances: [{
        account: beneficiary,
        payoutAddress: beneficiary,
        claimableAccrued: "0",
        claimedTotal: "0",
      }],
    } as const;
    const rewardEvents = occurrenceIds.map((occurrenceId, index) => ({
      occurrenceId,
      vault: rewardVault,
      blockNumber: "25650001",
      transactionIndex: String(index + 1),
      blockGlobalLogIndex: String(index + 10),
      kind: "creator-fee-checkpoint" as const,
      values: {
        poolId,
        configurationEpoch: "1",
        amount: "10",
        totalCreatorFeesReceived: String((index + 1) * 10),
      },
    }));
    const rewardSnapshot = foldProjectorRewardState({
      model: "classic-v3",
      baseline,
      events: rewardEvents,
    });
    const occurrences = freshCandidates.map((candidate, index) => ({
      candidateId: candidate.candidateId,
      chainId: "1" as const,
      releaseId: "classic-v3" as const,
      modelId: "classic" as const,
      sourceGroup: "core" as const,
      blockNumber: candidate.blockNumber,
      blockHash: candidate.blockHash,
      blockTimestamp: candidate.blockTimestamp,
      transactionHash: candidate.transactionHash,
      transactionIndex: String(candidate.transactionIndex),
      receiptLogOrdinal: "0",
      blockGlobalLogIndex: String(candidate.blockGlobalLogIndex),
      sourceAddress: candidate.sourceAddress,
      eventSignature,
      eventType: "CreatorFeesCheckpointed",
      orderedTopics: candidate.orderedTopics,
      rawData: candidate.rawData,
      decodedPayload: rewardEvents[index]!.values,
      payloadHash: candidate.payloadHash,
      dynamicSourceAttestationId:
        "40000000-0000-4000-8000-000000000001",
    }));
    const facts = freshCandidates.map((candidate, index) => ({
      sourceCandidateId: candidate.candidateId,
      sourceRole: "reward_vault" as const,
      kind: "creator-fee-checkpoint" as const,
      procedure: "append_creator_fee_checkpoint_fact" as const,
      values: rewardEvents[index]!.values,
    }));
    const candidateEvidence = freshCandidates.map((candidate, index) => ({
      chainId: 1 as const,
      candidateId: candidate.candidateId,
      sourceAddress: candidate.sourceAddress,
      contractName: candidate.contractName,
      eventName: candidate.eventName,
      sourceKind: "dynamic-attested" as const,
      model: "classic" as const,
      releaseVersion: "classic-v3",
      payloadHash: candidate.payloadHash,
      rawLogCommitment: bytes32(index === 0 ? "a" : "b"),
      providerIdentities: ["alchemy", "quicknode"] as const,
      providerVendorGroups: ["alchemy", "quicknode"] as const,
      providerEndpointCommitments: [bytes32("3"), bytes32("5")] as const,
      providerOriginCommitments: [bytes32("4"), bytes32("6")] as const,
      providerHeads: ["25650020", "25650021"] as const,
      safeBlockNumber: "25650008",
      safeBlockHash: bytes32("8"),
      candidateBlockNumber: candidate.blockNumber,
      candidateBlockHash: candidate.blockHash,
      candidateBlockTimestamp: candidate.blockTimestamp,
      transactionHash: candidate.transactionHash,
      transactionIndex: candidate.transactionIndex,
      receiptCommitment: bytes32(index === 0 ? "c" : "d"),
      sourceCodeHash: bytes32("e"),
      receiptLogOrdinal: 0,
      dynamicSourceAttestationId:
        "40000000-0000-4000-8000-000000000001",
      normalizedRuntimeCodeHash: bytes32("e"),
      immutableReferencesCommitment: bytes32("f"),
      runtimeByteLength: "200",
    }));
    const verificationAccounts = Array.from({ length: 49 }, (_value, index) =>
      `0x${(index + 1).toString(16).padStart(40, "0")}` as `0x${string}`
    );
    const rewardCalls = [0, 0, 1, 1].map((providerIndex) => {
      const binding = RPC_EVIDENCE_BINDINGS[providerIndex]!;
      return {
        providerIdentity: binding.identity,
        providerVendorGroup: binding.vendorGroup,
        providerEndpointCommitment: binding.endpointCommitment,
        providerOriginCommitment: binding.endpointOriginCommitment,
        operation: "readRewardSnapshot" as const,
        attempt: 1,
        startedOffsetMs: 0,
        durationMs: 1,
        outcome: "success" as const,
      };
    });
    const rewardEvidence = {
      ...rewardSnapshot,
      model: "classic-v3" as const,
      blockNumber: "25650001",
      blockHash,
      configurationHash,
      totalCreatorFeesClaimed: "0",
      rpcCallCount: 228,
      verificationAccounts,
      providerIdentities: ["alchemy", "quicknode"] as const,
      providerVendorGroups: ["alchemy", "quicknode"] as const,
      providerEndpointCommitments: [bytes32("3"), bytes32("5")] as const,
      providerOriginCommitments: [bytes32("4"), bytes32("6")] as const,
      providerCallCounts: [114, 114] as const,
      providerSnapshotCommitments: [bytes32("7"), bytes32("7")] as const,
      chunks: [{
        chunkIndex: 0,
        verificationAccounts: verificationAccounts.slice(0, 48),
        providerCallCounts: [104, 104] as const,
        providerSnapshotCommitments: [bytes32("8"), bytes32("8")] as const,
      }, {
        chunkIndex: 1,
        verificationAccounts: verificationAccounts.slice(48),
        providerCallCounts: [10, 10] as const,
        providerSnapshotCommitments: [bytes32("9"), bytes32("9")] as const,
      }],
      executionTrace: {
        startedAtMs: 1,
        completedAtMs: 2,
        candidateBatchSize: 0,
        hardDeadlineMs: 75_000,
        maxCallsPerProvider: 128,
        elapsedMs: 1,
        providerCallCounts: [114, 114] as const,
        calls: rewardCalls,
      },
    } as const;
    const projection = {
      plan: plan!,
      freshCandidates,
      ignoredCandidateIds: [],
      evidence: {
        chainId: 1 as const,
        providerIdentities: ["alchemy", "quicknode"] as const,
        providerVendorGroups: ["alchemy", "quicknode"] as const,
        providerEndpointCommitments: [bytes32("3"), bytes32("5")] as const,
        providerOriginCommitments: [bytes32("4"), bytes32("6")] as const,
        providerHeads: ["25650020", "25650021"] as const,
        safeBlockNumber: "25650008",
        safeBlockHash: bytes32("8"),
        executionTrace: {
          ...projectionExecutionTrace,
          candidateBatchSize: 2,
        },
        candidates: candidateEvidence,
      },
      fold: {
        occurrences,
        facts,
        launches: [],
        knownPools: [],
      },
      rewardSnapshot,
      rewardSnapshots: [rewardSnapshot],
      rewardEvidence: [rewardEvidence],
    } as const;

    const malformedQueryStart = executor.queries.length;
    await expect(
      store.commitVerifiedProjection({
        ...projection,
        rewardEvidence: [{
          ...rewardEvidence,
          chunks: [
            rewardEvidence.chunks[0],
            { ...rewardEvidence.chunks[1], chunkIndex: 0 },
          ],
        }],
      } as never),
    ).rejects.toThrow();
    expect(
      executor.queries
        .slice(malformedQueryStart)
        .some(({ text }) => text.includes("open_run")),
    ).toBe(false);

    await expect(store.commitVerifiedProjection(projection)).resolves.toEqual({
      checkpointGeneration: "1",
    });
    const stage = executor.queries.find(({ text }) =>
      text.includes("stage_current_reward_snapshot_v2")
    );
    expect(stage?.values).toHaveLength(20);
    expect(stage?.values[16]).toEqual(occurrenceIds);
    expect(stage?.values[15]).toBe(occurrenceIds[1]);
    expect(
      executor.queries.some(({ text }) =>
        text.includes("stage_current_reward_snapshot_v1")
      ),
    ).toBe(false);
    const appended = executor.queries.find(({ text }) =>
      text.includes("append_reward_snapshot_provider_evidence_v1")
    );
    expect(appended?.values).toHaveLength(26);
    expect(appended?.values[11]).toBe(114);
    expect(appended?.values[12]).toBe(114);
    expect(appended?.values[13]).toHaveLength(49);
    expect(appended?.values[14]).toEqual([48, 49]);
    expect(appended?.values[17]).toEqual([104, 10]);
    expect(appended?.values[18]).toEqual([104, 10]);
    expect(
      executor.queries.some(({ text }) =>
        text.includes("projection_provider_binding_commitment_v1")
      ),
    ).toBe(false);
    const promotion = executor.queries.at(-1)!;
    expect(promotion.text).toContain("promote_projection_run_v3");
    expect(promotion.values).toHaveLength(28);
    expect(promotion.values[0]).toBe("exact_incremental");
    expect(promotion.values[24]).toHaveLength(1);
    expect(promotion.values[26]).toBeInstanceOf(Uint8Array);
    expect((promotion.values[26] as Uint8Array).byteLength).toBe(32);
    expect(
      executor.queries.some(({ text }) =>
        text.includes("promote_projection_run_v2")
      ),
    ).toBe(false);
  });
});
