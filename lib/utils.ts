import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatEnumLabel(value: string) {
  return value
    .split("_")
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(" ")
}
