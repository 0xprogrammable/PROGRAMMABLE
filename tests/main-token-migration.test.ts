import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";

import {
  assertMainTokenMigrationBalance,
  assertMainTokenMigrationTransaction,
  buildMainTokenMigrationTransaction,
  MAIN_TOKEN_ADDRESS,
  MAIN_TOKEN_MIGRATION_WALLET,
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

describe("main token migration transfer", () => {
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

  it("stays local-safe until an exact window and start block are configured", () => {
    const page = read("components/main-token-migration.tsx");
    const route = read("app/migration/page.tsx");
    const landing = read("components/landing-page.tsx");

    expect(page).toContain("NEXT_PUBLIC_PROGRAMMABLE_MAIN_TOKEN_MIGRATION_ENABLED");
    expect(page).toContain("deadlineAt - startAt ===");
    expect(page).toContain("startBlock !== null");
    expect(page).toContain("Local preview · transfers disabled");
    expect(page).toContain("Nothing is sent until you review and approve");
    expect(page).toContain("1:1 by token units");
    expect(page).toContain("Do not send from an exchange or custodial service");
    expect(route).toContain("index: false");
    expect(route).toContain("follow: false");
    expect(landing).toContain('href="/migration"');
    expect(landing).toContain("We are migrating");
  });
});
