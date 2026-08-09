import "server-only";

import {
  HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1,
  MANUAL_ROUTER_ALCHEMY_RPC_ENV_V1,
  MANUAL_ROUTER_QUICKNODE_RPC_ENV_V1,
  RouterLaunchFinalityVerifierV1,
  RouterLaunchTransactionRevertedError,
  assertPortableManualRouterCompleteSignedArtifactV1,
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
  ManualRouterTransactionNotObservedErrorV1,
  type ManualRouterCompleteSignedArtifactViewV1,
  type ManualRouterVerifiedPublishV1,
  type ManualRouterWebsiteAuthorityV1,
} from "@/lib/server/custom-launch/manual-router-service-v1";

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
      !== "d928f56218409f8511cec7ab43410b1bdfaa1450"
    || HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1.treeSha
      !== "f62326ae214669ef67eb2d43ff5700d6a19503c2"
    || HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1.schemaSha256
      !== "sha256:8d250114631d20f42e02ab195d80bd0123ff970cd07f7fd328b874b8abac87b5"
    || HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1.semanticCoreSha256
      !== "sha256:9bfcf57828929f8705b78b28eb0988ab7c2a966b6397829435916e94371d77c6"
    || HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1.canonicalExampleSha256
      !== "sha256:6575ab84fe93f388e96a7f042a7377859dfcd435e9c2810704e621b6a78a5794"
    || HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1.requestPathTemplate
      !== "submissions/requests/<source.repositoryId>-<identifiers.hookId>.json"
  ) throw new TypeError("portable Hookbuilder Applicant binding drifted");
  const composition = createPortableManualRouterPublishAuthorityFromEnvV1({
    env: process.env,
    fetch,
    // GitHub's public immutable bytes/currentness API requires no Website
    // secret. The Applicant identity path is separately bound through Privy.
    githubReadToken: null,
  });
  const website: ManualRouterWebsiteAuthorityV1 = Object.freeze({
    assertCompleteSignedArtifact(raw: unknown) {
      const artifact = assertPortableManualRouterCompleteSignedArtifactV1(raw);
      return artifact as unknown as ManualRouterCompleteSignedArtifactViewV1;
    },
    async verifySignedPublish(input: Parameters<
      ManualRouterWebsiteAuthorityV1["verifySignedPublish"]
    >[0]) {
      return await verifyPortableManualRouterSignedPublishV1({
        composition,
        ...input,
      }) as unknown as ManualRouterVerifiedPublishV1;
    },
    async readChainClock(): Promise<ManualRouterChainClockV1> {
      const [clock, finalized] = await Promise.all([
        composition.rpc.observeChainClock(),
        composition.rpc.collectCommonFinalizedAnchor(),
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
      prepared,
      transactionHash,
    }: Parameters<ManualRouterWebsiteAuthorityV1["observeExactTransaction"]>[0]) {
      const observed = await composition.rpc.readConsensus(
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
      return await resolvePortableManualRouterReissueStateV1({
        composition,
        ...input,
      });
    },
  });
  const finality = new RouterLaunchFinalityVerifierV1({ rpc: composition.rpc });
  const finalityAuthority: ManualRouterFinalityAuthorityV1 = Object.freeze({
    async finalize(input: Parameters<
      ManualRouterFinalityAuthorityV1["finalize"]
    >[0]) {
      try {
        const proof = await finality.finalize({
          prepared: input.prepared as unknown as Readonly<Record<string, unknown>>,
          transactionHash: input.transactionHash,
        });
        return Object.freeze({
          disposition: "finalized" as const,
          proof,
          proofHash: sha256(proof.proofHash),
        });
      } catch (error) {
        if (error instanceof RouterLaunchTransactionRevertedError) {
          return Object.freeze({
            disposition: "reverted" as const,
            evidence: error.evidence,
            evidenceHash: sha256(error.evidence.evidenceHash),
          });
        }
        if (error instanceof TypeError && /is not an object/iu.test(error.message)) {
          const [transaction, receipt, finalized] = await Promise.all([
            composition.rpc.readConsensus(
              "eth_getTransactionByHash",
              [input.transactionHash],
            ),
            composition.rpc.readConsensus(
              "eth_getTransactionReceipt",
              [input.transactionHash],
            ),
            composition.rpc.collectCommonFinalizedAnchor(),
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
  return Object.freeze({
    composition,
    website,
    finality,
    finalityAuthority,
  });
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
