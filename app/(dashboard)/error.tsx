"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Button } from "@/components/ui/button";

export default function DashboardGroupError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageContainer>
      <EmptyState
        icon={AlertTriangle}
        title="Something went wrong"
        description={
          error.message ||
          "An unexpected error occurred while loading this page."
        }
        action={<Button onClick={() => retry()}>Try again</Button>}
      />
    </PageContainer>
  );
}
