import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WebsiteLinkIcon } from "../components/website-link-icon";

describe("WebsiteLinkIcon", () => {
  it("renders a compact decorative globe that inherits the link color", () => {
    const html = renderToStaticMarkup(
      <WebsiteLinkIcon className="token-website-link-icon" />,
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('class="token-website-link-icon"');
    expect(html).toContain('data-token-link-icon="website"');
    expect(html).toContain('focusable="false"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-width="1.7"');
    expect(html).toContain('viewBox="0 0 20 20"');
  });
});
