## UI change

This issue is labeled ui. Additional requirements:

For the Implementer:
- Check `web/test/cross-file-consistency.test.ts` for existing drift-prevention
  assertions on CSS classes and selectors before writing code.
- If you add a new CSS class used in `app.ts`, ensure it exists in `style.css`.
- Write or update YAML browser specs in `web/test-specs/browser/` for new UI behavior.
  Run `npm run test:agent --dry-run` to validate the spec parses.

For the Verifier:
- Start the web server: `npm start &`
- Wait: `for i in $(seq 1 30); do curl -s http://localhost:3000 > /dev/null && exit 0; sleep 1; done`
- Run `npm run test:agent` and follow the printed prompts using Chrome DevTools MCP.
  Each spec prints steps with CSS selectors, actions, and checks. Use the MCP tools
  (navigate_page, click, take_screenshot, evaluate_script) to execute each step.
- Kill the server when done: `kill %1`
