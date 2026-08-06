import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import UserForm from "@/features/users/components/UserForm";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

export default async function NewUserPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageUsers);

  return (
    <PageContainer>
      <DashboardHeader
        title="New user"
        description="Add a new teammate to your workspace."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>User details</CardTitle>
        </CardHeader>
        <CardContent>
          <UserForm canGrantSuperAdmin={user.role === "SUPER_ADMIN"} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
