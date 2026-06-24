import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "rpg-fitness-tracker-v1";
const ACCENT_PURPLE = "#7C3AED";
const ACCENT_GOLD = "#F59E0B";
const BG = "#0D0F1A";

const XP_PER_WEIGHT_LOG = 10;
const XP_PER_LIFT_LOG = 15;
const XP_PER_LEVEL = 250;

const KG_TO_LB = 2.20462;

const ACHIEVEMENT_DEFS = [
  {
    id: "first_pr",
    name: "First Blood",
    desc: "Set your first personal record.",
    check: (s) => s.totalPRs >= 1,
  },
  {
    id: "hundred_club",
    name: "100kg Club",
    desc: "Lift 100kg or more in a single set.",
    check: (s) => s.maxSingleLiftKg >= 100,
  },
  {
    id: "week_streak",
    name: "Iron Will",
    desc: "Log something 7 days in a row.",
    check: (s) => s.streak >= 7,
  },
  {
    id: "fifty_entries",
    name: "Veteran Warrior",
    desc: "Log 50 total entries.",
    check: (s) => s.totalEntries >= 50,
  },
  {
    id: "five_prs",
    name: "Record Breaker",
    desc: "Set 5 personal records.",
    check: (s) => s.totalPRs >= 5,
  },
  {
    id: "level_five",
    name: "Battle-Hardened",
    desc: "Reach Warrior Level 5.",
    check: (s) => s.level >= 5,
  },
];

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const toISODate = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  const off = dt.getTimezoneOffset();
  const local = new Date(dt.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
};

const daysAgoISO = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};

const fmtDate = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

function startOfWeek(iso) {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDay();
  const diff = (day + 6) % 7; // Monday start
  d.setDate(d.getDate() - diff);
  return toISODate(d);
}

function linearRegression(points) {
  // points: [{x: number, y: number}]
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: points[0].y };
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function rollingAverage(sortedEntries, windowDays = 7) {
  // sortedEntries: [{date, weight}] sorted ascending by date, may have multiple per day
  // returns map date(iso, day-level) -> avg of all entries within trailing windowDays (inclusive)
  const byDay = {};
  sortedEntries.forEach((e) => {
    if (!byDay[e.date]) byDay[e.date] = [];
    byDay[e.date].push(e.weight);
  });
  const days = Object.keys(byDay).sort();
  const dayAvg = days.map((d) => ({
    date: d,
    avg: byDay[d].reduce((a, b) => a + b, 0) / byDay[d].length,
  }));
  const msDay = 86400000;
  return dayAvg.map((d, i) => {
    const cutoff = new Date(d.date + "T00:00:00").getTime() - (windowDays - 1) * msDay;
    const within = dayAvg.filter(
      (x) => new Date(x.date + "T00:00:00").getTime() >= cutoff && x.date <= d.date
    );
    const avg = within.reduce((a, x) => a + x.avg, 0) / within.length;
    return { date: d.date, rollingAvg: avg };
  });
}

