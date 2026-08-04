import type { Metadata } from "next";

import { ExploreView } from "@/components/explore-view";

export const metadata: Metadata = {
  title: "Explore — Programmable",
  description: "Explore tokens launched through Programmable.",
};

export default function ExplorePage() {
  return <ExploreView />;
}
