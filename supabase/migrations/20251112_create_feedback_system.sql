/*
  # Create Feedback and Telemetry System

  ## Overview
  Creates a comprehensive feedback and telemetry system for the Privaseer Chrome extension.
  All data is collected anonymously using installation IDs (UUIDs) with no personal information.

  ## Tables Created

  ### 1. user_feedback
  Stores user feedback submissions from the extension
  - `id` (uuid, primary key) - Unique feedback ID
  - `installation_id` (uuid) - Anonymous installation identifier
  - `feedback_text` (text) - The feedback content
  - `url` (text, optional) - URL where feedback was submitted
  - `domain` (text, optional) - Domain extracted from URL
  - `extension_version` (text, optional) - Extension version
  - `browser_version` (text, optional) - Browser version
  - `created_at` (timestamptz) - Submission timestamp

  ### 2. telemetry_events
  Stores anonymous telemetry events for understanding extension usage
  - `id` (uuid, primary key) - Unique event ID
  - `installation_id` (uuid) - Anonymous installation identifier
  - `event_type` (text) - Type of event (e.g., "tracker_blocked", "protection_toggled")
  - `event_data` (jsonb) - Additional event metadata
  - `extension_version` (text) - Extension version
  - `browser_version` (text, optional) - Browser version
  - `created_at` (timestamptz) - Event timestamp

  ## Security
  - RLS (Row Level Security) enabled on both tables
  - Public INSERT policy - anyone can submit feedback/telemetry (anonymous by design)
  - Admin-only SELECT policy - only service role can read data
  - No UPDATE or DELETE policies - data is append-only for integrity

  ## Important Notes
  1. All data collection is 100% anonymous using random UUIDs
  2. No personal information (email, name, etc.) is collected
  3. Data is append-only for audit trail integrity
  4. Only service role can read data (for admin dashboard)
*/

-- Create user_feedback table
CREATE TABLE IF NOT EXISTS user_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  feedback_text text NOT NULL,
  url text,
  domain text,
  extension_version text,
  browser_version text,
  created_at timestamptz DEFAULT now()
);

-- Create telemetry_events table
CREATE TABLE IF NOT EXISTS telemetry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  event_type text NOT NULL,
  event_data jsonb DEFAULT '{}'::jsonb,
  extension_version text NOT NULL,
  browser_version text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_feedback_installation_id ON user_feedback(installation_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON user_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_installation_id ON telemetry_events(installation_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_event_type ON telemetry_events(event_type);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_created_at ON telemetry_events(created_at DESC);

-- Enable Row Level Security
ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Allow anonymous feedback submission" ON user_feedback;
DROP POLICY IF EXISTS "Allow service role to read feedback" ON user_feedback;
DROP POLICY IF EXISTS "Allow anonymous telemetry submission" ON telemetry_events;
DROP POLICY IF EXISTS "Allow service role to read telemetry" ON telemetry_events;

-- Policies for user_feedback table
-- Allow anyone to INSERT (anonymous submissions)
CREATE POLICY "Allow anonymous feedback submission"
  ON user_feedback
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Allow service role to SELECT (admin access)
CREATE POLICY "Allow service role to read feedback"
  ON user_feedback
  FOR SELECT
  TO service_role
  USING (true);

-- Policies for telemetry_events table
-- Allow anyone to INSERT (anonymous telemetry)
CREATE POLICY "Allow anonymous telemetry submission"
  ON telemetry_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Allow service role to SELECT (admin access)
CREATE POLICY "Allow service role to read telemetry"
  ON telemetry_events
  FOR SELECT
  TO service_role
  USING (true);
