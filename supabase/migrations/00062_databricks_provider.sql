-- 00062: Add Databricks to marketplace providers
ALTER TYPE marketplace_provider ADD VALUE IF NOT EXISTS 'databricks';
