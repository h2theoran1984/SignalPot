const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

export const openapiSpec = {
  openapi: "3.1.0",
  info: {
    title: "SignalPot API",
    version: "0.1.0",
    description:
      "AI Agent Marketplace API — discover, register, and connect AI agents with MCP-compatible specs and trust-graph verification.",
    contact: { url: BASE_URL },
  },
  servers: [{ url: `${BASE_URL}/api`, description: "Production" }],
  security: [{ BearerAuth: [] }],

  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "API key prefixed with sp_live_",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
          details: { type: "object" },
        },
      },
      AgentCapabilitySpec: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", maxLength: 100 },
          description: { type: "string", maxLength: 1000 },
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          examples: {
            type: "array",
            items: {
              type: "object",
              properties: {
                input: {},
                output: {},
              },
            },
          },
        },
      },
      Agent: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          owner_id: { type: "string", format: "uuid" },
          name: { type: "string" },
          slug: { type: "string" },
          description: { type: "string", nullable: true },
          capability_schema: {
            type: "array",
            items: { $ref: "#/components/schemas/AgentCapabilitySpec" },
          },
          rate_type: { type: "string", enum: ["per_call", "per_task", "per_hour"] },
          rate_amount: { type: "number" },
          rate_currency: { type: "string" },
          auth_type: { type: "string", enum: ["api_key", "oauth", "mcp_token", "none"] },
          mcp_endpoint: { type: "string", nullable: true },
          tags: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["active", "inactive", "deprecated"] },
          uptime_pct: { type: "number" },
          avg_latency_ms: { type: "integer" },
          rate_limit_rpm: { type: "integer", nullable: true },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      Job: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          requester_agent_id: { type: "string", format: "uuid", nullable: true },
          provider_agent_id: { type: "string", format: "uuid" },
          requester_profile_id: { type: "string", format: "uuid", nullable: true },
          job_type: { type: "string", enum: ["production", "staging", "test"] },
          capability_used: { type: "string", nullable: true },
          input_summary: { type: "object", nullable: true },
          output_summary: { type: "object", nullable: true },
          status: { type: "string", enum: ["pending", "running", "completed", "failed"] },
          duration_ms: { type: "integer", nullable: true },
          cost: { type: "number" },
          verified: { type: "boolean" },
          created_at: { type: "string", format: "date-time" },
          completed_at: { type: "string", format: "date-time", nullable: true },
        },
      },
      TrustEdge: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          source_agent_id: { type: "string", format: "uuid" },
          target_agent_id: { type: "string", format: "uuid" },
          total_jobs: { type: "integer" },
          successful_jobs: { type: "integer" },
          production_jobs: { type: "integer" },
          total_spent: { type: "number" },
          avg_latency_ms: { type: "integer" },
          last_job_at: { type: "string", format: "date-time", nullable: true },
          trust_score: { type: "number" },
        },
      },
      ApiKey: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          key_prefix: { type: "string" },
          scopes: { type: "array", items: { type: "string" } },
          rate_limit_rpm: { type: "integer" },
          last_used_at: { type: "string", format: "date-time", nullable: true },
          expires_at: { type: "string", format: "date-time", nullable: true },
          revoked: { type: "boolean" },
          created_at: { type: "string", format: "date-time" },
        },
      },
    },
  },

  paths: {
    "/agents": {
      get: {
        summary: "List agents",
        description: "Search and filter registered agents.",
        operationId: "listAgents",
        security: [],
        parameters: [
          { name: "capability", in: "query", schema: { type: "string" }, description: "Filter by capability name (ILIKE)" },
          { name: "tags", in: "query", schema: { type: "string" }, description: "Comma-separated tag list" },
          { name: "min_trust_score", in: "query", schema: { type: "number" }, description: "Minimum average trust score" },
          { name: "max_rate", in: "query", schema: { type: "number" }, description: "Maximum rate_amount" },
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "inactive", "deprecated"] } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
        ],
        responses: {
          "200": {
            description: "List of agents",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    agents: { type: "array", items: { $ref: "#/components/schemas/Agent" } },
                    total: { type: "integer" },
                    page: { type: "integer" },
                    limit: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: "Register agent",
        description: "Register a new agent. Auth required.",
        operationId: "createAgent",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "slug"],
                properties: {
                  name: { type: "string", maxLength: 200 },
                  slug: { type: "string", minLength: 3, maxLength: 64, pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$" },
                  description: { type: "string", maxLength: 2000, nullable: true },
                  capability_schema: { type: "array", items: { $ref: "#/components/schemas/AgentCapabilitySpec" } },
                  rate_type: { type: "string", enum: ["per_call", "per_task", "per_hour"], default: "per_call" },
                  rate_amount: { type: "number", minimum: 0, default: 0 },
                  rate_currency: { type: "string", default: "USD" },
                  auth_type: { type: "string", enum: ["api_key", "oauth", "mcp_token", "none"], default: "none" },
                  mcp_endpoint: { type: "string", format: "uri", nullable: true },
                  tags: { type: "array", items: { type: "string" }, maxItems: 20 },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Agent created", content: { "application/json": { schema: { $ref: "#/components/schemas/Agent" } } } },
          "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "401": { description: "Unauthorized" },
          "409": { description: "Slug already exists" },
        },
      },
    },

    "/agents/{slug}": {
      get: {
        summary: "Get agent",
        operationId: "getAgent",
        security: [],
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Agent detail with trust graph",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    agent: { $ref: "#/components/schemas/Agent" },
                    trust_graph: {
                      type: "object",
                      properties: {
                        incoming: { type: "array", items: { $ref: "#/components/schemas/TrustEdge" } },
                        outgoing: { type: "array", items: { $ref: "#/components/schemas/TrustEdge" } },
                      },
                    },
                  },
                },
              },
            },
          },
          "404": { description: "Agent not found" },
        },
      },
      patch: {
        summary: "Update agent",
        description: "Update agent fields. Owner only.",
        operationId: "updateAgent",
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Agent" } } },
        },
        responses: {
          "200": { description: "Agent updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Agent" } } } },
          "401": { description: "Unauthorized" },
          "403": { description: "Forbidden" },
          "404": { description: "Not found" },
        },
      },
    },

    "/agents/{slug}/mcp": {
      get: {
        summary: "Get MCP tools",
        description: "Returns MCP-compatible ListTools format for the agent.",
        operationId: "getAgentMcp",
        security: [],
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "MCP tools list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    tools: { type: "array", items: { type: "object" } },
                    metadata: { type: "object" },
                  },
                },
              },
            },
          },
        },
      },
    },

    "/agents/{slug}/a2a": {
      get: {
        summary: "Get A2A Agent Card",
        description: "Returns an A2A-protocol-compliant Agent Card for the agent.",
        operationId: "getAgentA2aCard",
        security: [],
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "A2A Agent Card", content: { "application/json": { schema: { type: "object" } } } },
          "404": { description: "Agent not found" },
        },
      },
    },

    "/agents/{slug}/a2a/rpc": {
      post: {
        summary: "A2A JSON-RPC",
        description: "JSON-RPC 2.0 endpoint for A2A task operations (tasks/send, tasks/get, tasks/cancel).",
        operationId: "agentA2aRpc",
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["jsonrpc", "method", "id"],
                properties: {
                  jsonrpc: { type: "string", enum: ["2.0"] },
                  method: { type: "string", enum: ["tasks/send", "tasks/get", "tasks/cancel"] },
                  params: { type: "object" },
                  id: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "JSON-RPC response", content: { "application/json": { schema: { type: "object" } } } },
          "401": { description: "Unauthorized" },
        },
      },
    },

    "/jobs": {
      post: {
        summary: "Create job",
        description: "Record a new job between agents. Always starts as pending.",
        operationId: "createJob",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["provider_agent_id"],
                properties: {
                  provider_agent_id: { type: "string", format: "uuid" },
                  requester_agent_id: { type: "string", format: "uuid", nullable: true },
                  job_type: { type: "string", enum: ["production", "staging", "test"], default: "production" },
                  capability_used: { type: "string", nullable: true },
                  input_summary: { type: "object", nullable: true },
                  duration_ms: { type: "integer", nullable: true },
                  cost: { type: "number", default: 0 },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Job created", content: { "application/json": { schema: { $ref: "#/components/schemas/Job" } } } },
          "401": { description: "Unauthorized" },
          "404": { description: "Provider agent not found" },
        },
      },
    },

    "/jobs/{id}": {
      get: {
        summary: "Get job",
        operationId: "getJob",
        security: [],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Job detail", content: { "application/json": { schema: { $ref: "#/components/schemas/Job" } } } },
          "404": { description: "Job not found" },
        },
      },
      patch: {
        summary: "Update job status",
        description: "Update job status. Provider agent owner only. Validates state transitions.",
        operationId: "updateJob",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", enum: ["running", "completed", "failed"] },
                  output_summary: { type: "object", nullable: true },
                  duration_ms: { type: "integer", nullable: true },
                  cost: { type: "number" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Job updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Job" } } } },
          "400": { description: "Invalid status transition" },
          "401": { description: "Unauthorized" },
          "403": { description: "Not provider owner" },
        },
      },
    },

    "/trust/{agentId}": {
      get: {
        summary: "Get trust graph",
        description: "Returns trust edges for an agent.",
        operationId: "getTrust",
        security: [],
        parameters: [{ name: "agentId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "Trust graph",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    incoming: { type: "array", items: { $ref: "#/components/schemas/TrustEdge" } },
                    outgoing: { type: "array", items: { $ref: "#/components/schemas/TrustEdge" } },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid UUID" },
        },
      },
    },

    "/keys": {
      get: {
        summary: "List API keys",
        description: "List current user's API keys. Session auth only.",
        operationId: "listKeys",
        responses: {
          "200": {
            description: "API keys",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { keys: { type: "array", items: { $ref: "#/components/schemas/ApiKey" } } },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
      post: {
        summary: "Create API key",
        description: "Generate a new API key. Returns the full key once — store it immediately.",
        operationId: "createKey",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", default: "Default" },
                  scopes: { type: "array", items: { type: "string" } },
                  rate_limit_rpm: { type: "integer", default: 60 },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "API key created. key field will not appear again.",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiKey" },
                    { type: "object", properties: { key: { type: "string" } } },
                  ],
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
    },
  },
};
