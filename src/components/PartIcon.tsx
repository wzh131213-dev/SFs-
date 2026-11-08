"use client";

import type { PartDef } from "@/game/core/types";
import { partIconPaths } from "@/game/render/partMesh";

export function PartIcon({ def, size = 48, flip = false }: { def: PartDef; size?: number; flip?: boolean }) {
  const s = size / Math.max(def.w, def.h);
  const paths = partIconPaths(def);
  return (
    <svg width={def.w * s} height={def.h * s} viewBox={`0 0 ${def.w} ${def.h}`} style={flip ? { transform: "scaleX(-1)" } : undefined}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill} stroke="#11141a" strokeWidth={0.18} strokeLinejoin="round" />
      ))}
    </svg>
  );
}
