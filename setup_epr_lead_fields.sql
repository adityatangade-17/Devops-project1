-- EPR lead-tracking custom fields for the sales team.
-- These appear on every contact; the assigned sales user fills them while
-- calling, and they all flow into the CSV export. Idempotent (stable ids).
-- Requires migration 056 (select type + options column) to be applied first.

INSERT INTO coexistence.contact_field_definitions (id, name, description, field_type, options, sort_order) VALUES
  ('fld-epr-callstatus', 'Call Status', 'Outcome of the latest call', 'select',
     '["Not Called","Call Back Later","No Answer","Interested","Not Interested","Lead","Converted","Wrong Number","Do Not Disturb"]'::jsonb, 1),
  ('fld-epr-leadquality', 'Lead Quality', 'How promising is this lead', 'select',
     '["Hot","Warm","Cold"]'::jsonb, 2),
  ('fld-epr-service', 'Service Interested', 'Which EPR service they need', 'select',
     '["Plastic Packaging EPR","E-Waste EPR","Battery Waste EPR","Tyre Waste EPR","ELV EPR","Used Oil EPR","Multiple","Not Sure"]'::jsonb, 3),
  ('fld-epr-contactperson', 'Contact Person', 'Name of the person spoken to', 'text', '[]'::jsonb, 4),
  ('fld-epr-designation', 'Designation', 'Their role (Owner / Manager / etc.)', 'text', '[]'::jsonb, 5),
  ('fld-epr-email', 'Email', 'Company / contact email', 'email', '[]'::jsonb, 6),
  ('fld-epr-gst', 'GST Number', 'Company GST number', 'text', '[]'::jsonb, 7),
  ('fld-epr-turnover', 'Annual Turnover', 'Company annual turnover', 'text', '[]'::jsonb, 8),
  ('fld-epr-city', 'City / State', 'Location of the company', 'text', '[]'::jsonb, 9),
  ('fld-epr-followup', 'Next Follow-up', 'Date to call them back', 'date', '[]'::jsonb, 10),
  ('fld-epr-notes', 'Call Notes', 'What was discussed / what the company said', 'textarea', '[]'::jsonb, 11)
ON CONFLICT (id) DO NOTHING;
