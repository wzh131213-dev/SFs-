import { integer, jsonb, pgTable, serial, text, timestamp, real } from "drizzle-orm/pg-core";

/** Rocket blueprints saved from the VAB (JSON-serialised Blueprint documents). */
export const blueprints = pgTable("blueprints", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  data: jsonb("data").notNull(),
  partCount: integer("part_count").notNull().default(0),
  massKg: real("mass_kg").notNull().default(0),
  deltaV: real("delta_v").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
