// User-facing release notes. This drives the "What's New" pop-up that greets a
// user after each update, so nobody is left wondering what changed.
//
// HOW TO ADD A RELEASE: prepend a new object with the NEXT integer `version`
// (always the highest number = newest) and a few plain-English items. The pop-up
// automatically shows every entry newer than what the user has already seen.

export const CHANGELOG = [
  {
    version: 1,
    label: 'SpiderChat launch',
    title: 'Welcome to SpiderChat',
    items: [
      { type: 'new', text: 'A connected workspace for chats, contacts, bookings, automations, and broadcasts.' },
      { type: 'new', text: 'Your own team inbox with an updated SpiderChat design.' },
      { type: 'new', text: 'Set up your admin account, then connect a WhatsApp number to get started.' },
    ],
  },
];

// The newest version number — anything a user hasn't seen up to this is shown.
export const LATEST_VERSION = CHANGELOG.length ? CHANGELOG[0].version : 0;

// Entries strictly newer than `seen` (0 / null => everything, i.e. a first login).
export function entriesSince(seen) {
  const s = Number(seen) || 0;
  return CHANGELOG.filter(e => e.version > s);
}
