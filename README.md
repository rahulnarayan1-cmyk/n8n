# n8n — AI Sales Engine

## AI Sales Global Engine v1

Production-oriented AI sales engine for:

1. ARSPL Roofing Engine
2. Nirman AI Government Engine

### Pipeline

Discovery
→ Normalization
→ Junk Filter
→ Global Dedupe
→ Classification
→ Quality Score
→ Structured Output
→ AI Agent Orchestrator
→ Model Gateway
→ Production Master

### AI Workforce

- AI CEO
- ARSPL Sales Head
- Nirman AI Sales Head
- Discovery Agent
- Tender Intelligence Agent
- Research Agent
- Enrichment Agent
- Classification Agent
- Scoring Agent
- Personalization Agent
- Cold Mail Agent
- WhatsApp Agent
- Android Messaging Agent
- Reply Agent
- Follow-up Agent
- Opportunity Agent
- QA Agent
- CRM/Data Agent
- Cost-Control Agent
- Fallback Agent
- Reporting Agent
- Communication Agent

### Model Gateway

Supported AI workers/providers:

- Ollama
- Groq
- OpenRouter
- Kilo
- Experiential Labs

Provider selection is controlled by the Model Gateway. Providers remain available as interchangeable workers/fallbacks; business logic is not tied to a single provider.

### Governance

- AI is intelligence, not database authority.
- Deterministic validation owns data integrity.
- No unrestricted mass outreach.
- Important outbound communication passes required QA/policy gates.
- Raw/source data is preserved unless a governed retention/deletion policy authorizes deletion.
- Government intelligence uses official/public professional information only.
- Credentials and secrets are never committed to Git.

### Gate Status

- Gate 1 — Read-only Inventory: PASS
- Gate 2 — Adapter Map: PARTIAL PASS
- Gate 3 — Model Gateway Contract: PASS
- Gate 4 — Free Live Discovery: PASS
- Gate 5 — 10 + 10 JSON Test: PASS
- Gate 6A — Model Gateway Routing: PASS
- Gate 6B — Agent/Task Routing Matrix: PASS
- Gate 6C — Prompt/Policy + Controlled Execution: PASS
- Gate 7 — Production Master Controlled Write: IN PROGRESS
- Gate 8 — Limited Live Sales Engine: NOT STARTED

### Safety / Operational Rules

- No Google Sheets direct-write from scraper engines.
- No infinite scraper loop.
- No uncontrolled email, WhatsApp, or Android messaging.
- No direct CRM mutation outside the governed production-write path.
- Existing legacy workflows remain preserved and are not blindly reactivated.
- Production writes are controlled, deterministic, auditable, and verified by read-back.

## Repository Purpose

This repository contains the controlled AI Sales Global Engine v1 `hub-v2` implementation and its validation evidence.
