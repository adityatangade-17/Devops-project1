function clean(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function extractInteractiveReply(interactive) {
  if (!interactive || typeof interactive !== 'object') return null;
  const reply = interactive.button_reply || interactive.list_reply || null;
  if (!reply || typeof reply !== 'object') return null;

  const kind = interactive.button_reply ? 'button_reply'
    : interactive.list_reply ? 'list_reply'
      : clean(interactive.type) || 'interactive';
  const id = clean(reply.id);
  const title = clean(reply.title);
  const description = clean(reply.description);

  return {
    kind,
    id,
    title,
    description,
    label: title || id || description || 'Interactive response',
  };
}

function getInteractiveCandidateTexts(interactiveReply, fallbackBody = null) {
  const seen = new Set();
  const values = [];
  [interactiveReply?.id, interactiveReply?.title, interactiveReply?.description, fallbackBody]
    .map(clean)
    .filter(Boolean)
    .forEach((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      values.push(value);
    });
  return values;
}

function formatInteractiveInboundText(interactiveReply, fallbackBody = null) {
  const reply = interactiveReply || null;
  if (!reply) return clean(fallbackBody) || '';

  const target = reply.kind === 'list_reply' ? 'list option' : 'button';
  if (reply.id && reply.title && reply.id !== reply.title) {
    return `User selected ${target}: ${reply.id} (${reply.title})`;
  }
  if (reply.id) return `User selected ${target}: ${reply.id}`;
  if (reply.title) return `User selected ${target}: ${reply.title}`;
  if (reply.description) return `User selected ${target}: ${reply.description}`;
  return clean(fallbackBody) || 'User selected an interactive option';
}

module.exports = {
  extractInteractiveReply,
  getInteractiveCandidateTexts,
  formatInteractiveInboundText,
};
