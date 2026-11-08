"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Blueprint } from "@/game/core/types";
import { formatDistance, formatMass, formatSpeed, formatTime } from "@/game/core/math";
import { Simulation, WARP_LEVELS, type Telemetry, type Toast } from "@/game/flight/simulation";
import type { SasMode } from "@/game/flight/vessel";
import { FlightRenderer, type ViewMode } from "@/game/render/flightRenderer";
import { LangSwitch, useLang } from "@/i18n/react";
import type { Key } from "@/i18n";
import { bodyName } from "@/i18n/game";

interface Props {
  bp: Blueprint;
  onRevert: () => void;
  onRestart: () => void;
  onMenu: () => void;
}

const SAS_MODES: SasMode[] = ["stability", "prograde", "retrograde", "radialOut", "radialIn", "maneuver", "off"];

function HudButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; accent?: "orange" | "blue" }) {
  const { active, accent = "orange", className = "", ...rest } = props;
  const on = accent === "orange" ? "border-[#ff8a1f] bg-[#2a1b0c] text-[#ffb066]" : "border-[#4da3ff] bg-[#0f2236] text-[#8cc6ff]";
  return (
    <button
      {...rest}
      onMouseDown={(e) => {
        e.preventDefault();
        props.onMouseDown?.(e);
      }}
      className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold tracking-wide transition disabled:cursor-not-allowed disabled:opacity-35 ${active ? on : "border-[#2a3342] bg-[#141a23]/90 text-slate-300 hover:border-slate-400"} ${className}`}
    />
  );
}

export default function FlightScreen({ bp, onRevert, onRestart, onMenu }: Props) {
  const { t, lang } = useLang();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const navRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FlightRenderer | null>(null);
  const keys = useRef(new Set<string>());
  const touchSteer = useRef(0);
  const [sim] = useState(() => new Simulation(bp));
  const [tel, setTel] = useState<Telemetry>(() => sim.telemetry());
  const [mode, setMode] = useState<ViewMode>("flight");
  const [toasts, setToasts] = useState<(Toast & { until: number })[]>([]);
  const [hohmannAlt, setHohmannAlt] = useState(120);
  const [focusId, setFocusId] = useState<string | null>(null); // body id the map follows; null = the vessel itself
  const modeRef = useRef<ViewMode>("flight");

  const refresh = useCallback(() => {
    setTel(sim.telemetry());
    if (sim.toasts.length) {
      const now = performance.now();
      const fresh = sim.toasts.splice(0).map((t) => ({ ...t, until: now + 4200 }));
      setToasts((old) => [...old.filter((t) => t.until > now), ...fresh].slice(-5));
    }
  }, [sim]);

  const switchMode = useCallback((m: ViewMode) => {
    modeRef.current = m;
    setMode(m);
    rendererRef.current?.setMode(m);
  }, []);

  // ---------------------------------------------------------------- renderer + loop
  useEffect(() => {
    const r = new FlightRenderer(canvasRef.current!, overlayRef.current!, navRef.current, sim);
    rendererRef.current = r;
    const wrap = wrapRef.current!;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      r.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const v = sim.active;
      if (v) {
        const k = keys.current;
        let steer = 0;
        if (k.has("a") || (!v.rcsOn && k.has("arrowleft"))) steer += 1;
        if (k.has("d") || (!v.rcsOn && k.has("arrowright"))) steer -= 1;
        steer += touchSteer.current;
        v.steerInput = Math.max(-1, Math.min(1, steer));
        v.rcsX = v.rcsOn ? (k.has("arrowright") ? 1 : 0) - (k.has("arrowleft") ? 1 : 0) : 0;
        v.rcsY = v.rcsOn ? (k.has("arrowup") ? 1 : 0) - (k.has("arrowdown") ? 1 : 0) : 0;
        if (k.has("shift") || k.has("w")) v.throttle = Math.min(1, v.throttle + 0.6 * dt);
        if (k.has("control") || k.has("s")) v.throttle = Math.max(0, v.throttle - 0.6 * dt);
      }
      sim.update(dt);
      r.render(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const iv = window.setInterval(refresh, 100);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(iv);
      ro.disconnect();
      r.dispose();
      rendererRef.current = null;
    };
  }, [sim, refresh]);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const key = e.key.toLowerCase();
      keys.current.add(key);
      if (e.repeat) {
        if (key === " " || key === "tab") e.preventDefault();
        return;
      }
      const v = sim.active;
      switch (key) {
        case " ":
          e.preventDefault();
          sim.activateStage();
          break;
        case "t":
          if (v) {
            v.sas = v.sas === "off" ? "stability" : "off";
            v.sasHold = v.angle;
          }
          break;
        case "r":
          if (v) v.rcsOn = !v.rcsOn;
          break;
        case "z":
          if (v) v.throttle = 1;
          break;
        case "x":
          if (v) v.throttle = 0;
          break;
        case "m":
          switchMode(modeRef.current === "flight" ? "map" : "flight");
          break;
        case ".":
          sim.setWarpIndex(sim.warpIndex + 1);
          break;
        case ",":
          sim.setWarpIndex(sim.warpIndex - 1);
          break;
        case "/":
          sim.setWarpIndex(0);
          break;
        case "tab":
          e.preventDefault();
          sim.cycleVessel(e.shiftKey ? -1 : 1);
          break;
        case "]":
          sim.cycleVessel(1);
          break;
        case "[":
          sim.cycleVessel(-1);
          break;
        case "f":
          if (modeRef.current === "map") {
            rendererRef.current?.cycleMapFocus();
            setFocusId(rendererRef.current?.mapFocusBodyId() ?? null);
          }
          break;
        case "n":
          if (modeRef.current === "map") {
            sim.createNode();
            rendererRef.current?.invalidatePrediction();
          }
          break;
        default:
          break;
      }
      refresh();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [sim, refresh, switchMode]);

  // ---------------------------------------------------------------- pointer (zoom / pan)
  useEffect(() => {
    const el = wrapRef.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      rendererRef.current?.zoom(e.deltaY);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    rendererRef.current?.pan(e.clientX - drag.current.x, e.clientY - drag.current.y);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  // ---------------------------------------------------------------- actions
  const v = sim.active;
  const setSas = (m: SasMode) => {
    const a = sim.active;
    if (!a) return;
    a.sas = m;
    if (m === "stability") a.sasHold = a.angle;
    refresh();
  };
  const setThrottle = (t: number) => {
    const a = sim.active;
    if (a) a.throttle = Math.max(0, Math.min(1, t));
    refresh();
  };
  const nodeChanged = () => {
    rendererRef.current?.invalidatePrediction();
    refresh();
  };

  const nextStage = tel.stages[0];
  const warpLabel = tel.warp > 5 ? `${Math.round(tel.warp).toLocaleString()}x ${t("fl.rails")}` : `${tel.warp.toFixed(tel.warp % 1 ? 1 : 0)}x`;
  const heatPct = Math.round(Math.min(1, tel.heat) * 100);

  const orbitInfo = tel.orbit;
  const apText = useMemo(() => (orbitInfo ? (orbitInfo.hyperbolic ? t("fl.escape") : formatDistance(orbitInfo.ap)) : "—"), [orbitInfo, t]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-slate-200 select-none">
      <div ref={wrapRef} className="absolute inset-0 touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto rounded-lg border border-[#222b39] bg-[#0d1218]/85 px-3 py-2 backdrop-blur">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">{tel.bodyName} · {tel.landed ? t("fl.landed") : t("fl.flying")}</div>
          <div className="text-sm font-semibold text-white">{tel.name}</div>
          <div className="font-mono text-[11px] text-slate-400">{t("fl.tPlus", { t: formatTime(tel.time) })}</div>
        </div>

        <div className="pointer-events-auto flex flex-col items-center gap-1">
          <div className="flex items-center gap-1 rounded-lg border border-[#222b39] bg-[#0d1218]/85 p-1.5 backdrop-blur">
            <HudButton onClick={() => sim.setWarpIndex(tel.warpIndex - 1)} title={t("fl.slower")}>
              ◀◀
            </HudButton>
            <div className="w-32 text-center">
              <div className={`font-mono text-sm font-bold ${tel.warp > 1.01 ? "text-[#ffb066]" : "text-slate-300"}`}>{warpLabel}</div>
              <div className="text-[10px] text-slate-500">{WARP_LEVELS[tel.warpIndex] > tel.warp + 0.5 && tel.warpNote ? t("fl.warpLimited", { note: tel.warpNote }) : t("fl.warpLabel")}</div>
            </div>
            <HudButton onClick={() => sim.setWarpIndex(tel.warpIndex + 1)} title={t("fl.faster")}>
              ▶▶
            </HudButton>
            <HudButton onClick={() => sim.setWarpIndex(0)} title={t("fl.realTime")}>
              1x
            </HudButton>
          </div>
          {toasts.map((t) => (
            <div key={t.id} className={`rounded-md border px-3 py-1 text-xs backdrop-blur ${t.kind === "bad" ? "border-[#7a2b2b] bg-[#2a1010]/90 text-[#ff9f9f]" : t.kind === "good" ? "border-[#1f6b47] bg-[#0e2a1d]/90 text-[#8ff0bd]" : "border-[#2a3342] bg-[#0d1218]/90 text-slate-200"}`}>
              {t.text}
            </div>
          ))}
        </div>

        <div className="pointer-events-auto flex gap-1.5">
          <HudButton active={mode === "map"} accent="blue" onClick={() => switchMode(mode === "map" ? "flight" : "map")} title={t("fl.mapToggle")}>
            {t("fl.map")}
          </HudButton>
          <HudButton onClick={onRevert}>{t("fl.revert")}</HudButton>
          <HudButton onClick={onMenu}>{t("fl.menu")}</HudButton>
          <LangSwitch />
        </div>
      </div>

      {/* staging stack */}
      <div className="pointer-events-auto absolute bottom-4 left-3 top-24 flex w-52 flex-col justify-end gap-1.5">
        {tel.vessels.length > 1 && (
          <div className="mb-2 max-h-40 overflow-y-auto rounded-lg border border-[#222b39] bg-[#0d1218]/85 p-2 backdrop-blur">
            <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">{t("fl.vessels")}</div>
            {tel.vessels.map((x) => (
              <button
                key={x.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  sim.selectVessel(x.id);
                  refresh();
                }}
                className={`flex w-full items-center justify-between rounded px-2 py-0.5 text-left text-xs ${x.active ? "bg-[#2a1b0c] text-[#ffb066]" : "text-slate-400 hover:bg-[#161d27]"}`}
              >
                <span className="truncate">{x.name}</span>
                <span className="text-[10px] text-slate-500">{x.landed ? t("fl.vesselLanded") : x.body}</span>
              </button>
            ))}
          </div>
        )}
        <div className="rounded-lg border border-[#222b39] bg-[#0d1218]/85 p-2 backdrop-blur">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">{t("fl.staging")}</div>
            <HudButton accent="orange" active onClick={() => sim.activateStage()} disabled={!tel.hasVessel || tel.stages.length === 0} title={lang === "zh" ? "空格" : "Space"}>
              {t("fl.stageBtn")}
            </HudButton>
          </div>
          <div className="flex flex-col-reverse gap-1">
            {tel.stages.length === 0 && <div className="text-xs text-slate-500">{t("fl.noStages")}</div>}
            {tel.stages.map((s, i) => (
              <div key={s.stage} className={`rounded border px-2 py-1 ${i === 0 ? "border-[#ff8a1f] bg-[#241a10]" : "border-[#222b39] bg-[#10151d]"}`}>
                <div className={`text-[10px] font-bold ${i === 0 ? "text-[#ffb066]" : "text-slate-500"}`}>{t("fl.stageN", { n: s.stage + 1 })}</div>
                <div className="text-[11px] leading-tight text-slate-300">{s.names.join(" · ")}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* right: navball + telemetry */}
      <div className="pointer-events-auto absolute bottom-4 right-3 top-24 flex w-64 flex-col items-end justify-end gap-2 overflow-y-auto">
        {mode === "map" && <MapPanel sim={sim} tel={tel} hohmannAlt={hohmannAlt} setHohmannAlt={setHohmannAlt} onChange={nodeChanged} focusName={focusId ? bodyName(focusId) : t("map.vessel")}
            onFocus={() => {
              rendererRef.current?.cycleMapFocus();
              setFocusId(rendererRef.current?.mapFocusBodyId() ?? null);
            }} apText={apText} />}
        <div className="w-full rounded-lg border border-[#222b39] bg-[#0d1218]/85 p-2 backdrop-blur">
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px]">
            <Row k={t("fl.altitude")} v={formatDistance(tel.altitude)} big />
            <Row k={tel.speedSurface ? t("fl.surface") : t("fl.orbital")} v={formatSpeed(tel.speed)} big />
            <Row k={t("fl.vertical")} v={formatSpeed(tel.verticalSpeed)} />
            <Row k={t("fl.horizontal")} v={formatSpeed(tel.horizontalSpeed)} />
            <Row k={t("fl.mass")} v={formatMass(tel.mass)} />
            <Row k={t("fl.twr")} v={tel.twr.toFixed(2)} warn={tel.twr < 1 && !tel.landed && tel.thrust > 0} />
            <Row k={t("fl.thrust")} v={`${(tel.thrust / 1000).toFixed(0)} kN`} />
            <Row k={t("fl.gForce")} v={`${tel.gForce.toFixed(1)} g`} warn={tel.gForce > 6} />
            <Row k={t("fl.apoapsis")} v={apText} />
            <Row k={t("fl.periapsis")} v={orbitInfo ? formatDistance(orbitInfo.pe) : "—"} warn={!!orbitInfo && orbitInfo.pe < 0} />
            <Row k={t("fl.dvLeft")} v={`${tel.dv.total.toFixed(0)} m/s`} />
            <Row k={t("fl.dynPress")} v={`${(tel.dynQ / 1000).toFixed(1)} kPa`} />
          </div>
          <div className="mt-2 space-y-1">
            <Bar label={t("fl.fuel")} value={tel.fuel / tel.fuelCap} color="#4da3ff" right={`${formatMass(tel.fuel)}`} />
            {tel.heat > 0.03 && <Bar label={t("fl.heat")} value={tel.heat} color={tel.heat > 0.7 ? "#ff4d4d" : "#ff8a1f"} right={`${heatPct}%`} />}
          </div>
        </div>
        <div className="flex flex-col items-center rounded-lg border border-[#222b39] bg-[#0d1218]/85 p-2 backdrop-blur">
          <canvas ref={navRef} width={168} height={168} style={{ width: 168, height: 168 }} />
          <div className="mt-1 flex w-full items-center justify-between gap-1">
            <HudButton
              onClick={() => {
                sim.speedSurface = !sim.speedSurface;
                const a = sim.active;
                if (a) a.sasSurface = sim.speedSurface;
                refresh();
              }}
              title={t("fl.refTip")}
            >
              {tel.speedSurface ? t("fl.refSurface") : t("fl.refOrbit")}
            </HudButton>
            <HudButton active={tel.rcs} accent="blue" onClick={() => v && ((v.rcsOn = !v.rcsOn), refresh())} title={t("fl.rcsTip")}>
              RCS
            </HudButton>
          </div>
          <div className="mt-1 grid grid-cols-4 gap-1">
            {SAS_MODES.map((m) => (
              <HudButton key={m} active={tel.sas === m} accent="blue" title={t(`sas.${m}.tip` as Key)} disabled={m === "maneuver" && !tel.node} onClick={() => setSas(m)} className="!px-1.5">
                {t(`sas.${m}` as Key)}
              </HudButton>
            ))}
          </div>
        </div>
      </div>

      {/* bottom: throttle */}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-end gap-3 rounded-lg border border-[#222b39] bg-[#0d1218]/85 px-4 py-2 backdrop-blur">
        <div className="flex flex-col items-center gap-1">
          <HudButton onClick={() => setThrottle(1)} title={t("fl.throttleMaxTip")}>
            {t("fl.throttleMax")}
          </HudButton>
          <HudButton onClick={() => setThrottle(0)} title={t("fl.throttleCutTip")}>
            {t("fl.throttleCut")}
          </HudButton>
        </div>
        <div className="w-44">
          <div className="mb-1 flex justify-between text-[10px] uppercase tracking-widest text-slate-500">
            <span>{t("fl.throttle")}</span>
            <span className="font-mono text-[#ffb066]">{Math.round(tel.throttle * 100)}%</span>
          </div>
          <input type="range" min={0} max={100} value={Math.round(tel.throttle * 100)} onChange={(e) => setThrottle(Number(e.target.value) / 100)} className="w-full accent-[#ff8a1f]" aria-label={t("fl.throttle")} />
          <div className="mt-1 text-[10px] text-slate-500">{t("fl.controlsHelp")}</div>
        </div>
        <div className="flex gap-1">
          <HudButton
            className="!px-4 !py-3 text-base"
            onPointerDown={() => (touchSteer.current = 1)}
            onPointerUp={() => (touchSteer.current = 0)}
            onPointerLeave={() => (touchSteer.current = 0)}
            title={t("fl.rotLeft")}
          >
            ⟲
          </HudButton>
          <HudButton
            className="!px-4 !py-3 text-base"
            onPointerDown={() => (touchSteer.current = -1)}
            onPointerUp={() => (touchSteer.current = 0)}
            onPointerLeave={() => (touchSteer.current = 0)}
            title={t("fl.rotRight")}
          >
            ⟳
          </HudButton>
        </div>
      </div>

      {nextStage === undefined && tel.hasVessel && false && <div />}

      {tel.lost && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70">
          <div className="max-w-sm rounded-xl border border-[#7a2b2b] bg-[#14090a] p-6 text-center">
            <div className="text-2xl font-black tracking-wide text-[#ff5d5d]">{t("fl.lostTitle")}</div>
            <div className="mt-2 text-sm text-slate-300">{tel.lost}</div>
            <div className="mt-5 flex justify-center gap-2">
              <button className="rounded-md bg-[#ff8a1f] px-4 py-2 text-sm font-bold text-[#1a0f02] hover:bg-[#ffa13d]" onClick={onRestart}>
                {t("fl.relaunch")}
              </button>
              <button className="rounded-md border border-[#2a3342] px-4 py-2 text-sm hover:border-slate-400" onClick={onRevert}>
                {t("fl.backToVab")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, big, warn }: { k: string; v: string; big?: boolean; warn?: boolean }) {
  return (
    <>
      <div className="text-slate-500">{k}</div>
      <div className={`text-right ${big ? "text-[13px] font-bold text-white" : "text-slate-200"} ${warn ? "!text-[#ff7b7b]" : ""}`}>{v}</div>
    </>
  );
}

function Bar({ label, value, color, right }: { label: string; value: number; color: string; right: string }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>{label}</span>
        <span className="font-mono">{right}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-[#1a212c]">
        <div className="h-full rounded" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

const BODIES_WITH_MOON = ["earth"];

function MapPanel(props: {
  sim: Simulation;
  tel: Telemetry;
  hohmannAlt: number;
  setHohmannAlt: (n: number) => void;
  onChange: () => void;
  focusName: string;
  onFocus: () => void;
  apText: string;
}) {
  const { sim, tel, onChange } = props;
  const { t } = useLang();
  const node = sim.node;
  const o = tel.orbit;
  const adj = (fn: () => void) => () => {
    fn();
    onChange();
  };
  const shiftTime = (dt: number) =>
    adj(() => {
      if (sim.node) sim.node.time = Math.max(sim.time + 5, sim.node.time + dt);
    });
  const bump = (key: "prograde" | "radial", d: number) =>
    adj(() => {
      if (sim.node && sim.node.burned === 0) sim.node[key] += d;
    });
  const small = "!px-1.5 !py-0.5";
  const shiftLabel = (s: number) => {
    const a = Math.abs(s);
    const [n, u] = a >= 86400 ? [a / 86400, t("unit.d")] : a >= 3600 ? [a / 3600, t("unit.h")] : a >= 60 ? [a / 60, t("unit.m")] : [a, t("unit.s")];
    return `${s < 0 ? "−" : "+"}${n}${u}`;
  };
  return (
    <div className="w-full rounded-lg border border-[#1d3a57] bg-[#0b1520]/90 p-2 backdrop-blur">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#8cc6ff]">{t("map.title", { body: tel.bodyName })}</div>
        <HudButton onClick={props.onFocus} title={t("map.focusTip")}>
          {t("map.focus", { name: props.focusName })}
        </HudButton>
      </div>
      {o && (
        <div className="mb-2 grid grid-cols-2 gap-x-3 font-mono text-[11px]">
          <span className="text-slate-500">{t("map.ecc")}</span>
          <span className="text-right">{o.e.toFixed(3)}</span>
          <span className="text-slate-500">{t("map.period")}</span>
          <span className="text-right">{o.hyperbolic ? "—" : formatTime(o.period)}</span>
          <span className="text-slate-500">{t("map.incl")}</span>
          <span className="text-right">{o.incl.toFixed(0)}° {o.incl === 0 ? t("map.pro") : t("map.retro")}</span>
        </div>
      )}
      {!node ? (
        <HudButton
          className="w-full"
          accent="blue"
          disabled={tel.landed || !tel.hasVessel}
          onClick={adj(() => sim.createNode())}
          title="N"
        >
          {t("map.createNode")}
        </HudButton>
      ) : (
        <div className="space-y-2 text-[11px]">
          <div className="flex justify-between font-mono">
            <span className="text-slate-500">{t("map.nodeIn")}</span>
            <span className="text-[#8cc6ff]">{formatTime(node.time - tel.time)}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {[-600, -60, -10, 10, 60, 600, 3600, 86400].map((s) => (
              <HudButton key={s} className={small} onClick={shiftTime(s)}>
                {shiftLabel(s)}
              </HudButton>
            ))}
          </div>
          <div className="flex gap-1">
            <HudButton className={small} onClick={adj(() => sim.snapNodeTo("pe"))}>{t("map.toPe")}</HudButton>
            <HudButton className={small} onClick={adj(() => sim.snapNodeTo("ap"))}>{t("map.toAp")}</HudButton>
          </div>
          <DvRow label={t("map.prograde")} value={node.prograde} onSet={(x) => adj(() => { if (sim.node) sim.node.prograde = x; })()} onBump={(d) => bump("prograde", d)()} />
          <DvRow label={t("map.radial")} value={node.radial} onSet={(x) => adj(() => { if (sim.node) sim.node.radial = x; })()} onBump={(d) => bump("radial", d)()} />
          <div className="rounded bg-[#10202f] p-1.5 font-mono">
            <div className="flex justify-between"><span className="text-slate-500">{t("map.totalDv")}</span><span>{tel.node ? tel.node.total.toFixed(1) : 0} m/s</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{t("map.remaining")}</span><span className="text-[#ffb066]">{tel.node ? tel.node.remaining.toFixed(1) : 0} m/s</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{t("map.burnTime")}</span><span>{tel.node && isFinite(tel.node.burnTime) ? formatTime(tel.node.burnTime) : t("map.noThrust")}</span></div>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={props.hohmannAlt}
              min={1}
              onChange={(e) => props.setHohmannAlt(Number(e.target.value))}
              className="w-16 rounded border border-[#2a3342] bg-[#0b0e13] px-1 py-0.5 font-mono text-[11px]"
              aria-label={t("map.targetAlt")}
            />
            <HudButton className={small} onClick={adj(() => sim.hohmannTo(props.hohmannAlt * 1000))} title={t("map.hohmannTip")}>
              {t("map.hohmann")}
            </HudButton>
          </div>
          {BODIES_WITH_MOON.includes(tel.bodyId) && (
            <HudButton className="w-full" accent="blue" onClick={adj(() => sim.planTransfer("moon"))} title={t("map.autoMoonTip")}>
              {t("map.autoMoon")}
            </HudButton>
          )}
          <div className="flex gap-1">
            <HudButton className="flex-1" accent="blue" onClick={adj(() => sim.warpToNode())}>{t("map.warpToNode")}</HudButton>
            <HudButton className="flex-1" onClick={adj(() => sim.deleteNode())}>{t("map.delete")}</HudButton>
          </div>
        </div>
      )}
      <div className="mt-2 text-[10px] leading-snug text-slate-500">{t("map.help")}</div>
    </div>
  );
}

function DvRow({ label, value, onSet, onBump }: { label: string; value: number; onSet: (x: number) => void; onBump: (d: number) => void }) {
  const { t } = useLang();
  const b = "!px-1.5 !py-0.5";
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-slate-400">{label}</span>
        <input
          type="number"
          value={Math.round(value * 10) / 10}
          onChange={(e) => onSet(Number(e.target.value) || 0)}
          className="w-20 rounded border border-[#2a3342] bg-[#0b0e13] px-1 py-0.5 text-right font-mono text-[11px]"
          aria-label={t("map.dvAria", { label })}
        />
      </div>
      <div className="flex gap-1">
        {[-100, -10, -1, 1, 10, 100].map((d) => (
          <HudButton key={d} className={b} onClick={() => onBump(d)}>
            {d > 0 ? "+" : "−"}
            {Math.abs(d)}
          </HudButton>
        ))}
      </div>
    </div>
  );
}
