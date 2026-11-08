import { db } from "@/db";
import { blueprints } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n)) return Response.json({ error: "Bad id" }, { status: 400 });
  const [row] = await db.select().from(blueprints).where(eq(blueprints.id, n));
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ blueprint: row.data });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n)) return Response.json({ error: "Bad id" }, { status: 400 });
  await db.delete(blueprints).where(eq(blueprints.id, n));
  return Response.json({ ok: true });
}
