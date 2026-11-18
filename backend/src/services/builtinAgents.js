// Built-in AI Agent catalog.
//
// These are the productised agents shipped with the platform (Neubrain Solutions
// EPR/compliance CRM). They are NOT bespoke agents an operator authors from a
// blank prompt — they are curated presets an admin installs with one click.
//
// Two delivery mechanisms, by category:
//
//   * category 'inbound'  — plugs straight into the existing agent engine
//     (agentEngine.runAgent): a customer messages the WhatsApp number, the agent
//     replies using the same LLM tool-use loop as any hand-authored agent.
//     Installed via POST /agents/install-preset, which creates a *draft* agent
//     (status='draft' => never takes live traffic) so the admin connects an AI
//     model and explicitly activates it per WhatsApp number. This is the
//     "ships PAUSED, admin activates" rule.
//
//   * category 'proactive' — outbound worker that MESSAGES customers who did NOT
//     just write in (recovery of stalled leads, reactivation of an old database,
//     payment collection). On WhatsApp these can only send business-initiated
//     template messages, so they are gated on Meta-approved templates + rate
//     limits + opt-out, and are NOT installable as engine agents. They are
//     surfaced here so the catalog is complete and honest about what's live.
//
//   * category 'analytics' — the Manager agent: an internal report to management,
//     zero customer messaging, zero customer risk. Delivered by managerReport.js.
//
// Nothing here writes money messages or legal advice autonomously — the Proposal
// and Collection agents draft, then hand off to a human for review before any
// figure or payment ask goes out (trigger_handoff), per the production decision.

// Shared guardrails prepended to every inbound agent prompt so behaviour is
// consistent and safe regardless of which preset is installed.
const SAFETY_PREAMBLE = `You are a WhatsApp assistant for Neubrain Solutions, a firm that helps Indian businesses with EPR (Extended Producer Responsibility) and related regulatory compliance (plastic waste, e-waste, battery, tyre, BIS, CDSCO, LMPC, ISO and similar registrations and returns).

Non-negotiable rules:
- Keep replies short and WhatsApp-appropriate: a few lines, no long essays, no markdown headings. One clear next step per message.
- Reply in the SAME language the customer uses (English, Hindi, or Hinglish). Mirror their tone but stay professional.
- NEVER invent prices, timelines, legal deadlines, or regulatory advice. If you are not certain of a fact, say a specialist will confirm and, when the question is about price/legal specifics or the customer asks for a human, call trigger_handoff after telling the customer you are connecting them to the team.
- NEVER promise approval, guarantee outcomes, or quote a government fee you are not certain about.
- Do not ask for or store sensitive documents (Aadhaar, PAN images, bank details) in chat — a consultant collects those securely after handoff.
- Record what you learn using set_custom_field and add_tag so the CRM stays accurate. Adjust the lead score with update_lead_score as intent becomes clearer.
- If the customer is upset, confused, or explicitly wants a person, hand off promptly. It is always better to escalate than to guess.`;

/**
 * The catalog. `key` is a stable slug used by install-preset. `installable`
 * marks the inbound presets that become engine agents. `defaults` is the body
 * merged into POST /agents when installing (status forced to 'draft').
 */
