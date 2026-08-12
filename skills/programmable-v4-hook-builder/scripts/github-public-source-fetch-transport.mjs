import {
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GitHubPublicSourceError
} from "./github-public-source-contract.mjs";
import {
  assertPublicFetchRequest,
  normalizeContentLength
} from "./github-public-source-shared.mjs";

export function createGitHubPublicFetchTransportV1(fetchImplementation = globalThis.fetch, options = {}) {
  if (typeof fetchImplementation !== "function") {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "fetch implementation must be a function");
  }
  if (
    options === null
    || typeof options !== "object"
    || Array.isArray(options)
    || Object.keys(options).some((key) => key !== "allowPublicUserLookups")
    || (options.allowPublicUserLookups !== undefined && typeof options.allowPublicUserLookups !== "boolean")
  ) {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "public GitHub transport options are invalid");
  }
  const allowPublicUserLookups = options.allowPublicUserLookups === true;

  return async function githubPublicFetchTransport(request) {
    assertPublicFetchRequest(request, allowPublicUserLookups);
    const response = await fetchImplementation(request.url, {
      method: "GET",
      headers: request.headers,
      redirect: "error",
      signal: request.signal,
    });

    if (response.redirected) {
      throw new GitHubPublicSourceError("GITHUB_REDIRECT_REJECTED", "GitHub redirect was rejected");
    }

    const contentLength = normalizeContentLength(response.headers?.get?.("content-length"));
    if (contentLength !== null && contentLength > request.maxResponseBytes) {
      throw new GitHubPublicSourceError("GITHUB_RESPONSE_TOO_LARGE", "GitHub response exceeded the byte limit");
    }

    const body = await readBoundedResponseBody(response, request.maxResponseBytes);
    return {
      status: response.status,
      headers: {
        "content-type": response.headers?.get?.("content-type") ?? null,
        "retry-after": response.headers?.get?.("retry-after") ?? null,
        "x-ratelimit-remaining": response.headers?.get?.("x-ratelimit-remaining") ?? null,
      },
      body,
      redirected: response.redirected,
      responseUrl: response.url,
    };
  };
}


async function readBoundedResponseBody(response, maxBytes) {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size violation remains authoritative even if a hostile stream rejects cancellation.
        }
        throw new GitHubPublicSourceError("GITHUB_RESPONSE_TOO_LARGE", "GitHub response exceeded the byte limit");
      }
      chunks.push(value);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new GitHubPublicSourceError("GITHUB_RESPONSE_TOO_LARGE", "GitHub response exceeded the byte limit");
  }
  return bytes;
}
