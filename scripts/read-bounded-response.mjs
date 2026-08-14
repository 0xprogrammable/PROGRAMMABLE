export async function readBoundedResponseText(response, options) {
  const maximumBytes = options?.maximumBytes;
  const label = options?.label;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || typeof label !== "string" || label.length < 1 || /[\r\n]/u.test(label)) {
    throw new Error("bounded response reader options are invalid");
  }
  const declaredLength = response?.headers?.get?.("content-length");
  if (declaredLength !== null
    && (typeof declaredLength !== "string"
      || !/^(?:0|[1-9][0-9]{0,15})$/u.test(declaredLength)
      || BigInt(declaredLength) > BigInt(maximumBytes))) {
    await response?.body?.cancel?.("invalid content-length").catch(() => {});
    throw new Error(`${label} is too large`);
  }
  const reader = response?.body?.getReader?.();
  if (!reader) throw new Error(`${label} body is unavailable`);
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength === 0) {
        await reader.cancel("invalid response body").catch(() => {});
        throw new Error(`${label} body is invalid`);
      }
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel("response body limit exceeded").catch(() => {});
        throw new Error(`${label} is too large`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length).toString("utf8");
}
