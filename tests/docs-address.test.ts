import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DocsAddress,
  getDocsAddressCopyMotion,
  getDocsAddressCopyStatus,
} from "../components/docs-address";

describe("Docs deployment addresses", () => {
  it("renders the explorer link and a labelled copy action together", () => {
    const address = "0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770";
    const html = renderToStaticMarkup(
      createElement(DocsAddress, { address, label: "Launcher" }),
    );

    expect(html).toContain(
      `href="https://etherscan.io/address/${address}#code"`,
    );
    expect(html).toContain('aria-label="Copy Launcher address"');
    expect(html).toContain('role="status"');
  });

  it("uses an explicit chain explorer without changing the copy control", () => {
    const address = "0x34965F2A2ee9254522232C32F02056E92BE0C98a";
    const explorerUrl =
      `https://robinhoodchain.blockscout.com/address/${address}`;
    const html = renderToStaticMarkup(
      createElement(DocsAddress, {
        address,
        explorerUrl,
        label: "Robinhood Launch Stamp Router",
      }),
    );

    expect(html).toContain(`href="${explorerUrl}"`);
    expect(html).toContain(
      'aria-label="Copy Robinhood Launch Stamp Router address"',
    );
  });

  it("provides explicit assistive feedback for success and failure", () => {
    expect(getDocsAddressCopyStatus("Launcher", "idle")).toBe("");
    expect(getDocsAddressCopyStatus("Launcher", "copied")).toBe(
      "Launcher address copied",
    );
    expect(getDocsAddressCopyStatus("Launcher", "error")).toBe(
      "Could not copy Launcher address",
    );
  });

  it("keeps keyboard copy feedback instant while pointer feedback may animate", () => {
    expect(getDocsAddressCopyMotion(0)).toBe("instant");
    expect(getDocsAddressCopyMotion(1)).toBe("standard");
  });
});
