"use client";

import { ArrowRight, CircleCheck } from "lucide-react";
import { useState } from "react";

import styles from "@/components/custom-launch-experience.module.css";
import {
  CUSTOM_LAUNCH_STAGES_V1,
  CustomLaunchFrame,
  type CustomLaunchStageV1,
} from "@/components/custom-launch-experience";
import type { PrincipalCustomLaunchApplicationSummaryV2 } from "@/lib/custom-launch/contract-v2";

const LOCAL_PREVIEW_BUNDLE_SENTINEL = "programmable-custom-launch-local-preview-v1";

const LOCAL_PREVIEW_APPLICATION: PrincipalCustomLaunchApplicationSummaryV2 = Object.freeze({
  applicationId: "local-interface-preview",
  applicationHandle: `github-${"1".repeat(64)}`,
  revisionId: "local-preview-revision",
  repositoryId: "100000001",
  repositoryOwnerId: "100000002",
  repositoryFullName: "example-labs/approved-module",
  pullRequestNumber: 24,
  commitOid: "7c9a41d6f2b83e0a5d174c9260b48ee351a720df",
  treeOid: "f14e7a893c2d50b4e1a6790d348c5fb217e6a09c",
  state: "approved",
  reasonCodes: [],
  actionCodes: [],
  correctionCount: 0,
  correctionPreview: [],
  receiptDigest: `sha256:${"2".repeat(64)}`,
  launchEntitlementBindingHash: `sha256:${"3".repeat(64)}`,
  updatedAt: "2026-08-13T06:24:17.000Z",
});

const LOCAL_PREVIEW_COPY: Readonly<Record<CustomLaunchStageV1, Readonly<{
  title: string;
  description: string;
  action: string;
}>>> = Object.freeze({
  github: {
    title: "Prove which GitHub account owns the launch.",
    description: "The account opens only repositories and revisions explicitly allowed for that principal.",
    action: "Connect GitHub",
  },
  repositories: {
    title: "Choose from repositories you are allowed to launch.",
    description: "Repository access alone is not approval. The next step binds one pull request and one immutable source tree.",
    action: "Select repository",
  },
  approval: {
    title: "Verify the approved commit and tree before preparing anything.",
    description: "Any source change invalidates this approval and closes the launch path.",
    action: "Use exact revision",
  },
  prepare: {
    title: "Prepare one launch action from the approved adapter.",
    description: "The route, network, value, target, and calldata stay bound to the approved source.",
    action: "Prepare launch",
  },
  wallet: {
    title: "Review the exact transaction in your browser wallet.",
    description: "Programmable never takes custody and never submits an applicant transaction from a platform key.",
    action: "Review wallet request",
  },
  registry: {
    title: "Finality turns the transaction into a public Registry record.",
    description: "The public page appears only after the required confirmations and exact read model verification.",
    action: "End of local preview",
  },
});

export function CustomLaunchLocalPreview({
  initialStage,
  onBack,
}: {
  initialStage: CustomLaunchStageV1;
  onBack: () => void;
}) {
  const [stage, setStage] = useState(initialStage);
  const index = CUSTOM_LAUNCH_STAGES_V1.findIndex(({ id }) => id === stage);
  const copy = LOCAL_PREVIEW_COPY[stage];
  const showRevision = index >= 2;
  const next = CUSTOM_LAUNCH_STAGES_V1[index + 1]?.id;
  const previous = CUSTOM_LAUNCH_STAGES_V1[index - 1]?.id;
  const verifiedStages = CUSTOM_LAUNCH_STAGES_V1
    .slice(0, index)
    .map(({ id }) => id);

  return (
    <CustomLaunchFrame
      boundaryRef={() => undefined}
      onBack={onBack}
      title="Approved project launch"
      eyebrow="Local interface preview"
      stage={stage}
      verifiedStages={verifiedStages}
      application={showRevision ? LOCAL_PREVIEW_APPLICATION : null}
      applicationIsLocal
    >
      <section
        className={styles.previewPanel}
        aria-labelledby="local-preview-title"
        data-local-preview={LOCAL_PREVIEW_BUNDLE_SENTINEL}
      >
        <div className={styles.previewNotice} role="note">
          <span>Local seed</span>
          No account, wallet request, transaction, or public record is created.
        </div>
        <div className={styles.previewHero}>
          <span className={styles.instrumentLabel}>Stage {String(index + 1).padStart(2, "0")}</span>
          <h2 id="local-preview-title">{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <dl className={styles.previewFacts}>
          <div><dt>GitHub owner</dt><dd>{index >= 1 ? "Verified" : "Required"}</dd></div>
          <div><dt>Allowed source</dt><dd>{index >= 2 ? "Exact revision" : "Waiting"}</dd></div>
          <div><dt>Browser wallet</dt><dd>{index >= 4 ? "Applicant controlled" : "Not requested"}</dd></div>
          <div><dt>Registry record</dt><dd>{stage === "registry" ? "Simulated finality" : "Not published"}</dd></div>
        </dl>
        <div className={styles.previewActions}>
          {previous ? (
            <button className={styles.secondaryButton} type="button" onClick={() => setStage(previous)}>
              Previous stage
            </button>
          ) : <span />}
          <button
            className="primary-button"
            type="button"
            disabled={!next}
            onClick={() => next && setStage(next)}
          >
            {copy.action}
            {next ? <ArrowRight aria-hidden="true" size={16} /> : <CircleCheck aria-hidden="true" size={16} />}
          </button>
        </div>
        <div className={styles.visuallyHidden} role="status">
          Local preview is showing {copy.title}
        </div>
      </section>
    </CustomLaunchFrame>
  );
}
