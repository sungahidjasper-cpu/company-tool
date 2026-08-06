"use server";

import { loginSchema, type LoginInput } from "@/features/auth/schemas/login.schema";
import { verifyCredentials } from "@/lib/auth";

export type LoginActionResult =
  | { success: true }
  | { success: false; message: string };

export async function loginAction(
  input: LoginInput
): Promise<LoginActionResult> {
  const parsed = loginSchema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);

  if (!user) {
    return { success: false, message: "Invalid email or password" };
  }

  return { success: true };
}
