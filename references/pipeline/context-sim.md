## Sim content change

This issue is labeled sim-content. Additional requirements:

For the Planner and Critic:
- Use aws-knowledge-mcp-server tools to verify AWS-specific claims:
  `aws___search_documentation()` for API schemas, error codes, metric names.
  `aws___retrieve_agent_sop()` for remediation procedures (two-step: search first,
  then retrieve with exact sop_name).
- Artifact accuracy: JSON field names must match real AWS API responses, error codes
  must use exact AWS strings, CloudWatch metric names must be from published lists.

For the Verifier:
- Read changed sim files and validate against
  `.claude/skills/create-sim/assets/manifest-schema.json`.
- Cross-check artifact content against the plan's AWS-specific values.
