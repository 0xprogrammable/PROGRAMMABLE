export async function fetchBoundedBytes({
  url,
  fetchImplementation,
  limit,
  timeoutMs,
  ErrorClass,
  additionalHeaders = {}
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        "User-Agent": "programmable-v4-hook-builder-drift-check",
        ...additionalHeaders
      },
      redirect: "error",
      signal: controller.signal
    });
    if (!response?.ok) {
      const rateLimit = response?.headers?.get?.("x-ratelimit-remaining");
      const suffix = rateLimit === "0" ? " (GitHub public API rate limit exhausted)" : "";
      throw new ErrorClass(`${url}: HTTP ${response?.status ?? "unknown"}${suffix}`);
    }
    const contentLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(contentLength) && contentLength > limit) {
      throw new ErrorClass(`${url}: response exceeds the ${limit} byte limit`);
    }
    if (!response.body || typeof response.body.getReader !== "function") {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > limit) throw new ErrorClass(`${url}: response exceeds the ${limit} byte limit`);
      return bytes;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ErrorClass(`${url}: response exceeds the ${limit} byte limit`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    if (error instanceof ErrorClass) throw error;
    const detail = controller.signal.aborted
      ? `request timed out after ${timeoutMs}ms`
      : error instanceof Error ? error.message : String(error);
    throw new ErrorClass(`${url}: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }
}

export function githubAuthorizationHeaders(token, ErrorClass) {
  if (token === null || token === undefined || token === "") return Object.freeze({});
  if (typeof token !== "string" || token.length > 2_048 || /[\r\n]/u.test(token)) {
    throw new ErrorClass("GitHub API token must be one bounded single-line value");
  }
  return Object.freeze({ Authorization: `Bearer ${token}` });
}
