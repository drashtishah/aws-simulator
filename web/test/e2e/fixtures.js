/**
 * Shared fixtures for Playwright E2E tests.
 * Page objects and mock API route helpers.
 */

/**
 * Mock the game SSE endpoints so tests don't need a real Claude CLI.
 * Call this in beforeEach to intercept /api/game/* routes.
 */
async function mockGameRoutes(page, options = {}) {
  const sessionId = options.sessionId || 'mock-session-123';
  const narratorText = options.narratorText || 'Welcome, investigator. A critical incident has been reported.';
  const consoleText = options.consoleText || '{"metric": "CPUUtilization", "value": 99.2}';
  const coachingText = options.coachingText || 'Good investigation approach.';

  // Mock /api/game/start
  await page.route('**/api/game/start', async (route) => {
    const sseLines = [
      `data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`,
      `data: ${JSON.stringify({ type: 'text', content: narratorText })}\n\n`,
      `data: ${JSON.stringify({ type: 'console', content: consoleText })}\n\n`,
      `data: ${JSON.stringify({ type: 'done' })}\n\n`,
    ];
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseLines.join(''),
    });
  });

  // Mock /api/game/message
  await page.route('**/api/game/message', async (route) => {
    const body = route.request().postDataJSON();
    const responseText = options.responseText || 'The CloudWatch metrics show elevated CPU usage across the cluster.';
    const sseLines = [
      `data: ${JSON.stringify({ type: 'text', content: responseText })}\n\n`,
      `data: ${JSON.stringify({ type: 'done' })}\n\n`,
    ];
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseLines.join(''),
    });
  });

  // Mock /api/game/quit
  await page.route('**/api/game/quit', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    });
  });

  // Mock /api/game/resume
  await page.route('**/api/game/resume', async (route) => {
    const sseLines = [
      `data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`,
      `data: ${JSON.stringify({ type: 'text', content: 'Resuming your investigation.' })}\n\n`,
      `data: ${JSON.stringify({ type: 'done' })}\n\n`,
    ];
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseLines.join(''),
    });
  });

  return { sessionId };
}

/**
 * Mock game start with a complete session (includes SESSION_COMPLETE).
 */
async function mockGameComplete(page, options = {}) {
  const sessionId = options.sessionId || 'mock-complete-123';

  await page.route('**/api/game/start', async (route) => {
    const sseLines = [
      `data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`,
      `data: ${JSON.stringify({ type: 'text', content: 'Investigation complete.' })}\n\n`,
      `data: ${JSON.stringify({ type: 'coaching', content: 'Great work on this incident.' })}\n\n`,
      `data: ${JSON.stringify({ type: 'complete' })}\n\n`,
      `data: ${JSON.stringify({ type: 'done' })}\n\n`,
    ];
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseLines.join(''),
    });
  });

  return { sessionId };
}

module.exports = { mockGameRoutes, mockGameComplete };
