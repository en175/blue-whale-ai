import { serviceNames } from "@blue-whale/core";
import { z } from "zod";

export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  service: z.enum(serviceNames),
  dependencies: z.array(
    z.object({
      name: z.string().min(1),
      status: z.enum(["ready", "not_ready"]),
    }),
  ),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
