# Instant Review Threads Plan

## Goal

Support immediate AI responses for non-edit review feedback. Edit-oriented comments should continue to use the existing draft comment and batch submission workflow. Question or debate-oriented feedback should become an inline thread that notifies the agent immediately, without requiring the user to click `Submit Comments`.

## Product Boundary

There are two separate review flows:

- Edit feedback: user wants the document changed.
- Discussion feedback: user wants explanation, debate, or clarification.

Edit feedback remains batch-based. Discussion feedback is immediate and thread-based.

## Data Model

Add `threads` to each session:

```js
threads: [
  {
    id,
    versionId,
    quote,
    context: {
      prefix,
      suffix
    },
    position: {
      startOffset,
      endOffset
    },
    intent: 'question' | 'challenge',
    status: 'open' | 'resolved',
    messages: [
      {
        id,
        role: 'user' | 'agent',
        content,
        createdAt
      }
    ],
    createdAt,
    updatedAt
  }
]
```

Keep existing `comments` for edit feedback. Do not migrate all comments into threads in the first implementation.

When loading persisted sessions, initialize missing `threads` to `[]` for backward compatibility.

## UI Changes

When the user selects text, the popover should let them choose the feedback intent:

- `要求修改`
- `提问`
- `讨论`

Behavior:

- `要求修改`: create a draft comment in the existing comments list. The user later clicks `提交评论`.
- `提问` or `讨论`: create a thread immediately and notify the agent immediately. The user does not need to click `提交评论`.

The right panel should display both:

- edit comments
- discussion threads

Thread cards should show user and agent messages and allow the user to continue the thread with a follow-up message.

## HTTP API

Add:

```http
POST /api/sessions/:sessionId/threads
```

Request:

```json
{
  "intent": "question",
  "quote": "selected text",
  "message": "这里为什么这么设计？",
  "prefix": "text before",
  "suffix": "text after",
  "startOffset": 128,
  "endOffset": 141
}
```

Server behavior:

- create a thread
- add the first user message
- persist the session
- wake `wait_for_review` via `dispatchAgentEvent`
- notify browser clients via SSE

Add:

```http
POST /api/sessions/:sessionId/threads/:threadId/messages
```

Request:

```json
{
  "content": "但 B 的扩展性不是更好吗？"
}
```

Server behavior:

- append a user message to the thread
- persist the session
- wake `wait_for_review` with a new discussion event
- notify browser clients via SSE

Do not include `recentMessages` in the event payload. The server persists full thread history, and the agent can call `get_review_session` if it needs more context.

## MCP Event

Extend `wait_for_review` to return a new status:

```json
{
  "status": "discussion_requested",
  "sessionId": "session_abc123",
  "versionId": "v1",
  "threadId": "thread_abc123",
  "intent": "question",
  "quote": "selected text",
  "message": "这里为什么这么设计？",
  "context": {
    "prefix": "text before",
    "suffix": "text after"
  },
  "position": {
    "startOffset": 128,
    "endOffset": 141
  },
  "instruction": "Reply to this review thread. Use existing conversation context if available. If needed, call get_review_session to inspect the persisted thread. Do not update the document unless the user explicitly asks for a change."
}
```

Follow-up messages should return the same event shape. The `message` field is only the newest user message.

## Agent Reply Tool

Add an MCP tool:

```text
reply_to_review_thread
```

Input:

```json
{
  "sessionId": "session_abc123",
  "threadId": "thread_abc123",
  "message": "这里选择 A 的原因是..."
}
```

Server behavior:

- append an agent message to the thread
- persist the session
- notify browser clients via SSE
- do not create a new document version
- do not set the session to `waiting_for_agent`

## State Flow

Edit feedback:

```text
draft comment -> submit-comments -> comments_submitted -> update_review_document -> reviewing
```

Discussion feedback:

```text
create thread / user follow-up -> discussion_requested -> reply_to_review_thread -> thread updated
```

Both flows can exist at the same time. The user can discuss one section while continuing to accumulate edit comments elsewhere.

## Tool Description Updates

Update MCP tool descriptions so the agent understands the new protocol:

- `comments_submitted`: only for edit feedback that should usually result in document updates.
- `discussion_requested`: for explanation, challenge, debate, or clarification. The agent should reply to the thread and should not update the document unless the user explicitly asks for a change.
- `reply_to_review_thread`: used to send a discussion reply back to the review UI.
- `get_review_session`: returns threads and messages as persisted session state.

Update `create_review_session` guidance so the agent continues calling `wait_for_review` after both document updates and thread replies.

## Acceptance Criteria

- Selecting text and choosing `提问` notifies the agent through `wait_for_review` without clicking `提交评论`.
- Selecting text and choosing `讨论` behaves the same immediate way.
- The `discussion_requested` event contains only the newest user message plus quote, context, position, session ID, version ID, thread ID, and intent.
- The event does not include `recentMessages`.
- Calling `reply_to_review_thread` appends an agent message and updates the browser UI through SSE.
- User follow-up messages in an existing thread trigger another `discussion_requested` event.
- Existing edit comments still require `提交评论` and still return `comments_submitted`.
- Existing document update flow with `update_review_document` still works.
- Persisted sessions restore `threads` and `messages` from `.bt-7274/sessions`.
- Older persisted sessions without `threads` still load.
- `npm run check` passes.

## Suggested Implementation Order

1. Add `threads` to session creation, session loading, and public session output.
2. Add helper functions for creating thread events and appending thread messages.
3. Add HTTP APIs for creating threads and user follow-up messages.
4. Add `reply_to_review_thread` MCP tool.
5. Extend `wait_for_review` tool description and event handling docs.
6. Update the UI popover to support intent selection.
7. Render thread cards and agent replies in the right panel.
8. Add follow-up input for open threads.
9. Update README and Chinese docs.
10. Run `npm run check` and manually smoke test both flows.
