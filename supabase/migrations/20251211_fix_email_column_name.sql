-- Fix burner_emails column name mismatch
-- Move data from legacy "email" column to "email_address" and drop old column

UPDATE burner_emails
SET email_address = email
WHERE email_address IS NULL AND email IS NOT NULL;

ALTER TABLE burner_emails DROP COLUMN IF EXISTS email;
