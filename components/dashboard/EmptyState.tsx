import { LucideIcon } from "lucide-react";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
      <div className="rounded-xl bg-slate-100 p-4">
        <Icon size={28} className="text-[#2F4156]" />
      </div>

      <h3 className="mt-4 text-lg font-semibold text-slate-800">{title}</h3>

      {description && (
        <p className="mt-2 max-w-sm text-sm text-slate-500">{description}</p>
      )}

      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
