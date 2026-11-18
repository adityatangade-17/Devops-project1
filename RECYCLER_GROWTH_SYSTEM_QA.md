# Recycler Growth System QA Plan

Date: 2026-09-02

## 1. QA Objective

Verify that the recycler website, structured lead capture, ForgeChat integration, WhatsApp handoff, pipeline visibility, analytics attribution, and security controls work end to end without breaking existing ForgeChat behavior.

## 2. Existing Test Surface

Current repo test signals identified:

- backend package has `node --test test/*.test.js`
- frontend package has `vitest` and `playwright`
- existing frontend tests cover selected component logic

Recycler work will need additional coverage because the current test suite does not appear to cover a public multi-page recycler website or website-to-CRM intake flow.

## 3. Required Test Areas

### Public Website

- page loads
- navigation works
- mobile layout is usable
- no horizontal overflow
- CTA visibility is clear
- content placeholders are visibly non-final where facts are unknown

### Lead Forms

- valid submissions succeed
- invalid submissions fail cleanly
- required fields enforced
- field-specific validation messages shown
- form states work on mobile

### Backend Intake

- public endpoint accepts valid structured payloads
- invalid payloads are rejected
- rate limiting works
- duplicate contact logic behaves correctly
- source attribution is persisted

### CRM Mapping

- contact created or updated
- tags/categories applied correctly
- custom fields populated correctly
- deal created in expected pipeline/stage
- assigned users can see the result

### WhatsApp

- public CTA opens the expected configured WhatsApp destination
- existing WhatsApp inbox and webhook behavior remain intact
- no new competing webhook path introduced

### Analytics

- website lead counts increase after submission
- form type and source appear correctly
- page or CTA attribution appears when captured
- deal conversion path remains traceable

### Security

- secrets are not exposed in public frontend code
- privileged endpoints remain protected
- public inputs are sanitized
- abusive submission patterns are limited

## 4. Acceptance Test

Primary end-to-end acceptance flow:

1. Open the recycler website.
2. Visit a product, material, or service page.
3. Click a CTA such as Request a Quote.
4. Fill a structured form.
5. Submit successfully.
6. Verify the backend accepts the request.
7. Verify the contact exists in ForgeChat.
8. Verify source attribution is present.
9. Verify the deal or pipeline item is visible if configured.
10. Verify the sales team can act on it inside existing UI.

## 5. Regression Focus

Because this repo already powers active ForgeChat functionality, regressions must be checked in:

- login/setup flow
- chats
- contacts
- pipelines
- WhatsApp account management
- templates
- broadcasts
- existing dashboard behavior

## 6. Test Execution Notes

Before implementation:

- run existing backend and frontend test commands

After implementation:

- rerun the existing suite
- add targeted frontend tests
- add targeted backend tests
- add at least one end-to-end flow for the public enquiry journey

## 7. Exit Criteria

QA is complete when:

- the new recycler flow works end to end
- public pages work on desktop and mobile
- no critical regressions are found in existing ForgeChat functionality
- security and validation checks pass
- any known limitations are documented clearly
