import type { Metadata } from "next";

import { ExploreIndexResetView } from "@/components/explore-index-reset-view";

export const metadata: Metadata = {
  title: "Explore launches · Programmable",
  description: "Programmable launch indexing is being rebuilt.",
  alternates: {
    canonical: "/explore",
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function ExplorePage() {
  return <ExploreIndexResetView />;
}
