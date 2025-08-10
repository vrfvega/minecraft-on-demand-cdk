import { z } from "zod";

export const ServerCheckerEventSchema = z.object({
  clusterName: z.string().min(1, "clusterName is required"),
  taskArn: z.string().min(1, "taskArn is required"),
});

export const ServerCheckerResponseSchema = z.object({
  isServerReady: z.boolean(),
  publicIp: z.string().nullable(),
});

export type ServerCheckerEvent = z.infer<typeof ServerCheckerEventSchema>;
export type ServerCheckerResponse = z.infer<typeof ServerCheckerResponseSchema>;
