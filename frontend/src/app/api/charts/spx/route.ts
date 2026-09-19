import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

type Point = { timestamp: number; value: number };

// Real S&P 500 monthly closes since 2004, shaped exactly like a Trends sparkline so the
// chart code can treat it as just another series. Cached in trends_cache under a reserved
// term (same table/shape as artist trends; new closes only appear monthly, 24h TTL).
const CACHE_TERM = '__sp500__';
const TTL_MS = 24 * 60 * 60 * 1000;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
}

// Primary source: Stooq daily CSV endpoint with monthly interval — keyless and stable.
async function fetchStooq(): Promise<Point[]> {
  const res = await fetch('https://stooq.com/q/d/l/?s=%5Espx&d1=20040101&i=m', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`stooq ${res.status}`);
  const csv = await res.text();
  const lines = csv.trim().split('\n').slice(1); // Date,Open,High,Low,Close,Volume
  const points: Point[] = [];
  for (const line of lines) {
    const [date, , , , close] = line.split(',');
    const t = new Date(date).getTime();
    const v = parseFloat(close);
    if (Number.isFinite(t) && Number.isFinite(v)) points.push({ timestamp: t, value: v });
  }
  if (points.length < 50) throw new Error(`stooq returned too few rows (${points.length})`);
  return points;
}

// Fallback: Yahoo Finance chart API (unofficial but long-lived).
async function fetchYahoo(): Promise<Point[]> {
  const res = await fetch(
    'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1mo&period1=1072915200&period2=' + Math.floor(Date.now() / 1000),
    { headers: { 'User-Agent': 'Mozilla/5.0' } },
  );
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const json = await res.json() as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
  };
  const r = json.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  const points: Point[] = [];
  for (let i = 0; i < ts.length; i++) {
    const v = closes[i];
    if (v != null && Number.isFinite(v)) points.push({ timestamp: ts[i] * 1000, value: v });
  }
  if (points.length < 50) throw new Error(`yahoo returned too few rows (${points.length})`);
  return points;
}

export async function GET() {
  const db = admin();

  // 1. Fresh cache hit
  try {
    const { data } = await db
      .from('trends_cache')
      .select('points, updated_at')
      .eq('term', CACHE_TERM)
      .maybeSingle();
    if (data && Array.isArray(data.points) && data.points.length > 0 &&
        Date.now() - new Date(data.updated_at).getTime() < TTL_MS) {
      return NextResponse.json(data.points, { headers: { 'X-Cache': 'hit' } });
    }
  } catch { /* best-effort cache */ }

  // 2. Live fetch (Stooq, then Yahoo) + store
  try {
    let points: Point[];
    try { points = await fetchStooq(); }
    catch { points = await fetchYahoo(); }
    try {
      await db.from('trends_cache').upsert({ term: CACHE_TERM, points, updated_at: new Date().toISOString() });
    } catch { /* best-effort */ }
    return NextResponse.json(points, { headers: { 'X-Cache': 'miss' } });
  } catch (err) {
    // 3. Stale fallback
    try {
      const { data } = await db
        .from('trends_cache')
        .select('points')
        .eq('term', CACHE_TERM)
        .maybeSingle();
      if (data && Array.isArray(data.points) && data.points.length > 0) {
        return NextResponse.json(data.points, { headers: { 'X-Cache': 'stale' } });
      }
    } catch { /* ignore */ }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
