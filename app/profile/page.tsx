import { Suspense } from "react";

import {
  ProfileSessionLoadingState,
  ProfileView,
} from "@/components/profile-view";

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileSessionLoadingState />}>
      <ProfileView />
    </Suspense>
  );
}
