import "server-only";

import { loadDataPipelineConfig } from "./config";

type ActivationEnvironment = Readonly<
  Record<string, string | undefined>
>;

/**
 * Action preparation is deliberately independent from every public-read flag.
 * This is the only activation check used before action routes query Postgres.
 */
export function indexedLaunchLookupEnabled(
  env: ActivationEnvironment = process.env,
): boolean {
  return loadDataPipelineConfig(env).flags.INDEXED_LAUNCH_LOOKUP_ENABLED;
}

/** Public GMGN/token-list feeds have their own release switch. */
export function indexedPublicIndexerFeedEnabled(
  env: ActivationEnvironment = process.env,
): boolean {
  return loadDataPipelineConfig(env).flags
    .INDEXED_PUBLIC_INDEXER_FEED_READS_ENABLED;
}
