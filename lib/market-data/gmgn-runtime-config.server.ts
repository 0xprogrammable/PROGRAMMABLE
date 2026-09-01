import "server-only";

export const GMGN_PRO_REQUESTS_PER_SECOND_V1 = 20 as const;

const GMGN_DEFAULT_REQUESTS_PER_SECOND_V1 = 1 as const;
const CANONICAL_GMGN_REQUESTS_PER_SECOND = /^(?:[1-9]|1[0-9]|20)$/u;

export function gmgnEffectiveRequestsPerSecondV1(): number {
  const configured = process.env.GMGN_MAX_REQUESTS_PER_SECOND ??
    String(GMGN_DEFAULT_REQUESTS_PER_SECOND_V1);
  return CANONICAL_GMGN_REQUESTS_PER_SECOND.test(configured)
    ? Number(configured)
    : GMGN_DEFAULT_REQUESTS_PER_SECOND_V1;
}
