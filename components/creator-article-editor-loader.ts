import { parseCreatorArticleV1, type CreatorArticleV1 } from
  "@/lib/creator-article/contract-v1";
import type { LaunchPartnerAttributionV1 } from
  "@/lib/launch-partner-attribution";

export type CreatorProjectSummaryV1 = Readonly<{
  chainId: 1;
  tokenAddress: `0x${string}`;
  name: string;
  symbol: string | null;
  imageUrl: string | null;
  partnerAttribution?: LaunchPartnerAttributionV1;
  source:
    | "envio-classic-v3"
    | "registry.custom-launched"
    | "canonical-launch-stamp-router"
    | "official-main-token";
  article: Readonly<{ revision: number; title: string; updatedAt: string }> | null;
}>;

export type CreatorArticleAuthHeadersV1 = Readonly<{
  Authorization: string;
  "X-Privy-Identity-Token"?: string;
}>;

export type CreatorArticleEditorStateV1 = Readonly<{
  project: CreatorProjectSummaryV1;
  article: CreatorArticleV1 | null;
  etag: string | null;
}>;

export async function acquireCreatorArticleAuthHeadersV1(input: Readonly<{
  getAccessToken: () => Promise<string | null>;
  getIdentityToken: () => Promise<string | null>;
}>): Promise<CreatorArticleAuthHeadersV1> {
  // Privy refreshes the user and identity token through `/users/me`. Read the
  // access token only after that refresh so both headers describe one current
  // session rather than racing the refresh.
  const identityToken = await input.getIdentityToken();
  const accessToken = await input.getAccessToken();
  if (!accessToken) {
    throw new Error("Reconnect your wallet and try again");
  }
  return Object.freeze({
    Authorization: `Bearer ${accessToken}`,
    ...(identityToken
      ? { "X-Privy-Identity-Token": identityToken }
      : {}),
  });
}

export async function loadCreatorArticleEditorV1(
  project: CreatorProjectSummaryV1,
  getAuthHeaders: () => Promise<CreatorArticleAuthHeadersV1>,
  request: typeof fetch = fetch,
): Promise<CreatorArticleEditorStateV1> {
  const response = await request(
    `/api/profile/projects/${project.tokenAddress}/article`,
    { headers: { Accept: "application/json", ...(await getAuthHeaders()) } },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(readCreatorArticleEditorErrorV1(body));
  const record = isRecord(body) ? body : null;
  const article = record?.article === null
    ? null
    : parseCreatorArticleV1(record?.article);
  return Object.freeze({
    project,
    article,
    etag: response.headers.get("etag"),
  });
}

function readCreatorArticleEditorErrorV1(value: unknown) {
  return isRecord(value) && typeof value.code === "string" && value.code
    ? `${value.code[0]?.toUpperCase() ?? ""}${value.code.slice(1).replaceAll("_", " ")}`
    : "Project request failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
