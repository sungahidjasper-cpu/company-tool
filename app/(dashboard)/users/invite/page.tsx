import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import InviteUserForm from "@/features/users/components/InviteUserForm";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

export default async function InviteUserPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageUsers);

  return (
    <PageContainer>
      <DashboardHeader
        title="Invite user"
        description="Send an invitation to a new teammate."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Invitation details</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteUserForm canGrantSuperAdmin={user.role === "SUPER_ADMIN"} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
