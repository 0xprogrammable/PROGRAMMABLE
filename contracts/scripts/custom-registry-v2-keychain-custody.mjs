import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { SAFE_CUSTODY_ROLES } from "./custom-registry-v2-safe-controller-guards.mjs";

export function resolveDefaultUserKeychainPath() {
  let value;
  try {
    value = execFileSync(
      "/usr/bin/security",
      ["default-keychain", "-d", "user"],
      {
        encoding: "utf8",
        maxBuffer: 4_096,
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    throw new Error("the current user's default Keychain is unavailable");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }
  if (!path.isAbsolute(value) || !/\.keychain(?:-db)?$/u.test(value)) {
    throw new Error("the current user's default Keychain path is invalid");
  }
  return path.resolve(value);
}

export function resolveUserKeychainSearchList() {
  let value;
  try {
    value = execFileSync(
      "/usr/bin/security",
      ["list-keychains", "-d", "user"],
      {
        encoding: "utf8",
        maxBuffer: 4_096,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    throw new Error("the current user's Keychain search list is unavailable");
  }
  const keychains = value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const unquoted =
        entry.startsWith('"') && entry.endsWith('"')
          ? entry.slice(1, -1)
          : entry;
      if (!path.isAbsolute(unquoted) || !/\.keychain(?:-db)?$/u.test(unquoted)) {
        throw new Error("the current user's Keychain search list is invalid");
      }
      return path.resolve(unquoted);
    });
  if (keychains.length === 0) {
    throw new Error("the current user's Keychain search list is empty");
  }
  return keychains;
}

export function assertDefaultUserKeychainIsSoleSearchTarget({
  defaultKeychainPath = resolveDefaultUserKeychainPath(),
  userKeychainSearchList = resolveUserKeychainSearchList(),
} = {}) {
  if (
    typeof defaultKeychainPath !== "string" ||
    !path.isAbsolute(defaultKeychainPath) ||
    !Array.isArray(userKeychainSearchList) ||
    userKeychainSearchList.length !== 1 ||
    path.resolve(userKeychainSearchList[0]) !== path.resolve(defaultKeychainPath)
  ) {
    throw new Error(
      "the current user's default Keychain is not the sole search target",
    );
  }
  return path.resolve(defaultKeychainPath);
}

export function readDefaultUserKeychainItem({ service, account }) {
  assertDefaultUserKeychainIsSoleSearchTarget();
  try {
    return execFileSync(
      "/usr/bin/security",
      keychainLookupArguments({ service, account }),
      {
        encoding: null,
        maxBuffer: 4_096,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    throw new Error("a required production Keychain custody item is unavailable");
  }
}

export function keychainLookupArguments({ service, account }) {
  if (
    typeof service !== "string" ||
    service.length === 0 ||
    typeof account !== "string" ||
    account.length === 0
  ) {
    throw new Error("Keychain lookup identity is invalid");
  }
  // `security find-generic-password` has no `-k` option. Modern data-protection
  // items are resolved through the user search list, so the caller first proves
  // that list contains only the exact current-user default Keychain.
  return [
    "find-generic-password",
    "-w",
    "-s",
    service,
    "-a",
    account,
  ];
}

export async function verifySafeCustodyRoleReadbacks({
  entries,
  readbackFunction = readDefaultUserKeychainItem,
}) {
  if (!Array.isArray(entries) || entries.length !== SAFE_CUSTODY_ROLES.length) {
    throw new Error("exactly six Keychain custody roles are required");
  }
  const publicAddresses = new Set();
  const privateKeyHashes = new Set();
  const verified = [];
  for (const [index, role] of SAFE_CUSTODY_ROLES.entries()) {
    const entry = entries[index];
    const expectedService =
      `programmable.custom-registry.v2.production-custody.20260813.${role}`;
    if (
      entry?.role !== role ||
      entry.service !== expectedService ||
      !/^0x[0-9a-f]{64}$/u.test(entry.readbackSha256 ?? "")
    ) {
      throw new Error(`Keychain custody metadata is invalid for ${role}`);
    }
    const expectedAddress = getAddress(entry.publicAddress);
    const bytes = await readbackFunction({
      role,
      service: expectedService,
      account: expectedAddress,
    });
    if (!Buffer.isBuffer(bytes)) {
      throw new Error(`Keychain readback is invalid for ${role}`);
    }
    const readbackSha256 = `0x${createHash("sha256")
      .update(bytes)
      .digest("hex")}`;
    const privateKey = bytes.toString("utf8").trim();
    if (
      bytes.length !== 67 ||
      readbackSha256 !== entry.readbackSha256 ||
      !/^0x[0-9a-fA-F]{64}$/u.test(privateKey) ||
      getAddress(privateKeyToAccount(privateKey).address) !== expectedAddress
    ) {
      bytes.fill(0);
      throw new Error(`Keychain readback does not recover ${role}`);
    }
    bytes.fill(0);
    publicAddresses.add(expectedAddress.toLowerCase());
    privateKeyHashes.add(readbackSha256);
    verified.push({ role, publicAddress: expectedAddress, service: expectedService });
  }
  if (
    publicAddresses.size !== SAFE_CUSTODY_ROLES.length ||
    privateKeyHashes.size !== SAFE_CUSTODY_ROLES.length
  ) {
    throw new Error("Keychain custody readbacks do not isolate every role");
  }
  return verified;
}
