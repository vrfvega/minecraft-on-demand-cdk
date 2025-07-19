import { z } from "zod";

export const serverPayload = z.object({
  userId: z.string(),
  version: z.string().min(2).max(100),
  type: z.string().min(2).max(500),
});

export type ServerPayload = z.infer<typeof serverPayload>;

export const serverPayloadEntrySchema = serverPayload.transform(
  (payload: ServerPayload) => ({
    userId: payload.userId,
    version: payload.version,
    type: payload.type,
  }),
);
