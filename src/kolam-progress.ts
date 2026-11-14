/**
 * Game progress: which kolams are unlocked, stars earned, best scores, and
 * where the player stopped — saved in the browser so they continue from there.
 */

export interface Stage {
  name: string;
  tamil: string;
  from: number; // first level index (0-based)
  to: number; // last level index (inclusive)
}

/** Levels are ordered by number of dots; these are the stage boundaries. */
export const STAGES: Stage[] = [
  { name: 'Beginner', tamil: 'தொடக்கம்', from: 0, to: 8 },
  { name: 'Intermediate', tamil: 'இடைநிலை', from: 9, to: 17 },
  { name: 'Advanced', tamil: 'மேம்பட்ட', from: 18, to: 32 },
  { name: 'Master', tamil: 'வல்லுநர்', from: 33, to: 49 },
];

export function stageOf(level: number): number {
  const i = STAGES.findIndex((s) => level >= s.from && level <= s.to);
  return i < 0 ? STAGES.length - 1 : i;
}

interface Best {
  stars: number;
  accuracy: number;
  seconds: number;
}

interface SaveData {
  unlocked: number; // highest level index you may play
  current: number; // where you stopped
  best: Record<number, Best>;
  // Daily kolam
  lastDaily: string; // YYYY-MM-DD of the last daily kolam finished
  streak: number; // consecutive days
  bestStreak: number;
  dailyDays: number; // total daily kolams drawn
}

/** Local calendar date as YYYY-MM-DD. */
export function dateKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayBefore(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d - 1));
}

/**
 * Today's kolam: the same for everyone on the same day. The weekday sets
 * the difficulty — gentle at the start of the week, a Master kolam on Sunday.
 */
export function dailyLevel(levelCount: number, d = new Date()): number {
  const stageByDay = [3, 0, 0, 1, 1, 2, 2]; // Sun..Sat
  const st = STAGES[stageByDay[d.getDay()]];
  const key = dateKey(d);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const span = Math.min(levelCount - 1, st.to) - st.from + 1;
  return st.from + (Math.abs(h) % span);
}

/** During Margazhi (mid-Dec to mid-Jan) kolams are drawn every dawn. Day number, or 0. */
export function margazhiDay(d = new Date()): number {
  if (VIDEO) return 3;
  const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const start = new Date(y, 11, 16);
  const days = Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
  return days >= 1 && days <= 30 ? days : 0;
}

const KEY = 'kolam.progress.v1';

/**
 * Recording mode for the demo video (add ?video to the link): shows how the
 * doorstep looks after five days of Today's kolam, as if it were Margazhi.
 * Nothing is saved differently.
 */
const VIDEO = typeof location !== 'undefined' && /[?&]video\b/.test(location.search);
const VIDEO_STREAK = 5;
/** Judges' link (add ?all): every kolam can be chosen from the Levels screen. */
const ALL = typeof location !== 'undefined' && /[?&]all\b/.test(location.search);

class Progress {
  private data: SaveData = { unlocked: 0, current: 0, best: {}, lastDaily: '', streak: 0, bestStreak: 0, dailyDays: 0 };

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<SaveData>;
        this.data = {
          unlocked: typeof d.unlocked === 'number' ? d.unlocked : 0,
          current: typeof d.current === 'number' ? d.current : 0,
          best: d.best && typeof d.best === 'object' ? d.best : {},
          lastDaily: typeof d.lastDaily === 'string' ? d.lastDaily : '',
          streak: typeof d.streak === 'number' ? d.streak : 0,
          bestStreak: typeof d.bestStreak === 'number' ? d.bestStreak : 0,
          dailyDays: typeof d.dailyDays === 'number' ? d.dailyDays : 0,
        };
      }
    } catch {
      /* storage unavailable: play without saving */
    }
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  get unlocked(): number {
    return this.data.unlocked;
  }

  get current(): number {
    return ALL ? this.data.current : Math.min(this.data.current, this.data.unlocked);
  }

  isUnlocked(level: number): boolean {
    return ALL || level <= this.data.unlocked;
  }

  stars(level: number): number {
    return this.data.best[level]?.stars ?? 0;
  }

  totalStars(): number {
    return Object.values(this.data.best).reduce((a, b) => a + b.stars, 0);
  }

  setCurrent(level: number): void {
    if (this.data.current === level) return;
    this.data.current = level;
    this.save();
  }

  /** Record a finished kolam; unlocks the next one. */
  complete(level: number, stars: number, accuracy: number, seconds: number, levelCount: number): void {
    const prev = this.data.best[level];
    if (!prev || stars > prev.stars || (stars === prev.stars && accuracy > prev.accuracy)) {
      this.data.best[level] = { stars, accuracy, seconds };
    }
    this.data.unlocked = Math.min(levelCount - 1, Math.max(this.data.unlocked, level + 1));
    this.save();
  }

  /** Has today's kolam been drawn? */
  dailyDone(): boolean {
    return this.data.lastDaily === dateKey();
  }

  /** Current streak — still alive if you drew yesterday or today. */
  streak(): number {
    const today = dateKey();
    const real = this.data.lastDaily === today || this.data.lastDaily === dayBefore(today) ? this.data.streak : 0;
    return VIDEO ? Math.max(real, this.data.lastDaily === today ? VIDEO_STREAK + 1 : VIDEO_STREAK) : real;
  }

  get bestStreak(): number {
    return this.data.bestStreak;
  }

  /** Record today's kolam; returns the new streak. */
  completeDaily(): number {
    const today = dateKey();
    if (this.data.lastDaily === today) return this.data.streak;
    this.data.streak = this.data.lastDaily === dayBefore(today) ? this.data.streak + 1 : 1;
    this.data.bestStreak = Math.max(this.data.bestStreak, this.data.streak);
    this.data.lastDaily = today;
    this.data.dailyDays++;
    this.save();
    return this.streak();
  }

  reset(): void {
    this.data = { unlocked: 0, current: 0, best: {}, lastDaily: '', streak: 0, bestStreak: 0, dailyDays: 0 };
    this.save();
  }
}

export const progress = new Progress();
