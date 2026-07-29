export const DEEP_KEEPER_LEASE_PATH: string;
export const DEEP_KEEPER_LEASE_DURATION_MS: number;

export class DeepKeeperLeaseError extends Error {}

export function acquireDeepKeeperLease(input: {
  store: {
    read(path: string): Promise<{ value: string; etag: string } | null>;
    putIfAbsent(path: string, value: string): Promise<{ etag: string } | null>;
    putIfMatch(
      path: string,
      value: string,
      etag: string,
    ): Promise<{ etag: string } | null>;
  };
  nowMs: number;
  ownerId?: string;
  durationMs?: number;
}): Promise<{
  ownerId: string;
  acquiredAtMs: number;
  expiresAtMs: number;
  etag: string;
} | null>;

export function releaseDeepKeeperLease(input: {
  store: {
    putIfMatch(
      path: string,
      value: string,
      etag: string,
    ): Promise<{ etag: string } | null>;
  };
  lease: {
    ownerId: string;
    acquiredAtMs: number;
    etag: string;
  };
  nowMs: number;
}): Promise<boolean>;
