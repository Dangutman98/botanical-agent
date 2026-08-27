import { describe, it, expect } from 'vitest';
import { stripNiqqud, normalizeHebrewToken } from './hebrew';

describe('stripNiqqud', () => {
  it('removes vowel points, leaving the consonant letters intact', () => {
    expect(stripNiqqud('כֻּרְכּוּם')).toBe('כרכום');
  });

  it('leaves plain (unvocalized) Hebrew text unchanged', () => {
    expect(stripNiqqud('כורכום')).toBe('כורכום');
  });
});

describe('normalizeHebrewToken', () => {
  it('leaves a bare word with no prefix/suffix letter unchanged', () => {
    expect(normalizeHebrewToken('צמח')).toBe('צמח'); // "plant" — doesn't start with a prefix letter
  });

  it('strips a single leading conjunction/preposition letter', () => {
    expect(normalizeHebrewToken('וצמח')).toBe('צמח'); // and-plant
    expect(normalizeHebrewToken('לצמח')).toBe('צמח'); // to-plant
    expect(normalizeHebrewToken('בצמח')).toBe('צמח'); // in-plant
    expect(normalizeHebrewToken('מצמח')).toBe('צמח'); // from-plant
  });

  it('strips a trailing plural suffix (ים/ות)', () => {
    expect(normalizeHebrewToken('צמחים')).toBe('צמח'); // plants -> plant
    // Light stemmer, not a real morphological analyzer: this doesn't reconstruct the
    // correct singular ("תרופה"), it just strips the trailing ות characters.
    expect(normalizeHebrewToken('תרופות')).toBe('תרופ');
  });

  it('does not strip a prefix letter when the remaining stem would be too short', () => {
    // "בא" (came) is 2 letters; stripping "ב" would leave "א", below the minimum stem length.
    expect(normalizeHebrewToken('בא')).toBe('בא');
  });

  it('leaves non-Hebrew tokens (English, numbers) completely unchanged', () => {
    expect(normalizeHebrewToken('turmeric')).toBe('turmeric');
    expect(normalizeHebrewToken('123')).toBe('123');
  });

  it('leaves mixed-script tokens unchanged (not attempting partial normalization)', () => {
    expect(normalizeHebrewToken('covid19')).toBe('covid19');
  });

  describe('known false positives (documented trade-off, not a target to eliminate)', () => {
    it('mangles a genuine short word that happens to start with a prefix letter', () => {
      // "הוא" (he) is a real, complete word — not ה + "וא". This is exactly the kind
      // of case the module description warns about; asserting it here so any change
      // to the prefix logic has to consciously decide whether it fixes or preserves this.
      expect(normalizeHebrewToken('הוא')).toBe('וא');
    });

    it('strips the bare domain term "כורכום" (turmeric) as if כ were a prefix, so it does not converge with "לכורכום"', () => {
      const bare = normalizeHebrewToken('כורכום');
      const inflected = normalizeHebrewToken('לכורכום');
      expect(bare).toBe('ורכום');
      expect(inflected).toBe('כורכום');
      expect(bare).not.toBe(inflected); // documents the limitation rather than hiding it
    });
  });
});
