import "server-only";

import {
  HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1,
  MANUAL_ROUTER_ALCHEMY_RPC_ENV_V1,
  MANUAL_ROUTER_QUICKNODE_RPC_ENV_V1,
  PRODUCTION_SHARDS_ROUTER_V1_DIRECT_SIMULATION_PROFILE_V1,
  RouterLaunchFinalityVerifierV1,
  RouterLaunchTransactionRevertedError,
  assertPortableManualRouterCompleteSignedArtifactV1,
  assertPortableManualRouterSignedPublishRequestV1,
  createPortableManualRouterPublishAuthorityFromEnvV1,
  resolvePortableManualRouterReissueStateV1,
  verifyPortableManualRouterSignedPublishV1,
  type PortableManualRouterCompositionV1,
} from "@/lib/vendor/manual-router-authority-v1/manual-router-portable.v1.mjs";
import {
  MANUAL_ROUTER_PRODUCTION_BINDING_V1,
} from "@/lib/custom-launch/manual-router-bindings-v1";
import { canonicalSha256 } from
  "@/lib/server/projection-target/hashing";
import {
  assertManualRouterProductionConfigurationV1,
} from "@/lib/server/custom-launch/manual-router-config-v1";
import type { ManualRouterChainClockV1 } from
  "@/lib/server/custom-launch/manual-router-rpc-v1";
import {
  type ManualRouterFinalityAuthorityV1,
} from "@/lib/server/custom-launch/manual-router-finality-v1";
import {
  SHARDS_MANUAL_ROUTER_ALCHEMY_API_KEY_COMMITMENT_ENV_V1,
  SHARDS_MANUAL_ROUTER_ALCHEMY_API_KEY_ENV_V1,
  SHARDS_MANUAL_ROUTER_ALCHEMY_ENDPOINT_V1,
  createShardsManualRouterAlchemyBearerFetchV1,
  createShardsManualRouterPublishFetchV1,
  isExactShardsManualRouterPublishRequestV1,
} from "@/lib/server/custom-launch/manual-router-shards-publish-transport-v1";
import {
  manualRouterIsExactShardsV1ArtifactV1,
  manualRouterIsExactShardsV1PointerV1,
} from "@/lib/server/custom-launch/manual-router-shards-v1-compat-v1";
import {
  ManualRouterTransactionNotObservedErrorV1,
  type ManualRouterCompleteSignedArtifactViewV1,
  type ManualRouterVerifiedPublishV1,
  type ManualRouterWebsiteAuthorityV1,
} from "@/lib/server/custom-launch/manual-router-service-v1";
import {
  createManualRouterWebsiteAuthorityDispatchV2,
  createProductionManualRouterWebsiteAuthorityV2,
} from "@/lib/server/custom-launch/manual-router-authority-v2";

export type ProductionManualRouterAuthorityV1 = Readonly<{
  composition: PortableManualRouterCompositionV1;
  website: ManualRouterWebsiteAuthorityV1;
  finality: RouterLaunchFinalityVerifierV1;
  finalityAuthority: ManualRouterFinalityAuthorityV1;
}>;

