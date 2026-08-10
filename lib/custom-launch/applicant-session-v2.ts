import { CustomLaunchWebsiteRequestErrorV2 } from "./client-v2";
import {
  customApplicationIntakeIsLaunchableV2,
  type CustomLaunchWebsiteSessionV2,
  type PrincipalCustomLaunchApplicationSummaryV2,
} from "./contract-v2";

export type CustomLaunchApplicantRecoveryV2 =
  | "none"
  | "reconnect-github"
  | "connect-wallet"
  | "retry";

export class CustomLaunchApplicantSessionErrorV2 extends Error {
  constructor(
    readonly reason: "authentication" | "wallet" | "superseded",
    message: string,
  ) {
    super(message);
    this.name = "CustomLaunchApplicantSessionErrorV2";
  }
}

export type CustomLaunchApplicantSessionBoundaryV2 = Readonly<{
  authReady: boolean;
  authenticated: boolean;
  githubConnected: boolean;
  githubUserId: string;
  walletAccount: string | null;
}>;

export type CustomLaunchApplicantAuthStateV2 = Readonly<{
  authReady: boolean;
  authenticated: boolean;
  githubConnected: boolean;
  githubUserId: string;
  walletAccount: string | null;
}>;

export type CustomLaunchApplicantFlowOwnerV2 = Readonly<{
  readonly flow: "custom-launch-applicant";
}>;

/**
 * Holds the single Applicant launch reservation across UI boundary changes.
 * Aborting a browser request cannot prove that its server mutation was unused,
 * so only the exact flow owner that acquired the reservation may release it.
 */
export class CustomLaunchApplicantSingleFlightV2 {
  #owner: CustomLaunchApplicantFlowOwnerV2 | null = null;

  get active(): boolean {
    return this.#owner !== null;
  }

