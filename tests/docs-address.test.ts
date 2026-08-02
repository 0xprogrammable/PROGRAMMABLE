import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DocsAddress,
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

  it("provides explicit assistive feedback for success and failure", () => {
    expect(getDocsAddressCopyStatus("Launcher", "idle")).toBe("");
    expect(getDocsAddressCopyStatus("Launcher", "copied")).toBe(
      "Launcher address copied",
    );
    expect(getDocsAddressCopyStatus("Launcher", "error")).toBe(
      "Could not copy Launcher address",
    );
  });
});
