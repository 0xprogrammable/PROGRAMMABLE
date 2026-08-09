import "server-only";

import type { Sha256Digest } from
  "@/lib/server/projection-target/hashing";
import {
  readManualRouterApplicantHeadV1,
  type ManualRouterApplicantHeadV1,
} from "@/lib/server/custom-launch/manual-router-head-v1";
import {
  advanceManualRouterPointerDispositionV1,
  createManualRouterApplicantIndexV1,
  type ManualRouterApplicantPointerV1,
} from "@/lib/server/custom-launch/manual-router-state-v1";
import {
  ManualRouterServiceErrorV1,
  dispositionImmutableWrites,
  type ManualRouterCompleteSignedArtifactViewV1,
  type ManualRouterWebsiteServiceV1,
} from "@/lib/server/custom-launch/manual-router-service-v1";
import {
  manualRouterContentPathV1,
  type ManualRouterPrivateBlobStoreV1,
} from "@/lib/server/custom-launch/manual-router-store-v1";
import { commitManualRouterApplicantHeadTransitionV1 } from
  "@/lib/server/custom-launch/manual-router-transition-v1";

type TransactionHash = `0x${string}`;

export type ManualRouterFinalityAuthorityResultV1 =
  | Readonly<{ disposition: "not-finalized" }>
  | Readonly<{
      disposition: "finalized";
      proof: Readonly<Record<string, unknown>>;
      proofHash: Sha256Digest;
    }>
  | Readonly<{
      disposition: "reverted" | "dropped";
      evidence: Readonly<Record<string, unknown>>;
      evidenceHash: Sha256Digest;
    }>;

export interface ManualRouterFinalityAuthorityV1 {
  finalize(input: Readonly<{
    prepared: ManualRouterCompleteSignedArtifactViewV1["prepared"];
    transactionHash: TransactionHash;
    deadline: string;
  }>): Promise<ManualRouterFinalityAuthorityResultV1>;
}

export class ManualRouterFinalityServiceV1 {
  constructor(readonly dependencies: Readonly<{
    store: ManualRouterPrivateBlobStoreV1;
    website: ManualRouterWebsiteServiceV1;
    authority: ManualRouterFinalityAuthorityV1;
  }>) {}

  async finalizeApplicantTransaction(input: Readonly<{
    githubUserId: string;
    launchWallet: `0x${string}`;
    subjectHash: Sha256Digest;
    descriptorHash: Sha256Digest;
    preparationHash: Sha256Digest;
    transactionHash: TransactionHash;
  }>): Promise<Readonly<Record<string, unknown>>> {
    const head = await readManualRouterApplicantHeadV1({
      store: this.dependencies.store,
      approvedGitHubUserId: input.githubUserId,
      approvedLaunchWallet: input.launchWallet,
    });
    return this.#finalizeCurrent(head, input);
  }

