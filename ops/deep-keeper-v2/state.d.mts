import type { DeepV2KeeperLease } from "./lease.mjs";

export const DEEP_V2_KEEPER_STATE_PATH: string;

export class DeepV2KeeperStateError extends Error {
  code: string;
}

export type DeepV2KeeperStateStore = {
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

export function createDeepV2StateWriter<
  State extends Record<string, unknown> & {
    fencingGeneration: number;
  },
>(input: {
  store: DeepV2KeeperStateStore;
  lease: DeepV2KeeperLease;
  assertLease(lease: DeepV2KeeperLease): Promise<boolean>;
  now?: () => number;
}): {
  readonly etag: string;
  write(state: State): Promise<boolean>;
};
