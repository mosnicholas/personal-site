-- Marks the last full tag glossary pass, so the weekly runs after it only
-- define new tags
INSERT INTO sync_state (name, value, updated_at)
VALUES ('tag_glossary_full', '"2026-10-11T08:32:11Z"'::jsonb, '2026-10-11 08:32:11+00')
ON CONFLICT (name) DO NOTHING;
