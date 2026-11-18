# Recycler Growth System Architecture

Date: 2026-09-02

## 1. Goal

Build a recycler public website that feeds structured business enquiries into the existing ForgeChat backend without creating a second CRM, a second WhatsApp backend, or duplicate pipeline/automation infrastructure.

## 2. System Boundary

In scope:

- public recycler website
- structured lead capture
- website to ForgeChat integration
- WhatsApp CTA and follow-up integration
- pipeline visibility
- source attribution
- analytics extension
- SEO, performance, security, QA for the public site

Out of scope:

- tender system
- tender APIs
- tender pages
- tender dashboards
- tender matching or tender notifications

The attached PDF conflicts with this point, but the pasted user request is authoritative, so tender work remains excluded.

## 3. Existing Base We Should Reuse

Already present in this repo:

- contact model
- custom contact fields
- tags and categories
- deals and pipelines
- WhatsApp account integration
- automation and AI-agent infrastructure
- venture profile, offices, and products/services
- dashboard analytics
- user auth and admin shell
- migrations and backend API framework

## 4. Proposed High-Level Architecture

Public visitor flow:

- Visitor lands on recycler website
- Visitor browses services, materials, products, plant, industries, sustainability, and trust content
- Visitor clicks a CTA
- Visitor submits a structured enquiry or opens WhatsApp

Backend flow:

- Public form hits a dedicated validated backend endpoint
- Endpoint creates or updates a contact
- Endpoint records source and requirement metadata
- Endpoint creates or updates a deal in a recycler pipeline when appropriate
- Endpoint optionally triggers assignment and follow-up logic
- Sales team sees the lead inside existing ForgeChat UI

## 5. Frontend Architecture

Recommended frontend split:

- keep the current authenticated CRM experience intact
- add a dedicated public recycler route family for marketing and lead-generation pages

Recommended public pages:

- `/`
- `/about`
- `/plant`
- `/services`
- `/materials`
- `/products`
- `/industries`
- `/certifications`
- `/sustainability`
- `/contact`
- `/request-quote`

Shared public-site needs:

- original recycler branding
- configurable business content
- reusable section system
- strong mobile CTA behavior
- SEO metadata per page

## 6. Content Configuration Strategy

To avoid hardcoding one recycler throughout the app, business content should be configuration-driven where practical.

Initial configuration domains:

- company identity
- contact details
- office/location data
- services
- materials
- products
- certifications
- plant/facility details
- sustainability content
- CTA enablement
- WhatsApp presentation settings

Existing likely reuse points:

- `venture_profile`
- `venture_offices`
- `venture_products`

Possible small additive extensions:

- recycler materials
- certifications
- plant capabilities
- homepage section settings

## 7. Lead Intake Architecture

Create a dedicated public endpoint for website enquiries instead of reusing privileged internal CRUD endpoints directly.

Suggested public endpoint shape:

- `POST /api/public/recycler-leads`

Responsibilities:

- validate and sanitize input
- enforce rate limiting
- normalize enquiry type
- capture attribution fields
- create/update contact
- attach structured requirement data
- create/update deal if the submission should enter the sales pipeline
- return a safe success/failure response

## 8. Data Mapping Strategy

Recommended lead payload shape:

- `companyName`
- `contactName`
- `phone`
- `email`
- `location`
- `requirementType`
- `material`
- `quantity`
- `expectedTimeline`
- `message`
- `page`
- `cta`
- `formType`
- `utmSource`
- `utmMedium`
- `utmCampaign`
- `source`

Recommended persistence mapping:

- core identity -> `contacts`
- source/type -> tags or categories
- requirement detail -> custom fields first
- sales tracking -> `deals`
- company/recycler metadata -> venture/recycler config tables

## 9. Pipeline Strategy

Do not create a duplicate lead tracker. Reuse the existing deals and pipeline system.

Recycler-oriented default lifecycle:

- New Lead
- Contacted
- Qualified
- Requirement Collected
- Quotation
- Negotiation
- Won
- Lost

If the existing pipeline can be configured per deployment, prefer configuration over hardcoding. If a new default is needed, keep it additive and non-breaking.

## 10. WhatsApp Strategy

Reuse the current WhatsApp Cloud API integration and account model.

Website behavior:

- public WhatsApp CTA opens the configured recycler WhatsApp number
- website submissions can optionally trigger internal tasking or automation
- follow-up messages should reuse existing template/automation/agent infrastructure where appropriate

Do not:

- add a second WhatsApp backend
- alter Meta credentials unless required
- introduce a competing webhook path

## 11. Analytics Strategy

Extend current analytics rather than creating a second analytics product.

Metrics to add:

- website enquiries
- website lead source
- form type
- CTA origin
- page origin
- UTM attribution
- lead-to-deal conversion
- qualified leads
- quotations
- won/lost outcomes
- WhatsApp conversations originating from website journeys

## 12. Security Strategy

Public-site protections must include:

- server-side validation
- client-side validation
- sanitization
- rate limiting
- spam mitigation
- strict separation from privileged CRM endpoints
- no secret exposure in frontend code

Use current backend middleware patterns where possible, but keep public lead ingestion isolated from authenticated admin paths.

## 13. Implementation Sequence

Phase 1:

- audit complete
- reference site analysis
- architecture approval

Phase 2:

- public recycler content model
- public page routing and layout

Phase 3:

- structured lead forms
- public lead ingestion endpoint
- contact/deal mapping

Phase 4:

- WhatsApp CTA integration
- pipeline defaults and attribution
- analytics extension

Phase 5:

- SEO
- responsive QA
- automated tests
- deployment preparation

## 14. Success Criteria

The architecture is successful when:

- the website works as a real recycler public site
- lead forms capture structured business information
- submissions appear in ForgeChat without manual re-entry
- source attribution is preserved
- sales can track the lead in the pipeline
- WhatsApp remains the existing integrated channel
- the implementation does not break existing ForgeChat functionality
