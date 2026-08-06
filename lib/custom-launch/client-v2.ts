import type {
  ApplicationHandleV3,
  ApplicationStatusViewV2,
  CustomLaunchWalletProfileViewV2,
  AuthenticateLaunchSessionWalletHttpRequestV2,
  AuthenticatedLaunchSessionViewV2,
  AuthorizedLaunchPermitViewV2,
  BrowserWalletLaunchPreparationV2,
  BrowserWalletGrantReissueRequestV1,
  BrowserWalletGrantReissueViewV1,
  BrowserWalletLaunchReportAckV2,
  BrowserWalletLaunchReportRequestV2,
  BindLaunchSessionPreparationRequestV2,
  CreateBrowserWalletLaunchPreparationRequestV2,
  CreateLaunchSessionChallengeRequestV2,
  CustomLaunchWebsiteErrorV2,
  CustomLaunchWebsiteSessionV2,
  CustomLaunchProjectViewV2,
  LaunchEligibilityViewV2,
  LaunchDescriptorV2,
  LaunchExecutionStatusViewV2,
  LaunchSessionChallengeViewV2,
  LaunchSessionPreparationViewV2,
  PrincipalCustomLaunchApplicationListV2,
  PrincipalCustomLaunchApplicationPageV2,
  PrincipalLaunchAuthorityRefreshRequestV1,
  PrincipalLaunchAuthorityRefreshViewV1,
  PrincipalLaunchPresentationCommitRequestV1,
  PrincipalLaunchPresentationResponseV1,
  Sha256DigestV2,
  AuthorizeLaunchSessionRequestV2,
} from "./contract-v2";
import { CUSTOM_LAUNCH_WEBSITE_API_V2 } from "./contract-v2";
import {
  parseCustomLaunchApiErrorV2,
  parseCustomLaunchApiResponseV2,
} from "./response-contract-v2";

type FetchV2 = typeof fetch;

export class CustomLaunchWebsiteRequestErrorV2 extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage = code,
  ) {
    super(publicMessage);
    this.name = "CustomLaunchWebsiteRequestErrorV2";
  }
}

