import { describe, it, expect } from 'vitest';
import { mapIndexArtists, INDEX_ARTIST_COLUMNS, MAX_DATA_POINTS } from './index-artists';

const row = (over: Record<string, unknown> = {}) => ({
  spotify_id: 'id1',
  artist_name: 'Drake',
  spotify_img: 'https://img/drake.jpg',
  current_index_value: 12.5,
  change_1m: -3.2,
  data_points: [{ index: 1, timestamp: '2026-01-01' }, { index: 2, timestamp: '2026-01-02' }],
  ...over,
});

describe('mapIndexArtists', () => {
  it('maps the DB columns to the carousel shape', () => {
    expect(mapIndexArtists([row()], ['id1'])).toEqual([{
      name: 'Drake',
      image_url: 'https://img/drake.jpg',
      index_price: 12.5,
      change_1m: -3.2,
      data_points: [{ index: 1, timestamp: '2026-01-01' }, { index: 2, timestamp: '2026-01-02' }],
    }]);
  });

  it('returns artists in the ORDER of ids, not the DB order', () => {
    const rows = [row({ spotify_id: 'b', artist_name: 'B' }), row({ spotify_id: 'a', artist_name: 'A' })];
    expect(mapIndexArtists(rows, ['a', 'b']).map((x) => x.name)).toEqual(['A', 'B']);
  });

  it('skips ids with no matching row, and rows with no usable name', () => {
    const rows = [row({ spotify_id: 'a', artist_name: 'A' }), row({ spotify_id: 'b', artist_name: '   ' })];
    expect(mapIndexArtists(rows, ['a', 'b', 'missing']).map((x) => x.name)).toEqual(['A']);
  });

  it('nulls missing/invalid numeric + image fields instead of breaking', () => {
    const r = mapIndexArtists([row({ current_index_value: null, change_1m: 'x', spotify_img: '' })], ['id1'])[0];
    expect(r.index_price).toBeNull();
    expect(r.change_1m).toBeNull();
    expect(r.image_url).toBeNull();
  });

  it('drops malformed data points but keeps the good ones', () => {
    const r = mapIndexArtists([row({ data_points: [
      { index: 5, timestamp: '2026-02-01' },
      { index: 'nope', timestamp: '2026-02-02' }, // bad index
      { index: 6 },                               // no timestamp
      null,
      { index: 7, timestamp: '2026-02-03' },
    ] })], ['id1'])[0];
    expect(r.data_points).toEqual([
      { index: 5, timestamp: '2026-02-01' },
      { index: 7, timestamp: '2026-02-03' },
    ]);
  });

  it('coerces a numeric-string data-point index', () => {
    const r = mapIndexArtists([row({ data_points: [{ index: '3.5', timestamp: '2026-03-01' }] })], ['id1'])[0];
    expect(r.data_points).toEqual([{ index: 3.5, timestamp: '2026-03-01' }]);
  });

  it('tolerates a non-array / null payload (never throws)', () => {
    expect(mapIndexArtists(null, ['a'])).toEqual([]);
    expect(mapIndexArtists(undefined, ['a'])).toEqual([]);
    expect(mapIndexArtists([row()], [])).toEqual([]);
    expect(mapIndexArtists([row({ data_points: 'garbage', current_index_value: undefined })], ['id1'])[0].data_points).toEqual([]);
  });

  it('deduplicates on the first row per id', () => {
    const rows = [row({ spotify_id: 'a', artist_name: 'First' }), row({ spotify_id: 'a', artist_name: 'Second' })];
    expect(mapIndexArtists(rows, ['a']).map((x) => x.name)).toEqual(['First']);
  });

  it('sorts data points ascending by time (mirrors the sparkline builder)', () => {
    const r = mapIndexArtists([row({ data_points: [
      { index: 3, timestamp: '2026-03-03' },
      { index: 1, timestamp: '2026-03-01' },
      { index: 2, timestamp: '2026-03-02' },
    ] })], ['id1'])[0];
    expect(r.data_points.map((p) => p.timestamp)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
  });

  it('drops points with an unparseable timestamp', () => {
    const r = mapIndexArtists([row({ data_points: [
      { index: 1, timestamp: 'not-a-date' },
      { index: 2, timestamp: '2026-04-01' },
    ] })], ['id1'])[0];
    expect(r.data_points).toEqual([{ index: 2, timestamp: '2026-04-01' }]);
  });

  it('downsamples a long history to MAX_DATA_POINTS, keeping first + last', () => {
    const big = Array.from({ length: 1248 }, (_, i) => ({
      index: i,
      timestamp: new Date(Date.UTC(2023, 0, 1) + i * 86400000).toISOString(),
    }));
    const r = mapIndexArtists([row({ data_points: big })], ['id1'])[0];
    expect(r.data_points.length).toBe(MAX_DATA_POINTS);
    expect(r.data_points[0].index).toBe(0);                       // first preserved
    expect(r.data_points[MAX_DATA_POINTS - 1].index).toBe(1247);  // last preserved
    // Monotonic in time (still sorted after downsampling).
    const ts = r.data_points.map((p) => Date.parse(p.timestamp));
    expect(ts.every((t, i) => i === 0 || t >= ts[i - 1])).toBe(true);
  });

  it('exposes the exact column list the route selects', () => {
    expect(INDEX_ARTIST_COLUMNS).toBe('spotify_id,artist_name,spotify_img,current_index_value,change_1m,data_points');
  });
});
