import { describe, expect, it } from "vitest";

import {
  PartnerAdminBrowserErrorV1,
  partnerAdminBrowserErrorV1,
} from "../lib/partner-admin-browser-error";

const REQUEST_ID = "018f3e2a-7b4c-7d5e-8f90-123456789abc";

describe("partner admin browser errors", () => {
  it("turns the preserved backend denial into a server-controlled access state", () => {
    const error = partnerAdminBrowserErrorV1(
      new Response(null, {
        status: 403,
        headers: { "x-request-id": REQUEST_ID },
      }),
      {
        schemaVersion: "programmable.partner-admin.v1",
        error: {
          code: "PARTNER_ADMIN_FORBIDDEN",
          message: "The request could not be completed.",
          requestId: REQUEST_ID,
          internalAllowlist: "must-not-cross",
          rootKeySecret: `pm_partner_root_${"A".repeat(22)}_${"B".repeat(43)}`,
        },
      },
      "Unable to load partners.",
    );

    expect(error).toBeInstanceOf(PartnerAdminBrowserErrorV1);
    expect(error).toMatchObject({
      status: 403,
      code: "PARTNER_ADMIN_FORBIDDEN",
      requestId: REQUEST_ID,
      retryAfter: null,
      accessDenied: true,
      message: "This wallet is signed in but does not have partner administration access.",
    });
    expect(JSON.stringify(error)).not.toContain("must-not-cross");
    expect(JSON.stringify(error)).not.toContain("pm_partner_root_");
  });

  it("keeps an unlinked wallet separate from backend access denial", () => {
    const error = partnerAdminBrowserErrorV1(
      new Response(null, {
        status: 403,
        headers: { "x-request-id": REQUEST_ID },
      }),
      {
        schemaVersion: "programmable.partner-admin.v1",
        error: {
          code: "wallet_not_linked",
          message: "The request could not be completed.",
          requestId: REQUEST_ID,
        },
      },
      "Unable to load partners.",
    );

    expect(error).toMatchObject({
      status: 403,
      code: "wallet_not_linked",
      requestId: REQUEST_ID,
      retryAfter: null,
      accessDenied: false,
      walletNotLinked: true,
      message: "This wallet is connected but not linked to your Programmable sign-in.",
    });
  });

  it("keeps bounded retry and request correlation for ordinary errors", () => {
    const error = partnerAdminBrowserErrorV1(
      new Response(null, {
        status: 429,
        headers: {
          "retry-after": "17",
          "x-request-id": REQUEST_ID,
        },
      }),
      {
        error: {
          code: "PARTNER_ADMIN_RATE_LIMITED",
          message: "Too many partner requests.",
          requestId: REQUEST_ID,
        },
      },
      "Unable to update the partner.",
    );

    expect(error.accessDenied).toBe(false);
    expect(error.message).toBe(
      `Too many partner requests. Try again in 17 seconds. Request ID: ${REQUEST_ID}.`,
    );
  });
});
