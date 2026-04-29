# Agent Skills (Herbalism-Only, Strict Allowlist)

## Global Access Policy (Applies to all skills)

- The agent is allowed to use data **only** from these domains:
  - `trifolium.co.il`
  - `bara.co.il`
  - `ajcn.nutrition.org`
  - `nccih.nih.gov`
  - `naturopedia.com`
  - `medlineplus.gov`
- Any URL outside this list must be blocked automatically.
- No fallback to web search outside the allowlist.
- No paywall/login bypass.
- If a source is blocked, unavailable, or gated, return: `source_unavailable`.
- Always return source URLs for every claim.

---

## Skill 1: Herbal Lookup (Single Herb)

### Goal
Find one herb across allowed sources and return a concise factual profile.

### Input
- `herb_name` (Hebrew and/or English)

### Steps
1. Normalize herb name (Hebrew/English/synonyms if available).
2. Search only allowlisted domains for matching herb pages.
3. Extract minimal fields:
   - common names
   - key uses
   - cautions
   - interactions
4. Keep short excerpt-level facts (no full-page copy).
5. Return structured output with citations.

### Output (JSON shape)
```json
{
  "skill": "herbal_lookup",
  "herb_name": "Ashwagandha",
  "matches": [
    {
      "source_domain": "nccih.nih.gov",
      "source_url": "https://www.nccih.nih.gov/health/herbsataglance",
      "common_names": ["Ashwagandha", "Withania somnifera"],
      "key_uses": ["..."],
      "cautions": ["..."],
      "interactions": ["..."]
    }
  ],
  "status": "ok"
}
```

---

## Skill 2: Herbal Compare (Pros / Cons)

### Goal
Compare one herb across multiple allowed sources and show pros/cons clearly.

### Input
- `herb_name`

### Steps
1. Collect herb data from all reachable allowlisted domains.
2. Build a side-by-side comparison:
   - potential benefits (pros)
   - cautions/risks (cons)
   - interaction notes
   - evidence confidence (`low|medium|high`)
3. Mark conflicts between sources as `conflict_detected`.
4. Add source links per row.

### Output (JSON shape)
```json
{
  "skill": "herbal_compare",
  "herb_name": "Ashwagandha",
  "comparison_table": [
    {
      "source_domain": "medlineplus.gov",
      "pros": ["..."],
      "cons": ["..."],
      "interactions": ["..."],
      "evidence_confidence": "medium",
      "source_url": "https://medlineplus.gov/"
    }
  ],
  "notes": ["conflict_detected"],
  "status": "ok"
}
```

---

## Skill 3: Herbal Safety Brief (Clinical Quick View)

### Goal
Generate a quick safety-first summary for practitioner use.

### Input
- `herb_name`
- `patient_context` (optional: pregnancy, medications, chronic conditions)

### Steps
1. Pull only safety/caution/interaction info from allowlisted domains.
2. Prioritize conservative interpretation when sources disagree.
3. If evidence is weak or missing, explicitly say `insufficient_evidence`.
4. Return a short practitioner brief + red flags.

### Output (JSON shape)
```json
{
  "skill": "herbal_safety_brief",
  "herb_name": "Ashwagandha",
  "patient_context": {
    "pregnancy": false,
    "medications": ["example_med"]
  },
  "safety_summary": {
    "major_cautions": ["..."],
    "possible_interactions": ["..."],
    "contraindications": ["..."],
    "evidence_limitations": ["insufficient_evidence"]
  },
  "recommended_next_step": "manual_review_if_high_risk",
  "citations": [
    "https://www.nccih.nih.gov/health/herbsataglance",
    "https://medlineplus.gov/"
  ],
  "status": "ok"
}
```

---

## Mandatory Guardrails

- Deny-by-default network policy.
- Never invent data not found in the allowed sources.
- Never present output as medical diagnosis.
- Always include: `not_medical_advice`.
- Always include citation URLs used in the response.
