"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Blueprint } from "@/game/core/types";
import { formatDistance, formatMass } from "@/game/core/math";
import { PART_LIST, getDef, isStageable } from "@/game/data/parts";
import { LangSwitch, useLang } from "@/i18n/react";
import type { Key } from "@/i18n";
import { categoryLabel, errorText, msg, partDesc, partName as partLabel, tm, vesselName } from "@/i18n/game";
import { blueprintStats } from "@/game/flight/vessel";
import { VabRenderer } from "@/game/render/vabRenderer";
import { addPart, findSnap, removePart, normalize, type SnapResult } from "@/game/vab/grid";
import {
  PRESETS,
  autoStage,
  compactStages,
  emptyBlueprint,
  parseBlueprint,
  serializeBlueprint,
  validateBlueprint,
} from "@/game/vab/blueprint";
import { PartIcon } from "./PartIcon";

interface Props {
  bp: Blueprint;
  onChange: (bp: Blueprint) => void;
  onLaunch: () => void;
  onMenu: () => void;
}

interface CloudRow {
  id: number;
  name: string;
  partCount: number;
  massKg: number;
  deltaV: number;
  updatedAt: string;
  data: Blueprint;
}

const BLUEPRINT_LIBRARY_KEY = "orbital.blueprints.library.v1";

const btn =
  "rounded-md border border-[#2a3342] bg-[#171d27] px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-[#ff8a1f] hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

