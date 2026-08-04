import type { Metadata } from "next";

import { LaunchExperience } from "@/components/launch-entry";

export const metadata: Metadata = {
  title: "Create · Programmable",
  description:
    "Create a fixed-supply token with locked Uniswap v4 liquidity, or review the Custom Hook framework.",
  alternates: {
    canonical: "/launch",
  },
};

export default function LaunchPage() {
  return <LaunchExperience />;
}
