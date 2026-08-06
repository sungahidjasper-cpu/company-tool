import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PaginationProps = {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
};

export default function Pagination({
  page,
  totalPages,
  buildHref,
}: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <div className="flex items-center justify-between border-t border-slate-200 pt-4">
      <p className="text-sm text-slate-500">
        Page {page} of {totalPages}
      </p>

      <div className="flex gap-2">
        <Link
          href={buildHref(page - 1)}
          aria-disabled={prevDisabled}
          tabIndex={prevDisabled ? -1 : undefined}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            prevDisabled && "pointer-events-none opacity-50"
          )}
        >
          Previous
        </Link>

        <Link
          href={buildHref(page + 1)}
          aria-disabled={nextDisabled}
          tabIndex={nextDisabled ? -1 : undefined}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            nextDisabled && "pointer-events-none opacity-50"
          )}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
