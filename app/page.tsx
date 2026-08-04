import type { Metadata } from "next";

import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
  title: "Programmable — Launch what you imagine",
  description: "Launch what you imagine on Ethereum with Programmable.",
};

export default function HomePage() {
  return <LandingPage />;
}
