import type { Metadata } from "next";

import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
  title: "Programmable",
  description: "Tokens that behave how you imagine.",
};

export default function HomePage() {
  return <LandingPage />;
}
