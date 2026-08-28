import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

export type ClassicV4FinalizedLaunchAnchor = Readonly<{
  transactionHash: Hex;
  blockHash: Hex;
  blockNumber: number;
  inputHash: Hex;
  launchId: Hex;
  stampHash: Hex;
  permitDigest: Hex;
}>;

export type ClassicV4PublicReleaseBinding = Readonly<
  {
    chainId: 1;
    launcher: Address;
    manifestDigest: Hex;
    releaseStatus?: "indexer-activated" | "publicly-available";
    publicAvailable?: boolean;
  } & Partial<ClassicV4FinalizedLaunchAnchor>
>;

export type ClassicV4AnchoredPublicReleaseBinding =
  ClassicV4PublicReleaseBinding &
    ClassicV4FinalizedLaunchAnchor & {
      releaseStatus: "indexer-activated" | "publicly-available";
      publicAvailable: boolean;
    };

function nonzeroBytes32(value: unknown): value is Hex {
  return (
    typeof value === "string" &&
    isHex(value, { strict: true }) &&
    value.length === 66 &&
    BigInt(value) !== 0n
  );
}

export function isClassicV4AnchoredPublicReleaseBinding(
  binding: ClassicV4PublicReleaseBinding | null | undefined,
): binding is ClassicV4AnchoredPublicReleaseBinding {
  return Boolean(
    binding &&
    ((binding.releaseStatus === "indexer-activated" &&
      binding.publicAvailable === false) ||
      (binding.releaseStatus === "publicly-available" &&
        binding.publicAvailable === true)) &&
    binding.chainId === 1 &&
    isAddress(binding.launcher) &&
    getAddress(binding.launcher) !==
      "0x0000000000000000000000000000000000000000" &&
    nonzeroBytes32(binding.manifestDigest) &&
    nonzeroBytes32(binding.transactionHash) &&
    nonzeroBytes32(binding.blockHash) &&
    typeof binding.blockNumber === "number" &&
    Number.isSafeInteger(binding.blockNumber) &&
    binding.blockNumber > 0 &&
    nonzeroBytes32(binding.inputHash) &&
    nonzeroBytes32(binding.launchId) &&
    nonzeroBytes32(binding.stampHash) &&
    nonzeroBytes32(binding.permitDigest),
  );
}

export function isClassicV4PublicActionBinding(
  binding: ClassicV4PublicReleaseBinding | null | undefined,
): binding is ClassicV4PublicReleaseBinding & {
  releaseStatus: "publicly-available";
  publicAvailable: true;
} & ClassicV4FinalizedLaunchAnchor {
  return (
    isClassicV4AnchoredPublicReleaseBinding(binding) &&
    binding?.releaseStatus === "publicly-available" &&
    binding.publicAvailable === true
  );
}

/**
 * Browser-side trust root for Classic V4 launch transactions.
 *
 * This stays null in the base release. The digest-acknowledged Classic V4
 * indexer activation replaces only the marked block with the exact launcher
 * and finalized launch anchor of the resulting `indexer-activated` manifest.
 * Wallet actions remain closed until the separate public-availability
 * promotion updates the digest and sets both public-action state fields while
 * preserving that exact anchor.
 */
// CLASSIC_V4_PUBLIC_RELEASE_BINDING_START
export const CLASSIC_V4_PUBLIC_RELEASE_BINDING: ClassicV4PublicReleaseBinding | null =
  null;
// CLASSIC_V4_PUBLIC_RELEASE_BINDING_END
