import {
  parseManualRouterApplicantListResponseV1,
  parseManualRouterResolveResponseV1,
  type ManualRouterApplicantListResponseV1,
  type ManualRouterResolveResponseV1,
  type ManualRouterSha256V1,
} from "@/lib/custom-launch/manual-router-contract-v1";
import {
  parseManualRouterApplicantListResponseV2,
  parseManualRouterApplicantFinalityResponseV2,
  parseManualRouterApplicantTransactionResponseV2,
  parseManualRouterResolveResponseV2,
  parseManualRouterRouteAcceptanceStateResponseV1,
  type ManualRouterApplicantFinalityResponseV2,
  type ManualRouterApplicantListResponseV2,
  type ManualRouterApplicantTransactionResponseV2,
  type ManualRouterResolveResponseV2,
  type ManualRouterRouteAcceptanceStateResponseV1,
} from "@/lib/custom-launch/manual-router-contract-v2";

const MAXIMUM_RESPONSE_BYTES = 1_048_576;

export interface ManualRouterWebsiteSessionV1 {
  readonly accessToken: string;
  readonly identityToken: string;
}

export class ManualRouterWebsiteRequestErrorV1 extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ManualRouterWebsiteRequestErrorV1";
  }
}

export async function listManualRouterApplicantSubmissionsV1(input: Readonly<{
  session: ManualRouterWebsiteSessionV1;
  launchWallet: `0x${string}`;
  signal?: AbortSignal;
}>): Promise<ManualRouterApplicantListResponseV1> {
  const value = await postJson(
    "/api/custom-launch/manual/submissions",
    input.session,
    {
      schemaVersion: "programmable.manual-router-applicant-list-request.v1",
      launchWallet: input.launchWallet,
    },
    input.signal,
  );
  return parseManualRouterApplicantListResponseV1(value);
}

export async function resolveManualRouterApplicantSubmissionV1(
  input: Readonly<{
    session: ManualRouterWebsiteSessionV1;
    launchWallet: `0x${string}`;
    subjectHash: ManualRouterSha256V1;
    signal?: AbortSignal;
  }>,
): Promise<ManualRouterResolveResponseV1> {
  const value = await postJson(
    "/api/custom-launch/manual/resolve",
    input.session,
    {
      schemaVersion: "programmable.manual-router-applicant-resolve-request.v1",
      launchWallet: input.launchWallet,
      subjectHash: input.subjectHash,
    },
    input.signal,
  );
  return parseManualRouterResolveResponseV1(value, input);
}

/**
 * Uses the existing authenticated request boundary but requires the server's
 * explicit V2 response discriminator. This remains unused while the frozen V2
 * production binding is inactive.
 */
export async function listManualRouterApplicantSubmissionsV2(input: Readonly<{
  session: ManualRouterWebsiteSessionV1;
  launchWallet: `0x${string}`;
  signal?: AbortSignal;
}>): Promise<ManualRouterApplicantListResponseV2> {
  const value = await postJson(
    "/api/custom-launch/manual/submissions",
    input.session,
    {
      schemaVersion: "programmable.manual-router-applicant-list-request.v1",
      launchWallet: input.launchWallet,
    },
    input.signal,
  );
  return parseManualRouterApplicantListResponseV2(value);
}

export async function listManualRouterApplicantSubmissionsVersionedV2(
  input: Readonly<{
    session: ManualRouterWebsiteSessionV1;
    launchWallet: `0x${string}`;
    signal?: AbortSignal;
  }>,
): Promise<
  ManualRouterApplicantListResponseV1 | ManualRouterApplicantListResponseV2
> {
  const value = await postJson(
    "/api/custom-launch/manual/submissions",
    input.session,
    {
      schemaVersion: "programmable.manual-router-applicant-list-request.v1",
      launchWallet: input.launchWallet,
    },
    input.signal,
  );
  const schemaVersion = responseSchemaVersion(value);
  if (schemaVersion === "programmable.manual-router-applicant-list-response.v1") {
    return parseManualRouterApplicantListResponseV1(value);
  }
  if (schemaVersion === "programmable.manual-router-applicant-list-response.v2") {
    return parseManualRouterApplicantListResponseV2(value);
  }
  throw invalidResponse();
}

