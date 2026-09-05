ALTER TABLE report_versions DROP CONSTRAINT IF EXISTS report_versions_subject_check;
UPDATE report_versions SET subject = 'workspace' WHERE subject IN ('personal', 'team');
ALTER TABLE report_versions ADD CONSTRAINT report_versions_subject_check
  CHECK (subject IN ('workspace', 'personal', 'team'));
