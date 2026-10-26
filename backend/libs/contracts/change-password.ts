import { z } from "zod";

export const changePasswordRequestSchema = z
  .object({
    original_password: z.string().trim().min(1).optional(),
    password: z.string().min(1),
  })
  .strict();

export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
