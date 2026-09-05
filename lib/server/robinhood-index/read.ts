import "server-only";
import { unstable_cache } from "next/cache";
import { launchList } from "./model";
import { indexStore } from "./store";

// A page reads the saved list only. Failures never fall through to an RPC.
const readSnapshot = unstable_cache(async () => (await indexStore().read())?.snapshot ?? null,
  ["robinhood-website-index-v1"], { revalidate: 15 });

export async function readRobinhoodLaunches(page = 1, query = "") {
  try { return launchList(await readSnapshot(), page, query); }
  catch { return launchList(null, page, query); }
}

export async function readRobinhoodToken(address: string) {
  try {
    const snapshot = await readSnapshot();
    return {
      status: launchList(snapshot).status,
      updatedAt: snapshot?.updatedAt ?? null,
      token: snapshot?.items.find((row) => row.tokenAddress.toLowerCase() === address.toLowerCase()) ?? null,
    };
  } catch { return { status: "unavailable" as const, updatedAt: null, token: null }; }
}
