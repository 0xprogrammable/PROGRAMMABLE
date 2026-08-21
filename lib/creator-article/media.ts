import { getAddress, isAddress } from "viem";

import { PROGRAMMABLE_TOKEN_IMAGE_HOST } from "../token-image";

export type CreatorArticleMediaKindV1 = "banner" | "inline";

type CreatorArticleMediaBindingV1 = Readonly<{
  kind: CreatorArticleMediaKindV1;
  width: number;
  height: number;
}>;

const MAIN_TOKEN = "0x7987f03462200b3d8a072e02c89a8a41dcb124ee";
const MEDIA_PREFIX = "/creator-article-media/v1/eip155-1/";
const MEDIA_FILENAME = /^(?<id>[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(?<kind>banner|inline)\.(?<width>[1-9][0-9]{0,3})x(?<height>[1-9][0-9]{0,3})\.(?<digest>[0-9a-f]{64})\.webp$/u;

const OFFICIAL_MAIN_MEDIA = new Map<string, CreatorArticleMediaBindingV1>([
  [
    "/brand/programmable-final-x-banner-1500x500.png",
    Object.freeze({ kind: "banner", width: 1500, height: 500 }),
  ],
  [
    "/brand/programmable-adaptive-model-post-v1-2000x1000.png",
    Object.freeze({ kind: "inline", width: 2000, height: 1000 }),
  ],
]);

export function creatorArticleMediaPathnameV1(input: Readonly<{
  tokenAddress: string;
  mediaId: string;
  kind: CreatorArticleMediaKindV1;
  width: number;
  height: number;
  contentSha256: `sha256:${string}`;
}>) {
  if (!isAddress(input.tokenAddress)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(input.mediaId)
    || !Number.isSafeInteger(input.width) || input.width <= 0 || input.width > 6_000
    || !Number.isSafeInteger(input.height) || input.height <= 0 || input.height > 6_000
    || !/^sha256:[0-9a-f]{64}$/u.test(input.contentSha256)) {
    throw new TypeError("Creator article media binding is invalid");
  }
  return `creator-article-media/v1/eip155-1/${getAddress(input.tokenAddress).toLowerCase()}/${input.mediaId}.${input.kind}.${input.width}x${input.height}.${input.contentSha256.slice("sha256:".length)}.webp`;
}

export function assertCreatorArticleMediaBindingV1(input: Readonly<{
  url: string;
  tokenAddress: string;
  kind: CreatorArticleMediaKindV1;
  width: number;
  height: number;
}>) {
  if (!isAddress(input.tokenAddress)) {
    throw new TypeError("Article image identity is invalid");
  }
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new TypeError("Article image URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || url.search || url.hash) {
    throw new TypeError("Article image URL is invalid");
  }

  const tokenAddress = getAddress(input.tokenAddress).toLowerCase();
  if (tokenAddress === MAIN_TOKEN && url.hostname === "programmable.market") {
    const official = OFFICIAL_MAIN_MEDIA.get(url.pathname);
    if (official?.kind === input.kind
      && official.width === input.width
      && official.height === input.height) return;
    throw new TypeError("Article image is not an owned Main-token asset");
  }

  if (url.hostname !== PROGRAMMABLE_TOKEN_IMAGE_HOST) {
    throw new TypeError("Article image must use verified Programmable media");
  }
  const prefix = `${MEDIA_PREFIX}${tokenAddress}/`;
  if (!url.pathname.startsWith(prefix)) {
    throw new TypeError("Article image token binding is invalid");
  }
  const filename = url.pathname.slice(prefix.length);
  const match = MEDIA_FILENAME.exec(filename);
  if (!match?.groups
    || match.groups.kind !== input.kind
    || Number(match.groups.width) !== input.width
    || Number(match.groups.height) !== input.height) {
    throw new TypeError("Article image media binding is invalid");
  }
}
