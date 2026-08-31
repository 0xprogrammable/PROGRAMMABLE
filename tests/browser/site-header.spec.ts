import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error The fixture is shared with the manual browser QA host.
import { createSiteHeaderServer } from "./fixtures/site-header-server.mjs";

let server: Server;
let origin: string;
test.beforeAll(async () => {
  server = await createSiteHeaderServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { server.close(); await once(server, "close"); });
test.beforeEach(async ({ page }) => { await page.goto(origin); });

const walletName = "Wallet 0xaaaa…aaaa";
const toRobinhood = "Viewing Ethereum. Switch to Robinhood";
const toEthereum = "Viewing Robinhood. Switch to Ethereum";

test("wallet opens only its actions; copy, Escape, outside click and focus work", async ({page,context}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const trigger = page.getByRole("button", {name:walletName,exact:true});
  await trigger.click();
  const menu = page.getByRole("group",{name:"Wallet actions",exact:true});
  await expect(menu.getByRole("link")).toHaveText(["Profile"]);
  await expect(menu.getByRole("button")).toHaveText(["Copy Address","Disconnect"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await menu.getByRole("button",{name:"Copy Address",exact:true}).click();
  await expect(menu.getByRole("status")).toHaveText("Address copied");
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("link",{name:"Profile",exact:true})).toBeFocused();
  await page.getByRole("link",{name:"Outside control"}).click();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveCSS("background-color","rgba(0, 0, 0, 0)");
});

test("disconnect failure stays inline and success returns to connect",async ({page})=>{
  await page.getByRole("button",{name:"Fail disconnect"}).click();
  await page.getByRole("button",{name:walletName,exact:true}).click();
  await page.getByRole("button",{name:"Disconnect",exact:true}).click();
  await expect(page.getByText("Unable to disconnect. Try again.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("disconnect-options")).toHaveText('{"showDialogOnFailure":false}');
  await page.getByRole("button",{name:"Fail disconnect"}).click();
  await page.getByRole("button",{name:walletName,exact:true}).click();
  await page.getByRole("button",{name:"Disconnect",exact:true}).click();
  await expect(page.getByRole("button",{name:"Connect wallet",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Connect wallet",exact:true})).toBeFocused();
  await expect(page.getByRole("group",{name:"Wallet actions",exact:true})).toHaveCount(0);
});

test("chain switch waits for wallet success and suppresses duplicate requests",async ({page})=>{
  const toggle=page.getByRole("button",{name:toRobinhood,exact:true});
  await toggle.evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
  await expect(toggle).toBeDisabled();
  await expect(page.getByTestId("requests")).toHaveText("4663");
  await expect(page.getByRole("button",{name:toEthereum,exact:true})).toBeEnabled();
  await expect(page.getByTestId("wallet-chain")).toHaveText("0x1237");
  await page.getByRole("button",{name:toEthereum,exact:true}).click();
  await expect(page.getByRole("button",{name:toRobinhood,exact:true})).toBeEnabled();
  await expect(page.getByTestId("wallet-chain")).toHaveText("0x1");
  await expect(page.getByTestId("requests")).toHaveText("4663,1");
});

test("rejected network switch leaves the view and wallet unchanged",async ({page})=>{
  await page.getByRole("button",{name:"Reject network switch"}).click();
  await page.getByRole("button",{name:toRobinhood,exact:true}).click();
  await expect(page.getByText("Network unchanged. Confirm Robinhood in your wallet and try again.")).toBeVisible();
  await expect(page.getByRole("button",{name:toRobinhood,exact:true})).toBeEnabled();
  await expect(page.getByTestId("wallet-chain")).toHaveText("0x1");
});

test("anonymous browsing can change chain without a wallet request",async ({page})=>{
  await page.getByRole("button",{name:"Use anonymous session"}).click();
  await page.getByRole("button",{name:toRobinhood,exact:true}).click();
  await expect(page.getByRole("button",{name:toEthereum,exact:true})).toBeEnabled();
  await expect(page.getByTestId("requests")).toBeEmpty();
});

test("session changes during a pending switch do not commit an outdated result",async ({page})=>{
  await page.getByRole("button",{name:toRobinhood,exact:true}).click();
  await page.getByRole("button",{name:"Use anonymous session"}).click();
  await expect(page.getByText("Your wallet changed. Please try again.")).toBeVisible();
  await expect(page.getByRole("button",{name:toRobinhood,exact:true})).toBeEnabled();
});

test("anonymous Connect wallet closes navigation before opening login",async ({page})=>{
  await page.getByRole("button",{name:"Use anonymous session"}).click();
  await page.getByRole("button",{name:"Open menu",exact:true}).click();
  await page.getByRole("button",{name:"Connect wallet",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Connect wallet fixture"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Open menu",exact:true})).toHaveAttribute("aria-expanded","false");
});

for(const width of [320,390,1440]) {
  test(`header menus fit at ${width}px and remain mutually exclusive`,async ({page})=>{
    await page.setViewportSize({width,height:844});
    await page.getByRole("button",{name:walletName,exact:true}).click();
    const menu=page.getByRole("group",{name:"Wallet actions",exact:true});
    const box=await menu.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x??0)+(box?.width??0)).toBeLessThanOrEqual(width);
    await page.getByRole("button",{name:"Open menu",exact:true}).click();
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole("navigation",{name:"Menu navigation",exact:true})).toBeVisible();
    await page.getByRole("button",{name:walletName,exact:true}).click();
    await expect(menu).toBeVisible();
    await expect(page.getByRole("button",{name:"Open menu",exact:true})).toHaveAttribute("aria-expanded","false");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  });
}
