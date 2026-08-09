import { buildDeveloperDocsMarkdown } from "@/lib/developer-docs-content";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildDeveloperDocsMarkdown(), {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
