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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guards a route param before it reaches a `where: { id }` lookup — Postgres throws on a malformed uuid cast rather than returning zero rows. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
