import "server-only";

import { canonicalizeJson } from
  "@/lib/server/projection-target/canonical-json";
import type { Sha256Digest } from
  "@/lib/server/projection-target/hashing";
import {
  readManualRouterApplicantHeadV1,
  type ManualRouterApplicantHeadV1,
} from "@/lib/server/custom-launch/manual-router-head-v1";
import {
  assertManualRouterApplicantIndexV1,
  assertManualRouterApplicantPointerV1,
  advanceManualRouterPointerDispositionV1,
  createManualRouterApplicantIndexV1,
  manualRouterApplicantStatusV1,
  type ManualRouterApplicantIndexV1,
  type ManualRouterApplicantPointerV1,
} from "@/lib/server/custom-launch/manual-router-state-v1";
import type { ManualRouterChainClockV1 } from
  "@/lib/server/custom-launch/manual-router-rpc-v1";
import {
  manualRouterContentPathV1,
  type ManualRouterPrivateBlobStoreV1,
} from "@/lib/server/custom-launch/manual-router-store-v1";
import {
  commitManualRouterApplicantHeadTransitionV1,
} from "@/lib/server/custom-launch/manual-router-transition-v1";

type EvmAddress = `0x${string}`;
type EvmBytes32 = `0x${string}`;

export type ManualRouterCompleteSignedArtifactViewV1 = Readonly<{
  schemaVersion: "programmable.manual-router-complete-signed-artifact.v1";
  signedArtifactHash: Sha256Digest;
  descriptor: Readonly<{
    descriptorHash: Sha256Digest;
    signatureRequestHash: Sha256Digest;
    envelopeHash: Sha256Digest;
    routeNonce: EvmBytes32;
    validAfter: string;
    deadline: string;
    reissueOf: Sha256Digest | null;
  }>;
  preparationArtifact: Readonly<{
    preparationArtifactHash: Sha256Digest;
    subject: ManualRouterApplicantPointerV1["subject"];
    approvalClaim: Readonly<{
      approvalBindingHash?: Sha256Digest;
      headSha: string;
      treeSha: string;
      approvedGitHubUserId: string;
      approvedLaunchWallet: EvmAddress;
    }>;
  }>;
  prepared: Readonly<{
    preparationHash: Sha256Digest;
    launchWallet: EvmAddress;
    expectedLaunchId: EvmBytes32;
    expectedPoolId: EvmBytes32;
    expectedComponents: readonly Readonly<{
      account: EvmAddress;
      kind: number;
      runtimeCodeHash: EvmBytes32;
    }>[];
    browserAction: Readonly<{
      params: readonly [Readonly<{
        from: EvmAddress;
        to: EvmAddress;
        data: EvmBytes32 | `0x${string}`;
        value: `0x${string}`;
      }>];
    }>;
  }>;
}>;

export type ManualRouterVerifiedPublishV1 = Readonly<{
  request: Readonly<{
    expectedPreviousPointerHash: Sha256Digest | null;
    signedArtifact: ManualRouterCompleteSignedArtifactViewV1;
  }>;
  nextPointer: unknown;
  nextApplicantIndex: unknown;
  idempotent: boolean;
}>;

export interface ManualRouterWebsiteAuthorityV1 {
  assertCompleteSignedArtifact(raw: unknown): ManualRouterCompleteSignedArtifactViewV1;
  verifySignedPublish(input: Readonly<{
    request: unknown;
    currentApplicantIndex: ManualRouterApplicantIndexV1 | null;
    currentApplicantPointers: readonly ManualRouterApplicantPointerV1[];
  }>): Promise<ManualRouterVerifiedPublishV1>;
  readChainClock(): Promise<ManualRouterChainClockV1>;
  observeExactTransaction(input: Readonly<{
    prepared: ManualRouterCompleteSignedArtifactViewV1["prepared"];
    transactionHash: EvmBytes32;
  }>): Promise<void>;
  resolveReissueState(input: Readonly<{
    request: unknown;
    currentApplicantIndex: ManualRouterApplicantIndexV1 | null;
    currentApplicantPointers: readonly ManualRouterApplicantPointerV1[];
    currentStatus:
      | "permit-not-yet-valid"
      | "ready"
      | "reissue-required"
      | "submitted-awaiting-finality"
      | "failed-awaiting-expiry"
      | "finalized";
  }>): Promise<Readonly<Record<string, unknown>>>;
}