  acquire(): CustomLaunchApplicantFlowOwnerV2 | null {
    if (this.#owner !== null) return null;
    const owner = Object.freeze({ flow: "custom-launch-applicant" as const });
    this.#owner = owner;
    return owner;
  }

  release(owner: CustomLaunchApplicantFlowOwnerV2): void {
    if (this.#owner === owner) this.#owner = null;
  }
}

export type CustomLaunchApplicantBoundarySnapshotV2 = Readonly<{
  key: string;
  generation: number;
}>;

/** Commit-phase boundary state used to invalidate work from an older render. */
export class CustomLaunchApplicantBoundaryGuardV2 {
  #key: string;
  #generation = 0;

  constructor(initialKey: string) {
    this.#key = initialKey;
  }

  snapshot(expectedKey: string): CustomLaunchApplicantBoundarySnapshotV2 {
    return Object.freeze({
      key: expectedKey,
      generation: this.#generation,
    });
  }

  commit(nextKey: string): boolean {
    if (this.#key === nextKey) return false;
    this.#key = nextKey;
    this.#generation += 1;
    return true;
  }

  isCurrent(snapshot: CustomLaunchApplicantBoundarySnapshotV2): boolean {
    return snapshot.key === this.#key
      && snapshot.generation === this.#generation;
  }
}

export type CustomLaunchApplicantDangerousStageV2 =
  | "challenge"
  | "preparation"
  | "wallet-signature"
  | "wallet-authentication"
  | "authorization"
  | "execution"
  | "wallet-send";

export function customLaunchApplicantStageRequiresExplicitSessionV2(
  stage: CustomLaunchApplicantDangerousStageV2,
): boolean {
  return stage === "wallet-signature" || stage === "wallet-send";
}

export async function refreshCurrentCustomLaunchApplicantStageV2(
  input: Readonly<{
    stage: CustomLaunchApplicantDangerousStageV2;
    assertCurrent: () => void;
    refreshSession: () => Promise<unknown>;
  }>,
): Promise<void> {
  input.assertCurrent();
  if (customLaunchApplicantStageRequiresExplicitSessionV2(input.stage)) {
    await input.refreshSession();
  }
  input.assertCurrent();
}

export async function runCurrentCustomLaunchApplicantSequenceV2<
  Challenge,
  Preparation,
  WalletProof,
  Authentication,
  Authorization,
  Execution,
  Send,
>(input: Readonly<{
  refreshBoundary: (stage: CustomLaunchApplicantDangerousStageV2) => Promise<void>;
  assertBoundary: () => void;
  createChallenge: () => Promise<Challenge>;
  bindPreparation: (challenge: Challenge) => Promise<Preparation>;
  signLaunchMessage: (context: Readonly<{
    challenge: Challenge;
    preparation: Preparation;
  }>) => Promise<WalletProof>;
  authenticateWallet: (context: Readonly<{
    challenge: Challenge;
    preparation: Preparation;
    walletProof: WalletProof;
  }>) => Promise<Authentication>;
  authorizeLaunch: (context: Readonly<{
    challenge: Challenge;
    preparation: Preparation;
    walletProof: WalletProof;
    authentication: Authentication;
  }>) => Promise<Authorization>;
  createExecutionPreparation: (context: Readonly<{
    challenge: Challenge;
    preparation: Preparation;
    walletProof: WalletProof;
    authentication: Authentication;
    authorization: Authorization;
  }>) => Promise<Execution>;
  sendBrowserWalletAction: (context: Readonly<{
    challenge: Challenge;
    preparation: Preparation;
    walletProof: WalletProof;
    authentication: Authentication;
    authorization: Authorization;
    execution: Execution;
  }>) => Promise<Send>;
}>): Promise<Readonly<{
  challenge: Challenge;
  preparation: Preparation;
  walletProof: WalletProof;
  authentication: Authentication;
  authorization: Authorization;
  execution: Execution;
  send: Send;
}>> {
  const runStage = async <Result>(
    stage: CustomLaunchApplicantDangerousStageV2,
    run: () => Promise<Result>,
  ): Promise<Result> => {
    await input.refreshBoundary(stage);
    input.assertBoundary();
    const result = await run();
    // A wallet transaction may already be broadcast when its Promise settles.
    // Return it for deterministic reporting even if the UI boundary changed.
    if (stage !== "wallet-send") input.assertBoundary();
    return result;
  };

  const challenge = await runStage("challenge", input.createChallenge);
  const preparation = await runStage(
    "preparation",
    () => input.bindPreparation(challenge),
  );
  const walletProof = await runStage(
    "wallet-signature",
    () => input.signLaunchMessage({ challenge, preparation }),
  );
  const authentication = await runStage(
    "wallet-authentication",
    () => input.authenticateWallet({ challenge, preparation, walletProof }),
  );
  const authorization = await runStage(
    "authorization",
    () => input.authorizeLaunch({
      challenge,
      preparation,
      walletProof,
      authentication,
    }),
  );
  const execution = await runStage(
    "execution",
    () => input.createExecutionPreparation({
      challenge,
      preparation,
      walletProof,
      authentication,
      authorization,
    }),
  );
  const send = await runStage(
    "wallet-send",
    () => input.sendBrowserWalletAction({
      challenge,
      preparation,
      walletProof,
      authentication,
      authorization,
      execution,
    }),
  );

  return Object.freeze({
    challenge,
    preparation,
    walletProof,
    authentication,
    authorization,
    execution,
    send,
  });
}

export function customLaunchApplicantSessionBoundaryKeyV2(
  boundary: CustomLaunchApplicantSessionBoundaryV2,
): string {
  return JSON.stringify([
    boundary.authReady,
    boundary.authenticated,
    boundary.githubConnected,
    boundary.githubUserId,
    boundary.walletAccount?.toLowerCase() ?? null,
  ]);
}

export async function acquireCurrentCustomLaunchWebsiteSessionV2(input: Readonly<{
  expectedGithubUserId: string;
  expectedGithubLogin: string;
  expectedWalletAccount: string;
  refreshApplicantSession: (requirement: Readonly<{
    githubUserId: string;
    githubLogin: string;
    launchWallet: `0x${string}`;
  }>) => Promise<Readonly<{
    accessToken: string;
    identityToken: string;
    privyUserId: string;
    githubUserId: string;
    githubLogin: string;
    launchWallet: `0x${string}`;
  }> | null>;
  isCurrent: () => boolean;
}>): Promise<CustomLaunchWebsiteSessionV2> {
  assertCurrentApplicantBoundaryV2(input.isCurrent);
  const expectedWalletAccount = normalizeApplicantWalletV2(
    input.expectedWalletAccount,
  );
  if (expectedWalletAccount === null) {
    throw new CustomLaunchApplicantSessionErrorV2(
      "wallet",
      "Connect your launch wallet to continue",
    );
  }
  if (
    !/^[1-9][0-9]{0,39}$/u.test(input.expectedGithubUserId)
    || input.expectedGithubLogin.trim().length === 0
  ) {
    throw new CustomLaunchApplicantSessionErrorV2(
      "authentication",
      "Reconnect GitHub to continue",
    );
  }

  let refreshed;
  try {
    // This is the sole Applicant token/currentness authority. The Wallet
    // provider refreshes Privy's user and ID-token state, proves the numeric
    // GitHub subject and exact wallet before and after token acquisition, and
    // returns one current Access/Identity pair.
    refreshed = await input.refreshApplicantSession({
      githubUserId: input.expectedGithubUserId,
      githubLogin: input.expectedGithubLogin,
      launchWallet: expectedWalletAccount as `0x${string}`,
    });
  } catch {
    refreshed = null;
  }
  assertCurrentApplicantBoundaryV2(input.isCurrent);
  if (!refreshed) {
    throw new CustomLaunchApplicantSessionErrorV2(
      "authentication",
      "Reconnect GitHub to continue",
    );
  }
  if (
    refreshed.githubUserId !== input.expectedGithubUserId
    || refreshed.githubLogin.toLowerCase()
      !== input.expectedGithubLogin.toLowerCase()
    || normalizeApplicantWalletV2(refreshed.launchWallet)
      !== expectedWalletAccount
  ) {
    throw new CustomLaunchApplicantSessionErrorV2(
      "superseded",
      "Reconnect the GitHub account and wallet approved in your submission",
    );
  }
  if (!refreshed.accessToken.trim() || !refreshed.identityToken.trim()) {
    throw new CustomLaunchApplicantSessionErrorV2(
      "authentication",
      "Reconnect GitHub to continue",
    );
  }

  return Object.freeze({
    accessToken: refreshed.accessToken,
    identityToken: refreshed.identityToken,
  });
}

export function customLaunchApplicantAuthStateEqualV2(
  left: CustomLaunchApplicantAuthStateV2,
  right: CustomLaunchApplicantAuthStateV2,
): boolean {
  return left.authReady === right.authReady
    && left.authenticated === right.authenticated
    && left.githubConnected === right.githubConnected
    && left.githubUserId === right.githubUserId
    && normalizeApplicantWalletV2(left.walletAccount)
      === normalizeApplicantWalletV2(right.walletAccount);
}

export function customLaunchApplicantRecoveryV2(
  caught: unknown,
): CustomLaunchApplicantRecoveryV2 {
  if (caught instanceof CustomLaunchApplicantSessionErrorV2) {
    return caught.reason === "wallet" ? "connect-wallet" : "reconnect-github";
  }
  if (caught instanceof CustomLaunchWebsiteRequestErrorV2) {
    if (
      caught.status === 401
      || caught.status === 403
      || caught.status === 404
      || caught.code === "github_account_required"
      || caught.code === "applicant_authentication_required"
    ) return "reconnect-github";
    if (
      caught.status === 408
      || caught.status === 425
      || caught.status === 429
      || caught.status >= 500
    ) return "retry";
  }
  return "none";
}

export async function runCustomLaunchApplicantReauthorizationV2<T>(
  input: Readonly<{
    reauthorizeGithub: () => Promise<void>;
    refreshCurrent: () => Promise<T>;
  }>,
): Promise<T> {
  await input.reauthorizeGithub();
  // Reauthorization only restores the provider grant. A canonical refreshed
  // Applicant session and server read must still succeed before UI recovery.
  return await input.refreshCurrent();
}

export function customApplicationHasDurableApprovalV2(
  application: PrincipalCustomLaunchApplicationSummaryV2,
  grantState: "ACTIVE" | "CONSUMED" | "REVOKED" | "SUSPENDED" | null = null,
): boolean {
  return customApplicationHasCurrentLaunchEntitlementV2(application)
    && grantState === "ACTIVE";
}

export function customApplicationHasCurrentLaunchEntitlementV2(
  application: PrincipalCustomLaunchApplicationSummaryV2,
): boolean {
  return customApplicationIntakeIsLaunchableV2(application)
    && application.state === "approved"
    && application.receiptDigest !== null
    && application.launchEntitlementBindingHash !== null;
}

export function assertCurrentCustomLaunchPrincipalV2(
  expected: string,
  observed: string,
): void {
  if (
    !/^sha256:[0-9a-f]{64}$/u.test(expected)
    || observed !== expected
  ) {
    throw new CustomLaunchApplicantSessionErrorV2(
      "superseded",
      "Reconnect the GitHub account that opened this submission",
    );
  }
}

function assertCurrentApplicantBoundaryV2(isCurrent: () => boolean): void {
  if (!isCurrent()) {
    throw new CustomLaunchApplicantSessionErrorV2(
      "superseded",
      "Your account or wallet changed. Reconnect GitHub and try again",
    );
  }
}

function normalizeApplicantWalletV2(value: string | null): string | null {
  return value !== null && /^0x[0-9a-f]{40}$/iu.test(value)
    ? value.toLowerCase()
    : null;
}
