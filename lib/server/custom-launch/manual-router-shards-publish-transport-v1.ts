import "server-only";

import { createHash } from "node:crypto";

export const SHARDS_MANUAL_ROUTER_COMPILE_INPUT_HASH_V1 =
  "sha256:1d7c191dc3e16ba9967be76622b76269b6ac1673637212fab41594ff1665394a";
export const SHARDS_MANUAL_ROUTER_ALCHEMY_ENDPOINT_V1 =
  "https://eth-mainnet.g.alchemy.com/v2";
export const SHARDS_MANUAL_ROUTER_ALCHEMY_API_KEY_ENV_V1 =
  "PROGRAMMABLE_SHARDS_REISSUE_ALCHEMY_MAINNET_RPC_API_KEY";
export const SHARDS_MANUAL_ROUTER_ALCHEMY_API_KEY_COMMITMENT_ENV_V1 =
  "PROGRAMMABLE_SHARDS_REISSUE_ALCHEMY_MAINNET_RPC_API_KEY_COMMITMENT";
export const SHARDS_MANUAL_ROUTER_ALCHEMY_API_KEY_COMMITMENT_V1 =
  "sha256:5419a7a33826708ccae3c7e29aca5e6bab25e6bc5e52a14c22141c4d0cc7ec87";

const QUICKNODE_MINIMUM_FETCH_GAP_MILLISECONDS_V1 = 1_000;
const QUICKNODE_429_RETRY_DELAYS_MILLISECONDS_V1 = Object.freeze([
  1_000,
  2_000,
] as const);

type PublishTransportClockV1 = Readonly<{
  nowMilliseconds(): number;
  wait(milliseconds: number): Promise<void>;
}>;

export function createShardsManualRouterAlchemyBearerFetchV1(input: Readonly<{
  fetch: typeof fetch;
  apiKey: string | undefined;
  apiKeyCommitment: string | undefined;
}>): typeof fetch {
  return createShardsManualRouterAlchemyBearerFetchForBindingV1({
    ...input,
    expectedApiKeyCommitment:
      SHARDS_MANUAL_ROUTER_ALCHEMY_API_KEY_COMMITMENT_V1,
  });
}

export function createShardsManualRouterAlchemyBearerFetchForBindingV1(
  input: Readonly<{
    fetch: typeof fetch;
    apiKey: string | undefined;
    apiKeyCommitment: string | undefined;
    expectedApiKeyCommitment: `sha256:${string}`;
  }>,
): typeof fetch {
  const apiKey = strictAlchemyApiKey(input.apiKey);
  const expected = strictSha256(
    input.expectedApiKeyCommitment,
    "expected Shards Alchemy access-key commitment",
  );
  const configured = strictSha256(
    input.apiKeyCommitment,
    "Shards Alchemy access-key commitment",
  );
  const observed = shardsManualRouterAlchemyApiKeyCommitmentV1(apiKey);
  if (configured !== expected || observed !== expected) {
    throw new TypeError("Shards Alchemy access-key commitment is invalid");
  }
  return (requestInput, requestInit) => {
    if (requestUrl(requestInput) !== SHARDS_MANUAL_ROUTER_ALCHEMY_ENDPOINT_V1) {
      return input.fetch(requestInput, requestInit);
    }
    const request = new Request(requestInput, requestInit);
    if (request.headers.has("authorization")) {
      throw new TypeError("Shards Alchemy authorization is ambiguous");
    }
    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${apiKey}`);
    return input.fetch(new Request(request, { headers }));
  };
}

export function shardsManualRouterAlchemyApiKeyCommitmentV1(
  apiKey: string,
): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(apiKey, "utf8").digest("hex")}`;
}

export function createShardsManualRouterPublishFetchV1(input: Readonly<{
  fetch: typeof fetch;
  quickNodeUrl: string | undefined;
  clock?: PublishTransportClockV1;
}>): typeof fetch {
  const quickNodeUrl = strictQuickNodeUrl(input.quickNodeUrl);
  const clock = input.clock ?? Object.freeze({
    nowMilliseconds: () => Date.now(),
    wait: async (milliseconds: number) => {
      await new Promise<void>((resolveDelay) =>
        setTimeout(resolveDelay, milliseconds));
    },
  });
  let tail: Promise<void> = Promise.resolve();
  let lastFetchStartMilliseconds = 0;

  return (requestInput, requestInit) => {
    if (requestUrl(requestInput) !== quickNodeUrl) {
      return input.fetch(requestInput, requestInit);
    }
    const request = new Request(requestInput, requestInit);
    const run = tail.then(async () => {
      for (let attempt = 0; ; attempt += 1) {
        const earliest = lastFetchStartMilliseconds
          + QUICKNODE_MINIMUM_FETCH_GAP_MILLISECONDS_V1;
        const gap = Math.max(0, earliest - clock.nowMilliseconds());
        if (gap > 0) await clock.wait(gap);
        lastFetchStartMilliseconds = clock.nowMilliseconds();
        const response = await input.fetch(request.clone());
        const retryDelay = response.status === 429
          ? QUICKNODE_429_RETRY_DELAYS_MILLISECONDS_V1[attempt]
          : undefined;
        if (retryDelay === undefined) return response;
        await clock.wait(retryDelay);
      }
    });
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

export function isExactShardsManualRouterPublishRequestV1(
  verifiedRequest: Readonly<Record<string, unknown>>,
): boolean {
  const artifact = record(verifiedRequest.signedArtifact, "signed artifact");
  const prepared = record(artifact.prepared, "prepared launch");
  return prepared.compileInputHash
    === SHARDS_MANUAL_ROUTER_COMPILE_INPUT_HASH_V1;
}

function strictQuickNodeUrl(value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError("Shards QuickNode transport is not configured");
  }
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:"
    || parsed.username.length !== 0
    || parsed.password.length !== 0
    || parsed.port.length !== 0
    || parsed.search.length !== 0
    || parsed.hash.length !== 0
    || parsed.pathname === "/"
    || !/^(?:[a-z0-9-]+\.)+quiknode\.pro$/u.test(
      parsed.hostname.toLowerCase(),
    )
  ) throw new TypeError("Shards QuickNode transport is not strictly bound");
  return parsed.href;
}

function strictAlchemyApiKey(value: string | undefined): string {
  if (
    typeof value !== "string"
    || value.length < 16
    || value.length > 512
    || value !== value.trim()
    || !value.startsWith("alcht_")
    || !/^alcht_[A-Za-z0-9_-]+$/u.test(value)
  ) throw new TypeError("Shards Alchemy access key is invalid");
  return value;
}

function strictSha256(value: string | undefined, label: string): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as `sha256:${string}`;
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return new URL(input.toString()).href;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`verified Shards ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}
