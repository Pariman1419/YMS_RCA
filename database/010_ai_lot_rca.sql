ALTER TABLE ai_assistance_config ADD COLUMN IF NOT EXISTS external_knowledge_enabled boolean NOT NULL DEFAULT true;
