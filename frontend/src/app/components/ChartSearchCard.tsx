'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChartBox } from './templateEditorTypes';
import { chartAspect } from './TemplateEditorCanvas/drawing/chart';

interface SearchResult {
  id: string;
  name: string;
  image_url: string | null;
  index_price: number | null;
  change_1m: number | null;
}

// Artist search → add a trading-site index chart to the active slide. Searches the trading API
// via our proxy; clicking a result snapshots the artist's full series + releases into a ChartBox.
export function ChartSearchCard({ onAdd }: { onAdd: (box: ChartBox) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search-as-you-type
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = q.trim();
    if (!query) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/posts/charts/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(Array.isArray(data.results) ? data.results.slice(0, 8) : []);
        setError('');
      } catch {
        setError('Search failed — try again.');
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  async function addChart(r: SearchResult) {
    if (addingId) return;
    setAddingId(r.id);
    setError('');
    try {
      const res = await fetch(`/api/posts/charts/artist/${encodeURIComponent(r.id)}`);
      const data = await res.json();
      const artist = data.artist ?? data;
      const points: { index: number; timestamp: string }[] = artist?.data_points ?? [];
      if (!res.ok || points.length < 2) throw new Error(data.error || 'No chart data for this artist');
      const releasesRaw = typeof artist.releases === 'string' ? JSON.parse(artist.releases) : (artist.releases ?? []);
      const releases = (Array.isArray(releasesRaw) ? releasesRaw : []).map((rel: { date?: string; name?: string; image?: string; type?: string }) => ({
        date: rel.date, name: rel.name, image: rel.image, type: rel.type,
      }));
      // The app's chart look, header on; aspect locked.
      // 960 wide on the 1080 canvas → 60px inset (margin) on each side (x = +60).
      const width = 960;
      const height = Math.round(width / chartAspect(true, false, true));   // header + x-axis dates on by default
      const box: ChartBox = {
        id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
          ? crypto.randomUUID()
          : `cb-${Math.floor(Math.random() * 1e9).toString(36)}`,
        x: Math.round((1080 - width) / 2), y: Math.round((1350 - height) / 2), width, height,
        opacity: 100,
        spotifyId: r.id,
        artistName: artist.name ?? r.name,
        artistImage: artist.image_url ?? r.image_url ?? undefined,
        data: points,
        releases,
        showHeader: true,
        period: 'ALL',
        mode: 'line',
      };
      onAdd(box);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add chart');
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search artists…"
        aria-label="Search artists"
        className="w-full h-8 rounded-md bg-surface-1 border border-separator px-2.5 text-footnote text-label placeholder:text-label-quaternary focus:outline-none focus:ring-2 focus:ring-focus"
      />
      {error && <p className="text-caption-sm text-danger" role="alert">{error}</p>}
      {searching && <p className="text-caption-sm text-label-tertiary">Searching…</p>}
      {!searching && results.length > 0 && (
        <ul className="flex flex-col gap-1" role="listbox" aria-label="Artist results">
          {results.map(r => {
            const up = (r.change_1m ?? 0) >= 0;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => addChart(r)}
                  disabled={addingId !== null}
                  className="w-full flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-surface-1 transition-colors disabled:opacity-60"
                  title={`Add ${r.name}'s index chart to this slide`}
                >
                  {r.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0 bg-surface-2" />
                  ) : (
                    <span className="w-7 h-7 rounded-full bg-surface-2 shrink-0" />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block text-footnote text-label truncate">{r.name}</span>
                    {r.index_price != null && (
                      <span className="block text-caption-sm text-label-tertiary tabular-nums">
                        {r.index_price.toFixed(2)}
                        {r.change_1m != null && (
                          <span style={{ color: up ? '#04df9d' : '#FF4B4B' }}>
                            {'  '}{up ? '▲' : '▼'} {Math.abs(r.change_1m).toFixed(2)}%
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="text-caption-sm text-label-quaternary shrink-0">
                    {addingId === r.id ? 'Adding…' : '+ Add'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!searching && q.trim() && results.length === 0 && !error && (
        <p className="text-caption-sm text-label-tertiary">No artists found.</p>
      )}
    </div>
  );
}
