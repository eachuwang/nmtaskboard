ALTER TABLE identities
  ADD COLUMN review_status text NOT NULL DEFAULT 'approved'
    CHECK (review_status IN ('pending', 'approved')),
  ADD COLUMN approved_at timestamptz;

UPDATE identities
SET approved_at = created_at
WHERE review_status = 'approved' AND approved_at IS NULL AND is_system_admin = false;
