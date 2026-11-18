# Recycler Website Analysis

Date: 2026-09-02

Reference reviewed: [Plastigo Earth](https://plastigoearth.com/)  
Review basis: live public website inspected on 2026-09-02

## 1. Instruction Boundary

This document analyzes the reference recycler website for structure, UX, content organization, and conversion strategy. It is not a license to copy text, branding, logo, or proprietary imagery. The goal is to extract reusable patterns and improve on them with an original implementation inside ForgeChat.

## 2. What The Reference Site Communicates Well

The reference site presents the recycler as:

- industrial and operationally credible
- sustainability-driven
- product-oriented, not just mission-oriented
- relevant to B2B buyers and suppliers

Its strongest narrative pattern is:

- explain the company
- show recycling capability
- show materials/products
- explain the process
- show industries served
- add trust and impact signals
- end in direct enquiry

That structure is a strong fit for the requested recycler growth system.

## 3. Information Architecture Observed

Most of the public story is handled on a single long homepage with clear sections:

- hero with headline and CTA
- about/company story
- services
- products/material outputs
- recycling process
- industries served
- why choose us
- environmental impact
- facility/gallery
- testimonials
- contact and enquiry form

This is useful because it shows the minimum content blocks a recycler needs to establish trust quickly.

## 4. Business Model Signals

The site suggests a recycler business model centered on:

- collecting plastic waste
- sorting and processing it
- converting it into reusable granules/pellets
- selling recycled material to manufacturing sectors

That implies at least two meaningful lead journeys:

- supplier-side lead: someone wants to sell waste/scrap
- buyer-side lead: someone wants to buy recycled material

The user request also mentions quote requests and service enquiries, so the recycler site we build should support multiple structured lead types rather than a single generic form.

## 5. UX And Conversion Patterns Worth Reusing

Useful patterns from the reference:

- hero CTA above the fold
- process visualization
- product/material segmentation
- industry-specific credibility
- impact metrics
- facility imagery
- direct contact details plus form

Patterns to improve in our implementation:

- move from a mostly single-page brochure into a clearer multi-page public website
- replace generic enquiry capture with structured lead capture
- connect every meaningful CTA to source-aware CRM ingestion
- give WhatsApp a first-class role, especially on mobile
- make SEO stronger with dedicated pages, metadata, schema, and crawlable structure

## 6. Content Areas Recommended For Our Recycler Site

Based on the reference and the user request, the recycler website should support:

- Home
- About
- Plant / Facility / Capabilities
- Recycling Services
- Materials
- Products
- Industries Served
- Certifications
- Sustainability
- Contact
- Request a Quote

Optional pages should only be added if the target recycler actually needs them.

## 7. CTA Strategy Recommended

The reference site shows that a recycler can support more than one business action. For our implementation, the most appropriate CTA set is:

- Request a Quote
- Talk on WhatsApp
- Sell Your Waste
- Buy Recycled Material
- Contact Us

Not every recycler will need every CTA equally. The first implementation should make CTA availability configurable so the public website matches the recycler's real business model.

## 8. Lead Capture Implications

The reference site uses a simple enquiry pattern, but the requested system needs a stronger one.

Recommended structured flows:

- `request_quote`
- `sell_waste`
- `buy_recycled_material`
- `service_enquiry`
- `general_business_enquiry`

Recommended field groups:

- company and contact identity
- location
- requirement type
- material
- quantity
- timeline
- message
- source attribution

## 9. Trust Signals Needed

The reference relies on trust signals such as:

- years/experience framing
- process explanation
- product quality language
- impact metrics
- industry use cases
- testimonials
- location/contact visibility

For our implementation, trust content must be original and factual. Unknown claims must remain placeholders until the recycler provides verified information.

## 10. Design Direction

The reference site points toward a visual language that should feel:

- industrial
- clean
- confident
- sustainability-aware
- B2B credible

For the implementation in this repo, we should avoid:

- generic SaaS startup aesthetics
- consumer e-commerce styling
- overly abstract sustainability branding with no industrial substance

The site should feel like a real plant-backed recycler with serious operations.

## 11. Gaps The New System Should Improve

Compared with the reference site, our target system should improve on:

- CRM integration
- structured lead capture
- pipeline visibility
- source attribution
- WhatsApp handoff
- internal follow-up workflow
- analytics
- multi-recycler configurability

This is the main difference between "a recycler website" and "a recycler growth system."

## 12. Recommendation

Plastigo Earth is a suitable reference for:

- content blocks
- section ordering
- recycler-specific business storytelling
- trust-building patterns
- buyer/supplier dual-audience cues

It should not be copied directly. We should use it as a structural reference and create an original, multi-page, conversion-driven recycler frontend that feeds structured data into existing ForgeChat contacts, deals, WhatsApp, and analytics flows.