const PRESETS = [
  {
    key: 'lead_qualification',
    name: 'Lead Qualification Agent',
    description: 'Greets new WhatsApp leads, asks the right qualifying questions, scores and tags them, and routes hot leads to a human.',
    category: 'inbound',
    icon: 'UserSearch',
    installable: true,
    tools: ['set_custom_field', 'add_tag', 'update_lead_score', 'trigger_handoff', 'send_media'],
    defaults: {
      triggerMode: 'any',
      systemPrompt: `${SAFETY_PREAMBLE}

YOUR ROLE — Lead Qualification.
When a new lead messages, your job is to understand what they need and how ready they are to buy, then route them.

Do this over a short, natural conversation (don't interrogate — one or two questions per message):
1. Warmly greet them and ask what compliance they need help with.
2. Identify: their business type (manufacturer / importer / brand owner / seller / other), the product/waste category involved (plastic, e-waste, battery, tyre, etc.), whether they already have any registration, and their urgency/timeline.
3. Save each answer with set_custom_field using these exact field names when they exist: "Business Type", "Product Category", "Requirement", "Timeline". Tag the lead source and category with add_tag.
4. Scoring — use update_lead_score: +15 clear requirement, +15 urgent timeline (this month), +10 decision-maker, +10 has budget/asks about price, -10 just researching / student / no business.
5. When a lead is clearly qualified and high-intent (asking about price, wants to start, urgent), tell them you're connecting them to a specialist and call trigger_handoff. For low-intent leads, answer helpfully and invite them to reach out when ready — do not hand off.

Never quote a price yourself — if they ask "how much", say a specialist will share exact pricing for their case and hand off.`,
      handoverMessage: 'Thank you! Based on what you\'ve shared, I\'m connecting you with one of our compliance specialists who will guide you on the exact process and pricing. They\'ll message you here shortly. For anything urgent you can call {{consultant_phone}}.',
    },
  },
  {
    key: 'appointment',
    name: 'Appointment Agent',
    description: 'Turns interested chats into booked consultations — shares the live booking link, answers slot questions, and confirms the meeting.',
    category: 'inbound',
    icon: 'CalendarClock',
    installable: true,
    tools: ['share_booking_link', 'set_custom_field', 'add_tag', 'trigger_handoff'],
    defaults: {
      triggerMode: 'any',
      systemPrompt: `${SAFETY_PREAMBLE}

YOUR ROLE — Appointment booking.
Your job is to get an interested customer onto a consultation call with the right specialist.

How to work:
1. Briefly understand which service the customer wants a call about (e.g. plastic EPR, e-waste, BIS).
2. Call share_booking_link with a short service_query to fetch the correct live booking page, then send the customer that exact link and invite them to pick any convenient slot. Tell them the meeting link is generated automatically once they confirm.
3. If share_booking_link returns no matching service, do NOT invent a link — tell them a team member will arrange a suitable time and call trigger_handoff.
4. Save their intended service and preferred timing with set_custom_field ("Requirement", "Preferred Time") and tag them with add_tag ("wants-consultation").
5. If the customer struggles to use the link, has an unusual scheduling need, or wants to talk to a person, hand off.

Keep it frictionless — the booking page does the scheduling, calendar checks, and meeting-link creation for you. Never quote prices; a specialist covers that on the call.`,
      handoverMessage: 'No problem — I\'ll have a specialist arrange a suitable time and reach out to you here. For anything urgent you can call {{consultant_phone}}.',
    },
  },
  {
    key: 'proposal',
    name: 'Proposal Agent',
    description: 'Gathers everything needed for a quote, drafts the proposal from real service pricing, and routes it to a human to review before it\'s sent.',
    category: 'inbound',
    icon: 'FileText',
    installable: true,
    tools: ['set_custom_field', 'add_tag', 'trigger_handoff', 'send_media'],
    defaults: {
      triggerMode: 'any',
      systemPrompt: `${SAFETY_PREAMBLE}

YOUR ROLE — Proposal / quotation intake.
Customers ask for a quote. You gather everything needed for an accurate proposal, then route it to a human who prepares and reviews the figures. You DO NOT send prices yourself.

How to work:
1. Collect the scope needed to quote: exact service(s) required, product/waste categories and quantities, business size/turnover band if relevant, whether they need one-time registration or ongoing returns, and any deadline.
2. Save these with set_custom_field ("Requirement", "Product Category", "Scope Notes", "Timeline") and tag with add_tag ("proposal-requested").
3. If we have standard collateral (brochure, service sheet) that fits their need, share it with send_media.
4. Once you have enough to quote, tell the customer: "I have everything I need — our team will prepare a tailored proposal and share it with you shortly." Then call trigger_handoff so a specialist prepares and reviews the exact pricing before it goes out.
5. If the customer pushes for a number immediately, explain pricing depends on their specific scope and that the specialist will share an accurate figure — do not guess or anchor a price.

Money and legal figures are ALWAYS prepared and reviewed by a human. Your job is a complete, clean intake and a warm handoff.`,
      handoverMessage: 'Thank you — I have all the details. Our team is preparing a tailored proposal for your requirement and will share it with you here shortly. For anything urgent you can call {{consultant_phone}}.',
    },
  },
  {
    key: 'followup',
    name: 'Follow-up Agent',
    description: 'Re-engages cold or unanswered leads on a schedule with approved template nudges, respecting quiet hours and opt-out.',
    category: 'proactive',
    icon: 'BellRing',
    installable: false,
    status: 'worker',
    worker: 'followupWorker',
    note: 'Runs as a scheduled worker (24h / 72h / 7-day nudges) using Meta-approved templates, IST quiet hours, and opt-out awareness. Configure segments and templates, then enable the worker.',
  },
  {
    key: 'recovery',
    name: 'Recovery Agent',
    description: 'Recovers stalled deals — leads that engaged then went quiet — with a gentle, human-in-the-loop nudge.',
    category: 'proactive',
    icon: 'RotateCcw',
    installable: false,
    status: 'gated',
    note: 'Outbound to customers who did not just message in, so it requires Meta-approved templates + rate limits + opt-out handling before it can go live. Ships paused.',
  },
  {
    key: 'reactivation',
    name: 'Reactivation Agent',
    description: 'Wakes up an old contact database with a compliant, opt-out-aware re-introduction campaign.',
    category: 'proactive',
    icon: 'Zap',
    installable: false,
    status: 'gated',
    note: 'Bulk outbound to an aged database — the highest Meta-quality risk. Requires approved templates, strict rate limiting, opt-out, and a warmed number. Ships paused; enable per campaign after template approval.',
  },
  {
    key: 'collection',
    name: 'Collection Agent',
    description: 'Follows up on pending payments from real payment records, and hands every money conversation to a human before it\'s sent.',
    category: 'proactive',
    icon: 'IndianRupee',
    installable: false,
    status: 'gated',
    note: 'Chases unpaid/partly-paid bookings using real payment records. Because it involves money and outbound templates, every reminder is drafted for human review and gated on approved payment-reminder templates. Ships paused.',
  },
  {
    key: 'manager',
    name: 'Manager Agent',
    description: 'Reports to management — a weekly digest of leads received, uncontacted, high-intent, and likely to close. Internal only.',
    category: 'analytics',
    icon: 'BarChart3',
    installable: false,
    status: 'available',
    worker: 'managerReport',
    note: 'Generates an internal performance digest (e.g. "182 leads this week, 47 uncontacted, 18 high-intent, 7 likely to close") on demand or on a weekly schedule. No customer messaging — zero customer risk.',
  },
];

const PRESET_BY_KEY = Object.fromEntries(PRESETS.map(p => [p.key, p]));

// Public shape for the catalog endpoint — never leak nothing extra, but the
// system prompt is safe to show admins (they can edit it after install).
function presetPublic(p) {
  return {
    key: p.key,
    name: p.name,
    description: p.description,
    category: p.category,
    icon: p.icon,
    installable: !!p.installable,
    status: p.status || (p.installable ? 'installable' : 'info'),
    tools: p.tools || [],
    note: p.note || null,
    triggerMode: p.defaults?.triggerMode || null,
    systemPrompt: p.defaults?.systemPrompt || null,
  };
}

module.exports = { PRESETS, PRESET_BY_KEY, presetPublic, SAFETY_PREAMBLE };
