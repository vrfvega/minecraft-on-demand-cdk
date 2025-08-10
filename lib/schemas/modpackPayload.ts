import { z } from "zod";

export const modPayloadSchema = z.object({
  projectId: z.string(),
  slug: z.string(),
  title: z.string(),
  addedAt: z.number(),
});

export type Mod = z.infer<typeof modPayloadSchema>;

export const postModpackPayloadSchema = z.object({
  modpackName: z.string(),
  mods: z.array(modPayloadSchema).default([]),
  type: z.string(),
  version: z.string(),
});

export type PostModpackPayload = z.infer<typeof postModpackPayloadSchema>;

export const putModpackPayloadSchema = z.object({
  modpackName: z.string(),
  mods: z.array(modPayloadSchema).default([]),
  type: z.string(),
  version: z.string(),
});

export type PutModpackPayload = z.infer<typeof putModpackPayloadSchema>;

export const modpackSchema = z.object({
  modpackId: z.string(),
  modpackName: z.string(),
  createdAt: z.number(),
  mods: z.array(modPayloadSchema),
  type: z.string(),
  updatedAt: z.number(),
  userId: z.string(),
  version: z.string(),
});

export type Modpack = z.infer<typeof modpackSchema>;

export const simplifiedmodpackPayloadSchema = z.object({
  modpackId: z.string(),
  modpackName: z.string(),
  createdAt: z.number(),
  mods: z.number(),
  type: z.string(),
  updatedAt: z.number(),
  userId: z.string().optional(),
  version: z.string(),
});

export type SimplifiedModpack = z.infer<typeof simplifiedmodpackPayloadSchema>;