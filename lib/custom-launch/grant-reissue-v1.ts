import {
  CustomLaunchWebsiteRequestErrorV2,
  createCustomLaunchWebsiteClientV2,
} from "./client-v2";
import type {
  ApplicationHandleV3,
  BrowserWalletGrantReissueViewV1,
  LaunchDescriptorV2,
  PrincipalCustomLaunchApplicationSummaryV2,
  Sha256DigestV2,
} from "./contract-v2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const APPLICATION_HANDLE = /^github-[0-9a-f]{64}$/u;
const RESPONSE_KEYS = [
  "analysisTaskId",
  "applicationHandle",
  "applicationId",
  "newGrantBindingHash",
  "newGrantId",
  "oldGrantId",
  "requestDigest",
  "requestId",
  "requestedAt",
  "schemaVersion",
  "state",
] as const;

export const LAUNCH_PREPARATION_REISSUE_REQUIRED =
  "LAUNCH_PREPARATION_REISSUE_REQUIRED" as const;

export type BrowserWalletGrantReissueIdentityV1 = Readonly<{
  requestId: string;
  requestDigest: Sha256DigestV2;
  analysisTaskId: string;
  applicationId: string;
  applicationHandle: ApplicationHandleV3;
  oldGrantId: string;
  requestedAt: string;
}>;

export type BrowserWalletGrantReissuePollResultV1 = Readonly<
  | { kind: "ready"; snapshot: BrowserWalletGrantReissueViewV1 }
  | { kind: "failed"; snapshot: BrowserWalletGrantReissueViewV1 }
  | { kind: "pending"; snapshot: BrowserWalletGrantReissueViewV1 }
>;

export class BrowserWalletGrantReissueCancelledV1 extends Error {}
export class BrowserWalletGrantReissueBindingErrorV1 extends Error {}

export class BrowserWalletGrantReissueSingleFlightV1 {
  readonly #inFlight = new Map<string, Promise<BrowserWalletGrantReissuePollResultV1>>();

  run(
    key: string,
    task: () => Promise<BrowserWalletGrantReissuePollResultV1>,
  ): Promise<BrowserWalletGrantReissuePollResultV1> {
    const current = this.#inFlight.get(key);
    if (current !== undefined) return current;
    const inFlight = task().finally(() => {
      if (this.#inFlight.get(key) === inFlight) this.#inFlight.delete(key);
    });
    this.#inFlight.set(key, inFlight);
    return inFlight;
  }
}

export function isLaunchPreparationReissueRequiredV1(
  error: unknown,
): error is CustomLaunchWebsiteRequestErrorV2 {
  return error instanceof CustomLaunchWebsiteRequestErrorV2
    && error.status === 409
    && error.code === LAUNCH_PREPARATION_REISSUE_REQUIRED;
}

export async function pollBrowserWalletGrantReissueV1(input: Readonly<{
  client: Pick<
    ReturnType<typeof createCustomLaunchWebsiteClientV2>,
    "reissueLaunchGrant"
  >;
  oldGrantId: string;
  applicationId: string;
  applicationHandle: ApplicationHandleV3;
  idempotencyKey: string;
  expectedIdentity?: BrowserWalletGrantReissueIdentityV1;
  isActive: () => boolean;
  maximumAttempts?: number;
  delay?: (milliseconds: number) => Promise<void>;
}>): Promise<BrowserWalletGrantReissuePollResultV1> {
  const maximumAttempts = input.maximumAttempts ?? 21;
  if (!UUID.test(input.oldGrantId) || maximumAttempts < 1 || maximumAttempts > 21) {
    throw new TypeError("Grant refresh input is invalid");
  }
  let expectedIdentity = input.expectedIdentity;
  let latest: BrowserWalletGrantReissueViewV1 | null = null;
  const wait = input.delay ?? delay;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    if (!input.isActive()) throw new BrowserWalletGrantReissueCancelledV1();
    try {
      latest = assertBrowserWalletGrantReissueV1(
        await input.client.reissueLaunchGrant({
          oldGrantId: input.oldGrantId,
          idempotencyKey: input.idempotencyKey,
          request: {
            schemaVersion: "programmable.browser-wallet-grant-reissue-request.v1",
          },
        }),
        {
          applicationId: input.applicationId,
          applicationHandle: input.applicationHandle,
          oldGrantId: input.oldGrantId,
          expectedIdentity,
        },
      );
    } catch (error) {
      if (
        attempt + 1 >= maximumAttempts
        || !(error instanceof CustomLaunchWebsiteRequestErrorV2)
        || (error.status !== 429 && error.status < 500)
      ) throw error;
      await wait(attempt === 0 ? 2_000 : 3_000);
      continue;
    }
    if (!input.isActive()) throw new BrowserWalletGrantReissueCancelledV1();
    expectedIdentity ??= browserWalletGrantReissueIdentityV1(latest);
    if (latest.state === "ready") return { kind: "ready", snapshot: latest };
    if (latest.state === "failed") return { kind: "failed", snapshot: latest };
    if (attempt + 1 < maximumAttempts) {
      await wait(attempt === 0 ? 2_000 : 3_000);
    }
  }
  if (latest === null) throw new Error("Approval refresh status is unavailable");
  return { kind: "pending", snapshot: latest };
}

