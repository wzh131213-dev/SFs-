"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Blueprint } from "@/game/core/types";
import { formatMass } from "@/game/core/math";
import { blueprintStats } from "@/game/flight/vessel";
import { PRESETS, parseBlueprint, serializeBlueprint } from "@/game/vab/blueprint";
import { LangSwitch, useLang } from "@/i18n/react";
import { vesselName } from "@/i18n/game";
import FlightScreen from "./FlightScreen";
import VabScreen from "./VabScreen";

type Screen = "menu" | "vab" | "flight";
const STORAGE_KEY = "orbital.blueprint.v1";

export default function GameApp() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [bp, setBp] = useState<Blueprint>(PRESETS[1]);
  const [flightKey, setFlightKey] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setBp(parseBlueprint(raw));
    } catch {
      /* ignore corrupt local save */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, serializeBlueprint(bp));
    } catch {
      /* storage may be unavailable */
    }
  }, [bp, ready]);

  const launch = useCallback((b?: Blueprint) => {
    if (b) setBp(b);
    setFlightKey((k) => k + 1);
    setScreen("flight");
  }, []);

  if (screen === "vab") {
    return <VabScreen bp={bp} onChange={setBp} onLaunch={() => launch()} onMenu={() => setScreen("menu")} />;
  }
  if (screen === "flight") {
    return <FlightScreen key={flightKey} bp={bp} onRevert={() => setScreen("vab")} onRestart={() => launch()} onMenu={() => setScreen("menu")} />;
  }
  return (
    <MainMenu
      current={bp}
      onVab={(b) => {
        if (b) setBp(b);
        setScreen("vab");
      }}
      onLaunch={launch}
    />
  );
}

function MainMenu({ current, onVab, onLaunch }: { current: Blueprint; onVab: (b?: Blueprint) => void; onLaunch: (b?: Blueprint) => void }) {
  const { t } = useLang();
  const cards = useMemo(() => PRESETS.map((p) => ({ bp: p, stats: blueprintStats(p) })), []);
  const curStats = useMemo(() => blueprintStats(current), [current]);
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07090d] text-slate-200">
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ backgroundImage: "radial-gradient(1px 1px at 20% 30%, #fff 50%, transparent), radial-gradient(1px 1px at 70% 20%, #fff 50%, transparent), radial-gradient(1.5px 1.5px at 40% 70%, #cfe3ff 50%, transparent), radial-gradient(1px 1px at 85% 60%, #fff 50%, transparent), radial-gradient(1px 1px at 10% 80%, #fff 50%, transparent), radial-gradient(1px 1px at 55% 45%, #fff 50%, transparent)" }} />
      <div className="pointer-events-none absolute -bottom-[55vh] left-1/2 h-[90vh] w-[160vw] -translate-x-1/2 rounded-full bg-gradient-to-b from-[#3f9b59] to-[#1d4d2d] shadow-[0_-30px_120px_rgba(110,180,255,0.35)]" />
      <div className="relative mx-auto flex max-w-5xl flex-col px-6 py-14">
        <div className="absolute right-6 top-5">
          <LangSwitch />
        </div>
        <div className="text-[11px] font-bold uppercase tracking-[0.4em] text-[#4da3ff]">{t("menu.tagline")}</div>
        <h1 className="mt-2 text-5xl font-black tracking-tight text-white sm:text-6xl">
          ORBITAL<span className="text-[#ff8a1f]">·</span>FLIGHT
        </h1>
        <p className="mt-4 max-w-2xl text-slate-400">
          {t("menu.intro")}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button className="rounded-lg bg-[#ff8a1f] px-6 py-3 text-sm font-black tracking-wide text-[#1a0f02] shadow-lg shadow-[#ff8a1f]/20 hover:bg-[#ffa13d]" onClick={() => onVab()}>
            {t("menu.openVab", { name: vesselName(current.name) })}
          </button>
          <button className="rounded-lg border border-[#2a3342] bg-[#10151d]/80 px-6 py-3 text-sm font-bold hover:border-[#4da3ff]" onClick={() => onLaunch()}>
            {t("menu.launchCurrent")}
          </button>
          {curStats && (
            <div className="self-center text-xs text-slate-500">
              {t("menu.currentStats", { parts: curStats.parts, mass: formatMass(curStats.mass), dv: curStats.dv.total.toFixed(0) })}
            </div>
          )}
        </div>

        <h2 className="mt-12 text-xs font-bold uppercase tracking-[0.3em] text-slate-400">{t("menu.starter")}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {cards.map(({ bp, stats }) => (
            <div key={bp.name} className="rounded-xl border border-[#1f2835] bg-[#0d1218]/90 p-4 backdrop-blur">
              <div className="text-lg font-bold text-white">{vesselName(bp.name)}</div>
              <div className="mt-1 text-xs text-slate-500">
                {t("menu.cardParts", { parts: bp.parts.length, mass: stats ? formatMass(stats.mass) : "" })}
              </div>
              {stats && (
                <div className="mt-3 grid grid-cols-2 gap-1 font-mono text-[11px]">
                  <span className="text-slate-500">{t("menu.dv")}</span>
                  <span className="text-right text-[#4da3ff]">{stats.dv.total.toFixed(0)} m/s</span>
                  <span className="text-slate-500">{t("menu.launchTwr")}</span>
                  <span className="text-right">{stats.twr.toFixed(2)}</span>
                  <span className="text-slate-500">{t("menu.stages")}</span>
                  <span className="text-right">{stats.dv.stages.length}</span>
                </div>
              )}
              <div className="mt-4 flex gap-2">
                <button className="flex-1 rounded-md bg-[#ff8a1f] py-1.5 text-xs font-bold text-[#1a0f02] hover:bg-[#ffa13d]" onClick={() => onLaunch(bp)}>
                  {t("menu.launch")}
                </button>
                <button className="flex-1 rounded-md border border-[#2a3342] py-1.5 text-xs hover:border-[#4da3ff]" onClick={() => onVab(bp)}>
                  {t("menu.edit")}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-4 rounded-xl border border-[#1f2835] bg-[#0d1218]/90 p-5 text-xs text-slate-400 backdrop-blur sm:grid-cols-3">
          <div>
            <div className="mb-1 font-bold uppercase tracking-widest text-[#ff8a1f]">{t("menu.flight")}</div>
            {t("menu.flightHelp")}
          </div>
          <div>
            <div className="mb-1 font-bold uppercase tracking-widest text-[#4da3ff]">{t("menu.nav")}</div>
            {t("menu.navHelp")}
          </div>
          <div>
            <div className="mb-1 font-bold uppercase tracking-widest text-[#6ee7a8]">{t("menu.tips")}</div>
            {t("menu.tipsHelp")}
          </div>
        </div>
      </div>
    </div>
  );
}
