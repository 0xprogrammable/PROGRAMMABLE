export const DEEP_V2_KEEPER_LEASE_PATH: string;
export const DEEP_V2_KEEPER_LEASE_DURATION_MS: number;

export class DeepV2KeeperLeaseError extends Error {}

export type DeepV2KeeperLeaseStore = {
  read(path: string): Promise<{ value: string; etag: string } | null>;
  putIfAbsent(
    path: string,
    value: string,
  ): Promise<{ etag: string } | null>;
  putIfMatch(
    path: string,
    value: string,
    etag: string,
  ): Promise<{ etag: string } | null>;
};

export type DeepV2KeeperLease = {
  ownerId: string;
  generation: number;
  fencingToken: string;
  acquiredAtMs: number;
  expiresAtMs: number;
  etag: string;
  boundaryState?: Record<string, unknown> | null;
};

export function acquireDeepV2KeeperLease(input: {
  store: DeepV2KeeperLeaseStore;
  nowMs: number;
  ownerId?: string;
  durationMs?: number;
  createFencingToken?: () => string;
}): Promise<DeepV2KeeperLease | null>;

export function assertDeepV2KeeperLease(input: {
  store: Pick<DeepV2KeeperLeaseStore, "read">;
  lease: DeepV2KeeperLease;
  nowMs: number;
}): Promise<boolean>;

export function writeDeepV2KeeperLeaseState(input: {
  store: Pick<DeepV2KeeperLeaseStore, "putIfMatch">;
  lease: DeepV2KeeperLease;
  boundaryState: Record<string, unknown>;
  nowMs: number;
}): Promise<{ etag: string } | null>;

export function releaseDeepV2KeeperLease(input: {
  store: Pick<DeepV2KeeperLeaseStore, "putIfMatch">;
  lease: DeepV2KeeperLease;
  nowMs: number;
}): Promise<boolean>;
