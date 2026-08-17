import { describe, expect, it } from "vitest";

import {
  findClassicV3IndexedLaunch,
  findDeepV3IndexedLaunch,
  findIndexedLaunch,
  LAUNCH_SUCCESS_CELEBRATION_MAX_AGE_MS,
  LAUNCH_INDEX_POLL_ATTEMPTS,
  launchDraftForSuccessDisplay,
  launchDraftIsLocked,
  launchIsConfirmedButUnindexed,
  launchIndexPollDelayMs,
  launchPollDelayMs,
  launchSuccessSummary,
  launchSubmissionUsesCurrentDraft,
  parsePendingLaunchSubmission,
  pendingSubmissionCanBeDiscarded,
  pendingSubmissionForConnectedAccount,
  pendingSubmissionIsStale,
  pendingLaunchPointerKey,
  pendingLaunchReleasedKey,
  pendingLaunchStorageKey,
  pendingLaunchSubmissionsMatch,
  PENDING_LAUNCH_STALE_AFTER_MS,
  pollIndexedLaunch,
  pollLaunchReceipt,
  readPendingLaunchSubmission,
  releaseConfirmedLaunchSubmission,
  removePendingLaunchSubmission,
  submissionPhaseForPendingLaunch,
  shouldCelebrateIndexedLaunch,
  shouldRestoreConfirmedLaunchSuccess,
  updatePendingLaunchSubmission,
  writePendingLaunchSubmission,
  type PendingLaunchStorage,
  type PendingLaunchSubmission,
} from "../components/launch-builder";
import { createClassicV3Draft } from "../lib/launch";

const transactionHash: `0x${string}` = `0x${"12".repeat(32)}`;
const tokenAddress = "0x1111111111111111111111111111111111111111";
const account = "0x2222222222222222222222222222222222222222";

