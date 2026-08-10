"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getAddress } from "viem";

import { GitHubBrandIcon } from "@/components/brand-icons";
import styles from "@/components/manual-applicant-launch.module.css";
import {
  useWallet,
  type WalletApplicantIdentityRequirementV1,
  type WalletApplicantSessionV1,
} from "@/components/wallet-provider";
import { getActiveManualRouterProductionBindingV2 } from
  "@/lib/custom-launch/manual-router-bindings-v2";
import {
  HOOKEMON_APPLICANT_IDENTITY_V1,
  isExactHookemonApplicantGithubLoginV1,
} from "@/lib/custom-launch/hookemon-applicant-presentation-v1";
import {
  type ManualRouterApplicantListResponseV1,
  type ManualRouterPersistedAttemptV1,
  type ManualRouterResolveResponseV1,
  type ManualRouterSha256V1,
  type ManualRouterSubmissionSummaryV1,
} from "@/lib/custom-launch/manual-router-contract-v1";
import type {
  ManualRouterApplicantListResponseV2,
  ManualRouterNestedFactorySubmissionSummaryV2,
  ManualRouterPersistedAttemptV2,
  ManualRouterResolveResponseV2,
  ManualRouterRouteAcceptancePlanV1,
  ManualRouterRouteAcceptanceStateResponseV1,
  ManualRouterRouteBindingV2,
  ManualRouterSubmissionSummaryV2,
} from "@/lib/custom-launch/manual-router-contract-v2";
import {
  acceptManualRouterReviewedRouteV1,
  listManualRouterApplicantSubmissionsV1,
  listManualRouterApplicantSubmissionsVersionedV2,
  ManualRouterWebsiteRequestErrorV1,
  readManualRouterRouteAcceptanceStateV1,
  reportManualRouterApplicantTransactionV1,
  reportManualRouterApplicantTransactionV2,
  requestManualRouterApplicantFinalityV1,
  requestManualRouterApplicantFinalityV2,
  resolveManualRouterApplicantSubmissionV1,
  resolveManualRouterApplicantSubmissionV2,
  type ManualRouterWebsiteSessionV1,
} from "@/lib/custom-launch/manual-router-client-v1";
import {
  manualRouterBlocksNewSendV1,
  manualRouterBlocksNewSendV2,
  manualRouterCanClearUncertainNoSendV1,
  manualRouterCanClearUncertainNoSendV2,
  manualRouterDirectoryForApplicantV2,
  manualRouterFreshReadyMatchesCachedV1,
  manualRouterFreshReadyMatchesCachedV2,
  MANUAL_ROUTER_EXACT_SHARDS_V1_BROWSER_BINDING,
  manualRouterIsExactShardsV1ApplicantDirectory,
  manualRouterResolveForApplicantV2,
  manualRouterRouteFactsV2,
  manualRouterTransactionContextV1,
  manualRouterTransactionContextV2,
  parseManualRouterPersistedAttemptStorageV1,
  parseManualRouterPersistedAttemptStorageV2,
  reconcileManualRouterBrowserAttemptV1,
  reconcileManualRouterBrowserAttemptV2,
  type ManualRouterAttemptArchiveReasonV1,
  type ManualRouterPersistedAttemptReadV1,
  type ManualRouterPersistedAttemptReadV2,
} from "@/lib/custom-launch/manual-router-browser-state-v1";

const FINALITY_POLL_MS = 15_000;
const LIST_REFRESH_MS = 30_000;
const APPLICANT_AUTH_RECOVERY_CODES = new Set([
  "applicant_authentication_required",
  "applicant_identity_changed",
  "applicant_session_changed",
  "applicant_reauthorization_required",
  "github_subject_mismatch",
]);
// Presentation routing only. The server re-observes and authorizes the numeric
// GitHub identity before it returns or records any Shards acceptance state.
const SHARDS_GITHUB_LOGIN = "jesse-stahl";
const SHARDS_APPLICANT_IDENTITY_REQUIREMENT_V1 = Object.freeze({
  githubUserId:
    MANUAL_ROUTER_EXACT_SHARDS_V1_BROWSER_BINDING.authenticatedGitHubUserId,
  githubLogin: SHARDS_GITHUB_LOGIN,
  launchWallet:
    MANUAL_ROUTER_EXACT_SHARDS_V1_BROWSER_BINDING.linkedLaunchWallet,
}) satisfies WalletApplicantIdentityRequirementV1;
const HOOKEMON_APPLICANT_IDENTITY_REQUIREMENT_V1 = Object.freeze({
  githubUserId: HOOKEMON_APPLICANT_IDENTITY_V1.githubUserId,
  githubLogin: HOOKEMON_APPLICANT_IDENTITY_V1.githubLogin,
  launchWallet: HOOKEMON_APPLICANT_IDENTITY_V1.launchWallet,
}) satisfies WalletApplicantIdentityRequirementV1;
const ATTEMPT_STORAGE_PREFIX = "programmable:manual-router-browser-attempt:v1";
const ATTEMPT_STORAGE_PREFIX_V2 =
  "programmable:manual-router-browser-attempt:v2";
const NESTED_FACTORY_ACTIVATION = (() => {
  try {
    return getActiveManualRouterProductionBindingV2();
  } catch {
    return null;
  }
})();

type ReadyResolveV1 = Extract<ManualRouterResolveResponseV1, {
  status: "ready";
}>;
type ReadyResolveV2 = Extract<ManualRouterResolveResponseV2, {
  status: "ready";
}>;
type ReadyResolve = ReadyResolveV1 | ReadyResolveV2;
type ManualRouterDirectory =
  | ManualRouterApplicantListResponseV1
  | ManualRouterApplicantListResponseV2;
type ManualRouterResolved =
  | ManualRouterResolveResponseV1
  | ManualRouterResolveResponseV2;
type ManualRouterPersistedAttempt =
  | ManualRouterPersistedAttemptV1
  | ManualRouterPersistedAttemptV2;
type ManualRouterSubmission =
  | ManualRouterSubmissionSummaryV1
  | ManualRouterSubmissionSummaryV2;
type ManualRouterTransaction = Readonly<{
  launchWallet: `0x${string}`;
  subjectHash: ManualRouterSha256V1;
  descriptorHash: ManualRouterSha256V1;
  preparationHash: ManualRouterSha256V1;
  transactionHash: `0x${string}`;
}> & (
  | Readonly<{ lane: "v1" }>
  | Readonly<{
      lane: "v2";
      routeBindingHash: ManualRouterSha256V1;
    }>
  );

export function manualRouterApplicantDiscoveryReady(input: Readonly<{
  authReady: boolean;
  authenticated: boolean;
  githubConnected: boolean;
  walletConnected: boolean;
  routeDiscoveryAllowed: boolean;
}>): boolean {
  return input.authReady
    && input.authenticated
    && input.githubConnected
    && input.walletConnected
    && input.routeDiscoveryAllowed;
}

export function applicantIdentityRequirementForLoginV1(
  login: string | null,
): WalletApplicantIdentityRequirementV1 | undefined {
  if (isExactShardsGithubLogin(login)) {
    return SHARDS_APPLICANT_IDENTITY_REQUIREMENT_V1;
  }
  if (isExactHookemonApplicantGithubLoginV1(login)) {
    return HOOKEMON_APPLICANT_IDENTITY_REQUIREMENT_V1;
  }
  return undefined;
}

export function manualRouterApplicantIdentityRequirementV1(input: Readonly<{
  githubUserId: string;
  githubLogin: string;
  launchWallet: `0x${string}`;
}>): WalletApplicantIdentityRequirementV1 {
  return Object.freeze({
    githubUserId: input.githubUserId,
    githubLogin: input.githubLogin,
    launchWallet: input.launchWallet,
  });
}

export function manualRouterApplicantAuthRecoveryRequiredV1(
  errorCode: string,
): boolean {
  return APPLICANT_AUTH_RECOVERY_CODES.has(errorCode);
}

export async function acquireManualRouterWebsiteSessionV1(input: Readonly<{
  refreshApplicantSession: (
    requirement?: WalletApplicantIdentityRequirementV1,
  ) => Promise<WalletApplicantSessionV1 | null>;
  requirement?: WalletApplicantIdentityRequirementV1;
}>): Promise<ManualRouterWebsiteSessionV1> {
  const session = await input.refreshApplicantSession(input.requirement);
  if (!session) {
    throw new ManualRouterWebsiteRequestErrorV1(
      401,
      "applicant_authentication_required",
      "Sign in with your approved GitHub account",
      false,
    );
  }
  if (
    !/^[1-9][0-9]{0,39}$/u.test(session.githubUserId)
    || !/^0x[0-9a-f]{40}$/iu.test(session.launchWallet)
    || (
      input.requirement !== undefined
      && (
        session.githubUserId !== input.requirement.githubUserId
        || session.githubLogin.toLowerCase()
          !== input.requirement.githubLogin.toLowerCase()
        || session.launchWallet.toLowerCase()
          !== input.requirement.launchWallet.toLowerCase()
      )
    )
  ) {
    throw new ManualRouterWebsiteRequestErrorV1(
      403,
      "applicant_identity_changed",
      "Reconnect the GitHub account and wallet approved in your submission",
      false,
    );
  }
  return {
    accessToken: session.accessToken,
    identityToken: session.identityToken,
  };
}

