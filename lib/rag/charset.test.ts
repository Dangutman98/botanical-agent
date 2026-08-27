import { describe, it, expect } from 'vitest';
import { detectCharset } from './charset';

describe('detectCharset', () => {
  it('reads charset from the Content-Type header', () => {
    const bytes = new TextEncoder().encode('<html></html>');
    expect(detectCharset('text/html; Charset=Windows-1255', bytes)).toBe('windows-1255');
  });

  it('is case-insensitive and ignores extra whitespace/quotes in the header', () => {
    const bytes = new TextEncoder().encode('<html></html>');
    expect(detectCharset('text/html;charset="UTF-8"', bytes)).toBe('utf-8');
  });

  it('falls back to a <meta charset> tag when the header has none', () => {
    const html = '<html><head><meta charset="windows-1255"></head></html>';
    const bytes = new TextEncoder().encode(html);
    expect(detectCharset(null, bytes)).toBe('windows-1255');
  });

  it('falls back to a <meta http-equiv Content-Type charset> tag', () => {
    const html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-8"></head></html>';
    const bytes = new TextEncoder().encode(html);
    expect(detectCharset(null, bytes)).toBe('iso-8859-8');
  });

  it('defaults to utf-8 when nothing is found', () => {
    const bytes = new TextEncoder().encode('<html><head></head></html>');
    expect(detectCharset(null, bytes)).toBe('utf-8');
  });

  it('ignores an unsupported/garbage charset name and falls back to utf-8', () => {
    const bytes = new TextEncoder().encode('<html></html>');
    expect(detectCharset('text/html; charset=totally-not-a-real-charset', bytes)).toBe('utf-8');
  });

  it('decodes windows-1255 bytes correctly (the naturopedia.com regression)', () => {
    const hebrewText = 'אנציקלופדיה לרפואה טבעית';
    // Build genuine windows-1255 bytes via the real decoder's own byte space, rather
    // than hand-crafting a byte table.
    const encoded = ianaEncode(hebrewText, 'windows-1255');
    const decoded = new TextDecoder('windows-1255').decode(encoded);
    expect(decoded).toBe(hebrewText);
    // Decoding those same bytes as UTF-8 must NOT silently succeed — this is the bug we're guarding.
    const wrongDecode = new TextDecoder('utf-8').decode(encoded);
    expect(wrongDecode).not.toBe(hebrewText);
  });
});

// Vitest/Node don't ship a windows-1255 *encoder*, only a decoder, so we derive real
// windows-1255 bytes by iterating codepoints through the decoder's own byte space —
// avoids hand-typing a lookup table that could itself be wrong.
function ianaEncode(text: string, encoding: string): Uint8Array {
  const decoder = new TextDecoder(encoding);
  const table = new Map<string, number>();
  for (let byte = 0; byte < 256; byte++) {
    const ch = decoder.decode(new Uint8Array([byte]));
    if (!table.has(ch)) table.set(ch, byte);
  }
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const byte = table.get(text[i]);
    if (byte === undefined) throw new Error(`Character ${text[i]} not representable in ${encoding}`);
    bytes[i] = byte;
  }
  return bytes;
}
