import "server-only";

import { PrivyClient } from "@privy-io/node";
import { getAddress, isAddress } from "viem";

import {
  createPrivyGitHubPrincipalAuthenticatorV1,
  GitHubPrincipalAuthenticationErrorV1,
  type AuthenticatedGitHubPrincipalV1,
  type WebsiteEntitlementReadAuthenticatorV1,
} from "@/lib/server/projection-target/github-entitlement";

export interface AuthenticatedManualRouterApplicantV1
  extends AuthenticatedGitHubPrincipalV1 {
  readonly linkedLaunchWallet: `0x${string}`;
}

export interface ManualRouterApplicantAuthenticatorV1 {
  authenticateGithub(
    request: Request,
  ): Promise<AuthenticatedGitHubPrincipalV1>;
  authenticate(
    request: Request,
    requestedLaunchWallet: string,
  ): Promise<AuthenticatedManualRouterApplicantV1>;
}

export interface ManualRouterApplicantCurrentUserBoundaryV1 {
  getCurrentUser(userId: string): Promise<Readonly<{
    id: string;
    linkedAccounts: readonly Readonly<{
      type: string;
      chainType?: string;
      address?: string;
      subject?: string;
    }>[];
  }>>;
}

export function createManualRouterApplicantAuthenticatorV1():
ManualRouterApplicantAuthenticatorV1 {
  const appId = requiredEnvironment("NEXT_PUBLIC_PRIVY_APP_ID");
  const appSecret = requiredEnvironment("PRIVY_APP_SECRET");
  const privy = new PrivyClient({ appId, appSecret });

  return createManualRouterApplicantAuthenticatorFromBoundaryV1({
    githubAuthenticator: createPrivyGitHubPrincipalAuthenticatorV1(),
    currentUserBoundary: Object.freeze({
      async getCurrentUser(userId: string) {
        const user = await privy.users()._get(userId);
        return Object.freeze({
          id: user.id,
          linkedAccounts: Object.freeze(user.linked_accounts.map((account) => {
            if (account.type === "wallet") {
              return Object.freeze({
                type: account.type,
                chainType: account.chain_type,
                address: account.address,
              });
            }
            if (account.type === "github_oauth") {
              return Object.freeze({
                type: account.type,
                subject: account.subject,
              });
            }
            return Object.freeze({ type: account.type });
          })),
        });
      },
    }),
  });
}

export function createManualRouterApplicantAuthenticatorFromBoundaryV1(
  input: Readonly<{
    githubAuthenticator: WebsiteEntitlementReadAuthenticatorV1;
    currentUserBoundary: ManualRouterApplicantCurrentUserBoundaryV1;
  }>,
): ManualRouterApplicantAuthenticatorV1 {
  if (
    !input.githubAuthenticator
    || typeof input.githubAuthenticator.authenticate !== "function"
    || !input.currentUserBoundary
    || typeof input.currentUserBoundary.getCurrentUser !== "function"
  ) {
    throw new TypeError("manual Router Applicant authenticator is invalid");
  }

  const readCurrentGithubPrincipal = async (request: Request) => {
    let principal: AuthenticatedGitHubPrincipalV1;
    let currentUser: Awaited<ReturnType<
      ManualRouterApplicantCurrentUserBoundaryV1["getCurrentUser"]
    >>;
    try {
      principal = await input.githubAuthenticator.authenticate(request);
      currentUser = await input.currentUserBoundary.getCurrentUser(
        principal.privyUserId,
      );
    } catch (error) {
      if (error instanceof GitHubPrincipalAuthenticationErrorV1) {
        throw new ManualRouterApplicantAuthenticationErrorV1(
          error.status,
          "applicant_authentication_required",
        );
      }
      throw new ManualRouterApplicantAuthenticationErrorV1(
        401,
        "applicant_authentication_required",
      );
    }
    if (currentUser.id !== principal.privyUserId) {
      throw new ManualRouterApplicantAuthenticationErrorV1(
        401,
        "applicant_identity_mismatch",
      );
    }

    const currentGitHubSubjects = new Set(
      currentUser.linkedAccounts
        .filter((account) => account.type === "github_oauth")
        .map((account) => account.subject)
        .filter((subject): subject is string => typeof subject === "string"),
    );
    if (
      currentGitHubSubjects.size !== 1
      || !currentGitHubSubjects.has(principal.githubUserId)
    ) {
      throw new ManualRouterApplicantAuthenticationErrorV1(
        403,
        "github_subject_mismatch",
      );
    }
    return Object.freeze({ principal, currentUser });
  };

  return Object.freeze({
    async authenticateGithub(
      request: Request,
    ): Promise<AuthenticatedGitHubPrincipalV1> {
      return (await readCurrentGithubPrincipal(request)).principal;
    },
    async authenticate(
      request: Request,
      requestedLaunchWallet: string,
    ): Promise<AuthenticatedManualRouterApplicantV1> {
      const requested = applicantWallet(requestedLaunchWallet);
      const { principal, currentUser } = await readCurrentGithubPrincipal(
        request,
      );

      const ethereumWallets = new Set(
        currentUser.linkedAccounts
          .filter((account) =>
            account.type === "wallet"
            && account.chainType === "ethereum"
            && typeof account.address === "string"
            && isAddress(account.address, { strict: true }))
          .map((account) => getAddress(account.address!)),
      );
      if (!ethereumWallets.has(requested)) {
        throw new ManualRouterApplicantAuthenticationErrorV1(
          403,
          "launch_wallet_not_linked",
        );
      }
      return Object.freeze({
        ...principal,
        linkedLaunchWallet: requested,
      });
    },
  });
}

export class ManualRouterApplicantAuthenticationErrorV1 extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: string,
  ) {
    super(code);
    this.name = "ManualRouterApplicantAuthenticationErrorV1";
  }
}

function applicantWallet(value: string): `0x${string}` {
  if (!isAddress(value, { strict: true }) || BigInt(value) === 0n) {
    throw new ManualRouterApplicantAuthenticationErrorV1(
      403,
      "launch_wallet_not_linked",
    );
  }
  return getAddress(value);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}