export function assertBrowserWalletGrantReissueV1(
  value: BrowserWalletGrantReissueViewV1,
  expected: Readonly<{
    applicationId: string;
    applicationHandle: ApplicationHandleV3;
    oldGrantId: string;
    expectedIdentity?: BrowserWalletGrantReissueIdentityV1;
  }>,
): BrowserWalletGrantReissueViewV1 {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || !exactKeys(value as unknown as Record<string, unknown>, RESPONSE_KEYS)
    || value.schemaVersion !== "programmable.browser-wallet-grant-reissue.v2"
    || !["pending", "ready", "failed"].includes(value.state)
    || !UUID.test(value.requestId)
    || !DIGEST.test(value.requestDigest)
    || !UUID.test(value.analysisTaskId)
    || value.applicationId !== expected.applicationId
    || value.applicationHandle !== expected.applicationHandle
    || !APPLICATION_HANDLE.test(value.applicationHandle)
    || value.oldGrantId !== expected.oldGrantId
    || !Number.isFinite(Date.parse(value.requestedAt))
    || (value.state === "ready") !== (value.newGrantId !== null)
    || (value.newGrantId === null) !== (value.newGrantBindingHash === null)
    || (value.newGrantId !== null && (
      !UUID.test(value.newGrantId)
      || value.newGrantId === value.oldGrantId
    ))
    || (value.newGrantBindingHash !== null && !DIGEST.test(value.newGrantBindingHash))
    || (expected.expectedIdentity !== undefined
      && !sameReissueIdentity(
        browserWalletGrantReissueIdentityV1(value),
        expected.expectedIdentity,
      ))
  ) {
    throw new BrowserWalletGrantReissueBindingErrorV1(
      "The new approval did not match this launch. Nothing was submitted",
    );
  }
  return value;
}

export function assertFreshReissuedGrantV1(input: Readonly<{
  oldDescriptor: LaunchDescriptorV2;
  freshDescriptor: LaunchDescriptorV2;
  reissue: BrowserWalletGrantReissueViewV1;
  originalApplication: PrincipalCustomLaunchApplicationSummaryV2;
  freshApplication: PrincipalCustomLaunchApplicationSummaryV2;
}>): void {
  const {
    freshApplication,
    freshDescriptor,
    oldDescriptor,
    originalApplication,
    reissue,
  } = input;
  const oldExpiry = Date.parse(oldDescriptor.validUntil);
  const freshExpiry = Date.parse(freshDescriptor.validUntil);
  if (
    reissue.state !== "ready"
    || reissue.newGrantId === null
    || reissue.newGrantBindingHash === null
    || reissue.applicationId !== originalApplication.applicationId
    || reissue.applicationHandle !== originalApplication.applicationHandle
    || reissue.oldGrantId !== oldDescriptor.grantId
    || reissue.newGrantId === oldDescriptor.grantId
    || freshDescriptor.applicationId !== originalApplication.applicationId
    || freshDescriptor.applicationHandle !== originalApplication.applicationHandle
    || oldDescriptor.applicationHandle !== originalApplication.applicationHandle
    || freshDescriptor.grantId !== reissue.newGrantId
    || freshDescriptor.grantBindingHash !== reissue.newGrantBindingHash
    || freshDescriptor.descriptorHash === oldDescriptor.descriptorHash
    || !Number.isFinite(oldExpiry)
    || !Number.isFinite(freshExpiry)
    || freshExpiry <= oldExpiry
    || freshApplication.applicationId !== originalApplication.applicationId
    || freshApplication.applicationHandle !== originalApplication.applicationHandle
    || freshApplication.revisionId !== originalApplication.revisionId
    || freshApplication.repositoryId !== originalApplication.repositoryId
    || freshApplication.repositoryFullName !== originalApplication.repositoryFullName
    || freshApplication.pullRequestNumber !== originalApplication.pullRequestNumber
    || freshApplication.commitOid !== originalApplication.commitOid
    || freshApplication.state !== "approved"
    || freshApplication.receiptDigest !== originalApplication.receiptDigest
    || freshApplication.launchEntitlementBindingHash === null
  ) {
    throw new BrowserWalletGrantReissueBindingErrorV1(
      "The approved GitHub version changed. Review its current status before trying again",
    );
  }
}

export function browserWalletGrantReissueIdentityV1(
  value: BrowserWalletGrantReissueViewV1,
): BrowserWalletGrantReissueIdentityV1 {
  return {
    requestId: value.requestId,
    requestDigest: value.requestDigest,
    analysisTaskId: value.analysisTaskId,
    applicationId: value.applicationId,
    applicationHandle: value.applicationHandle,
    oldGrantId: value.oldGrantId,
    requestedAt: value.requestedAt,
  };
}

function sameReissueIdentity(
  left: BrowserWalletGrantReissueIdentityV1,
  right: BrowserWalletGrantReissueIdentityV1,
): boolean {
  return left.requestId === right.requestId
    && left.requestDigest === right.requestDigest
    && left.analysisTaskId === right.analysisTaskId
    && left.applicationId === right.applicationId
    && left.applicationHandle === right.applicationHandle
    && left.oldGrantId === right.oldGrantId
    && left.requestedAt === right.requestedAt;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return keys.length === canonical.length
    && keys.every((key, index) => key === canonical[index]);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
