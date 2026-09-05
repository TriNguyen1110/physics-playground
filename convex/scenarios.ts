import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"

// createSession(module) -> sessionId
export const createSession = mutation({
  args: {
    module: v.union(v.literal("light"), v.literal("projectiles"), v.literal("fields")),
  },
  handler: async (ctx, args) => {
    const sessionId: Id<"sessions"> = await ctx.db.insert("sessions", {
      module: args.module,
      params: {},
      createdAt: Date.now(),
    })
    return sessionId
  },
})

// setParams(sessionId, module, params) -> void
export const setParams = mutation({
  args: {
    sessionId: v.id("sessions"),
    module: v.union(v.literal("light"), v.literal("projectiles"), v.literal("fields")),
    params: v.record(v.string(), v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      module: args.module,
      params: args.params,
    })
  },
})

// getSession(sessionId) -> { module, params } | null
export const getSession = query({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId)
    if (!session) return null
    return { module: session.module, params: session.params }
  },
})