export function createProductionManualRouterAuthorityV1():
ProductionManualRouterAuthorityV1 {
  assertManualRouterProductionConfigurationV1();
  if (
    MANUAL_ROUTER_ALCHEMY_RPC_ENV_V1
      !== "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL"
    || MANUAL_ROUTER_QUICKNODE_RPC_ENV_V1
      !== "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL"
  ) throw new TypeError("portable manual Router RPC environment drifted");
  if (
    HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1.commitSha
      !== "279dd2fc2ea8c488943ca4e60ca889cb00bab40e"
    || HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1.treeSha
      !== "48149d436bf222c440980e1fc31a71899b833af7"
    || HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1.schemaSha256
      !== "sha256:8d250114631d20f42e02ab195d80bd0123ff970cd07f7fd328b874b8abac87b5"
    || HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1.semanticCoreSha256
      !== "sha256:9bfcf57828929f8705b78b28eb0988ab7c2a966b6397829435916e94371d77c6"
    || HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1.canonicalExampleSha256
      !== "sha256:6575ab84fe93f388e96a7f042a7377859dfcd435e9c2810704e621b6a78a5794"
    || HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1.requestPathTemplate
      !== "submissions/requests/<source.repositoryId>-<identifiers.hookId>.json"
  ) throw new TypeError("portable Hookbuilder Applicant binding drifted");
  const {
    bindingHash: shardsProfileBindingHash,
    ...shardsProfileCore
  } = PRODUCTION_SHARDS_ROUTER_V1_DIRECT_SIMULATION_PROFILE_V1;
  if (
    PRODUCTION_SHARDS_ROUTER_V1_DIRECT_SIMULATION_PROFILE_V1.schemaVersion
      !== "programmable.shards-router-v1-direct-simulation-profile.v1"
    || PRODUCTION_SHARDS_ROUTER_V1_DIRECT_SIMULATION_PROFILE_V1.applicationId
      !== "shards-v1"
    || PRODUCTION_SHARDS_ROUTER_V1_DIRECT_SIMULATION_PROFILE_V1.selectionPolicy
      !== "exact-compile-input-hash-only"
    || PRODUCTION_SHARDS_ROUTER_V1_DIRECT_SIMULATION_PROFILE_V1.compileInputHash
      !== "sha256:1d7c191dc3e16ba9967be76622b76269b6ac1673637212fab41594ff1665394a"
    || PRODUCTION_SHARDS_ROUTER_V1_DIRECT_SIMULATION_PROFILE_V1
      .genericSimulationGasLimit !== "12000000"
    || PRODUCTION_SHARDS_ROUTER_V1_DIRECT_SIMULATION_PROFILE_V1
      .exactSimulationGasLimit !== "16000000"
    || shardsProfileBindingHash
      !== "sha256:ffba60e856fb210e11e8b22e27a319378887f99a328b3448fe069962965e98cd"
    || canonicalSha256(
      PRODUCTION_SHARDS_ROUTER_V1_DIRECT_SIMULATION_PROFILE_V1.schemaVersion,
      shardsProfileCore,
    ) !== shardsProfileBindingHash
  ) throw new TypeError("portable Shards direct simulation profile drifted");
  const composition = createPortableManualRouterPublishAuthorityFromEnvV1({
    env: process.env,
    fetch,
    // GitHub's public immutable bytes/currentness API requires no Website
    // secret. The Applicant identity path is separately bound through Privy.
    githubReadToken: null,
  });
  let shardsComposition: PortableManualRouterCompositionV1 | null = null;
  const exactShardsComposition = (): PortableManualRouterCompositionV1 => {
    if (shardsComposition !== null) return shardsComposition;
    const quickNodeFetch = createShardsManualRouterPublishFetchV1({
      fetch,
      quickNodeUrl: process.env[MANUAL_ROUTER_QUICKNODE_RPC_ENV_V1],
    });
    const alchemyBearerFetch = createShardsManualRouterAlchemyBearerFetchV1({
      fetch: quickNodeFetch,
      apiKey: process.env[SHARDS_MANUAL_ROUTER_ALCHEMY_API_KEY_ENV_V1],
      apiKeyCommitment:
        process.env[SHARDS_MANUAL_ROUTER_ALCHEMY_API_KEY_COMMITMENT_ENV_V1],
    });
    shardsComposition = createPortableManualRouterPublishAuthorityFromEnvV1({
      env: Object.freeze({
        [MANUAL_ROUTER_ALCHEMY_RPC_ENV_V1]:
          SHARDS_MANUAL_ROUTER_ALCHEMY_ENDPOINT_V1,
        [MANUAL_ROUTER_QUICKNODE_RPC_ENV_V1]:
          process.env[MANUAL_ROUTER_QUICKNODE_RPC_ENV_V1],
      }),
      fetch: alchemyBearerFetch,
      githubReadToken: null,
    });
    return shardsComposition;
  };
  const legacyWebsite: ManualRouterWebsiteAuthorityV1 = Object.freeze({
    assertCompleteSignedArtifact(raw: unknown) {
      const artifact = assertPortableManualRouterCompleteSignedArtifactV1(raw);
      return artifact as unknown as ManualRouterCompleteSignedArtifactViewV1;
    },
    async verifySignedPublish(input: Parameters<
      ManualRouterWebsiteAuthorityV1["verifySignedPublish"]
    >[0]) {
      const verifiedRequest = assertPortableManualRouterSignedPublishRequestV1(
        input.request,
      );
      const exactShards = isExactShardsManualRouterPublishRequestV1(
        verifiedRequest,
      ) && manualRouterIsExactShardsV1ArtifactV1(
        verifiedRequest.signedArtifact as never,
      );
      return await verifyPortableManualRouterSignedPublishV1({
        ...input,
        composition: exactShards
          ? exactShardsComposition()
          : composition,
        request: verifiedRequest,
      }) as unknown as ManualRouterVerifiedPublishV1;
    },
    async readChainClock(
      selector: Parameters<ManualRouterWebsiteAuthorityV1["readChainClock"]>[0],
    ): Promise<ManualRouterChainClockV1> {
      const selected = selectorUsesExactShardsV1(selector)
        ? exactShardsComposition()
        : composition;
      const [clock, finalized] = await Promise.all([
        selected.rpc.observeChainClock(),
        selected.rpc.collectCommonFinalizedAnchor(),
      ]);
      if (BigInt(finalized.timestamp) > BigInt(clock.minimumTimestamp)) {
        throw new TypeError("portable manual Router finality clock is invalid");
      }
      return Object.freeze({
        minimumTimestamp: clock.minimumTimestamp,
        maximumTimestamp: clock.maximumTimestamp,
        commonFinalizedTimestamp: finalized.timestamp,
        commonFinalizedBlockNumber: BigInt(finalized.blockNumber).toString(10),
        commonFinalizedBlockHash: finalized.blockHash,
      });
    },
    async observeExactTransaction({
      artifact,
      prepared,
      transactionHash,
    }: Parameters<ManualRouterWebsiteAuthorityV1["observeExactTransaction"]>[0]) {
      const selected = manualRouterIsExactShardsV1ArtifactV1(artifact as never)
        ? exactShardsComposition()
        : composition;
      const observed = await selected.rpc.readConsensus(
        "eth_getTransactionByHash",
        [transactionHash],
      );
      if (observed === null) throw new ManualRouterTransactionNotObservedErrorV1();
      const transaction = rpcRecord(observed);
      const action = prepared.browserAction.params[0];
      if (
        bytes32(transaction.hash) !== transactionHash
        || address(transaction.from) !== address(action.from)
        || address(transaction.to) !== address(
          MANUAL_ROUTER_PRODUCTION_BINDING_V1.router.address,
        )
        || address(transaction.to) !== address(action.to)
        || hex(transaction.input) !== hex(action.data)
        || quantity(transaction.value) !== quantity(action.value)
      ) throw new TypeError("manual Router transaction does not match the browser action");
    },
    async resolveReissueState(input: Parameters<
      ManualRouterWebsiteAuthorityV1["resolveReissueState"]
    >[0]) {
      const selected = manualRouterIsExactShardsV1ArtifactV1(
        input.artifact as never,
      )
        ? exactShardsComposition()
        : composition;
      return await resolvePortableManualRouterReissueStateV1({
        composition: selected,
        request: input.request,
        currentApplicantIndex: input.currentApplicantIndex,
        currentApplicantPointers: input.currentApplicantPointers,
        currentStatus: input.currentStatus,
      });
    },
  });
  const website = createManualRouterWebsiteAuthorityDispatchV2({
    v1: legacyWebsite,
    loadV2: createProductionManualRouterWebsiteAuthorityV2,
  });
  const finality = new RouterLaunchFinalityVerifierV1({ rpc: composition.rpc });
  const genericFinalityAuthority = createProductionManualRouterFinalityAuthorityV1({
    finality,
    rpc: composition.rpc,
  });
  let shardsFinalityAuthority: ManualRouterFinalityAuthorityV1 | null = null;
  const exactShardsFinalityAuthority = (): ManualRouterFinalityAuthorityV1 => {
    if (shardsFinalityAuthority !== null) return shardsFinalityAuthority;
    const selected = exactShardsComposition();
    shardsFinalityAuthority = createProductionManualRouterFinalityAuthorityV1({
      finality: new RouterLaunchFinalityVerifierV1({ rpc: selected.rpc }),
      rpc: selected.rpc,
    });
    return shardsFinalityAuthority;
  };
  const finalityAuthority: ManualRouterFinalityAuthorityV1 = Object.freeze({
    async finalize(
      input: Parameters<ManualRouterFinalityAuthorityV1["finalize"]>[0],
    ) {
      return (manualRouterIsExactShardsV1ArtifactV1(input.artifact as never)
        ? exactShardsFinalityAuthority()
        : genericFinalityAuthority).finalize(input);
    },
  });
  return Object.freeze({
    composition,
    website,
    finality,
    finalityAuthority,
  });
}

