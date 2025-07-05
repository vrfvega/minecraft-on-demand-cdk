import { z } from "zod";

export const serverPayload = z.object({
  userId: z.string().uuid(),
  version: z.string().min(2).max(100),
  type: z.string().min(2).max(500),
});

export const serverPayloadEntrySchema = serverPayload.transform(
  (payload: any) => ({
    detail: {
      user_id: payload.userId,
      version: payload.version,
      type: payload.type,
    },
  }),
);
