import { buildProgrammableLlmsFullFallback } from
  "@/lib/developer-docs-content";
import { resolveCustomRegistryPublicManifestV1 } from
  "@/lib/server/custom-launch/registry-manifest-v1";

const canonicalFullContext =
  "https://developers.programmable.family/llms-full.txt";

export const revalidate = 300;

export async function GET() {
  let content = buildProgrammableLlmsFullFallback(
    resolveCustomRegistryPublicManifestV1(),
  );

  try {
    const response = await fetch(canonicalFullContext, {
      headers: { Accept: "text/plain" },
      next: { revalidate: 300 },
    });
    if (response.ok) content = await response.text();
  } catch {
    // The local fallback keeps the agent entry point available during an
    // upstream documentation outage.
  }

  return new Response(content, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