export class ManualRouterServiceErrorV1 extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "ManualRouterServiceErrorV1";
  }
}

export class ManualRouterWebsiteServiceV1 {
  constructor(readonly dependencies: Readonly<{
    store: ManualRouterPrivateBlobStoreV1;
    authority: ManualRouterWebsiteAuthorityV1;
  }>) {}

  async publishSignedArtifact(request: unknown): Promise<Readonly<{
    schemaVersion: "programmable.manual-router-signed-artifact-publish-response.v1";
    subjectHash: Sha256Digest;
    signedArtifactHash: Sha256Digest;
    pointerHash: Sha256Digest;
    applicantIndexHash: Sha256Digest;
    state: "signed-permit-available";
    idempotent: boolean;
  }>> {
    const untrustedArtifact = signedArtifactFromPublishRequest(request);
    let artifact: ManualRouterCompleteSignedArtifactViewV1;
    try {
      artifact = this.dependencies.authority.assertCompleteSignedArtifact(
        untrustedArtifact,
      );
    } catch {
      throw invalidArtifact();
    }
    const principal = artifactPrincipal(artifact);
    const head = await readManualRouterApplicantHeadV1({
      store: this.dependencies.store,
      ...principal,
    });
    let verified: ManualRouterVerifiedPublishV1;
    let checkedArtifact: ManualRouterCompleteSignedArtifactViewV1;
    try {
      verified = await this.dependencies.authority.verifySignedPublish({
        request,
        currentApplicantIndex: head.index,
        currentApplicantPointers: head.pointers,
      });
      checkedArtifact = this.dependencies.authority.assertCompleteSignedArtifact(
        verified.request.signedArtifact,
      );
    } catch {
      throw invalidArtifact();
    }
    if (canonicalizeJson(artifact) !== canonicalizeJson(checkedArtifact)) {
      throw invalidArtifact();
    }
    const pointer = assertManualRouterApplicantPointerV1(verified.nextPointer);
    if (
      pointer.state !== "signed-permit-available"
      || pointer.signedArtifactHash !== artifact.signedArtifactHash
      || pointer.subject.subjectHash !== artifact.preparationArtifact.subject.subjectHash
      || pointer.previousPointerHash !== verified.request.expectedPreviousPointerHash
    ) throw invalidArtifact();
    const nextPointers = replaceCurrentPointer(head.pointers, pointer);
    const index = assertManualRouterApplicantIndexV1(
      verified.nextApplicantIndex,
      nextPointers,
    );
    const expected = createManualRouterApplicantIndexV1({
      previousIndex: head.index,
      previousPointers: head.pointers,
      nextPointer: pointer,
    });
    if (
      expected.idempotent !== verified.idempotent
      || canonicalizeJson(expected.index) !== canonicalizeJson(index)
    ) throw invalidArtifact();
    const transition = await commitManualRouterApplicantHeadTransitionV1({
      store: this.dependencies.store,
      head,
      nextPointer: pointer,
      nextIndex: index,
      immutableWrites: signedPublishImmutableWrites(artifact, pointer, index),
      // Different signed posts never converge implicitly. The losing request
      // must reload and prove the winner as its exact predecessor.
      acceptConcurrentExactTarget: false,
    });
    return Object.freeze({
      schemaVersion: "programmable.manual-router-signed-artifact-publish-response.v1",
      subjectHash: pointer.subject.subjectHash,
      signedArtifactHash: pointer.signedArtifactHash,
      pointerHash: transition.pointer.pointerHash,
      applicantIndexHash: transition.index.indexHash,
      state: "signed-permit-available",
      idempotent: transition.idempotent,
    });
  }

