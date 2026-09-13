# Scraper Hub v2

Production-oriented lead discovery hub for:

1. ARSPL Roofing Engine
2. Nirman AI Government Engine

Pipeline:

Discovery
→ Normalization
→ Junk Filter
→ Global Dedupe
→ Classification
→ Quality Score
→ Structured Output
→ n8n Production Master

IMPORTANT:
- No Google Sheets direct-write from scraper engines.
- No infinite scraper loop.
- No email sending.
- No CRM mutation.
- Existing scraper remains untouched until v2 validation passes.
