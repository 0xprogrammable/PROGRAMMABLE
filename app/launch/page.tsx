import type { Metadata } from "next";

import { LaunchExperience } from "@/components/launch-entry";

export const metadata: Metadata = {
  title: "Programmable",
  description:
    "Create a Classic token, review Custom Hooks, or preview upcoming partner launch models.",
  alternates: {
    canonical: "/launch",
  },
};

export default function LaunchPage() {
  return <LaunchExperience />;
}
