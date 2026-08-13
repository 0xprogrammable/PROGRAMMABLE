import { createServer, type Server } from "node:http";
import { once } from "node:events";

import { build } from "esbuild";
import { expect, test } from "@playwright/test";

let server: Server;
let origin = "";
let walletSendCount = 0;
let settleWalletSend: (() => void) | undefined;
let walletSendBarrier = new Promise<void>((resolve) => {
  settleWalletSend = resolve;
});

const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Wallet request lock</title></head>
  <body>
    <button id="launch" type="button">Launch project</button>
    <p id="status" role="status">Ready</p>
    <script type="module">
      import {
        runWithBrowserWalletRequestLock,
        WalletRequestPendingError,
      } from "/wallet-request-lock.js";
      const button = document.querySelector("#launch");
      const status = document.querySelector("#status");
      button.addEventListener("click", async () => {
        try {
          await runWithBrowserWalletRequestLock({
            sessionSubject: "browser-session",
            account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            chainId: "1",
            requestSubject: JSON.stringify(["launch", "browser-subject"]),
            assertCurrentSession: () => undefined,
            execute: async () => {
              status.textContent = "Confirm in wallet";
              const response = await fetch("/wallet-send", { method: "POST" });
              if (!response.ok) throw new Error("Wallet send failed");
              return response.text();
            },
          });
          status.textContent = "Launch submitted";
        } catch (error) {
          status.textContent = error instanceof WalletRequestPendingError
            ? "Confirm in other tab"
            : error.message;
        }
      });
    </script>
  </body>
</html>`;

test.beforeAll(async () => {
  const bundled = await build({
    entryPoints: ["lib/wallet-request-lock.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  const source = bundled.outputFiles[0]?.text;
  if (!source) throw new Error("Wallet request lock browser bundle is missing");

  server = createServer(async (request, response) => {
    if (request.url === "/wallet-request-lock.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(source);
      return;
    }
    if (request.url === "/wallet-send" && request.method === "POST") {
      walletSendCount += 1;
      await walletSendBarrier;
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end(`0x${"1".repeat(64)}`);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(html);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Browser fixture address is unavailable");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  server.close();
  await once(server, "close");
});

test.beforeEach(async ({ context }) => {
  walletSendCount = 0;
  walletSendBarrier = new Promise<void>((resolve) => {
    settleWalletSend = resolve;
  });
  await context.addInitScript(() => localStorage.clear());
});

test.afterEach(() => {
  settleWalletSend?.();
});

test("forced double click opens exactly one wallet request", async ({
  page,
}) => {
  await page.goto(origin);
  await page.locator("#launch").evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => walletSendCount).toBe(1);
  await expect(page.getByRole("status")).toHaveText("Confirm in other tab");

  settleWalletSend?.();
  await expect(page.getByRole("status")).toHaveText("Launch submitted");
  expect(walletSendCount).toBe(1);
});

test("two tabs share one pending wallet request", async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto(origin), second.goto(origin)]);

  await Promise.all([
    first.locator("#launch").click(),
    second.locator("#launch").click(),
  ]);
  await expect.poll(() => walletSendCount).toBe(1);
  await expect
    .poll(async () => [
      await first.getByRole("status").textContent(),
      await second.getByRole("status").textContent(),
    ])
    .toContain("Confirm in other tab");

  settleWalletSend?.();
  await expect
    .poll(async () => [
      await first.getByRole("status").textContent(),
      await second.getByRole("status").textContent(),
    ])
    .toContain("Launch submitted");
  expect(walletSendCount).toBe(1);
});
