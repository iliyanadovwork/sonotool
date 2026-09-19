import { describe, it, expect } from 'vitest';
import { isLockedCaptionCell, prependCaption, captionForDisplay } from './caption-cell';

describe('isLockedCaptionCell', () => {
  it('locks a value wrapped in braces, surrounding whitespace included', () => {
    expect(isLockedCaptionCell('{leave this alone}')).toBe(true);
    expect(isLockedCaptionCell('  {leave this alone}  ')).toBe(true);
    expect(isLockedCaptionCell('{}')).toBe(true);
  });

  it('does not lock ordinary captions, including ones merely containing braces', () => {
    expect(isLockedCaptionCell('POV: you bought the top')).toBe(false);
    expect(isLockedCaptionCell('the {market} is cooked')).toBe(false);
    expect(isLockedCaptionCell('{unclosed')).toBe(false);
    expect(isLockedCaptionCell('unopened}')).toBe(false);
    // A lone brace is not a wrapper — guards the length check.
    expect(isLockedCaptionCell('{')).toBe(false);
  });

  it('treats an empty or non-string cell as unlocked (empty = plain write)', () => {
    expect(isLockedCaptionCell('')).toBe(false);
    expect(isLockedCaptionCell('   ')).toBe(false);
    expect(isLockedCaptionCell(null)).toBe(false);
    expect(isLockedCaptionCell(undefined)).toBe(false);
  });
});

describe('captionForDisplay', () => {
  it('strips a single outer brace pair from a locked cell', () => {
    expect(captionForDisplay('{leave this alone}')).toBe('leave this alone');
    expect(captionForDisplay('  {leave this alone}  ')).toBe('leave this alone');
    expect(captionForDisplay('{}')).toBe('');
  });

  it('strips only one layer and trims the unwrapped inner value', () => {
    expect(captionForDisplay('{ padded }')).toBe('padded');
    expect(captionForDisplay('{{nested}}')).toBe('{nested}');
  });

  it('leaves an unlocked caption exactly as-is, whitespace and inner braces intact', () => {
    expect(captionForDisplay('POV: you bought the top')).toBe('POV: you bought the top');
    expect(captionForDisplay('the {market} is cooked')).toBe('the {market} is cooked');
    expect(captionForDisplay('line one\nline two')).toBe('line one\nline two');
    expect(captionForDisplay('  keep my spaces  ')).toBe('  keep my spaces  ');
  });

  it('returns an empty string for empty or non-string cells', () => {
    expect(captionForDisplay('')).toBe('');
    expect(captionForDisplay(null)).toBe('');
    expect(captionForDisplay(undefined)).toBe('');
  });

  it('agrees with isLockedCaptionCell on what counts as locked', () => {
    // Unclosed/lone braces are not wrappers → returned verbatim, not stripped.
    expect(captionForDisplay('{unclosed')).toBe('{unclosed');
    expect(captionForDisplay('{')).toBe('{');
  });
});

describe('prependCaption', () => {
  it('puts the extracted caption in front, single space between', () => {
    expect(prependCaption('POV: you bought the top', 'the market is cooked'))
      .toBe('POV: you bought the top the market is cooked');
  });

  it('degrades to a plain write when the cell is empty', () => {
    expect(prependCaption('new caption', '')).toBe('new caption');
    expect(prependCaption('new caption', '   ')).toBe('new caption');
    expect(prependCaption('new caption', null)).toBe('new caption');
    expect(prependCaption('new caption', undefined)).toBe('new caption');
  });

  it('never blanks an existing cell when there is nothing to prepend', () => {
    expect(prependCaption('', 'keep me')).toBe('keep me');
    expect(prependCaption('   ', 'keep me')).toBe('keep me');
    expect(prependCaption(null, 'keep me')).toBe('keep me');
  });

  it('trims both sides so the join never doubles up whitespace', () => {
    expect(prependCaption('  new  ', '  old  ')).toBe('new old');
    expect(prependCaption('new', '')).toBe('new');
    expect(prependCaption('', '')).toBe('');
  });

  it('stacks on repeat runs — extraction is not idempotent by design', () => {
    const once = prependCaption('cap', 'existing');
    expect(prependCaption('cap', once)).toBe('cap cap existing');
  });
});
