-- Add anthropic and google as named providers
ALTER TABLE keykeeper_secrets
  DROP CONSTRAINT keykeeper_secrets_provider_check,
  ADD CONSTRAINT keykeeper_secrets_provider_check
    CHECK (provider IN ('openai', 'stripe', 'github', 'anthropic', 'google', 'other'));

ALTER TABLE keykeeper_intake_tokens
  DROP CONSTRAINT keykeeper_intake_tokens_provider_check,
  ADD CONSTRAINT keykeeper_intake_tokens_provider_check
    CHECK (provider IN ('openai', 'stripe', 'github', 'anthropic', 'google', 'other'));
