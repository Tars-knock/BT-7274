# BT-7274

BT-7274 is a local MCP server for reviewing AI-generated Markdown and HTML
documents in a browser before accepting them back into an agent workflow.

The name is inspired by BT-7274 from Titanfall: the project is designed to help
users and agents collaborate as closely as a Pilot and BT.

BT-7274 creates a browser-based review page where a developer can preview a
document, navigate it with a heading tree, select text, leave multiple comments,
submit comments as a batch, or approve the current version. The agent can wait
for the review result, revise the document, and publish a new version into the
same review session.

[简体中文说明](./docs/README.zh-CN.md)

## Features

- Markdown and HTML document review sessions
- Browser preview with a left-side heading tree
- Text selection comments with quote and surrounding context
- Batch comment submission through a single `提交评论` action
- Explicit approval through `评审通过`
- Warning confirmation when approving with unresolved comments
- Version history and diff against the previous version
- Agent wait flow through MCP tools
- Local-only in-memory storage for the MVP
- Sandboxed HTML preview with scripts removed by default

## Requirements

- Node.js 20 or newer
- An MCP client that can launch a stdio MCP server

No npm dependencies are required for the current MVP.

## Quick Start

```bash
npx -y bt-7274
```

The HTTP review UI listens on:

```text
http://127.0.0.1:8787
```

You can override the default host, port, and externally visible base URL:

```bash
REVIEW_MCP_HOST=127.0.0.1 \
REVIEW_MCP_PORT=8787 \
REVIEW_MCP_BASE_URL=http://127.0.0.1:8787 \
npx -y bt-7274
```

For local development from a cloned repository:

```bash
npm start
```

## MCP Client Configuration

Preferred configuration after the package is published to npm:

```json
{
  "mcpServers": {
    "bt-7274": {
      "command": "npx",
      "args": ["-y", "bt-7274"]
    }
  }
}
```

### opencode

opencode defines MCP servers under the `mcp` field in `opencode.jsonc`.
For BT-7274, add a local MCP server entry:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "bt-7274": {
      "type": "local",
      "command": ["npx", "-y", "bt-7274"],
      "enabled": true
    }
  }
}
```

During local development from a cloned repository:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "bt-7274": {
      "type": "local",
      "command": ["node", "/home/tars/projects/BT-7274/src/server.js"],
      "enabled": true
    }
  }
}
```

Reference: [opencode MCP servers documentation](https://opencode.ai/docs/mcp-servers).

Development configuration from a cloned repository:

```json
{
  "mcpServers": {
    "bt-7274": {
      "command": "node",
      "args": ["/home/tars/projects/BT-7274/src/server.js"]
    }
  }
}
```

## Review Flow

1. The agent calls `create_review_session` with a Markdown or HTML document.
2. BT-7274 returns a `reviewUrl` and an instruction string.
3. The agent shows the URL to the user and immediately calls `wait_for_review`.
4. The user opens the review page in a browser.
5. The user either:
   - selects text, creates comments, and clicks `提交评论`; or
   - clicks `评审通过` to approve the current version.
6. `wait_for_review` returns either `comments_submitted` or `approved`.
7. If comments were submitted, the agent revises the document and calls
   `update_review_document`.
8. The agent calls `wait_for_review` again for the next review round.
9. The browser page updates to the latest version and keeps the previous version
   available in the diff/history views.

## MCP Tools

### `create_review_session`

Creates a browser review session.

Input:

```json
{
  "title": "Implementation Plan",
  "format": "markdown",
  "content": "# Plan\n\n..."
}
```

Output:

```json
{
  "sessionId": "session_abc123",
  "reviewUrl": "http://127.0.0.1:8787/review/session_abc123",
  "instruction": "请打开评审页面完成审阅：http://127.0.0.1:8787/review/session_abc123。完成后点击“提交评论”或“评审通过”。"
}
```

### `wait_for_review`

Waits for submitted comments or approval.

If the call times out, the review session remains open. The agent should call
`wait_for_review` again with the same `sessionId` unless the user canceled the
review. Submitted comments and approvals are persisted locally, so they can be
picked up by a later `wait_for_review` call even after the MCP process restarts.

Input:

```json
{
  "sessionId": "session_abc123",
  "timeoutSeconds": 3600
}
```

Comment submission output:

```json
{
  "status": "comments_submitted",
  "sessionId": "session_abc123",
  "versionId": "v1",
  "batchId": "batch_abc123",
  "comments": [
    {
      "id": "comment_abc123",
      "quote": "selected text",
      "comment": "Please clarify this part.",
      "context": {
        "prefix": "text before",
        "suffix": "text after"
      },
      "position": {
        "startOffset": 128,
        "endOffset": 141
      }
    }
  ],
  "generalComment": "Overall feedback"
}
```

`position.startOffset` and `position.endOffset` are 0-based UTF-16 offsets into
the rendered preview plain text for the reviewed version. `startOffset` is
inclusive and `endOffset` is exclusive. These offsets are intended as anchors for
finding the selected text together with `quote`, `prefix`, and `suffix`; they are
not byte offsets and are not guaranteed to match Markdown or HTML source offsets.

Approval output:

```json
{
  "status": "approved",
  "sessionId": "session_abc123",
  "title": "Review document",
  "format": "markdown",
  "versionId": "v2",
  "content": "# Approved content\n\n...",
  "approvedAt": "2026-05-30T08:00:00.000Z",
  "unresolvedCommentCount": 0,
  "instruction": "The user approved this version. Use this approved content as the final version for the current task."
}
```

Timeout output:

```json
{
  "status": "timeout",
  "sessionId": "session_abc123",
  "instruction": "Review is still open. Call wait_for_review again with sessionId=\"session_abc123\" unless the user canceled the review."
}
```

### `update_review_document`

Publishes a revised document version into an existing review session.

Input:

```json
{
  "sessionId": "session_abc123",
  "content": "# Revised Plan\n\n...",
  "summary": "Addressed review comments"
}
```

Output:

```json
{
  "sessionId": "session_abc123",
  "versionId": "v2",
  "reviewUrl": "http://127.0.0.1:8787/review/session_abc123"
}
```

### `get_review_session`

Returns the current session state, including versions, comments, batches, and
approval status.

Input:

```json
{
  "sessionId": "session_abc123"
}
```

## Comment Statuses

- `draft`: created in the browser but not submitted to the agent
- `submitted`: submitted to the agent in a batch
- `addressed`: a new document version was published after the comment
- `resolved`: reviewer confirmed the comment is resolved
- `stale`: the original quoted text can no longer be found in the new version

Unresolved statuses are `draft`, `submitted`, `addressed`, and `stale`. If the
reviewer clicks `评审通过` while unresolved comments exist, the page shows a
confirmation warning before approving.

## Security Notes

- The server is intended for local development use.
- Session data is kept in memory and is lost when the process exits.
- Markdown is rendered by the built-in lightweight renderer.
- HTML is sanitized and displayed in a sandboxed iframe.
- Generated HTML scripts are removed by default.

## Development

Syntax checks:

```bash
npm run check
node --check public/app.js
```

Project layout:

```text
src/server.js       MCP stdio server and HTTP API
public/index.html   Review page shell
public/app.js       Browser-side review behavior
public/styles.css   Review page styles
docs/README.zh-CN.md Chinese documentation
```

## Markdown Rendering

Markdown preview is rendered with `markdown-it`, not a handwritten parser.
Common Markdown features such as tables, horizontal rules, code blocks, lists,
links, and inline formatting are supported. Raw HTML inside Markdown is disabled.