  async resolveOperatorReissueState(
    request: unknown,
  ): Promise<Readonly<Record<string, unknown>>> {
    const untrustedArtifact = previousArtifactFromReissueRequest(request);
    let artifact: ManualRouterCompleteSignedArtifactViewV1;
    try {
      artifact = this.dependencies.authority.assertCompleteSignedArtifact(
        untrustedArtifact,
      );
    } catch {
      throw invalidArtifact();
    }
    const head = await readManualRouterApplicantHeadV1({
      store: this.dependencies.store,
      ...artifactPrincipal(artifact),
    });
    const matching = head.pointers.find((pointer) =>
      pointer.subject.subjectHash
        === artifact.preparationArtifact.subject.subjectHash);
    const clock = await this.dependencies.authority.readChainClock();
    let resolved: Readonly<Record<string, unknown>>;
    try {
      resolved = await this.dependencies.authority.resolveReissueState({
        request,
        currentApplicantIndex: head.index,
        currentApplicantPointers: head.pointers,
        currentStatus: matching === undefined
          ? "reissue-required"
          : manualRouterApplicantStatusV1(matching, clock),
      });
    } catch {
      throw invalidArtifact();
    }
    if (resolved.disposition === "stale") {
      if (
        canonicalizeJson(resolved) !== canonicalizeJson({
          schemaVersion: "programmable.manual-router-operator-reissue-state-response.v1",
          disposition: "stale",
          code: "stale_previous_artifact",
        })
      ) throw invalidArtifact();
      return resolved;
    }
    if (
      resolved.disposition !== "current"
      || matching === undefined
      || matching.signedArtifactHash !== artifact.signedArtifactHash
      || canonicalizeJson(resolved.currentPointer) !== canonicalizeJson(matching)
      || canonicalizeJson(resolved.currentApplicantIndex)
        !== canonicalizeJson(head.index)
      || resolved.status !== manualRouterApplicantStatusV1(matching, clock)
    ) throw invalidArtifact();
    return resolved;
  }

  async listApplicantSubmissions(principal: Readonly<{
    githubUserId: string;
    launchWallet: EvmAddress;
  }>): Promise<Readonly<{
    schemaVersion: "programmable.manual-router-applicant-list-response.v1";
    authenticatedGitHubUserId: string;
    linkedLaunchWallet: EvmAddress;
    submissions: readonly Readonly<Record<string, unknown>>[];
    applicantIndexHash: Sha256Digest | null;
  }>> {
    const head = await readManualRouterApplicantHeadV1({
      store: this.dependencies.store,
      approvedGitHubUserId: principal.githubUserId,
      approvedLaunchWallet: principal.launchWallet,
    });
    const clock = await this.dependencies.authority.readChainClock();
    const submissions = head.pointers.map((pointer) => Object.freeze({
      subjectHash: pointer.subject.subjectHash,
      pointerHash: pointer.pointerHash,
      pullRequestNumber: pointer.subject.pullRequestNumber,
      headSha: pointer.headSha,
      treeSha: pointer.treeSha,
      approvalBindingHash: pointer.approvalBindingHash,
      routeNonce: pointer.routeNonce,
      status: manualRouterApplicantStatusV1(pointer, clock),
      deadline: pointer.deadline,
      submittedTransactionHash: pointer.submittedTransactionHash,
      failedTransactionEvidenceHash: pointer.failedTransactionEvidenceHash,
    }));
    return Object.freeze({
      schemaVersion: "programmable.manual-router-applicant-list-response.v1",
      authenticatedGitHubUserId: principal.githubUserId,
      linkedLaunchWallet: principal.launchWallet,
      submissions: Object.freeze(submissions),
      applicantIndexHash: head.index?.indexHash ?? null,
    });
  }

