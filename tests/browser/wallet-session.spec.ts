import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
// @ts-expect-error The esbuild fixture host is a JavaScript module.
import { createWalletSessionServer } from "./fixtures/wallet-session-server.mjs";

const accountA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const accountB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
let server: Server;
let origin: string;
const browserErrors = new WeakMap<Page, string[]>();

test.beforeAll(async () => {
  server = await createWalletSessionServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (!server) return;
  server.close();
  await once(server, "close");
});

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    errors.push(`Unexpected external request from wallet fixture: ${url.origin}`);
    await route.abort();
  });
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

async function open(page: Page, path = "/profile") {
  await page.goto(origin + path);
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
  await expect(page.getByLabel("Wallet busy", { exact: true })).toHaveText("false");
}

async function scenario(page: Page, name: string) {
  await page.getByLabel("SDK scenario", { exact: true }).selectOption(name);
}

async function calls(page: Page) {
  return JSON.parse(await page.getByLabel("SDK calls", { exact: true }).innerText()) as { method: string; options?: unknown }[];
}

async function expectMethods(page: Page, methods: string[]) {
  await expect.poll(async () => (await calls(page)).map((call) => call.method)).toEqual(methods);
}

for (const path of ["/profile", "/developers/api-keys"]) {
  test(`${path}: primary account wins over a newer unlinked or foreign wallet`, async ({ page }) => {
    await open(page, path);
    await expect(page.getByRole("button", { name: "Manage wallet 0xaaaa…aaaa", exact: true })).toBeVisible();
    await expect(page.getByLabel("Wallet linked", { exact: true })).toHaveText("true");
    await scenario(page, "foreign-linked");
    await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
    await page.getByRole("button", { name: "Open account", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Connected account", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText("0xbbbb");
    await expectMethods(page, []);
  });

  test(`${path}: known linked account reconnects without trying to create or link it again`, async ({ page }) => {
    await open(page, path);
    await scenario(page, "linked-disconnected");
    await expect(page.getByLabel("Selected account", { exact: true })).toHaveText("none");
    await page.getByRole("button", { name: "Set up wallet", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "SDK wallet dialog", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expectMethods(page, ["connectWallet"]);
    expect((await calls(page))[0].options).toMatchObject({ walletChainType: "ethereum-only" });
    await page.getByRole("button", { name: "Complete wallet A reconnect", exact: true }).click();
    await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(/Complete wallet setup|Add an Ethereum wallet/)).toHaveCount(0);
  });
}

test("a user change never adopts connected wallets belonging to the previous account", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Change SDK user, keep old wallets", exact: true }).click();
  await expect(page.getByLabel("SDK user", { exact: true })).toHaveText("fixture-user-beta");
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText("none");
  await expect(page.getByLabel("Wallet linked", { exact: true })).toHaveText("false");
  await expect(page.getByRole("button", { name: /Manage wallet/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expectMethods(page, ["connectWallet"]);
});

test("wallet hydration prevents login and linking until the connected wallet list settles", async ({ page }) => {
  await open(page);
  await scenario(page, "hydrating");
  await expect(page.getByRole("button", { name: "Opening wallet", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Open account", exact: true }).dblclick();
  await expectMethods(page, []);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Finish wallet hydration", exact: true }).click();
  await expect(page.getByLabel("Wallet busy", { exact: true })).toHaveText("false");
  await expectMethods(page, []);
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expectMethods(page, ["connectWallet"]);
});

test("only an authenticated account without a linked wallet starts the SDK link flow", async ({ page }) => {
  await open(page, "/developers/api-keys");
  await scenario(page, "email-without-wallet");
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expectMethods(page, ["linkWallet"]);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: "Reject linking foreign account", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("This wallet belongs to another account. Sign out, then sign in with that wallet.");
});

test("the SDK modal suppresses an existing application wallet dialog", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Connected account", exact: true })).toBeVisible();
  // This represents an SDK status event, not a click through the application modal.
  await page.getByRole("button", { name: "Open SDK modal", exact: true }).dispatchEvent("click");
  await expect(page.getByRole("dialog", { name: "Connected account", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "SDK wallet dialog", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expectMethods(page, []);
});

test("login completion uses the actual login wallet and clears that selection for another user", async ({ page }) => {
  await open(page, "/developers/api-keys");
  await scenario(page, "anonymous");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expectMethods(page, ["login"]);
  await page.getByRole("button", { name: "Complete wallet B login", exact: true }).click();
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountB);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Change SDK user, same linked addresses", exact: true }).click();
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
});

test("explicit account selection is restricted to owned wallets and does not survive a user change", async ({ page }) => {
  await open(page);
  await scenario(page, "both-owned");
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "0xbbbb…bbbb Robinhood Chain", exact: true }).click();
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountB);
  await page.getByRole("button", { name: "Change SDK user, same linked addresses", exact: true }).click();
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
  await expectMethods(page, []);
});

for (const [sdkScenario, method] of [["anonymous", "login"], ["linked-disconnected", "connectWallet"], ["email-without-wallet", "linkWallet"]]) {
  test(`two rapid clicks make one SDK ${method} request`, async ({ page }) => {
    await open(page, "/developers/api-keys");
    await scenario(page, sdkScenario);
    await page.getByRole("button", { name: "Delay browser lock", exact: true }).click();
    await page.getByRole("button", { name: "Open account", exact: true }).dblclick();
    await expect(page.getByLabel("Pending browser locks", { exact: true })).toHaveText("1");
    await expectMethods(page, []);
    await page.getByRole("button", { name: "Resume browser lock", exact: true }).click();
    await expectMethods(page, [method]);
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });
}

test("session restoration during a pending login lease cancels the obsolete login", async ({ page }) => {
  await open(page);
  await scenario(page, "anonymous");
  await page.getByRole("button", { name: "Delay browser lock", exact: true }).click();
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expect(page.getByLabel("Pending browser locks", { exact: true })).toHaveText("1");
  await page.getByRole("button", { name: "Restore SDK session", exact: true }).click();
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
  await page.getByRole("button", { name: "Resume browser lock", exact: true }).click();
  await expect(page.getByLabel("Wallet busy", { exact: true })).toHaveText("false");
  await expectMethods(page, []);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a user change while awaiting a reconnect lease cancels the old request and allows a fresh attempt", async ({ page }) => {
  await open(page);
  await scenario(page, "linked-disconnected");
  await page.getByRole("button", { name: "Delay browser lock", exact: true }).click();
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expect(page.getByLabel("Pending browser locks", { exact: true })).toHaveText("1");
  await page.getByRole("button", { name: "Change SDK user, keep old wallets", exact: true }).click();
  await expect(page.getByLabel("SDK user", { exact: true })).toHaveText("fixture-user-beta");
  await page.getByRole("button", { name: "Resume browser lock", exact: true }).click();
  await expect(page.getByLabel("Wallet busy", { exact: true })).toHaveText("false");
  await expectMethods(page, []);
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expectMethods(page, ["connectWallet"]);
});

test("signing out while awaiting a reconnect lease never opens a prompt for the old account", async ({ page }) => {
  await open(page);
  await scenario(page, "linked-disconnected");
  await page.getByRole("button", { name: "Delay browser lock", exact: true }).click();
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expect(page.getByLabel("Pending browser locks", { exact: true })).toHaveText("1");
  await page.getByRole("button", { name: "Sign out of app", exact: true }).click();
  await expect(page.getByLabel("Session authenticated", { exact: true })).toHaveText("false");
  await page.getByRole("button", { name: "Resume browser lock", exact: true }).click();
  await expect(page.getByLabel("Wallet busy", { exact: true })).toHaveText("false");
  await expectMethods(page, ["logout"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
});