function selectorUsesExactShardsV1(
  selector: Parameters<ManualRouterWebsiteAuthorityV1["readChainClock"]>[0],
): boolean {
  return (
    selector?.artifact !== undefined
      && manualRouterIsExactShardsV1ArtifactV1(selector.artifact as never)
  ) || (
    selector?.pointer !== undefined
      && manualRouterIsExactShardsV1PointerV1(selector.pointer as never)
  );
}

const PORTABLE_FINALITY_OBSERVATION_UNAVAILABLE_MESSAGES = new Set([
  "launch transaction is unavailable or invalid",
  "launch receipt is unavailable or invalid",
]);

export function createProductionManualRouterFinalityAuthorityV1(
  dependencies: Readonly<{
    finality: Pick<RouterLaunchFinalityVerifierV1, "finalize">;
    rpc: Pick<
      PortableManualRouterCompositionV1["rpc"],
      "readConsensus" | "collectCommonFinalizedAnchor"
    >;
  }>,
): ManualRouterFinalityAuthorityV1 {
  return Object.freeze({
    async finalize(input: Parameters<
      ManualRouterFinalityAuthorityV1["finalize"]
    >[0]) {
      try {
        const proof = await dependencies.finality.finalize({
          prepared: input.prepared as unknown as Readonly<Record<string, unknown>>,
          transactionHash: input.transactionHash,
        });
        return Object.freeze({
          disposition: "finalized" as const,
          proof,
          proofHash: sha256(proof.proofHash),
          executionMode: null,
        });
      } catch (error) {
        if (error instanceof RouterLaunchTransactionRevertedError) {
          return Object.freeze({
            disposition: "reverted" as const,
            evidence: error.evidence,
            evidenceHash: sha256(error.evidence.evidenceHash),
          });
        }
        if (isPortableFinalityObservationUnavailable(error)) {
          const [transaction, receipt, finalized] = await Promise.all([
            dependencies.rpc.readConsensus(
              "eth_getTransactionByHash",
              [input.transactionHash],
            ),
            dependencies.rpc.readConsensus(
              "eth_getTransactionReceipt",
              [input.transactionHash],
            ),
            dependencies.rpc.collectCommonFinalizedAnchor(),
          ]);
          if (
            transaction === null
            && receipt === null
            && BigInt(finalized.timestamp) > BigInt(input.deadline)
          ) {
            const core = {
              schemaVersion:
                "programmable.dropped-router-launch-transaction-evidence.v1" as const,
              transactionHash: input.transactionHash,
              preparationHash: input.prepared.preparationHash,
              permitDeadline: input.deadline,
              commonFinalizedBlockNumber: finalized.blockNumber,
              commonFinalizedBlockHash: finalized.blockHash,
              commonFinalizedTimestamp: finalized.timestamp,
              disposition: "absent-after-finalized-deadline" as const,
            };
            const evidence = Object.freeze({
              ...core,
              evidenceHash: canonicalSha256(core.schemaVersion, core),
            });
            return Object.freeze({
              disposition: "dropped" as const,
              evidence,
              evidenceHash: evidence.evidenceHash,
            });
          }
          return Object.freeze({ disposition: "not-finalized" as const });
        }
        if (
          error instanceof TypeError
          && /not finalized/iu.test(error.message)
        ) return Object.freeze({ disposition: "not-finalized" as const });
        throw error;
      }
    },
  });
}

