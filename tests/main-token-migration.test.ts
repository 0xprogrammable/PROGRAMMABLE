import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";

import {
  assertMainTokenMigrationBalance,
  assertMainTokenMigrationTransaction,
  buildMainTokenMigrationTransaction,
  MAIN_TOKEN_ADDRESS,
  MAIN_TOKEN_DECIMALS,
  MAIN_TOKEN_MIGRATION_CHAIN_ID,
  MAIN_TOKEN_MIGRATION_RELEASE_ID,
  MAIN_TOKEN_MIGRATION_WALLET,
  MAIN_TOKEN_MIGRATION_WINDOW_SECONDS,
  parseMainTokenMigrationAmount,
} from "../lib/main-token-migration";
import {
  buildEip1193TransactionRequest,
  getPreparedTransactionReview,
} from "../lib/prepared-transaction";

const sender = "0x2222222222222222222222222222222222222222";
const other = "0x3333333333333333333333333333333333333333";
const transferAbi = parseAbi([
  "function transfer(address to,uint256 amount) returns (bool)",
]);
const migrationWallet = "0x228Be90653fDDAa408fB6cf9ca0AEC311dbE9A0D";
const migrationWindowSeconds = 96 * 60 * 60;

function readScannerString(source: string, key: string) {
  const match = source.match(new RegExp(`${key}:\\s*"([^"]+)"`, "u"));
  if (!match?.[1]) throw new Error(`Missing scanner policy field ${key}`);
  return match[1];
}

function readScannerBigIntProduct(source: string, key: string) {
  const match = source.match(
    new RegExp(`${key}:\\s*([0-9_n\\s*]+),`, "u"),
  );
  if (!match?.[1]) throw new Error(`Missing scanner policy field ${key}`);
  return match[1].split("*").reduce((product, factor) => {
    const normalized = factor.trim().replaceAll("_", "").replace(/n$/u, "");
    if (!/^[0-9]+$/u.test(normalized)) {
      throw new Error(`Invalid scanner policy field ${key}`);
    }
    return product * BigInt(normalized);
  }, 1n);
}

describe("main token migration transfer", () => {
  it("freezes the 96-hour Ethereum migration identities across UI and scanner", () => {
    const scanner = readFileSync(
      join(process.cwd(), "scripts/main-token-migration-snapshot-core.mjs"),
      "utf8",
    );
    const walletProof = readFileSync(
      join(process.cwd(), "scripts/main-token-migration-wallet-proof.mjs"),
      "utf8",
    );

    expect(MAIN_TOKEN_MIGRATION_CHAIN_ID).toBe(1);
    expect(MAIN_TOKEN_ADDRESS).toBe(
      "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
    );
    expect(MAIN_TOKEN_MIGRATION_WALLET).toBe(migrationWallet);
    expect(MAIN_TOKEN_DECIMALS).toBe(18);
    expect(MAIN_TOKEN_MIGRATION_WINDOW_SECONDS).toBe(migrationWindowSeconds);

    expect(readScannerBigIntProduct(scanner, "chainId")).toBe(
      BigInt(MAIN_TOKEN_MIGRATION_CHAIN_ID),
    );
    expect(readScannerString(scanner, "tokenAddress")).toBe(
      MAIN_TOKEN_ADDRESS,
    );
    expect(readScannerString(scanner, "migrationWallet")).toBe(
      MAIN_TOKEN_MIGRATION_WALLET,
    );
    expect(readScannerBigIntProduct(scanner, "tokenDecimals")).toBe(
      BigInt(MAIN_TOKEN_DECIMALS),
    );
    expect(readScannerBigIntProduct(scanner, "windowSeconds")).toBe(
      BigInt(MAIN_TOKEN_MIGRATION_WINDOW_SECONDS),
    );
    expect(readScannerString(scanner, "releaseId")).toBe(
      MAIN_TOKEN_MIGRATION_RELEASE_ID,
    );
    expect(readScannerString(walletProof, "releaseId")).toBe(
      MAIN_TOKEN_MIGRATION_RELEASE_ID,
    );
  });

  it("binds the exact token, fixed receiver, sender, chain and raw token units", () => {
    const amountRaw = parseMainTokenMigrationAmount("12345.670000000000000001");
    const prepared = buildMainTokenMigrationTransaction({
      from: sender,
      amountRaw,
    });

    expect(prepared).toMatchObject({
      kind: "main-token-migration",
      chainId: 1,
      from: sender,
      to: MAIN_TOKEN_ADDRESS,
      value: "0",
    });
    expect(
      decodeFunctionData({ abi: transferAbi, data: prepared.data }),
    ).toEqual({
      functionName: "transfer",
      args: [MAIN_TOKEN_MIGRATION_WALLET, amountRaw],
    });
    expect(buildEip1193TransactionRequest(prepared, sender)).toEqual({
      from: sender,
      to: MAIN_TOKEN_ADDRESS,
      data: prepared.data,
      value: "0x0",
    });
  });

  it("rejects sender, chain, token, value and calldata changes", () => {
    const prepared = buildMainTokenMigrationTransaction({
      from: sender,
      amountRaw: 100n,
    });

    expect(() => assertMainTokenMigrationTransaction(prepared, other)).toThrow(
      "connected wallet",
    );
    expect(() =>
      assertMainTokenMigrationTransaction(
        { ...prepared, chainId: 11_155_111 },
        sender,
      ),
    ).toThrow("Ethereum Mainnet");
    expect(() =>
      assertMainTokenMigrationTransaction(
        { ...prepared, to: other },
        sender,
      ),
    ).toThrow("binding");
    expect(() =>
      assertMainTokenMigrationTransaction(
        { ...prepared, value: "1" },
        sender,
      ),
    ).toThrow("binding");

    const redirected = buildMainTokenMigrationTransaction({
      from: sender,
      amountRaw: 100n,
    });
    const redirectedData = redirected.data.replace(
      MAIN_TOKEN_MIGRATION_WALLET.slice(2).toLowerCase(),
      other.slice(2).toLowerCase(),
    ) as `0x${string}`;
    expect(() =>
      assertMainTokenMigrationTransaction(
        { ...redirected, data: redirectedData },
        sender,
      ),
    ).toThrow("recipient or amount");
  });

  it("accepts positive decimal units only and never more than the refreshed balance", () => {
    expect(parseMainTokenMigrationAmount("1")).toBe(10n ** 18n);
    expect(parseMainTokenMigrationAmount("0.000000000000000001")).toBe(1n);
    for (const value of ["", "0", "1.", ".1", "01", "1e2", "1,000", "-1"]) {
      expect(() => parseMainTokenMigrationAmount(value)).toThrow();
    }
    expect(assertMainTokenMigrationBalance(100n, 100n)).toBe(100n);
    expect(() => assertMainTokenMigrationBalance(101n, 100n)).toThrow(
      "exceeds",
    );
  });

  it("uses explicit wallet review copy for the irreversible transfer", () => {
    expect(getPreparedTransactionReview("main-token-migration")).toEqual({
      description: "Send V4 to the fixed migration wallet on Ethereum",
      buttonText: "Send V4",
      successHeader: "Migration transfer submitted",
    });
  });
});

