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
  assertManualRouterApplicantPointerV1,
  advanceManualRouterPointerDispositionV1,
  createManualRouterApplicantIndexV1,
  manualRouterApplicantStatusV1,
  type ManualRouterApplicantIndexV1,
  type ManualRouterApplicantPointerV1,
} from "@/lib/server/custom-launch/manual-router-state-v1";
import type {
  ManualRouterCompleteSignedArtifactViewV2,
  ManualRouterNestedFactoryLaunchPreflightV2,
} from "@/lib/server/custom-launch/manual-router-artifact-v2";
import {
  readManualRouterCurrentAcceptanceHeadV1,
  type ManualRouterApplicantAcceptanceHeadV1,
} from "@/lib/server/custom-launch/manual-router-acceptance-v1";
import {
  assertManualRouterApplicantIndexAnyV2,
  assertManualRouterApplicantPointerAnyV2,
  advanceManualRouterPointerDispositionV2,
  createManualRouterApplicantIndexV2,
  manualRouterApplicantStatusAnyV2,
  type ManualRouterApplicantIndexAnyV2,
  type ManualRouterApplicantPointerAnyV2,
} from "@/lib/server/custom-launch/manual-router-state-v2";
import type { ManualRouterChainClockV1 } from
  "@/lib/server/custom-launch/manual-router-rpc-v1";
import {
  manualRouterContentPathV1,
  type ManualRouterPrivateBlobStoreV1,
} from "@/lib/server/custom-launch/manual-router-store-v1";
import {
  commitManualRouterApplicantHeadTransitionV1,
} from "@/lib/server/custom-launch/manual-router-transition-v1";
import {
  MANUAL_ROUTER_SHARDS_V1_COMPATIBILITY_V1,
  manualRouterClaimsShardsV1ArtifactV1,
  manualRouterClaimsShardsV1PointerV1,
  manualRouterIsExactShardsV1ArtifactV1,
  manualRouterIsExactShardsV1PointerV1,
} from "@/lib/server/custom-launch/manual-router-shards-v1-compat-v1";

type EvmAddress = `0x${string}`;
type EvmBytes32 = `0x${string}`;
const MAXIMUM_SHARDS_V1_POINTER_LINEAGE_DEPTH = 64;

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

export type ManualRouterCompleteSignedArtifactViewAnyV2 =
  | ManualRouterCompleteSignedArtifactViewV1
  | ManualRouterCompleteSignedArtifactViewV2;

export type ManualRouterVerifiedPublishV1 = Readonly<{
  request: Readonly<{
    expectedPreviousPointerHash: Sha256Digest | null;
    signedArtifact: ManualRouterCompleteSignedArtifactViewAnyV2;
  }>;
  nextPointer: unknown;
  nextApplicantIndex: unknown;
  idempotent: boolean;
}>;

