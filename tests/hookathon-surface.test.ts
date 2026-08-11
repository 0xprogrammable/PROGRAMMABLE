import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { generateMetadata } from "@/app/hookathon/page";
import { HookathonPage } from "@/components/hookathon-page";
import { hookathonConfig } from "@/lib/hookathon/config";

const confirmation = Date.parse(hookathonConfig.confirmationIso);
const deadline = Date.parse(hookathonConfig.deadlineIso);

function renderHookathon(initialNowMs: number) {
  return renderToStaticMarkup(
    createElement(HookathonPage, {
      initialNowMs,
    }),
  );
}

describe("Hookathon surface", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the complete compact running state from one config", () => {
    const html = renderHookathon(confirmation);

    expect(html).toContain('<h1 id="hookathon-title">Hookathon</h1>');
    expect(html).toContain("$10,000");
    expect(html).toContain("$5,000");
    expect(html).toContain("$3,000");
    expect(html).toContain("$2,000");
    expect(html).toContain(">Build<");
    expect(html).toContain(">Submit<");
    expect(html).toContain(">Launch<");
    expect(html).toContain(">Originality<");
    expect(html).toContain(">Usefulness<");
    expect(html).toContain(">Execution<");
    expect(html).toContain("Anyone can enter, with no team size limit");
    expect(html).toContain("A pull request alone does not qualify");
  });

  it("uses an accessible native copy action without announcing every second", () => {
    const html = renderHookathon(confirmation);

    expect(html).toMatch(
      /<button[^>]*type="button"[^>]*>Copy builder prompt<\/button>/,
    );
    expect(html).toContain('href="https://github.com/0xprogrammable/hookbuilder"');
    expect(html).toContain("Open Hookbuilder");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).not.toContain('role="timer"');
    expect(html).not.toContain('aria-live="assertive"');
    expect(html).toContain(
      '<time dateTime="2026-08-13T17:40:20Z">13 Aug 2026, 19:40:20 CEST</time>',
    );
  });

  it("keeps the ended state stable and disables the entry action", () => {
    const html = renderHookathon(deadline);

    expect(html).toContain("Submissions closed");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*type="button"[^>]*>Submissions closed<\/button>/,
    );
    expect(html).not.toContain("Copy builder prompt");
  });

  it("keeps the local draft canonical but out of search indexes", () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    expect(generateMetadata().robots).toMatchObject({
      index: false,
      follow: false,
      noarchive: true,
    });

    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    const metadata = generateMetadata();

    expect(metadata.alternates).toEqual({ canonical: "/hookathon" });
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: false,
      noarchive: true,
      googleBot: {
        index: false,
        follow: false,
        noimageindex: true,
      },
    });
    expect(metadata.openGraph).toBeNull();
    expect(metadata.twitter).toBeNull();
  });

  it("allows indexing only for the explicit production release", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "test");
    const metadata = generateMetadata();

    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates).toEqual({ canonical: "/hookathon" });
    expect(metadata.openGraph).toBeNull();
    expect(metadata.twitter).toBeNull();
  });
});
