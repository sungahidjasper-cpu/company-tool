import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--background)] px-6 text-center">
      <div className="rounded-xl bg-slate-100 p-4">
        <Compass size={28} className="text-[#2F4156]" />
      </div>

      <h1 className="text-2xl font-bold text-slate-800">Page not found</h1>

      <p className="max-w-sm text-sm text-slate-500">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>

      <Link
        href="/dashboard"
        className="mt-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--primary)]/90"
      >
        Return to dashboard
      </Link>
    </div>
  );
}
