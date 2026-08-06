"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

export default function LogoutButton() {
  return (
    <DropdownMenuItem
      onClick={() => signOut({ callbackUrl: "/login" })}
      variant="destructive"
    >
      <LogOut size={16} />
      Log out
    </DropdownMenuItem>
  );
}
