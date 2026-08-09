import "server-only";

import { getAddress, isAddress } from "viem";

import type { Sha256Digest } from
  "@/lib/server/projection-target/hashing";
import {
  ManualRouterHttpErrorV1,
  exactManualRouterObjectV1,
} from "@/lib/server/custom-launch/manual-router-http-v1";

export type ManualRouterApplicantListRequestV1 = Readonly<{
  schemaVersion: "programmable.manual-router-applicant-list-request.v1";
  launchWallet: `0x${string}`;
}>;

export type ManualRouterApplicantResolveRequestV1 = Readonly<{
  schemaVersion: "programmable.manual-router-applicant-resolve-request.v1";
  launchWallet: `0x${string}`;
  subjectHash: Sha256Digest;
}>;

export type ManualRouterApplicantTransactionRequestV1 = Readonly<{
  schemaVersion:
    | "programmable.manual-router-applicant-transaction-request.v1"
    | "programmable.manual-router-applicant-finality-request.v1";
  launchWallet: `0x${string}`;
  subjectHash: Sha256Digest;
  descriptorHash: Sha256Digest;
  preparationHash: Sha256Digest;
  transactionHash: `0x${string}`;
}>;

export function parseManualRouterApplicantListRequestV1(
  raw: unknown,
): ManualRouterApplicantListRequestV1 {
  const value = exactManualRouterObjectV1(
    raw,
    ["launchWallet", "schemaVersion"],
    "manual Router Applicant list request",
  );
  if (value.schemaVersion !== "programmable.manual-router-applicant-list-request.v1") {
    throw invalid();
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    launchWallet: address(value.launchWallet),
  });
}

export function parseManualRouterApplicantResolveRequestV1(
  raw: unknown,
): ManualRouterApplicantResolveRequestV1 {
  const value = exactManualRouterObjectV1(
    raw,
    ["launchWallet", "schemaVersion", "subjectHash"],
    "manual Router Applicant resolve request",
  );
  if (value.schemaVersion
    !== "programmable.manual-router-applicant-resolve-request.v1") {
    throw invalid();
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    launchWallet: address(value.launchWallet),
    subjectHash: sha256(value.subjectHash),
  });
}

export function parseManualRouterApplicantTransactionRequestV1(
  raw: unknown,
  kind: "report" | "finality",
): ManualRouterApplicantTransactionRequestV1 {
  const value = exactManualRouterObjectV1(raw, [
    "descriptorHash", "launchWallet", "preparationHash", "schemaVersion",
    "subjectHash", "transactionHash",
  ], "manual Router Applicant transaction request");
  const schemaVersion = kind === "report"
    ? "programmable.manual-router-applicant-transaction-request.v1" as const
    : "programmable.manual-router-applicant-finality-request.v1" as const;
  if (value.schemaVersion !== schemaVersion) throw invalid();
  return Object.freeze({
    schemaVersion,
    launchWallet: address(value.launchWallet),
    subjectHash: sha256(value.subjectHash),
    descriptorHash: sha256(value.descriptorHash),
    preparationHash: sha256(value.preparationHash),
    transactionHash: bytes32(value.transactionHash),
  });
}

function address(value: unknown): `0x${string}` {
  if (
    typeof value !== "string"
    || !isAddress(value, { strict: true })
    || BigInt(value) === 0n
  ) throw invalid();
  return getAddress(value);
}

function sha256(value: unknown): Sha256Digest {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw invalid();
  }
  return value as Sha256Digest;
}

function bytes32(value: unknown): `0x${string}` {
  if (
    typeof value !== "string"
    || !/^0x[0-9a-f]{64}$/u.test(value)
    || BigInt(value) === 0n
  ) throw invalid();
  return value as `0x${string}`;
}

function invalid(): ManualRouterHttpErrorV1 {
  return new ManualRouterHttpErrorV1(400, "invalid_request", false);
}
