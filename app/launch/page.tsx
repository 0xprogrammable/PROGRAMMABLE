import type { Metadata } from "next";

import { LaunchExperience } from "@/components/launch-entry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create a launch · Programmable",
  description:
    "Choose Classic for a guided token launch or use the Custom Launch API for a custom Uniswap v4 hook.",
  alternates: {
    canonical: "/launch",
  },
};

export default function LaunchPage() {
  return <LaunchExperience />;
}
