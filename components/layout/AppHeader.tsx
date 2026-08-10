import Link from "next/link";

import SearchInput from "@/components/dashboard/SearchInput";
import LogoutButton from "@/features/auth/components/LogoutButton";
import NotificationBell from "@/features/notifications/components/NotificationBell";
import {
  getDueDateReminders,
  getNotifications,
  getUnreadCount,
} from "@/features/notifications/services/notification.service";
import { getCurrentUser } from "@/lib/auth";
import { formatEnumLabel } from "@/lib/utils";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default async function AppHeader() {
  const user = await getCurrentUser();

  const [notifications, dueDateReminders, unreadCount] = user
    ? await Promise.all([
        getNotifications(user.id),
        getDueDateReminders(user.id),
        getUnreadCount(user.id),
      ])
    : [[], [], 0];

  return (
    <header className="flex items-center justify-between gap-4 bg-[var(--primary)] text-white px-6 py-4 shadow-md">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="text-white hover:bg-white/10 hover:text-white" />

        <div className="hidden sm:block">
          <h1 className="text-xl font-bold">
            Cloud Compass OS
          </h1>

          <p className="text-sm text-[var(--accent)]">
            Company Management Platform
          </p>
        </div>
      </div>

      {user && (
        <div className="min-w-0 flex-1 max-w-md">
          <SearchInput
            action="/search"
            placeholder="Search companies, clients, projects..."
            buttonVariant="primary"
          />
        </div>
      )}

      {user && (
        <div className="flex items-center gap-2">
          <NotificationBell
            notifications={notifications}
            dueDateReminders={dueDateReminders}
            unreadCount={unreadCount}
          />

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-3 rounded-lg px-2 py-1 outline-none hover:bg-white/10">
              {user.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element -- user-supplied external avatar URL, not a static asset
                <img
                  src={user.avatar}
                  alt=""
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center font-bold">
                  {user.firstName[0]}
                </div>
              )}

              <div className="hidden text-left md:block">
                <p className="font-semibold">
                  {user.firstName} {user.lastName}
                </p>

                <p className="text-xs text-[var(--accent)]">
                  {formatEnumLabel(user.role)}
                </p>
              </div>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/profile" />}>
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                render={<Link href="/profile/change-password" />}
              >
                Change Password
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <LogoutButton />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </header>
  );
}
