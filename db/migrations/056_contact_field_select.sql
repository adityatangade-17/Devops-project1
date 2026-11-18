-- Add a 'select' (dropdown) custom field type with admin-defined options.
-- The options list is stored as a JSON array of strings on the field definition;
-- a contact's chosen value still lives in coexistence.contacts.custom_fields.

ALTER TABLE coexistence.contact_field_definitions
  DROP CONSTRAINT IF EXISTS contact_field_definitions_field_type_check;

ALTER TABLE coexistence.contact_field_definitions
  ADD CONSTRAINT contact_field_definitions_field_type_check
  CHECK (field_type IN ('text', 'number', 'phone', 'email', 'date', 'url', 'textarea', 'select'));

ALTER TABLE coexistence.contact_field_definitions
  ADD COLUMN IF NOT EXISTS options JSONB NOT NULL DEFAULT '[]'::jsonb;
