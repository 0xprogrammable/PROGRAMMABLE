import type {
  ApplicationHandleV3,
  LaunchDescriptorV2,
  LaunchEligibilityViewV2,
  PrincipalCustomLaunchApplicationSummaryV2,
  PrincipalLaunchAuthorityRefreshViewV1,
} from "./contract-v2";
import { CustomLaunchWebsiteRequestErrorV2 } from "./client-v2";

const DEFAULT_POLL_ATTEMPTS = 40;
const DEFAULT_POLL_DELAY_MS = 1_500;
export const LAUNCH_AUTHORITY_MINIMUM_REMAINING_MS_V1 = 30_000;

type RefreshClientV1 = Readonly<{
  launchAuthorityRefresh(
    applicationHandle: ApplicationHandleV3,
    request: Readonly<{
      schemaVersion: "programmable.principal-launch-authority-refresh-request.v1";
    }>,
    idempotencyKey: string,
  ): Promise<PrincipalLaunchAuthorityRefreshViewV1>;
}>;

export class LaunchAuthorityRefreshCancelledErrorV1 extends Error {}
export class LaunchAuthorityRefreshBindingErrorV1 extends Error {}
export class LaunchAuthorityRefreshFailedErrorV1 extends Error {}

export class LaunchAuthorityRefreshSingleFlightV1 {
  readonly #active = new Map<string, Promise<PrincipalLaunchAuthorityRefreshViewV1>>();

