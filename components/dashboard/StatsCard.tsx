import { LucideIcon } from "lucide-react";

type StatsCardProps = {
  title: string;
  value: string | number;
  change?: string;
  icon: LucideIcon;
};

export default function StatsCard({
  title,
  value,
  change,
  icon: Icon,
}: StatsCardProps) {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500">
            {title}
          </p>

          <h2 className="mt-2 text-3xl font-bold text-slate-800">
            {value}
          </h2>

          {change && (
            <p className="mt-3 text-sm text-green-600 font-medium">
              {change}
            </p>
          )}
        </div>

        <div className="rounded-xl bg-slate-100 p-3">
          <Icon
            size={24}
            className="text-[#2F4156]"
          />
        </div>
      </div>
    </div>
  );
}