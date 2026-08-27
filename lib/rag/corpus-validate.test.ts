import { describe, it, expect } from 'vitest';
import { validateChunk } from './corpus-validate';

const GOOD_CONTENT = 'תוכן אמיתי ומועיל על צמח מרפא. '.repeat(20); // well over 200 chars

describe('validateChunk', () => {
  it('accepts a normal, clean, sufficiently long chunk', () => {
    const result = validateChunk({
      title: 'כורכום ותועלותיו',
      url: 'https://bara.co.il/curcumin-area/',
      content: GOOD_CONTENT,
    });
    expect(result).toEqual({ valid: true });
  });

  it('rejects a chunk that is mostly replacement characters (the mojibake regression)', () => {
    const corrupted = '�'.repeat(80) + 'ok' + '�'.repeat(80);
    const result = validateChunk({
      title: '���',
      url: 'http://www.naturopedia.com/pages.asp?rId=1',
      content: corrupted,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('corrupted');
  });

  it('accepts a chunk with a few replacement characters under the threshold', () => {
    const mostlyClean = GOOD_CONTENT + '�'; // one stray char in a long clean string
    const result = validateChunk({
      title: 'כותרת תקינה',
      url: 'https://bara.co.il/some-article/',
      content: mostlyClean,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a naturopedia search results page', () => {
    const result = validateChunk({
      title: 'תוצאות חיפוש',
      url: 'http://www.naturopedia.com/search.asp?l=%F7',
      content: GOOD_CONTENT,
    });
    expect(result).toEqual({ valid: false, reason: 'nav_url' });
  });

  it('rejects a WordPress search query URL', () => {
    const result = validateChunk({
      title: 'תוצאות',
      url: 'https://bara.co.il/?s=%d7%9b%d7%95%d7%a8%d7%9b%d7%95%d7%9d',
      content: GOOD_CONTENT,
    });
    expect(result).toEqual({ valid: false, reason: 'nav_url' });
  });

  it('rejects a sitemap page even with a percent-encoded Hebrew title match', () => {
    const result = validateChunk({
      title: 'מפת אתר (חלק 10/23)',
      url: 'https://bara.co.il/%d7%9e%d7%a4%d7%aa-%d7%90%d7%aa%d7%a8/',
      content: GOOD_CONTENT,
    });
    expect(result).toEqual({ valid: false, reason: 'nav_title' });
  });

  it('rejects a tag/archive listing page', () => {
    const result = validateChunk({
      title: 'תגית: כורכום',
      url: 'https://trifolium.co.il/blog/tag/curcumin/',
      content: GOOD_CONTENT,
    });
    expect(result).toEqual({ valid: false, reason: 'nav_url' });
  });

  it('rejects content shorter than the minimum length', () => {
    const result = validateChunk({
      title: 'כותרת',
      url: 'https://bara.co.il/some-article/',
      content: 'קצר מדי.',
    });
    expect(result).toEqual({ valid: false, reason: 'too_short' });
  });

  it('respects a custom minLength option', () => {
    const result = validateChunk(
      { title: 'כותרת', url: 'https://bara.co.il/x/', content: 'תוכן קצר אך מספיק.' },
      { minLength: 5 }
    );
    expect(result.valid).toBe(true);
  });
});