function epley1RM(weight, reps) {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

function toKg(weight, unit) {
  return unit === "lbs" ? weight / KG_TO_LB : weight;
}

/* ------------------------------------------------------------------ */
/* Seed data                                                          */
/* ------------------------------------------------------------------ */

function generateSeedData() {
  const weightEntries = [];
  const baseWeight = 84.5;
  for (let i = 21; i >= 0; i--) {
    const date = daysAgoISO(i);
    // skip some days entirely, double-log others
    const roll = Math.random();
    if (roll < 0.18) continue; // no entry that day
    const trend = -0.04 * (21 - i); // slowly losing weight
    const noise = (Math.random() - 0.5) * 1.1;
    const w1 = +(baseWeight + trend + noise).toFixed(1);
    weightEntries.push({ id: uid(), date, weight: w1 });
    if (roll > 0.85) {
      const w2 = +(w1 + (Math.random() - 0.5) * 0.6).toFixed(1);
      weightEntries.push({ id: uid(), date, weight: w2 });
    }
  }

  const liftDefs = [
    { name: "Bench Press", unit: "kg", start: 60, growth: 1.1 },
    { name: "Back Squat", unit: "kg", start: 80, growth: 1.6 },
    { name: "Deadlift", unit: "kg", start: 100, growth: 1.8 },
  ];

  const lifts = liftDefs.map((def) => {
    const entries = [];
    let weight = def.start;
    for (let i = 19; i >= 0; i -= 3) {
      const date = daysAgoISO(i);
      if (Math.random() < 0.15) continue;
      weight = +(weight + def.growth + (Math.random() - 0.4) * 1.2).toFixed(1);
      const reps = [5, 6, 8, 10][Math.floor(Math.random() * 4)];
      const sets = [3, 4, 5][Math.floor(Math.random() * 3)];
      entries.push({ id: uid(), date, weight, reps, sets });
    }
    return { id: uid(), name: def.name, unit: def.unit, entries };
  });

  return { weightEntries, lifts };
}

/* ------------------------------------------------------------------ */
/* Persistence                                                        */
/* ------------------------------------------------------------------ */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    /* ignore corrupt storage */
  }
  const seed = generateSeedData();
  return { ...seed, unlockedAchievements: [] };
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    /* storage full or unavailable */
  }
}

/* ------------------------------------------------------------------ */
/* Derived stats                                                      */
/* ------------------------------------------------------------------ */

function computeLiftStats(lift) {
  const sorted = [...lift.entries].sort((a, b) => a.date.localeCompare(b.date));
  let best1RM = 0;
  let bestEntryId = null;
  let prIds = new Set();
  let runningBest = 0;
  sorted.forEach((e) => {
    const oneRM = epley1RM(e.weight, e.reps);
    if (oneRM >= runningBest) {
      runningBest = oneRM;
      prIds.add(e.id);
    }
    if (oneRM > best1RM) {
      best1RM = oneRM;
      bestEntryId = e.id;
    }
  });
  const powerLevel = Math.round(best1RM);
  return { sorted, best1RM, bestEntryId, prIds, powerLevel };
}

function computeWarriorStats(weightEntries, lifts) {
  const totalWeightLogs = weightEntries.length;
  const totalLiftLogs = lifts.reduce((s, l) => s + l.entries.length, 0);
  const totalEntries = totalWeightLogs + totalLiftLogs;
  const totalXP = totalWeightLogs * XP_PER_WEIGHT_LOG + totalLiftLogs * XP_PER_LIFT_LOG;
  const level = Math.floor(totalXP / XP_PER_LEVEL) + 1;
  const xpIntoLevel = totalXP % XP_PER_LEVEL;
  const xpForNext = XP_PER_LEVEL;

  // streak: consecutive days (ending at most recent log date) with >=1 entry
  const allDates = new Set([
    ...weightEntries.map((e) => e.date),
    ...lifts.flatMap((l) => l.entries.map((e) => e.date)),
  ]);
  let streak = 0;
  if (allDates.size > 0) {
    const todayISO = toISODate(new Date());
    let cursor = allDates.has(todayISO) ? todayISO : null;
    if (!cursor) {
      // start from most recent logged day if today has no entry yet
      const sortedDates = [...allDates].sort().reverse();
      const mostRecent = sortedDates[0];
      const diffDays =
        (new Date(todayISO) - new Date(mostRecent)) / 86400000;
      if (diffDays <= 1) cursor = mostRecent;
    }
    if (cursor) {
      let d = new Date(cursor + "T00:00:00");
      while (allDates.has(toISODate(d))) {
        streak++;
        d.setDate(d.getDate() - 1);
      }
    }
  }

  // consistency: % of last 30 days with activity
  let activeDaysLast30 = 0;
  for (let i = 0; i < 30; i++) {
    if (allDates.has(daysAgoISO(i))) activeDaysLast30++;
  }
  const consistencyPct = Math.round((activeDaysLast30 / 30) * 100);

  const liftStatsList = lifts.map((l) => ({ lift: l, ...computeLiftStats(l) }));
  const totalPRs = liftStatsList.reduce((s, l) => s + l.prIds.size, 0);
  const maxSingleLiftKg = Math.max(
    0,
    ...lifts.flatMap((l) => l.entries.map((e) => toKg(e.weight, l.unit)))
  );
  const strScore = liftStatsList.length
    ? Math.round(
        liftStatsList.reduce((s, l) => s + l.best1RM, 0) / liftStatsList.length
      )
    : 0;
  const pwrScore = liftStatsList.reduce((s, l) => s + l.powerLevel, 0);

  // this week XP
  const thisWeekStart = startOfWeek(toISODate(new Date()));
  const weeklyXP =
    weightEntries.filter((e) => e.date >= thisWeekStart).length * XP_PER_WEIGHT_LOG +
    lifts
      .flatMap((l) => l.entries)
      .filter((e) => e.date >= thisWeekStart).length *
      XP_PER_LIFT_LOG;

  return {
    totalEntries,
    totalXP,
    level,
    xpIntoLevel,
    xpForNext,
    streak,
    consistencyPct,
    liftStatsList,
    totalPRs,
    maxSingleLiftKg,
    strScore,
    pwrScore,
    weeklyXP,
  };
}

