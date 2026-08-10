import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ProfileForm from "@/features/profile/components/ProfileForm";
import { getUserById } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";

export default async function ProfilePage() {
  const actor = await requireUser();

  const user = await getUserById(actor.id);
  if (!user) {
    notFound();
  }

  return (
    <PageContainer>
      <DashboardHeader
        title="Profile"
        description="Update your personal information."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Your details</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm user={user} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
