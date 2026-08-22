import { describe, expect, it } from "vitest";

import { predictionMarketErrorMessage } from "../lib/prediction-market-errors";

describe("prediction market error messages", () => {
  it("prefers the provider-safe short message", () => {
    expect(
      predictionMarketErrorMessage(
        {
          message:
            "Request failed at https://robinhood-mainnet.g.alchemy.com/v2/private_key_value",
          shortMessage: "HTTP request failed.",
        },
        "Markets are temporarily unavailable",
      ),
    ).toBe("HTTP request failed.");
  });

  it("removes provider URLs from ordinary errors", () => {
    const message = predictionMarketErrorMessage(
      new Error(
        "Request failed at https://robinhood-mainnet.g.alchemy.com/v2/private_key_value",
      ),
      "Markets are temporarily unavailable",
    );

    expect(message).toBe("Request failed at the configured provider");
    expect(message).not.toContain("private_key_value");
  });

  it("uses the supplied fallback for unknown or empty errors", () => {
    expect(
      predictionMarketErrorMessage(null, "Prediction positions are unavailable"),
    ).toBe("Prediction positions are unavailable");
    expect(
      predictionMarketErrorMessage(new Error(""), "Market creation failed"),
    ).toBe("Market creation failed");
  });
});