function weightTrend(weightEntries) {
  const sorted = [...weightEntries].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return { direction: "no data", slopePerWeek: 0, points: [] };
  const t0 = new Date(sorted[0].date + "T00:00:00").getTime();
  const points = sorted.map((e) => ({
    x: (new Date(e.date + "T00:00:00").getTime() - t0) / 86400000,
    y: e.weight,
  }));
  const { slope, intercept } = linearRegression(points);
  const slopePerWeek = slope * 7;
  let direction = "maintaining";
  if (slopePerWeek > 0.15) direction = "gaining";
  else if (slopePerWeek < -0.15) direction = "losing";
  return { direction, slopePerWeek, slope, intercept, t0, sorted };
}

/* ------------------------------------------------------------------ */
/* UI bits                                                            */
/* ------------------------------------------------------------------ */

function StatBar({ label, value, max, color }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="mb-3">
      <div className="flex justify-between font-mono text-xs text-gray-300 mb-1">
        <span className="tracking-wider">{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-3 w-full rounded-full bg-black/40 border border-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}, ${color}aa)`,
            boxShadow: `0 0 8px ${color}`,
          }}
        />
      </div>
    </div>
  );
}

function XPBar({ xpIntoLevel, xpForNext, level }) {
  const pct = Math.max(0, Math.min(100, (xpIntoLevel / xpForNext) * 100));
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="font-display text-sm text-amber-400 tracking-widest">
          LV. {level}
        </span>
        <span className="font-mono text-xs text-gray-400">
          {xpIntoLevel} / {xpForNext} XP
        </span>
      </div>
      <div className="h-4 w-full rounded-full bg-black/50 border border-amber-500/40 overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${ACCENT_GOLD}, #fff3c4)`,
            boxShadow: `0 0 12px ${ACCENT_GOLD}`,
          }}
        />
      </div>
    </div>
  );
}

function GlowCard({ children, className = "" }) {
  return (
    <div
      className={`rounded-xl border border-purple-500/30 bg-white/[0.03] p-4 shadow-[0_0_20px_rgba(124,58,237,0.08)] ${className}`}
    >
      {children}
    </div>
  );
}

