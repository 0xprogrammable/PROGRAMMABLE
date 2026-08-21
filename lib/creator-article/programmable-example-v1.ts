import example from "../../config/creator-article-programmable-example.v1.json";

import {
  parseCreatorArticleDraftV1,
  type CreatorArticleDraftV1,
} from "./contract-v1";

export const PROGRAMMABLE_MAIN_TOKEN_ADDRESS =
  "0x7987f03462200b3D8A072E02C89A8A41dCB124EE" as const;

export function programmableCreatorArticleExampleV1(): CreatorArticleDraftV1 {
  const parsed = parseCreatorArticleDraftV1(example);
  if (parsed.tokenAddress !== PROGRAMMABLE_MAIN_TOKEN_ADDRESS) {
    throw new TypeError("Programmable example identity is invalid");
  }
  return parsed;
}
