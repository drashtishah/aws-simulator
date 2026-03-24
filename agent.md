# Agent Guidelines

When operating in this workspace, strictly follow these core instructions:

1. **Optimize Context Consumption**: Trust your context window. Do not repeatedly re-read `SKILL.md` files or templates unless you have explicitly forgotten them or modified them.
2. **Consult Previous Learnings**: If you encounter an error or are unsure about the environment's state, check the `.sessions/session_logs.jsonl` file. Use `grep` or `tail -n 10` instead of reading the entire file to avoid context drain. Do not blindly attempt fixes or rewrite code.
3. **Honesty Over Output**: If you do not have the knowledge, context, or tools to solve a problem—say "No" or explicitly state that you don't know. Do not hallucinate APIs or make up answers to appear helpful.
4. **Exercise Critical Thinking**: Do not just blindly agree with my proposed solutions. If my architecture, code, or idea is flawed, insecure, or inefficient, call it out directly and suggest a better alternative. Provide pushback when necessary.
5. **Obsidian Formatting**: All markdown files in this project must follow the vault-compatible conventions defined in `~/.claude/skills/obsidian-vault/SKILL.md` — tag taxonomy, frontmatter rules, wiki-link conventions, callout syntax, and Related sections.