  async resolveApplicantSubmission(principal: Readonly<{
    githubUserId: string;
    launchWallet: EvmAddress;
    subjectHash: Sha256Digest;
  }>): Promise<Readonly<Record<string, unknown>>> {
    const head = await readManualRouterApplicantHeadV1({
      store: this.dependencies.store,
      approvedGitHubUserId: principal.githubUserId,
      approvedLaunchWallet: principal.launchWallet,
    });
    const pointer = currentPointer(head, principal.subjectHash);
    const clock = await this.dependencies.authority.readChainClock();
    const status = manualRouterApplicantStatusV1(pointer, clock);
    const common = {
      schemaVersion: "programmable.manual-router-applicant-resolve-response.v1",
      subjectHash: pointer.subject.subjectHash,
      pointerHash: pointer.pointerHash,
      approvalBindingHash: pointer.approvalBindingHash,
      routeNonce: pointer.routeNonce,
    } as const;
    if (status === "ready" || status === "permit-not-yet-valid") {
      const artifact = await this.readPointerArtifact(pointer);
      return Object.freeze({
        ...common,
        status,
        validAfter: pointer.validAfter,
        deadline: pointer.deadline,
        descriptorHash: pointer.signedDescriptorHash,
        envelopeHash: artifact.descriptor.envelopeHash,
        signedArtifact: artifact,
      });
    }
    if (status === "submitted-awaiting-finality") {
      const artifact = await this.readPointerArtifact(pointer);
      return Object.freeze({
        ...common,
        status,
        descriptorHash: pointer.signedDescriptorHash,
        transactionHash: pointer.submittedTransactionHash,
        preparationHash: artifact.prepared.preparationHash,
      });
    }
    if (status === "failed-awaiting-expiry") {
      return Object.freeze({
        ...common,
        status,
        descriptorHash: pointer.signedDescriptorHash,
        transactionHash: pointer.submittedTransactionHash,
        failedTransactionEvidenceHash: pointer.failedTransactionEvidenceHash,
        deadline: pointer.deadline,
      });
    }
    if (status === "finalized") {
      return Object.freeze({
        ...common,
        status,
        transactionHash: pointer.submittedTransactionHash,
        proofHash: pointer.finalizedProofHash,
      });
    }
    return Object.freeze({
      ...common,
      status: "reissue-required",
      expiredRequestHash: pointer.signatureRequestHash,
      expiredAtChainTimestamp: clock.commonFinalizedTimestamp,
      reason: await reissueReason(this.dependencies.store, pointer, clock),
      transactionHash: pointer.submittedTransactionHash,
      failedTransactionEvidenceHash: pointer.failedTransactionEvidenceHash,
    });
  }

  async reportApplicantTransaction(input: Readonly<{
    githubUserId: string;
    launchWallet: EvmAddress;
    subjectHash: Sha256Digest;
    descriptorHash: Sha256Digest;
    preparationHash: Sha256Digest;
    transactionHash: EvmBytes32;
  }>): Promise<Readonly<Record<string, unknown>>> {
    const head = await readManualRouterApplicantHeadV1({
      store: this.dependencies.store,
      approvedGitHubUserId: input.githubUserId,
      approvedLaunchWallet: input.launchWallet,
    });
    const pointer = currentPointer(head, input.subjectHash);
    const artifact = await this.readPointerArtifact(pointer);
    assertTransactionSelector(pointer, artifact, input);
    if (pointer.state === "submitted-awaiting-finality") {
      if (pointer.submittedTransactionHash !== input.transactionHash) {
        throw conflict();
      }
      return transactionResponse(pointer, true);
    }
    if (pointer.state !== "signed-permit-available") throw conflict();
    try {
      await this.dependencies.authority.observeExactTransaction({
        prepared: artifact.prepared,
        transactionHash: input.transactionHash,
      });
    } catch (error) {
      if (error instanceof ManualRouterTransactionNotObservedErrorV1) throw error;
      throw new ManualRouterServiceErrorV1(
        422,
        "transaction_does_not_match_launch",
        false,
      );
    }
    const clock = await this.dependencies.authority.readChainClock();
    const nextPointer = advanceManualRouterPointerDispositionV1({
      previous: pointer,
      updatedAtEpochSeconds: clock.maximumTimestamp,
      transactionHash: input.transactionHash,
    });
    const next = createManualRouterApplicantIndexV1({
      previousIndex: head.index,
      previousPointers: head.pointers,
      nextPointer,
    });
    const transition = await commitManualRouterApplicantHeadTransitionV1({
      store: this.dependencies.store,
      head,
      nextPointer,
      nextIndex: next.index,
      immutableWrites: dispositionImmutableWrites(nextPointer, next.index),
      acceptConcurrentExactTarget: true,
    });
    return transactionResponse(transition.pointer, transition.idempotent);
  }

