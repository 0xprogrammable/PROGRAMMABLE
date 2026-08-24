export const PREDICTION_TOKEN_PROFILE_CHAINS_V2 = Object.freeze([
  Object.freeze({
    id: "ethereum",
    reference: "1",
    label: "Ethereum",
    namespace: "evm",
    explorerOrigin: "https://etherscan.io",
  }),
  Object.freeze({
    id: "base",
    reference: "8453",
    label: "Base",
    namespace: "evm",
    explorerOrigin: "https://basescan.org",
  }),
  Object.freeze({
    id: "bnb",
    reference: "56",
    label: "BNB Chain",
    namespace: "evm",
    explorerOrigin: "https://bscscan.com",
  }),
  Object.freeze({
    id: "robinhood",
    reference: "4663",
    label: "Robinhood Chain",
    namespace: "evm",
    explorerOrigin: "https://robinhoodchain.blockscout.com",
  }),
  Object.freeze({
    id: "solana",
    reference: "mainnet-beta",
    label: "Solana",
    namespace: "solana",
    explorerOrigin: "https://solscan.io",
  }),
] as const);

export type PredictionTokenProfileChainIdV2 =
  (typeof PREDICTION_TOKEN_PROFILE_CHAINS_V2)[number]["id"];

export type PredictionTokenProfileChainV2 = Readonly<{
  id: PredictionTokenProfileChainIdV2;
  reference: string;
  label: string;
}>;

export type PredictionTokenProfileLinkV2 = Readonly<{
  kind: "website" | "x" | "telegram";
  url: string;
}>;

export type PredictionTokenProfileAgeV2 = Readonly<{
  pairCreatedAt: string;
  seconds: number;
}>;

export type PredictionTokenProfileV2 = Readonly<{
  schemaVersion: 2;
  chain: PredictionTokenProfileChainV2;
  address: string;
  explorerUrl: string;
  name?: string;
  symbol?: string;
  logoUrl?: string;
  links?: readonly PredictionTokenProfileLinkV2[];
  priceUsd?: number;
  /** Provider-reported display value; not circulating-supply evidence. */
  marketCapUsd?: number;
  /** Provider-reported fully diluted valuation. Never labeled as market cap. */
  fdvUsd?: number;
  liquidityUsd?: number;
  age?: PredictionTokenProfileAgeV2;
}>;

/**
 * Deliberately provider-neutral, untrusted input. Discovery readers should map
 * their response into this shape before anything reaches the UI or API.
 */
export type PredictionTokenProfileCandidateV2 = Readonly<{
  chain: unknown;
  address: unknown;
  name?: unknown;
  symbol?: unknown;
  logoUrl?: unknown;
  imageUrl?: unknown;
  website?: unknown;
  websites?: unknown;
  x?: unknown;
  twitter?: unknown;
  telegram?: unknown;
  socials?: unknown;
  priceUsd?: unknown;
  marketCapUsd?: unknown;
  fdvUsd?: unknown;
  liquidityUsd?: unknown;
  pairCreatedAtMs?: unknown;
  pairCreatedAt?: unknown;
}>;

