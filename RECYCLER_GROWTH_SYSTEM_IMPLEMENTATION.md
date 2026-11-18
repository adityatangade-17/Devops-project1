# Recycler Growth System Implementation Plan

Date: 2026-09-02

## 1. Objective

Implement a recycler-focused digital growth system inside `Chat-Epr-Seva` by adding a public website and structured lead-ingestion flow while reusing the existing ForgeChat CRM, WhatsApp, pipeline, automation, and analytics foundations.

## 2. Guiding Rules

- Do not implement tender functionality.
- Do not create a second CRM or second WhatsApp backend.
- Reuse existing contacts, deals, pipelines, tasks, and analytics where practical.
- Keep all database changes additive.
- Do not break existing EPR or ForgeChat behavior.

## 3. Phase Plan

### Phase 1. Foundation

- completed: repo audit
- completed: reference recycler analysis
- completed: architecture definition

### Phase 2. Public Website Shell

- introduce a recycler public routing structure
- create a shared public layout
- separate public site presentation from authenticated CRM shell
- preserve existing login and internal product flows

Deliverables:

- public page scaffolding
- navigation
- footer
- reusable section components

### Phase 3. Recycler Content Model

- define how recycler data is stored and rendered
- reuse `venture_profile`, `venture_offices`, and `venture_products` where possible
- add additive storage only for missing domains such as materials, certifications, and plant capabilities if required
- make placeholder content clearly replaceable

Deliverables:

- content mapping
- optional additive migrations
- seed/config structure for first recycler

### Phase 4. Public Page Implementation

- build:
  - home
  - about
  - plant
  - services
  - materials
  - products
  - industries
  - certifications
  - sustainability
  - contact
  - request quote

Deliverables:

- responsive page set
- original recycler-oriented UI
- clear CTA strategy

### Phase 5. Structured Lead Capture

- build distinct lead flows:
  - request quote
  - sell waste
  - buy recycled material
  - service enquiry
  - general business enquiry
- validate all fields on client and server
- support attribution metadata

Deliverables:

- reusable lead form components
- validation schemas
- success/error states

### Phase 6. Website To ForgeChat Integration

- add a public lead-ingest endpoint
- map submissions into:
  - contacts
  - tags/categories
  - custom fields
  - deals
- record source as recycler website

Deliverables:

- public API endpoint
- mapping layer
- duplicate-safe contact handling

### Phase 7. Pipeline And Workflow Integration

- ensure website leads enter a recycler-oriented lifecycle
- create assignment and follow-up hooks using existing systems
- preserve current permissions and visibility rules

Deliverables:

- recycler pipeline mapping
- lead routing rules
- follow-up triggers

### Phase 8. WhatsApp Integration

- add public WhatsApp CTAs
- connect lead journeys to existing WhatsApp configuration where appropriate
- avoid any second webhook or second provider logic

Deliverables:

- WhatsApp CTA behavior
- CRM-side linkage rules

### Phase 9. Analytics Extension

- extend existing dashboard metrics with website-origin data
- capture form type, page, CTA, and UTM inputs
- expose lead-to-deal conversion visibility

Deliverables:

- attribution fields
- dashboard/report updates

### Phase 10. SEO, Security, Performance, QA

- add metadata and crawlability fundamentals
- optimize assets and public pages
- add automated coverage for public-site and ingest flows
- run end-to-end checks

Deliverables:

- SEO baseline
- rate limiting and hardening
- test coverage
- QA results

## 4. First Build Slice

The best first end-to-end implementation slice is:

- recycler homepage
- request quote page
- structured quote form
- public lead endpoint
- create/update contact
- create deal in recycler pipeline
- source attribution

That slice proves the core growth loop before broader content work.

## 5. Open Engineering Decisions

Decisions to make during implementation based on code constraints:

- whether to keep the public site inside the current SPA or split to a dedicated public app surface within the same repo
- whether structured lead fields fit entirely in current custom fields or need additive database columns/tables
- whether pipeline defaults should be global, optional, or scoped to recycler setup

## 6. Definition Of Done

This implementation is successful when a visitor can land on the recycler website, submit a structured enquiry, and the sales team can immediately see the resulting contact and pipeline item inside existing ForgeChat workflows without manual re-entry.