  run(
    key: string,
    operation: () => Promise<PrincipalLaunchAuthorityRefreshViewV1>,
  ): Promise<PrincipalLaunchAuthorityRefreshViewV1> {
    const existing = this.#active.get(key);
    if (existing !== undefined) return existing;
    const promise = operation().finally(() => {
      if (this.#active.get(key) === promise) this.#active.delete(key);
    });
    this.#active.set(key, promise);
    return promise;
  }
}

export function launchAuthorityRefreshIdempotencyKeyV1(input: Readonly<{
  application: PrincipalCustomLaunchApplicationSummaryV2;
  now?: number;
  currentValidUntil?: string;
  attempt?: number;
}>): string {
  const binding = input.application.launchEntitlementBindingHash;
  if (
    binding === null
    || !/^sha256:[0-9a-f]{64}$/u.test(binding)
    || !/^github-[0-9a-f]{64}$/u.test(input.application.applicationHandle)
  ) throw new LaunchAuthorityRefreshBindingErrorV1(
    "This exact GitHub submission has no current launch authority",
  );
  const now = input.now ?? Date.now();
  const attempt = input.attempt ?? 0;
  if (
    !Number.isFinite(now)
    || !Number.isSafeInteger(attempt)
    || attempt < 0
    || attempt > 10_000
  ) throw new TypeError("refresh generation is invalid");
  let generation: string;
  if (input.currentValidUntil === undefined) {
    generation = `initial:${input.application.updatedAt}`;
  } else {
    const validUntil = Date.parse(input.currentValidUntil);
    if (!Number.isFinite(validUntil)) {
      throw new LaunchAuthorityRefreshBindingErrorV1(
        "Launch authority expiry is invalid",
      );
    }
    const window = Math.max(0, Math.floor(
      (now - validUntil + LAUNCH_AUTHORITY_MINIMUM_REMAINING_MS_V1) / 60_000,
    ));
    generation = `ttl:${input.currentValidUntil}:${window}`;
  }
  return `launch-authority-refresh:${input.application.applicationHandle}:${binding}:${generation}:attempt:${attempt}`;
}

export function launchAuthorityNeedsRefreshV1(input: Readonly<{
  descriptor: LaunchDescriptorV2;
  eligibility: LaunchEligibilityViewV2;
  now?: number;
  minimumRemainingMs?: number;
}>): boolean {
  const now = input.now ?? Date.now();
  const minimumRemainingMs = input.minimumRemainingMs
    ?? LAUNCH_AUTHORITY_MINIMUM_REMAINING_MS_V1;
  const descriptorExpiry = Date.parse(input.descriptor.validUntil);
  const eligibilityExpiry = Date.parse(input.eligibility.validUntil);
  if (
    !Number.isFinite(now)
    || !Number.isSafeInteger(minimumRemainingMs)
    || minimumRemainingMs < 0
    || !Number.isFinite(descriptorExpiry)
    || !Number.isFinite(eligibilityExpiry)
  ) throw new LaunchAuthorityRefreshBindingErrorV1(
    "Launch authority expiry is invalid",
  );
  return Math.min(descriptorExpiry, eligibilityExpiry) <= now + minimumRemainingMs;
}

export function launchAuthorityRefreshRequiredV1(input: Readonly<{
  descriptor: LaunchDescriptorV2;
  eligibility: LaunchEligibilityViewV2;
  forceFreshObservation: boolean;
  refreshCompleted: boolean;
  now?: number;
}>): boolean {
  return (input.forceFreshObservation && !input.refreshCompleted)
    || launchAuthorityNeedsRefreshV1(input);
}

export function launchAuthorityObservationMatchesSetupV1(input: Readonly<{
  refresh: PrincipalLaunchAuthorityRefreshViewV1;
  descriptor: LaunchDescriptorV2;
  eligibility: LaunchEligibilityViewV2;
}>): boolean {
  return input.refresh.state === "current"
    && input.refresh.grantId === input.descriptor.grantId
    && input.refresh.grantBindingHash === input.descriptor.grantBindingHash
    && input.refresh.grantId === input.eligibility.grantId
    && input.refresh.grantBindingHash === input.eligibility.grantBindingHash
    && input.refresh.validUntil === input.descriptor.validUntil
    && input.refresh.validUntil === input.eligibility.validUntil;
}

export async function pollPrincipalLaunchAuthorityRefreshV1(input: Readonly<{
  client: RefreshClientV1;
  application: PrincipalCustomLaunchApplicationSummaryV2;
  idempotencyKey: string;
  isActive: () => boolean;
  attempts?: number;
  delayMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}>): Promise<PrincipalLaunchAuthorityRefreshViewV1> {
  if (
    input.application.state !== "ready_for_registration"
    && input.application.state !== "approved"
  ) throw new LaunchAuthorityRefreshBindingErrorV1(
    "This exact GitHub submission is not ready for launch verification",
  );
  if (
    input.application.receiptDigest === null
    || input.application.launchEntitlementBindingHash === null
  ) throw new LaunchAuthorityRefreshBindingErrorV1(
    "This exact GitHub submission has no current launch authority",
  );
  const attempts = input.attempts ?? DEFAULT_POLL_ATTEMPTS;
  const delayMs = input.delayMs ?? DEFAULT_POLL_DELAY_MS;
  const wait = input.delay ?? ((milliseconds: number) => new Promise<void>(
    (resolve) => window.setTimeout(resolve, milliseconds),
  ));
  const now = input.now ?? Date.now;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 100) {
    throw new TypeError("refresh poll attempts are invalid");
  }
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 10_000) {
    throw new TypeError("refresh poll delay is invalid");
  }
  let identity: PrincipalLaunchAuthorityRefreshViewV1 | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!input.isActive()) throw new LaunchAuthorityRefreshCancelledErrorV1();
    let snapshot: PrincipalLaunchAuthorityRefreshViewV1;
    try {
      snapshot = await input.client.launchAuthorityRefresh(
        input.application.applicationHandle,
        { schemaVersion: "programmable.principal-launch-authority-refresh-request.v1" },
        input.idempotencyKey,
      );
    } catch (caught) {
      if (
        caught instanceof CustomLaunchWebsiteRequestErrorV2
        && (caught.status === 408 || caught.status === 425 || caught.status === 429
          || caught.status >= 500)
      ) {
        await wait(delayMs);
        continue;
      }
      throw caught;
    }
    if (!input.isActive()) throw new LaunchAuthorityRefreshCancelledErrorV1();
    assertLaunchAuthorityRefreshBindingV1(snapshot, input.application, identity);
    identity ??= snapshot;
    if (snapshot.state === "current") {
      if (Date.parse(snapshot.validUntil!) <= now()) {
        throw new LaunchAuthorityRefreshBindingErrorV1(
          "Launch verification returned an expired source observation",
        );
      }
      return snapshot;
    }
    if (snapshot.state === "failed") {
      throw new LaunchAuthorityRefreshFailedErrorV1(
        "Final source verification could not be completed. Try again shortly",
      );
    }
    await wait(delayMs);
  }
  throw new Error("Final source verification is still running. Try again shortly");
}

export function assertLaunchAuthorityRefreshBindingV1(
  snapshot: PrincipalLaunchAuthorityRefreshViewV1,
  application: PrincipalCustomLaunchApplicationSummaryV2,
  previous: PrincipalLaunchAuthorityRefreshViewV1 | null = null,
): void {
  if (
    snapshot.applicationId !== application.applicationId
    || snapshot.applicationHandle !== application.applicationHandle
    || snapshot.grantBindingHash !== application.launchEntitlementBindingHash
    || (previous !== null && (
      snapshot.requestId !== previous.requestId
      || snapshot.requestDigest !== previous.requestDigest
      || snapshot.applicationId !== previous.applicationId
      || snapshot.applicationHandle !== previous.applicationHandle
      || snapshot.grantId !== previous.grantId
      || snapshot.grantBindingHash !== previous.grantBindingHash
      || snapshot.requestedAt !== previous.requestedAt
    ))
  ) throw new LaunchAuthorityRefreshBindingErrorV1(
    "Launch verification returned a different approved identity and was stopped",
  );
}
