const launchPreviewUrl =
  "https://developers.programmable.family/api/v1/launches?limit=1";

export const revalidate = 5;

export async function GET() {
  try {
    const response = await fetch(launchPreviewUrl, {
      headers: { Accept: "application/json" },
      next: { revalidate: 5 },
    });
    const body = await response.text();

    return new Response(body, {
      headers: {
        "Cache-Control": "public, max-age=5, stale-while-revalidate=30",
        "Content-Type": "application/json; charset=utf-8",
      },
      status: response.status,
    });
  } catch {
    return Response.json(
      {
        detail: "The public developer feed is temporarily unavailable.",
        status: 502,
        title: "Developer feed unavailable",
        type: "about:blank",
      },
      { status: 502 },
    );
  }
}
