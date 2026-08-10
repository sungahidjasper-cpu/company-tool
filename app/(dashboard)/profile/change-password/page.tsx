import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ChangePasswordForm from "@/features/profile/components/ChangePasswordForm";
import { requireUser } from "@/lib/auth";

export default async function ChangePasswordPage() {
  await requireUser();

  return (
    <PageContainer>
      <DashboardHeader
        title="Change password"
        description="You'll be signed out and asked to log in again after changing it."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Update password</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
