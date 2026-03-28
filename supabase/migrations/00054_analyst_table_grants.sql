-- Grant permissions on all analyst tables to Supabase roles.
-- The migration runner creates tables as the postgres role, but PostgREST
-- connects as authenticator → anon/authenticated/service_role.
-- Without explicit grants, these roles get "permission denied".

-- Sources
GRANT ALL ON analyst_sources TO authenticated;
GRANT ALL ON analyst_sources TO service_role;

-- Dimensions
GRANT ALL ON analyst_dimensions TO authenticated;
GRANT ALL ON analyst_dimensions TO service_role;

-- Entities
GRANT ALL ON analyst_entities TO authenticated;
GRANT ALL ON analyst_entities TO service_role;

-- Aliases
GRANT ALL ON analyst_aliases TO authenticated;
GRANT ALL ON analyst_aliases TO service_role;

-- Validation rules
GRANT ALL ON analyst_validation_rules TO authenticated;
GRANT ALL ON analyst_validation_rules TO service_role;

-- Datasets
GRANT ALL ON analyst_datasets TO authenticated;
GRANT ALL ON analyst_datasets TO service_role;

-- Records
GRANT ALL ON analyst_records TO authenticated;
GRANT ALL ON analyst_records TO service_role;

-- Validation runs
GRANT ALL ON analyst_validation_runs TO authenticated;
GRANT ALL ON analyst_validation_runs TO service_role;

-- Anomalies
GRANT ALL ON analyst_anomalies TO authenticated;
GRANT ALL ON analyst_anomalies TO service_role;

-- Templates
GRANT ALL ON analyst_templates TO authenticated;
GRANT ALL ON analyst_templates TO service_role;

-- Pipeline runs
GRANT ALL ON analyst_pipeline_runs TO authenticated;
GRANT ALL ON analyst_pipeline_runs TO service_role;

-- Account health
GRANT ALL ON analyst_account_health TO authenticated;
GRANT ALL ON analyst_account_health TO service_role;

-- Opportunities
GRANT ALL ON analyst_opportunities TO authenticated;
GRANT ALL ON analyst_opportunities TO service_role;

-- Playbook outputs
GRANT ALL ON analyst_playbook_outputs TO authenticated;
GRANT ALL ON analyst_playbook_outputs TO service_role;