export function createCustomLaunchWebsiteClientV2(input: Readonly<{
  session: CustomLaunchWebsiteSessionV2;
  fetch?: FetchV2;
}>) {
  const fetchV2 = input.fetch ?? globalThis.fetch.bind(globalThis);
  const headers = () => ({
    accept: "application/json",
    authorization: `Bearer ${input.session.accessToken}`,
    "x-privy-identity-token": input.session.identityToken,
  });
  const write = async <T>(
    path: string,
    idempotencyKey: string,
    body: object,
    schemaVersion: string,
    method: "POST" | "PUT" = "POST",
    validateStatus?: (status: number, value: T) => void,
    signal?: AbortSignal,
  ): Promise<T> => requestJsonV2<T>(fetchV2, path, {
    method,
    headers: {
      ...headers(),
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
    signal,
  }, schemaVersion, validateStatus);
  const read = async <T>(path: string, schemaVersion: string): Promise<T> =>
    requestJsonV2<T>(fetchV2, path, {
      method: "GET",
      headers: headers(),
    }, schemaVersion);

  return Object.freeze({
    async applications(input: Readonly<{
      limit?: number;
      cursor?: string;
    }> = {}): Promise<PrincipalCustomLaunchApplicationPageV2> {
      const response = await read<PrincipalCustomLaunchApplicationListV2>(
        CUSTOM_LAUNCH_WEBSITE_API_V2.applications({
          limit: input.limit ?? 50,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        }),
        "programmable.principal-custom-launch-application-list.v3",
      );
      return Object.freeze({
        ...response,
        hasMore: response.nextCursor !== null,
      });
    },
    applicationStatus(applicationHandle: ApplicationHandleV3): Promise<ApplicationStatusViewV2> {
      return read(
        CUSTOM_LAUNCH_WEBSITE_API_V2.applicationStatus(applicationHandle),
        "programmable.application-status-view.v2",
      );
    },
    launchEligibility(applicationHandle: ApplicationHandleV3): Promise<LaunchEligibilityViewV2> {
      return read(
        CUSTOM_LAUNCH_WEBSITE_API_V2.launchEligibility(applicationHandle),
        "programmable.launch-eligibility-view.v3",
      );
    },
    launchAuthorityRefresh(
      applicationHandle: ApplicationHandleV3,
      request: PrincipalLaunchAuthorityRefreshRequestV1,
      idempotencyKey: string,
      options: Readonly<{ signal?: AbortSignal }> = {},
    ): Promise<PrincipalLaunchAuthorityRefreshViewV1> {
      return write(
        CUSTOM_LAUNCH_WEBSITE_API_V2.launchAuthorityRefresh(applicationHandle),
        idempotencyKey,
        request,
        "programmable.principal-launch-authority-refresh.v1",
        "POST",
        (status, value) => {
          const valid = (status === 202 && value.state === "pending")
            || (status === 200 && (value.state === "current" || value.state === "failed"));
          if (!valid) throw new TypeError("launch authority refresh HTTP state mismatch");
        },
        options.signal,
      );
    },
    launchDescriptor(applicationHandle: ApplicationHandleV3): Promise<LaunchDescriptorV2> {
      return read(
        CUSTOM_LAUNCH_WEBSITE_API_V2.launchDescriptor(applicationHandle),
        "programmable.launch-route-discovery.v3",
      );
    },
    launchPresentation(
      applicationHandle: ApplicationHandleV3,
    ): Promise<PrincipalLaunchPresentationResponseV1> {
      return read(
        CUSTOM_LAUNCH_WEBSITE_API_V2.launchPresentation(applicationHandle),
        "programmable.principal-launch-presentation-response.v2",
      );
    },
    commitLaunchPresentation(
      applicationHandle: ApplicationHandleV3,
      request: PrincipalLaunchPresentationCommitRequestV1,
      idempotencyKey: string,
    ): Promise<PrincipalLaunchPresentationResponseV1> {
      return write(
        CUSTOM_LAUNCH_WEBSITE_API_V2.launchPresentation(applicationHandle),
        idempotencyKey,
        request,
        "programmable.principal-launch-presentation-response.v2",
        "PUT",
      );
    },
    launchExecutionStatus(input: Readonly<{
      applicationHandle: ApplicationHandleV3;
      grantId: string;
      sessionId: string;
    }>): Promise<LaunchExecutionStatusViewV2> {
      return read(
        CUSTOM_LAUNCH_WEBSITE_API_V2.launchExecutionStatus(input),
        "programmable.launch-execution-status-view.v3",
      );
    },
    createChallenge(
      request: CreateLaunchSessionChallengeRequestV2,
    ): Promise<LaunchSessionChallengeViewV2> {
      return write(
        CUSTOM_LAUNCH_WEBSITE_API_V2.createChallenge,
        request.idempotencyKey,
        request,
        "programmable.launch-session-challenge-view.v2",
      );
    },
    bindPreparation(
      request: BindLaunchSessionPreparationRequestV2,
    ): Promise<LaunchSessionPreparationViewV2> {
      return write(
        CUSTOM_LAUNCH_WEBSITE_API_V2.bindPreparation(request.challengeId),
        request.idempotencyKey,
        request,
        "programmable.launch-session-preparation-view.v2",
      );
    },
    authenticateWallet(
      input: AuthenticateLaunchSessionWalletHttpRequestV2,
    ): Promise<AuthenticatedLaunchSessionViewV2> {
      return write(
        CUSTOM_LAUNCH_WEBSITE_API_V2.authenticateWallet(input.request.challengeId),
        input.request.idempotencyKey,
        input,
        "programmable.authenticated-launch-session-view.v2",
      );
    },
    authorizeLaunch(
      request: AuthorizeLaunchSessionRequestV2,
    ): Promise<AuthorizedLaunchPermitViewV2> {
      return write(
        CUSTOM_LAUNCH_WEBSITE_API_V2.authorizeLaunch(request.sessionId),
        request.idempotencyKey,
        request,
        "programmable.authorized-launch-permit-view.v2",
      );
    },
    createExecutionPreparation(
      input: CreateBrowserWalletLaunchPreparationRequestV2,
    ): Promise<BrowserWalletLaunchPreparationV2> {
      return write(
        CUSTOM_LAUNCH_WEBSITE_API_V2.createExecutionPreparation(input.request.sessionId),
        input.request.idempotencyKey,
        input,
        "programmable.browser-wallet-launch-preparation.v2",
      );
    },
    reissueLaunchGrant(input: Readonly<{
      oldGrantId: string;
      idempotencyKey: string;
      request: BrowserWalletGrantReissueRequestV1;
    }>): Promise<BrowserWalletGrantReissueViewV1> {
      return write(
        CUSTOM_LAUNCH_WEBSITE_API_V2.reissueLaunchGrant(input.oldGrantId),
        input.idempotencyKey,
        input.request,
        "programmable.browser-wallet-grant-reissue.v2",
      );
    },
    reportLaunchTransaction(input: Readonly<{
      executionReservationId: string;
      idempotencyKey: string;
      request: BrowserWalletLaunchReportRequestV2;
    }>): Promise<BrowserWalletLaunchReportAckV2> {
      return write(
        CUSTOM_LAUNCH_WEBSITE_API_V2.reportLaunchTransaction(input.executionReservationId),
        input.idempotencyKey,
        input.request,
        "programmable.browser-wallet-launch-report-ack.v2",
      );
    },
    project(projectId: Sha256DigestV2): Promise<CustomLaunchProjectViewV2> {
      return read(
        CUSTOM_LAUNCH_WEBSITE_API_V2.project(projectId),
        "programmable.custom-launch-project-view.v2",
      );
    },
    profile(input: Readonly<{
      namespace: string;
      value: string;
    }>): Promise<CustomLaunchWalletProfileViewV2> {
      return read(
        CUSTOM_LAUNCH_WEBSITE_API_V2.profile(input),
        "programmable.custom-launch-wallet-profile.v2",
      );
    },
  });
}

async function requestJsonV2<T>(
  fetchV2: FetchV2,
  path: string,
  init: RequestInit,
  expectedSchemaVersion: string,
  validateStatus?: (status: number, value: T) => void,
): Promise<T> {
  const response = await fetchV2(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
  const contentType = response.headers.get("content-type")
    ?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new CustomLaunchWebsiteRequestErrorV2(502, "response_contract_mismatch");
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new CustomLaunchWebsiteRequestErrorV2(502, "response_contract_mismatch");
  }
  if (!response.ok) {
    let error: CustomLaunchWebsiteErrorV2;
    try {
      error = parseCustomLaunchApiErrorV2(value);
    } catch {
      throw new CustomLaunchWebsiteRequestErrorV2(
        502,
        "response_contract_mismatch",
      );
    }
    throw new CustomLaunchWebsiteRequestErrorV2(
      response.status,
      error.code,
      error.message,
    );
  }
  try {
    const parsed = parseCustomLaunchApiResponseV2<T>(value, expectedSchemaVersion);
    validateStatus?.(response.status, parsed);
    return parsed;
  } catch {
    throw new CustomLaunchWebsiteRequestErrorV2(502, "response_contract_mismatch");
  }
}
