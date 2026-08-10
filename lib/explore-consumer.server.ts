import "server-only";

export const EXPLORE_LAST_KNOWN_GOOD_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export type ExploreConsumerSource<T> = Readonly<{
  value: T;
  status: "current" | "last-known-good";
  ageMs: number;
  origin: "primary" | "fallback" | "memory";
}>;

type ExploreOperationalDeployment = Readonly<{
  status: string;
  rpcUrlSecondary?: string | null;
}>;

type SourceCandidate<T> = Readonly<{
  value: T;
  ageMs?: number;
}>;

type LastKnownGood<T> = Readonly<{
  value: T;
  observedAt: number;
}>;

/**
 * A small provider-neutral consumer boundary. It never turns an unavailable
 * source into an empty dataset: primary, integrity-checked fallback, then a
 * bounded in-memory last-known-good value are tried in that order.
 */
export function createExploreConsumerSource<T>(input: Readonly<{
  maxAgeMs?: number;
  now?: () => number;
}>) {
  const maximumAge = input.maxAgeMs ?? EXPLORE_LAST_KNOWN_GOOD_MAX_AGE_MS;
  const now = input.now ?? Date.now;
  let lastKnownGood: LastKnownGood<T> | null = null;

  return async function readSource(readers: Readonly<{
    primary: () => Promise<T>;
    fallback?: () => Promise<SourceCandidate<T>>;
  }>): Promise<ExploreConsumerSource<T>> {
    let primaryError: unknown;
    try {
      const value = await readers.primary();
      lastKnownGood = { value, observedAt: now() };
      return { value, status: "current", ageMs: 0, origin: "primary" };
    } catch (error) {
      primaryError = error;
    }

    if (readers.fallback) {
      try {
        const candidate = await readers.fallback();
        const ageMs = Math.max(0, candidate.ageMs ?? 0);
        if (!Number.isSafeInteger(ageMs) || ageMs > maximumAge) {
          throw new Error("Explore fallback is outside the freshness window");
        }
        lastKnownGood = {
          value: candidate.value,
          observedAt: now() - ageMs,
        };
        return {
          value: candidate.value,
          status: "last-known-good",
          ageMs,
          origin: "fallback",
        };
      } catch {
        // The bounded memory value below is safer than returning an empty set.
      }
    }

    if (lastKnownGood !== null) {
      const ageMs = Math.max(0, now() - lastKnownGood.observedAt);
      if (ageMs <= maximumAge) {
        return {
          value: lastKnownGood.value,
          status: "last-known-good",
          ageMs,
          origin: "memory",
        };
      }
    }

    throw primaryError;
  };
}

function joinSourceLabels(labels: readonly (string | null)[]): string {
  const components = labels.flatMap((label) => label?.split("+") ?? []);
  return [...new Set(components)].join("+") || "unavailable";
}

function canonicalLaunchSourceLabel(
  source: ExploreConsumerSource<unknown> | null,
): string | null {
  if (source === null) return null;
  if (source.origin === "fallback") return "durable";
  if (source.origin === "memory") return "last-known-good";
  return "operational+durable";
}

function customLaunchSourceLabel(
  source: ExploreConsumerSource<unknown> | null,
): string | null {
  if (source === null) return null;
  return source.status === "current"
    ? "registry.custom-launched"
    : "registry.custom-launched.last-known-good";
}

/**
 * Describes the launch identity sources that were actually available. A
 * missing canonical or Custom source stays visible as `partial` instead of
 * being mislabeled as an operational read.
 */
export function exploreLaunchSourceHeader(input: Readonly<{
  canonical: ExploreConsumerSource<unknown> | null;
  custom: ExploreConsumerSource<unknown> | null;
}>): string {
  return joinSourceLabels([
    canonicalLaunchSourceLabel(input.canonical) ?? "partial",
    customLaunchSourceLabel(input.custom) ?? "partial",
  ]);
}

/** Describes only stores/transports that returned usable data. */
export function exploreReadSourceHeader(input: Readonly<{
  canonical: ExploreConsumerSource<unknown> | null;
  custom: ExploreConsumerSource<unknown> | null;
}>): string {
  const canonical = input.canonical === null
    ? null
    : input.canonical.origin === "primary"
      ? "operational+durable"
      : input.canonical.origin === "fallback"
        ? "durable"
        : "last-known-good";
  const custom = input.custom === null
    ? null
    : input.custom.origin === "primary"
      ? "postgres"
      : "last-known-good";
  return joinSourceLabels([canonical, custom]);
}

/**
 * The Website's operational RPC boundary is provider-neutral. Omit this
 * header when no usable operational deployment participated in the response.
 */
export function exploreRpcProviderHeader(
  deployment: ExploreOperationalDeployment | null,
): "operational-dual" | "operational-primary" | null {
  if (deployment?.status !== "ready") return null;
  return deployment.rpcUrlSecondary
    ? "operational-dual"
    : "operational-primary";
}
