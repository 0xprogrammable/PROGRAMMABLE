import { buildProgrammableLlmsIndex } from "@/lib/developer-docs-content";
import { resolveCustomRegistryPublicManifestV1 } from
  "@/lib/server/custom-launch/registry-manifest-v1";

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(
    buildProgrammableLlmsIndex(resolveCustomRegistryPublicManifestV1()),
    {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Content-Type": "text/plain; charset=utf-8",
    },
    },
  );
}
