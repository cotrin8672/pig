// pig no longer overrides Pi's profile variables, so a test run launched from a
// Pi/pig harness would otherwise point fixtures (and their child processes) at
// the user's real agent directory.
delete process.env.PI_CODING_AGENT_DIR;
delete process.env.PI_CODING_AGENT_SESSION_DIR;
