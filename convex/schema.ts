import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

// One table: a shared session lets two clients (two people on the same laptop/room) see the
// same slider state. No auth, no user table — per CONTRACT.md.
export default defineSchema({
  sessions: defineTable({
    module: v.union(v.literal("light"), v.literal("projectiles"), v.literal("fields")),
    params: v.record(v.string(), v.number()),
    createdAt: v.number(),
  }),
})