  async finalizeDiscoveredPointer(input: Readonly<{
    pointer: ManualRouterApplicantPointerV1;
  }>): Promise<Readonly<Record<string, unknown>>> {
    const pointer = input.pointer;
    if (
      pointer.state !== "submitted-awaiting-finality"
      || pointer.submittedTransactionHash === null
    ) throw conflict();
    const head = await readManualRouterApplicantHeadV1({
      store: this.dependencies.store,
      approvedGitHubUserId: pointer.subject.approvedGitHubUserId,
      approvedLaunchWallet: pointer.subject.approvedLaunchWallet,
    });
    return this.#finalizeCurrent(head, {
      githubUserId: pointer.subject.approvedGitHubUserId,
      launchWallet: pointer.subject.approvedLaunchWallet,
      subjectHash: pointer.subject.subjectHash,
      descriptorHash: pointer.signedDescriptorHash,
      preparationHash: pointer.preparationArtifactHash,
      transactionHash: pointer.submittedTransactionHash,
    }, true);
  }

  async #finalizeCurrent(
    head: ManualRouterApplicantHeadV1,
    input: Readonly<{
      githubUserId: string;
      launchWallet: `0x${string}`;
      subjectHash: Sha256Digest;
      descriptorHash: Sha256Digest;
      preparationHash: Sha256Digest;
      transactionHash: TransactionHash;
    }>,
    preparationSelectorIsArtifactHash = false,
  ): Promise<Readonly<Record<string, unknown>>> {
    const pointers = head.pointers.filter((pointer) =>
      pointer.subject.subjectHash === input.subjectHash);
    if (pointers.length !== 1) {
      throw new ManualRouterServiceErrorV1(404, "submission_not_found", false);
    }
    const pointer = pointers[0]!;
    if (
      pointer.subject.approvedGitHubUserId !== input.githubUserId
      || pointer.subject.approvedLaunchWallet.toLowerCase()
        !== input.launchWallet.toLowerCase()
      || pointer.signedDescriptorHash !== input.descriptorHash
      || pointer.submittedTransactionHash !== input.transactionHash
    ) throw conflict();
    if (pointer.state === "finalized") {
      return finalizedResponse(pointer, true);
    }
    if (pointer.state === "submission-failed-awaiting-expiry") {
      return failedResponse(
        pointer,
        await failedDisposition(this.dependencies.store, pointer),
        true,
      );
    }
    if (pointer.state !== "submitted-awaiting-finality") throw conflict();
    const artifact = await this.dependencies.website.readPointerArtifact(pointer);
    if (
      preparationSelectorIsArtifactHash
        ? artifact.preparationArtifact.preparationArtifactHash
            !== input.preparationHash
        : artifact.prepared.preparationHash !== input.preparationHash
    ) throw conflict();
    const result = await this.dependencies.authority.finalize({
      prepared: artifact.prepared,
      transactionHash: input.transactionHash,
      deadline: pointer.deadline,
    });
    if (result.disposition === "not-finalized") {
      throw new ManualRouterServiceErrorV1(
        425,
        "transaction_not_finalized",
        true,
      );
    }
    const clock = await this.dependencies.website.dependencies.authority
      .readChainClock();
    const nextPointer = result.disposition === "finalized"
      ? advanceManualRouterPointerDispositionV1({
          previous: pointer,
          updatedAtEpochSeconds: clock.maximumTimestamp,
          transactionHash: input.transactionHash,
          finalizedProofHash: result.proofHash,
        })
      : advanceManualRouterPointerDispositionV1({
          previous: pointer,
          updatedAtEpochSeconds: clock.maximumTimestamp,
          transactionHash: input.transactionHash,
          failedTransactionEvidenceHash: result.evidenceHash,
        });
    const next = createManualRouterApplicantIndexV1({
      previousIndex: head.index,
      previousPointers: head.pointers,
      nextPointer,
    });
    const evidenceWrite = result.disposition === "finalized"
      ? Object.freeze({
          path: manualRouterContentPathV1("proofs", result.proofHash),
          value: result.proof,
        })
      : Object.freeze({
          path: manualRouterContentPathV1(
            "failed-transactions",
            result.evidenceHash,
          ),
          value: result.evidence,
        });
    const transition = await commitManualRouterApplicantHeadTransitionV1({
      store: this.dependencies.store,
      head,
      nextPointer,
      nextIndex: next.index,
      immutableWrites: Object.freeze([
        evidenceWrite,
        ...dispositionImmutableWrites(nextPointer, next.index),
      ]),
      acceptConcurrentExactTarget: true,
    });
    return result.disposition === "finalized"
      ? finalizedResponse(transition.pointer, transition.idempotent)
      : failedResponse(
          transition.pointer,
          result.disposition,
          transition.idempotent,
        );
  }
}

function finalizedResponse(
  pointer: ManualRouterApplicantPointerV1,
  idempotent: boolean,
) {
  return Object.freeze({
    schemaVersion: "programmable.manual-router-applicant-finality-response.v1",
    disposition: "finalized",
    subjectHash: pointer.subject.subjectHash,
    descriptorHash: pointer.signedDescriptorHash,
    transactionHash: pointer.submittedTransactionHash,
    proofHash: pointer.finalizedProofHash,
    pointerHash: pointer.pointerHash,
    idempotent,
  });
}

function failedResponse(
  pointer: ManualRouterApplicantPointerV1,
  disposition: "reverted" | "dropped",
  idempotent: boolean,
) {
  return Object.freeze({
    schemaVersion: "programmable.manual-router-applicant-finality-response.v1",
    disposition,
    subjectHash: pointer.subject.subjectHash,
    descriptorHash: pointer.signedDescriptorHash,
    transactionHash: pointer.submittedTransactionHash,
    failedTransactionEvidenceHash: pointer.failedTransactionEvidenceHash,
    pointerHash: pointer.pointerHash,
    idempotent,
  });
}

function conflict(): ManualRouterServiceErrorV1 {
  return new ManualRouterServiceErrorV1(409, "state_conflict", false);
}

async function failedDisposition(
  store: ManualRouterPrivateBlobStoreV1,
  pointer: ManualRouterApplicantPointerV1,
): Promise<"reverted" | "dropped"> {
  if (pointer.failedTransactionEvidenceHash === null) throw conflict();
  const stored = await store.read(manualRouterContentPathV1(
    "failed-transactions",
    pointer.failedTransactionEvidenceHash,
  ));
  if (
    stored === null
    || stored.value === null
    || typeof stored.value !== "object"
    || Array.isArray(stored.value)
  ) throw conflict();
  const schemaVersion = (stored.value as Record<string, unknown>).schemaVersion;
  if (schemaVersion === "programmable.dropped-router-launch-transaction-evidence.v1") {
    return "dropped";
  }
  if (schemaVersion === "programmable.failed-router-launch-transaction-evidence.v1") {
    return "reverted";
  }
  throw conflict();
}
