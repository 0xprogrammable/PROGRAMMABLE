import { developerDocsMarkdown } from "@/lib/developer-docs-content";

export function GET() {
  return new Response(developerDocsMarkdown, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