function isPortableFinalityObservationUnavailable(error: unknown): boolean {
  return error instanceof TypeError
    && PORTABLE_FINALITY_OBSERVATION_UNAVAILABLE_MESSAGES.has(error.message);
}

export { RouterLaunchTransactionRevertedError };

function rpcRecord(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("manual Router transaction is invalid");
  }
  return raw as Record<string, unknown>;
}

function address(raw: unknown): string {
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(raw)) {
    throw new TypeError("manual Router transaction address is invalid");
  }
  return raw.toLowerCase();
}

function bytes32(raw: unknown): `0x${string}` {
  if (typeof raw !== "string" || !/^0x[0-9a-f]{64}$/u.test(raw)) {
    throw new TypeError("manual Router transaction hash is invalid");
  }
  return raw as `0x${string}`;
}

function hex(raw: unknown): string {
  if (typeof raw !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(raw)) {
    throw new TypeError("manual Router transaction calldata is invalid");
  }
  return raw;
}

function quantity(raw: unknown): bigint {
  if (typeof raw !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(raw)) {
    throw new TypeError("manual Router transaction quantity is invalid");
  }
  return BigInt(raw);
}

function sha256(raw: unknown): `sha256:${string}` {
  if (typeof raw !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(raw)) {
    throw new TypeError("manual Router finality hash is invalid");
  }
  return raw as `sha256:${string}`;
}
