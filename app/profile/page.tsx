import type { Metadata } from "next";
import { ProfileView } from "@/components/profile-view";

export const metadata: Metadata = {
  title: "Profile",
  description:
    "Review Launcher launches, liquidity positions, and claims for a connected address.",
};

export default function ProfilePage() {
  return <ProfileView />;
}
