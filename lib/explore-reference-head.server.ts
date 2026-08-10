import "server-only";

const REFERENCE_HEAD_URL =
  "https://developers.programmable.family/api/v2/launches?limit=1";
const REFERENCE_HEAD_CACHE_MS = 5_000;
const REFERENCE_HEAD_TIMEOUT_MS = 2_500;
const REFERENCE_HEAD_ROUTE_BUDGET_MS = 150;
const MAX_REFERENCE_RESPONSE_BYTES = 256 * 1_024;

export type ExploreReferenceHead = Readonly<{
  blockNumber: string;
  blockHash: `0x${string}`;
  indexedAt: string;
  finality: "confirmed";
}>;

let cachedReferenceHead: Readonly<{
  expiresAt: number;
  value: Promise<ExploreReferenceHead | null>;
}> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseExploreReferenceHead(
  value: unknown,
): ExploreReferenceHead | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "2.0.0" ||
    value.status !== "ready" ||
    !isRecord(value.snapshot)
  ) {
    return null;
  }
  const snapshot = value.snapshot;
  if (
    typeof snapshot.blockNumber !== "string" ||
    !/^[1-9]\d*$/u.test(snapshot.blockNumber) ||
    typeof snapshot.blockHash !== "string" ||
    !/^0x[0-9a-f]{64}$/iu.test(snapshot.blockHash) ||
    typeof snapshot.indexedAt !== "string" ||
    !Number.isFinite(Date.parse(snapshot.indexedAt)) ||
    snapshot.finality !== "confirmed"
  ) {
    return null;
  }
  return {
    blockNumber: snapshot.blockNumber,
    blockHash: snapshot.blockHash as `0x${string}`,
    indexedAt: snapshot.indexedAt,
    finality: "confirmed",
  };
}

async function fetchExploreReferenceHead() {
  try {
    const response = await fetch(REFERENCE_HEAD_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REFERENCE_HEAD_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_REFERENCE_RESPONSE_BYTES
    ) {
      return null;
    }
    const text = await response.text();
    if (text.length > MAX_REFERENCE_RESPONSE_BYTES) return null;
    return parseExploreReferenceHead(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Reads only a canonical confirmed head for freshness reconciliation. It never
 * creates, removes or mutates launch records and is non-authoritative when it
 * is unavailable.
 */
export function readExploreReferenceHead() {
  const now = Date.now();
  if (cachedReferenceHead && cachedReferenceHead.expiresAt > now) {
    return cachedReferenceHead.value;
  }
  const value = fetchExploreReferenceHead();
  cachedReferenceHead = {
    expiresAt: now + REFERENCE_HEAD_CACHE_MS,
    value,
  };
  return value;
}

/**
 * Starts the independent freshness read without letting it become a route
 * waterfall. A later request can reuse the same cached promise when the cold
 * read takes longer than the small response budget.
 */
export async function readExploreReferenceHeadWithinRouteBudget() {
  const read = readExploreReferenceHead();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<null>((resolve) => {
        timeout = setTimeout(resolve, REFERENCE_HEAD_ROUTE_BUDGET_MS, null);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
