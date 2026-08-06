import { z } from "zod";

/**
 * Form inputs submit "" for a blank optional field, not undefined. These
 * normalize that back to undefined so it never gets written to the
 * database as an empty string. Shared across every module's schema.
 */
export const optionalString = () =>
  z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

export const optionalUrl = () =>
  z
    .string()
    .url("Enter a valid URL")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

export const optionalEmail = () =>
  z
    .string()
    .email("Enter a valid email address")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));
