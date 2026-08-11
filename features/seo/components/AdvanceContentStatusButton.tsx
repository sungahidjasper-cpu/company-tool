"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { advanceContentStatus } from "@/features/seo/actions/content.actions";
import { Button } from "@/components/ui/button";

type AdvanceContentStatusButtonProps = {
  contentId: string;
  nextStatusLabel: string;
};

export default function AdvanceContentStatusButton({
  contentId,
  nextStatusLabel,
}: AdvanceContentStatusButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const result = await advanceContentStatus(contentId);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(`Advanced to ${nextStatusLabel}`);
      router.refresh();
    });
  };

  return (
    <Button type="button" variant="outline" disabled={isPending} onClick={handleClick}>
      {isPending ? "Advancing..." : `Advance to ${nextStatusLabel}`}
    </Button>
  );
}