export async function resolveManualRouterApplicantSubmissionV2(
  input: Readonly<{
    session: ManualRouterWebsiteSessionV1;
    launchWallet: `0x${string}`;
    subjectHash: ManualRouterSha256V1;
    signal?: AbortSignal;
  }>,
): Promise<ManualRouterResolveResponseV2> {
  const value = await postJson(
    "/api/custom-launch/manual/resolve",
    input.session,
    {
      schemaVersion: "programmable.manual-router-applicant-resolve-request.v1",
      launchWallet: input.launchWallet,
      subjectHash: input.subjectHash,
    },
    input.signal,
  );
  return parseManualRouterResolveResponseV2(value, input);
}

export async function readManualRouterRouteAcceptanceStateV1(
  input: Readonly<{
    session: ManualRouterWebsiteSessionV1;
    claimSha256: ManualRouterSha256V1;
    signal?: AbortSignal;
  }>,
): Promise<ManualRouterRouteAcceptanceStateResponseV1> {
  const value = await postJson(
    "/api/custom-launch/manual/route-acceptance",
    input.session,
    {
      schemaVersion:
        "programmable.manual-router-route-acceptance-state-request.v1",
      claimSha256: input.claimSha256,
    },
    input.signal,
  );
  return parseManualRouterRouteAcceptanceStateResponseV1(value);
}

export async function acceptManualRouterReviewedRouteV1(
  input: Readonly<{
    session: ManualRouterWebsiteSessionV1;
    expectedStateVersion: string;
    claimSha256: ManualRouterSha256V1;
    signal?: AbortSignal;
  }>,
): Promise<ManualRouterRouteAcceptanceStateResponseV1> {
  const value = await postJson(
    "/api/custom-launch/manual/route-acceptance",
    input.session,
    {
      schemaVersion: "programmable.applicant-route-acceptance-command.v1",
      action: "accept-reviewed-route",
      expectedState: "pending",
      expectedStateVersion: input.expectedStateVersion,
      claimSha256: input.claimSha256,
    },
    input.signal,
  );
  return parseManualRouterRouteAcceptanceStateResponseV1(value);
}

export async function reportManualRouterApplicantTransactionV1(
  input: Readonly<{
    session: ManualRouterWebsiteSessionV1;
    launchWallet: `0x${string}`;
    subjectHash: ManualRouterSha256V1;
    descriptorHash: ManualRouterSha256V1;
    preparationHash: ManualRouterSha256V1;
    transactionHash: `0x${string}`;
    signal?: AbortSignal;
  }>,
): Promise<void> {
  await postJson(
    "/api/custom-launch/manual/report-transaction",
    input.session,
    {
      schemaVersion: "programmable.manual-router-applicant-transaction-request.v1",
      launchWallet: input.launchWallet,
      subjectHash: input.subjectHash,
      descriptorHash: input.descriptorHash,
      preparationHash: input.preparationHash,
      transactionHash: input.transactionHash,
    },
    input.signal,
  );
}

export async function reportManualRouterApplicantTransactionV2(
  input: Readonly<{
    session: ManualRouterWebsiteSessionV1;
    launchWallet: `0x${string}`;
    subjectHash: ManualRouterSha256V1;
    descriptorHash: ManualRouterSha256V1;
    preparationHash: ManualRouterSha256V1;
    routeBindingHash: ManualRouterSha256V1;
    transactionHash: `0x${string}`;
    signal?: AbortSignal;
  }>,
): Promise<ManualRouterApplicantTransactionResponseV2> {
  const value = await postJson(
    "/api/custom-launch/manual/report-transaction",
    input.session,
    {
      schemaVersion: "programmable.manual-router-applicant-transaction-request.v1",
      launchWallet: input.launchWallet,
      subjectHash: input.subjectHash,
      descriptorHash: input.descriptorHash,
      preparationHash: input.preparationHash,
      transactionHash: input.transactionHash,
    },
    input.signal,
  );
  return parseManualRouterApplicantTransactionResponseV2(value, input);
}

