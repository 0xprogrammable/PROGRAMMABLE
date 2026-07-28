type ErrorLike = {
  name?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  code?: unknown;
  data?: unknown;
  cause?: unknown;
};

const MAX_ERROR_CHAIN_DEPTH = 6;
const MAX_SUMMARY_LENGTH = 240;

function firstLine(value: unknown) {
  if (typeof value !== "string") return undefined;
  const line = value.split(/\r?\n/, 1)[0]?.trim();
  return line ? line.slice(0, MAX_SUMMARY_LENGTH) : undefined;
}

function errorRecord(value: unknown): ErrorLike | null {
  return typeof value === "object" && value !== null
    ? (value as ErrorLike)
    : null;
}

export function errorChainIncludesData(
  error: unknown,
  expectedSelector: `0x${string}`,
) {
  const selector = expectedSelector.toLowerCase();
  const seen = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CHAIN_DEPTH; depth += 1) {
    const record = errorRecord(current);
    if (!record || seen.has(record)) return false;
    seen.add(record);

    if (
      typeof record.data === "string" &&
      record.data.slice(0, selector.length).toLowerCase() === selector
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

export function safeServerErrorSummary(error: unknown) {
  const chain: Array<{
    name?: string;
    message?: string;
    code?: string | number;
    dataSelector?: string;
  }> = [];
  const seen = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_ERROR_CHAIN_DEPTH; depth += 1) {
    const record = errorRecord(current);
    if (!record || seen.has(record)) break;
    seen.add(record);

    const entry = {
      name: firstLine(record.name),
      message:
        firstLine(record.shortMessage) ?? firstLine(record.message),
      code:
        typeof record.code === "string" ||
        typeof record.code === "number"
          ? record.code
          : undefined,
      dataSelector:
        typeof record.data === "string" &&
        /^0x[0-9a-fA-F]{8}/.test(record.data)
          ? record.data.slice(0, 10).toLowerCase()
          : undefined,
    };
    if (
      entry.name ||
      entry.message ||
      entry.code !== undefined ||
      entry.dataSelector
    ) {
      chain.push(entry);
    }
    current = record.cause;
  }

  return chain.length > 0
    ? { chain }
    : { chain: [{ message: "Unknown server error" }] };
}
