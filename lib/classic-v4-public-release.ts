import {
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

export type ClassicV4PublicReleaseBinding = Readonly<{
  chainId: 1;
  launcher: Address;
  manifestDigest: Hex;
  releaseStatus?: "indexer-activated" | "publicly-available";
  publicAvailable?: boolean;
}>;

export function isClassicV4PublicActionBinding(
  binding: ClassicV4PublicReleaseBinding | null | undefined,
): binding is ClassicV4PublicReleaseBinding & {
  releaseStatus: "publicly-available";
  publicAvailable: true;
} {
  return (
    binding?.releaseStatus === "publicly-available" &&
    binding.publicAvailable === true &&
    binding.chainId === 1 &&
    isAddress(binding.launcher) &&
    getAddress(binding.launcher) !==
      "0x0000000000000000000000000000000000000000" &&
    isHex(binding.manifestDigest, { strict: true }) &&
    binding.manifestDigest.length === 66 &&
    BigInt(binding.manifestDigest) !== 0n
  );
}

/**
 * Browser-side trust root for Classic V4 launch transactions.
 *
 * This stays null in the base release. The digest-acknowledged Classic V4
 * indexer activation replaces only the marked block with the exact launcher
 * and digest of the resulting `indexer-activated` manifest. That catalog
 * binding deliberately omits the public-action fields above; wallet actions
 * remain closed until the separate public-availability promotion sets both.
 */
// CLASSIC_V4_PUBLIC_RELEASE_BINDING_START
export const CLASSIC_V4_PUBLIC_RELEASE_BINDING:
  | ClassicV4PublicReleaseBinding
  | null = null;
// CLASSIC_V4_PUBLIC_RELEASE_BINDING_END
