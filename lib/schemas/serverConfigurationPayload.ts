import { z } from "zod";

export const ServerConfigurationPayloadSchema = z.object({
  version: z.string(),
  type: z.enum(["VANILLA", "FABRIC", "FORGE", "SPIGOT", "PAPER"]),
  spawn_protection: z.string().default("16"),
  seed: z.string().max(32).default(""),
  hardcore: z.enum(["true", "false"]).default("false"),
  allow_flight: z.enum(["TRUE", "FALSE"]).default("FALSE"),
  allow_nether: z.enum(["true", "false"]).default("true"),
  spawn_monsters: z.enum(["true", "false"]).default("true"),
  online_mode: z.enum(["true", "false"]).default("true"),
  generate_structures: z.enum(["true", "false"]).default("true"),
  level_type: z.enum(["minecraft:normal", "minecraft:flat", "minecraft:large_biomes", "minecraft:amplified"])
    .default("minecraft:normal"),
  network_compression_threshold: z.string().default("256"),
  simulation_distance: z.string().default("4"),
  difficulty: z.enum(["peaceful", "easy", "normal", "hard"]).default("easy"),
  mode: z.enum(["creative", "survival", "adventure"]).default("creative"),
  spawn_animals: z.enum(["true", "false"]).default("true"),
  view_distance: z.string().default("8"),
  max_players: z.string().default("20"),
  sync_chunk_writes: z.enum(["true", "false"]).default("true"),
  spawn_npcs: z.enum(["true", "false"]).default("true"),
}).strict();

export type ServerConfigurationPayload = z.infer<typeof ServerConfigurationPayloadSchema>;