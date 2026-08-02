import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { keccak256, toBytes } from "viem";

import {
  bytes32FromBytea,
  canonicalBytes32,
  hexToBytes,
  parseNonnegativeIntegerText,
  type HexBytes32,
} from "./codecs";
import { invalidInput } from "./errors";
import type {
  PostgresExecutor,
  PostgresTransaction,
} from "./postgres";
import type { ProjectorRuntimeFence } from "./postgres-projector";

const RUNTIME_LOGIN_ROLE = "programmable_projector_runtime_login";
const RUNTIME_CAPABILITY_ROLE = "programmable_projector_runtime";
const LEASE_TTL_MS = 85_000;
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;

type RuntimeLeaseAcquisition = Readonly<{
  status: "acquired" | "busy";
  fence?: ProjectorRuntimeFence;
  acquiredAt: string;
  expiresAt: string;
}>;

function invalidRuntimeLease(): never {
  throw invalidInput("postgres", "runtime-lease");
}

function timestamp(value: unknown): string {
  const date = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : null;
  if (date === null || !Number.isFinite(date.valueOf())) {
    return invalidRuntimeLease();
  }
  return date.toISOString();
}

function generation(value: unknown): string {
  try {
    return parseNonnegativeIntegerText(
      typeof value === "bigint" ? value.toString() : value,
    );
  } catch {
    return invalidRuntimeLease();
  }
}

function runtimeTokenHash(): HexBytes32 {
  return keccak256(randomBytes(32));
}

async function assumeRuntimeRole(
  transaction: PostgresTransaction,
): Promise<void> {
  const loginRows = await transaction.query<{ session_user: unknown }>(
    "select session_user::text as session_user",
  );
  if (
    loginRows.length !== 1 ||
    loginRows[0]?.session_user !== RUNTIME_LOGIN_ROLE
  ) {
    return invalidRuntimeLease();
  }
  await transaction.query("set local role programmable_projector_runtime");
  await transaction.query("set local statement_timeout = '1000ms'");
  await transaction.query("set local lock_timeout = '250ms'");
  await transaction.query(
    "set local idle_in_transaction_session_timeout = '2000ms'",
  );
  const roleRows = await transaction.query<{
    session_user: unknown;
    current_role: unknown;
    configured_role: unknown;
  }>(
    "select session_user::text as session_user, current_role::text as current_role, current_setting('role')::text as configured_role",
  );
  if (
    roleRows.length !== 1 ||
    roleRows[0]?.session_user !== RUNTIME_LOGIN_ROLE ||
    roleRows[0]?.current_role !== RUNTIME_CAPABILITY_ROLE ||
    roleRows[0]?.configured_role !== RUNTIME_CAPABILITY_ROLE
  ) {
    return invalidRuntimeLease();
  }
}

export function createProjectorRuntimeLeaseController(input: Readonly<{
  executor: PostgresExecutor;
  now?: () => Date;
  uuid?: () => string;
  tokenHash?: () => HexBytes32;
}>) {
  const now = input.now ?? (() => new Date());
  const uuid = input.uuid ?? randomUUID;
  const tokenHash = input.tokenHash ?? runtimeTokenHash;

  return Object.freeze({
    async tryAcquire(): Promise<RuntimeLeaseAcquisition> {
      const holderId = `projector-runtime-${uuid()}`;
      if (!/^projector-runtime-[0-9a-f-]{36}$/u.test(holderId)) {
        return invalidRuntimeLease();
      }
      const requestedAt = now();
      if (!Number.isFinite(requestedAt.valueOf())) {
        return invalidRuntimeLease();
      }
      const requestedExpiresAt = new Date(
        requestedAt.valueOf() + LEASE_TTL_MS,
      );
      const leaseTokenHash = canonicalBytes32(tokenHash());
      if (leaseTokenHash === ZERO_BYTES32) return invalidRuntimeLease();
      const inputCommitment = keccak256(
        toBytes(
          JSON.stringify([
            holderId,
            leaseTokenHash,
            requestedAt.toISOString(),
            requestedExpiresAt.toISOString(),
          ]),
        ),
      );
      return input.executor.transaction(async (transaction) => {
        await assumeRuntimeRole(transaction);
        const rows = await transaction.query<{
          acquired: unknown;
          lease_generation: unknown;
          acquired_at: unknown;
          expires_at: unknown;
        }>(
          "select * from programmable_private.try_acquire_projector_runtime_lease_v1($1, $2::bytea, $3::timestamptz, $4::timestamptz, $5::bytea)",
          [
            holderId,
            hexToBytes(leaseTokenHash),
            requestedAt.toISOString(),
            requestedExpiresAt.toISOString(),
            hexToBytes(inputCommitment),
          ],
        );
        if (rows.length !== 1 || typeof rows[0]?.acquired !== "boolean") {
          return invalidRuntimeLease();
        }
        const row = rows[0]!;
        const acquiredAt = timestamp(row.acquired_at);
        const expiresAt = timestamp(row.expires_at);
        const leaseGeneration = generation(row.lease_generation);
        const duration =
          new Date(expiresAt).valueOf() - new Date(acquiredAt).valueOf();
        if (duration < 1 || duration > 90_000) {
          return invalidRuntimeLease();
        }
        if (!row.acquired) {
          return Object.freeze({
            status: "busy" as const,
            acquiredAt,
            expiresAt,
          });
        }
        if (
          Math.abs(
            new Date(acquiredAt).valueOf() - requestedAt.valueOf(),
          ) > 30_000 ||
          duration !== LEASE_TTL_MS
        ) {
          return invalidRuntimeLease();
        }
        return Object.freeze({
          status: "acquired" as const,
          fence: Object.freeze({
            holderId,
            generation: leaseGeneration,
            tokenHash: bytes32FromBytea(hexToBytes(leaseTokenHash)),
          }),
          acquiredAt,
          expiresAt,
        });
      });
    },

    async release(fence: ProjectorRuntimeFence): Promise<boolean> {
      const releasedAt = now();
      if (!Number.isFinite(releasedAt.valueOf())) {
        return invalidRuntimeLease();
      }
      const inputCommitment = keccak256(
        toBytes(
          JSON.stringify([
            fence.holderId,
            fence.generation,
            fence.tokenHash,
            releasedAt.toISOString(),
          ]),
        ),
      );
      return input.executor.transaction(async (transaction) => {
        await assumeRuntimeRole(transaction);
        const rows = await transaction.query<{ released: unknown }>(
          "select programmable_private.release_projector_runtime_lease_v1($1, $2::bigint, $3::bytea, $4::timestamptz, $5::bytea) as released",
          [
            fence.holderId,
            fence.generation,
            hexToBytes(fence.tokenHash),
            releasedAt.toISOString(),
            hexToBytes(inputCommitment),
          ],
        );
        if (rows.length !== 1 || typeof rows[0]?.released !== "boolean") {
          return invalidRuntimeLease();
        }
        return rows[0].released;
      });
    },
  });
}

export type ProjectorRuntimeLeaseController = ReturnType<
  typeof createProjectorRuntimeLeaseController
>;
