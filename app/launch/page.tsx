import type { Metadata } from "next";
import { LaunchBuilder } from "@/components/launch-builder";

export const metadata: Metadata = {
  title: "Launch",
  description:
    "Launch a token with liquidity and Uniswap v4 behavior",
};

export default function LaunchPage() {
  return <LaunchBuilder />;
}
