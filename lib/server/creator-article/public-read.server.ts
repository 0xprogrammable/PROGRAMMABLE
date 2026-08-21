import "server-only";

import { isAddress, getAddress } from "viem";

import type { CreatorArticleV1 } from "../../creator-article/contract-v1";
import { createProductionCreatorArticleStoreV1 } from "./storage.server";

const PUBLIC_ARTICLE_READ_BUDGET_MS = 650;

export async function readPublicCreatorArticleV1(
  tokenAddress: string,
): Promise<CreatorArticleV1 | null> {
  if (!isAddress(tokenAddress)) return null;
  try {
    const read = createProductionCreatorArticleStoreV1().readCurrent({
      chainId: 1,
      tokenAddress: getAddress(tokenAddress),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), PUBLIC_ARTICLE_READ_BUDGET_MS);
    });
    try {
      return (await Promise.race([read, timeout]))?.article ?? null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
