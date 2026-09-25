import { z } from "zod";

const roleEnum = z.enum(["SUPER_ADMIN", "ADMIN", "MANAGER", "EMPLOYEE"]);

export const inviteUserSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  role: roleEnum,
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/** Same 8-character minimum as changePasswordSchema/resetPasswordSchema — one password policy, not a second one. */
export const acceptInvitationSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