  async readPointerArtifact(
    pointer: ManualRouterApplicantPointerV1,
  ): Promise<ManualRouterCompleteSignedArtifactViewV1> {
    const stored = await this.dependencies.store.read(manualRouterContentPathV1(
      "signed-artifacts",
      pointer.signedArtifactHash,
    ));
    if (stored === null) {
      throw new ManualRouterServiceErrorV1(503, "artifact_missing", true);
    }
    let artifact: ManualRouterCompleteSignedArtifactViewV1;
    try {
      artifact = this.dependencies.authority.assertCompleteSignedArtifact(stored.value);
    } catch {
      throw invalidArtifact();
    }
    if (
      artifact.signedArtifactHash !== pointer.signedArtifactHash
      || artifact.descriptor.descriptorHash !== pointer.signedDescriptorHash
      || artifact.descriptor.signatureRequestHash !== pointer.signatureRequestHash
      || artifact.preparationArtifact.preparationArtifactHash
        !== pointer.preparationArtifactHash
      || artifact.preparationArtifact.subject.subjectHash
        !== pointer.subject.subjectHash
      || artifact.prepared.launchWallet.toLowerCase()
        !== pointer.subject.approvedLaunchWallet.toLowerCase()
    ) throw invalidArtifact();
    return artifact;
  }
}

export class ManualRouterTransactionNotObservedErrorV1
  extends ManualRouterServiceErrorV1 {
  constructor() {
    super(425, "transaction_not_observed", true);
    this.name = "ManualRouterTransactionNotObservedErrorV1";
  }
}

function signedArtifactFromPublishRequest(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalidArtifact();
  }
  return (raw as Record<string, unknown>).signedArtifact;
}

function previousArtifactFromReissueRequest(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalidArtifact();
  }
  return (raw as Record<string, unknown>).previousSignedArtifact;
}

function artifactPrincipal(artifact: ManualRouterCompleteSignedArtifactViewV1) {
  return Object.freeze({
    approvedGitHubUserId: artifact.preparationArtifact.subject.approvedGitHubUserId,
    approvedLaunchWallet: artifact.preparationArtifact.subject.approvedLaunchWallet,
  });
}

function signedPublishImmutableWrites(
  artifact: ManualRouterCompleteSignedArtifactViewV1,
  pointer: ManualRouterApplicantPointerV1,
  index: ManualRouterApplicantIndexV1,
) {
  return Object.freeze([
    Object.freeze({
      path: manualRouterContentPathV1("signed-artifacts", artifact.signedArtifactHash),
      value: artifact,
    }),
    Object.freeze({
      path: manualRouterContentPathV1("pointer-history", pointer.pointerHash),
      value: pointer,
    }),
    Object.freeze({
      path: manualRouterContentPathV1("applicant-index-history", index.indexHash),
      value: index,
    }),
  ]);
}

