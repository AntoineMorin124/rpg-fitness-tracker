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

const STORAGE_KEY = "rpg-fitness-tracker-v2";
const ACCENT_PURPLE = "#7C3AED";
const ACCENT_GOLD = "#F59E0B";
const BG = "#0D0F1A";

const XP_PER_SET_LOG = 12;
const XP_PER_LEVEL = 250;

const VALID_USERNAME = "warrior";
const VALID_PASSWORD = "ironquest";

const EXERCISE_LIST = [
  "Squat",
  "Bench Press",
  "Deadlift",
  "Pull Up",
  "Chin Up",
  "Lat Pulldown",
  "Dumbbell Rows",
  "Bicep Curl",
  "Hammer Curl",
  "Lunges",
  "Quad Extension",
  "Hamstring Curl",
  "Plank",
  "Chair Hold",
];

const TIME_BASED_EXERCISES = new Set(["Plank", "Chair Hold"]);

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
    desc: "Log 50 total sets.",
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

function epley1RM(weight, reps) {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

function lerpColor(hex1, hex2, t) {
  const c1 = hex1.match(/\w\w/g).map((x) => parseInt(x, 16));
  const c2 = hex2.match(/\w\w/g).map((x) => parseInt(x, 16));
  const c = c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/* ------------------------------------------------------------------ */
/* Seed data                                                          */
/* ------------------------------------------------------------------ */

function generateSeedData() {
  const weightEntries = [];
  const baseWeight = 84.5;
  for (let i = 21; i >= 0; i--) {
    const date = daysAgoISO(i);
    const roll = Math.random();
    if (roll < 0.18) continue;
    const trend = -0.04 * (21 - i);
    const noise = (Math.random() - 0.5) * 1.1;
    const w1 = +(baseWeight + trend + noise).toFixed(1);
    weightEntries.push({ id: uid(), date, weight: w1 });
    if (roll > 0.85) {
      const w2 = +(w1 + (Math.random() - 0.5) * 0.6).toFixed(1);
      weightEntries.push({ id: uid(), date, weight: w2 });
    }
  }

  const liftDefs = [
    { name: "Bench Press", start: 60, growth: 1.1 },
    { name: "Squat", start: 80, growth: 1.6 },
    { name: "Deadlift", start: 100, growth: 1.8 },
  ];
  const progress = {};
  liftDefs.forEach((d) => (progress[d.name] = d.start));

  const workouts = [];
  for (let i = 19; i >= 0; i -= 3) {
    const date = daysAgoISO(i);
    if (Math.random() < 0.1) continue;
    const exercises = liftDefs
      .filter(() => Math.random() > 0.15)
      .map((def) => {
        progress[def.name] = +(
          progress[def.name] +
          def.growth +
          (Math.random() - 0.4) * 1.2
        ).toFixed(1);
        const reps = [5, 6, 8, 10][Math.floor(Math.random() * 4)];
        const setCount = [3, 4][Math.floor(Math.random() * 2)];
        const sets = Array.from({ length: setCount }, () => ({
          id: uid(),
          reps,
          weight: progress[def.name],
        }));
        return { id: uid(), name: def.name, sets };
      });
    if (Math.random() > 0.5) {
      exercises.push({
        id: uid(),
        name: "Plank",
        sets: [{ id: uid(), durationSec: 30 + Math.round(Math.random() * 60) }],
      });
    }
    if (exercises.length) {
      workouts.push({ id: uid(), date, exercises });
    }
  }

  return { weightEntries, workouts };
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

function flattenExerciseSets(workouts, exerciseName) {
  const out = [];
  workouts.forEach((w) => {
    w.exercises
      .filter((ex) => ex.name === exerciseName)
      .forEach((ex) => {
        ex.sets.forEach((s) => out.push({ ...s, date: w.date }));
      });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function computeExerciseStats(name, sorted) {
  const isTimeBased = TIME_BASED_EXERCISES.has(name);
  let best = 0;
  let bestId = null;
  const prIds = new Set();
  let runningBest = 0;
  sorted.forEach((e) => {
    const metric = isTimeBased ? e.durationSec : epley1RM(e.weight, e.reps);
    if (metric >= runningBest) {
      runningBest = metric;
      prIds.add(e.id);
    }
    if (metric > best) {
      best = metric;
      bestId = e.id;
    }
  });
  const powerLevel = Math.round(best);
  return { sorted, best, bestId, prIds, powerLevel, isTimeBased };
}

function computeWarriorStats(weightEntries, workouts) {
  const allSets = [];
  workouts.forEach((w) =>
    w.exercises.forEach((ex) =>
      ex.sets.forEach((s) => allSets.push({ ...s, date: w.date, name: ex.name }))
    )
  );
  const totalEntries = allSets.length;
  const totalXP = totalEntries * XP_PER_SET_LOG;
  const level = Math.floor(totalXP / XP_PER_LEVEL) + 1;
  const xpIntoLevel = totalXP % XP_PER_LEVEL;
  const xpForNext = XP_PER_LEVEL;

  const allDates = new Set([
    ...weightEntries.map((e) => e.date),
    ...workouts.map((w) => w.date),
  ]);
  let streak = 0;
  if (allDates.size > 0) {
    const todayISO = toISODate(new Date());
    let cursor = allDates.has(todayISO) ? todayISO : null;
    if (!cursor) {
      const sortedDates = [...allDates].sort().reverse();
      const mostRecent = sortedDates[0];
      const diffDays = (new Date(todayISO) - new Date(mostRecent)) / 86400000;
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

  let activeDaysLast30 = 0;
  for (let i = 0; i < 30; i++) {
    if (allDates.has(daysAgoISO(i))) activeDaysLast30++;
  }
  const consistencyPct = Math.round((activeDaysLast30 / 30) * 100);

  const exercisesWithData = EXERCISE_LIST.filter((name) =>
    allSets.some((s) => s.name === name)
  );
  const liftStatsList = exercisesWithData.map((name) => {
    const sorted = flattenExerciseSets(workouts, name);
    return { name, ...computeExerciseStats(name, sorted) };
  });

  const totalPRs = liftStatsList.reduce((s, l) => s + l.prIds.size, 0);
  const maxSingleLiftKg = Math.max(
    0,
    ...allSets.filter((s) => !TIME_BASED_EXERCISES.has(s.name)).map((s) => s.weight || 0)
  );
  const strengthLifts = liftStatsList.filter((l) => !l.isTimeBased);
  const strScore = strengthLifts.length
    ? Math.round(strengthLifts.reduce((s, l) => s + l.best, 0) / strengthLifts.length)
    : 0;
  const pwrScore = liftStatsList.reduce((s, l) => s + l.powerLevel, 0);

  const thisWeekStart = startOfWeek(toISODate(new Date()));
  const weeklyXP =
    allSets.filter((s) => s.date >= thisWeekStart).length * XP_PER_SET_LOG;

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

function latestWeight(weightEntries) {
  if (!weightEntries.length) return null;
  const sorted = [...weightEntries].sort((a, b) => a.date.localeCompare(b.date));
  return sorted[sorted.length - 1].weight;
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
        <div className="text-purple-300 text-sm font-mono">{event.detail}</div>
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
/* Login Screen                                                       */
/* ------------------------------------------------------------------ */

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = () => {
    if (
      username.trim().toLowerCase() === VALID_USERNAME &&
      password === VALID_PASSWORD
    ) {
      setError(false);
      onLogin(username.trim());
    } else {
      setError(true);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={{ background: BG, color: "#e5e7eb" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=JetBrains+Mono:wght@400;600&display=swap');
        .font-display { font-family: 'Press Start 2P', 'JetBrains Mono', monospace; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-10px); }
          40% { transform: translateX(10px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        @keyframes flicker {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
      `}</style>
      <div
        className={`w-full max-w-sm rounded-xl border-2 p-8 ${shake ? "animate-[shake_0.5s_ease-in-out]" : ""}`}
        style={{
          borderColor: ACCENT_PURPLE,
          background: "radial-gradient(circle at 50% 0%, rgba(124,58,237,0.15), rgba(13,15,26,0.95))",
          boxShadow: `0 0 40px rgba(124,58,237,0.35)`,
        }}
      >
        <h1
          className="font-display text-2xl text-center mb-1 tracking-wider"
          style={{ color: ACCENT_GOLD, textShadow: `0 0 16px ${ACCENT_GOLD}`, animation: "flicker 3s infinite" }}
        >
          ⚔ IRON QUEST
        </h1>
        <div className="text-center font-mono text-xs text-purple-300 tracking-[0.2em] mb-6">
          ENTER THE ARENA
        </div>

        <label className="block text-xs font-mono text-gray-400 mb-1">Username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Your warrior name"
          className="w-full bg-black/40 border border-white/20 rounded px-3 py-2 text-sm text-white font-mono mb-4 focus:border-amber-400 outline-none"
        />

        <label className="block text-xs font-mono text-gray-400 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="••••••••"
          className="w-full bg-black/40 border border-white/20 rounded px-3 py-2 text-sm text-white font-mono mb-4 focus:border-amber-400 outline-none"
        />

        {error && (
          <div className="text-center font-display text-xs text-rose-400 mb-4 tracking-widest">
            ⛔ ACCESS DENIED
          </div>
        )}

        <button
          onClick={submit}
          className="w-full bg-purple-600 hover:bg-purple-500 transition rounded px-4 py-3 text-sm font-display text-white shadow-[0_0_16px_rgba(124,58,237,0.6)]"
        >
          ENTER
        </button>

        <div className="text-center font-mono text-[10px] text-gray-500 mt-4">
          hint: warrior / ironquest
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Exercise Picker Grid                                               */
/* ------------------------------------------------------------------ */

function ExercisePicker({ onSelect, onClose, excludeNames = [] }) {
  return (
    <div className="mt-3 rounded-lg border border-amber-400/40 bg-black/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-xs text-amber-400">Choose Exercise</span>
        <button
          onClick={onClose}
          className="text-xs font-mono text-gray-400 hover:text-white"
        >
          ✕ close
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {EXERCISE_LIST.map((name) => {
          const disabled = excludeNames.includes(name);
          return (
            <button
              key={name}
              disabled={disabled}
              onClick={() => onSelect(name)}
              className={`px-2 py-2 rounded-lg border font-mono text-xs transition ${
                disabled
                  ? "border-white/5 text-gray-600 cursor-not-allowed"
                  : "border-white/15 text-gray-200 hover:border-purple-400/70 hover:bg-purple-400/10"
              }`}
            >
              {TIME_BASED_EXERCISES.has(name) ? "⏱ " : "🏋 "}
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Workouts Tab                                                       */
/* ------------------------------------------------------------------ */

function ExerciseBlock({ exercise, onAddSet }) {
  const isTimeBased = TIME_BASED_EXERCISES.has(exercise.name);
  const [reps, setReps] = useState("");
  const [weight, setWeight] = useState("");
  const [duration, setDuration] = useState("");
  const stats = computeExerciseStats(
    exercise.name,
    exercise.sets.map((s) => ({ ...s, date: "" }))
  );

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-sm text-white">
          {TIME_BASED_EXERCISES.has(exercise.name) ? "⏱" : "🏋"} {exercise.name}
        </span>
        <span className="font-mono text-xs text-purple-400">
          {exercise.sets.length} set{exercise.sets.length === 1 ? "" : "s"} logged
        </span>
      </div>

      <div className="space-y-1 mb-2">
        {exercise.sets.map((s) => (
          <div
            key={s.id}
            className="flex justify-between text-xs font-mono text-gray-300 border-b border-white/5 py-1"
          >
            {isTimeBased ? (
              <span>Hold: {s.durationSec}s</span>
            ) : (
              <span>
                {s.reps} reps @ {s.weight}kg
              </span>
            )}
            {s.id === stats.bestId && (
              <span className="text-amber-400 px-1.5 py-0.5 rounded border border-amber-400/60 bg-amber-400/10">
                PR
              </span>
            )}
          </div>
        ))}
      </div>

      {isTimeBased ? (
        <div className="flex gap-2 items-end">
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="Seconds"
            className="bg-black/40 border border-white/20 rounded px-2 py-1.5 text-xs text-white font-mono w-24"
          />
          <button
            onClick={() => {
              const d = parseInt(duration);
              if (!d) return;
              onAddSet(exercise.id, { durationSec: d });
              setDuration("");
            }}
            className="bg-amber-500 hover:bg-amber-400 transition rounded px-3 py-1.5 text-xs font-display text-black"
          >
            + Add Hold
          </button>
        </div>
      ) : (
        <div className="flex gap-2 items-end">
          <input
            type="number"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            placeholder="Reps"
            className="bg-black/40 border border-white/20 rounded px-2 py-1.5 text-xs text-white font-mono w-20"
          />
          <input
            type="number"
            step="0.5"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="Weight (kg)"
            className="bg-black/40 border border-white/20 rounded px-2 py-1.5 text-xs text-white font-mono w-28"
          />
          <button
            onClick={() => {
              const r = parseInt(reps);
              const w = parseFloat(weight);
              if (!r || !w) return;
              onAddSet(exercise.id, { reps: r, weight: w });
              setReps("");
              setWeight("");
            }}
            className="bg-amber-500 hover:bg-amber-400 transition rounded px-3 py-1.5 text-xs font-display text-black"
          >
            + Add Set
          </button>
        </div>
      )}
    </div>
  );
}

function WorkoutCard({ workout, isActive, onExpand, onAddExercise, onAddSet, onFinish }) {
  const [showPicker, setShowPicker] = useState(false);
  const totalSets = workout.exercises.reduce((s, e) => s + e.sets.length, 0);

  if (!isActive) {
    return (
      <button
        onClick={onExpand}
        className="w-full text-left rounded-lg border border-white/10 bg-black/20 p-3 hover:border-purple-400/50 transition"
      >
        <div className="flex justify-between items-center">
          <span className="font-mono text-sm text-white">{fmtDate(workout.date)}</span>
          <span className="font-mono text-xs text-gray-400">
            {workout.exercises.length} exercise{workout.exercises.length === 1 ? "" : "s"} ·{" "}
            {totalSets} set{totalSets === 1 ? "" : "s"}
          </span>
        </div>
      </button>
    );
  }

  return (
    <div className="rounded-lg border-2 border-amber-400/50 bg-black/30 p-4">
      <div className="flex justify-between items-center mb-3">
        <span className="font-display text-sm text-amber-300">
          {fmtDate(workout.date)} — Active Session
        </span>
        <button
          onClick={onFinish}
          className="font-mono text-xs px-2 py-1 rounded border border-white/20 text-gray-300 hover:border-emerald-400"
        >
          Finish Workout
        </button>
      </div>

      {workout.exercises.map((ex) => (
        <ExerciseBlock key={ex.id} exercise={ex} onAddSet={onAddSet} />
      ))}

      {showPicker ? (
        <ExercisePicker
          excludeNames={workout.exercises.map((e) => e.name)}
          onSelect={(name) => {
            onAddExercise(name);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      ) : (
        <button
          onClick={() => setShowPicker(true)}
          className="w-full bg-purple-600 hover:bg-purple-500 transition rounded px-4 py-2 text-sm font-display text-white"
        >
          + Add Exercise
        </button>
      )}
    </div>
  );
}

function ExerciseRecords({ workouts }) {
  const available = EXERCISE_LIST.filter(
    (name) => flattenExerciseSets(workouts, name).length > 0
  );
  const [selected, setSelected] = useState(available[0] || null);

  useEffect(() => {
    if (!selected && available.length) setSelected(available[0]);
  }, [available, selected]);

  if (!available.length) {
    return (
      <div className="text-gray-500 text-sm font-mono">
        No exercises logged yet — start a workout above.
      </div>
    );
  }

  const sorted = flattenExerciseSets(workouts, selected);
  const stats = computeExerciseStats(selected, sorted);
  const isTimeBased = TIME_BASED_EXERCISES.has(selected);

  const chartData = sorted.map((e) => ({
    label: fmtDate(e.date),
    value: isTimeBased ? e.durationSec : +epley1RM(e.weight, e.reps).toFixed(1),
  }));

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {available.map((name) => {
          const s = computeExerciseStats(name, flattenExerciseSets(workouts, name));
          return (
            <button
              key={name}
              onClick={() => setSelected(name)}
              className={`px-3 py-2 rounded-lg border font-mono text-sm transition ${
                selected === name
                  ? "border-amber-400 bg-amber-400/10 text-amber-300"
                  : "border-white/15 text-gray-300 hover:border-purple-400/60"
              }`}
            >
              {name} <span className="text-purple-400">PWR {s.powerLevel}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h4 className="font-display text-sm text-purple-300">{selected} Progress</h4>
        <div className="font-mono text-sm text-amber-400">
          {isTimeBased ? `Best Hold: ${stats.best.toFixed(0)}s` : `Est. 1RM: ${stats.best.toFixed(1)} kg`}
        </div>
      </div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={chartData}>
            <CartesianGrid stroke="#ffffff15" strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={11} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "#13152499", border: "1px solid #7C3AED55", fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="value"
              name={isTimeBased ? "Hold (s)" : "Est. 1RM"}
              stroke={ACCENT_GOLD}
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 space-y-1 max-h-56 overflow-y-auto pr-1">
        {[...sorted].reverse().map((e) => (
          <div
            key={e.id}
            className="flex justify-between items-center text-sm font-mono text-gray-300 border-b border-white/5 py-1"
          >
            <span>{fmtDate(e.date)}</span>
            <span>{isTimeBased ? `${e.durationSec}s hold` : `${e.reps} reps @ ${e.weight}kg`}</span>
            {e.id === stats.bestId && (
              <span className="text-amber-400 font-display text-xs px-2 py-0.5 rounded border border-amber-400/60 bg-amber-400/10">
                PR
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkoutsTab({ workouts, activeWorkoutId, startWorkout, setActiveWorkoutId, addExercise, addSet }) {
  const sortedWorkouts = [...workouts].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-6">
      <GlowCard>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-display text-lg text-purple-300">Workout Sessions</h3>
          {!activeWorkoutId && (
            <button
              onClick={startWorkout}
              className="bg-purple-600 hover:bg-purple-500 transition rounded px-4 py-2 text-sm font-display text-white shadow-[0_0_12px_rgba(124,58,237,0.6)]"
            >
              + Start New Workout
            </button>
          )}
        </div>
        <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
          {sortedWorkouts.map((w) => (
            <WorkoutCard
              key={w.id}
              workout={w}
              isActive={w.id === activeWorkoutId}
              onExpand={() => setActiveWorkoutId(w.id)}
              onAddExercise={(name) => addExercise(w.id, name)}
              onAddSet={(exerciseId, data) => addSet(w.id, exerciseId, data)}
              onFinish={() => setActiveWorkoutId(null)}
            />
          ))}
          {sortedWorkouts.length === 0 && (
            <div className="text-gray-500 text-sm font-mono">No workouts yet. Start one above.</div>
          )}
        </div>
      </GlowCard>

      <GlowCard>
        <h3 className="font-display text-lg text-purple-300 mb-4">Exercise Records</h3>
        <ExerciseRecords workouts={workouts} />
      </GlowCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Character Sheet Tab                                                */
/* ------------------------------------------------------------------ */

function CharacterSheetTab({ stats, weightEntries, username }) {
  const trend = useMemo(() => weightTrend(weightEntries), [weightEntries]);
  return (
    <div className="space-y-6">
      <GlowCard>
        <h3 className="font-display text-xl text-amber-400 mb-4 tracking-wider">
          {username.toUpperCase()}'S STATUS
        </h3>
        <XPBar xpIntoLevel={stats.xpIntoLevel} xpForNext={stats.xpForNext} level={stats.level} />
        <div className="mt-2 font-mono text-xs text-gray-400">
          This week: +{stats.weeklyXP} XP earned
        </div>
      </GlowCard>

      <GlowCard>
        <h3 className="font-display text-lg text-purple-300 mb-4">Character Stats</h3>
        <StatBar label="STR (avg 1RM)" value={stats.strScore} max={250} color={ACCENT_GOLD} />
        <StatBar label="PWR (total power)" value={stats.pwrScore} max={600} color={ACCENT_PURPLE} />
        <StatBar label="CONSISTENCY" value={stats.consistencyPct} max={100} color="#22d3ee" />
        <StatBar label="STREAK (days)" value={stats.streak} max={30} color="#f472b6" />
        <div className="grid grid-cols-2 gap-4 mt-4 font-mono text-sm">
          <div className="rounded-lg bg-black/30 border border-white/10 p-3">
            <div className="text-gray-400 text-xs">Total Sets Logged</div>
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
        <h3 className="font-display text-lg text-purple-300 mb-3">Per-Exercise Power</h3>
        <div className="space-y-3">
          {stats.liftStatsList.map((l) => (
            <div key={l.name}>
              <StatBar label={l.name} value={l.powerLevel} max={250} color={ACCENT_PURPLE} />
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
/* Avatar Tab                                                          */
/* ------------------------------------------------------------------ */

function AvatarFigure({ weightKg, pwrScore, level }) {
  const w = weightKg ?? 84;
  const wT = Math.max(0, Math.min(1, (w - 60) / 50));
  const muscleT = Math.max(0, Math.min(1, pwrScore / 600));
  const levelT = Math.max(0, Math.min(1, (level - 1) / 9));

  const shoulderWidth = 86 + muscleT * 46;
  const waistWidth = 56 + wT * 30 - muscleT * 6;
  const armWidth = 13 + muscleT * 11;
  const legWidth = 24 + wT * 10 + muscleT * 8;
  const chestBulge = 0.15 + muscleT * 0.55;

  const glowColor = lerpColor(ACCENT_PURPLE, ACCENT_GOLD, levelT);
  const glowOpacity = 0.18 + levelT * 0.5;
  const skinFill = lerpColor("#2a2d42", "#3a3550", muscleT);
  const outlineColor = lerpColor("#9d8cff", ACCENT_GOLD, levelT);

  const halfShoulder = shoulderWidth / 2;
  const halfWaist = waistWidth / 2;
  const cx = 150;
  const shoulderY = 110;
  const waistY = 255;

  return (
    <svg viewBox="0 0 300 500" className="w-full max-w-xs mx-auto">
      <defs>
        <filter id="avatarGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* glow halo */}
      <ellipse
        cx={cx}
        cy="260"
        rx={shoulderWidth * 1.1}
        ry="220"
        fill={glowColor}
        opacity={glowOpacity * 0.25}
      />

      <g filter="url(#avatarGlow)">
        {/* legs */}
        <rect
          x={cx - halfWaist * 0.55 - legWidth / 2}
          y={waistY}
          width={legWidth}
          height="150"
          rx={legWidth / 2}
          fill={skinFill}
          stroke={outlineColor}
          strokeWidth="2"
        />
        <rect
          x={cx + halfWaist * 0.55 - legWidth / 2}
          y={waistY}
          width={legWidth}
          height="150"
          rx={legWidth / 2}
          fill={skinFill}
          stroke={outlineColor}
          strokeWidth="2"
        />
        {/* quad definition */}
        <ellipse
          cx={cx - halfWaist * 0.55}
          cy={waistY + 45}
          rx={legWidth / 2 + 2}
          ry="26"
          fill={glowColor}
          opacity={chestBulge * 0.35}
        />
        <ellipse
          cx={cx + halfWaist * 0.55}
          cy={waistY + 45}
          rx={legWidth / 2 + 2}
          ry="26"
          fill={glowColor}
          opacity={chestBulge * 0.35}
        />

        {/* torso */}
        <polygon
          points={`${cx - halfShoulder},${shoulderY} ${cx + halfShoulder},${shoulderY} ${cx + halfWaist},${waistY} ${cx - halfWaist},${waistY}`}
          fill={skinFill}
          stroke={outlineColor}
          strokeWidth="2.5"
        />
        {/* chest definition */}
        <ellipse
          cx={cx}
          cy={shoulderY + 45}
          rx={halfShoulder * 0.7}
          ry="34"
          fill={glowColor}
          opacity={chestBulge * 0.4}
        />
        {muscleT > 0.45 && (
          <line
            x1={cx}
            y1={shoulderY + 15}
            x2={cx}
            y2={waistY - 15}
            stroke={outlineColor}
            strokeWidth="1.5"
            opacity="0.5"
          />
        )}

        {/* arms */}
        <rect
          x={cx - halfShoulder - armWidth + 4}
          y={shoulderY + 4}
          width={armWidth}
          height="120"
          rx={armWidth / 2}
          fill={skinFill}
          stroke={outlineColor}
          strokeWidth="2"
        />
        <rect
          x={cx + halfShoulder - 4}
          y={shoulderY + 4}
          width={armWidth}
          height="120"
          rx={armWidth / 2}
          fill={skinFill}
          stroke={outlineColor}
          strokeWidth="2"
        />
        {/* bicep bulges */}
        <ellipse
          cx={cx - halfShoulder - armWidth / 2 + 4}
          cy={shoulderY + 50}
          rx={armWidth / 2 + 2}
          ry="18"
          fill={glowColor}
          opacity={chestBulge * 0.4}
        />
        <ellipse
          cx={cx + halfShoulder + armWidth / 2 - 4}
          cy={shoulderY + 50}
          rx={armWidth / 2 + 2}
          ry="18"
          fill={glowColor}
          opacity={chestBulge * 0.4}
        />

        {/* neck */}
        <rect x={cx - 12} y={shoulderY - 22} width="24" height="26" fill={skinFill} stroke={outlineColor} strokeWidth="2" />

        {/* head */}
        <circle cx={cx} cy={shoulderY - 42} r="32" fill={skinFill} stroke={outlineColor} strokeWidth="2.5" />
      </g>
    </svg>
  );
}

function AvatarTab({ weightEntries, stats }) {
  const weightKg = latestWeight(weightEntries);
  const strengthLabel =
    stats.level >= 8
      ? "Legendary"
      : stats.level >= 5
      ? "Heroic"
      : stats.level >= 3
      ? "Seasoned"
      : "Novice";

  return (
    <GlowCard>
      <h3 className="font-display text-lg text-purple-300 mb-4 text-center">Digital Twin</h3>
      <AvatarFigure weightKg={weightKg} pwrScore={stats.pwrScore} level={stats.level} />
      <div className="grid grid-cols-3 gap-3 mt-6 font-mono text-sm text-center">
        <div className="rounded-lg bg-black/30 border border-white/10 p-3">
          <div className="text-gray-400 text-xs mb-1">Height</div>
          <div className="text-white">6'2"</div>
        </div>
        <div className="rounded-lg bg-black/30 border border-white/10 p-3">
          <div className="text-gray-400 text-xs mb-1">Weight</div>
          <div className="text-white">{weightKg ? `${weightKg.toFixed(1)} kg` : "—"}</div>
        </div>
        <div className="rounded-lg bg-black/30 border border-white/10 p-3">
          <div className="text-gray-400 text-xs mb-1">Strength Level</div>
          <div className="text-amber-400">{strengthLabel}</div>
        </div>
      </div>
      <div className="text-center font-mono text-xs text-gray-500 mt-4">
        Your twin evolves as your Power and Warrior Level grow.
      </div>
    </GlowCard>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function FitnessRPGApp() {
  const [auth, setAuth] = useState({ loggedIn: false, username: "" });
  const [state, setState] = useState(() => loadState());
  const [tab, setTab] = useState("sheet");
  const [activeWorkoutId, setActiveWorkoutId] = useState(null);
  const [prEvent, setPrEvent] = useState(null);
  const [levelUp, setLevelUp] = useState(null);
  const prevLevelRef = useRef(null);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const stats = useMemo(
    () => computeWarriorStats(state.weightEntries, state.workouts),
    [state.weightEntries, state.workouts]
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
    const newly = ACHIEVEMENT_DEFS.filter((a) => !unlocked.has(a.id) && a.check(stats));
    if (newly.length) {
      setState((s) => ({
        ...s,
        unlockedAchievements: [...s.unlockedAchievements, ...newly.map((a) => a.id)],
      }));
    }
  }, [stats]);

  const startWorkout = () => {
    const w = { id: uid(), date: toISODate(new Date()), exercises: [] };
    setState((s) => ({ ...s, workouts: [...s.workouts, w] }));
    setActiveWorkoutId(w.id);
  };

  const addExercise = (workoutId, name) => {
    setState((s) => ({
      ...s,
      workouts: s.workouts.map((w) =>
        w.id === workoutId
          ? { ...w, exercises: [...w.exercises, { id: uid(), name, sets: [] }] }
          : w
      ),
    }));
  };

  const addSet = (workoutId, exerciseId, data) => {
    setState((s) => {
      const workouts = s.workouts.map((w) => {
        if (w.id !== workoutId) return w;
        const exercises = w.exercises.map((ex) => {
          if (ex.id !== exerciseId) return ex;
          const isTimeBased = TIME_BASED_EXERCISES.has(ex.name);
          const priorSorted = flattenExerciseSets(s.workouts, ex.name);
          const priorBest = computeExerciseStats(ex.name, priorSorted).best;
          const newMetric = isTimeBased ? data.durationSec : epley1RM(data.weight, data.reps);
          if (newMetric >= priorBest) {
            setPrEvent({
              liftName: ex.name,
              detail: isTimeBased ? `Hold: ${data.durationSec}s` : `1RM: ${newMetric.toFixed(1)} kg`,
            });
          }
          return { ...ex, sets: [...ex.sets, { id: uid(), ...data }] };
        });
        return { ...w, exercises };
      });
      return { ...s, workouts };
    });
  };

  if (!auth.loggedIn) {
    return <LoginScreen onLogin={(username) => setAuth({ loggedIn: true, username })} />;
  }

  const tabs = [
    { id: "sheet", label: "Character Sheet" },
    { id: "workouts", label: "Workouts" },
    { id: "avatar", label: "Avatar" },
    { id: "achievements", label: "Achievements" },
  ];

  return (
    <div
      key="main-app"
      className="min-h-screen w-full animate-[fadeInApp_0.7s_ease-out]"
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
        @keyframes fadeInApp {
          0% { opacity: 0; transform: scale(0.97); }
          100% { opacity: 1; transform: scale(1); }
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
            {auth.username} · LV {stats.level} · 🔥 {stats.streak} day streak
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
          <CharacterSheetTab stats={stats} weightEntries={state.weightEntries} username={auth.username} />
        )}
        {tab === "workouts" && (
          <WorkoutsTab
            workouts={state.workouts}
            activeWorkoutId={activeWorkoutId}
            startWorkout={startWorkout}
            setActiveWorkoutId={setActiveWorkoutId}
            addExercise={addExercise}
            addSet={addSet}
          />
        )}
        {tab === "avatar" && <AvatarTab weightEntries={state.weightEntries} stats={stats} />}
        {tab === "achievements" && (
          <AchievementsTab stats={stats} unlocked={state.unlockedAchievements} />
        )}
      </main>

      <PRToast event={prEvent} onDone={() => setPrEvent(null)} />
      <LevelUpFlash show={!!levelUp} level={levelUp} onDone={() => setLevelUp(null)} />
    </div>
  );
}