export interface ManualRouterWebsiteAuthorityV1 {
  assertCompleteSignedArtifact(
    raw: unknown,
  ): ManualRouterCompleteSignedArtifactViewAnyV2;
  verifySignedPublish(input: Readonly<{
    request: unknown;
    currentApplicantIndex: ManualRouterApplicantIndexAnyV2 | null;
    currentApplicantPointers: readonly ManualRouterApplicantPointerAnyV2[];
  }>): Promise<ManualRouterVerifiedPublishV1>;
  readChainClock(selector?: Readonly<{
    artifact?: ManualRouterCompleteSignedArtifactViewAnyV2;
    pointer?: ManualRouterApplicantPointerAnyV2;
  }>): Promise<ManualRouterChainClockV1>;
  assertV2AcceptanceCurrent?(input: Readonly<{
    artifact: ManualRouterCompleteSignedArtifactViewV2;
    acceptanceHead: ManualRouterApplicantAcceptanceHeadV1;
  }>): Promise<void>;
  assertV2ReadyCurrentness?(input: Readonly<{
    artifact: ManualRouterCompleteSignedArtifactViewV2;
    pointer: Extract<
      ManualRouterApplicantPointerAnyV2,
      { schemaVersion: "programmable.manual-router-applicant-pointer.v2" }
    >;
    clock: ManualRouterChainClockV1;
    acceptanceHead: ManualRouterApplicantAcceptanceHeadV1;
  }>): Promise<ManualRouterNestedFactoryLaunchPreflightV2>;
  observeExactTransaction(input: Readonly<{
    artifact: ManualRouterCompleteSignedArtifactViewAnyV2;
    prepared: ManualRouterCompleteSignedArtifactViewAnyV2["prepared"];
    transactionHash: EvmBytes32;
  }>): Promise<void>;
  resolveReissueState(input: Readonly<{
    artifact: ManualRouterCompleteSignedArtifactViewAnyV2;
    request: unknown;
    currentApplicantIndex: ManualRouterApplicantIndexAnyV2 | null;
    currentApplicantPointers: readonly ManualRouterApplicantPointerAnyV2[];
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

  async publishSignedArtifact(
    request: unknown,
  ): Promise<Readonly<Record<string, unknown>>> {
    const untrustedArtifact = signedArtifactFromPublishRequest(request);
    let artifact: ManualRouterCompleteSignedArtifactViewAnyV2;
    try {
      artifact = this.dependencies.authority.assertCompleteSignedArtifact(
        untrustedArtifact,
      );
    } catch {
      throw invalidArtifact();
    }
    assertShardsV1ArtifactCompatibility(artifact);
    const principal = artifactPrincipal(artifact);
    const head = await readManualRouterApplicantHeadV1({
      store: this.dependencies.store,
      ...principal,
    });
    await this.#assertShardsV1CurrentHead(artifact, head);
    let verified: ManualRouterVerifiedPublishV1;
    let checkedArtifact: ManualRouterCompleteSignedArtifactViewAnyV2;
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
    assertShardsV1ArtifactCompatibility(checkedArtifact);
    if (canonicalizeJson(artifact) !== canonicalizeJson(checkedArtifact)) {
      throw invalidArtifact();
    }
    await this.#assertV2AcceptanceCurrent(artifact);
    const pointer = assertManualRouterApplicantPointerAnyV2(
      verified.nextPointer,
    );
    await this.#assertShardsV1PublishTransition({
      artifact,
      pointer,
      head,
      idempotent: verified.idempotent,
    });
    if (
      pointer.state !== "signed-permit-available"
      || pointer.signedArtifactHash !== artifact.signedArtifactHash
      || pointer.subject.subjectHash !== artifact.preparationArtifact.subject.subjectHash
      || pointer.previousPointerHash !== verified.request.expectedPreviousPointerHash
      || !pointerBindsArtifact(pointer, artifact)
    ) throw invalidArtifact();
    const nextPointers = replaceCurrentPointer(head.pointers, pointer);
    const index = assertManualRouterApplicantIndexAnyV2(
      verified.nextApplicantIndex,
      nextPointers,
    );
    const expected = expectedApplicantIndex(head, pointer, index);
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
      schemaVersion: pointer.schemaVersion
        === "programmable.manual-router-applicant-pointer.v2"
        ? "programmable.manual-router-signed-artifact-publish-response.v2"
        : "programmable.manual-router-signed-artifact-publish-response.v1",
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
    let artifact: ManualRouterCompleteSignedArtifactViewAnyV2;
    try {
      artifact = this.dependencies.authority.assertCompleteSignedArtifact(
        untrustedArtifact,
      );
    } catch {
      throw invalidArtifact();
    }
    assertShardsV1ArtifactCompatibility(artifact);
    const head = await readManualRouterApplicantHeadV1({
      store: this.dependencies.store,
      ...artifactPrincipal(artifact),
    });
    await this.#assertShardsV1CurrentHead(artifact, head);
    const matching = head.pointers.find((pointer) =>
      pointer.subject.subjectHash
        === artifact.preparationArtifact.subject.subjectHash);
    const clock = await this.dependencies.authority.readChainClock({ artifact });
    let resolved: Readonly<Record<string, unknown>>;
    try {
      resolved = await this.dependencies.authority.resolveReissueState({
        artifact,
        request,
        currentApplicantIndex: head.index,
        currentApplicantPointers: head.pointers,
        currentStatus: matching === undefined
          ? "reissue-required"
        : manualRouterApplicantStatusAnyV2(matching, clock),
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
      || resolved.status !== manualRouterApplicantStatusAnyV2(matching, clock)
    ) throw invalidArtifact();
    return resolved;
  }

  async listApplicantSubmissions(principal: Readonly<{
    githubUserId: string;
    launchWallet: EvmAddress;
  }>): Promise<Readonly<Record<string, unknown>>> {
    const head = await readManualRouterApplicantHeadV1({
      store: this.dependencies.store,
      approvedGitHubUserId: principal.githubUserId,
      approvedLaunchWallet: principal.launchWallet,
    });
    await Promise.all(head.pointers.map((pointer) =>
      this.#assertShardsV1PointerLineage(pointer)));
    const clock = await this.dependencies.authority.readChainClock({
      ...(head.pointers.length === 1 ? { pointer: head.pointers[0] } : {}),
    });
    await Promise.all(head.pointers.map(async (pointer) => {
      if (
        pointer.schemaVersion
          === "programmable.manual-router-applicant-pointer.v2"
        && manualRouterApplicantStatusAnyV2(pointer, clock) === "ready"
      ) {
        await this.#assertV2ReadyCurrentness(
          pointer,
          await this.readPointerArtifact(pointer),
          clock,
        );
      }
    }));
    const hasV2 = head.pointers.some((pointer) =>
      pointer.schemaVersion === "programmable.manual-router-applicant-pointer.v2");
    const submissions = head.pointers.map((pointer) =>
      hasV2
        ? applicantSubmissionV2(pointer, clock)
        : applicantSubmissionV1(
            pointer as ManualRouterApplicantPointerV1,
            clock,
          ));
    return Object.freeze({
      schemaVersion: hasV2
        ? "programmable.manual-router-applicant-list-response.v2"
        : "programmable.manual-router-applicant-list-response.v1",
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
    await this.#assertShardsV1PointerLineage(pointer);
    const clock = await this.dependencies.authority.readChainClock({ pointer });
    const status = manualRouterApplicantStatusAnyV2(pointer, clock);
    const common = resolveCommon(pointer);
    if (status === "ready" || status === "permit-not-yet-valid") {
      const artifact = await this.readPointerArtifact(pointer);
      let launchPreflight: ManualRouterNestedFactoryLaunchPreflightV2 | null = null;
      if (
        status === "ready"
        && pointer.schemaVersion
          === "programmable.manual-router-applicant-pointer.v2"
      ) {
        launchPreflight = await this.#assertV2ReadyCurrentness(
          pointer,
          artifact,
          clock,
        );
      }
      return Object.freeze({
        ...common,
        status,
        validAfter: pointer.validAfter,
        deadline: pointer.deadline,
        descriptorHash: pointer.signedDescriptorHash,
        envelopeHash: artifact.descriptor.envelopeHash,
        signedArtifact: artifact,
        ...(launchPreflight === null ? {} : { launchPreflight }),
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
      if (
        pointer.schemaVersion === "programmable.manual-router-applicant-pointer.v2"
        && pointer.executionMode === null
      ) throw invalidArtifact();
      return Object.freeze({
        ...common,
        status,
        transactionHash: pointer.submittedTransactionHash,
        proofHash: pointer.schemaVersion
          === "programmable.manual-router-applicant-pointer.v2"
          ? pointer.finalityEvidenceHash
          : pointer.finalizedProofHash,
        ...(pointer.schemaVersion
          === "programmable.manual-router-applicant-pointer.v2"
          ? { executionMode: pointer.executionMode }
          : {}),
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
        artifact,
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
    const clock = await this.dependencies.authority.readChainClock({ artifact });
    const nextPointer = advanceSubmittedPointer(
      pointer,
      clock.maximumTimestamp,
      input.transactionHash,
    );
    const next = nextApplicantIndex(head, nextPointer);
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
    pointer: ManualRouterApplicantPointerAnyV2,
  ): Promise<ManualRouterCompleteSignedArtifactViewAnyV2> {
    assertShardsV1PointerCompatibility(pointer);
    const stored = await this.dependencies.store.read(manualRouterContentPathV1(
      "signed-artifacts",
      pointer.signedArtifactHash,
    ));
    if (stored === null) {
      throw new ManualRouterServiceErrorV1(503, "artifact_missing", true);
    }
    let artifact: ManualRouterCompleteSignedArtifactViewAnyV2;
    try {
      artifact = this.dependencies.authority.assertCompleteSignedArtifact(stored.value);
    } catch {
      throw invalidArtifact();
    }
    assertShardsV1ArtifactCompatibility(artifact);
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
      || !pointerBindsArtifact(pointer, artifact)
    ) throw invalidArtifact();
    await this.#assertShardsV1PointerLineage(pointer, artifact);
    return artifact;
  }

  async #assertShardsV1CurrentHead(
    artifact: ManualRouterCompleteSignedArtifactViewAnyV2,
    head: ManualRouterApplicantHeadV1,
  ): Promise<void> {
    if (!manualRouterClaimsShardsV1ArtifactV1(artifact)) return;
    assertShardsV1ArtifactCompatibility(artifact);
    const matches = head.pointers.filter((pointer) =>
      pointer.subject.subjectHash
        === artifact.preparationArtifact.subject.subjectHash);
    if (matches.length !== 1) throw routeCapabilityDisabled();
    await this.#assertShardsV1PointerLineage(matches[0]!);
  }

  async #assertShardsV1PublishTransition(input: Readonly<{
    artifact: ManualRouterCompleteSignedArtifactViewAnyV2;
    pointer: ManualRouterApplicantPointerAnyV2;
    head: ManualRouterApplicantHeadV1;
    idempotent: boolean;
  }>): Promise<void> {
    const claimsArtifact = manualRouterClaimsShardsV1ArtifactV1(input.artifact);
    const claimsPointer = manualRouterClaimsShardsV1PointerV1(input.pointer);
    if (!claimsArtifact && !claimsPointer) return;
    assertShardsV1ArtifactCompatibility(input.artifact);
    assertShardsV1PointerCompatibility(input.pointer);
    const current = input.head.pointers.filter((pointer) =>
      pointer.subject.subjectHash === input.pointer.subject.subjectHash);
    if (current.length !== 1) throw routeCapabilityDisabled();
    await this.#assertShardsV1PointerLineage(current[0]!);
    if (
      input.pointer.signedArtifactHash !== input.artifact.signedArtifactHash
      || input.pointer.subject.subjectHash
        !== input.artifact.preparationArtifact.subject.subjectHash
      || input.pointer.schemaVersion
        !== "programmable.manual-router-applicant-pointer.v1"
      || !shardsV1PointerBindsArtifact(input.pointer, input.artifact)
    ) throw routeCapabilityDisabled();
    if (input.pointer.pointerHash === current[0]!.pointerHash) {
      if (!input.idempotent) throw routeCapabilityDisabled();
      return;
    }
    if (
      input.idempotent
      || input.pointer.state !== "signed-permit-available"
      || input.pointer.previousPointerHash !== current[0]!.pointerHash
      || input.pointer.signedArtifactHash === current[0]!.signedArtifactHash
      || input.artifact.descriptor.reissueOf
        !== current[0]!.signatureRequestHash
    ) throw routeCapabilityDisabled();
  }

  async #assertShardsV1PointerLineage(
    pointer: ManualRouterApplicantPointerAnyV2,
    currentArtifact?: ManualRouterCompleteSignedArtifactViewAnyV2,
  ): Promise<void> {
    if (!manualRouterClaimsShardsV1PointerV1(pointer)) return;
    assertShardsV1PointerCompatibility(pointer);
    let current = pointer;
    let suppliedArtifact = currentArtifact;
    const seen = new Set<Sha256Digest>();
    for (
      let depth = 0;
      depth < MAXIMUM_SHARDS_V1_POINTER_LINEAGE_DEPTH;
      depth += 1
    ) {
      if (current.schemaVersion
        !== "programmable.manual-router-applicant-pointer.v1") {
        throw routeCapabilityDisabled();
      }
      assertShardsV1PointerCompatibility(current);
      if (seen.has(current.pointerHash)) throw routeCapabilityDisabled();
      seen.add(current.pointerHash);
      const artifact = suppliedArtifact ?? await this.#readShardsV1Artifact(current);
      suppliedArtifact = undefined;
      assertShardsV1ArtifactCompatibility(artifact);
      if (!shardsV1PointerBindsArtifact(current, artifact)) {
        throw routeCapabilityDisabled();
      }
      if (current.pointerHash
        === MANUAL_ROUTER_SHARDS_V1_COMPATIBILITY_V1.rootPointerHash) {
        if (
          current.previousPointerHash !== null
          || current.signedArtifactHash
            !== MANUAL_ROUTER_SHARDS_V1_COMPATIBILITY_V1.rootSignedArtifactHash
          || artifact.descriptor.reissueOf !== null
        ) throw routeCapabilityDisabled();
        return;
      }
      if (current.previousPointerHash === null) throw routeCapabilityDisabled();
      const childPointer = current;
      const expectedPreviousPointerHash = current.previousPointerHash;
      const previous = await this.dependencies.store.read(
        manualRouterContentPathV1("pointer-history", expectedPreviousPointerHash),
      );
      if (previous === null) throw routeCapabilityDisabled();
      try {
        current = assertManualRouterApplicantPointerV1(previous.value);
      } catch {
        throw routeCapabilityDisabled();
      }
      if (current.pointerHash !== expectedPreviousPointerHash) {
        throw routeCapabilityDisabled();
      }
      if (
        childPointer.signedArtifactHash !== current.signedArtifactHash
        && artifact.descriptor.reissueOf !== current.signatureRequestHash
      ) throw routeCapabilityDisabled();
    }
    throw routeCapabilityDisabled();
  }

  async #readShardsV1Artifact(
    pointer: ManualRouterApplicantPointerV1,
  ): Promise<ManualRouterCompleteSignedArtifactViewAnyV2> {
    const stored = await this.dependencies.store.read(manualRouterContentPathV1(
      "signed-artifacts",
      pointer.signedArtifactHash,
    ));
    if (stored === null) throw routeCapabilityDisabled();
    try {
      return this.dependencies.authority.assertCompleteSignedArtifact(stored.value);
    } catch {
      throw routeCapabilityDisabled();
    }
  }

  async #assertV2AcceptanceCurrent(
    artifact: ManualRouterCompleteSignedArtifactViewAnyV2,
  ): Promise<ManualRouterApplicantAcceptanceHeadV1 | null> {
    if (artifact.schemaVersion
      !== "programmable.manual-router-complete-signed-artifact.v2") return null;
    const verify = this.dependencies.authority.assertV2AcceptanceCurrent;
    if (typeof verify !== "function") throw acceptanceNotCurrent();
    try {
      const acceptanceHead = await readManualRouterCurrentAcceptanceHeadV1({
        store: this.dependencies.store,
        acceptanceSubjectHash: artifact.binding.acceptanceSubjectHash,
        expectedCurrentAcceptanceHash: artifact.binding.currentAcceptanceHash,
        expectedClaimSha256:
          artifact.binding.applicantAcceptanceClaimSha256,
        expectedApplicantAcceptanceRecordHash:
          artifact.binding.applicantAcceptanceRecordHash,
      });
      await verify({ artifact, acceptanceHead });
      return acceptanceHead;
    } catch {
      throw acceptanceNotCurrent();
    }
  }

  async #assertV2ReadyCurrentness(
    pointer: Extract<
      ManualRouterApplicantPointerAnyV2,
      { schemaVersion: "programmable.manual-router-applicant-pointer.v2" }
    >,
    artifact: ManualRouterCompleteSignedArtifactViewAnyV2,
    clock: ManualRouterChainClockV1,
  ): Promise<ManualRouterNestedFactoryLaunchPreflightV2> {
    if (artifact.schemaVersion
      !== "programmable.manual-router-complete-signed-artifact.v2") {
      throw currentnessFailed();
    }
    const acceptanceHead = await this.#assertV2AcceptanceCurrent(artifact);
    if (acceptanceHead === null) throw currentnessFailed();
    const verify = this.dependencies.authority.assertV2ReadyCurrentness;
    if (typeof verify !== "function") throw currentnessFailed();
    try {
      const preflight = await verify({
        artifact,
        pointer,
        clock,
        acceptanceHead,
      });
      assertReadyPreflightBindingV2({
        preflight,
        artifact,
        pointer,
        clock,
      });
      return preflight;
    } catch {
      throw currentnessFailed();
    }
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

function artifactPrincipal(
  artifact: ManualRouterCompleteSignedArtifactViewAnyV2,
) {
  return Object.freeze({
    approvedGitHubUserId: artifact.preparationArtifact.subject.approvedGitHubUserId,
    approvedLaunchWallet: artifact.preparationArtifact.subject.approvedLaunchWallet,
  });
}

function assertShardsV1ArtifactCompatibility(
  artifact: ManualRouterCompleteSignedArtifactViewAnyV2,
): void {
  if (
    manualRouterClaimsShardsV1ArtifactV1(artifact)
    && !manualRouterIsExactShardsV1ArtifactV1(artifact)
  ) throw routeCapabilityDisabled();
}

function assertShardsV1PointerCompatibility(
  pointer: ManualRouterApplicantPointerAnyV2,
): void {
  if (
    manualRouterClaimsShardsV1PointerV1(pointer)
    && !manualRouterIsExactShardsV1PointerV1(pointer)
  ) throw routeCapabilityDisabled();
}

function shardsV1PointerBindsArtifact(
  pointer: ManualRouterApplicantPointerV1,
  artifact: ManualRouterCompleteSignedArtifactViewAnyV2,
): boolean {
  return artifact.schemaVersion
      === "programmable.manual-router-complete-signed-artifact.v1"
    && pointer.signedArtifactHash === artifact.signedArtifactHash
    && pointer.signedDescriptorHash === artifact.descriptor.descriptorHash
    && pointer.signatureRequestHash === artifact.descriptor.signatureRequestHash
    && pointer.preparationArtifactHash
      === artifact.preparationArtifact.preparationArtifactHash
    && pointer.subject.subjectHash
      === artifact.preparationArtifact.subject.subjectHash
    && pointer.subject.approvedLaunchWallet
      === artifact.prepared.launchWallet.toLowerCase()
    && pointer.headSha === artifact.preparationArtifact.approvalClaim.headSha
    && pointer.treeSha === artifact.preparationArtifact.approvalClaim.treeSha
    && pointer.routeNonce === artifact.descriptor.routeNonce;
}

function signedPublishImmutableWrites(
  artifact: ManualRouterCompleteSignedArtifactViewAnyV2,
  pointer: ManualRouterApplicantPointerAnyV2,
  index: ManualRouterApplicantIndexAnyV2,
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
  pointer: ManualRouterApplicantPointerAnyV2,
  index: ManualRouterApplicantIndexAnyV2,
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
): ManualRouterApplicantPointerAnyV2 {
  const matches = head.pointers.filter((pointer) =>
    pointer.subject.subjectHash === subjectHash);
  if (matches.length !== 1) {
    throw new ManualRouterServiceErrorV1(404, "submission_not_found", false);
  }
  return matches[0]!;
}

function replaceCurrentPointer(
  pointers: readonly ManualRouterApplicantPointerAnyV2[],
  next: ManualRouterApplicantPointerAnyV2,
) {
  const bySubject = new Map(pointers.map((pointer) =>
    [pointer.subject.subjectHash, pointer] as const));
  bySubject.set(next.subject.subjectHash, next);
  return Object.freeze([...bySubject.values()]);
}

function assertTransactionSelector(
  pointer: ManualRouterApplicantPointerAnyV2,
  artifact: ManualRouterCompleteSignedArtifactViewAnyV2,
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
  pointer: ManualRouterApplicantPointerAnyV2,
  idempotent: boolean,
) {
  if (pointer.schemaVersion === "programmable.manual-router-applicant-pointer.v2") {
    return Object.freeze({
      schemaVersion: "programmable.manual-router-applicant-transaction-response.v2",
      subjectHash: pointer.subject.subjectHash,
      descriptorHash: pointer.signedDescriptorHash,
      routeBindingHash: pointer.routeBindingHash,
      transactionHash: pointer.submittedTransactionHash,
      pointerHash: pointer.pointerHash,
      idempotent,
    });
  }
  return Object.freeze({
    schemaVersion: "programmable.manual-router-applicant-transaction-response.v1",
    subjectHash: pointer.subject.subjectHash,
    descriptorHash: pointer.signedDescriptorHash,
    transactionHash: pointer.submittedTransactionHash,
    pointerHash: pointer.pointerHash,
    idempotent,
  });
}

function applicantSubmissionV1(
  pointer: ManualRouterApplicantPointerV1,
  clock: ManualRouterChainClockV1,
) {
  return Object.freeze({
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
  });
}

function applicantSubmissionV2(
  pointer: ManualRouterApplicantPointerAnyV2,
  clock: ManualRouterChainClockV1,
) {
  if (pointer.schemaVersion === "programmable.manual-router-applicant-pointer.v1") {
    return Object.freeze({
      ...applicantSubmissionV1(pointer, clock),
      artifactSchemaVersion:
        "programmable.manual-router-complete-signed-artifact.v1" as const,
    });
  }
  return Object.freeze({
    subjectHash: pointer.subject.subjectHash,
    pointerHash: pointer.pointerHash,
    pullRequestNumber: pointer.subject.pullRequestNumber,
    headSha: pointer.headSha,
    treeSha: pointer.treeSha,
    artifactSchemaVersion: pointer.artifactSchemaVersion,
    grantBindingHash: pointer.grantBindingHash,
    routeBindingHash: pointer.routeBindingHash,
    launchArtifactCommitmentHash: pointer.launchArtifactCommitmentHash,
    acceptanceSubjectHash: pointer.acceptanceSubjectHash,
    currentAcceptanceHash: pointer.currentAcceptanceHash,
    applicantAcceptanceClaimSha256:
      pointer.applicantAcceptanceClaimSha256,
    applicantAcceptanceRecordHash:
      pointer.applicantAcceptanceRecordHash,
    route: pointer.route,
    routeNonce: pointer.routeNonce,
    status: manualRouterApplicantStatusAnyV2(pointer, clock),
    deadline: pointer.deadline,
    submittedTransactionHash: pointer.submittedTransactionHash,
    failedTransactionEvidenceHash: pointer.failedTransactionEvidenceHash,
    executionMode: pointer.executionMode,
  });
}

function resolveCommon(pointer: ManualRouterApplicantPointerAnyV2) {
  if (pointer.schemaVersion === "programmable.manual-router-applicant-pointer.v1") {
    return Object.freeze({
      schemaVersion: "programmable.manual-router-applicant-resolve-response.v1" as const,
      subjectHash: pointer.subject.subjectHash,
      pointerHash: pointer.pointerHash,
      approvalBindingHash: pointer.approvalBindingHash,
      routeNonce: pointer.routeNonce,
    });
  }
  return Object.freeze({
    schemaVersion: "programmable.manual-router-applicant-resolve-response.v2" as const,
    subjectHash: pointer.subject.subjectHash,
    pointerHash: pointer.pointerHash,
    artifactSchemaVersion: pointer.artifactSchemaVersion,
    grantBindingHash: pointer.grantBindingHash,
    routeBindingHash: pointer.routeBindingHash,
    launchArtifactCommitmentHash: pointer.launchArtifactCommitmentHash,
    acceptanceSubjectHash: pointer.acceptanceSubjectHash,
    currentAcceptanceHash: pointer.currentAcceptanceHash,
    applicantAcceptanceClaimSha256:
      pointer.applicantAcceptanceClaimSha256,
    applicantAcceptanceRecordHash:
      pointer.applicantAcceptanceRecordHash,
    route: pointer.route,
    routeNonce: pointer.routeNonce,
  });
}

function pointerBindsArtifact(
  pointer: ManualRouterApplicantPointerAnyV2,
  artifact: ManualRouterCompleteSignedArtifactViewAnyV2,
): boolean {
  if (pointer.schemaVersion === "programmable.manual-router-applicant-pointer.v1") {
    return artifact.schemaVersion
      === "programmable.manual-router-complete-signed-artifact.v1";
  }
  return artifact.schemaVersion
      === "programmable.manual-router-complete-signed-artifact.v2"
    && artifact.artifactKind === "nested-factory"
    && pointer.artifactSchemaVersion === artifact.schemaVersion
    && pointer.grantBindingHash === artifact.binding.grantBindingHash
    && pointer.routeBindingHash === artifact.binding.routeBindingHash
    && pointer.launchArtifactCommitmentHash
      === artifact.binding.launchArtifactCommitmentHash
    && pointer.acceptanceSubjectHash
      === artifact.binding.acceptanceSubjectHash
    && pointer.currentAcceptanceHash
      === artifact.binding.currentAcceptanceHash
    && pointer.applicantAcceptanceClaimSha256
      === artifact.binding.applicantAcceptanceClaimSha256
    && pointer.applicantAcceptanceRecordHash
      === artifact.binding.applicantAcceptanceRecordHash
    && canonicalizeJson(pointer.route) === canonicalizeJson(artifact.route)
    && canonicalizeJson(artifact.route)
      === canonicalizeJson({
        schemaVersion: "programmable.manual-router-route-binding.v2",
        routeId: "nested-factory",
        routeVersion: "1.0.0",
        profileId: "exact-shards-nested-factory",
        profileVersion: "1.0.0",
        profileKey: artifact.route.profileKey,
      })
    && artifact.prepared.primaryEvidence.kind === "shards-nested-factory"
    && artifact.prepared.primaryEvidence.profileKey === artifact.route.profileKey
    && artifact.prepared.primaryEvidence.routeId === artifact.route.routeId
    && artifact.prepared.primaryEvidence.routeVersion
      === artifact.route.routeVersion
    && artifact.prepared.primaryEvidence.profileId === artifact.route.profileId
    && artifact.prepared.primaryEvidence.profileVersion
      === artifact.route.profileVersion;
}

function expectedApplicantIndex(
  head: ManualRouterApplicantHeadV1,
  pointer: ManualRouterApplicantPointerAnyV2,
  index: ManualRouterApplicantIndexAnyV2,
) {
  if (index.schemaVersion === "programmable.manual-router-applicant-index.v2") {
    return createManualRouterApplicantIndexV2({
      previousIndex: head.index,
      previousPointers: head.pointers,
      nextPointer: pointer,
    });
  }
  if (
    pointer.schemaVersion !== "programmable.manual-router-applicant-pointer.v1"
    || head.index?.schemaVersion === "programmable.manual-router-applicant-index.v2"
    || head.pointers.some((candidate) =>
      candidate.schemaVersion !== "programmable.manual-router-applicant-pointer.v1")
  ) throw invalidArtifact();
  return createManualRouterApplicantIndexV1({
    previousIndex: head.index as ManualRouterApplicantIndexV1 | null,
    previousPointers: head.pointers.map(assertManualRouterApplicantPointerV1),
    nextPointer: pointer,
  });
}

function nextApplicantIndex(
  head: ManualRouterApplicantHeadV1,
  nextPointer: ManualRouterApplicantPointerAnyV2,
) {
  if (
    nextPointer.schemaVersion === "programmable.manual-router-applicant-pointer.v2"
    || head.index?.schemaVersion === "programmable.manual-router-applicant-index.v2"
  ) {
    return createManualRouterApplicantIndexV2({
      previousIndex: head.index,
      previousPointers: head.pointers,
      nextPointer,
    });
  }
  return createManualRouterApplicantIndexV1({
    previousIndex: head.index as ManualRouterApplicantIndexV1 | null,
    previousPointers: head.pointers.map(assertManualRouterApplicantPointerV1),
    nextPointer: assertManualRouterApplicantPointerV1(nextPointer),
  });
}

function advanceSubmittedPointer(
  pointer: ManualRouterApplicantPointerAnyV2,
  updatedAtEpochSeconds: string,
  transactionHash: EvmBytes32,
) {
  return pointer.schemaVersion === "programmable.manual-router-applicant-pointer.v2"
    ? advanceManualRouterPointerDispositionV2({
        previous: pointer,
        updatedAtEpochSeconds,
        transactionHash,
      })
    : advanceManualRouterPointerDispositionV1({
        previous: pointer,
        updatedAtEpochSeconds,
        transactionHash,
      });
}

async function reissueReason(
  store: ManualRouterPrivateBlobStoreV1,
  pointer: ManualRouterApplicantPointerAnyV2,
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

function assertReadyPreflightBindingV2(input: Readonly<{
  preflight: ManualRouterNestedFactoryLaunchPreflightV2;
  artifact: ManualRouterCompleteSignedArtifactViewV2;
  pointer: Extract<
    ManualRouterApplicantPointerAnyV2,
    { schemaVersion: "programmable.manual-router-applicant-pointer.v2" }
  >;
  clock: ManualRouterChainClockV1;
}>): void {
  const { preflight, artifact, pointer, clock } = input;
  const action = artifact.prepared.browserAction.params[0];
  const issued = BigInt(preflight.issuedAtEpochSeconds);
  const expires = BigInt(preflight.expiresAtEpochSeconds);
  const minimum = BigInt(clock.minimumTimestamp);
  const maximum = BigInt(clock.maximumTimestamp);
  if (
    preflight.schemaVersion
      !== "programmable.nested-factory-launch-preflight.v1"
    || preflight.chainId !== "1"
    || expires <= issued
    || expires - issued > 120n
    || issued < minimum
    || issued > maximum + 120n
    || expires <= maximum
    || preflight.grantHash !== artifact.binding.grantBindingHash
    || preflight.acceptanceSubjectHash
      !== artifact.binding.acceptanceSubjectHash
    || preflight.currentAcceptanceHash
      !== artifact.binding.currentAcceptanceHash
    || preflight.acceptanceSubjectHash !== pointer.acceptanceSubjectHash
    || preflight.currentAcceptanceHash !== pointer.currentAcceptanceHash
    || preflight.launchId !== artifact.prepared.expectedLaunchId
    || preflight.permitNonce !== artifact.prepared.expectedLaunchId
    || pointer.routeNonce !== artifact.descriptor.routeNonce
    || preflight.browserAction.from !== action.from
    || preflight.browserAction.to !== action.to
    || preflight.browserAction.data !== action.data
    || preflight.browserAction.value !== action.value
    || preflight.mainnetTransactionGasLimit !== "16777216"
    || BigInt(preflight.maximumLiveGasEstimate) < 1n
    || BigInt(preflight.bufferedGasLimit)
      < BigInt(preflight.maximumLiveGasEstimate)
    || BigInt(preflight.bufferedGasLimit) > 16_777_216n
    || canonicalizeJson(preflight.executionModePolicy)
      !== canonicalizeJson([
        "EXACT_EXISTING_LAUNCH_ADOPTED",
        "EXACT_FACTORY_LAUNCH_EXECUTED",
      ])
    || (
      preflight.executionMode !== "EXACT_FACTORY_LAUNCH_EXECUTED"
      && preflight.executionMode !== "EXACT_EXISTING_LAUNCH_ADOPTED"
    )
  ) throw currentnessFailed();
}

function invalidArtifact(): ManualRouterServiceErrorV1 {
  return new ManualRouterServiceErrorV1(422, "artifact_integrity_failed", false);
}

function acceptanceNotCurrent(): ManualRouterServiceErrorV1 {
  return new ManualRouterServiceErrorV1(
    503,
    "route_acceptance_not_current",
    false,
  );
}

function currentnessFailed(): ManualRouterServiceErrorV1 {
  return new ManualRouterServiceErrorV1(
    503,
    "shards_nested_currentness_failed",
    true,
  );
}

function routeCapabilityDisabled(): ManualRouterServiceErrorV1 {
  return new ManualRouterServiceErrorV1(
    503,
    "route_capability_disabled",
    false,
  );
}

function conflict(): ManualRouterServiceErrorV1 {
  return new ManualRouterServiceErrorV1(409, "state_conflict", false);
}
