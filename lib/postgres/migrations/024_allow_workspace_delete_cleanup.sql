CREATE OR REPLACE FUNCTION reject_report_version_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('nmtaskboard.workspace_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'report_versions is append-only';
END;
$$;
