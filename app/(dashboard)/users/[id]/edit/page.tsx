import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import UserForm from "@/features/users/components/UserForm";
import { getUserById } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, assertPermission, Permissions } from "@/lib/authorization";

type EditUserPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditUserPage({ params }: EditUserPageProps) {
  const { id } = await params;
  const actor = await requireUser();
  assertPermission(actor, Permissions.manageUsers);

  const targetUser = await getUserById(id);
  if (!targetUser) {
    notFound();
  }

  assertCompanyAccess(actor, targetUser.companyId);

  return (
    <PageContainer>
      <DashboardHeader
        title={`Edit ${targetUser.firstName} ${targetUser.lastName}`}
        description="Update this user's profile and role."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>User details</CardTitle>
        </CardHeader>
        <CardContent>
          <UserForm
            user={targetUser}
            canGrantSuperAdmin={actor.role === "SUPER_ADMIN"}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
