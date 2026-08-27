# Botanical Agent — Rebuild Plan

**Date:** 2026-08-27
**Branch:** `fix/rag-rebuild`
**Backup:** tag `backup/pre-rag-rebuild-2026-08-27`, branch `backup/master-2026-08-27`, corpus copy in `_backup-2026-08-27/`

---

## 1. Why this plan exists

The application is **not working in production**, and had been degrading silently for a long time.
None of the failures below threw a visible error. Every one was swallowed by a `catch` block that
logged a warning to a console nobody reads.

### Verified findings (2026-08-27)

| # | Finding | Evidence |
|---|---------|----------|
| 1 | **Groq model decommissioned.** `llama-3.1-8b-instant` returns 404. Every chat request 500s. | Live API call: `model_not_found` |
| 2 | **HuggingFace endpoint retired.** `api-inference.huggingface.co` no longer resolves (`ENOTFOUND`). | DNS + fetch |
| 3 | **No HF token configured.** Absent from `.env.local`; CI passes the literal string `'none'`. | `.env.local`, `deploy.yml` |
| 4 | **Pinecone index 4% populated.** 496 vectors for 12,165 chunks. | `describe_index_stats` → `totalVectorCount: 496` |
| 5 | **68% of the corpus is character-encoding garbage.** All 8,284 naturopedia chunks; a sample is 74% `U+FFFD`. Unrecoverable — must re-crawl. | corpus scan |
| 6 | **Root cause of #5:** `Response.text()` always decodes UTF-8 per spec and ignores `Content-Type: charset`. naturopedia serves `Charset=Windows-1255`. | `crawl-all.js:130`; verified by re-decoding live HTML |
| 7 | **Crawler cannot reach naturopedia articles.** Content lives at `pages.asp?rId=N`; the crawler strips query strings and filters on `pathname` only. | `crawl-all.js:184`, `:99` |
| 8 | **Search-result pages were indexed as content.** `search.asp?l=%F7` passes `isAllowedUrl`. | corpus URLs |
| 9 | **Two sitemap configs wrong.** nccih is at `/sitemap/sitemap-index.xml` (crawler requests `/sitemap.xml`); medlineplus has `sitemaps: []`. Both fell back to link-crawling and swept in boilerplate. | robots.txt of each |
| 10 | **Usable Hebrew corpus is 591 chunks, not 12,165.** Every Hebrew query searches 4.7% of the index. | language analysis |
| 11 | **`/api/ingestion` is unauthenticated** — an open write endpoint into the Pinecone index. | `app/api/ingestion/route.ts` |
| 12 | **Sitemap noise filter is broken.** `isCleanUrl` tests for `'מפת-אתר'` against percent-encoded URLs; never matches. | `hybrid-store.ts:227` |
| 13 | **RRF weights contradict themselves.** Defaults are `0.5`/`2.0`; the call site passes `1.5`/`1.0`. | `hybrid-store.ts:99`, `:238` |
| 14 | **Corpus has no reproducible provenance.** Committed crawler emits `(Part 5/7)`; committed corpus contains `(חלק 5/7)`. Different script produced the data. | corpus vs `crawl-all.js:319` |
| 15 | **Ingestion is quadratic.** Each chunk re-reads, re-parses and rewrites the full 27 MB `chunks.json`. | `hybrid-store.ts:63` |
| 16 | 977 near-duplicate chunks; fixed 1,200-char chunking cuts mid-sentence. | corpus scan |

**The through-line: silent degradation is the bug.** The startup assertions, validation gate,
visible degraded mode, and CI eval in this plan all exist to make failures loud.

---

## 2. Decisions

### Product
- **Purpose:** portfolio piece *and* a real tool for one real user. A person will act on its herbal advice.
- **Grounding:** strict. The "you may supplement with your own knowledge" prompt lines are removed.
  Ungrounded answers are made *structurally* impossible via a code-level guard, not requested via prompt.
- **Disclaimer:** persistent, in the UI.
- **Deployment:** **Vercel only.** Terraform, `Dockerfile.lambda`, `docker-compose.yml`, and the
  Lambda GitHub Actions workflow are deleted. IaC can live on as a separate documented repo.

### Model
- **`openai/gpt-oss-120b`** on Groq free tier. Best Hebrew and the only model tested that synthesizes
  well — but also the most willing to freelance when context is empty, hence the guard below.
- **Startup assertion** that the configured model exists. Finding #1 must never recur silently.
- Rejected: `qwen/qwen3.8-27b` (grounds itself naturally, stiffer Hebrew), `gpt-oss-20b` (emitted
  corrupted citation URLs).

### Retrieval
- **Dense:** keep Pinecone. Repair in place.
  - Document vectors generated **locally** via Xenova ONNX (same weights as `intfloat/multilingual-e5-small`),
    bulk-upserted. No free-tier quota cliff — this is what produced the 496.
  - Query vectors via `router.huggingface.co` with a real token. **Verified working** (384-dim, `read` scope).
  - Query embeddings cached by normalized query string.
