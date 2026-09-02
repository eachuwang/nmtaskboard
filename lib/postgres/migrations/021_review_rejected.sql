ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_review_status_check;
ALTER TABLE identities ADD CONSTRAINT identities_review_status_check
  CHECK (review_status IN ('pending', 'approved', 'rejected'));