export async function requestManualRouterApplicantFinalityV1(
  input: Readonly<{
    session: ManualRouterWebsiteSessionV1;
    launchWallet: `0x${string}`;
    subjectHash: ManualRouterSha256V1;
    descriptorHash: ManualRouterSha256V1;
    preparationHash: ManualRouterSha256V1;
    transactionHash: `0x${string}`;
    signal?: AbortSignal;
  }>,
): Promise<void> {
  await postJson(
    "/api/custom-launch/manual/finality",
    input.session,
    {
      schemaVersion: "programmable.manual-router-applicant-finality-request.v1",
      launchWallet: input.launchWallet,
      subjectHash: input.subjectHash,
      descriptorHash: input.descriptorHash,
      preparationHash: input.preparationHash,
      transactionHash: input.transactionHash,
    },
    input.signal,
  );
}

export async function requestManualRouterApplicantFinalityV2(
  input: Readonly<{
    session: ManualRouterWebsiteSessionV1;
    launchWallet: `0x${string}`;
    subjectHash: ManualRouterSha256V1;
    descriptorHash: ManualRouterSha256V1;
    preparationHash: ManualRouterSha256V1;
    routeBindingHash: ManualRouterSha256V1;
    transactionHash: `0x${string}`;
    signal?: AbortSignal;
  }>,
): Promise<ManualRouterApplicantFinalityResponseV2> {
  const value = await postJson(
    "/api/custom-launch/manual/finality",
    input.session,
    {
      schemaVersion: "programmable.manual-router-applicant-finality-request.v1",
      launchWallet: input.launchWallet,
      subjectHash: input.subjectHash,
      descriptorHash: input.descriptorHash,
      preparationHash: input.preparationHash,
      transactionHash: input.transactionHash,
    },
    input.signal,
  );
  return parseManualRouterApplicantFinalityResponseV2(value, input);
}

async function postJson(
  path: string,
  session: ManualRouterWebsiteSessionV1,
  body: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!session.accessToken || !session.identityToken) {
    throw new ManualRouterWebsiteRequestErrorV1(
      401,
      "applicant_authentication_required",
      "Sign in with your approved GitHub account",
      false,
    );
  }
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    signal,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${session.accessToken}`,
      "content-type": "application/json",
      "x-privy-identity-token": session.identityToken,
    },
    body: JSON.stringify(body),
  });
  const value = await responseJson(response);
  if (!response.ok) throw requestError(response.status, value);
  return value;
}

async function responseJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAXIMUM_RESPONSE_BYTES) {
    throw invalidResponse();
  }
  const text = await response.text();
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes < 2 || bytes > MAXIMUM_RESPONSE_BYTES) throw invalidResponse();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidResponse();
  }
}

function requestError(
  status: number,
  value: unknown,
): ManualRouterWebsiteRequestErrorV1 {
  const record = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const code = typeof record.code === "string"
    ? record.code
    : "launch_service_error";
  const retryable = record.retryable === true;
  return new ManualRouterWebsiteRequestErrorV1(
    status,
    code,
    requestErrorMessage(code, status),
    retryable,
  );
}

function responseSchemaVersion(value: unknown): unknown {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).schemaVersion
    : undefined;
}

function requestErrorMessage(code: string, status: number): string {
  if (code === "manual_launch_not_enabled") {
    return "Applicant launch is not open yet";
  }
  if (
    code === "applicant_authentication_required"
    || code === "github_subject_mismatch"
  ) return "Sign in with the GitHub account approved in your submission";
  if (code === "launch_wallet_not_linked") {
    return "Connect the exact Ethereum wallet approved in your submission";
  }
  if (code === "submission_not_found") {
    return "No approved launch is available for this GitHub account and wallet";
  }
  if (code === "permit_expired_reissue_required") {
    return "This launch permit expired. A new signature is required";
  }
  if (code === "transaction_not_finalized" || status === 425) {
    return "Transaction found. Waiting for Ethereum finality";
  }
  if (code === "state_conflict") {
    return "Launch state changed. Refresh before continuing";
  }
  return status >= 500
    ? "The Applicant launch service is temporarily unavailable"
    : "The Applicant launch request could not be completed";
}

function invalidResponse(): ManualRouterWebsiteRequestErrorV1 {
  return new ManualRouterWebsiteRequestErrorV1(
    502,
    "response_invalid",
    "The Applicant launch service returned an invalid response",
    true,
  );
}
