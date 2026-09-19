import { describe, it, expect } from 'vitest';
import { parseInstagramApps } from './instagram-apps';

const APPS = JSON.stringify([
  { key: 'sonotradehq', label: 'sonotradehq', appId: '111', appSecret: 's1' },
  { label: 'sono.clips', appId: '222', appSecret: 's2' }, // no key → derived from label
]);

describe('parseInstagramApps', () => {
  it('parses the JSON array into configs', () => {
    expect(parseInstagramApps(APPS)).toEqual([
      { key: 'sonotradehq', label: 'sonotradehq', appId: '111', appSecret: 's1' },
      { key: 'sono-clips', label: 'sono.clips', appId: '222', appSecret: 's2' },
    ]);
  });

  it('derives a slug key from the label when key is absent', () => {
    const apps = parseInstagramApps(JSON.stringify([{ label: 'Sono Trade IO!', appId: 'a', appSecret: 'b' }]));
    expect(apps[0].key).toBe('sono-trade-io');
  });

  it('de-duplicates colliding keys', () => {
    const apps = parseInstagramApps(JSON.stringify([
      { label: 'dup', appId: 'a', appSecret: 'b' },
      { label: 'dup', appId: 'c', appSecret: 'd' },
      { key: 'dup', label: 'x', appId: 'e', appSecret: 'f' },
    ]));
    expect(apps.map(a => a.key)).toEqual(['dup', 'dup-2', 'dup-3']);
  });

  it('skips entries missing appId or appSecret', () => {
    const apps = parseInstagramApps(JSON.stringify([
      { label: 'ok', appId: 'a', appSecret: 'b' },
      { label: 'no-secret', appId: 'c' },
      { label: 'no-id', appSecret: 'd' },
      { label: 'empty', appId: '', appSecret: '' },
      null,
      'garbage',
    ]));
    expect(apps.map(a => a.label)).toEqual(['ok']);
  });

  it('falls back to the single-app vars when INSTAGRAM_APPS is empty/invalid', () => {
    const expected = [{ key: 'default', label: 'Instagram', appId: 'ID', appSecret: 'SEC' }];
    expect(parseInstagramApps(undefined, 'ID', 'SEC')).toEqual(expected);
    expect(parseInstagramApps('', 'ID', 'SEC')).toEqual(expected);
    expect(parseInstagramApps('not json', 'ID', 'SEC')).toEqual(expected);
    expect(parseInstagramApps('{}', 'ID', 'SEC')).toEqual(expected); // not an array
    expect(parseInstagramApps('[]', 'ID', 'SEC')).toEqual(expected); // empty array
  });

  it('uses a custom fallback label when provided', () => {
    expect(parseInstagramApps(undefined, 'ID', 'SEC', 'MyProfile')[0].label).toBe('MyProfile');
  });

  it('prefers INSTAGRAM_APPS over the fallback when it has valid entries', () => {
    const apps = parseInstagramApps(JSON.stringify([{ label: 'primary', appId: 'a', appSecret: 'b' }]), 'ID', 'SEC');
    expect(apps.map(a => a.label)).toEqual(['primary']); // fallback NOT appended
  });

  it('returns an empty list when nothing is configured', () => {
    expect(parseInstagramApps(undefined)).toEqual([]);
    expect(parseInstagramApps('[]')).toEqual([]);
    expect(parseInstagramApps(undefined, '', '')).toEqual([]);
  });

  it('trims whitespace on all fields', () => {
    const apps = parseInstagramApps(JSON.stringify([{ key: ' k ', label: ' L ', appId: ' a ', appSecret: ' b ' }]));
    expect(apps[0]).toEqual({ key: 'k', label: 'L', appId: 'a', appSecret: 'b' });
  });
});