const CHAIN_ALIASES = Object.freeze({
  ethereum: "ethereum",
  eth: "ethereum",
  "1": "ethereum",
  base: "base",
  "8453": "base",
  bnb: "bnb",
  bsc: "bnb",
  "bnb-chain": "bnb",
  "56": "bnb",
  robinhood: "robinhood",
  "robinhood-chain": "robinhood",
  "4663": "robinhood",
  solana: "solana",
  "mainnet-beta": "solana",
} as const satisfies Record<string, PredictionTokenProfileChainIdV2>);

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const ZERO_EVM_ADDRESS = `0x${"0".repeat(40)}`;
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/u;
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const UNSAFE_TEXT_PATTERN =
  /[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
const UNSAFE_URL_INPUT_PATTERN = /[\u0000-\u0020\u007f]/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;
const MAX_URL_BYTES = 2_048;
const MAX_LINK_CANDIDATES = 16;
const MAX_TOTAL_LINK_CANDIDATES = 64;
const MAX_USD_VALUE = 1e18;

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
const TELEGRAM_HOSTS = new Set([
  "t.me",
  "www.t.me",
  "telegram.me",
  "www.telegram.me",
]);
const PRIVATE_HOST_SUFFIXES = Object.freeze([
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".arpa",
  ".test",
  ".invalid",
  ".example",
]);

type ResolvedChain = (typeof PREDICTION_TOKEN_PROFILE_CHAINS_V2)[number];
type SafeUrl = Readonly<{ parsed: URL; canonical: string }>;

export function normalizePredictionTokenProfileV2(
  candidate: unknown,
  observedAtMs: number,
): PredictionTokenProfileV2 | null {
  if (!isRecord(candidate)) return null;
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0 ||
    !Number.isFinite(new Date(observedAtMs).getTime())) {
    throw new TypeError("observedAtMs must be a non-negative safe integer");
  }

  const chain = resolveChain(candidate.chain);
  if (!chain) return null;
  const address = normalizeAddress(chain, candidate.address);
  if (!address) return null;

  const name = safeText(candidate.name, 80, true);
  const symbol = safeText(candidate.symbol, 24, false);
  const logoUrl = safeHttpsUrl(candidate.logoUrl)?.canonical ??
    safeHttpsUrl(candidate.imageUrl)?.canonical;
  const links = normalizeLinks(candidate);
  const priceUsd = safeUsd(candidate.priceUsd, false);
  const marketCapUsd = safeUsd(candidate.marketCapUsd, false);
  const fdvUsd = safeUsd(candidate.fdvUsd, false);
  const liquidityUsd = safeUsd(candidate.liquidityUsd, true);
  const age = normalizeAge(
    candidate.pairCreatedAtMs ?? candidate.pairCreatedAt,
    observedAtMs,
  );

  return Object.freeze({
    schemaVersion: 2,
    chain: Object.freeze({
      id: chain.id,
      reference: chain.reference,
      label: chain.label,
    }),
    address,
    explorerUrl: `${chain.explorerOrigin}/token/${address}`,
    ...(name ? { name } : {}),
    ...(symbol ? { symbol } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(links.length > 0 ? { links: Object.freeze(links) } : {}),
    ...(priceUsd !== null ? { priceUsd } : {}),
    ...(marketCapUsd !== null ? { marketCapUsd } : {}),
    ...(fdvUsd !== null ? { fdvUsd } : {}),
    ...(liquidityUsd !== null ? { liquidityUsd } : {}),
    ...(age ? { age } : {}),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveChain(value: unknown): ResolvedChain | null {
  const key = typeof value === "number"
    ? Number.isSafeInteger(value) ? String(value) : ""
    : typeof value === "string" ? value.trim().toLowerCase() : "";
  const id = CHAIN_ALIASES[key as keyof typeof CHAIN_ALIASES];
  return id
    ? PREDICTION_TOKEN_PROFILE_CHAINS_V2.find((chain) => chain.id === id) ?? null
    : null;
}

function normalizeAddress(chain: ResolvedChain, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = value.trim();
  if (chain.namespace === "evm") {
    if (!EVM_ADDRESS_PATTERN.test(address)) return null;
    const canonical = address.toLowerCase();
    return canonical === ZERO_EVM_ADDRESS ? null : canonical;
  }
  const decoded = decodeBase58(address);
  if (!decoded || decoded.length !== 32 || decoded.every((byte) => byte === 0)) {
    return null;
  }
  return address;
}

function decodeBase58(value: string): Uint8Array | null {
  if (!value || value.length > 64 || !BASE58_PATTERN.test(value)) return null;
  const littleEndian = [0];
  for (const character of value) {
    const alphabetIndex = BASE58_ALPHABET.indexOf(character);
    if (alphabetIndex < 0) return null;
    let carry = alphabetIndex;
    for (let index = 0; index < littleEndian.length; index += 1) {
      carry += littleEndian[index] * 58;
      littleEndian[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      littleEndian.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === "1") {
    leadingZeroes += 1;
  }
  const payloadLength = littleEndian.length === 1 && littleEndian[0] === 0
    ? 0
    : littleEndian.length;
  const decoded = new Uint8Array(leadingZeroes + payloadLength);
  for (let index = 0; index < payloadLength; index += 1) {
    decoded[decoded.length - 1 - index] = littleEndian[index];
  }
  return decoded;
}

function safeText(
  value: unknown,
  maximumCharacters: number,
  allowWhitespace: boolean,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  if (!normalized || UNSAFE_TEXT_PATTERN.test(normalized)) return null;
  const text = allowWhitespace ? normalized.replace(/\s+/gu, " ") : normalized;
  if ((!allowWhitespace && /\s/u.test(text)) ||
    Array.from(text).length > maximumCharacters ||
    new TextEncoder().encode(text).length > maximumCharacters * 4) {
    return null;
  }
  return text;
}

function safeHttpsUrl(value: unknown): SafeUrl | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_URL_BYTES ||
    new TextEncoder().encode(raw).length > MAX_URL_BYTES ||
    UNSAFE_URL_INPUT_PATTERN.test(raw)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
    (parsed.port && parsed.port !== "443") || !isPublicHostname(hostname)) {
    return null;
  }
  parsed.hash = "";
  return Object.freeze({ parsed, canonical: parsed.toString() });
}

function isPublicHostname(hostname: string): boolean {
  if (!hostname || hostname.endsWith(".") || hostname.includes(":")) return false;
  if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u.test(hostname)) return false;
  if (!/^[a-z0-9.-]+$/u.test(hostname) || !hostname.includes(".")) return false;
  const labels = hostname.split(".");
  if (labels.some((label) => !label || label.length > 63 ||
    label.startsWith("-") || label.endsWith("-"))) {
    return false;
  }
  return hostname !== "localhost" &&
    !PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function normalizeLinks(
  candidate: Record<string, unknown>,
): PredictionTokenProfileLinkV2[] {
  const byKind = new Map<PredictionTokenProfileLinkV2["kind"], string>();
  const seenUrls = new Set<string>();
  const candidates = [
    ...linkCandidates(candidate.website),
    ...linkCandidates(candidate.websites),
    ...linkCandidates(candidate.x),
    ...linkCandidates(candidate.twitter),
    ...linkCandidates(candidate.telegram),
    ...linkCandidates(candidate.socials),
  ].slice(0, MAX_TOTAL_LINK_CANDIDATES);

  for (const value of candidates) {
    const safe = safeHttpsUrl(value);
    if (!safe) continue;
    const socialKind = socialKindForHostname(safe.parsed.hostname.toLowerCase());
    const kind = socialKind ?? "website";
    if (!socialKind && !isWebsiteCandidate(value, candidate)) continue;

    const canonical = socialKind
      ? canonicalSocialUrl(safe.parsed, socialKind)
      : safe.canonical;
    if (!canonical || seenUrls.has(canonical) || byKind.has(kind)) continue;
    seenUrls.add(canonical);
    byKind.set(kind, canonical);
  }

  return (["website", "x", "telegram"] as const).flatMap((kind) => {
    const url = byKind.get(kind);
    return url ? [Object.freeze({ kind, url })] : [];
  });
}

function linkCandidates(value: unknown): string[] {
  const entries = Array.isArray(value) ? value.slice(0, MAX_LINK_CANDIDATES) : [value];
  return entries.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!isRecord(entry)) return [];
    return typeof entry.url === "string" ? [entry.url] : [];
  });
}

function isWebsiteCandidate(
  value: string,
  candidate: Record<string, unknown>,
): boolean {
  return linkCandidates(candidate.website).includes(value) ||
    linkCandidates(candidate.websites).includes(value);
}

function socialKindForHostname(
  hostname: string,
): "x" | "telegram" | null {
  if (X_HOSTS.has(hostname)) return "x";
  if (TELEGRAM_HOSTS.has(hostname)) return "telegram";
  return null;
}

function canonicalSocialUrl(
  source: URL,
  kind: "x" | "telegram",
): string | null {
  if (source.pathname === "/") return null;
  const parsed = new URL(source.toString());
  parsed.hostname = kind === "x" ? "x.com" : "t.me";
  parsed.port = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function safeUsd(value: unknown, allowZero: boolean): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && DECIMAL_PATTERN.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric > MAX_USD_VALUE ||
    (allowZero ? numeric < 0 : numeric <= 0)) {
    return null;
  }
  return numeric;
}

function normalizeAge(
  value: unknown,
  observedAtMs: number,
): PredictionTokenProfileAgeV2 | null {
  const createdAtMs = timestampMs(value);
  if (createdAtMs === null || createdAtMs > observedAtMs) return null;
  return Object.freeze({
    pairCreatedAt: new Date(createdAtMs).toISOString(),
    seconds: Math.floor((observedAtMs - createdAtMs) / 1_000),
  });
}

function timestampMs(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 &&
      Number.isFinite(new Date(value).getTime()) ? value : null;
  }
  if (typeof value !== "string") return null;
  if (/^(?:0|[1-9][0-9]{0,15})$/u.test(value)) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) &&
      Number.isFinite(new Date(numeric).getTime()) ? numeric : null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    ? parsed.getTime()
    : null;
}
