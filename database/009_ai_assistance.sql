CREATE TABLE IF NOT EXISTS ai_assistance_config (
 id integer PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT true,
 model text NOT NULL DEFAULT 'gemma3:4b', system_prompt text NOT NULL,
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), updated_by text
);
INSERT INTO ai_assistance_config(id,system_prompt) VALUES(1,'You are YMS AI Assistance, a semiconductor yield engineer. Respond with Executive Summary, Trend Analysis, Root Cause Candidates, Recommended Actions, and Improvement Opportunities. Be concise and explain missing evidence.') ON CONFLICT DO NOTHING;
ALTER TABLE dim_machine ADD COLUMN IF NOT EXISTS machine_model text;
CREATE INDEX IF NOT EXISTS dim_machine_model_idx ON dim_machine(machine_model);
