"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/features/notifications/actions/notification.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NotificationItem = {
  id: string;
  message: string;
  link: string | null;
  createdAt: Date;
  isRead: boolean;
  isVirtual?: boolean;
};

type NotificationBellProps = {
  notifications: NotificationItem[];
  dueDateReminders: NotificationItem[];
  unreadCount: number;
};

export default function NotificationBell({
  notifications,
  dueDateReminders,
  unreadCount,
}: NotificationBellProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const items = [...dueDateReminders, ...notifications];
  const totalUnread = unreadCount + dueDateReminders.length;

  const handleItemClick = (item: NotificationItem) => {
    if (item.isVirtual || item.isRead) return;

    startTransition(async () => {
      const result = await markNotificationRead(item.id);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      router.refresh();
    });
  };

  const handleMarkAll = () => {
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative flex h-8 w-8 items-center justify-center rounded-lg text-white hover:bg-white/10">
        <Bell size={18} />
        {totalUnread > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px]"
          >
            {totalUnread > 9 ? "9+" : totalUnread}
          </Badge>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between gap-2 px-1.5 py-1">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isPending}
            onClick={handleMarkAll}
          >
            Mark all read
          </Button>
        </div>
        <DropdownMenuSeparator />

        {items.length === 0 && (
          <p className="px-1.5 py-3 text-center text-sm text-slate-500">
            You&apos;re all caught up.
          </p>
        )}

        {items.map((item) =>
          item.link ? (
            <DropdownMenuItem
              key={item.id}
              onClick={() => handleItemClick(item)}
              render={<Link href={item.link} />}
            >
              <NotificationRow item={item} />
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={item.id}
              onClick={() => handleItemClick(item)}
            >
              <NotificationRow item={item} />
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({ item }: { item: NotificationItem }) {
  return (
    <div className="flex flex-col gap-0.5 py-0.5 text-sm">
      <p className={item.isRead ? "text-slate-500" : "font-medium"}>
        {item.message}
      </p>
      <p className="text-xs text-slate-400">{item.createdAt.toLocaleString()}</p>
    </div>
  );
}
