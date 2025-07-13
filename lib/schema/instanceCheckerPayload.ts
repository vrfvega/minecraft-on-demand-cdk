import { z } from "zod";

export const InstanceCheckerEventSchema = z.object({
  clusterName: z.string().min(1, "clusterName is required"),
  ec2InstanceId: z.string().min(1, "ec2InstanceId is required")
});

export const InstanceCheckerResponseSchema = z.object({
  instanceIsReady: z.boolean(),
  containerInstanceArn: z.string().nullable()
});

export type InstanceCheckerEvent = z.infer<typeof InstanceCheckerEventSchema>;
export type InstanceCheckerResponse = z.infer<typeof InstanceCheckerResponseSchema>