import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";

import {
  migrationTransferStorageKey,
  restoreMigrationTransfer,
  storedMigrationTransfer,
} from "../components/main-token-migration";
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
  isMainTokenMigrationWalletCodeEligible,
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
const migrationWindowSeconds = 72 * 60 * 60;

describe("main token migration transfer", () => {
  it("accepts viem-empty or exact EIP-7702 delegated EOA code only", () => {
    expect(isMainTokenMigrationWalletCodeEligible(undefined)).toBe(true);
    expect(isMainTokenMigrationWalletCodeEligible("0x")).toBe(true);
    expect(isMainTokenMigrationWalletCodeEligible(
      "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b",
    )).toBe(true);

    for (const code of [
      "0x60006000",
      "0xef0100",
      "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b00",
      "0xef020063c0c19a282a1b52b07dd5a65b58948a07dae32b",
    ] as const) {
      expect(isMainTokenMigrationWalletCodeEligible(code)).toBe(false);
    }
  });

  it("freezes the 72-hour Ethereum migration identities", () => {
    expect(MAIN_TOKEN_MIGRATION_CHAIN_ID).toBe(1);
    expect(MAIN_TOKEN_ADDRESS).toBe(
      "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
    );
    expect(MAIN_TOKEN_MIGRATION_WALLET).toBe(migrationWallet);
    expect(MAIN_TOKEN_DECIMALS).toBe(18);
    expect(MAIN_TOKEN_MIGRATION_WINDOW_SECONDS).toBe(migrationWindowSeconds);

    expect(MAIN_TOKEN_MIGRATION_RELEASE_ID).toBe(
      "v4-ethereum-to-robinhood-72h-2026-v2",
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
      assertMainTokenMigrationTransaction({ ...prepared, to: other }, sender),
    ).toThrow("binding");
    expect(() =>
      assertMainTokenMigrationTransaction({ ...prepared, value: "1" }, sender),
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

  it("revalidates the exact migration transfer at the wallet provider boundary", () => {
    const walletProvider = readFileSync(
      join(process.cwd(), "components/wallet-provider.tsx"),
      "utf8",
    );
    const parsed = walletProvider.indexOf(
      "const prepared = parsePreparedTransactionForAccount",
    );
    const exactMigrationCheck = walletProvider.indexOf(
      "assertMainTokenMigrationTransaction(prepared, wallet.account)",
    );
    const walletSend = walletProvider.indexOf('method: "eth_sendTransaction"');

    expect(parsed).toBeGreaterThan(0);
    expect(exactMigrationCheck).toBeGreaterThan(parsed);
    expect(walletSend).toBeGreaterThan(exactMigrationCheck);
  });
});

describe("main token migration page contract", () => {
  const read = (path: string) =>
    readFileSync(join(process.cwd(), path), "utf8");
  const page = read("components/main-token-migration.tsx");

  it("scopes persisted transfer receipts to the connected wallet", () => {
    const hash = `0x${"ab".repeat(32)}`;
    const receipt = JSON.stringify({
      schema: "programmable-main-token-migration-ui/v1",
      status: "confirmed",
      chainId: MAIN_TOKEN_MIGRATION_CHAIN_ID,
      tokenAddress: MAIN_TOKEN_ADDRESS,
      migrationWallet: MAIN_TOKEN_MIGRATION_WALLET,
      account: sender,
      amount: "1",
      hash,
      blockNumber: "25874337",
    });

    expect(migrationTransferStorageKey(sender)).not.toBe(
      migrationTransferStorageKey(other),
    );
    expect(storedMigrationTransfer(receipt, sender)).toMatchObject({
      kind: "submitted",
      account: sender,
      amount: "1",
      hash,
    });
    expect(storedMigrationTransfer(receipt, other)).toBeNull();
    expect(page).toContain("submissionMatchesConnectedAccount");
    expect(page).toContain('key={wallet?.account.toLowerCase() ?? "disconnected"}');
    expect(page).toContain("legacyMigrationTransferStorageKey");
    expect(page).toContain("window.dispatchEvent(new Event(migrationRecoveryEvent))");
    expect(page).toContain(
      "window.addEventListener(migrationRecoveryEvent, restore)",
    );
    expect(page).toContain(
      "current.hash.toLowerCase() === restored.hash.toLowerCase()",
    );
  });

  it("keeps another wallet's legacy receipt and migrates it only for its owner", () => {
    const legacyKey =
      `programmable:main-token-migration:${MAIN_TOKEN_MIGRATION_WALLET.toLowerCase()}`;
    const receipt = JSON.stringify({
      schema: "programmable-main-token-migration-ui/v1",
      status: "submitted",
      chainId: MAIN_TOKEN_MIGRATION_CHAIN_ID,
      tokenAddress: MAIN_TOKEN_ADDRESS,
      migrationWallet: MAIN_TOKEN_MIGRATION_WALLET,
      account: sender,
      amount: "2",
      hash: `0x${"cd".repeat(32)}`,
      blockNumber: null,
    });
    const records = new Map([[legacyKey, receipt]]);
    const storage = {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => { records.set(key, value); },
      removeItem: (key: string) => { records.delete(key); },
    };

    expect(restoreMigrationTransfer(storage, other)).toBeNull();
    expect(records.get(legacyKey)).toBe(receipt);
    expect(records.has(migrationTransferStorageKey(other))).toBe(false);
    expect(restoreMigrationTransfer(storage, sender)).toMatchObject({
      kind: "submitted", account: sender, amount: "2",
    });
    expect(records.get(migrationTransferStorageKey(sender))).toBe(receipt);
    expect(records.has(legacyKey)).toBe(false);
    expect(restoreMigrationTransfer(storage, other)).toBeNull();
    expect(restoreMigrationTransfer(storage, sender)?.amount).toBe("2");

    records.clear();
    records.set(legacyKey, receipt);
    expect(restoreMigrationTransfer({
      ...storage,
      setItem: () => { throw new Error("Storage quota exceeded"); },
    }, sender)?.amount).toBe("2");
    expect(records.get(legacyKey)).toBe(receipt);
  });

  it("derives the countdown from one absolute window across reloads", () => {
    const startAt = Date.parse("2026-08-30T12:00:00.000Z");
    const deadlineAt = startAt + migrationWindowSeconds * 1_000;
    const remainingAt = (now: number) =>
      Math.max(0, Math.ceil((deadlineAt - now) / 1_000));

    expect(remainingAt(startAt)).toBe(migrationWindowSeconds);
    expect(remainingAt(startAt + 12 * 60 * 60 * 1_000)).toBe(60 * 60 * 60);
    expect(remainingAt(startAt + 61 * 60 * 60 * 1_000)).toBe(11 * 60 * 60);
    expect(page).toContain("trustedClockEndpoint");
    expect(page).toContain("performance.now()");
    expect(page).toContain("setNow(readTrustedNow())");
    expect(page).toContain('phase === "upcoming"');
    expect(page).toContain("migrationWindow.startAt");
    expect(page).toContain("migrationWindow.deadlineAt");
    expect(page).not.toMatch(
      /Date\.now\(\)\s*\+\s*MAIN_TOKEN_MIGRATION_WINDOW_SECONDS/u,
    );
    expect(page).toContain("const hours = Math.floor(totalSeconds / 3_600)");
    expect(page).toContain("<small>Hours</small>");
    expect(page).toContain("<small>Minutes</small>");
    expect(page).toContain("<small>Seconds</small>");
    expect(page).not.toContain("<small>Days</small>");
  });

  it("keeps the published phase active through the deadline while closing new transfers five minutes early", () => {
    const startAt = Date.parse("2026-08-30T12:00:00.000Z");
    const deadlineAt = startAt + migrationWindowSeconds * 1_000;
    const transferSafetyMs = 5 * 60 * 1_000;
    const phaseAt = (now: number) => {
      if (now < startAt) return "upcoming";
      if (now >= deadlineAt) return "closed";
      return "active";
    };
    const transferWindowOpenAt = (
      now: number,
      uncertaintyMs = 0,
      enabled = true,
    ) =>
      enabled &&
      now - uncertaintyMs >= startAt &&
      now + uncertaintyMs < deadlineAt - transferSafetyMs;

    expect(phaseAt(deadlineAt - 1)).toBe("active");
    expect(phaseAt(deadlineAt)).toBe("closed");
    expect(phaseAt(deadlineAt + 1)).toBe("closed");
    expect(page).toContain(
      'if (now < migrationWindow.startAt) return "upcoming";',
    );
    expect(page).toContain(
      'if (now >= migrationWindow.deadlineAt) return "closed";',
    );
    expect(transferWindowOpenAt(deadlineAt - transferSafetyMs - 1)).toBe(true);
    expect(transferWindowOpenAt(deadlineAt - transferSafetyMs)).toBe(false);
    expect(transferWindowOpenAt(startAt + 249, 250)).toBe(false);
    expect(transferWindowOpenAt(startAt + 250, 250)).toBe(true);
    expect(transferWindowOpenAt(startAt + 250, 250, false)).toBe(false);
    expect(page).toContain("const migrationTransferSafetyMs = 5 * 60 * 1_000;");
    expect(page).toContain("!migrationWindow.enabled ||");
    expect(page).toContain(
      "transferWindowOpenAt(trustedNow, clock.uncertaintyMs)",
    );
    const firstFinalWindowCheck = page.indexOf(
      "const finalCheckTime = readTrustedNow()",
    );
    const finalWindowCheck = page.indexOf(
      "const walletReviewTime = readTrustedNow()",
    );
    const finalTransactionBinding = page.indexOf(
      "const checked = assertMainTokenMigrationTransaction",
    );
    const walletPrompt = page.indexOf("const hash = await sendTransaction");
    expect(firstFinalWindowCheck).toBeGreaterThan(0);
    expect(finalWindowCheck).toBeGreaterThan(firstFinalWindowCheck);
    expect(
      page.slice(firstFinalWindowCheck, finalTransactionBinding),
    ).toContain("!trustedTransferWindowOpen()");
    expect(page.slice(finalWindowCheck, walletPrompt)).toContain(
      "!trustedTransferWindowOpen()",
    );
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

  it("reveals the fixed destination only during the active window or for a tracked transfer", () => {
    expect(page).toContain("transferWindowOpenAt(now, clockUncertaintyMs)");
    expect(page).toContain(
      "const canRevealDestination = transferWindowOpen || hasTrackedTransfer;",
    );
    expect(page).toContain("const canCopyDestination = transferWindowOpen;");
    expect(page).toContain(": canRevealDestination ? (");
    expect(page).toContain("Copy address");
    expect(page).toContain("disabled={!canCopyDestination}");
    expect(page).toContain(
      "The migration address is available only while the window is",
    );
  });

  it("activates only with the exact 72-hour window, start block and release", () => {
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

  it("publishes a fail-closed 72-hour page with an exact activation manifest", () => {
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
    expect(page).toContain("No action required right now");
    expect(page).toContain("const phase = !migrationWindow.enabled");
    expect(page).toContain(
      "Nothing is sent until you approve the V4 transfer in your wallet.",
    );
    expect(page).toContain("Connect wallet and send V4");
    expect(page).toContain("Prefer not to connect?");
    expect(page).toContain("Do not send ETH or use an exchange or router.");
    expect(page).not.toContain("Smart-contract wallet detected");
    expect(page).not.toContain("How it works");
    expect(read("components/main-token-migration.module.css")).not.toContain(
      "min-height: calc(100svh - 88px)",
    );
    expect(route).toContain("index: false");
    expect(route).toContain("follow: false");
    expect(route).toContain("PROGRAMMABLE_MAIN_TOKEN_MIGRATION_PAGE_ENABLED");
    expect(route).toContain("PROGRAMMABLE_MAIN_TOKEN_MIGRATION_LOCAL_PREVIEW");
    expect(route).toContain("notFound()");
    expect(landing).toContain('href="/migration"');
    expect(landing).toContain("V4 is moving to Robinhood");
    expect(landing).toContain(
      "NEXT_PUBLIC_PROGRAMMABLE_MAIN_TOKEN_MIGRATION_PAGE_VISIBLE",
    );
    expect(landing).toContain("migrationWindowActive");
    expect(read("app/api/main-token-migration/window-time/route.ts")).toContain(
      "programmable-main-token-migration-window-time/v1",
    );
    expect(activationManifest).toMatchObject({
      enabled: true,
      releaseId: MAIN_TOKEN_MIGRATION_RELEASE_ID,
      windowDurationSeconds: String(MAIN_TOKEN_MIGRATION_WINDOW_SECONDS),
    });
    expect(activationManifest.windowStartTimestamp).toMatch(/^[1-9][0-9]*$/u);
    expect(activationManifest.deadlineTimestampExclusive).toMatch(
      /^[1-9][0-9]*$/u,
    );
    expect(
      Number(activationManifest.deadlineTimestampExclusive) -
        Number(activationManifest.windowStartTimestamp),
    ).toBe(MAIN_TOKEN_MIGRATION_WINDOW_SECONDS);
    expect(activationManifest.startBlockNumber).toMatch(/^[1-9][0-9]*$/u);
    expect(activationManifest.startBlockHash).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(page).toContain("return false");
    expect(page).toContain("const canCopyDestination = transferWindowOpen;");
  });
});
