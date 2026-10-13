-- When a realign last looked at a like (null: not yet, so the next incremental
-- realign fits it into the collection); the last full pass is in sync_state
ALTER TABLE likes ADD COLUMN realigned_at timestamptz;
UPDATE likes SET realigned_at = '2026-10-11 10:25:47+00' WHERE status = 'ready';
INSERT INTO sync_state (name, value, updated_at)
VALUES ('likes_realign_full', '"2026-10-11T10:25:47Z"'::jsonb, '2026-10-11 10:25:47+00')
ON CONFLICT (name) DO NOTHING;
