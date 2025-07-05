import { z } from "zod";

export const serverPayload = z.object({
  userId: z.string().min(10),
  version: z.string().min(2).max(100),
  type: z.string().min(2).max(500),
});

export const serverPayloadEntrySchema = serverPayload.transform(
  (payload: any) => ({
    user_id: payload.userId,
    version: payload.version,
    type: payload.type,
  }),
);
