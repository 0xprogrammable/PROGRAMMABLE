import type { Metadata } from "next";
import { LaunchBuilder } from "@/components/launch-builder";

export const metadata: Metadata = {
  title: "Launch",
  description:
    "Define an asset, a liquidity path, and market behavior for Uniswap v4.",
};

export default function LaunchPage() {
  return <LaunchBuilder />;
}
