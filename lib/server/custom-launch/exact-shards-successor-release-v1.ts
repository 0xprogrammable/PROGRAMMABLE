import "server-only";

import descriptorJson from
  "../../../indexer/releases/exact-shards-successor-mainnet-v1.json";
import {
  createExactShardsSuccessorPublicReadHandlersV1,
  parseExactShardsSuccessorDescriptorV1,
  type ExactShardsSuccessorPublicReadStoreV1,
} from "./exact-shards-successor-projection-v1";

/**
 * Checked-in release input only. It intentionally contains no environment
 * fallback and no legacy CustomRegistryV1 address. Until a reviewed release
 * replaces the unconfigured sentinel with exact deployment bindings, every
 * public read remains 503 and no provider is contacted.
 */
export const exactShardsSuccessorMainnetDescriptorV1 =
  parseExactShardsSuccessorDescriptorV1(descriptorJson);

export function createReleasedExactShardsSuccessorPublicReadHandlersV1(
  store: ExactShardsSuccessorPublicReadStoreV1,
) {
  return createExactShardsSuccessorPublicReadHandlersV1({
    descriptor: exactShardsSuccessorMainnetDescriptorV1,
    // Freeze invariant: binding deployment evidence does not publish it.
    publicationAuthorized: false,
    store,
  });
}
