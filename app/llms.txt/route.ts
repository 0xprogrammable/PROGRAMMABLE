import { programmableLlmsIndex } from "@/lib/developer-docs-content";

export function GET() {
  return new Response(programmableLlmsIndex, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