describe("main token migration page contract", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const page = read("components/main-token-migration.tsx");

  it("derives the countdown from one absolute window across reloads", () => {
    const startAt = Date.parse("2026-08-30T12:00:00.000Z");
    const deadlineAt = startAt + migrationWindowSeconds * 1_000;
    const remainingAt = (now: number) =>
      Math.max(0, Math.ceil((deadlineAt - now) / 1_000));

    expect(remainingAt(startAt)).toBe(migrationWindowSeconds);
    expect(remainingAt(startAt + 12 * 60 * 60 * 1_000)).toBe(84 * 60 * 60);
    expect(remainingAt(startAt + 85 * 60 * 60 * 1_000)).toBe(11 * 60 * 60);
    expect(page).toContain("setNow(Date.now())");
    expect(page).toContain("phase === \"upcoming\"");
    expect(page).toContain("migrationWindow.startAt");
    expect(page).toContain("migrationWindow.deadlineAt");
    expect(page).not.toMatch(
      /Date\.now\(\)\s*\+\s*MAIN_TOKEN_MIGRATION_WINDOW_SECONDS/u,
    );
    expect(page).toContain("const hours = Math.floor(totalSeconds / 3_600)");
    expect(page).toContain('<small>Hours</small>');
    expect(page).toContain('<small>Minutes</small>');
    expect(page).toContain('<small>Seconds</small>');
    expect(page).not.toContain("<small>Days</small>");
  });

  it("stays active through the final millisecond and closes at the deadline", () => {
    const startAt = Date.parse("2026-08-30T12:00:00.000Z");
    const deadlineAt = startAt + migrationWindowSeconds * 1_000;
    const phaseAt = (now: number) => {
      if (now < startAt) return "upcoming";
      if (now >= deadlineAt) return "closed";
      return "active";
    };

    expect(phaseAt(deadlineAt - 1)).toBe("active");
    expect(phaseAt(deadlineAt)).toBe("closed");
    expect(phaseAt(deadlineAt + 1)).toBe("closed");
    expect(page).toContain(
      'if (now < migrationWindow.startAt) return "upcoming";',
    );
    expect(page).toContain(
      'if (now >= migrationWindow.deadlineAt) return "closed";',
    );
    const firstFinalWindowCheck = page.indexOf(
      'if (phaseAt(Date.now()) !== "active")',
    );
    const finalWindowCheck = page.lastIndexOf(
      'if (phaseAt(Date.now()) !== "active")',
    );
    const finalTransactionBinding = page.indexOf(
      "const checked = assertMainTokenMigrationTransaction",
    );
    const walletPrompt = page.indexOf("const hash = await sendTransaction");
    expect(firstFinalWindowCheck).toBeGreaterThan(0);
    expect(finalWindowCheck).toBeGreaterThan(firstFinalWindowCheck);
    expect(finalWindowCheck).toBeGreaterThan(finalTransactionBinding);
    expect(walletPrompt).toBeGreaterThan(finalWindowCheck);
  });

  it("keeps keyboard focus in the sponsorship flow", () => {
    expect(page).toContain("focusSponsorshipActionOrStatus");
    expect(
      page.match(/focusSponsorshipActionOrStatus\(\);/gu)?.length ?? 0,
    ).toBeGreaterThanOrEqual(6);
    expect(page).toContain(
      "(sponsorButtonRef.current ?? sponsorshipRegionRef.current)?.focus()",
    );
  });

  it("activates only with the exact 96-hour window, start block and release", () => {
    const startAt = Date.parse("2026-08-30T12:00:00.000Z");
    const activation = (
      requested: boolean,
      deadlineAt: number,
      startBlock: bigint | null,
      startBlockHash: string | null,
      releaseId: string,
    ) =>
      requested &&
      deadlineAt - startAt === migrationWindowSeconds * 1_000 &&
      startBlock !== null &&
      /^0x[0-9a-f]{64}$/u.test(startBlockHash ?? "") &&
      releaseId === MAIN_TOKEN_MIGRATION_RELEASE_ID;
    const blockHash = `0x${"1".repeat(64)}`;

    expect(
      activation(
        true,
        startAt + migrationWindowSeconds * 1_000,
        1n,
        blockHash,
        MAIN_TOKEN_MIGRATION_RELEASE_ID,
      ),
    ).toBe(true);
    expect(
      activation(
        false,
        startAt + migrationWindowSeconds * 1_000,
        1n,
        blockHash,
        MAIN_TOKEN_MIGRATION_RELEASE_ID,
      ),
    ).toBe(false);
    expect(
      activation(
        true,
        startAt + migrationWindowSeconds * 1_000,
        null,
        blockHash,
        MAIN_TOKEN_MIGRATION_RELEASE_ID,
      ),
    ).toBe(false);
    expect(
      activation(
        true,
        startAt + migrationWindowSeconds * 1_000 - 1,
        1n,
        blockHash,
        MAIN_TOKEN_MIGRATION_RELEASE_ID,
      ),
    ).toBe(false);
    expect(
      activation(
        true,
        startAt + migrationWindowSeconds * 1_000 + 1,
        1n,
        blockHash,
        MAIN_TOKEN_MIGRATION_RELEASE_ID,
      ),
    ).toBe(false);
    expect(
      activation(
        true,
        startAt + migrationWindowSeconds * 1_000,
        1n,
        blockHash,
        "wrong-release",
      ),
    ).toBe(false);
    expect(
      activation(
        true,
        startAt + migrationWindowSeconds * 1_000,
        1n,
        null,
        MAIN_TOKEN_MIGRATION_RELEASE_ID,
      ),
    ).toBe(false);
    expect(page).toContain("manifest.enabled === true &&");
    expect(page).toContain("exactPolicy &&");
    expect(page).toContain("exactWindow &&");
    expect(page).toContain("startBlock !== null &&");
    expect(page).toContain("startBlockHash !== null");
  });

  it("stays local-safe until an exact window and start block are configured", () => {
    const route = read("app/migration/page.tsx");
    const landing = read("components/landing-page.tsx");
    const activationManifest = JSON.parse(
      read("config/main-token-migration-activation.v1.json"),
    ) as {
      enabled: boolean;
      releaseId: string;
      windowDurationSeconds: string;
      windowStartTimestamp: string | null;
      deadlineTimestampExclusive: string | null;
      startBlockNumber: string | null;
      startBlockHash: string | null;
    };

    expect(page).toContain("main-token-migration-activation.v1.json");
    expect(page).toContain("deadlineAt - startAt ===");
    expect(page).toContain("startBlock !== null");
    expect(page).toContain("Local preview · transfers disabled");
    expect(page).toContain("96-hour");
    expect(page).toContain("<strong>96 hours</strong>");
    expect(page).toContain(
      "Nothing is sent until you approve it in your wallet.",
    );
    expect(page).toContain("1:1 V4 amount");
    expect(page).toContain("Do not send from an exchange, custodian or router");
    expect(route).toContain("index: false");
    expect(route).toContain("follow: false");
    expect(route).toContain(
      "PROGRAMMABLE_MAIN_TOKEN_MIGRATION_PAGE_ENABLED",
    );
    expect(route).toContain(
      "PROGRAMMABLE_MAIN_TOKEN_MIGRATION_LOCAL_PREVIEW",
    );
    expect(route).toContain("migrationActivationManifest.enabled");
    expect(route).toContain("notFound()");
    expect(landing).toContain('href="/migration"');
    expect(landing).toContain("We are migrating");
    expect(landing).toContain(
      "NEXT_PUBLIC_PROGRAMMABLE_MAIN_TOKEN_MIGRATION_PAGE_VISIBLE",
    );
    expect(landing).toContain("migrationActivationManifest.enabled");
    expect(activationManifest).toMatchObject({
      enabled: false,
      releaseId: MAIN_TOKEN_MIGRATION_RELEASE_ID,
      windowDurationSeconds: String(MAIN_TOKEN_MIGRATION_WINDOW_SECONDS),
      windowStartTimestamp: null,
      deadlineTimestampExclusive: null,
      startBlockNumber: null,
      startBlockHash: null,
    });
  });
});
