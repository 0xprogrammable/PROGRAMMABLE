import type { Metadata } from "next";

import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
  title: "Programmable",
  description:
    "Create tokens with a clear launch model and programmable onchain behavior.",
};

export default function HomePage() {
  return <LandingPage />;
}