function createMemoryStorage(): PendingLaunchStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("launch success indexing", () => {
  it("shows a confirmed launch before indexing completes", () => {
    const submission: PendingLaunchSubmission = {
      version: 2,
      transactionHash,
      account,
      chainId: 1,
      model: "classic-v3",
      submittedAtMs: 1_000_000,
      receiptConfirmedAtMs: 1_001_000,
      tokenAddress: tokenAddress as `0x${string}`,
      tokenName: "Programmable Test",
      tokenSymbol: "PGT",
      estimatedInitialBuyTokenAmount: 12_345_678,
    };

    expect(launchSuccessSummary(submission, null)).toEqual({
      address: tokenAddress,
      href: `https://etherscan.io/address/${tokenAddress}`,
      name: "Programmable Test",
      symbol: "PGT",
      chainId: 1,
      indexed: false,
      transactionHash,
      estimatedInitialBuyTokenAmount: 12_345_678,
    });
    expect(
      launchSuccessSummary(
        { ...submission, receiptConfirmedAtMs: undefined },
        null,
      ),
    ).toBeNull();
  });

  it("upgrades the confirmed success link only for the same indexed token", () => {
    const submission: PendingLaunchSubmission = {
      version: 2,
      transactionHash,
      account,
      chainId: 1,
      model: "classic-v3",
      submittedAtMs: 1_000_000,
      receiptConfirmedAtMs: 1_001_000,
      tokenAddress: tokenAddress as `0x${string}`,
      tokenName: "Pending name",
      tokenSymbol: "PND",
    };

    expect(
      launchSuccessSummary(submission, {
        address: tokenAddress as `0x${string}`,
        href: `/explore/token/${tokenAddress}`,
        name: "Indexed name",
        symbol: "IDX",
      }),
    ).toMatchObject({
      href: `/explore/token/${tokenAddress}`,
      name: "Indexed name",
      symbol: "IDX",
      indexed: true,
    });
    expect(
      launchSuccessSummary(submission, {
        address: "0x3333333333333333333333333333333333333333",
        href: "/wrong-token",
        name: "Wrong token",
        symbol: "BAD",
      }),
    ).toBeNull();
  });

  it("locks launch controls until restore completes and after submission", () => {
    expect(launchDraftIsLocked(false, "idle", "")).toBe(true);
    expect(launchDraftIsLocked(true, "preparing", "")).toBe(true);
    expect(launchDraftIsLocked(true, "confirming", "")).toBe(true);
    expect(launchDraftIsLocked(true, "idle", transactionHash)).toBe(true);
    expect(launchDraftIsLocked(true, "idle", "")).toBe(false);
  });

  it("hides draft-only fee details when success is restored after reload", () => {
    const draft = createClassicV3Draft();
    expect(launchDraftForSuccessDisplay(draft, true)).toBe(draft);
    expect(launchDraftForSuccessDisplay(draft, false)).toBeUndefined();
    expect(
      launchSubmissionUsesCurrentDraft(
        transactionHash,
        transactionHash,
        2,
        2,
      ),
    ).toBe(true);
    expect(
      launchSubmissionUsesCurrentDraft(
        transactionHash,
        `0x${"34".repeat(32)}`,
        2,
        2,
      ),
    ).toBe(false);
    expect(
      launchSubmissionUsesCurrentDraft(transactionHash, "", 2, 2),
    ).toBe(false);
    expect(
      launchSubmissionUsesCurrentDraft(
        transactionHash,
        transactionHash,
        3,
        2,
      ),
    ).toBe(false);
  });

  it("celebrates only a fresh launch submitted from the current draft", () => {
    const submittedAtMs = 1_000_000;
    const submission: PendingLaunchSubmission = {
      version: 2,
      transactionHash,
      account,
      chainId: 1,
      model: "classic-v3",
      submittedAtMs,
      receiptConfirmedAtMs: submittedAtMs + 1_000,
    };
    const currentDraft = {
      submission,
      currentDraftSubmissionHash: transactionHash,
      currentDraftVersion: 3,
      submittedDraftVersion: 3,
    };

    expect(
      shouldCelebrateIndexedLaunch({
        ...currentDraft,
        nowMs: submittedAtMs + LAUNCH_SUCCESS_CELEBRATION_MAX_AGE_MS - 1,
      }),
    ).toBe(true);
    expect(
      shouldCelebrateIndexedLaunch({
        ...currentDraft,
        nowMs: submittedAtMs + LAUNCH_SUCCESS_CELEBRATION_MAX_AGE_MS,
      }),
    ).toBe(false);
    expect(
      shouldCelebrateIndexedLaunch({
        ...currentDraft,
        currentDraftSubmissionHash: "",
        nowMs: submittedAtMs + 10_000,
      }),
    ).toBe(false);
    expect(
      shouldCelebrateIndexedLaunch({
        ...currentDraft,
        submittedDraftVersion: 2,
        nowMs: submittedAtMs + 10_000,
      }),
    ).toBe(false);
  });

  it("restores a confirmed unresolved launch success within the stale window", () => {
    const submittedAtMs = 1_000_000;
    const submission: PendingLaunchSubmission = {
      version: 2,
      transactionHash,
      account,
      chainId: 1,
      model: "classic-v3",
      submittedAtMs,
      receiptConfirmedAtMs: submittedAtMs + 1_000,
    };

    expect(
      shouldRestoreConfirmedLaunchSuccess(
        submission,
        submittedAtMs + PENDING_LAUNCH_STALE_AFTER_MS - 1,
      ),
    ).toBe(true);
    expect(
      shouldRestoreConfirmedLaunchSuccess(
        submission,
        submittedAtMs + PENDING_LAUNCH_STALE_AFTER_MS,
      ),
    ).toBe(false);
    expect(
      shouldRestoreConfirmedLaunchSuccess({
        ...submission,
        receiptConfirmedAtMs: undefined,
      }),
    ).toBe(false);
  });

  it("waits for the submitted receipt before accepting launch indexing", async () => {
    const statuses: Array<"pending" | "confirmed"> = [
      "pending",
      "pending",
      "confirmed",
    ];
    const delays: number[] = [];

    await expect(
      pollLaunchReceipt({
        readStatus: async () => statuses.shift() ?? "pending",
        wait: async (delay) => {
          delays.push(delay);
        },
      }),
    ).resolves.toBe("confirmed");
    expect(delays).toEqual([1_000, 1_000]);
  });

  it("treats a reverted receipt as terminal and keeps polling bounded", async () => {
    await expect(
      pollLaunchReceipt({
        readStatus: async () => "reverted",
        wait: async () => undefined,
      }),
    ).resolves.toBe("reverted");

    let reads = 0;
    let waits = 0;
    await expect(
      pollLaunchReceipt({
        readStatus: async () => {
          reads += 1;
          return "pending";
        },
        wait: async () => {
          waits += 1;
        },
        maxAttempts: 4,
      }),
    ).resolves.toBe("pending-timeout");
    expect(reads).toBe(4);
    expect(waits).toBe(3);
    expect(launchPollDelayMs(0)).toBe(1_000);
    expect(launchPollDelayMs(3)).toBe(2_000);
    expect(launchPollDelayMs(30)).toBe(5_000);
  });

  it("stops immediately on an absent stale transaction when requested", async () => {
    let reads = 0;
    let waits = 0;
    await expect(
      pollLaunchReceipt({
        readStatus: async () => {
          reads += 1;
          return "not-found";
        },
        wait: async () => {
          waits += 1;
        },
        stopOnNotFound: true,
      }),
    ).resolves.toBe("not-found");
    expect(reads).toBe(1);
    expect(waits).toBe(0);

    await expect(
      pollLaunchReceipt({
        readStatus: async () => "not-found",
        wait: async () => undefined,
        maxAttempts: 2,
      }),
    ).resolves.toBe("pending-timeout");
  });

  it("bounds index retries after a confirmed transaction", async () => {
    let reads = 0;
    const delays: number[] = [];
    const indexed = await pollIndexedLaunch({
      readLaunch: async () => {
        reads += 1;
        return reads === 3 ? { address: tokenAddress } : null;
      },
      wait: async (delay) => {
        delays.push(delay);
      },
      maxAttempts: 4,
    });
    expect(indexed).toEqual({
      status: "indexed",
      launch: { address: tokenAddress },
    });
    expect(reads).toBe(3);
    expect(delays).toEqual([4_000, 5_000]);

    reads = 0;
    await expect(
      pollIndexedLaunch({
        readLaunch: async () => {
          reads += 1;
          return null;
        },
        wait: async () => undefined,
        maxAttempts: 2,
      }),
    ).resolves.toEqual({ status: "timeout" });
    expect(reads).toBe(2);
  });

  it("reports repeated receipt and index failures as unavailable", async () => {
    await expect(
      pollLaunchReceipt({
        readStatus: async () => {
          throw new Error("RPC unavailable");
        },
        wait: async () => undefined,
        maxAttempts: 6,
        maxConsecutiveErrors: 2,
      }),
    ).resolves.toBe("unavailable");

    await expect(
      pollIndexedLaunch({
        readLaunch: async () => {
          throw new Error("Indexer unavailable");
        },
        wait: async () => undefined,
        maxAttempts: 6,
        maxConsecutiveErrors: 2,
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("keeps genuine pending and empty index results distinct from failures", async () => {
    let receiptReads = 0;
    await expect(
      pollLaunchReceipt({
        readStatus: async () => {
          receiptReads += 1;
          if (receiptReads === 2) throw new Error("Transient RPC error");
          return "pending";
        },
        wait: async () => undefined,
        maxAttempts: 4,
      }),
    ).resolves.toBe("pending-timeout");

    let indexReads = 0;
    await expect(
      pollIndexedLaunch({
        readLaunch: async () => {
          indexReads += 1;
          if (indexReads === 2) throw new Error("Transient index error");
          return null;
        },
        wait: async () => undefined,
        maxAttempts: 4,
      }),
    ).resolves.toEqual({ status: "timeout" });
  });

  it("covers the twelve-block confirmation window without aggressive polling", () => {
    const delays = Array.from(
      { length: LAUNCH_INDEX_POLL_ATTEMPTS - 1 },
      (_, attempt) => launchIndexPollDelayMs(attempt),
    );
    expect(LAUNCH_INDEX_POLL_ATTEMPTS).toBeLessThanOrEqual(20);
    expect(
      delays.reduce((total, delay) => total + delay, 0),
    ).toBeGreaterThanOrEqual(160_000);
    expect(Math.max(...delays)).toBe(12_000);
  });

  it("persists pending launches by account and removes only the exact hash", () => {
    const storage = createMemoryStorage();
    const pending: PendingLaunchSubmission = {
      version: 2,
      transactionHash: transactionHash as `0x${string}`,
      account,
      chainId: 1,
      model: "classic-v3",
      submittedAtMs: 1_000_000,
    };
    const newer: PendingLaunchSubmission = {
      ...pending,
      transactionHash: `0x${"34".repeat(32)}`,
      submittedAtMs: pending.submittedAtMs + 1,
    };
    const foreignAccount =
      "0x3333333333333333333333333333333333333333";

    expect(writePendingLaunchSubmission(storage, pending)).toBe(true);
    expect(
      storage.getItem(
        pendingLaunchStorageKey(
          "classic-v3",
          1,
          account,
          transactionHash,
        ),
      ),
    ).toBe(JSON.stringify(pending));
    expect(
      storage.getItem(pendingLaunchPointerKey("classic-v3", 1, account)),
    ).toBe(transactionHash);
    expect(
      readPendingLaunchSubmission(storage, "classic-v3", 1, account),
    ).toEqual(pending);
    expect(
      readPendingLaunchSubmission(
        storage,
        "classic-v3",
        1,
        foreignAccount,
      ),
    ).toBeNull();
    expect(
      readPendingLaunchSubmission(storage, "classic-v3", 1, ""),
    ).toBeNull();
    expect(
      readPendingLaunchSubmission(storage, "deep", 1, account),
    ).toBeNull();
    expect(
      readPendingLaunchSubmission(
        storage,
        "classic-v3",
        11_155_111,
        account,
      ),
    ).toBeNull();

    expect(writePendingLaunchSubmission(storage, newer)).toBe(true);
    expect(removePendingLaunchSubmission(storage, pending)).toBe(true);
    expect(
      readPendingLaunchSubmission(storage, "classic-v3", 1, account),
    ).toEqual(
      newer,
    );
    expect(removePendingLaunchSubmission(storage, newer)).toBe(true);
    expect(
      readPendingLaunchSubmission(storage, "classic-v3", 1, account),
    ).toBeNull();
  });

  it("releases only a confirmed hash without deleting its recovery record", () => {
    const storage = createMemoryStorage();
    const pending: PendingLaunchSubmission = {
      version: 2,
      transactionHash: transactionHash as `0x${string}`,
      account,
      chainId: 1,
      model: "classic-v3",
      submittedAtMs: 1_000_000,
    };
    const confirmed: PendingLaunchSubmission = {
      ...pending,
      receiptConfirmedAtMs: pending.submittedAtMs + 1_000,
    };
    const newer: PendingLaunchSubmission = {
      ...pending,
      transactionHash: `0x${"34".repeat(32)}`,
      submittedAtMs: pending.submittedAtMs + 2_000,
    };

    expect(writePendingLaunchSubmission(storage, pending)).toBe(true);
    expect(releaseConfirmedLaunchSubmission(storage, pending)).toBe(false);
    expect(
      readPendingLaunchSubmission(storage, "classic-v3", 1, account),
    ).toEqual(pending);

    expect(writePendingLaunchSubmission(storage, confirmed)).toBe(true);
    expect(releaseConfirmedLaunchSubmission(storage, confirmed)).toBe(true);
    expect(
      storage.getItem(pendingLaunchReleasedKey(confirmed)),
    ).toBe("1");
    expect(
      storage.getItem(
        pendingLaunchStorageKey(
          confirmed.model,
          confirmed.chainId,
          confirmed.account,
          confirmed.transactionHash,
        ),
      ),
    ).toBe(JSON.stringify(confirmed));
    expect(
      readPendingLaunchSubmission(storage, "classic-v3", 1, account),
    ).toBeNull();

    expect(writePendingLaunchSubmission(storage, newer)).toBe(true);
    expect(
      readPendingLaunchSubmission(storage, "classic-v3", 1, account),
    ).toEqual(newer);
    expect(releaseConfirmedLaunchSubmission(storage, confirmed)).toBe(true);
    expect(
      readPendingLaunchSubmission(storage, "classic-v3", 1, account),
    ).toEqual(newer);
  });

  it("records an older confirmation without moving a newer active pointer", () => {
    const storage = createMemoryStorage();
    const older: PendingLaunchSubmission = {
      version: 2,
      transactionHash: transactionHash as `0x${string}`,
      account,
      chainId: 1,
      model: "classic-v3",
      submittedAtMs: 1_000_000,
    };
    const newer: PendingLaunchSubmission = {
      ...older,
      transactionHash: `0x${"34".repeat(32)}`,
      submittedAtMs: older.submittedAtMs + 2_000,
    };
    const confirmedOlder: PendingLaunchSubmission = {
      ...older,
      receiptConfirmedAtMs: older.submittedAtMs + 1_000,
    };

    expect(writePendingLaunchSubmission(storage, older)).toBe(true);
    expect(writePendingLaunchSubmission(storage, newer)).toBe(true);
    expect(updatePendingLaunchSubmission(storage, confirmedOlder)).toBe(true);
    expect(
      storage.getItem(pendingLaunchPointerKey("classic-v3", 1, account)),
    ).toBe(newer.transactionHash);
    expect(
      readPendingLaunchSubmission(storage, "classic-v3", 1, account),
    ).toEqual(newer);
    expect(
      storage.getItem(
        pendingLaunchStorageKey(
          confirmedOlder.model,
          confirmedOlder.chainId,
          confirmedOlder.account,
          confirmedOlder.transactionHash,
        ),
      ),
    ).toBe(JSON.stringify(confirmedOlder));
  });

  it("binds submission phases to the exact account and transaction hash", () => {
    const pending: PendingLaunchSubmission = {
      version: 2,
      transactionHash: transactionHash as `0x${string}`,
      account,
      chainId: 1,
      model: "classic-v3",
      submittedAtMs: 1_000_000,
    };
    const revertedPhase = {
      account: pending.account,
      transactionHash: pending.transactionHash,
      phase: "reverted" as const,
    };

    expect(
      submissionPhaseForPendingLaunch(revertedPhase, pending),
    ).toBe("reverted");
    expect(
      submissionPhaseForPendingLaunch(revertedPhase, {
        ...pending,
        transactionHash: `0x${"34".repeat(32)}`,
      }),
    ).toBe("idle");
    expect(
      submissionPhaseForPendingLaunch(revertedPhase, {
        ...pending,
        account: "0x3333333333333333333333333333333333333333",
      }),
    ).toBe("idle");
    expect(submissionPhaseForPendingLaunch(null, pending)).toBe("idle");
  });

  it("treats only a hash-and-account matched index record as indexed", () => {
    const confirmed: PendingLaunchSubmission = {
      version: 2,
      transactionHash: transactionHash as `0x${string}`,
      account,
      chainId: 1,
      model: "classic-v3",
      submittedAtMs: 1_000_000,
      receiptConfirmedAtMs: 1_001_000,
    };
    const otherHash: PendingLaunchSubmission = {
      ...confirmed,
      transactionHash: `0x${"34".repeat(32)}`,
    };
    const otherAccount: PendingLaunchSubmission = {
      ...confirmed,
      account: "0x3333333333333333333333333333333333333333",
    };

    expect(pendingLaunchSubmissionsMatch(confirmed, confirmed)).toBe(true);
    expect(pendingLaunchSubmissionsMatch(confirmed, otherHash)).toBe(false);
    expect(pendingLaunchSubmissionsMatch(confirmed, otherAccount)).toBe(false);
    expect(launchIsConfirmedButUnindexed(confirmed, confirmed)).toBe(false);
    expect(launchIsConfirmedButUnindexed(confirmed, otherHash)).toBe(true);
    expect(launchIsConfirmedButUnindexed(confirmed, otherAccount)).toBe(true);
    expect(launchIsConfirmedButUnindexed(confirmed, null)).toBe(true);
    expect(
      launchIsConfirmedButUnindexed(
        { ...confirmed, receiptConfirmedAtMs: undefined },
        null,
      ),
    ).toBe(false);
  });

  it("rejects malformed or mismatched pending launch records", () => {
    const valid = {
      version: 2,
      transactionHash,
      account,
      chainId: 1,
      model: "classic-v3",
      submittedAtMs: 1_000_000,
    };
    expect(
      parsePendingLaunchSubmission(
        JSON.stringify(valid),
        "classic-v3",
        1,
        account,
        valid.submittedAtMs,
      ),
    ).toEqual(valid);
    expect(
      parsePendingLaunchSubmission(
        JSON.stringify({ ...valid, transactionHash: "0x1234" }),
        "classic-v3",
        1,
        account,
        valid.submittedAtMs,
      ),
    ).toBeNull();
    expect(
      parsePendingLaunchSubmission(
        JSON.stringify({ ...valid, account: "not-an-address" }),
        "classic-v3",
        1,
        account,
        valid.submittedAtMs,
      ),
    ).toBeNull();
    expect(
      parsePendingLaunchSubmission(
        JSON.stringify(valid),
        "classic-v3",
        1,
        "0x3333333333333333333333333333333333333333",
        valid.submittedAtMs,
      ),
    ).toBeNull();
    expect(
      parsePendingLaunchSubmission(
        JSON.stringify({ ...valid, chainId: 11_155_111 }),
        "classic-v3",
        1,
        account,
        valid.submittedAtMs,
      ),
    ).toBeNull();
    expect(
      parsePendingLaunchSubmission(
        JSON.stringify({ ...valid, model: "deep" }),
        "classic-v3",
        1,
        account,
        valid.submittedAtMs,
      ),
    ).toBeNull();
    expect(
      parsePendingLaunchSubmission(
        "{bad json",
        "classic-v3",
        1,
        account,
        valid.submittedAtMs,
      ),
    ).toBeNull();
    expect(
      parsePendingLaunchSubmission(
        JSON.stringify({ ...valid, submittedAtMs: 0 }),
        "classic-v3",
        1,
        account,
        valid.submittedAtMs,
      ),
    ).toBeNull();
    expect(
      parsePendingLaunchSubmission(
        JSON.stringify({
          ...valid,
          submittedAtMs: valid.submittedAtMs + 10 * 60 * 1_000,
        }),
        "classic-v3",
        1,
        account,
        valid.submittedAtMs,
      ),
    ).toBeNull();
    expect(
      parsePendingLaunchSubmission(
        JSON.stringify({
          ...valid,
          receiptConfirmedAtMs: valid.submittedAtMs - 1,
        }),
        "classic-v3",
        1,
        account,
        valid.submittedAtMs,
      ),
    ).toBeNull();
    expect(
      parsePendingLaunchSubmission(
        JSON.stringify({
          ...valid,
          receiptConfirmedAtMs: valid.submittedAtMs + 1,
        }),
        "classic-v3",
        1,
        account,
        valid.submittedAtMs + 1,
      ),
    ).toEqual({
      ...valid,
      receiptConfirmedAtMs: valid.submittedAtMs + 1,
    });

    const launchSummary = {
      ...valid,
      tokenAddress,
      tokenName: "Programmable Test",
      tokenSymbol: "PGT",
      estimatedInitialBuyTokenAmount: 12_345_678,
    };
    expect(
      parsePendingLaunchSubmission(
        JSON.stringify(launchSummary),
        "classic-v3",
        1,
        account,
        valid.submittedAtMs,
      ),
    ).toEqual(launchSummary);
    expect(
      parsePendingLaunchSubmission(
        JSON.stringify({ ...launchSummary, tokenAddress: "0x1234" }),
        "classic-v3",
        1,
        account,
        valid.submittedAtMs,
      ),
    ).toBeNull();
    expect(
      parsePendingLaunchSubmission(
        JSON.stringify({
          ...launchSummary,
          estimatedInitialBuyTokenAmount: -1,
        }),
        "classic-v3",
        1,
        account,
        valid.submittedAtMs,
      ),
    ).toBeNull();
  });

  it("does not expire pending submissions until the stale threshold", () => {
    const pending: PendingLaunchSubmission = {
      version: 2,
      transactionHash: transactionHash as `0x${string}`,
      account,
      chainId: 1,
      model: "classic-v3",
      submittedAtMs: 10_000,
    };
    expect(
      pendingSubmissionIsStale(
        pending,
        pending.submittedAtMs + PENDING_LAUNCH_STALE_AFTER_MS - 1,
      ),
    ).toBe(false);
    expect(
      pendingSubmissionIsStale(
        pending,
        pending.submittedAtMs + PENDING_LAUNCH_STALE_AFTER_MS,
      ),
    ).toBe(true);
  });

  it("only lets the submitting wallet discard a stale hash confirmed absent", () => {
    const pending: PendingLaunchSubmission = {
      version: 2,
      transactionHash: transactionHash as `0x${string}`,
      account,
      chainId: 1,
      model: "classic-v3",
      submittedAtMs: 10_000,
    };
    const nowMs = pending.submittedAtMs + PENDING_LAUNCH_STALE_AFTER_MS;
    const base = {
      submission: pending,
      observedHash: pending.transactionHash,
      observedStatus: "not-found" as const,
      connectedAccount: account,
      nowMs,
    };

    expect(pendingSubmissionCanBeDiscarded(base)).toBe(true);
    expect(
      pendingSubmissionCanBeDiscarded({
        ...base,
        connectedAccount: "0x3333333333333333333333333333333333333333",
      }),
    ).toBe(false);
    expect(
      pendingSubmissionCanBeDiscarded({
        ...base,
        observedStatus: "pending",
      }),
    ).toBe(false);
    expect(
      pendingSubmissionCanBeDiscarded({
        ...base,
        observedHash: `0x${"34".repeat(32)}`,
      }),
    ).toBe(false);
    expect(
      pendingSubmissionCanBeDiscarded({
        ...base,
        nowMs: nowMs - 1,
      }),
    ).toBe(false);
  });

  it("restores a pending launch only for its connected submitting wallet", () => {
    const pending: PendingLaunchSubmission = {
      version: 2,
      transactionHash: transactionHash as `0x${string}`,
      account,
      chainId: 1,
      model: "classic-v3",
      submittedAtMs: 10_000,
    };
    expect(
      pendingSubmissionForConnectedAccount(
        pending,
        "classic-v3",
        1,
        account,
      ),
    ).toBe(pending);
    expect(
      pendingSubmissionForConnectedAccount(
        pending,
        "classic-v3",
        1,
        undefined,
      ),
    ).toBeNull();
    expect(
      pendingSubmissionForConnectedAccount(
        pending,
        "classic-v3",
        1,
        "0x3333333333333333333333333333333333333333",
      ),
    ).toBeNull();
  });

  it("finds the token created by the submitted transaction", () => {
    expect(
      findIndexedLaunch(
        {
          tokens: [
            {
              launchTransactionHash: transactionHash,
              tokenAddress,
              name: "Test",
              symbol: "TEST",
              href: `/token/${tokenAddress}`,
            },
          ],
        },
        transactionHash.toUpperCase(),
      ),
    ).toEqual({
      address: tokenAddress,
      href: `/token/${tokenAddress}`,
      name: "Test",
      symbol: "TEST",
    });
  });

  it("ignores unrelated and malformed token records", () => {
    expect(
      findIndexedLaunch(
        {
          tokens: [
            {
              launchTransactionHash: `0x${"34".repeat(32)}`,
              tokenAddress,
              name: "Other",
              symbol: "OTHER",
            },
            {
              launchTransactionHash: transactionHash,
              tokenAddress: "not-an-address",
              name: "Broken",
              symbol: "BAD",
            },
          ],
        },
        transactionHash,
      ),
    ).toBeNull();
  });

  it("finds a confirmed Classic V3 launch without the V2 indexer", () => {
    expect(
      findClassicV3IndexedLaunch({
        status: "ready",
        launch: {
          tokenAddress,
          name: "Directional",
          symbol: "DIR",
          launchTransactionHash: transactionHash,
        },
      }),
    ).toEqual({
      address: tokenAddress,
      href: `/token/${tokenAddress}`,
      name: "Directional",
      symbol: "DIR",
    });
    expect(
      findClassicV3IndexedLaunch({ status: "ready", launch: null }),
    ).toBeNull();

    expect(
      findClassicV3IndexedLaunch(
        {
          status: "ready",
          token: {
            tokenAddress,
            name: "Catalog token",
            symbol: "CAT",
            launchTransactionHash: transactionHash,
          },
        },
        transactionHash,
        tokenAddress,
      ),
    ).toEqual({
      address: tokenAddress,
      href: `/token/${tokenAddress}`,
      name: "Catalog token",
      symbol: "CAT",
    });
    expect(
      findClassicV3IndexedLaunch(
        {
          token: {
            tokenAddress,
            name: "Wrong transaction",
            symbol: "BAD",
            launchTransactionHash: `0x${"34".repeat(32)}`,
          },
        },
        transactionHash,
        tokenAddress,
      ),
    ).toBeNull();
  });

  it("accepts Deep success only from the confirmed V3 provenance response", () => {
    expect(
      findDeepV3IndexedLaunch(
        {
          status: "ready",
          launch: {
            tokenAddress,
            name: "Deep",
            symbol: "DEEP",
            deepReleaseVersion: "deep-full-range-v3",
            deepV3Provenance: {
              deepReleaseVersion: "deep-full-range-v3",
              launchModel: "deep",
              launcher: "0x2222222222222222222222222222222222222222",
              creator: "0x3333333333333333333333333333333333333333",
              tokenAddress,
              vaultAddress: "0x4444444444444444444444444444444444444444",
              hookAddress: "0x5555555555555555555555555555555555555555",
              positionRecipient: "0x6666666666666666666666666666666666666666",
              positionTokenId: "42",
              poolId: `0x${"66".repeat(32)}`,
              launchHash: `0x${"77".repeat(32)}`,
              vaultConfigurationHash: `0x${"88".repeat(32)}`,
              blockNumber: "123",
              blockHash: `0x${"99".repeat(32)}`,
              transactionHash,
              transactionIndex: 2,
              logIndex: 5,
            },
          },
        },
        transactionHash,
      ),
    ).toEqual({
      address: tokenAddress,
      href: `/token/${tokenAddress}`,
      name: "Deep",
      symbol: "DEEP",
    });

    expect(
      findDeepV3IndexedLaunch(
        {
          status: "ready",
          launch: {
            tokenAddress,
            name: "Deep",
            symbol: "DEEP",
            deepV3Provenance: {
              deepReleaseVersion: "deep-full-range-v3",
              launchModel: "deep",
              launcher: "0x2222222222222222222222222222222222222222",
              creator: "0x3333333333333333333333333333333333333333",
              tokenAddress,
              vaultAddress: "0x4444444444444444444444444444444444444444",
              hookAddress: "0x5555555555555555555555555555555555555555",
              positionRecipient: "0x6666666666666666666666666666666666666666",
              positionTokenId: "42",
              poolId: `0x${"66".repeat(32)}`,
              launchHash: `0x${"77".repeat(32)}`,
              vaultConfigurationHash: `0x${"88".repeat(32)}`,
              blockNumber: "123",
              blockHash: `0x${"99".repeat(32)}`,
              transactionHash,
              transactionIndex: 2,
              logIndex: 5,
            },
          },
        },
        transactionHash,
      ),
    ).toBeNull();

    expect(
      findDeepV3IndexedLaunch(
        {
          status: "ready",
          launch: {
            tokenAddress,
            name: "Deep",
            symbol: "DEEP",
            launchTransactionHash: transactionHash,
          },
        },
        transactionHash,
      ),
    ).toBeNull();
  });
});