export function dispositionImmutableWrites(
  pointer: ManualRouterApplicantPointerV1,
  index: ManualRouterApplicantIndexV1,
) {
  return Object.freeze([
    Object.freeze({
      path: manualRouterContentPathV1("pointer-history", pointer.pointerHash),
      value: pointer,
    }),
    Object.freeze({
      path: manualRouterContentPathV1("applicant-index-history", index.indexHash),
      value: index,
    }),
  ]);
}

function currentPointer(
  head: ManualRouterApplicantHeadV1,
  subjectHash: Sha256Digest,
): ManualRouterApplicantPointerV1 {
  const matches = head.pointers.filter((pointer) =>
    pointer.subject.subjectHash === subjectHash);
  if (matches.length !== 1) {
    throw new ManualRouterServiceErrorV1(404, "submission_not_found", false);
  }
  return matches[0]!;
}

function replaceCurrentPointer(
  pointers: readonly ManualRouterApplicantPointerV1[],
  next: ManualRouterApplicantPointerV1,
) {
  const bySubject = new Map(pointers.map((pointer) =>
    [pointer.subject.subjectHash, pointer] as const));
  bySubject.set(next.subject.subjectHash, next);
  return Object.freeze([...bySubject.values()]);
}

function assertTransactionSelector(
  pointer: ManualRouterApplicantPointerV1,
  artifact: ManualRouterCompleteSignedArtifactViewV1,
  input: Readonly<{
    descriptorHash: Sha256Digest;
    preparationHash: Sha256Digest;
    launchWallet: EvmAddress;
  }>,
): void {
  if (
    pointer.signedDescriptorHash !== input.descriptorHash
    || artifact.prepared.preparationHash !== input.preparationHash
    || artifact.prepared.launchWallet.toLowerCase() !== input.launchWallet.toLowerCase()
  ) throw conflict();
}

function transactionResponse(
  pointer: ManualRouterApplicantPointerV1,
  idempotent: boolean,
) {
  return Object.freeze({
    schemaVersion: "programmable.manual-router-applicant-transaction-response.v1",
    subjectHash: pointer.subject.subjectHash,
    descriptorHash: pointer.signedDescriptorHash,
    transactionHash: pointer.submittedTransactionHash,
    pointerHash: pointer.pointerHash,
    idempotent,
  });
}

async function reissueReason(
  store: ManualRouterPrivateBlobStoreV1,
  pointer: ManualRouterApplicantPointerV1,
  clock: ManualRouterChainClockV1,
): Promise<
  | "insufficient-send-buffer"
  | "expired-unsubmitted"
  | "expired-submission"
  | "expired-reverted"
  | "dropped-submission"
> {
  const expired = BigInt(clock.commonFinalizedTimestamp) > BigInt(pointer.deadline);
  if (pointer.state === "signed-permit-available") {
    return expired ? "expired-unsubmitted" : "insufficient-send-buffer";
  }
  if (pointer.state === "submission-failed-awaiting-expiry") {
    if (pointer.failedTransactionEvidenceHash === null) throw invalidArtifact();
    const evidence = await store.read(manualRouterContentPathV1(
      "failed-transactions",
      pointer.failedTransactionEvidenceHash,
    ));
    if (evidence === null) throw invalidArtifact();
    const schemaVersion = evidence.value !== null
      && typeof evidence.value === "object"
      && !Array.isArray(evidence.value)
      ? (evidence.value as Record<string, unknown>).schemaVersion
      : null;
    if (schemaVersion === "programmable.dropped-router-launch-transaction-evidence.v1") {
      return "dropped-submission";
    }
    if (schemaVersion !== "programmable.failed-router-launch-transaction-evidence.v1") {
      throw invalidArtifact();
    }
    return "expired-reverted";
  }
  return "expired-submission";
}

function invalidArtifact(): ManualRouterServiceErrorV1 {
  return new ManualRouterServiceErrorV1(422, "artifact_integrity_failed", false);
}

function conflict(): ManualRouterServiceErrorV1 {
  return new ManualRouterServiceErrorV1(409, "state_conflict", false);
}