export default function VabScreen({ bp, onChange, onLaunch, onMenu }: Props) {
  const { t, lang } = useLang();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<VabRenderer | null>(null);
  const undoRef = useRef<Blueprint[]>([]);
  const redoRef = useRef<Blueprint[]>([]);
  const bpRef = useRef(bp);
  const cursorRef = useRef({ x: 0, y: 0 });
  const snapRef = useRef<SnapResult | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean; mode: "pan" | "click"; button: number } | null>(null);

  const [tool, setTool] = useState<string | null>(null);
  const [symmetry, setSymmetry] = useState(true);
  const [category, setCategory] = useState<string>("all");
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showMarkers, setShowMarkers] = useState(true);
  const [dialog, setDialog] = useState<null | "storage">(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    bpRef.current = bp;
  }, [bp]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  const commit = useCallback(
    (next: Blueprint, opts?: { skipAuto?: boolean }) => {
      let n = next;
      if (!opts?.skipAuto && !n.manualStaging) n = autoStage(n);
      undoRef.current.push(bpRef.current);
      if (undoRef.current.length > 80) undoRef.current.shift();
      redoRef.current = [];
      onChange(n);
    },
    [onChange],
  );

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(bpRef.current);
    onChange(prev);
  }, [onChange]);

  const redo = useCallback(() => {
    const nxt = redoRef.current.pop();
    if (!nxt) return;
    undoRef.current.push(bpRef.current);
    onChange(nxt);
  }, [onChange]);

  const stats = useMemo(() => blueprintStats(bp), [bp]);
  const issueMsg = useMemo(() => (bp.parts.length ? validateBlueprint(bp) : msg("bp.addParts")), [bp]);
  const issue = issueMsg ? tm(issueMsg, lang) : null;
  const canLaunch = !issue && !!stats?.hasCommand;

  // ---------------------------------------------------------------- renderer lifecycle
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const r = new VabRenderer(canvas);
    rendererRef.current = r;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      r.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    };
    resize();
    r.frame(bpRef.current);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    let raf = 0;
    const loop = () => {
      r.render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      r.dispose();
      rendererRef.current = null;
    };
  }, []);

  const highlight = useMemo(() => {
    const s = new Set<number>();
    if (hoverId !== null) s.add(hoverId);
    if (selectedId !== null) s.add(selectedId);
    return s;
  }, [hoverId, selectedId]);

  useEffect(() => {
    rendererRef.current?.setBlueprint(bp, highlight);
  }, [bp, highlight]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setMarkers(showMarkers && stats ? stats.com : null, showMarkers && stats ? stats.cop : null);
  }, [stats, showMarkers]);

  const refreshGhost = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (tool) {
      const def = getDef(tool);
      const snap = findSnap(bpRef.current, def, cursorRef.current.x, cursorRef.current.y, symmetry);
      snapRef.current = snap;
      r.setGhost(def, snap);
    } else {
      snapRef.current = null;
      r.setGhost(null, null);
    }
  }, [tool, symmetry]);

  useEffect(() => {
    refreshGhost();
  }, [refreshGhost, bp]);

  // ---------------------------------------------------------------- pointer handling
  const partAt = (x: number, y: number): number | null => {
    const parts = bpRef.current.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      const d = getDef(p.defId);
      if (x >= p.gx && x < p.gx + d.w && y >= p.gy && y < p.gy + d.h) return p.id;
    }
    return null;
  };

  const localXY = (e: React.PointerEvent | React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { px, py } = localXY(e);
    dragRef.current = { x: px, y: py, moved: false, mode: e.button === 0 && tool ? "click" : "pan", button: e.button };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    const { px, py } = localXY(e);
    const d = dragRef.current;
    if (d) {
      const dx = px - d.x;
      const dy = py - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (d.moved && (d.mode === "pan" || d.button !== 0)) {
        r.pan(dx, dy);
        d.x = px;
        d.y = py;
      }
    }
    const c = r.screenToCell(px, py);
    cursorRef.current = c;
    refreshGhost();
    const id = partAt(c.x, c.y);
    setHoverId((h) => (h === id ? h : id));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved) return;
    const r = rendererRef.current;
    if (!r) return;
    const { px, py } = localXY(e);
    const c = r.screenToCell(px, py);
    if (e.button === 2) {
      const id = partAt(c.x, c.y);
      if (id !== null) {
        commit(removePart(bpRef.current, id));
        setSelectedId(null);
        setHoverId(null);
      }
      return;
    }
    if (e.button !== 0) return;
    if (tool) {
      const snap = findSnap(bpRef.current, getDef(tool), c.x, c.y, symmetry);
      if (snap.valid) commit(addPart(bpRef.current, tool, snap));
      else flash(t("vab.attachToast"));
    } else {
      const id = partAt(c.x, c.y);
      setSelectedId(id);
    }
  };

  useEffect(() => {
    const el = wrapRef.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      rendererRef.current?.zoomAt(e.deltaY, e.clientX - rect.left, e.clientY - rect.top);
      refreshGhost();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [refreshGhost]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        setTool(null);
        setSelectedId(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && (hoverId !== null || selectedId !== null)) {
        const id = hoverId ?? selectedId!;
        commit(removePart(bpRef.current, id));
        setSelectedId(null);
        setHoverId(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key.toLowerCase() === "m") setSymmetry((s) => !s);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [hoverId, selectedId, commit, undo, redo]);

  // ---------------------------------------------------------------- staging editing
  const stageable = bp.parts.filter((p) => isStageable(getDef(p.defId)));
  const stageNums = [...new Set(stageable.filter((p) => p.stage >= 0).map((p) => p.stage))].sort((a, b) => a - b);
  const unstaged = stageable.filter((p) => p.stage < 0);

  const setStage = (id: number, stage: number) => {
    const next = compactStages({
      ...bp,
      manualStaging: true,
      parts: bp.parts.map((p) => (p.id === id ? { ...p, stage: Math.max(-1, stage) } : p)),
    });
    commit(next, { skipAuto: true });
  };

  const partName = (defId: string) => partLabel(defId, getDef(defId).name);

  const categories = ["all", ...Array.from(new Set(PART_LIST.map((p) => p.category)))];
  const shown = PART_LIST.filter((p) => category === "all" || p.category === category);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0b0e13] text-slate-200 select-none">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#1c2430] bg-[#10151d] px-3 py-2">
        <button className={btn} onClick={onMenu}>
          {t("vab.menu")}
        </button>
        <div className="mx-1 text-sm font-semibold tracking-wide text-[#ff8a1f]">{t("vab.title")}</div>
        <input
          value={vesselName(bp.name)}
          onChange={(e) => onChange({ ...bp, name: e.target.value.slice(0, 60) })}
          className="w-48 rounded-md border border-[#2a3342] bg-[#0b0e13] px-2 py-1 text-sm outline-none focus:border-[#4da3ff]"
          aria-label={t("vab.rocketName")}
        />
        <div className="mx-1 h-5 w-px bg-[#2a3342]" />
        <button className={btn} onClick={undo} disabled={!undoRef.current.length}>
          {t("vab.undo")}
        </button>
        <button className={btn} onClick={redo} disabled={!redoRef.current.length}>
          {t("vab.redo")}
        </button>
        <button
          className={`${btn} ${symmetry ? "!border-[#4da3ff] !text-[#4da3ff]" : ""}`}
          onClick={() => setSymmetry((s) => !s)}
          title={t("vab.symmetryTip")}
        >
          {symmetry ? t("vab.symmetryOn") : t("vab.symmetryOff")}
        </button>
        <button className={`${btn} ${showMarkers ? "!border-[#ffd23f] !text-[#ffd23f]" : ""}`} onClick={() => setShowMarkers((s) => !s)}>
          {t("vab.comCop")}
        </button>
        <button className={btn} onClick={() => commit(autoStage(bp), { skipAuto: true })}>
          {t("vab.autoStage")}
        </button>
        <button
          className={btn}
          onClick={() => {
            commit(emptyBlueprint(bp.name), { skipAuto: true });
            setSelectedId(null);
          }}
        >
          {t("vab.clear")}
        </button>
        <div className="flex-1" />
        <LangSwitch />
        <button className={btn} onClick={() => setDialog("storage")}>
          {t("vab.saveLoad")}
        </button>
        <button
          className={`rounded-md bg-[#ff8a1f] px-4 py-1.5 text-sm font-bold text-[#1a0f02] transition hover:bg-[#ffa13d] disabled:cursor-not-allowed disabled:opacity-40`}
          disabled={!canLaunch}
          onClick={onLaunch}
          title={issue ?? (stats?.hasCommand ? t("vab.launchTip") : t("vab.needCommandTip"))}
        >
          {t("vab.launch")}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* palette */}
        <div className="flex w-60 shrink-0 flex-col border-r border-[#1c2430] bg-[#0f141b]">
          <div className="flex flex-wrap gap-1 border-b border-[#1c2430] p-2">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded px-2 py-1 text-[11px] uppercase tracking-wide ${category === c ? "bg-[#ff8a1f] font-bold text-[#1a0f02]" : "bg-[#171d27] text-slate-400 hover:text-white"}`}
              >
                {c === "all" ? t("cat.all") : categoryLabel(c)}
              </button>
            ))}
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
            {shown.map((d) => (
              <button
                key={d.id}
                onClick={() => setTool((t) => (t === d.id ? null : d.id))}
                className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left transition ${tool === d.id ? "border-[#ff8a1f] bg-[#241a10]" : "border-[#222b39] bg-[#141a23] hover:border-[#3a475c]"}`}
                title={partDesc(d.id, d.description)}
              >
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-[#0b0e13]">
                  <PartIcon def={d} size={46} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{partLabel(d.id, d.name)}</div>
                  <div className="text-[11px] text-slate-400">
                    {formatMass(d.mass)}
                    {d.fuel ? ` · ${t("vab.fuelSuffix", { mass: formatMass(d.fuel) })}` : ""}
                    {d.engine ? ` · ${(d.engine.thrust / 1000).toFixed(0)} kN` : ""}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {d.w * 0.25}×{d.h * 0.25} m{d.radial ? ` · ${t("vab.radial")}` : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="border-t border-[#1c2430] p-2 text-[10px] leading-relaxed text-slate-500">
            {t("vab.paletteHelp")}
          </div>
        </div>

        {/* canvas */}
        <div
          ref={wrapRef}
          className="relative min-w-0 flex-1 touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          style={{ cursor: tool ? "crosshair" : "grab" }}
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          {!bp.parts.length && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-slate-500">
              <div>
                <div className="text-lg font-semibold text-slate-300">{t("vab.emptyTitle")}</div>
                <div className="text-sm">{t("vab.emptyHint")}</div>
              </div>
            </div>
          )}
          {toast && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-[#ff8a1f] bg-[#1a1208] px-3 py-1.5 text-xs text-[#ffc58a]">{toast}</div>}
          <div className="pointer-events-none absolute left-3 top-3 text-[11px] text-slate-500">
            {showMarkers && (
              <>
                <span className="text-[#ffd23f]">{t("vab.legendCom")}</span> · <span className="text-[#4da3ff]">{t("vab.legendCop")}</span>
              </>
            )}
          </div>
        </div>

        {/* right panel */}
        <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-[#1c2430] bg-[#0f141b]">
          <Section title={t("vab.statsTitle")}>
            {stats ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <Stat k={t("vab.statParts")} v={String(stats.parts)} />
                <Stat k={t("vab.statSize")} v={`${stats.width.toFixed(1)} × ${stats.height.toFixed(1)} m`} />
                <Stat k={t("vab.statWet")} v={formatMass(stats.mass)} />
                <Stat k={t("vab.statDry")} v={formatMass(stats.dryMass)} />
                <Stat k={t("vab.statFuel")} v={formatMass(stats.fuel)} />
                <Stat k={t("vab.statTwr")} v={stats.twr.toFixed(2)} warn={stats.twr > 0 && stats.twr < 1} />
                <Stat k={t("vab.statDv")} v={`${stats.dv.total.toFixed(0)} m/s`} accent />
                <Stat k={t("vab.statStability")} v={stats.stable ? t("vab.stable") : t("vab.unstable")} warn={!stats.stable} good={stats.stable} />
              </div>
            ) : (
              <div className="text-xs text-slate-500">{t("vab.noParts")}</div>
            )}
            {stats && stats.dv.stages.length > 0 && (
              <div className="mt-3 space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">{t("vab.stageDvTitle")}</div>
                {stats.dv.stages.map((s, i) => (
                  <div key={i} className="flex items-center justify-between rounded bg-[#141a23] px-2 py-1 text-xs">
                    <span className="text-slate-400">{t("vab.stageN", { n: s.stage < 0 ? "—" : s.stage + 1 })}</span>
                    <span>
                      <span className="text-[#4da3ff]">{s.dv.toFixed(0)} m/s</span>
                      <span className="ml-2 text-slate-500">{t("vab.twrShort", { v: s.twr.toFixed(2) })}</span>
                      <span className="ml-2 text-slate-500">{s.burnTime.toFixed(0)}s</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {issue && bp.parts.length > 0 && <div className="mt-2 rounded bg-[#2a1313] p-2 text-xs text-[#ff8f8f]">{issue}</div>}
            {stats && !stats.hasCommand && <div className="mt-2 rounded bg-[#2a2113] p-2 text-xs text-[#ffd08a]">{t("vab.warnNoCommand")}</div>}
            {stats && !stats.stable && <div className="mt-2 rounded bg-[#2a2113] p-2 text-xs text-[#ffd08a]">{t("vab.warnUnstable")}</div>}
          </Section>

          <Section title={t("vab.stagingTitle")}>
            <div className="space-y-2">
              {stageNums.length === 0 && unstaged.length === 0 && <div className="text-xs text-slate-500">{t("vab.noStageable")}</div>}
              {stageNums.map((s) => (
                <div key={s} className="rounded-lg border border-[#222b39] bg-[#141a23] p-2">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#ff8a1f]">{t("vab.stageN", { n: s + 1 })}</div>
                  {stageable
                    .filter((p) => p.stage === s)
                    .map((p) => (
                      <StageRow
                        key={p.id}
                        name={partName(p.defId)}
                        onEnter={() => setSelectedId(p.id)}
                        onLeave={() => setSelectedId(null)}
                        onUp={() => setStage(p.id, s - 1)}
                        onDown={() => setStage(p.id, s + 1)}
                        onClear={() => setStage(p.id, -1)}
                      />
                    ))}
                </div>
              ))}
              {unstaged.length > 0 && (
                <div className="rounded-lg border border-dashed border-[#2a3342] p-2">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{t("vab.unstaged")}</div>
                  {unstaged.map((p) => (
                    <StageRow
                      key={p.id}
                      name={partName(p.defId)}
                      onEnter={() => setSelectedId(p.id)}
                      onLeave={() => setSelectedId(null)}
                      onDown={() => setStage(p.id, (stageNums[stageNums.length - 1] ?? -1) + 1)}
                    />
                  ))}
                </div>
              )}
              {bp.manualStaging && <div className="text-[10px] text-slate-500">{t("vab.manualStaging")}</div>}
            </div>
          </Section>
        </div>
      </div>

      {dialog === "storage" && (
        <StorageDialog
          bp={bp}
          onClose={() => setDialog(null)}
          onLoad={(b) => {
            commit(normalize(b), { skipAuto: true });
            rendererRef.current?.frame(b);
            setDialog(null);
            flash(t("vab.loaded", { name: vesselName(b.name) }));
          }}
          flash={flash}
        />
      )}
      <span className="hidden">{formatDistance(0)}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[#1c2430] p-3">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</div>
      {children}
    </div>
  );
}

function Stat({ k, v, warn, good, accent }: { k: string; v: string; warn?: boolean; good?: boolean; accent?: boolean }) {
  return (
    <>
      <div className="text-slate-500">{k}</div>
      <div className={`text-right font-mono ${warn ? "text-[#ff8f8f]" : good ? "text-[#6ee7a8]" : accent ? "text-[#4da3ff]" : "text-slate-200"}`}>{v}</div>
    </>
  );
}

function StageRow(props: { name: string; onEnter: () => void; onLeave: () => void; onUp?: () => void; onDown?: () => void; onClear?: () => void }) {
  const { t } = useLang();
  const b = "rounded bg-[#1d2531] px-1.5 text-xs text-slate-300 hover:bg-[#ff8a1f] hover:text-black";
  return (
    <div className="flex items-center justify-between py-0.5 text-xs" onMouseEnter={props.onEnter} onMouseLeave={props.onLeave}>
      <span className="truncate text-slate-300">{props.name}</span>
      <span className="flex gap-1">
        {props.onUp && (
          <button className={b} onClick={props.onUp} title={t("vab.earlierStage")}>
            ▲
          </button>
        )}
        {props.onDown && (
          <button className={b} onClick={props.onDown} title={t("vab.laterStage")}>
            ▼
          </button>
        )}
        {props.onClear && (
          <button className={b} onClick={props.onClear} title={t("vab.removeFromStage")}>
            ✕
          </button>
        )}
      </span>
    </div>
  );
}

function StorageDialog({ bp, onClose, onLoad, flash }: { bp: Blueprint; onClose: () => void; onLoad: (b: Blueprint) => void; flash: (m: string) => void }) {
  const { t } = useLang();
  const [rows, setRows] = useState<CloudRow[] | null>(null);
  const [failure, setFailure] = useState<{ e: unknown; fb: Key } | null>(null);
  const error = failure ? errorText(failure.e, failure.fb) : null;
  const [json, setJson] = useState(() => serializeBlueprint(bp));
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(BLUEPRINT_LIBRARY_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) throw new Error("Saved blueprint library is invalid");
      setRows(parsed as CloudRow[]);
      setFailure(null);
    } catch (e) {
      setRows([]);
      setFailure({ e, fb: "store.errLoadList" });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = () => {
    setBusy(true);
    try {
      const raw = window.localStorage.getItem(BLUEPRINT_LIBRARY_KEY);
      const existing: CloudRow[] = raw ? JSON.parse(raw) : [];
      const stats = blueprintStats(bp);
      const row: CloudRow = {
        id: Date.now(),
        name: bp.name,
        partCount: bp.parts.length,
        massKg: stats?.mass ?? 0,
        deltaV: stats?.dv.total ?? 0,
        updatedAt: new Date().toISOString(),
        data: bp,
      };
      const next = [row, ...existing.filter((item) => item.name !== bp.name)];
      window.localStorage.setItem(BLUEPRINT_LIBRARY_KEY, JSON.stringify(next));
      flash(t("store.savedToast", { name: vesselName(bp.name) }));
      refresh();
    } catch (e) {
      setFailure({ e, fb: "store.errSave" });
    } finally {
      setBusy(false);
    }
  };

  const load = (id: number) => {
    try {
      const row = rows?.find((item) => item.id === id);
      if (!row) throw new Error("Saved blueprint not found");
      onLoad(parseBlueprint(JSON.stringify(row.data)));
    } catch (e) {
      setFailure({ e, fb: "store.errLoad" });
    }
  };

  const del = (id: number) => {
    try {
      const next = (rows ?? []).filter((item) => item.id !== id);
      window.localStorage.setItem(BLUEPRINT_LIBRARY_KEY, JSON.stringify(next));
      refresh();
    } catch (e) {
      setFailure({ e, fb: "store.errLoadList" });
    }
  };

  const importJson = () => {
    try {
      onLoad(parseBlueprint(json));
    } catch (e) {
      setFailure({ e, fb: "store.errJson" });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[#2a3342] bg-[#10151d]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#1c2430] px-4 py-3">
          <div className="font-semibold text-[#ff8a1f]">{t("store.title")}</div>
          <button className={btn} onClick={onClose}>
            {t("store.close")}
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("store.saved")}</div>
              <button className={`${btn} !border-[#4da3ff] !text-[#4da3ff]`} onClick={save} disabled={busy || !bp.parts.length}>
                {t("store.saveCurrent")}
              </button>
            </div>
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {rows === null && <div className="text-xs text-slate-500">{t("store.loading")}</div>}
              {rows?.length === 0 && <div className="text-xs text-slate-500">{t("store.empty")}</div>}
              {rows?.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-[#222b39] bg-[#141a23] px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{vesselName(r.name)}</div>
                    <div className="text-[11px] text-slate-500">
                      {t("store.rowInfo", { parts: r.partCount, mass: formatMass(r.massKg), dv: r.deltaV.toFixed(0) })}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button className={btn} onClick={() => load(r.id)}>
                      {t("store.load")}
                    </button>
                    <button className={btn} onClick={() => del(r.id)} aria-label={t("store.delete")}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("store.presets")}</div>
            <div className="space-y-1.5">
              {PRESETS.map((p) => (
                <button key={p.name} className="flex w-full items-center justify-between rounded-lg border border-[#222b39] bg-[#141a23] px-3 py-2 text-left text-sm hover:border-[#ff8a1f]" onClick={() => onLoad(p)}>
                  <span>{vesselName(p.name)}</span>
                  <span className="text-[11px] text-slate-500">{t("store.presetParts", { n: p.parts.length })}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("store.json")}</div>
            <textarea
              value={json}
              onChange={(e) => setJson(e.target.value)}
              spellCheck={false}
              className="min-h-[220px] flex-1 resize-none rounded-lg border border-[#222b39] bg-[#0b0e13] p-2 font-mono text-[11px] text-slate-300 outline-none focus:border-[#4da3ff]"
            />
            <div className="flex flex-wrap gap-2">
              <button className={btn} onClick={() => setJson(serializeBlueprint(bp))}>
                {t("store.refresh")}
              </button>
              <button className={btn} onClick={() => navigator.clipboard?.writeText(json).then(() => flash(t("store.copied")))}>
                {t("store.copy")}
              </button>
              <button
                className={btn}
                onClick={() => {
                  const blob = new Blob([json], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `${vesselName(bp.name).replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "_").replace(/^_+|_+$/g, "") || "rocket"}.json`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                {t("store.download")}
              </button>
              <button className={`${btn} !border-[#ff8a1f] !text-[#ff8a1f]`} onClick={importJson}>
                {t("store.import")}
              </button>
            </div>
          </div>
        </div>
        {error && <div className="border-t border-[#3a1b1b] bg-[#2a1313] px-4 py-2 text-xs text-[#ff8f8f]">{error}</div>}
      </div>
    </div>
  );
}
