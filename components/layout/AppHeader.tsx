import LogoutButton from "@/features/auth/components/LogoutButton";
import { getCurrentUser } from "@/lib/auth";
import { formatEnumLabel } from "@/lib/utils";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default async function AppHeader() {
  const user = await getCurrentUser();

  return (
    <header className="flex items-center justify-between bg-[var(--primary)] text-white px-6 py-4 shadow-md">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="text-white hover:bg-white/10 hover:text-white" />

        <div>
          <h1 className="text-xl font-bold">
            Cloud Compass OS
          </h1>

          <p className="text-sm text-[var(--accent)]">
            Company Management Platform
          </p>
        </div>
      </div>

      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-3 rounded-lg px-2 py-1 outline-none hover:bg-white/10">
            <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center font-bold">
              {user.firstName[0]}
            </div>

            <div className="text-left">
              <p className="font-semibold">
                {user.firstName} {user.lastName}
              </p>

              <p className="text-xs text-[var(--accent)]">
                {formatEnumLabel(user.role)}
              </p>
            </div>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <LogoutButton />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  );
}