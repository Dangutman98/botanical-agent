// -----------------------------------------------------------------------------
// Charset detection & decoding
// -----------------------------------------------------------------------------
// `Response.text()` always decodes as UTF-8 per the fetch spec, silently ignoring
// any `Content-Type: charset=...` the server sent. naturopedia.com serves
// windows-1255 and was being decoded as UTF-8, producing corrupted Hebrew
// (U+FFFD replacement characters) across the entire crawled corpus. This module
// resolves the real charset (HTTP header -> HTML <meta> tag -> UTF-8 default)
// and decodes the raw bytes correctly.
// -----------------------------------------------------------------------------

const SUPPORTED_ENCODINGS = new Set([
  'utf-8', 'utf8',
  'windows-1255', 'iso-8859-8', 'iso-8859-8-i',
  'windows-1252', 'iso-8859-1',
]);

function normalizeEncodingName(name: string): string {
  return name.trim().toLowerCase().replace(/^"|"$/g, '');
}

/**
 * Resolves the charset of an HTTP response: the Content-Type header takes priority,
 * falling back to a <meta charset> tag sniffed from the first bytes (decoded as latin1,
 * which never throws and preserves byte values 1:1 for ASCII-range meta tag scanning),
 * and finally defaulting to utf-8.
 */
export function detectCharset(contentTypeHeader: string | null, bodyBytes: Uint8Array): string {
  if (contentTypeHeader) {
    const match = contentTypeHeader.match(/charset=([^\s;]+)/i);
    if (match) {
      const enc = normalizeEncodingName(match[1]);
      if (SUPPORTED_ENCODINGS.has(enc)) return enc;
    }
  }

  // Sniff a <meta charset="..."> or <meta http-equiv="Content-Type" content="...charset=...">
  // tag from the first 2KB, decoded permissively (latin1 is a 1:1 byte->codepoint mapping,
  // so ASCII meta tag syntax always reads correctly regardless of the real encoding).
  const head = Buffer.from(bodyBytes.slice(0, 2048)).toString('latin1');
  const metaCharset = head.match(/<meta[^>]+charset=["']?([\w-]+)/i);
  if (metaCharset) {
    const enc = normalizeEncodingName(metaCharset[1]);
    if (SUPPORTED_ENCODINGS.has(enc)) return enc;
  }

  return 'utf-8';
}

/** Fetches a URL and decodes its body using the real detected charset. */
export async function fetchAndDecode(url: string, headers: Record<string, string>, timeoutMs = 15000): Promise<string> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buf = new Uint8Array(await res.arrayBuffer());
  const charset = detectCharset(res.headers.get('content-type'), buf);
  return new TextDecoder(charset).decode(buf);
}