function PRToast({ event, onDone }) {
  useEffect(() => {
    if (!event) return;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [event, onDone]);
  if (!event) return null;
  return (
    <div className="fixed top-6 right-6 z-50 animate-[prdrop_0.5s_ease-out]">
      <div
        className="rounded-lg border-2 px-5 py-4 font-display text-center"
        style={{
          borderColor: ACCENT_GOLD,
          background: "rgba(13,15,26,0.95)",
          boxShadow: `0 0 30px ${ACCENT_GOLD}`,
        }}
      >
        <div className="text-amber-400 text-xs tracking-[0.3em] mb-1">
          NEW PERSONAL RECORD
        </div>
        <div className="text-white text-lg">{event.liftName}</div>
        <div className="text-purple-300 text-sm font-mono">
          1RM: {event.oneRM.toFixed(1)} kg
        </div>
      </div>
    </div>
  );
}

function LevelUpFlash({ show, level, onDone }) {
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, [show, onDone]);
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-[fadeOut_1.8s_ease-out]">
      <div className="text-center animate-[levelpop_0.6s_ease-out]">
        <div
          className="font-display text-6xl tracking-widest"
          style={{ color: ACCENT_GOLD, textShadow: `0 0 30px ${ACCENT_GOLD}` }}
        >
          LEVEL UP!
        </div>
        <div className="font-display text-3xl text-purple-300 mt-2">
          Warrior Level {level}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Weight Tab                                                          */
/* ------------------------------------------------------------------ */

function WeightTab({ weightEntries, addWeightEntry }) {
  const [date, setDate] = useState(toISODate(new Date()));
  const [weight, setWeight] = useState("");

  const sorted = useMemo(
    () => [...weightEntries].sort((a, b) => a.date.localeCompare(b.date)),
    [weightEntries]
  );
  const trend = useMemo(() => weightTrend(weightEntries), [weightEntries]);
  const rolling = useMemo(() => rollingAverage(sorted), [sorted]);

  const chartData = useMemo(() => {
    const rollMap = {};
    rolling.forEach((r) => (rollMap[r.date] = r.rollingAvg));
    const days = [...new Set(sorted.map((e) => e.date))].sort();
    return days.map((d) => {
      const dayEntries = sorted.filter((e) => e.date === d);
      const avg = dayEntries.reduce((a, e) => a + e.weight, 0) / dayEntries.length;
      const dayIndex =
        (new Date(d + "T00:00:00").getTime() - (trend.t0 || 0)) / 86400000;
      const trendVal =
        trend.slope !== undefined ? trend.slope * dayIndex + trend.intercept : null;
      return {
        date: d,
        label: fmtDate(d),
        weight: +avg.toFixed(2),
        rollingAvg: rollMap[d] ? +rollMap[d].toFixed(2) : null,
        trendLine: trendVal !== null ? +trendVal.toFixed(2) : null,
      };
    });
  }, [sorted, rolling, trend]);

  const grouped = useMemo(() => {
    const map = {};
    sorted.forEach((e) => {
      const wk = startOfWeek(e.date);
      if (!map[wk]) map[wk] = [];
      map[wk].push(e);
    });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [sorted]);

  const directionColor =
    trend.direction === "losing"
      ? "text-emerald-400"
      : trend.direction === "gaining"
      ? "text-rose-400"
      : "text-amber-400";

  return (
    <div className="space-y-6">
      <GlowCard>
        <h3 className="font-display text-lg text-purple-300 mb-3">Log Weigh-In</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-mono text-gray-400 mb-1">Date</label>
            <input
              type="date"
              value={date}
              max={toISODate(new Date())}
              onChange={(e) => setDate(e.target.value)}
              className="bg-black/40 border border-white/20 rounded px-3 py-2 text-sm text-white font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-gray-400 mb-1">
              Weight (kg)
            </label>
            <input
              type="number"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="84.5"
              className="bg-black/40 border border-white/20 rounded px-3 py-2 text-sm text-white font-mono w-28"
            />
          </div>
          <button
            onClick={() => {
              const w = parseFloat(weight);
              if (!w || !date) return;
              addWeightEntry(date, w);
              setWeight("");
            }}
            className="bg-purple-600 hover:bg-purple-500 transition rounded px-4 py-2 text-sm font-display text-white shadow-[0_0_12px_rgba(124,58,237,0.6)]"
          >
            + Log Weight
          </button>
        </div>
      </GlowCard>

      <GlowCard>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-display text-lg text-purple-300">Weight Over Time</h3>
          <div className={`font-mono text-sm ${directionColor}`}>
            Trend: {trend.direction} ({trend.slopePerWeek >= 0 ? "+" : ""}
            {trend.slopePerWeek.toFixed(2)} kg/wk)
          </div>
        </div>
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid stroke="#ffffff15" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
              <YAxis stroke="#9ca3af" fontSize={11} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{
                  background: "#13152499",
                  border: "1px solid #7C3AED55",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="weight"
                name="Daily avg"
                stroke="#6b7280"
                strokeWidth={1.5}
                dot={{ r: 2 }}
              />
              <Line
                type="monotone"
                dataKey="rollingAvg"
                name="7-day avg"
                stroke={ACCENT_PURPLE}
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="linear"
                dataKey="trendLine"
                name="Trend"
                stroke={ACCENT_GOLD}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </GlowCard>

      <GlowCard>
        <h3 className="font-display text-lg text-purple-300 mb-3">Entries by Week</h3>
        <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
          {grouped.map(([wk, entries]) => (
            <div key={wk}>
              <div className="text-xs font-mono text-amber-400 mb-1">
                Week of {fmtDate(wk)}
              </div>
              <div className="space-y-1">
                {entries
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((e) => (
                    <div
                      key={e.id}
                      className="flex justify-between text-sm font-mono text-gray-300 border-b border-white/5 py-1"
                    >
                      <span>{fmtDate(e.date)}</span>
                      <span className="text-white">{e.weight.toFixed(1)} kg</span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
          {grouped.length === 0 && (
            <div className="text-gray-500 text-sm font-mono">No entries yet.</div>
          )}
        </div>
      </GlowCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lift Tab                                                            */
/* ------------------------------------------------------------------ */

function LiftTab({ lifts, addLift, addLiftEntry }) {
  const [selectedId, setSelectedId] = useState(lifts[0]?.id || null);
  const [newLiftName, setNewLiftName] = useState("");
  const [date, setDate] = useState(toISODate(new Date()));
  const [sets, setSets] = useState("");
  const [reps, setReps] = useState("");
  const [weight, setWeight] = useState("");

  useEffect(() => {
    if (!selectedId && lifts.length) setSelectedId(lifts[0].id);
  }, [lifts, selectedId]);

  const lift = lifts.find((l) => l.id === selectedId);
  const stats = lift ? computeLiftStats(lift) : null;

  const chartData = useMemo(() => {
    if (!stats) return [];
    return stats.sorted.map((e) => ({
      label: fmtDate(e.date),
      oneRM: +epley1RM(e.weight, e.reps).toFixed(1),
      weight: e.weight,
    }));
  }, [stats]);

  const toggleUnit = (lift) => {
    addLiftEntry(lift.id, null, null, null, null, lift.unit === "kg" ? "lbs" : "kg");
  };

  return (
    <div className="space-y-6">
      <GlowCard>
        <h3 className="font-display text-lg text-purple-300 mb-3">Exercises</h3>
        <div className="flex flex-wrap gap-2 mb-4">
          {lifts.map((l) => {
            const s = computeLiftStats(l);
            return (
              <button
                key={l.id}
                onClick={() => setSelectedId(l.id)}
                className={`px-3 py-2 rounded-lg border font-mono text-sm transition ${
                  selectedId === l.id
                    ? "border-amber-400 bg-amber-400/10 text-amber-300"
                    : "border-white/15 text-gray-300 hover:border-purple-400/60"
                }`}
              >
                {l.name}{" "}
                <span className="text-purple-400">PWR {s.powerLevel}</span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <input
            value={newLiftName}
            onChange={(e) => setNewLiftName(e.target.value)}
            placeholder="New exercise name"
            className="bg-black/40 border border-white/20 rounded px-3 py-2 text-sm text-white font-mono flex-1"
          />
          <button
            onClick={() => {
              if (!newLiftName.trim()) return;
              addLift(newLiftName.trim());
              setNewLiftName("");
            }}
            className="bg-purple-600 hover:bg-purple-500 transition rounded px-4 py-2 text-sm font-display text-white"
          >
            + Add Exercise
          </button>
        </div>
      </GlowCard>

      {lift && stats && (
        <>
          <GlowCard>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-display text-lg text-purple-300">
                Log Set &mdash; {lift.name}
              </h3>
              <button
                onClick={() => toggleUnit(lift)}
                className="text-xs font-mono px-2 py-1 rounded border border-white/20 text-gray-300 hover:border-amber-400"
              >
                Unit: {lift.unit.toUpperCase()} (toggle)
              </button>
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  max={toISODate(new Date())}
                  onChange={(e) => setDate(e.target.value)}
                  className="bg-black/40 border border-white/20 rounded px-3 py-2 text-sm text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Sets</label>
                <input
                  type="number"
                  value={sets}
                  onChange={(e) => setSets(e.target.value)}
                  className="bg-black/40 border border-white/20 rounded px-3 py-2 text-sm text-white font-mono w-20"
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Reps</label>
                <input
                  type="number"
                  value={reps}
                  onChange={(e) => setReps(e.target.value)}
                  className="bg-black/40 border border-white/20 rounded px-3 py-2 text-sm text-white font-mono w-20"
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">
                  Weight ({lift.unit})
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="bg-black/40 border border-white/20 rounded px-3 py-2 text-sm text-white font-mono w-24"
                />
              </div>
              <button
                onClick={() => {
                  const w = parseFloat(weight);
                  const r = parseInt(reps);
                  const s = parseInt(sets);
                  if (!w || !r || !s) return;
                  addLiftEntry(lift.id, date, s, r, w);
                  setSets("");
                  setReps("");
                  setWeight("");
                }}
                className="bg-amber-500 hover:bg-amber-400 transition rounded px-4 py-2 text-sm font-display text-black shadow-[0_0_12px_rgba(245,158,11,0.6)]"
              >
                + Log Set
              </button>
            </div>
          </GlowCard>

          <GlowCard>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-display text-lg text-purple-300">Progress</h3>
              <div className="font-mono text-sm text-amber-400">
                Est. 1RM: {stats.best1RM.toFixed(1)} kg
              </div>
            </div>
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid stroke="#ffffff15" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{
                      background: "#13152499",
                      border: "1px solid #7C3AED55",
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="oneRM"
                    name="Est. 1RM"
                    stroke={ACCENT_GOLD}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="weight"
                    name="Set weight"
                    stroke={ACCENT_PURPLE}
                    strokeWidth={1.5}
                    dot={{ r: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </GlowCard>

          <GlowCard>
            <h3 className="font-display text-lg text-purple-300 mb-3">History</h3>
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {[...stats.sorted].reverse().map((e) => (
                <div
                  key={e.id}
                  className="flex justify-between items-center text-sm font-mono text-gray-300 border-b border-white/5 py-1"
                >
                  <span>{fmtDate(e.date)}</span>
                  <span>
                    {e.sets}x{e.reps} @ {e.weight}
                    {lift.unit}
                  </span>
                  <span className="text-gray-500">
                    1RM {epley1RM(e.weight, e.reps).toFixed(1)}
                  </span>
                  {e.id === stats.bestEntryId && (
                    <span className="text-amber-400 font-display text-xs px-2 py-0.5 rounded border border-amber-400/60 bg-amber-400/10">
                      PR
                    </span>
                  )}
                </div>
              ))}
              {stats.sorted.length === 0 && (
                <div className="text-gray-500 text-sm font-mono">No sets logged yet.</div>
              )}
            </div>
          </GlowCard>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Character Sheet Tab                                                */
/* ------------------------------------------------------------------ */

function CharacterSheetTab({ stats, weightEntries }) {
  const trend = useMemo(() => weightTrend(weightEntries), [weightEntries]);
  return (
    <div className="space-y-6">
      <GlowCard>
        <h3 className="font-display text-xl text-amber-400 mb-4 tracking-wider">
          WARRIOR STATUS
        </h3>
        <XPBar
          xpIntoLevel={stats.xpIntoLevel}
          xpForNext={stats.xpForNext}
          level={stats.level}
        />
        <div className="mt-2 font-mono text-xs text-gray-400">
          This week: +{stats.weeklyXP} XP earned
        </div>
      </GlowCard>

      <GlowCard>
        <h3 className="font-display text-lg text-purple-300 mb-4">Character Stats</h3>
        <StatBar label="STR (avg 1RM)" value={stats.strScore} max={250} color={ACCENT_GOLD} />
        <StatBar label="PWR (total power)" value={stats.pwrScore} max={600} color={ACCENT_PURPLE} />
        <StatBar
          label="CONSISTENCY"
          value={stats.consistencyPct}
          max={100}
          color="#22d3ee"
        />
        <StatBar label="STREAK (days)" value={stats.streak} max={30} color="#f472b6" />
        <div className="grid grid-cols-2 gap-4 mt-4 font-mono text-sm">
          <div className="rounded-lg bg-black/30 border border-white/10 p-3">
            <div className="text-gray-400 text-xs">Total Entries</div>
            <div className="text-white text-lg">{stats.totalEntries}</div>
          </div>
          <div className="rounded-lg bg-black/30 border border-white/10 p-3">
            <div className="text-gray-400 text-xs">Total PRs</div>
            <div className="text-amber-400 text-lg">{stats.totalPRs}</div>
          </div>
          <div className="rounded-lg bg-black/30 border border-white/10 p-3">
            <div className="text-gray-400 text-xs">Weight Trend</div>
            <div className="text-white text-lg capitalize">{trend.direction}</div>
          </div>
          <div className="rounded-lg bg-black/30 border border-white/10 p-3">
            <div className="text-gray-400 text-xs">Total XP</div>
            <div className="text-purple-300 text-lg">{stats.totalXP}</div>
          </div>
        </div>
      </GlowCard>

      <GlowCard>
        <h3 className="font-display text-lg text-purple-300 mb-3">Per-Lift Power</h3>
        <div className="space-y-3">
          {stats.liftStatsList.map((l) => (
            <div key={l.lift.id}>
              <StatBar
                label={l.lift.name}
                value={l.powerLevel}
                max={250}
                color={ACCENT_PURPLE}
              />
            </div>
          ))}
          {stats.liftStatsList.length === 0 && (
            <div className="text-gray-500 text-sm font-mono">No exercises yet.</div>
          )}
        </div>
      </GlowCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Achievements Tab                                                    */
/* ------------------------------------------------------------------ */

function AchievementsTab({ stats, unlocked }) {
  return (
    <GlowCard>
      <h3 className="font-display text-lg text-purple-300 mb-4">Achievements</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        {ACHIEVEMENT_DEFS.map((a) => {
          const isUnlocked = unlocked.includes(a.id);
          return (
            <div
              key={a.id}
              className={`rounded-lg border p-3 transition ${
                isUnlocked
                  ? "border-amber-400/70 bg-amber-400/10 shadow-[0_0_15px_rgba(245,158,11,0.25)]"
                  : "border-white/10 bg-black/20 opacity-50"
              }`}
            >
              <div className="font-display text-sm text-white flex items-center gap-2">
                {isUnlocked ? "🏆" : "🔒"} {a.name}
              </div>
              <div className="text-xs font-mono text-gray-400 mt-1">{a.desc}</div>
            </div>
          );
        })}
      </div>
    </GlowCard>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function FitnessRPGApp() {
  const [state, setState] = useState(() => loadState());
  const [tab, setTab] = useState("sheet");
  const [prEvent, setPrEvent] = useState(null);
  const [levelUp, setLevelUp] = useState(null);
  const prevLevelRef = useRef(null);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const stats = useMemo(
    () => computeWarriorStats(state.weightEntries, state.lifts),
    [state.weightEntries, state.lifts]
  );

  useEffect(() => {
    if (prevLevelRef.current === null) {
      prevLevelRef.current = stats.level;
      return;
    }
    if (stats.level > prevLevelRef.current) {
      setLevelUp(stats.level);
    }
    prevLevelRef.current = stats.level;
  }, [stats.level]);

  useEffect(() => {
    const unlocked = new Set(state.unlockedAchievements);
    const newly = ACHIEVEMENT_DEFS.filter(
      (a) => !unlocked.has(a.id) && a.check(stats)
    );
    if (newly.length) {
      setState((s) => ({
        ...s,
        unlockedAchievements: [...s.unlockedAchievements, ...newly.map((a) => a.id)],
      }));
    }
  }, [stats]);

  const addWeightEntry = (date, weight) => {
    setState((s) => ({
      ...s,
      weightEntries: [...s.weightEntries, { id: uid(), date, weight }],
    }));
  };

  const addLift = (name) => {
    setState((s) => ({
      ...s,
      lifts: [...s.lifts, { id: uid(), name, unit: "kg", entries: [] }],
    }));
  };

  const addLiftEntry = (liftId, date, sets, reps, weight, newUnit) => {
    setState((s) => {
      const lifts = s.lifts.map((l) => {
        if (l.id !== liftId) return l;
        if (newUnit) return { ...l, unit: newUnit };
        const before = computeLiftStats(l).best1RM;
        const entry = { id: uid(), date, sets, reps, weight };
        const updated = { ...l, entries: [...l.entries, entry] };
        const after = computeLiftStats(updated);
        const newOneRM = epley1RM(weight, reps);
        if (newOneRM >= before) {
          setPrEvent({ liftName: l.name, oneRM: newOneRM, key: entry.id });
        }
        return updated;
      });
      return { ...s, lifts };
    });
  };

  const tabs = [
    { id: "sheet", label: "Character Sheet" },
    { id: "weight", label: "Bodyweight" },
    { id: "lifts", label: "Lifts" },
    { id: "achievements", label: "Achievements" },
  ];

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: BG, color: "#e5e7eb" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=JetBrains+Mono:wght@400;600&display=swap');
        .font-display { font-family: 'Press Start 2P', 'JetBrains Mono', monospace; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        @keyframes prdrop {
          0% { transform: translateY(-40px) scale(0.8); opacity: 0; }
          60% { transform: translateY(8px) scale(1.05); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes levelpop {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes fadeOut {
          0%, 70% { opacity: 1; }
          100% { opacity: 0; }
        }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); }
      `}</style>

      <header className="border-b border-purple-500/20 px-6 py-5 sticky top-0 bg-[#0D0F1A]/95 backdrop-blur z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <h1
            className="font-display text-xl md:text-2xl text-white tracking-wide"
            style={{ textShadow: `0 0 12px ${ACCENT_PURPLE}` }}
          >
            ⚔ IRON QUEST
          </h1>
          <div className="font-mono text-sm text-amber-400">
            Warrior LV {stats.level} · 🔥 {stats.streak} day streak
          </div>
        </div>
      </header>

      <nav className="max-w-4xl mx-auto px-6 mt-4 flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg font-display text-xs transition border ${
              tab === t.id
                ? "border-amber-400 text-amber-300 bg-amber-400/10 shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                : "border-white/10 text-gray-400 hover:border-purple-400/50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-6">
        {tab === "sheet" && (
          <CharacterSheetTab stats={stats} weightEntries={state.weightEntries} />
        )}
        {tab === "weight" && (
          <WeightTab
            weightEntries={state.weightEntries}
            addWeightEntry={addWeightEntry}
          />
        )}
        {tab === "lifts" && (
          <LiftTab lifts={state.lifts} addLift={addLift} addLiftEntry={addLiftEntry} />
        )}
        {tab === "achievements" && (
          <AchievementsTab stats={stats} unlocked={state.unlockedAchievements} />
        )}
      </main>

      <PRToast event={prEvent} onDone={() => setPrEvent(null)} />
      <LevelUpFlash
        show={!!levelUp}
        level={levelUp}
        onDone={() => setLevelUp(null)}
      />
    </div>
  );
}
