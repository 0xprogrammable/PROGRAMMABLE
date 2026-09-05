import type { Metadata } from "next";

import { RobinhoodLaunchesView } from "@/components/robinhood-launches-view";

export const metadata: Metadata = {
  title: "Explore launches · Programmable",
  description: "Find tokens launched through Programmable on Robinhood Chain.",
  alternates: {
    canonical: "/explore",
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function ExplorePage() {
  return <RobinhoodLaunchesView />;
}
