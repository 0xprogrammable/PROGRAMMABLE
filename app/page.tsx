import type { Metadata } from "next";

import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
  title: "Programmable — Launch what you imagine",
  description:
    "Choose a launch model and make it yours on Ethereum with Programmable.",
};

export default function HomePage() {
  return <LandingPage />;
}
