// Website display policy only. Canonical launch records are never removed here.
export const PINNED_ROBINHOOD_TOKEN = "0xc60ba256b44334a0cd2c7242e98b88f031abb006";

const HIDDEN_ROBINHOOD_TOKENS = new Set([
  "0x15fca474b23cafe775120b1fafbcff0e7a827af2", // Robinhood Clean Room
]);

export function isVisibleRobinhoodToken(address: string) {
  return !HIDDEN_ROBINHOOD_TOKENS.has(address.toLowerCase());
}

export function isPinnedRobinhoodToken(address: string) {
  return address.toLowerCase() === PINNED_ROBINHOOD_TOKEN;
}
