import { keccak256, type Hex } from "viem";

export interface HookemonAdoptionCalldataEnvelopeV22 {
  readonly calldata: Hex;
  readonly expectedSelector: Hex;
  readonly expectedCalldataHash: Hex;
}

export interface HookemonAdoptionReencodingCheckV22
  extends HookemonAdoptionCalldataEnvelopeV22 {
  readonly reencodedCalldata: Hex;
}

/**
 * Final guard for the future frozen decoder. Passing this guard alone is not
 * adoption authority: the decoder must first recompute every V2.2 binding.
 */
export function assertHookemonAdoptionByteExactReencodingV22(
  input: HookemonAdoptionReencodingCheckV22,
): void {
  if (
    !/^0x(?:[0-9a-f]{2})+$/u.test(input.calldata)
    || !/^0x[0-9a-f]{8}$/u.test(input.expectedSelector)
    || !/^0x[0-9a-f]{64}$/u.test(input.expectedCalldataHash)
    || !input.calldata.startsWith(input.expectedSelector)
    || keccak256(input.calldata) !== input.expectedCalldataHash
    || input.reencodedCalldata !== input.calldata
  ) {
    throw new TypeError(
      "Hookemon V2.2 adoption calldata is not a byte-exact deterministic re-encoding",
    );
  }
}

/**
 * This is the only browser entry point for adoption calldata. It deliberately
 * cannot succeed until the exact frozen V2.2 ABI and hash formulas replace
 * this stub with a decoder, full recomputation and byte-exact re-encoding.
 */
export function verifyHookemonAdoptionCalldataV22(
  input: HookemonAdoptionCalldataEnvelopeV22,
): never {
  void input;
  throw new TypeError("Hookemon V2.2 adoption decoder is unavailable");
}