- **Sparse:** BM25 stays local, with **Hebrew normalization** — strip niqqud, strip `ו/ה/ב/ל/מ/ש/כ`
  prefixes, light suffix stemming. Currently `כורכום` cannot match `כורכומין`.
- **Degraded mode is visible.** If query embedding fails, serve BM25 but mark the response. Never silent.
- **Context:** stop truncating retrieved documents to 500 chars. Fewer, fuller documents.
- **Refusal rule:** refuse when zero documents survive filtering. A score threshold comes later,
  calibrated against the eval set rather than guessed.
- **BM25 index precomputed at build time**, not rebuilt on every cold start.

### Corpus
- **Full rebuild.** Wipe `chunks.json` and the Pinecone index; legacy copy kept out of git.
- **Crawler fixes:** charset via `arrayBuffer()` + `TextDecoder` (header → `<meta>` → default);
  per-domain URL **allowlists** (denylists fail open); query strings preserved;
  `nccih`/`medlineplus` sitemap paths corrected; trifolium's sitemap failure investigated;
  **robots.txt honoured**; paragraph/sentence-aware chunking.
- **naturopedia allowlist:** `pages.asp?rId=\d+`, `nutritionstudy.asp?rId=\d+`; `search.asp` denied.
  Pattern-matched via link discovery — not enumerated, which would hammer a server that has no robots.txt.
- **Validation gate at ingest**, plus a one-time cleanup pass. Rejected: >20% replacement characters,
  under ~200 real characters, nav/search/sitemap URL patterns.
- **Batch pipeline, resumable:** crawl → JSONL → validate → batch embed → bulk upsert → write once.
  The HTTP ingestion route survives for incremental single-document adds, and gets an auth secret.
- **English sources** (nccih, medlineplus): translated into `content` at ingest, English kept in
  `content_en`, original English URL cited. One-time offline job.

### Robots / etiquette
All five sources permit the content being crawled. naturopedia has no robots.txt (404).
Keep the 1.2s delay, add a robots checker, cite and link back to every source.

### Quality
- **Vitest** on the five deterministic units: Hebrew tokenizer, chunker boundaries, charset detection,
  validation gate, RRF. The charset test is the permanent regression guard for finding #5.
- **Eval:** 10 Hebrew questions to start (expanded to ~30 later), **written by the domain user**,
  stored in-repo, `npm run eval` reporting recall@5, run in CI.
- **README corrected** — the "12,000 chunks" claim, and the "6 databases" line that lists 5.

### Git artifacts
In git: cleaned corpus + prebuilt BM25 index (the deployable artifact).
Out of git: raw crawl output, legacy 27 MB corpus.

---

## 3. Work order

1. **Hotfix — ship immediately.** Model swap + startup assertion; strict-grounding prompt;
   zero-results refusal guard; UI disclaimer; lock down `/api/ingestion`.
   *The demo comes back honest but thin — it will correctly say "no information" to most questions
   until step 3 lands. This is the intended state.*
2. **Crawler rebuild** — charset, allowlists, query strings, sitemap configs, robots.txt,
   paragraph-aware chunking, validation gate. Vitest alongside.
3. **Full re-crawl** — batch pipeline into a clean corpus.
4. **Embeddings** — local batch embed, bulk Pinecone upsert, HF router at query time with
   caching and visible degradation.
5. **Measure** — 10 Hebrew questions, `npm run eval`, recall@5 in CI.
6. **Behind numbers** — English translation, reranker decision, `page.tsx` refactor, README correction.

Steps 4–6 depend on a clean corpus. Everything after 5 is gated on a measurement, not a hunch.

---

## 4. Deliberately deferred

| Item | Why deferred | Revisit when |
|---|---|---|
| **Reranker** | After the re-crawl and Hebrew tokenizer, retrieval is a different system. If recall is bad, a reranker cannot help; if recall is good but ordering is wrong, it can. | After step 5 |
| **Full 30-question gold set** | User wants to feel the system on a real corpus first. 10 questions bridge the gap. | After step 5 |
| **`page.tsx` refactor (811 lines)** | Changes zero answers. Safer once the eval can prove it broke nothing. | Step 6 |
| **Refusal score threshold** | Cannot be calibrated without eval data. Zero-results refusal until then. | After step 5 |
| **Response streaming** | UX, not accuracy. | Unscheduled |

---

## 5. Open action for the user

- **Rotate the HF token** at the end of the work (it was pasted into a chat transcript) and put the
  replacement directly into Vercel's environment settings.
- **Write the 10 Hebrew eval questions** (domain user), each with the source URLs that *should* be
  retrieved and a note on what a correct answer contains.
