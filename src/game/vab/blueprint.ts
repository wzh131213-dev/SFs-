// Blueprint (de)serialisation, validation, auto-staging and preset designs.

import type { Blueprint, PartInstance } from "../core/types";
import { getDef, isStageable, PARTS } from "../data/parts";
import { analyze, normalize, rectOf, rectsOverlap } from "./grid";
import { MsgError, msg, type Msg } from "../../i18n/game";

export function emptyBlueprint(name = "Untitled Rocket"): Blueprint {
  return { version: 1, name, parts: [] };
}

export function serializeBlueprint(bp: Blueprint): string {
  return JSON.stringify(bp, null, 2);
}

/** Parse + validate a blueprint JSON string. Throws a descriptive Error when invalid. */
export function parseBlueprint(json: string): Blueprint {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new MsgError(msg("bp.errNotJson"));
  }
  if (!raw || typeof raw !== "object") throw new MsgError(msg("bp.errNotObject"));
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.parts)) throw new MsgError(msg("bp.errNoArray"));
  const parts: PartInstance[] = [];
  const ids = new Set<number>();
  for (const item of o.parts) {
    const p = item as Record<string, unknown>;
    if (
      !p ||
      typeof p.id !== "number" ||
      typeof p.defId !== "string" ||
      !Number.isInteger(p.gx) ||
      !Number.isInteger(p.gy)
    ) {
      throw new MsgError(msg("bp.errMalformed"));
    }
    if (!PARTS[p.defId]) throw new MsgError(msg("bp.errUnknownPart", { id: p.defId }));
    if (ids.has(p.id)) throw new MsgError(msg("bp.errDupId", { id: p.id }));
    ids.add(p.id);
    parts.push({
      id: p.id,
      defId: p.defId,
      gx: p.gx as number,
      gy: p.gy as number,
      stage: typeof p.stage === "number" ? p.stage : -1,
    });
  }
  const bp: Blueprint = {
    version: 1,
    name: typeof o.name === "string" && o.name.trim() ? o.name.slice(0, 60) : "Imported Rocket",
    parts,
    manualStaging: !!o.manualStaging,
  };
  const issue = validateBlueprint(bp);
  if (issue) throw new MsgError(issue);
  return bp;
}

/** Returns a translatable description of the problem, or null if the blueprint is structurally sound. */
export function validateBlueprint(bp: Blueprint): Msg | null {
  if (bp.parts.length === 0) return msg("bp.noParts");
  const rects = bp.parts.map(rectOf);
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) if (rectsOverlap(rects[i], rects[j])) return msg("bp.overlap");
  const a = analyze(bp);
  if (a.reachable.size !== bp.parts.length) return msg("bp.detached");
  return null;
}

/**
 * Generate a sensible staging sequence.
 * Engines at the greatest "decoupler depth" ignite first; radial separators fire one stage after
 * their group's ignition; stack separators fire together with the next group; parachutes go last.
 */
export function autoStage(bp: Blueprint): Blueprint {
  const a = analyze(bp);
  const byId = new Map(bp.parts.map((p) => [p.id, p]));
  const depthOf = (id: number): number => {
    let d = 0;
    let cur = a.parent.get(id) ?? null;
    while (cur !== null) {
      const def = getDef(byId.get(cur)!.defId);
      if (def.separator && !def.radial) d++;
      cur = a.parent.get(cur) ?? null;
    }
    return d;
  };
  const depthSet = new Set<number>();
  const info = new Map<number, { depth: number; kind: "engine" | "stack" | "radial" | "chute" }>();
  for (const p of bp.parts) {
    const def = getDef(p.defId);
    if (def.engine) {
      const d = depthOf(p.id);
      info.set(p.id, { depth: d, kind: "engine" });
      depthSet.add(d);
    } else if (def.separator) {
      const d = depthOf(p.id);
      info.set(p.id, { depth: d, kind: def.radial ? "radial" : "stack" });
      depthSet.add(d);
    } else if (def.parachute) {
      info.set(p.id, { depth: 0, kind: "chute" });
    }
  }
  const depths = [...depthSet].sort((x, y) => y - x);
  const stageOf = new Map<number, number>();
  let counter = 0;
  const radialStage = new Map<number, number>();
  for (const d of depths) {
    stageOf.set(d, counter);
    const hasRadial = [...info.values()].some((i) => i.kind === "radial" && i.depth === d);
    if (hasRadial) {
      radialStage.set(d, counter + 1);
      counter += 2;
    } else counter += 1;
  }
  const chuteStage = counter;
  const parts = bp.parts.map((p) => {
    const i = info.get(p.id);
    if (!i) return { ...p, stage: -1 };
    if (i.kind === "chute") return { ...p, stage: chuteStage };
    if (i.kind === "radial") return { ...p, stage: radialStage.get(i.depth)! };
    return { ...p, stage: stageOf.get(i.depth)! };
  });
  return { ...bp, parts, manualStaging: false };
}

/** Compact stage numbers so there are no gaps (0..n-1). */
export function compactStages(bp: Blueprint): Blueprint {
  const used = [...new Set(bp.parts.filter((p) => p.stage >= 0 && isStageable(getDef(p.defId))).map((p) => p.stage))].sort(
    (x, y) => x - y,
  );
  const map = new Map(used.map((s, i) => [s, i]));
  return { ...bp, parts: bp.parts.map((p) => ({ ...p, stage: map.has(p.stage) ? map.get(p.stage)! : -1 })) };
}

type Item = [string, number, number];

function build(name: string, items: Item[]): Blueprint {
  const parts: PartInstance[] = items.map(([defId, gx, gy], i) => ({ id: i + 1, defId, gx, gy, stage: -1 }));
  return autoStage(normalize({ version: 1, name, parts }));
}

export const PRESETS: Blueprint[] = [
  build("Hopper", [
    ["tern", -4, 0],
    ["tank_s", -6, 6],
    ["pod", -6, 14],
    ["chute", -2, 22],
    ["fin", 6, 6],
    ["fin", -8, 6],
  ]),
  build("Starter Orbiter", [
    ["hawk", -6, 0],
    ["tank_l", -6, 8],
    ["sep", -6, 40],
    ["tern", -4, 42],
    ["tank_m", -6, 48],
    ["pod", -6, 64],
    ["chute", -2, 72],
    ["fin", 6, 8],
    ["fin", -8, 8],
  ]),
  build("Moonshot", [
    ["hawk", -6, 0],
    ["tank_l", -6, 8],
    ["tank_l", -6, 40],
    ["sep", -6, 72],
    ["hawk", -6, 74],
    ["tank_l", -6, 82],
    ["sep", -6, 114],
    ["spark", -3, 116],
    ["tank_m", -6, 120],
    ["shield", -6, 136],
    ["pod", -6, 138],
    ["chute", -2, 146],
    ["leg", 6, 110],
    ["leg", -8, 110],
    ["rsep", 6, 14],
    ["rsep", -8, 14],
    ["fin", 6, 0],
    ["fin", -8, 0],
    ["booster", 8, 0],
    ["booster", -12, 0],
    ["fin", 6, 24],
    ["fin", -8, 24],
  ]),
];
