import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clients: [] as Array<{
    getTransactionReceipt: ReturnType<typeof vi.fn>;
    getTransaction: ReturnType<typeof vi.fn>;
  }>,
  deployment: {
    chainId: 1 as const,
    rpcUrl: "https://primary.example",
    rpcUrlSecondary: "https://secondary.example" as string | null,
  },
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => {
      const client = mocks.clients.shift();
      if (!client) {
        throw new Error("Missing mocked transaction client");
      }
      return client;
    }),
  };
});

vi.mock("@/lib/onchain/config", () => ({
  getOnchainDeployment: () => mocks.deployment,
}));

import { GET } from "../app/api/transaction-status/route";

const transactionHash = `0x${"12".repeat(32)}`;

function request(
  hash = transactionHash,
  chainId = 1,
) {
  return new NextRequest(
    `https://programmable.family/api/transaction-status?hash=${hash}&chainId=${chainId}`,
  );
}

function notFound(kind: "receipt" | "transaction") {
  const error = new Error(
    `${kind === "receipt" ? "Transaction receipt" : "Transaction"} could not be found`,
  );
  error.name =
    kind === "receipt"
      ? "TransactionReceiptNotFoundError"
      : "TransactionNotFoundError";
  return error;
}

function client({
  receipt,
  transaction,
}: {
  receipt?: unknown;
  transaction?: unknown;
} = {}) {
  return {
    getTransactionReceipt:
      receipt instanceof Error
        ? vi.fn().mockRejectedValue(receipt)
        : vi.fn().mockResolvedValue(
            receipt ?? {
              status: "success",
              blockNumber: 123n,
            },
          ),
    getTransaction:
      transaction instanceof Error
        ? vi.fn().mockRejectedValue(transaction)
        : vi.fn().mockResolvedValue(
            transaction ?? { hash: transactionHash },
          ),
  };
}

describe("transaction status route", () => {
  beforeEach(() => {
    mocks.clients.length = 0;
    mocks.deployment.chainId = 1;
    mocks.deployment.rpcUrl = "https://primary.example";
    mocks.deployment.rpcUrlSecondary = "https://secondary.example";
  });

  it("returns a confirmed primary receipt without transaction fallbacks", async () => {
    const primary = client();
    const secondary = client();
    mocks.clients.push(primary, secondary);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "confirmed",
      blockNumber: "123",
    });
    expect(primary.getTransaction).not.toHaveBeenCalled();
    expect(secondary.getTransactionReceipt).toHaveBeenCalledOnce();
    expect(secondary.getTransaction).not.toHaveBeenCalled();
  });

  it("fans out to both RPCs before the primary lookup settles", async () => {
    let resolvePrimaryReceipt!: (value: {
      status: "success";
      blockNumber: bigint;
    }) => void;
    let resolveSecondaryReceipt!: (value: {
      status: "success";
      blockNumber: bigint;
    }) => void;
    const primaryReceipt = new Promise<{
      status: "success";
      blockNumber: bigint;
    }>((resolve) => {
      resolvePrimaryReceipt = resolve;
    });
    const secondaryReceipt = new Promise<{
      status: "success";
      blockNumber: bigint;
    }>((resolve) => {
      resolveSecondaryReceipt = resolve;
    });
    const primary = client();
    const secondary = client();
    primary.getTransactionReceipt.mockReturnValue(primaryReceipt);
    secondary.getTransactionReceipt.mockReturnValue(secondaryReceipt);
    mocks.clients.push(primary, secondary);

    const responsePromise = GET(request());

    expect(primary.getTransactionReceipt).toHaveBeenCalledOnce();
    expect(secondary.getTransactionReceipt).toHaveBeenCalledOnce();

    resolvePrimaryReceipt({
      status: "success",
      blockNumber: 123n,
    });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "confirmed",
      blockNumber: "123",
    });

    resolveSecondaryReceipt({
      status: "success",
      blockNumber: 123n,
    });
  });

  it("returns pending when the receipt is absent but the transaction exists", async () => {
    mocks.deployment.rpcUrlSecondary = null;
    const primary = client({
      receipt: notFound("receipt"),
    });
    mocks.clients.push(primary);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "pending",
      blockNumber: null,
    });
    expect(primary.getTransaction).toHaveBeenCalledWith({
      hash: transactionHash,
    });
  });

  it("prefers a terminal secondary receipt over a primary pending transaction", async () => {
    const primary = client({
      receipt: notFound("receipt"),
    });
    const secondary = client({
      receipt: {
        status: "reverted",
        blockNumber: 130n,
      },
    });
    mocks.clients.push(primary, secondary);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "reverted",
      blockNumber: "130",
    });
    expect(primary.getTransaction).toHaveBeenCalledOnce();
    expect(secondary.getTransactionReceipt).toHaveBeenCalledOnce();
  });

  it("retains primary pending when the secondary RPC reports absence", async () => {
    mocks.clients.push(
      client({
        receipt: notFound("receipt"),
      }),
      client({
        receipt: notFound("receipt"),
        transaction: notFound("transaction"),
      }),
    );

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "pending",
      blockNumber: null,
    });
  });

  it("retains primary pending when the secondary RPC fails transiently", async () => {
    mocks.clients.push(
      client({
        receipt: notFound("receipt"),
      }),
      client({
        receipt: new Error("Secondary RPC timed out"),
      }),
    );

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "pending",
      blockNumber: null,
    });
  });

  it("returns not-found only after both configured RPCs report absence", async () => {
    const primary = client({
      receipt: notFound("receipt"),
      transaction: notFound("transaction"),
    });
    const secondary = client({
      receipt: notFound("receipt"),
      transaction: notFound("transaction"),
    });
    mocks.clients.push(primary, secondary);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "not-found",
      blockNumber: null,
    });
    expect(primary.getTransaction).toHaveBeenCalledOnce();
    expect(secondary.getTransaction).toHaveBeenCalledOnce();
  });

  it("uses the secondary RPC when it knows the transaction is pending", async () => {
    mocks.clients.push(
      client({
        receipt: notFound("receipt"),
        transaction: notFound("transaction"),
      }),
      client({
        receipt: notFound("receipt"),
      }),
    );

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "pending",
      blockNumber: null,
    });
  });

  it("never turns a transient RPC failure into not-found", async () => {
    const rpcFailure = new Error("RPC timed out");
    mocks.clients.push(
      client({ receipt: rpcFailure }),
      client({
        receipt: notFound("receipt"),
        transaction: notFound("transaction"),
      }),
    );

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Transaction status is unavailable",
    });
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("does not mistake an unsupported RPC method for a missing transaction", async () => {
    mocks.deployment.rpcUrlSecondary = null;
    mocks.clients.push(
      client({
        receipt: new Error("RPC method could not be found"),
      }),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Transaction status is unavailable",
    });
    consoleError.mockRestore();
  });

  it("falls back to one configured RPC without fabricating pending state", async () => {
    mocks.deployment.rpcUrlSecondary = null;
    mocks.clients.push(
      client({
        receipt: notFound("receipt"),
        transaction: notFound("transaction"),
      }),
    );

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "not-found",
      blockNumber: null,
    });
  });
});