export async function runManualRouterRequestWithFreshSessionV1<T>(
  getSession: () => Promise<ManualRouterWebsiteSessionV1>,
  request: (session: ManualRouterWebsiteSessionV1) => Promise<T>,
): Promise<T> {
  const session = await getSession();
  return await request(session);
}

export function ManualApplicantLaunch({ onBack }: { onBack: () => void }) {
  const {
    authReady,
    authenticated,
    connectGithub,
    githubConnected,
    githubUserId,
    githubUsername,
    openWallet,
    refreshApplicantSession,
    reauthorizeGithub,
    sendBrowserWalletAction,
    wallet,
  } = useWallet();
  const [directory, setDirectory] =
    useState<ManualRouterDirectory | null>(null);
  const [selectedSubjectHash, setSelectedSubjectHash] =
    useState<ManualRouterSha256V1 | "">("");
  const [resolved, setResolved] =
    useState<ManualRouterResolved | null>(null);
  const [routeAcceptance, setRouteAcceptance] =
    useState<ManualRouterRouteAcceptanceStateResponseV1 | null>(null);
  const [attempt, setAttempt] =
    useState<ManualRouterPersistedAttempt | null>(null);
  const [storageRecoveryRequired, setStorageRecoveryRequired] = useState(false);
  const [noSendAttested, setNoSendAttested] = useState(false);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingAcceptance, setLoadingAcceptance] = useState(false);
  const [acceptingRoute, setAcceptingRoute] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [reauthorizing, setReauthorizing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const loadAbortRef = useRef<AbortController | null>(null);
  const acceptanceAbortRef = useRef<AbortController | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  const loadSequenceRef = useRef(0);
  const launchLockRef = useRef(false);
  const finalityLockRef = useRef(false);
  const exactShardsApplicant = isExactShardsGithubLogin(githubUsername);
  const exactHookemonApplicant =
    isExactHookemonApplicantGithubLoginV1(githubUsername);
  const exactShardsV1Compatibility = exactShardsApplicant
    && NESTED_FACTORY_ACTIVATION === null
    && directory !== null
    && manualRouterIsExactShardsV1ApplicantDirectory(directory);
  const shardsRouteCapabilityUnavailable = exactShardsApplicant
    && NESTED_FACTORY_ACTIVATION === null
    && directory !== null
    && !exactShardsV1Compatibility;
  // The Website must not infer an executable Hookemon action from source
  // metadata. This stays hard-disabled until one immutable mixed-provenance
  // profile, Facade and Authority release are bound together.
  const hookemonRouteCapabilityUnavailable = exactHookemonApplicant;
  const routeAcceptanceRequired = exactShardsApplicant
    && NESTED_FACTORY_ACTIVATION !== null;
  const routeDiscoveryAllowed = !exactShardsApplicant
    || NESTED_FACTORY_ACTIVATION === null
    || routeAcceptance?.state === "accepted";
  const routeAccepted = exactHookemonApplicant
    ? false
    : !exactShardsApplicant
      || exactShardsV1Compatibility
      || (
        NESTED_FACTORY_ACTIVATION !== null
        && routeAcceptance?.state === "accepted"
      );
  const applicantIdentityRequirement =
    applicantIdentityRequirementForLoginV1(githubUsername);

  const getSession = useCallback(async (
    requirement?: WalletApplicantIdentityRequirementV1,
  ): Promise<ManualRouterWebsiteSessionV1> => {
    return acquireManualRouterWebsiteSessionV1({
      refreshApplicantSession,
      requirement: requirement ?? applicantIdentityRequirement,
    });
  }, [applicantIdentityRequirement, refreshApplicantSession]);

  const loadRouteAcceptance = useCallback(async () => {
    if (
      NESTED_FACTORY_ACTIVATION === null
      || !authReady
      || !authenticated
      || !githubConnected
      || !isExactShardsGithubLogin(githubUsername)
    ) {
      setRouteAcceptance(null);
      return;
    }
    acceptanceAbortRef.current?.abort();
    const controller = new AbortController();
    acceptanceAbortRef.current = controller;
    setLoadingAcceptance(true);
    try {
      const next = await readManualRouterRouteAcceptanceStateV1({
        session: await getSession(),
        claimSha256: NESTED_FACTORY_ACTIVATION.acceptanceClaimSha256,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setRouteAcceptance(next);
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (!manualRouterRetainsKnownApprovalV1(caught)) {
        setRouteAcceptance(null);
      }
      setError(errorMessage(caught));
      setErrorCode(errorCodeOf(caught));
    } finally {
      if (acceptanceAbortRef.current === controller) {
        acceptanceAbortRef.current = null;
      }
      if (!controller.signal.aborted) setLoadingAcceptance(false);
    }
  }, [authReady, authenticated, getSession, githubConnected, githubUsername]);

  useEffect(() => {
    if (
      NESTED_FACTORY_ACTIVATION === null
      || !authReady
      || !authenticated
      || !githubConnected
      || !isExactShardsGithubLogin(githubUsername)
    ) return;
    const kickoff = window.setTimeout(() => void loadRouteAcceptance(), 0);
    return () => window.clearTimeout(kickoff);
  }, [authReady, authenticated, githubConnected, githubUsername, loadRouteAcceptance]);

  const acceptReviewedRoute = useCallback(async () => {
    if (
      NESTED_FACTORY_ACTIVATION === null
      || routeAcceptance?.state !== "pending"
      || acceptingRoute
    ) return;
    setAcceptingRoute(true);
    setError("");
    setErrorCode("");
    try {
      const next = await acceptManualRouterReviewedRouteV1({
        session: await getSession(),
        expectedStateVersion: routeAcceptance.stateVersion,
        claimSha256: NESTED_FACTORY_ACTIVATION.acceptanceClaimSha256,
      });
      if (next.state !== "accepted") {
        throw new Error("The reviewed route acceptance was not recorded");
      }
      setRouteAcceptance(next);
      setStatus("Exact nested-factory route accepted. You may connect the launch wallet");
    } catch (caught) {
      setError(errorMessage(caught));
      setErrorCode(errorCodeOf(caught));
    } finally {
      setAcceptingRoute(false);
    }
  }, [acceptingRoute, getSession, routeAcceptance]);

  const loadDirectory = useCallback(async (options?: Readonly<{
    quiet?: boolean;
    preferredSubjectHash?: ManualRouterSha256V1 | "";
  }>) => {
    if (!wallet || !manualRouterApplicantDiscoveryReady({
      authReady,
      authenticated,
      githubConnected,
      walletConnected: true,
      routeDiscoveryAllowed,
    })) return;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const sequence = ++loadSequenceRef.current;
    if (!options?.quiet) setLoading(true);
    try {
      const directoryResponse = await runManualRouterRequestWithFreshSessionV1(
        getSession,
        async (session) => {
          const request = {
            session,
            launchWallet: wallet.account,
            signal: controller.signal,
          } as const;
          return NESTED_FACTORY_ACTIVATION === null
            ? await listManualRouterApplicantSubmissionsV1(request)
            : await listManualRouterApplicantSubmissionsVersionedV2(request);
        },
      );
      const next = manualRouterDirectoryForApplicantV2({
        directory: directoryResponse,
        requireExactShardsRoute: exactShardsApplicant,
      });
      if (controller.signal.aborted || sequence !== loadSequenceRef.current) return;
      const preferred = options?.preferredSubjectHash || selectedSubjectHash;
      const chosen = next.submissions.some(({ subjectHash }) =>
        subjectHash === preferred)
        ? preferred
        : preferredSubmission(next.submissions)?.subjectHash ?? "";
      setSelectedSubjectHash(chosen);
      const chosenSubmission = next.submissions.find(({ subjectHash }) =>
        subjectHash === chosen) ?? null;
      if (chosenSubmission !== null) {
        const chosenSubjectHash = chosenSubmission.subjectHash;
        const currentRequirement = manualRouterApplicantIdentityRequirementV1({
          githubUserId: next.authenticatedGitHubUserId,
          githubLogin: githubUsername,
          launchWallet: next.linkedLaunchWallet,
        });
        const rawResolved = await runManualRouterRequestWithFreshSessionV1(
          () => getSession(currentRequirement),
          async (session) => {
            const resolveRequest = {
              session,
              launchWallet: next.linkedLaunchWallet,
              subjectHash: chosenSubjectHash,
              signal: controller.signal,
            } as const;
            return isNestedFactorySubmissionV2(chosenSubmission)
              ? await resolveManualRouterApplicantSubmissionV2(resolveRequest)
              : await resolveManualRouterApplicantSubmissionV1(resolveRequest);
          },
        );
        const nextResolved = manualRouterResolveForApplicantV2({
          directory: next,
          resolved: rawResolved,
          requireExactShardsRoute: exactShardsApplicant,
        });
        if (controller.signal.aborted || sequence !== loadSequenceRef.current) return;
        setResolved(nextResolved);
        const stored = isManualRouterResolveV2(nextResolved)
          ? readPersistedAttemptV2(chosenSubjectHash)
          : readPersistedAttempt(chosenSubjectHash);
        const serverResolvesCorruptAttempt = nextResolved.status !== "ready";
        let localRecoveryBlocked = false;
        if (stored.kind === "corrupt" && !serverResolvesCorruptAttempt) {
          localRecoveryBlocked = true;
          setAttempt(null);
          setStorageRecoveryRequired(true);
          setNoSendAttested(false);
          setStatus(
            "The saved browser attempt is unreadable. Do not launch again until you recover its hash or confirm no transaction was sent",
          );
        } else {
          if (stored.kind === "corrupt") {
            archiveCorruptAttempt(
              chosenSubjectHash,
              stored.raw,
              `server-${nextResolved.status}`,
              isManualRouterResolveV2(nextResolved),
            );
            removePersistedAttempt(
              chosenSubjectHash,
              isManualRouterResolveV2(nextResolved),
            );
          }
          const reconciliation = isManualRouterResolveV2(nextResolved)
            ? reconcileManualRouterBrowserAttemptV2({
                attempt: stored.kind === "valid"
                  && isManualRouterPersistedAttemptV2(stored.attempt)
                  ? stored.attempt
                  : null,
                resolved: nextResolved,
                launchWallet: next.linkedLaunchWallet,
                nowIso: new Date().toISOString(),
              })
            : reconcileManualRouterBrowserAttemptV1({
                attempt: stored.kind === "valid"
                  && !isManualRouterPersistedAttemptV2(stored.attempt)
                  ? stored.attempt
                  : null,
                resolved: nextResolved,
                launchWallet: next.linkedLaunchWallet,
                nowIso: new Date().toISOString(),
              });
          if (reconciliation.archive && reconciliation.archiveReason) {
            archivePersistedAttempt(
              reconciliation.archive,
              reconciliation.archiveReason,
            );
          }
          if (reconciliation.recoveryRequired) {
            localRecoveryBlocked = true;
            setAttempt(null);
            setStorageRecoveryRequired(true);
            setNoSendAttested(false);
            setStatus(
              "The saved browser attempt does not match this verified launch action. Do not launch again until you recover its hash or confirm no transaction was sent",
            );
          } else if (reconciliation.active === null) {
            if (reconciliation.archive !== null) {
              removePersistedAttempt(
                chosenSubjectHash,
                isManualRouterResolveV2(nextResolved),
              );
            }
          } else if (
            stored.kind !== "valid"
            || stored.attempt !== reconciliation.active
            || stored.attempt.phase !== reconciliation.active.phase
            || stored.attempt.transactionHash
              !== reconciliation.active.transactionHash
          ) {
            writePersistedAttempt(reconciliation.active);
          }
          if (!reconciliation.recoveryRequired) {
            setAttempt(reconciliation.active);
            setStorageRecoveryRequired(false);
            setNoSendAttested(false);
          }
        }
        if (localRecoveryBlocked) {
          // The fail-closed recovery status above must remain visible.
        } else if (nextResolved.status === "finalized") {
          setStatus(isManualRouterResolveV2(nextResolved)
            ? nextResolved.executionMode === "EXACT_EXISTING_LAUNCH_ADOPTED"
              ? "Sponsored launch adopted and finalized with its exact Router stamp"
              : "Exact factory launch executed, stamped and finalized"
            : "Launch finalized. The canonical Router scanner will publish it after 64 confirmations");
        } else if (nextResolved.status === "ready") {
          setStatus("Approved launch loaded. Wallet confirmation is available");
        } else if (nextResolved.status === "permit-not-yet-valid") {
          setStatus("Your approval is retained. Launch is temporarily unavailable");
        } else if (nextResolved.status === "reissue-required") {
          setStatus("Your approval is retained. Launch is temporarily unavailable");
        } else if (nextResolved.status === "failed-awaiting-expiry") {
          setStatus("The transaction reverted. Launch is temporarily unavailable");
        } else if (nextResolved.status === "submitted-awaiting-finality") {
          setStatus("Transaction submitted. Waiting for private finality verification");
        }
      } else {
        setResolved(null);
        setAttempt(null);
        setStorageRecoveryRequired(false);
        setNoSendAttested(false);
        setStatus("No approved launch is available for this GitHub account and wallet");
      }
      setDirectory(next);
      setError("");
      setErrorCode("");
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (!manualRouterRetainsKnownApprovalV1(caught)) {
        setDirectory(null);
        setResolved(null);
      } else {
        setStatus("Existing approval is retained. Launch is temporarily unavailable");
      }
      setError(errorMessage(caught));
      setErrorCode(errorCodeOf(caught));
    } finally {
      if (loadAbortRef.current === controller) loadAbortRef.current = null;
      if (!controller.signal.aborted && sequence === loadSequenceRef.current) {
        setLoading(false);
      }
    }
  }, [
    authReady,
    authenticated,
    getSession,
    githubConnected,
    githubUsername,
    exactShardsApplicant,
    selectedSubjectHash,
    routeDiscoveryAllowed,
    wallet,
  ]);

  useEffect(() => {
    if (!manualRouterApplicantDiscoveryReady({
      authReady,
      authenticated,
      githubConnected,
      walletConnected: wallet !== null,
      routeDiscoveryAllowed,
    })) {
      loadAbortRef.current?.abort();
      return;
    }
    const kickoff = window.setTimeout(() => void loadDirectory(), 0);
    const interval = window.setInterval(
      () => void loadDirectory({ quiet: true }),
      LIST_REFRESH_MS,
    );
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [
    authReady,
    authenticated,
    githubConnected,
    loadDirectory,
    routeDiscoveryAllowed,
    wallet,
  ]);

  useEffect(() => () => {
    loadAbortRef.current?.abort();
    acceptanceAbortRef.current?.abort();
    pollAbortRef.current?.abort();
  }, []);

  const chooseSubmission = useCallback(async (subjectHash: string) => {
    if (!/^sha256:[0-9a-f]{64}$/u.test(subjectHash)) return;
    setSelectedSubjectHash(subjectHash as ManualRouterSha256V1);
    setResolved(null);
    setAttempt(null);
    setStorageRecoveryRequired(false);
    setNoSendAttested(false);
    await loadDirectory({
      preferredSubjectHash: subjectHash as ManualRouterSha256V1,
    });
  }, [loadDirectory]);

  const reauthorizeApplicant = useCallback(async () => {
    if (!githubConnected || reauthorizing) return;
    loadAbortRef.current?.abort();
    acceptanceAbortRef.current?.abort();
    pollAbortRef.current?.abort();
    setReauthorizing(true);
    setError("");
    setErrorCode("applicant_reauthorization_required");
    setStatus("Reconnect GitHub to prove the current Applicant session");
    try {
      await reauthorizeGithub();
      setStatus("GitHub reconnected. Refreshing the approved launch");
      await loadDirectory();
    } catch {
      setError("Unable to reconnect GitHub. Try again");
      setErrorCode("applicant_reauthorization_required");
      setStatus("The approved launch remains saved, but wallet actions stay disabled");
    } finally {
      setReauthorizing(false);
    }
  }, [githubConnected, loadDirectory, reauthorizeGithub, reauthorizing]);

  const persistAttempt = useCallback((next: ManualRouterPersistedAttempt) => {
    writePersistedAttempt(next);
    setAttempt(next);
  }, []);

  const reportSubmittedTransaction = useCallback(async (
    currentAttempt: ManualRouterPersistedAttempt,
    signal?: AbortSignal,
  ) => {
    if (!currentAttempt.transactionHash) return;
    const requirement = directory === null
      ? undefined
      : manualRouterApplicantIdentityRequirementV1({
          githubUserId: directory.authenticatedGitHubUserId,
          githubLogin: githubUsername,
          launchWallet: currentAttempt.launchWallet,
        });
    const input = {
      session: await getSession(requirement),
      launchWallet: currentAttempt.launchWallet,
      subjectHash: currentAttempt.subjectHash,
      descriptorHash: currentAttempt.descriptorHash,
      preparationHash: currentAttempt.preparationHash,
      transactionHash: currentAttempt.transactionHash,
      signal,
    } as const;
    if (isManualRouterPersistedAttemptV2(currentAttempt)) {
      await reportManualRouterApplicantTransactionV2({
        ...input,
        routeBindingHash: currentAttempt.routeBindingHash,
      });
    } else {
      await reportManualRouterApplicantTransactionV1(input);
    }
    const reported = Object.freeze({
      ...currentAttempt,
      phase: "reported" as const,
    });
    persistAttempt(reported);
  }, [directory, getSession, githubUsername, persistAttempt]);

  const launch = useCallback(async () => {
    if (
      !wallet
      || !directory
      || resolved?.status !== "ready"
      || !routeAccepted
      || launchLockRef.current
      || manualRouterBlocksNewSend({
        attempt,
        ready: resolved,
        storageRecoveryRequired,
      })
    ) return;
    launchLockRef.current = true;
    setLaunching(true);
    setError("");
    setErrorCode("");
    let pending: ManualRouterPersistedAttempt | null = null;
    try {
      const currentRequirement = manualRouterApplicantIdentityRequirementV1({
        githubUserId: directory.authenticatedGitHubUserId,
        githubLogin: githubUsername,
        launchWallet: directory.linkedLaunchWallet,
      });
      const resolveRequest = {
        session: await getSession(currentRequirement),
        launchWallet: directory.linkedLaunchWallet,
        subjectHash: resolved.subjectHash,
      } as const;
      const freshResolved = isManualRouterResolveV2(resolved)
        ? await resolveManualRouterApplicantSubmissionV2(resolveRequest)
        : await resolveManualRouterApplicantSubmissionV1(resolveRequest);
      setResolved(freshResolved);
      if (freshResolved.status !== "ready") {
        setError("Launch is temporarily unavailable. Retry the currentness check");
        setErrorCode("launch_preflight_not_ready");
        setStatus(freshWalletPreflightStatus(freshResolved.status));
        return;
      }
      const freshMatches = isManualRouterResolveV2(resolved)
        ? isManualRouterResolveV2(freshResolved)
          && manualRouterFreshReadyMatchesCachedV2({
            cached: resolved,
            fresh: freshResolved,
            linkedLaunchWallet: directory.linkedLaunchWallet,
          })
        : !isManualRouterResolveV2(freshResolved)
          && manualRouterFreshReadyMatchesCachedV1({
            cached: resolved,
            fresh: freshResolved,
            linkedLaunchWallet: directory.linkedLaunchWallet,
          });
      if (!freshMatches) {
        setError("The approved Router action changed. Refresh before continuing");
        setErrorCode("launch_preflight_changed");
        setStatus("Wallet was not opened because the approved launch changed");
        return;
      }
      // Re-prove the same refreshed Privy session, numeric GitHub principal
      // and wallet after the server preflight and immediately before durable
      // send state or a wallet prompt can be created.
      await getSession(currentRequirement);
      const attemptCommon = {
        subjectHash: freshResolved.subjectHash,
        descriptorHash: freshResolved.descriptorHash,
        preparationHash: freshResolved.preparationHash,
        launchWallet: directory.linkedLaunchWallet,
        createdAt: new Date().toISOString(),
        transactionHash: null,
        phase: "wallet-prompt-opened" as const,
      } as const;
      pending = isManualRouterResolveV2(freshResolved)
        ? Object.freeze({
            ...attemptCommon,
            schemaVersion:
              "programmable.manual-router-browser-attempt.v2" as const,
            grantBindingHash: freshResolved.grantBindingHash,
            routeBindingHash: freshResolved.routeBindingHash,
            launchArtifactCommitmentHash:
              freshResolved.launchArtifactCommitmentHash,
            route: freshResolved.route,
          })
        : Object.freeze({
            ...attemptCommon,
            schemaVersion:
              "programmable.manual-router-browser-attempt.v1" as const,
          });
      // Durable local state is committed synchronously before the wallet prompt.
      // If storage is unavailable, no transaction is sent.
      persistAttempt(pending);
      setStatus("Confirm the one Router transaction in your wallet");
      const action = freshResolved.browserAction.params[0];
      const transactionHash = await sendBrowserWalletAction({
        chainId: "1",
        from: action.from,
        to: action.to,
        data: action.data,
        value: action.value,
      });
      const submitted = Object.freeze({
        ...pending,
        transactionHash,
        phase: "submitted" as const,
      });
      // This update intentionally happens before the first network await.
      persistAttempt(submitted);
      setRecoveryHash(transactionHash);
      setStatus("Transaction submitted. Saving its hash before finality checks");
      await reportSubmittedTransaction(submitted);
      setStatus("Transaction recorded. Waiting for Ethereum finality");
      await loadDirectory({
        quiet: true,
        preferredSubjectHash: freshResolved.subjectHash,
      });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      setErrorCode(errorCodeOf(caught));
      if (pending === null) {
        setStatus(
          "Wallet was not opened because the launch could not be freshly verified",
        );
      } else if (isExplicitWalletCancellation(caught)) {
        removePersistedAttempt(
          pending.subjectHash,
          isManualRouterPersistedAttemptV2(pending),
        );
        setAttempt(null);
        setStatus("Wallet confirmation was cancelled. No transaction was sent");
      } else {
        setStatus(
          "Send state is uncertain. Do not retry; recover the transaction hash below",
        );
      }
    } finally {
      launchLockRef.current = false;
      setLaunching(false);
    }
  }, [
    attempt,
    directory,
    getSession,
    githubUsername,
    loadDirectory,
    persistAttempt,
    reportSubmittedTransaction,
    resolved,
    routeAccepted,
    sendBrowserWalletAction,
    storageRecoveryRequired,
    wallet,
  ]);

  const recoverTransaction = useCallback(async () => {
    const recoveryAttempt = attempt ?? (
      storageRecoveryRequired
      && resolved?.status === "ready"
      && directory
        ? recoveryAttemptFromReady(resolved, directory.linkedLaunchWallet)
        : null
    );
    if (!recoveryAttempt) return;
    const normalized = recoveryHash.trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/u.test(normalized) || BigInt(normalized) === 0n) {
      setError("Enter a valid Ethereum transaction hash");
      setErrorCode("transaction_hash_invalid");
      return;
    }
    const submitted = Object.freeze({
      ...recoveryAttempt,
      transactionHash: normalized as `0x${string}`,
      phase: "submitted" as const,
    });
    try {
      persistAttempt(submitted);
      setStorageRecoveryRequired(false);
      setNoSendAttested(false);
      setError("");
      setErrorCode("");
      setStatus("Transaction hash recovered. Verifying it against the approved launch");
      await reportSubmittedTransaction(submitted);
      await loadDirectory({
        quiet: true,
        preferredSubjectHash: submitted.subjectHash,
      });
    } catch (caught) {
      setError(errorMessage(caught));
      setErrorCode(errorCodeOf(caught));
      setStatus("The hash remains saved locally. Verification can be retried safely");
    }
  }, [
    attempt,
    directory,
    loadDirectory,
    persistAttempt,
    recoveryHash,
    reportSubmittedTransaction,
    resolved,
    storageRecoveryRequired,
  ]);

  const canClearNoSend = resolved?.status === "ready"
    && manualRouterCanClearUncertainNoSend({
      attempt,
      ready: resolved,
      storageRecoveryRequired,
    });

  const confirmNoTransactionSent = useCallback(() => {
    if (
      !selectedSubjectHash
      || resolved?.status !== "ready"
      || !canClearNoSend
      || !noSendAttested
    ) return;
    if (attempt?.phase === "wallet-prompt-opened") {
      archivePersistedAttempt(attempt, "applicant-confirmed-no-send");
    } else {
      archiveCorruptAttempt(
        selectedSubjectHash,
        readRawPersistedAttempt(
          selectedSubjectHash,
          isManualRouterResolveV2(resolved),
        ),
        "applicant-confirmed-no-send",
        isManualRouterResolveV2(resolved),
      );
    }
    removePersistedAttempt(
      selectedSubjectHash,
      isManualRouterResolveV2(resolved),
    );
    setStorageRecoveryRequired(false);
    setNoSendAttested(false);
    setAttempt(null);
    setRecoveryHash("");
    setStatus("Uncertain browser attempt cleared after your no-send confirmation");
  }, [
    attempt,
    canClearNoSend,
    noSendAttested,
    resolved,
    selectedSubjectHash,
  ]);

  const checkFinality = useCallback(async () => {
    const transaction = manualRouterTransactionContext({ resolved, attempt });
    if (!transaction || finalityLockRef.current) return;
    finalityLockRef.current = true;
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    setChecking(true);
    try {
      if (attempt?.transactionHash && attempt.phase !== "reported") {
        await reportSubmittedTransaction(attempt, controller.signal);
      }
      const request = {
        session: await getSession(directory === null
          ? undefined
          : manualRouterApplicantIdentityRequirementV1({
              githubUserId: directory.authenticatedGitHubUserId,
              githubLogin: githubUsername,
              launchWallet: transaction.launchWallet,
            })),
        launchWallet: transaction.launchWallet,
        subjectHash: transaction.subjectHash,
        descriptorHash: transaction.descriptorHash,
        preparationHash: transaction.preparationHash,
        transactionHash: transaction.transactionHash,
        signal: controller.signal,
      } as const;
      if (transaction.lane === "v2") {
        await requestManualRouterApplicantFinalityV2({
          ...request,
          routeBindingHash: transaction.routeBindingHash,
        });
      } else {
        await requestManualRouterApplicantFinalityV1(request);
      }
      await loadDirectory({
        quiet: true,
        preferredSubjectHash: transaction.subjectHash,
      });
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (
        caught instanceof ManualRouterWebsiteRequestErrorV1
        && (
          caught.code === "transaction_not_finalized"
          || caught.status === 425
        )
      ) {
        setStatus("Transaction found. Waiting for 64 Ethereum confirmations");
      } else {
        setStatus(
          "Finality is not proven yet. The saved transaction will keep being checked",
        );
      }
      await loadDirectory({
        quiet: true,
        preferredSubjectHash: transaction.subjectHash,
      }).catch(() => undefined);
    } finally {
      if (pollAbortRef.current === controller) pollAbortRef.current = null;
      finalityLockRef.current = false;
      if (!controller.signal.aborted) setChecking(false);
    }
  }, [
    attempt,
    directory,
    getSession,
    githubUsername,
    loadDirectory,
    reportSubmittedTransaction,
    resolved,
  ]);

  const transaction = useMemo(
    () => manualRouterTransactionContext({ resolved, attempt }),
    [attempt, resolved],
  );
  useEffect(() => {
    if (!transaction || resolved?.status === "finalized") return;
    const kickoff = window.setTimeout(() => void checkFinality(), 0);
    const interval = window.setInterval(
      () => void checkFinality(),
      FINALITY_POLL_MS,
    );
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [checkFinality, resolved?.status, transaction]);

  const selected = directory?.submissions.find(({ subjectHash }) =>
    subjectHash === selectedSubjectHash) ?? null;
  const exactWallet = wallet && directory
    ? getAddress(wallet.account) === directory.linkedLaunchWallet
    : false;
  const exactGithubPrincipal = directory !== null
    && githubUserId === directory.authenticatedGitHubUserId;
  const authRecoveryRequired = manualRouterApplicantAuthRecoveryRequiredV1(
    errorCode,
  );
  const launchPreflightCurrent = resolved?.status === "ready"
    && errorCode === ""
    && !loading
    && !reauthorizing;
  const launchReady = Boolean(
    resolved?.status === "ready"
    && authReady
    && authenticated
    && githubConnected
    && exactGithubPrincipal
    && exactWallet
    && launchPreflightCurrent
    && routeAccepted
    && !manualRouterBlocksNewSend({
      attempt,
      ready: resolved,
      storageRecoveryRequired,
    }),
  );
  const trustSteps = useMemo(() => [
    ...(exactHookemonApplicant ? [{
      label: "Completed-graph adoption",
      detail: "Exact profile and Authority release required",
      complete: false,
    }] : []),
    ...(routeAcceptanceRequired ? [{
      label: "Exact route acceptance",
      detail: shardsRouteCapabilityUnavailable
        ? "Route capability unavailable"
        : routeAcceptance?.state === "accepted"
          ? "nested-factory@1.0.0 accepted"
          : "Review and accept the frozen plan",
      complete: routeAccepted,
    }] : []),
    {
      label: "GitHub approval",
      detail: selected
        ? `PR #${selected.pullRequestNumber} · @${githubUsername || "linked account"}`
        : githubConnected
          ? "No approved submission for this account"
        : "Link the approved account",
      complete: Boolean(githubConnected && exactGithubPrincipal && selected),
    },
    {
      label: "Exact launch wallet",
      detail: exactWallet
        ? shortAddress(directory!.linkedLaunchWallet)
        : "Connect the wallet from your PR",
      complete: exactWallet,
    },
    {
      label: "Launch preflight",
      detail: resolved?.status === "ready"
        ? launchPreflightCurrent
          ? "Current and verified"
          : "Refresh required before launch"
        : resolved ? statusLabel(resolved.status) : "Waiting for approval",
      complete: launchPreflightCurrent || resolved?.status === "finalized",
    },
  ], [
    directory,
    exactGithubPrincipal,
    exactWallet,
    githubConnected,
    githubUsername,
    launchPreflightCurrent,
    resolved,
    routeAcceptance?.state,
    shardsRouteCapabilityUnavailable,
    exactHookemonApplicant,
    routeAcceptanceRequired,
    routeAccepted,
    selected,
  ]);

  return (
    <div className={`launch-page page-width ${styles.page}`}>
      <header className={styles.header}>
        <button className="launch-model-back" type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={15} />
          Back
        </button>
        <span className={styles.betaLabel}>
          {exactHookemonApplicant ? "Hookbuilder applicant" : "Approved applicants"}
        </span>
      </header>

      <section className={styles.hero} aria-labelledby="applicant-launch-title">
        <div className={styles.heroCopy}>
          <span className={styles.kicker}>Applicant launch</span>
          <h1 id="applicant-launch-title" ref={titleRef} tabIndex={-1}>
            {exactHookemonApplicant
              ? "Prepare the Hookemon launch"
              : "Launch your approved coin"}
          </h1>
          {exactHookemonApplicant ? (
            <p>
              Hookemon requires three ordered wallet confirmations: the exact
              USDC approval, the nonce-bound contract creation, then canonical
              completed-graph adoption. Every step remains unavailable until
              its fresh plan and chain checks are verified.
            </p>
          ) : (
            <p>
              Sign in with the GitHub account from your submission and connect its
              exact wallet. Your approved launch loads automatically. You pay gas
              and send one transaction directly to the canonical Router.
            </p>
          )}
        </div>
        <ol className={styles.trustRail} aria-label="Launch authorization">
          {trustSteps.map((step) => (
            <li key={step.label} data-complete={step.complete}>
              <span aria-hidden="true">
                {step.complete ? <Check size={14} /> : null}
              </span>
              <div>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className={styles.workspace}>
        <section
          className={styles.launchPanel}
          aria-labelledby="applicant-workspace-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>Your launch</span>
              <h2 id="applicant-workspace-title">Approved submission</h2>
            </div>
            {loading ? (
              <LoaderCircle className={styles.spinner} aria-hidden="true" size={22} />
            ) : (
              <ShieldCheck aria-hidden="true" size={24} />
            )}
          </div>

          {routeAcceptanceRequired ? (
            <RouteAcceptanceReview
              state={routeAcceptance}
              loading={loadingAcceptance}
              accepting={acceptingRoute}
              onAccept={() => void acceptReviewedRoute()}
            />
          ) : null}

          {shardsRouteCapabilityUnavailable ? (
            <p className={styles.nonceNote} role="status">
              The exact Shards route is not available yet. Wallet connection and
              launch stay disabled until its audited production binding is current.
            </p>
          ) : null}

          {hookemonRouteCapabilityUnavailable ? (
            <section
              className={styles.submission}
              aria-labelledby="hookemon-launch-sequence-heading"
            >
              <div>
                <span>Required order</span>
                <strong id="hookemon-launch-sequence-heading">
                  Hookemon completed-graph adoption
                </strong>
              </div>
              <ol className={styles.hookemonSequence}>
                <li>Approve the exact plan-bound USDC amount at nonce N</li>
                <li>Create the exact AtomicLauncher at nonce N + 1</li>
                <li>Adopt and stamp only after finalized graph verification</li>
              </ol>
              <p className={styles.nonceNote} role="status">
                Wallet actions stay disabled until the exact Hookemon profile,
                fresh chain checks, valid runtime status and Authority release
                are current. Programmable never requests a private key.
              </p>
            </section>
          ) : null}

          <div className={styles.identityGrid}>
            <div className={styles.identityRow} data-complete={Boolean(directory)}>
              <span className={styles.identityIcon} aria-hidden="true">
                <GitHubBrandIcon />
              </span>
              <div>
                <span>GitHub</span>
                <strong>{githubConnected
                  ? `@${githubUsername || "linked account"}`
                  : "Not linked"}</strong>
              </div>
              {!githubConnected ? (
                <button type="button" onClick={connectGithub}>Link GitHub</button>
              ) : null}
            </div>
            <div className={styles.identityRow} data-complete={exactWallet}>
              <span className={styles.identityIcon} aria-hidden="true">
                <Wallet size={18} />
              </span>
              <div>
                <span>Launch wallet</span>
                <strong>{wallet ? shortAddress(wallet.account) : "Not connected"}</strong>
              </div>
              {!wallet ? (
                <button
                  type="button"
                  disabled={!githubConnected || !routeDiscoveryAllowed}
                  onClick={openWallet}>Connect wallet</button>
              ) : null}
            </div>
          </div>

          {!authenticated ? (
            <button
              className={`button-primary ${styles.connectButton}`}
              type="button"
              onClick={connectGithub}
            >
              Sign in with GitHub to continue
            </button>
          ) : null}

          {directory && directory.submissions.length > 0 ? (
            <div className={styles.submissionChooser}>
              <label htmlFor="manual-applicant-submission">Submission</label>
              <select
                id="manual-applicant-submission"
                value={selectedSubjectHash}
                onChange={(event) => void chooseSubmission(event.target.value)}
              >
                {directory.submissions.map((submission) => (
                  <option key={submission.subjectHash} value={submission.subjectHash}>
                    PR #{submission.pullRequestNumber} · {statusLabel(submission.status)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {selected ? (
            <section className={styles.submission} aria-labelledby="submission-heading">
              <div>
                <span id="submission-heading">Hookbuilder approval</span>
                <strong>Pull request #{selected.pullRequestNumber}</strong>
              </div>
              <dl>
                <div>
                  <dt>Revision</dt>
                  <dd><code>{selected.headSha.slice(0, 10)}</code></dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{statusLabel(resolved?.status ?? selected.status)}</dd>
                </div>
                <div>
                  <dt>Wallet</dt>
                  <dd><code>{directory ? shortAddress(directory.linkedLaunchWallet) : "—"}</code></dd>
                </div>
              </dl>
            </section>
          ) : null}

          {resolved?.status === "ready" ? (
            <ReadyLaunch
              ready={resolved}
              nestedFactoryRoute={isManualRouterResolveV2(resolved)
                ? resolved.route
                : null}
              launchReady={launchReady}
              launching={launching}
              hasBlockingAttempt={manualRouterBlocksNewSend({
                attempt,
                ready: resolved,
                storageRecoveryRequired,
              })}
              onLaunch={() => void launch()}
            />
          ) : null}

          {transaction ? (
            <section className={styles.pendingProof} aria-labelledby="pending-heading">
              <Clock3 aria-hidden="true" size={22} />
              <div>
                <strong id="pending-heading">Waiting for finality</strong>
                <span>
                  The private verifier checks both RPCs. Public Explore and your
                  profile update only through the canonical Router scanner.
                </span>
              </div>
              <Link
                href={`https://etherscan.io/tx/${transaction.transactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                Etherscan <ExternalLink aria-hidden="true" size={13} />
              </Link>
            </section>
          ) : null}

          {attempt?.phase === "wallet-prompt-opened" || storageRecoveryRequired ? (
            <section className={styles.recovery} aria-labelledby="recovery-heading">
              <div>
                <strong id="recovery-heading">Recover an uncertain send</strong>
                <p>
                  {storageRecoveryRequired
                    ? "The saved launch record is unreadable. Check your wallet activity and paste the transaction hash if a send may have happened."
                    : "If your wallet showed a hash, paste it here. Do not click Launch again after a wallet or browser connection error."}
                </p>
              </div>
              <div className={styles.recoveryInput}>
                <label className="sr-only" htmlFor="manual-applicant-tx-hash">
                  Ethereum transaction hash
                </label>
                <input
                  id="manual-applicant-tx-hash"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={recoveryHash}
                  placeholder="0x… transaction hash"
                  onChange={(event) => setRecoveryHash(event.target.value)}
                />
                <button type="button" onClick={() => void recoverTransaction()}>
                  Verify hash
                </button>
              </div>
              {canClearNoSend ? (
                <div className={styles.noSendConfirmation}>
                  <label>
                    <input
                      type="checkbox"
                      checked={noSendAttested}
                      onChange={(event) => setNoSendAttested(event.target.checked)}
                    />
                    <span>
                      I independently checked my wallet activity and confirmed
                      that no transaction was submitted
                    </span>
                  </label>
                  <button
                    className={styles.confirmNoSend}
                    type="button"
                    disabled={!noSendAttested}
                    onClick={confirmNoTransactionSent}
                  >
                    {storageRecoveryRequired
                      ? "Clear the unreadable attempt"
                      : "Clear the uncertain attempt"}
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {resolved?.status === "failed-awaiting-expiry" ? (
            <StateNotice
              kind="failed"
              title="Transaction reverted"
              copy="The failed transaction is preserved. Your approval remains valid while the service confirms the next safe action."
            />
          ) : null}
          {resolved?.status === "reissue-required" ? (
            <StateNotice
              kind="expired"
              title="Launch temporarily unavailable"
              copy="Your approval is retained. Retry after the launch service refreshes its current execution evidence."
            />
          ) : null}
          {resolved?.status === "finalized" ? (
            <section className={styles.finalized} aria-labelledby="finalized-heading">
              <CheckCircle2 aria-hidden="true" size={26} />
              <div>
                <span>Finalized Router proof</span>
                <FinalizedLaunchCopy resolved={resolved} />
                <Link
                  href={`https://etherscan.io/tx/${resolved.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction <ArrowUpRight aria-hidden="true" size={14} />
                </Link>
              </div>
            </section>
          ) : null}

          <div className={styles.liveRegion} aria-live="polite" aria-atomic="true">
            {status ? <p>{status}</p> : null}
            {error ? <p data-error="true">{error}</p> : null}
          </div>

          <div className={styles.sessionActions}>
            {authRecoveryRequired && githubConnected ? (
              <button
                className={styles.refreshButton}
                type="button"
                disabled={reauthorizing}
                onClick={() => void reauthorizeApplicant()}
              >
                <GitHubBrandIcon />
                {reauthorizing ? "Reconnecting GitHub" : "Reconnect GitHub"}
              </button>
            ) : null}
            <button
              className={styles.refreshButton}
              type="button"
              disabled={loading || reauthorizing || !wallet || !githubConnected}
              onClick={() => void loadDirectory()}
            >
              <RefreshCw aria-hidden="true" size={14} />
              {authRecoveryRequired ? "Retry authentication" : "Refresh approval"}
            </button>
          </div>
        </section>

        <aside className={styles.safetyPanel} aria-labelledby="safety-heading">
          <ShieldCheck aria-hidden="true" size={23} />
          <h2 id="safety-heading">
            {exactHookemonApplicant ? "Three exact confirmations" : "One wallet action"}
          </h2>
          {exactHookemonApplicant ? (
            <>
              <p>
                The Website guides approval, contract creation and adoption in
                order. It never requests your private key or an operator secret.
              </p>
              <ul>
                <li>Approval and CREATE use consecutive bound nonces</li>
                <li>Any drift invalidates the complete plan</li>
                <li>Adoption opens only after CREATE finality</li>
                <li>Do not retry an uncertain wallet send</li>
                <li>Public indexing starts after adoption finality</li>
              </ul>
            </>
          ) : (
            <>
              <p>
                Your wallet sends one transaction to the verified Ethereum Router.
                Programmable never needs your private key or an operator secret in
                this browser.
              </p>
              <ul>
                <li>Your wallet pays gas</li>
                <li>The pending nonce is diagnostic only</li>
                <li>Do not retry an uncertain wallet send</li>
                <li>Never speed up or replace a submitted beta transaction</li>
                <li>Public indexing starts after finality</li>
              </ul>
            </>
          )}
          <Link
            className={styles.githubLink}
            href={exactHookemonApplicant
              ? "https://github.com/0xprogrammable/hookbuilder/pull/10"
              : "https://github.com/0xprogrammable/hookbuilder/tree/279dd2fc2ea8c488943ca4e60ca889cb00bab40e/submissions/requests"}
            target="_blank"
            rel="noreferrer"
          >
            View Applicant submissions
            <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
          {checking ? (
            <span className={styles.checking} role="status">
              <LoaderCircle className={styles.spinner} aria-hidden="true" size={14} />
              Checking both RPCs
            </span>
          ) : null}
          {errorCode ? <span className="sr-only">Error code: {errorCode}</span> : null}
        </aside>
      </div>
    </div>
  );
}

function FinalizedLaunchCopy({ resolved }: {
  resolved: Extract<ManualRouterResolved, { status: "finalized" }>;
}) {
  if (!isManualRouterResolveV2(resolved)) {
    return (
      <>
        <strong id="finalized-heading">Your coin is launched</strong>
        <p>
          The canonical scanner publishes it to Explore, feeds and your
          wallet profile after 64 confirmations. This private lane does
          not create a second public profile record.
        </p>
      </>
    );
  }
  if (resolved.executionMode === "EXACT_EXISTING_LAUNCH_ADOPTED") {
    return (
      <>
        <strong id="finalized-heading">Sponsored launch adopted</strong>
        <p>
          The Router proof confirms the exact reviewed identities,
          configuration, runtimes and stamp. It does not prove who first
          called the factory, a pristine market or the current market price.
          Public indexing remains a separate scanner step.
        </p>
      </>
    );
  }
  return (
    <>
      <strong id="finalized-heading">Exact factory launch executed</strong>
      <p>
        The Router executed the reviewed factory path and finalized the exact
        component, pool, configuration, runtime and stamp proof. Public
        indexing remains a separate scanner step.
      </p>
    </>
  );
}

function RouteAcceptanceReview({
  state,
  loading,
  accepting,
  onAccept,
}: {
  state: ManualRouterRouteAcceptanceStateResponseV1 | null;
  loading: boolean;
  accepting: boolean;
  onAccept: () => void;
}) {
  const plan = state?.plan ?? null;
  const acceptanceState = state?.state ?? null;
  const reviewedClaim = state === null
    ? null
    : prettyCanonicalClaimJson(state.claimCanonicalJson);
  const facts = plan === null ? [] : [
    ["Request head", plan.requestHeadSha],
    ["Request tree", plan.requestTreeSha],
    ["Source commit", plan.sourceCommit],
    ["Source tree", plan.sourceTree],
    ["Requested route", `${plan.fromRouteId}@${plan.fromRouteVersion}`],
    ["Accepted route", `${plan.toRouteId}@${plan.toRouteVersion}`],
    ["Profile", `${plan.profileId}@${plan.profileVersion}`],
    ["Profile key", plan.profileKey],
    ["Router", plan.routerAddress],
    ["Router runtime", plan.routerRuntimeCodeHash],
    ["Module", plan.moduleAddress],
    ["Module runtime", plan.moduleRuntimeCodeHash],
    ["Route payload", plan.routePayloadHash],
    ["Expected result", plan.expectedResultHash],
    ["Revenue policy", plan.revenuePolicyHash],
    ["Pool", plan.poolId],
    ["Configuration", plan.configurationHash],
    ["Reviewed plan", plan.reviewedPlanSha256],
    ["Launch wallet", plan.launchWallet],
  ] as const;
  return (
    <section className={styles.submission} aria-labelledby="route-acceptance-heading">
      <div>
        <span>Required before wallet connection</span>
        <strong id="route-acceptance-heading">Exact nested-factory route</strong>
      </div>
      {plan === null ? (
        <p className={styles.nonceNote} role={loading ? "status" : undefined}>
          {loading
            ? "Loading the frozen reviewed plan"
            : "Link the approved GitHub account to load the frozen reviewed plan"}
        </p>
      ) : (
        <>
          <details open={acceptanceState === "pending"}>
            <summary>Review the complete frozen plan</summary>
            <dl>
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd><code title={value}>{value}</code></dd>
                </div>
              ))}
            </dl>
            <StructuredRouteAcceptancePlan plan={plan} />
            {reviewedClaim === null ? null : (
              <>
                <strong>Complete reviewed claim</strong>
                <pre
                  aria-label="Complete reviewed route acceptance claim"
                  tabIndex={0}
                  style={{
                    maxHeight: "24rem",
                    overflow: "auto",
                    overflowWrap: "anywhere",
                    whiteSpace: "pre-wrap",
                  }}
                ><code>{reviewedClaim}</code></pre>
              </>
            )}
          </details>
          <p className={styles.nonceNote}>
            This records your review of the exact route binding. It does not
            authorize a launch or submit a transaction.
          </p>
          {acceptanceState === "pending" ? (
            <button
              className={`button-primary ${styles.launchButton}`}
              type="button"
              disabled={accepting}
              onClick={onAccept}
            >
              {accepting ? (
                <>
                  <LoaderCircle
                    className={styles.spinner}
                    aria-hidden="true"
                    size={17}
                  />
                  Recording acceptance
                </>
              ) : "Accept exact reviewed route"}
            </button>
          ) : (
            <p className={styles.nonceNote} role="status">
              Exact route accepted. Wallet connection is now available.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function StructuredRouteAcceptancePlan({
  plan,
}: {
  plan: ManualRouterRouteAcceptancePlanV1;
}) {
  const predeployment = plan.atomicLaunch.predeployment;
  const launchExecution = plan.atomicLaunch.launchExecution;
  const requiredState = plan.atomicLaunch.initialStatePolicy.state;
  const preconditions = plan.atomicLaunch.initialStatePolicy.commonPreconditions;
  return (
    <>
      <strong>Reviewed factory</strong>
      <dl>
        <div>
          <dt>Address</dt>
          <dd><code>{plan.reviewedFactory.address}</code></dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd><code>{plan.reviewedFactory.runtimeCodeHash}</code></dd>
        </div>
      </dl>

      <strong>Reviewed deployment order</strong>
      <ol>
        {plan.reviewedComponents.map((component) => (
          <li key={component.kind}>
            <strong>{component.kind}</strong>{" "}
            <code>{component.address}</code>{" "}
            <span>deployed by <code>{component.deployer}</code></span>{" "}
            <span>runtime <code>{component.runtimeCodeHash}</code></span>
          </li>
        ))}
      </ol>

      <strong>Atomic launch</strong>
      <dl>
        <div>
          <dt>Transactions</dt>
          <dd>{plan.atomicLaunch.transactionCount}</dd>
        </div>
        <div>
          <dt>Sender</dt>
          <dd><code>{plan.atomicLaunch.transactionSender}</code></dd>
        </div>
        <div>
          <dt>Execution entry</dt>
          <dd><code>{plan.atomicLaunch.executionEntry}</code></dd>
        </div>
        <div>
          <dt>Applicant action</dt>
          <dd><code>{launchExecution.applicantAction}</code></dd>
        </div>
        <div>
          <dt>Launch caller</dt>
          <dd><code>{launchExecution.productionExecutionCaller}</code></dd>
        </div>
      </dl>

      <strong>Completed and verified platform predeployment</strong>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{predeployment.status}</dd>
        </div>
        <div>
          <dt>Applicant action</dt>
          <dd>{predeployment.applicantAction ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>Phase</dt>
          <dd><code>{predeployment.productionExecutionPhase}</code></dd>
        </div>
        <div>
          <dt>Factory</dt>
          <dd><code>{predeployment.factoryAddress}</code></dd>
        </div>
        <div>
          <dt>Factory runtime</dt>
          <dd><code>{predeployment.factoryRuntimeCodeHash}</code></dd>
        </div>
        <div>
          <dt>Renderer</dt>
          <dd><code>{predeployment.rendererAddress}</code></dd>
        </div>
        <div>
          <dt>Renderer runtime</dt>
          <dd><code>{predeployment.rendererRuntimeCodeHash}</code></dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd><code>{predeployment.predeploymentEvidenceSha256}</code></dd>
        </div>
        <div>
          <dt>Gas-cap receipt</dt>
          <dd><code>{predeployment.gasCapReceiptSha256}</code></dd>
        </div>
      </dl>

      <strong>Required launch state</strong>
      <dl>
        <div>
          <dt>Policy</dt>
          <dd><code>{plan.atomicLaunch.initialStatePolicy.mode}</code></dd>
        </div>
        <div>
          <dt>State</dt>
          <dd><code>{requiredState.id}</code></dd>
        </div>
        <div>
          <dt>Factory runtime</dt>
          <dd><code>{requiredState.factoryRuntimeCodeHash}</code></dd>
        </div>
        <div>
          <dt>Renderer runtime</dt>
          <dd><code>{requiredState.rendererRuntimeCodeHash}</code></dd>
        </div>
        <div>
          <dt>Action</dt>
          <dd><code>{requiredState.action}</code></dd>
        </div>
      </dl>

      <strong>Required child and pool preconditions</strong>
      <dl>
        <div>
          <dt>Token code</dt>
          <dd>{preconditions.tokenCode}</dd>
        </div>
        <div>
          <dt>Hook code</dt>
          <dd>{preconditions.hookCode}</dd>
        </div>
        <div>
          <dt>NFT code</dt>
          <dd>{preconditions.nftCode}</dd>
        </div>
        <div>
          <dt>Pool slot0</dt>
          <dd>{preconditions.poolSlot0}</dd>
        </div>
      </dl>

      <strong>Reviewed economics · {plan.economics.totalFeeBps} bps total</strong>
      <ol>
        {plan.economics.legs.map((leg, index) => (
          <li key={leg.roleLabel}>
            <strong>{plan.economics.legOrder[index]} · {leg.feeBps} bps</strong>{" "}
            <span>recipient <code>{leg.recipient}</code></span>{" "}
            <span><code>{leg.recipientModeLabel}</code></span>
          </li>
        ))}
      </ol>
    </>
  );
}

function ReadyLaunch({
  ready,
  nestedFactoryRoute,
  launchReady,
  launching,
  hasBlockingAttempt,
  onLaunch,
}: {
  ready: ReadyResolve;
  nestedFactoryRoute: ManualRouterRouteBindingV2 | null;
  launchReady: boolean;
  launching: boolean;
  hasBlockingAttempt: boolean;
  onLaunch: () => void;
}) {
  const routeFacts = nestedFactoryRoute === null
    ? null
    : manualRouterRouteFactsV2(nestedFactoryRoute);
  return (
    <section className={styles.confirmation} aria-labelledby="confirmation-heading">
      <div className={styles.confirmationTitle}>
        <CheckCircle2 aria-hidden="true" size={21} />
        <div>
          <strong id="confirmation-heading">
            {routeFacts
              ? `${routeFacts.model} · ${routeFacts.router}`
              : launchReady
                ? "Launch preflight verified"
                : "Approved launch"}
          </strong>
          <span>{launchReady
            ? "Current wallet check verified"
            : "Approval retained. Refresh currentness before launch"}</span>
        </div>
      </div>
      <dl className={styles.transactionFacts}>
        <div>
          <dt>Network</dt>
          <dd>Ethereum</dd>
        </div>
        <div>
          <dt>Transactions</dt>
          <dd>One</dd>
        </div>
        <div>
          <dt>Gas payer</dt>
          <dd>Your wallet</dd>
        </div>
        {routeFacts ? (
          <>
            <div>
              <dt>Route</dt>
              <dd>{routeFacts.route}</dd>
            </div>
            <div>
              <dt>Profile</dt>
              <dd>{routeFacts.profile}</dd>
            </div>
          </>
        ) : null}
      </dl>
      <button
        className={`button-primary ${styles.launchButton}`}
        type="button"
        disabled={!launchReady || launching}
        onClick={onLaunch}
      >
        {launching ? (
          <><LoaderCircle className={styles.spinner} aria-hidden="true" size={17} /> Opening wallet</>
        ) : (
          <>Launch coin <ArrowUpRight aria-hidden="true" size={16} /></>
        )}
      </button>
      <p className={styles.nonceNote}>
        {hasBlockingAttempt
          ? "A previous send may exist. Recover its hash before doing anything else."
          : ready.browserAction.pendingNonceAtPreparation === null
            ? "Your wallet assigns the transaction nonce when you confirm."
            : `Pending nonce ${ready.browserAction.pendingNonceAtPreparation} was observed during preparation only. Your wallet assigns the nonce.`}
      </p>
    </section>
  );
}

function StateNotice({
  kind,
  title,
  copy,
}: {
  kind: "failed" | "expired";
  title: string;
  copy: string;
}) {
  return (
    <section className={styles.stateNotice} data-kind={kind}>
      <Clock3 aria-hidden="true" size={20} />
      <div>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
    </section>
  );
}

function isExactShardsGithubLogin(login: string | null): boolean {
  return login?.toLowerCase() === SHARDS_GITHUB_LOGIN;
}

function isNestedFactorySubmissionV2(
  submission: ManualRouterSubmission,
): submission is ManualRouterNestedFactorySubmissionSummaryV2 {
  return "artifactSchemaVersion" in submission
    && submission.artifactSchemaVersion
      === "programmable.manual-router-complete-signed-artifact.v2";
}

function isManualRouterResolveV2(
  resolved: ManualRouterResolved,
): resolved is ManualRouterResolveResponseV2 {
  return resolved.schemaVersion
    === "programmable.manual-router-applicant-resolve-response.v2";
}

function isManualRouterPersistedAttemptV2(
  attempt: ManualRouterPersistedAttempt,
): attempt is ManualRouterPersistedAttemptV2 {
  return attempt.schemaVersion
    === "programmable.manual-router-browser-attempt.v2";
}

function manualRouterBlocksNewSend(input: Readonly<{
  attempt: ManualRouterPersistedAttempt | null;
  ready: ReadyResolve;
  storageRecoveryRequired: boolean;
}>): boolean {
  if (isManualRouterResolveV2(input.ready)) {
    if (input.attempt !== null && !isManualRouterPersistedAttemptV2(input.attempt)) {
      return true;
    }
    return manualRouterBlocksNewSendV2({
      ...input,
      attempt: input.attempt,
      ready: input.ready,
    });
  }
  if (input.attempt !== null && isManualRouterPersistedAttemptV2(input.attempt)) {
    return true;
  }
  return manualRouterBlocksNewSendV1({
    ...input,
    attempt: input.attempt,
    ready: input.ready,
  });
}

function manualRouterCanClearUncertainNoSend(input: Readonly<{
  attempt: ManualRouterPersistedAttempt | null;
  ready: ReadyResolve;
  storageRecoveryRequired: boolean;
}>): boolean {
  if (isManualRouterResolveV2(input.ready)) {
    return manualRouterCanClearUncertainNoSendV2({
      ...input,
      attempt: input.attempt !== null
        && isManualRouterPersistedAttemptV2(input.attempt)
        ? input.attempt
        : null,
      ready: input.ready,
    });
  }
  return manualRouterCanClearUncertainNoSendV1({
    ...input,
    attempt: input.attempt !== null
      && !isManualRouterPersistedAttemptV2(input.attempt)
      ? input.attempt
      : null,
    ready: input.ready,
  });
}

function manualRouterTransactionContext(input: Readonly<{
  resolved: ManualRouterResolved | null;
  attempt: ManualRouterPersistedAttempt | null;
}>): ManualRouterTransaction | null {
  if (input.resolved === null) return null;
  if (isManualRouterResolveV2(input.resolved)) {
    const transaction = manualRouterTransactionContextV2({
      resolved: input.resolved,
      attempt: input.attempt !== null
        && isManualRouterPersistedAttemptV2(input.attempt)
        ? input.attempt
        : null,
    });
    return transaction === null
      ? null
      : Object.freeze({ ...transaction, lane: "v2" as const });
  }
  const transaction = manualRouterTransactionContextV1({
    resolved: input.resolved,
    attempt: input.attempt !== null
      && !isManualRouterPersistedAttemptV2(input.attempt)
      ? input.attempt
      : null,
  });
  return transaction === null
    ? null
    : Object.freeze({ ...transaction, lane: "v1" as const });
}

function recoveryAttemptFromReady(
  ready: ReadyResolve,
  launchWallet: `0x${string}`,
): ManualRouterPersistedAttempt {
  const common = {
    subjectHash: ready.subjectHash,
    descriptorHash: ready.descriptorHash,
    preparationHash: ready.preparationHash,
    launchWallet,
    createdAt: new Date().toISOString(),
    transactionHash: null,
    phase: "wallet-prompt-opened" as const,
  } as const;
  return isManualRouterResolveV2(ready)
    ? Object.freeze({
        ...common,
        schemaVersion:
          "programmable.manual-router-browser-attempt.v2" as const,
        grantBindingHash: ready.grantBindingHash,
        routeBindingHash: ready.routeBindingHash,
        launchArtifactCommitmentHash: ready.launchArtifactCommitmentHash,
        route: ready.route,
      })
    : Object.freeze({
        ...common,
        schemaVersion:
          "programmable.manual-router-browser-attempt.v1" as const,
      });
}

function preferredSubmission(
  submissions: readonly ManualRouterSubmission[],
): ManualRouterSubmission | null {
  const priority: Record<ManualRouterSubmissionSummaryV1["status"], number> = {
    ready: 0,
    "submitted-awaiting-finality": 1,
    "permit-not-yet-valid": 2,
    "failed-awaiting-expiry": 3,
    "reissue-required": 4,
    finalized: 5,
  };
  return [...submissions].sort((left, right) =>
    priority[left.status] - priority[right.status]
    || right.pullRequestNumber - left.pullRequestNumber)[0] ?? null;
}

function attemptStorageKey(
  subjectHash: ManualRouterSha256V1,
  nestedFactory: boolean,
): string {
  const prefix = nestedFactory
    ? ATTEMPT_STORAGE_PREFIX_V2
    : ATTEMPT_STORAGE_PREFIX;
  return `${prefix}:${subjectHash}`;
}

function readPersistedAttempt(
  subjectHash: ManualRouterSha256V1,
): ManualRouterPersistedAttemptReadV1 {
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(attemptStorageKey(subjectHash, false));
  } catch {
    return Object.freeze({ kind: "corrupt", raw: null });
  }
  return parseManualRouterPersistedAttemptStorageV1(stored, subjectHash);
}

function readPersistedAttemptV2(
  subjectHash: ManualRouterSha256V1,
): ManualRouterPersistedAttemptReadV2 {
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(attemptStorageKey(subjectHash, true));
  } catch {
    return Object.freeze({ kind: "corrupt", raw: null });
  }
  return parseManualRouterPersistedAttemptStorageV2(stored, subjectHash);
}

function writePersistedAttempt(attempt: ManualRouterPersistedAttempt): void {
  const nestedFactory = isManualRouterPersistedAttemptV2(attempt);
  const key = attemptStorageKey(attempt.subjectHash, nestedFactory);
  const serialized = JSON.stringify(attempt);
  window.localStorage.setItem(key, serialized);
  if (window.localStorage.getItem(key) !== serialized) {
    throw new Error("The launch attempt could not be saved before opening your wallet");
  }
}

function removePersistedAttempt(
  subjectHash: ManualRouterSha256V1,
  nestedFactory: boolean,
): void {
  try {
    window.localStorage.removeItem(attemptStorageKey(subjectHash, nestedFactory));
  } catch {
    // Explicit cancellation is safe even when private-mode storage cleanup fails.
  }
}

function archivePersistedAttempt(
  attempt: ManualRouterPersistedAttempt,
  reason: ManualRouterAttemptArchiveReasonV1,
): void {
  archiveRawAttempt(
    attempt.subjectHash,
    JSON.stringify(attempt),
    reason,
    isManualRouterPersistedAttemptV2(attempt),
  );
}

function archiveCorruptAttempt(
  subjectHash: ManualRouterSha256V1,
  raw: string | null,
  reason: string,
  nestedFactory: boolean,
): void {
  archiveRawAttempt(subjectHash, raw, reason, nestedFactory);
}

function archiveRawAttempt(
  subjectHash: ManualRouterSha256V1,
  raw: string | null,
  reason: string,
  nestedFactory: boolean,
): void {
  try {
    const boundedRaw = raw === null || raw.length > 1_048_576 ? null : raw;
    const prefix = nestedFactory
      ? ATTEMPT_STORAGE_PREFIX_V2
      : ATTEMPT_STORAGE_PREFIX;
    window.localStorage.setItem(
      `${prefix}:history:${subjectHash}`,
      JSON.stringify({
        schemaVersion: nestedFactory
          ? "programmable.manual-router-browser-attempt-history.v2"
          : "programmable.manual-router-browser-attempt-history.v1",
        archivedAt: new Date().toISOString(),
        reason,
        raw: boundedRaw,
      }),
    );
  } catch {
    // History is diagnostic only; active-state safety never depends on it.
  }
}

function readRawPersistedAttempt(
  subjectHash: ManualRouterSha256V1,
  nestedFactory: boolean,
): string | null {
  try {
    return window.localStorage.getItem(
      attemptStorageKey(subjectHash, nestedFactory),
    );
  } catch {
    return null;
  }
}

function isExplicitWalletCancellation(error: unknown): boolean {
  return error instanceof Error
    && /transaction cancelled in wallet|user rejected|user denied/iu.test(error.message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The Applicant launch could not be completed";
}

function errorCodeOf(error: unknown): string {
  return error instanceof ManualRouterWebsiteRequestErrorV1
    ? error.code
    : "browser_launch_error";
}

export function manualRouterRetainsKnownApprovalV1(error: unknown): boolean {
  return error instanceof TypeError
    || error instanceof ManualRouterWebsiteRequestErrorV1
    && (
      error.code === "applicant_authentication_required"
      || error.code === "applicant_session_changed"
      || error.retryable
      || error.status >= 500
    );
}

function statusLabel(status: ManualRouterSubmissionSummaryV1["status"]): string {
  switch (status) {
    case "ready": return "Approved";
    case "permit-not-yet-valid": return "Launch temporarily unavailable";
    case "reissue-required": return "Launch temporarily unavailable";
    case "submitted-awaiting-finality": return "Confirming";
    case "failed-awaiting-expiry": return "Reverted";
    case "finalized": return "Finalized";
  }
}

function freshWalletPreflightStatus(
  status: ManualRouterResolveResponseV1["status"],
): string {
  if (status === "permit-not-yet-valid") {
    return "Wallet was not opened because launch is temporarily unavailable";
  }
  if (status === "reissue-required") {
    return "Wallet was not opened because current execution evidence is unavailable";
  }
  return "Wallet was not opened because this launch is no longer current";
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function prettyCanonicalClaimJson(value: string): string {
  return JSON.stringify(JSON.parse(value) as unknown, null, 2);
}
