import type { Metadata } from "next";
import { ProfileView } from "@/components/profile-view";

export const metadata: Metadata = {
  title: "Profile",
  description:
    "View Launcher tokens, positions and claims for one wallet",
};

export default function ProfilePage() {
  return <ProfileView />;
}
