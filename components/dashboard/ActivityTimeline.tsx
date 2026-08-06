import { formatEnumLabel } from "@/lib/utils";

type ActivityItem = {
  id: string;
  action: string;
  createdAt: Date;
  actor: { firstName: string; lastName: string } | null;
};

type ActivityTimelineProps = {
  activities: ActivityItem[];
};

function formatActionLabel(action: string) {
  return action
    .split(".")
    .map((part) => formatEnumLabel(part.toUpperCase()))
    .join(" — ");
}

export default function ActivityTimeline({ activities }: ActivityTimelineProps) {
  if (activities.length === 0) {
    return <p className="text-sm text-slate-500">No activity yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {activities.map((activity) => (
        <li
          key={activity.id}
          className="flex items-start justify-between gap-4 text-sm"
        >
          <div>
            <p className="font-medium">{formatActionLabel(activity.action)}</p>
            <p className="text-slate-500">
              {activity.actor
                ? `${activity.actor.firstName} ${activity.actor.lastName}`
                : "System"}
            </p>
          </div>
          <span className="whitespace-nowrap text-xs text-slate-400">
            {activity.createdAt.toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
