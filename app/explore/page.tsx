import type { Metadata } from "next";

import { ExploreView } from "@/components/explore-view";

export const metadata: Metadata = {
  title: "Programmable",
  description: "Explore tokens launched through Programmable.",
  alternates: {
    canonical: "/explore",
  },
};

export default function ExplorePage() {
  return <ExploreView />;
}
