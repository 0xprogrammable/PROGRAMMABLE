import { parseSnapshot, type RobinhoodSnapshot } from "./model";

const PATH = "website-index/robinhood/launches-v1.json";
const MAX_BYTES = 16 * 1024 * 1024;

export type IndexStore = {
  read(): Promise<{ snapshot: RobinhoodSnapshot; etag: string } | null>;
  write(snapshot: RobinhoodSnapshot, etag: string | null): Promise<void>;
};

export function indexStore(): IndexStore {
  const token = process.env.OPS_BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new Error("Robinhood index storage is not configured");
  return {
    async read() {
      const { get, head } = await import("@vercel/blob");
      const result = await get(PATH, { access: "private", token, useCache: false });
      if (!result) return null;
      if (result.statusCode !== 200 || !result.stream) throw new Error("Robinhood index read failed");
      const metadata = await head(PATH, { token });
      const etag = result.blob.etag.trim().replace(/^W\//, "");
      if (!/^"[\da-f]{32}"$/i.test(etag) || metadata.etag !== etag || metadata.size > MAX_BYTES) {
        await result.stream.cancel();
        throw new Error("Robinhood index changed during read");
      }
      const reader = result.stream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) throw new Error("Robinhood index size exceeded");
          chunks.push(value);
        }
      } catch (error) {
        await reader.cancel();
        throw error;
      } finally {
        reader.releaseLock();
      }
      if (size !== metadata.size) throw new Error("Robinhood index size mismatch");
      return { snapshot: parseSnapshot(JSON.parse(Buffer.concat(chunks).toString("utf8"))), etag };
    },
    async write(snapshot, etag) {
      parseSnapshot(snapshot);
      const body = JSON.stringify(snapshot);
      if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("Robinhood index size exceeded");
      const { put } = await import("@vercel/blob");
      await put(PATH, body, {
        token, access: "private", contentType: "application/json", addRandomSuffix: false,
        allowOverwrite: etag !== null, ...(etag === null ? {} : { ifMatch: etag }), cacheControlMaxAge: 60,
      });
    },
  };
}
