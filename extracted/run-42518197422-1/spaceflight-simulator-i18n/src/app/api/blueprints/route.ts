import { db } from "@/db";
import { blueprints } from "@/db/schema";
import { blueprintStats } from "@/game/flight/vessel";
import { parseBlueprint } from "@/game/vab/blueprint";
import { MsgError } from "@/i18n/game";
import { desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db
      .select({
        id: blueprints.id,
        name: blueprints.name,
        partCount: blueprints.partCount,
        massKg: blueprints.massKg,
        deltaV: blueprints.deltaV,
        updatedAt: blueprints.updatedAt,
      })
      .from(blueprints)
      .orderBy(desc(blueprints.updatedAt));
    return Response.json({ blueprints: rows });
  } catch {
    return Response.json({ error: "Failed to load blueprints" }, { status: 500 });
  }
}

/** Save (upsert by name). Body: a Blueprint JSON document. */
export async function POST(req: Request) {
  try {
    const body = await req.text();
    if (body.length > 200_000) return Response.json({ error: "Blueprint too large" }, { status: 413 });
    const bp = parseBlueprint(body);
    const stats = blueprintStats(bp);
    const values = {
      name: bp.name,
      data: bp,
      partCount: bp.parts.length,
      massKg: stats?.mass ?? 0,
      deltaV: stats?.dv.total ?? 0,
    };
    const [row] = await db
      .insert(blueprints)
      .values(values)
      .onConflictDoUpdate({ target: blueprints.name, set: { ...values, updatedAt: sql`now()` } })
      .returning({ id: blueprints.id, name: blueprints.name });
    return Response.json({ ok: true, blueprint: row });
  } catch (e) {
    if (e instanceof MsgError) return Response.json({ error: e.message, errorKey: e.msg.k, errorParams: e.msg.p }, { status: 400 });
    const msg = e instanceof Error ? e.message : "Invalid blueprint";
    return Response.json({ error: msg }, { status: 400 });
  }
}
