import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import type { FixtureOptions, FixtureSnapshot } from "./fixtures/late-migration-wallet";
// @ts-expect-error This fixture host is also executable for manual browser QA.
import { createLateMigrationServer } from "./fixtures/late-migration-server.mjs";

let server: Server;
let origin: string;
const browserErrors = new WeakMap<Page, string[]>();
const wallet = "0x228Be90653fDDAa408fB6cf9ca0AEC311dbE9A0D";
const otherWallet = "0x1111111111111111111111111111111111111111";
const gross = "12345000000000000000001";
const exactAmount = "12345.000000000000000001";
const snapshot = (page: Page): Promise<FixtureSnapshot> => page.evaluate(() => window.__lateMigrationFixture.snapshot());
const configure = (page: Page, value: Partial<FixtureOptions>) => page.evaluate(options => window.__lateMigrationFixture.configure(options), value);
const posts = (data: FixtureSnapshot) => data.requests.filter(request => request.method === "POST");
const submits = (data: FixtureSnapshot) => posts(data).filter(request => request.body?.action === "submit");
async function ready(page: Page) {
  await page.goto(origin + "?connected=true");
  await expect(page.getByRole("button", { name: "MAX", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Select MAX", exact: true })).toBeDisabled();
}
async function selectMax(page: Page) {
  await page.getByRole("button", { name: "MAX", exact: true }).click();
  await expect(page.locator("#late-migration-amount")).toHaveText(exactAmount);
  await expect(page.getByRole("button", { name: "Sign and send", exact: true })).toBeEnabled();
}
test.beforeAll(async () => {
  server = await createLateMigrationServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture port");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { server.close(); await once(server, "close"); });
test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  page.on("console", message => { if (message.type() === "error") failures.push(message.text()); });
  // Each test separately asserts absence of browser exceptions and console errors.
  test.info().annotations.push({ type: "fixture", description: "Actual component/CSS; controlled mock wallet and API. No chain or provider claims." });
  browserErrors.set(page, failures);
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

test("Fomo help is available before connecting and only opens Fomo after an explicit link click", async ({ page, context }) => {
  const fomoRequests: string[] = [];
  context.on("request", request => {
    if (new URL(request.url()).hostname === "fomo.family") fomoRequests.push(request.url());
  });
  // Exercise the real link navigation without contacting a real export service.
  await context.route("https://fomo.family/**", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>Official-link navigation fixture</title>",
  }));
  await page.goto(origin);
  const help = page.locator("details").filter({ has: page.locator("summary", { hasText: "Using Fomo?" }) });
  const summary = help.locator("summary");
  const exportLink = help.getByRole("link", { name: "Fomo’s official export page", exact: true });
  await expect(summary).toBeVisible();
  await expect(exportLink).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
  expect(fomoRequests).toEqual([]);

  await summary.focus();
  await expect(summary).toBeFocused();
  expect(await summary.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(help).toHaveAttribute("open", "");
  await expect(exportLink).toBeVisible();
  await expect(exportLink).toHaveAttribute("href", "https://fomo.family/export-key");
  await expect(exportLink).toHaveAttribute("rel", "noopener noreferrer");
  expect(await exportLink.evaluate(element => getComputedStyle(element).textDecorationLine)).toContain("underline");
  await expect(help.getByRole("link", { name: "official account import guide", exact: true })).toHaveAttribute("href", "https://support.metamask.io/start/use-an-existing-wallet/");
  await expect(help).toContainText("Export EVM wallet");
  await expect(help).toContainText("same email does not connect your Fomo wallet");
  await expect(help).toContainText("matches your snapshot wallet");
  await expect(help).toContainText("Importing moves no tokens");
  await expect(help).toContainText("You do not need ETH for this deposit");
  await expect(help).toContainText("Never paste private keys on this site or send them to support");
  await expect(help.locator("input, textarea, form")).toHaveCount(0);
  expect(fomoRequests).toEqual([]);
  const beforeNavigation = await snapshot(page);
  expect(beforeNavigation.connects).toBe(0);
  expect(beforeNavigation.signatures).toEqual([]);
  expect(beforeNavigation.requests).toEqual([]);

  const [popup] = await Promise.all([page.waitForEvent("popup"), exportLink.click()]);
  await popup.waitForURL("https://fomo.family/export-key");
  expect(fomoRequests).toEqual(["https://fomo.family/export-key"]);
  expect(page.url()).toBe(origin + "/");
  expect((await snapshot(page)).signatures).toEqual([]);
  expect(posts(await snapshot(page))).toEqual([]);
  await popup.close();
});

for (const width of [1440, 390, 320]) {
  test(`expanded Fomo help fits at ${width}px before wallet connection`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto(origin);
    await page.locator("summary", { hasText: "Using Fomo?" }).click();
    const help = page.locator("details[open]");
    await expect(help).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const box = await help.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    expect((await snapshot(page)).connects).toBe(0);
    expect((await snapshot(page)).signatures).toEqual([]);
    await page.screenshot({ path: `output/playwright/late-migration-fomo-${width}-expanded.png`, fullPage: true });
  });
}

test("Fomo help preserves exact MAX and manual payout at 200% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 1000 });
  await ready(page); await selectMax(page);
  await page.locator("summary", { hasText: "Using Fomo?" }).click();
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect(page.locator("#late-migration-amount")).toHaveText(exactAmount);
  await expect(page.getByText("Manual payout · 80%", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign and send", exact: true })).toBeEnabled();
  expect(await page.locator("details[open]").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect((await snapshot(page)).signatures).toEqual([]);
  expect(posts(await snapshot(page))).toEqual([]);
  await page.screenshot({ path: "output/playwright/late-migration-fomo-zoom-200.png", fullPage: true });
});


test("connecting and MAX never sign or submit; MAX excludes post-snapshot top-ups", async ({ page }) => {
  await page.goto(origin);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByRole("button", { name: "MAX", exact: true })).toBeEnabled();
  expect((await snapshot(page)).connects).toBe(1);
  await selectMax(page);
  await configure(page, { currentBalanceRaw: "999999999999999999999999999999" });
  await page.getByRole("button", { name: "MAX", exact: true }).click();
  await expect(page.locator("#late-migration-amount")).toHaveText(exactAmount);
  const data = await snapshot(page);
  expect(data.signatures).toEqual([]); expect(posts(data)).toEqual([]);
  expect(data.currentBalanceRaw).not.toBe(gross);
  await expect(page.getByText("Manual payout · 80%", { exact: true })).toBeVisible();
  await expect(page.getByText("80% in new V4, paid manually", { exact: true })).toBeVisible();
});

test("one explicit click signs exact permit once and submits authenticated bound request", async ({ page }) => {
  await ready(page); await selectMax(page);
  await page.getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deposit processing", exact: true })).toBeDisabled();
  const data = await snapshot(page);
  expect(data.signatures).toEqual([{ deadline: "1788500000", nonce: "7", spender: "0x2222222222222222222222222222222222222222", value: gross }]);
  expect(posts(data).map(request => request.body?.action)).toEqual(["prepare", "submit"]);
  const submitted = submits(data)[0];
  expect(submitted.body).toMatchObject({ walletAddress: wallet, permitNonce: "7", permitDeadline: "1788500000", requestBindingHash: `sha256:${"cd".repeat(32)}`, permitSignature: `0x${"ab".repeat(64)}1b` });
  expect(submitted.headers.authorization).toBe("Bearer fixture-access-token");
  expect(submitted.headers["x-privy-identity-token"]).toBe("fixture-identity-token");
  expect(submitted.headers["idempotency-key"]).toMatch(/^late-migration-intake-/u);
});

test("signature rejection never submits and permits a new explicit attempt", async ({ page }) => {
  await ready(page); await selectMax(page); await configure(page, { rejectSignature: true });
  await page.getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Signature cancelled. Nothing was moved.");
  expect(submits(await snapshot(page))).toEqual([]);
  await configure(page, { rejectSignature: false });
  await page.getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deposit processing", exact: true })).toBeVisible();
  expect((await snapshot(page)).signatures).toHaveLength(2);
  expect(submits(await snapshot(page))).toHaveLength(1);
});

test("finalized deposit shows manual payout pending and prevents another signature", async ({ page }) => {
  await page.goto(origin + "?connected=true&status=deposit_finalized");
  await expect(page.getByRole("button", { name: "Deposit received", exact: true })).toBeDisabled();
  await expect(page.getByText("Deposit received. Your manual payout is pending.", { exact: true })).toBeVisible();
  await expect(page.locator("#late-migration-amount")).toHaveText(exactAmount);
  await expect(page.getByText("Deposit amount", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View Ethereum deposit ↗", exact: true })).toHaveAttribute("href", `https://etherscan.io/tx/0x${"ab".repeat(32)}`);
  expect((await snapshot(page)).signatures).toEqual([]); expect(posts(await snapshot(page))).toEqual([]);
});


test("submitted deposit polls through confirmation to finality without another signature", async ({ page }) => {
  await page.clock.install();
  await page.goto(origin + "?connected=true&status=deposit_submitted");
  await expect(page.getByText("Deposit submitted. Waiting for confirmation.", { exact: true })).toBeVisible();
  await configure(page, { status: "deposit_confirmed" });
  await page.clock.runFor(6100);
  await expect(page.getByText("Deposit confirmed. Waiting for Ethereum finality.", { exact: true })).toBeVisible();
  await configure(page, { status: "deposit_finalized" });
  await page.clock.runFor(6100);
  await expect(page.getByText("Deposit received. Your manual payout is pending.", { exact: true })).toBeVisible();
  expect((await snapshot(page)).signatures).toEqual([]); expect(posts(await snapshot(page))).toEqual([]);
});

test("support status offers review and a safe status refresh without signing", async ({ page }) => {
  await page.goto(origin + "?connected=true&status=support_required");
  await expect(page.getByRole("alert")).toContainText("Do not sign again");
  await expect(page.getByRole("link", { name: "Contact support", exact: true })).toHaveAttribute("href", "https://x.com/ProgrammableHQ");
  await page.getByRole("button", { name: "Check deposit status", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Do not sign again");
  expect((await snapshot(page)).signatures).toEqual([]); expect(posts(await snapshot(page))).toEqual([]);
});

test("unknown status recovery only reads status; signing requires a separate explicit click", async ({ page }) => {
  await page.goto(origin + "?connected=true&statusFailure=true");
  await expect(page.getByRole("alert")).toContainText("may already be processing");
  await page.getByRole("button", { name: "MAX", exact: true }).click();
  await page.getByRole("button", { name: "Check deposit status", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign and send", exact: true })).toBeEnabled();
  expect((await snapshot(page)).signatures).toEqual([]); expect(posts(await snapshot(page))).toEqual([]);
  await page.getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deposit processing", exact: true })).toBeVisible();
  expect((await snapshot(page)).signatures).toHaveLength(1);
});

test("lost submit response does not claim nothing moved and retry retrieves saved finality", async ({ page }) => {
  await ready(page); await selectMax(page); await configure(page, { submitFailure: true });
  await page.getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("may already be processing");
  await expect(page.getByRole("alert")).not.toContainText("Nothing was moved");
  await configure(page, { status: "deposit_finalized" });
  await page.getByRole("button", { name: "Check deposit status", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deposit received", exact: true })).toBeVisible();
  expect((await snapshot(page)).signatures).toHaveLength(1); expect(submits(await snapshot(page))).toHaveLength(1);
});

test("wallet replacement during preparation ignores stale prepare without signing", async ({ page }) => {
  await ready(page); await selectMax(page); await configure(page, { holdPrepare: true });
  await page.getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect.poll(async () => posts(await snapshot(page)).length).toBe(1);
  await page.evaluate(account => window.__lateMigrationFixture.setWallet(account as `0x${string}`), otherWallet);
  await expect(page.getByRole("button", { name: "Not eligible", exact: true })).toBeVisible();
  await page.evaluate(() => window.__lateMigrationFixture.releasePrepare());
  await expect(page.getByRole("button", { name: "Not eligible", exact: true })).toBeVisible();
  expect((await snapshot(page)).signatures).toEqual([]); expect(submits(await snapshot(page))).toEqual([]);
});

test("wallet replacement during signing never submits the stale result", async ({ page }) => {
  await ready(page); await selectMax(page); await configure(page, { holdSignature: true });
  await page.getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).signatures.length).toBe(1);
  await page.evaluate(account => window.__lateMigrationFixture.setWallet(account as `0x${string}`), otherWallet);
  await expect(page.getByRole("button", { name: "Not eligible", exact: true })).toBeVisible();
  await page.evaluate(() => window.__lateMigrationFixture.releaseSignature());
  await expect(page.getByRole("button", { name: "Not eligible", exact: true })).toBeVisible();
  expect(submits(await snapshot(page))).toEqual([]);
});

test("synchronous duplicate click produces only one prepare and one signature", async ({ page }) => {
  await ready(page); await selectMax(page); await configure(page, { holdPrepare: true });
  await page.getByRole("button", { name: "Sign and send", exact: true }).evaluate(button => {
    (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click();
  });
  await expect.poll(async () => posts(await snapshot(page)).length).toBe(1);
  await page.evaluate(() => window.__lateMigrationFixture.releasePrepare());
  await expect(page.getByRole("button", { name: "Deposit processing", exact: true })).toBeVisible();
  expect(posts(await snapshot(page))).toHaveLength(2); expect((await snapshot(page)).signatures).toHaveLength(1);
});

test("altered server permit fails before wallet signature or submit", async ({ page }) => {
  await ready(page); await selectMax(page); await configure(page, { tamperSpender: true });
  await page.getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await snapshot(page)).signatures).toEqual([]); expect(submits(await snapshot(page))).toEqual([]);
});

test("disabled activation shows exact eligibility but never offers signing", async ({ page }) => {
  await page.goto(origin + "?connected=true&disabled=true");
  await expect(page.getByRole("button", { name: "Deposits not open", exact: true })).toBeDisabled();
  await expect(page.getByText("You are eligible. Deposits are not open yet.", { exact: true })).toBeVisible();
  expect((await snapshot(page)).signatures).toEqual([]); expect(posts(await snapshot(page))).toEqual([]);
});

test("keyboard selects MAX and exposes a visible focus indicator", async ({ page }) => {
  await ready(page);
  const max = page.getByRole("button", { name: "MAX", exact: true });
  await max.focus(); await expect(max).toBeFocused();
  const indicator = await max.evaluate(element => { const style = getComputedStyle(element); return { outline: style.outlineStyle, shadow: style.boxShadow }; });
  expect(indicator.outline !== "none" || indicator.shadow !== "none").toBe(true);
  await page.keyboard.press("Enter"); await expect(page.locator("#late-migration-amount")).toHaveText(exactAmount);
  await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Sign and send", exact: true })).toBeFocused();
  expect((await snapshot(page)).signatures).toEqual([]);
});

for (const width of [1440, 390, 320]) {
  test(`exact decimals remain fully visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await ready(page); await selectMax(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const amount = await page.locator("#late-migration-amount").evaluate(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth, text: element.textContent }));
    expect(amount.contentWidth).toBeLessThanOrEqual(amount.width); expect(amount.text).toBe(exactAmount);
    await page.screenshot({ path: `output/playwright/late-migration-${width}-max.png`, fullPage: true });
  });
}
test("200% page zoom preserves the exact amount and action", async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 1000 }); await ready(page); await selectMax(page);
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  const amount = page.locator("#late-migration-amount");
  await expect(amount).toHaveText(exactAmount);
  expect(await amount.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Sign and send", exact: true })).toBeVisible();
  await page.screenshot({ path: "output/playwright/late-migration-zoom-200.png", fullPage: true });
});


test("an onchain deposit without a local record blocks another permit and offers support", async ({ page }) => {
  await ready(page);
  await configure(page, { untrackedDeposit: true });
  await selectMax(page);
  await page.getByRole("button", { name: "Sign and send", exact: true }).click();
  await expect(page.getByText("An Ethereum deposit already exists for this wallet. Do not sign again. Contact support.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Contact support", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check deposit status", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check deposit status", exact: true })).toBeVisible();
  expect((await snapshot(page)).signatures).toEqual([]);
  expect(submits(await snapshot(page))).toEqual([]);
  expect(posts(await snapshot(page))).toHaveLength(1);
});
