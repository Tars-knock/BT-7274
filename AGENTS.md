# Repository Guidelines

## Project Structure & Module Organization

This is a small Node.js 20 ESM project for a local MCP review server. The main server and MCP tool implementation live in `src/server.js`. Browser assets are static and live in `public/`: `index.html`, `app.js`, and `styles.css`. User-facing documentation is in `README.md`, with Chinese documentation in `docs/README.zh-CN.md`. Runtime review session data is written under `.bt-7274/sessions`; treat it as local state, not source.

## Build, Test, and Development Commands

- `npm install`: install the single runtime dependency and lockfile-defined packages.
- `npm start`: run the local MCP/web server from `src/server.js`.
- `npm run check`: run Node's syntax checker against `src/server.js`.
- `node src/server.js`: equivalent local entry point, useful when testing MCP client config.

The review UI defaults to `http://127.0.0.1:8787`. Override with `REVIEW_MCP_HOST`, `REVIEW_MCP_PORT`, or `REVIEW_MCP_BASE_URL` when needed.

## Coding Style & Naming Conventions

Use modern JavaScript modules with explicit imports from `node:` built-ins. Match the existing style: two-space indentation, semicolons, single quotes, `const` by default, and `let` only for reassigned state. Use camelCase for variables and functions, and keep helper functions small and close to their call sites. Prefer structured APIs such as `URL`, `path`, and JSON parsing/stringifying over manual string manipulation.

## Testing Guidelines

There is no dedicated automated test suite yet. For every change, run `npm run check` at minimum. For behavior changes, manually smoke test the MCP flow: start the server, create or update a review session, open the returned review URL, submit comments, and approve a document. If adding tests later, place them in a clearly named `test/` or `tests/` directory and use `*.test.js` naming.

## Commit & Pull Request Guidelines

Recent commits use concise imperative subjects, such as `Add contentPath support for review documents` and `Clarify content input field descriptions`. Follow that style: start with a verb, keep the subject specific, and avoid broad wording like "updates". Pull requests should include a short description, the user-visible behavior changed, manual test steps or command output, linked issues when applicable, and screenshots or short recordings for UI changes.

## Security & Configuration Tips

Keep the service local-first. Avoid broadening defaults beyond `127.0.0.1` without documenting the risk. Do not commit generated session files, local environment overrides, or sensitive review content.
