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
export const CLASSIC_V4_PUBLIC_RELEASE_BINDING:
  | ClassicV4PublicReleaseBinding
  | null = Object.freeze({
  chainId: 1,
  launcher: "0xBBDF30a2fE1394e4AA864aC269C6cF09b518E699",
  manifestDigest: "0x7b50b4b98bbdc86f4b0b9d28d80fec8c21942d951920469c206425651ca2daf8",
  releaseStatus: "publicly-available",
  publicAvailable: true,
  transactionHash: "0xbb6b4c9fc70600e4d5dd394314a49630bf9f837a82065013c397ebebd978aa7c",
  blockHash: "0x66d7201c8274251f7e94960edad2570e9121f7a0209f4528c09c41c5ea9cdb7c",
  blockNumber: 25_854_486,
  inputHash: "0xeb0f441e72f5c1dbcb99a46bae5fdeeac1de5d8b474aed9002b36b4d9199a3a3",
  launchId: "0x75503436c39192ea7f165d1c0140724fed5dbd73c9b4816de713e34fe5a3fc87",
  stampHash: "0xd173468420cfa5159890896d34746c9c2fc9bb5e3960a1062aa82d1c3ffb5941",
  permitDigest: "0xfe2e718590739692dfe500000a18d62c07cb11d44cf5035febb12cac6c4466df",
});
// CLASSIC_V4_PUBLIC_RELEASE_BINDING_END
