-- Add expires_at column to burner_emails table
ALTER TABLE burner_emails
ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Add index for performance (filtering active non-expired emails)
CREATE INDEX IF NOT EXISTS idx_burner_emails_expires_at
ON burner_emails(expires_at)
WHERE expires_at IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN burner_emails.expires_at IS 'Optional expiration date for the burner email';
