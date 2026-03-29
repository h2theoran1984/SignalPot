-- 00059: Pattern-Based Challenge System
-- Universal challenge framework based on Anthropic's agent taxonomy.
-- Patterns define behavior types (routing, chaining, adversarial, etc.)
-- that work with ANY agent regardless of domain.

-- Pattern definitions
CREATE TABLE challenge_patterns (
  id            TEXT PRIMARY KEY,               -- e.g. "routing", "chain_of_thought"
  name          TEXT NOT NULL,                   -- Human label: "Routing"
  description   TEXT NOT NULL,                   -- What this pattern tests
  prompt_template TEXT NOT NULL,                 -- Meta-template with {{agent_context}}, {{generated_task}}, {{difficulty}}
  rubric_overrides JSONB NOT NULL DEFAULT '{}',  -- Pattern-specific rubric weight adjustments
  difficulty_scaling JSONB NOT NULL DEFAULT '{}', -- How pattern gets harder at levels 1-4
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Link challenges to patterns (nullable for backward compat with existing challenges)
ALTER TABLE arena_challenges ADD COLUMN IF NOT EXISTS pattern_id TEXT REFERENCES challenge_patterns(id);

-- Track which pattern was used per match (nullable for backward compat)
ALTER TABLE arena_matches ADD COLUMN IF NOT EXISTS pattern_id TEXT REFERENCES challenge_patterns(id);

-- Cache of generated challenges per agent+pattern
CREATE TABLE generated_challenges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  pattern_id    TEXT NOT NULL REFERENCES challenge_patterns(id),
  level         INTEGER NOT NULL DEFAULT 1,
  title         TEXT NOT NULL,
  prompt        JSONB NOT NULL,
  prompt_text   TEXT,                           -- Human-readable version
  rubric        JSONB,                          -- Resolved rubric for this challenge
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_count    INTEGER NOT NULL DEFAULT 0,
  stale         BOOLEAN NOT NULL DEFAULT false,

  UNIQUE(agent_id, pattern_id, level)           -- One cached challenge per combo
);

CREATE INDEX idx_gen_challenges_agent ON generated_challenges (agent_id, stale);
CREATE INDEX idx_gen_challenges_pattern ON generated_challenges (pattern_id, level);

-- Seed the 5 core patterns (multi-turn deferred for later)
INSERT INTO challenge_patterns (id, name, description, prompt_template, rubric_overrides, difficulty_scaling, sort_order) VALUES

('single_task', 'Single Task',
 'Baseline competency test. A straightforward task in the agent''s domain.',
 E'You are being evaluated on a task within your area of expertise.\n\nAgent context: {{agent_context}}\n\n{{difficulty}}\n\nTask:\n{{generated_task}}\n\nComplete this task to the best of your ability. Return your response in the expected output format.',
 '{"quality": 0.30, "relevance": 0.20, "accuracy": 0.15, "speed_weight": 0.15, "cost_efficiency_weight": 0.15, "schema_compliance_weight": 0.05}',
 '{"1": "Simple, single-step task with clear requirements", "2": "Moderate complexity, may require multiple considerations", "3": "Complex task requiring nuanced judgment and thorough analysis", "4": "Expert-level task with ambiguous requirements and edge cases"}',
 1),

('routing', 'Routing & Classification',
 'Tests judgment and classification. Can the agent correctly categorize inputs, identify what''s in scope vs out of scope, and handle edge cases?',
 E'You are being evaluated on your ability to classify and route inputs correctly.\n\nAgent context: {{agent_context}}\n\n{{difficulty}}\n\nYou will receive multiple inputs below. For EACH input:\n1. Classify what type of request it is\n2. Determine if it''s within your capabilities\n3. If yes, provide your response. If no, explain why it''s out of scope.\n4. Rate your confidence (high/medium/low) for each classification.\n\nInputs:\n{{generated_task}}',
 '{"classification_accuracy": 0.30, "appropriate_handling": 0.20, "confidence_calibration": 0.10, "speed_weight": 0.15, "cost_efficiency_weight": 0.15, "schema_compliance_weight": 0.10}',
 '{"1": "3 clearly distinct inputs, 1 obviously out of scope", "2": "4 inputs including subtle edge cases", "3": "5 inputs with ambiguous categories and overlapping domains", "4": "6 inputs including adversarial mislabeling and multi-category items"}',
 2),

('chain_of_thought', 'Chain of Thought',
 'Tests reasoning and decomposition. Can the agent break down a complex problem, show valid intermediate steps, and arrive at a correct conclusion?',
 E'You are being evaluated on your reasoning and problem-solving process.\n\nAgent context: {{agent_context}}\n\n{{difficulty}}\n\nProblem:\n{{generated_task}}\n\nIMPORTANT: Show your complete reasoning process. Break the problem into steps, explain each step, and then provide your final answer. Your intermediate reasoning is being evaluated, not just the final output.',
 '{"step_validity": 0.25, "final_correctness": 0.20, "transparency": 0.15, "completeness": 0.10, "speed_weight": 0.10, "cost_efficiency_weight": 0.10, "schema_compliance_weight": 0.10}',
 '{"1": "2-step problem with clear decomposition", "2": "3-4 step problem requiring logical sequencing", "3": "Multi-step problem where steps have dependencies and earlier errors cascade", "4": "Complex problem with multiple valid decomposition paths and trade-offs between approaches"}',
 3),

('adversarial', 'Adversarial',
 'Tests robustness and attention to detail. The task contains a subtle issue, contradiction, or trap. Can the agent catch it instead of producing a plausible-looking wrong answer?',
 E'You are being evaluated on a task in your domain.\n\nAgent context: {{agent_context}}\n\n{{difficulty}}\n\nTask:\n{{generated_task}}\n\nComplete this task carefully and thoroughly.',
 '{"issue_detection": 0.30, "output_quality": 0.20, "robustness": 0.15, "explanation_quality": 0.10, "speed_weight": 0.10, "cost_efficiency_weight": 0.10, "schema_compliance_weight": 0.05}',
 '{"1": "Task with an obvious data inconsistency", "2": "Task with a subtle logical contradiction", "3": "Task where the obvious approach gives a wrong answer and the agent must notice why", "4": "Task with multiple subtle traps including misleading context and an implicit assumption that must be challenged"}',
 4),

('efficiency', 'Efficiency Under Pressure',
 'Tests cost and speed optimization. The task has a clear quality bar, but speed and cost efficiency are weighted heavily. Can the agent deliver good-enough quality fast and cheap?',
 E'You are being evaluated with heavy emphasis on SPEED and COST EFFICIENCY.\n\nAgent context: {{agent_context}}\n\n{{difficulty}}\n\nTask:\n{{generated_task}}\n\nIMPORTANT: Quality must meet a reasonable bar, but you are primarily being judged on how quickly and cost-efficiently you complete this task. Concise, targeted responses are preferred over exhaustive ones.',
 '{"quality_threshold": 0.15, "conciseness": 0.10, "speed_weight": 0.30, "cost_efficiency_weight": 0.30, "schema_compliance_weight": 0.15}',
 '{"1": "Simple task where a quick answer is clearly sufficient", "2": "Task where over-engineering is tempting but unnecessary", "3": "Task with both a fast-but-shallow path and a slow-but-thorough path — agent must choose wisely", "4": "Complex task that rewards knowing exactly what to skip without sacrificing correctness"}',
 5);
