async function req(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text}`);
  }
  return res.json();
}

export const api = {
  auth: {
    me: () => req('/auth/me'),
    status: () => req('/auth/status'),
    setup: (email, password, displayName) =>
      req('/auth/setup', { method: 'POST', body: JSON.stringify({ email, password, displayName }) }),
    login: (email, password) =>
      req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    logout: () => req('/auth/logout', { method: 'POST' }),
  },
  dashboard: (range = '7d') => req(`/dashboard?range=${encodeURIComponent(range)}`),
  dashboardDetails: (metric, range = '7d') =>
    req(`/dashboard/details?metric=${encodeURIComponent(metric)}&range=${encodeURIComponent(range)}`),
  numbers: () => req('/numbers'),
  contacts: (waNumber, timeRange) =>
    req(`/contacts?waNumber=${encodeURIComponent(waNumber)}&timeRange=${timeRange}`),
  messages: (params) => {
    const qs = new URLSearchParams(params);
    return req(`/messages?${qs}`);
  },
  contactNames: (waNumber) =>
    req(`/contact-names?waNumber=${encodeURIComponent(waNumber)}`),
  contact: (waNumber, contactNumber) =>
    req(`/contact?waNumber=${encodeURIComponent(waNumber)}&contactNumber=${encodeURIComponent(contactNumber)}`),
  saveContact: (waNumber, contactNumber, name, tags = [], customFields, assignedUserId) =>
    req('/contacts/save', {
      method: 'POST',
      body: JSON.stringify({
        waNumber, contactNumber, name, tags,
        ...(customFields !== undefined ? { customFields } : {}),
        ...(assignedUserId !== undefined ? { assignedUserId } : {}),
      }),
    }),
  savedContacts: (waNumber) =>
    req(`/saved-contacts?waNumber=${encodeURIComponent(waNumber)}`),
  stopContacts: (waNumber) =>
    req(`/stop-contacts?waNumber=${encodeURIComponent(waNumber)}`),
  deleteContact: (waNumber, contactNumber) =>
    req(`/contact?waNumber=${encodeURIComponent(waNumber)}&contactNumber=${encodeURIComponent(contactNumber)}`, { method: 'DELETE' }),
  bulkAssignContacts: (waNumber, contactNumbers, assignedUserId) =>
    req('/contacts/bulk-assign', { method: 'POST', body: JSON.stringify({ waNumber, contactNumbers, assignedUserId }) }),
  changeContactNumber: (waNumber, oldNumber, newNumber) =>
    req('/contacts/change-number', { method: 'POST', body: JSON.stringify({ waNumber, oldNumber, newNumber }) }),
  pauseAi: (waNumber, contactNumber, reason) =>
    req('/contacts/pause-ai', { method: 'POST', body: JSON.stringify({ waNumber, contactNumber, reason }) }),
  resumeAi: (waNumber, contactNumber) =>
    req('/contacts/resume-ai', { method: 'POST', body: JSON.stringify({ waNumber, contactNumber }) }),
  importContactsTemplateUrl: () => '/api/contacts/import/template',
  importContacts: (waNumber, file, tags = []) => {
    const form = new FormData();
    form.append('waNumber', waNumber);
    form.append('file', file);
    if (tags && tags.length) form.append('tags', JSON.stringify(tags));
    return fetch('/api/contacts/import', { method: 'POST', credentials: 'include', body: form })
      .then(async res => {
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          let msg = text;
          try { msg = JSON.parse(text).error || text; } catch { /* keep raw */ }
          throw new Error(msg || `${res.status}`);
        }
        return res.json();
      });
  },
  categories: {
    list: () => req('/categories'),
    create: (data) => req('/categories', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/categories/${id}`, { method: 'DELETE' }),
  },
  tags: {
    list: () => req('/tags'),
    create: (data) => req('/tags', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/tags/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/tags/${id}`, { method: 'DELETE' }),
  },
  contactFields: {
    list: () => req('/contact-fields'),
    create: (data) => req('/contact-fields', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/contact-fields/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/contact-fields/${id}`, { method: 'DELETE' }),
  },
  users: {
    list: () => req('/users'),
    presence: () => req('/users/presence'),
    tourComplete: () => req('/users/tour-complete', { method: 'POST' }),
    get: (id) => req(`/users/${id}`),
    create: (data) => req('/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id) => req(`/users/${id}`, { method: 'DELETE' }),
    resetPassword: (id, password) => req(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify(password ? { password } : {}),
    }),
  },
  templates: {
    list: ({ accountId, status, q } = {}) => {
      const qs = new URLSearchParams();
      if (accountId) qs.set('accountId', accountId);
      if (status) qs.set('status', status);
      if (q) qs.set('q', q);
      const s = qs.toString();
      return req(`/templates${s ? `?${s}` : ''}`);
    },
    get: (id) => req(`/templates/${id}`),
    create: (data) => req('/templates', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/templates/${id}`, { method: 'DELETE' }),
    submit: (id) => req(`/templates/${id}/submit`, { method: 'POST' }),
    sync: (id) => req(`/templates/${id}/sync`, { method: 'POST' }),
    duplicate: (id) => req(`/templates/${id}/duplicate`, { method: 'POST' }),
    payload: (id) => req(`/templates/${id}/payload`),
  },
  broadcasts: {
    list: (status) => req(`/broadcasts${status && status !== 'all' ? `?status=${status}` : ''}`),
    get: (id) => req(`/broadcasts/${id}`),
    create: (data) => req('/broadcasts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/broadcasts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/broadcasts/${id}`, { method: 'DELETE' }),
    send: (id) => req(`/broadcasts/${id}/send`, { method: 'POST' }),
    test: (id, testNumber) => req(`/broadcasts/${id}/test`, { method: 'POST', body: JSON.stringify({ test_number: testNumber }) }),
  },
  chatbots: {
    list: () => req('/chatbots'),
    get: (id) => req(`/chatbots/${id}`),
    create: (data) => req('/chatbots', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/chatbots/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    duplicate: (id) => req(`/chatbots/${id}/duplicate`, { method: 'POST' }),
    delete: (id) => req(`/chatbots/${id}`, { method: 'DELETE' }),
    executions: (id, { page = 1, limit = 20, status = 'all', startDate = '', endDate = '', messageStatus = 'all' } = {}) => {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status && status !== 'all') qs.set('status', status);
      if (startDate) qs.set('startDate', startDate);
      if (endDate) qs.set('endDate', endDate);
      if (messageStatus && messageStatus !== 'all') qs.set('messageStatus', messageStatus);
      return req(`/chatbots/${id}/executions?${qs}`);
    },
  },
  executions: {
    get: (id) => req(`/executions/${id}`),
    cancel: (id) => req(`/executions/${id}/cancel`, { method: 'POST' }),
  },
  whatsappAccounts: {
    list: (activeOnly = false) => req(`/whatsapp-accounts${activeOnly ? '?activeOnly=true' : ''}`),
    get: (id) => req(`/whatsapp-accounts/${id}`),
    create: (data) => req('/whatsapp-accounts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/whatsapp-accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/whatsapp-accounts/${id}`, { method: 'DELETE' }),
  },
  googleIntegrations: {
    status: () => req('/google-integrations/status'),
    getCredentials: (reveal = false) => req(`/google-integrations/credentials${reveal ? '?reveal=1' : ''}`),
    saveCredentials: (data) =>
      req('/google-integrations/credentials', { method: 'PUT', body: JSON.stringify(data) }),
    deleteCredentials: () =>
      req('/google-integrations/credentials', { method: 'DELETE' }),
    list: () => req('/google-integrations'),
    authorize: () => req('/google-integrations/authorize', { method: 'POST' }),
    disconnect: (id) => req(`/google-integrations/${id}`, { method: 'DELETE' }),
    listSpreadsheets: (id, q = '') =>
      req(`/google-integrations/${id}/spreadsheets${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    listTabs: (id, spreadsheetId) =>
      req(`/google-integrations/${id}/spreadsheets/${encodeURIComponent(spreadsheetId)}/tabs`),
  },
  venture: {
    profile: () => req('/venture/profile'),
    saveProfile: (data) => req('/venture/profile', { method: 'PUT', body: JSON.stringify(data) }),
    offices: () => req('/venture/offices'),
    addOffice: (data) => req('/venture/offices', { method: 'POST', body: JSON.stringify(data) }),
    removeOffice: (id) => req(`/venture/offices/${id}`, { method: 'DELETE' }),
    products: () => req('/venture/products'),
    addProduct: (data) => req('/venture/products', { method: 'POST', body: JSON.stringify(data) }),
    removeProduct: (id) => req(`/venture/products/${id}`, { method: 'DELETE' }),
  },
  tasks: {
    list: (params = {}) => {
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
      return req(`/tasks${q ? `?${q}` : ''}`);
    },
    count: () => req('/tasks/count'),
    create: (data) => req('/tasks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id) => req(`/tasks/${id}`, { method: 'DELETE' }),
  },
  aiModels: {
    list: () => req('/ai-models'),
    get: (id, reveal = false) => req(`/ai-models/${id}${reveal ? '?reveal=1' : ''}`),
    create: (data) => req('/ai-models', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/ai-models/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/ai-models/${id}`, { method: 'DELETE' }),
  },
  agents: {
    list: () => req('/agents'),
    presets: () => req('/agents/presets'),
    installPreset: (presetKey, waAccountId = null) =>
      req('/agents/install-preset', { method: 'POST', body: JSON.stringify({ presetKey, waAccountId }) }),
    generate: (data = {}) => req('/agents/generate', { method: 'POST', body: JSON.stringify(data) }),
    installGenerated: (agents) => req('/agents/install-generated', { method: 'POST', body: JSON.stringify({ agents }) }),
    managerReport: (days = 7, waNumber = null) =>
      req(`/agents/manager-report?days=${encodeURIComponent(days)}${waNumber ? `&waNumber=${encodeURIComponent(waNumber)}` : ''}`),
    managerSchedule: () => req('/agents/manager-report/schedule'),
    updateManagerSchedule: (data) => req('/agents/manager-report/schedule', { method: 'PUT', body: JSON.stringify(data) }),
    campaigns: () => req('/agents/campaigns'),
    updateCampaign: (kind, data) => req(`/agents/campaigns/${kind}`, { method: 'PUT', body: JSON.stringify(data) }),
    previewCampaign: (kind) => req(`/agents/campaigns/${kind}/preview`),
    get: (id, reveal = false) => req(`/agents/${id}${reveal ? '?reveal=1' : ''}`),
    create: (data) => req('/agents', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/agents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/agents/${id}`, { method: 'DELETE' }),
    runs: (id, limit = 50) => req(`/agents/${id}/runs?limit=${limit}`),
    run: (id, runId) => req(`/agents/${id}/runs/${runId}`),
    addTool: (id, data) => req(`/agents/${id}/tools`, { method: 'POST', body: JSON.stringify(data) }),
    updateTool: (id, toolId, data) =>
      req(`/agents/${id}/tools/${toolId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeTool: (id, toolId) => req(`/agents/${id}/tools/${toolId}`, { method: 'DELETE' }),
    test: (id, messages) => req(`/agents/${id}/test`, {
      method: 'POST', body: JSON.stringify({ messages }),
    }),
    testTranscribe: (id, audioBlob, filename = 'voice.webm') => {
      const form = new FormData();
      form.append('audio', audioBlob, filename);
      return fetch(`/api/agents/${id}/test/transcribe`, {
        method: 'POST', credentials: 'include', body: form,
      }).then(async res => {
        if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`${res.status} ${t}`); }
        return res.json();
      });
    },
  },
  knowledgeBases: {
    list: () => req('/knowledge-bases'),
    create: (data) => req('/knowledge-bases', { method: 'POST', body: JSON.stringify(data) }),
    documents: (id) => req(`/knowledge-bases/${id}/documents`),
    upload: (id, file, title = '') => {
      const form = new FormData();
      form.append('file', file);
      if (title) form.append('title', title);
      return fetch(`/api/knowledge-bases/${id}/documents`, { method: 'POST', credentials: 'include', body: form }).then(async r => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        return r.json();
      });
    },
    removeDocument: (baseId, documentId) => req(`/knowledge-bases/${baseId}/documents/${documentId}`, { method: 'DELETE' }),
  },
  pipelines: {
    list: () => req('/pipelines'),
    create: (name) => req('/pipelines', { method: 'POST', body: JSON.stringify({ name }) }),
    update: (id, name) => req(`/pipelines/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
    delete: (id) => req(`/pipelines/${id}`, { method: 'DELETE' }),
    addStage: (pipelineId, data) => req(`/pipelines/${pipelineId}/stages`, { method: 'POST', body: JSON.stringify(data) }),
    updateStage: (stageId, data) => req(`/stages/${stageId}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteStage: (stageId) => req(`/stages/${stageId}`, { method: 'DELETE' }),
    reorderStages: (pipelineId, order) => req(`/pipelines/${pipelineId}/stages/reorder`, { method: 'PUT', body: JSON.stringify({ order }) }),
  },
  deals: {
    list: (pipelineId) => req(`/deals?pipelineId=${encodeURIComponent(pipelineId)}`),
    metrics: (pipelineId) => req(`/deals/metrics?pipelineId=${encodeURIComponent(pipelineId)}`),
    create: (data) => req('/deals', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => req(`/deals/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    move: (id, stageId) => req(`/deals/${id}/move`, { method: 'POST', body: JSON.stringify({ stageId }) }),
    delete: (id) => req(`/deals/${id}`, { method: 'DELETE' }),
    contactSearch: (q) => req(`/deals/contact-search?q=${encodeURIComponent(q)}`),
  },
  booking: {
    // services
    services: () => req('/booking/services'),
    createService: (data) => req('/booking/services', { method: 'POST', body: JSON.stringify(data) }),
    updateService: (id, data) => req(`/booking/services/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteService: (id) => req(`/booking/services/${id}`, { method: 'DELETE' }),
    setServiceConsultants: (id, consultantIds) =>
      req(`/booking/services/${id}/consultants`, { method: 'PUT', body: JSON.stringify({ consultantIds }) }),
    // consultants
    consultants: () => req('/booking/consultants'),
    createConsultant: (data) => req('/booking/consultants', { method: 'POST', body: JSON.stringify(data) }),
    updateConsultant: (id, data) => req(`/booking/consultants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteConsultant: (id) => req(`/booking/consultants/${id}`, { method: 'DELETE' }),
    // bookings
    bookings: (status) => req(`/booking/bookings${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    cancelBooking: (id) => req(`/booking/bookings/${id}/cancel`, { method: 'POST' }),
    setBookingStatus: (id, status) => req(`/booking/bookings/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    reassignBooking: (id, consultantId) => req(`/booking/bookings/${id}/reassign`, { method: 'POST', body: JSON.stringify({ consultantId }) }),
    // Google Calendar linking
    googleAccounts: () => req('/booking/google/accounts'),
    googleAuthorize: () => req('/booking/google/authorize', { method: 'POST' }),
    // Payouts
    payouts: () => req('/booking/payouts'),
    runPayout: (consultantId) => req(`/booking/consultants/${consultantId}/payout`, { method: 'POST' }),
  },
  retryMedia: (messageId) => req(`/media/${encodeURIComponent(messageId)}/retry`, { method: 'POST' }),
  mediaUrl: (messageId) => `/api/media/${encodeURIComponent(messageId)}`,
  windowStatus: (waNumber, contactNumber) =>
    req(`/messages/window-status?waNumber=${encodeURIComponent(waNumber)}&contactNumber=${encodeURIComponent(contactNumber)}`),
  markRead: (waNumber, contactNumber) =>
    req('/messages/mark-read', { method: 'POST', body: JSON.stringify({ waNumber, contactNumber }) }),
  // Admin-only: permanently delete an entire conversation (messages + contact).
  deleteConversation: (waNumber, contactNumber) =>
    req('/conversations', { method: 'DELETE', body: JSON.stringify({ waNumber, contactNumber }) }),
  // Emoji reaction to a message (empty emoji removes it).
  react: (fromNumber, toNumber, messageId, emoji) =>
    req('/messages/react', { method: 'POST', body: JSON.stringify({ fromNumber, toNumber, messageId, emoji }) }),
  // Local-only "star" bookmark on a message.
  star: (waNumber, contactNumber, messageId, starred) =>
    req('/messages/star', { method: 'POST', body: JSON.stringify({ waNumber, contactNumber, messageId, starred }) }),
  sendMessage: ({ fromNumber, toNumber, text, contextMessageId }) =>
    req('/messages/send', { method: 'POST', body: JSON.stringify({ fromNumber, toNumber, text, contextMessageId }) }),
  // AI smart-reply suggestions (feature c) — returns { drafts: [...] }
  suggestReply: (waNumber, contactNumber) =>
    req(`/messages/suggest-reply?waNumber=${encodeURIComponent(waNumber)}&contactNumber=${encodeURIComponent(contactNumber)}`),
  testTemplate: (id, to, sampleValues = {}) =>
    req(`/templates/${id}/test-send`, { method: 'POST', body: JSON.stringify({ to, sampleValues }) }),
  sendMedia: async ({ fromNumber, toNumber, caption, file, contextMessageId }) => {
    const form = new FormData();
    form.append('fromNumber', fromNumber);
    form.append('toNumber', toNumber);
    if (caption) form.append('caption', caption);
    if (contextMessageId) form.append('contextMessageId', contextMessageId);
    form.append('file', file);
    const res = await fetch('/api/messages/send-media', { method: 'POST', credentials: 'include', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `${res.status}`);
    return json;
  },
  sendLibraryMedia: ({ fromNumber, toNumber, mediaLibraryId, caption, contextMessageId }) =>
    req('/messages/send-library-media', {
      method: 'POST',
      body: JSON.stringify({ fromNumber, toNumber, mediaLibraryId, caption, contextMessageId }),
    }),
  resolveAccountByPhone: (phone) =>
    req(`/whatsapp-accounts/by-phone/${encodeURIComponent(phone)}`),
  sendAudio: async ({ fromNumber, toNumber, file, contextMessageId }) => {
    const form = new FormData();
    form.append('fromNumber', fromNumber);
    form.append('toNumber', toNumber);
    if (contextMessageId) form.append('contextMessageId', contextMessageId);
    form.append('file', file);
    const res = await fetch('/api/messages/send-audio', { method: 'POST', credentials: 'include', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `${res.status}`);
    return json;
  },
  uploadTemplateMediaHandleFromLibrary: ({ accountId, mediaLibraryId }) =>
    req('/templates/upload-media-handle-from-library', {
      method: 'POST',
      body: JSON.stringify({ accountId, mediaLibraryId }),
    }),
  uploadTemplateMediaHandle: async ({ accountId, file }) => {
    const form = new FormData();
    form.append('accountId', accountId);
    form.append('file', file);
    const res = await fetch('/api/templates/upload-media-handle', { method: 'POST', credentials: 'include', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `${res.status}`);
    return json;
  },
  syncTemplate: (id) => req(`/templates/${id}/sync`, { method: 'POST' }),
  syncAllTemplates: () => req('/templates/sync-all', { method: 'POST' }),
  duplicateTemplate: (id) => req(`/templates/${id}/duplicate`, { method: 'POST' }),
  bulkSubmitTemplates: (ids) => req('/templates/bulk-submit', { method: 'POST', body: JSON.stringify({ ids }) }),
  mediaLibrary: {
    // accountId scopes media to its owning (connected) WhatsApp account.
    list: (accountId) => req(`/media-library${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`),
    upload: (file, name, notes, accountId) => {
      const form = new FormData();
      form.append('file', file);
      if (name) form.append('name', name);
      if (notes) form.append('notes', notes);
      if (accountId) form.append('accountId', accountId);
      return fetch('/api/media-library', {
        method: 'POST',
        credentials: 'include',
        body: form,
      }).then(async res => {
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`${res.status} ${text}`);
        }
        return res.json();
      });
    },
    update: (id, data) =>
      req(`/media-library/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => req(`/media-library/${id}`, { method: 'DELETE' }),
    sync: (id, accountId) =>
      req(`/media-library/${id}/sync/${accountId}`, { method: 'POST' }),
    downloadUrl: (id) => `/api/media-library/${id}/download`,
  },
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return fetch('/api/upload', {
      method: 'POST',
      credentials: 'include',
      body: form,
    }).then(async res => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${res.status} ${text}`);
      }
      return res.json();
    });
  },
};
