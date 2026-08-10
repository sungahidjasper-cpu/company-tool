"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

export default function LogoutButton() {
  const handleClick = () => {
    if (window.confirm("Log out of Cloud Compass OS?")) {
      signOut({ callbackUrl: "/login" });
    }
  };

  return (
    <DropdownMenuItem onClick={handleClick} variant="destructive">
      <LogOut size={16} />
      Log out
    </DropdownMenuItem>
  );
}
