#!/usr/bin/env node
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import MarkdownIt from 'markdown-it';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = normalize(join(__dirname, '..'));
const publicDir = join(rootDir, 'public');
const port = Number(process.env.PORT || process.env.REVIEW_MCP_PORT || 8787);
const host = process.env.REVIEW_MCP_HOST || '127.0.0.1';
const baseUrl = process.env.REVIEW_MCP_BASE_URL || `http://${host}:${port}`;
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false
});

const sessions = new Map();
const waiters = new Map();
const sseClients = new Map();

process.on('uncaughtException', (error) => {
  console.error('Uncaught server error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled server rejection:', error);
});

function now() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function normalizeFormat(format) {
  if (format === 'md') return 'markdown';
  return format;
}

function normalizeContent(content, format) {
  const value = String(content || '');
  if (format !== 'markdown') return value;
  const match = value.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1] : value;
}

function publicVersion(session, version) {
  return {
    ...version,
    renderedHtml: session.format === 'markdown' ? markdown.render(version.content) : null
  };
}

function createSession({ title = 'Review document', format, content }) {
  const normalizedFormat = normalizeFormat(format);
  if (!['markdown', 'html'].includes(normalizedFormat)) {
    throw new Error('format must be "markdown", "md", or "html"');
  }

  const sessionId = newId('session');
  const versionId = 'v1';
  const createdAt = now();
  const session = {
    id: sessionId,
    title,
    format: normalizedFormat,
    status: 'reviewing',
    createdAt,
    updatedAt: createdAt,
    currentVersionId: versionId,
    versions: [
      {
        id: versionId,
        number: 1,
        content: normalizeContent(content, normalizedFormat),
        summary: 'Initial version',
        createdAt
      }
    ],
    comments: [],
    batches: [],
    pendingAgentEvents: [],
    approval: null
  };
  sessions.set(sessionId, session);
  return session;
}

function publicSession(session) {
  return {
    id: session.id,
    title: session.title,
    format: session.format,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    currentVersionId: session.currentVersionId,
    versions: session.versions.map((version) => publicVersion(session, version)),
    comments: session.comments,
    batches: session.batches,
    approval: session.approval
  };
}

function currentVersion(session) {
  return session.versions.find((version) => version.id === session.currentVersionId);
}

function unresolvedComments(session) {
  return session.comments.filter((comment) =>
    ['draft', 'submitted', 'addressed', 'stale'].includes(comment.status)
  );
}

function notify(sessionId, type, payload = {}) {
  const clients = sseClients.get(sessionId) || new Set();
  const data = JSON.stringify({ type, ...payload });
  for (const res of clients) {
    try {
      if (res.destroyed || res.writableEnded) {
        clients.delete(res);
        continue;
      }
      res.write(`event: ${type}\n`);
      res.write(`data: ${data}\n\n`);
    } catch {
      clients.delete(res);
    }
  }
}

function finishWaiters(sessionId, result) {
  const pending = waiters.get(sessionId) || [];
  waiters.delete(sessionId);
  for (const waiter of pending) {
    clearTimeout(waiter.timer);
    waiter.resolve(result);
  }
}

function dispatchAgentEvent(session, result) {
  const pending = waiters.get(session.id) || [];
  if (pending.length === 0) {
    session.pendingAgentEvents.push(result);
    return;
  }
  finishWaiters(session.id, result);
}

function submitComments(session, generalComment = '') {
  const draftComments = session.comments.filter((comment) => comment.status === 'draft');
  if (draftComments.length === 0 && !generalComment.trim()) {
    throw new Error('No draft comments or general comment to submit');
  }

  const submittedAt = now();
  const batchId = newId('batch');
  for (const comment of draftComments) {
    comment.status = 'submitted';
    comment.submittedAt = submittedAt;
    comment.batchId = batchId;
  }

  const batch = {
    id: batchId,
    versionId: session.currentVersionId,
    status: 'submitted',
    generalComment,
    commentIds: draftComments.map((comment) => comment.id),
    submittedAt
  };
  session.batches.push(batch);
  session.updatedAt = submittedAt;

  const result = {
    status: 'comments_submitted',
    sessionId: session.id,
    versionId: session.currentVersionId,
    batchId,
    comments: draftComments.map((comment) => ({
      id: comment.id,
      quote: comment.quote,
      comment: comment.comment,
      context: {
        prefix: comment.prefix,
        suffix: comment.suffix
      },
      position: {
        startOffset: comment.startOffset ?? null,
        endOffset: comment.endOffset ?? null
      }
    })),
    generalComment
  };
  dispatchAgentEvent(session, result);
  notify(session.id, 'comments_submitted', { session: publicSession(session) });
  return result;
}

function approveSession(session, force = false) {
  const unresolved = unresolvedComments(session);
  if (unresolved.length > 0 && !force) {
    const error = new Error('Unresolved comments require force approval');
    error.code = 409;
    error.unresolvedCommentCount = unresolved.length;
    throw error;
  }

  const approvedAt = now();
  const approval = {
    versionId: session.currentVersionId,
    approvedAt,
    unresolvedCommentCount: unresolved.length
  };
  session.status = 'approved';
  session.approval = approval;
  session.updatedAt = approvedAt;

  const result = {
    status: 'approved',
    sessionId: session.id,
    versionId: session.currentVersionId,
    approvedAt,
    unresolvedCommentCount: unresolved.length
  };
  dispatchAgentEvent(session, result);
  notify(session.id, 'approved', { session: publicSession(session) });
  return result;
}

function addVersion(session, content, summary = '') {
  const createdAt = now();
  const versionNumber = session.versions.length + 1;
  const version = {
    id: `v${versionNumber}`,
    number: versionNumber,
    content: normalizeContent(content, session.format),
    summary,
    createdAt
  };
  const oldVersionId = session.currentVersionId;
  session.versions.push(version);
  session.currentVersionId = version.id;
  session.status = 'reviewing';
  session.approval = null;
  session.updatedAt = createdAt;

  for (const comment of session.comments) {
    if (comment.versionId === oldVersionId && comment.status === 'submitted') {
      comment.status = version.content.includes(comment.quote) ? 'addressed' : 'stale';
      comment.addressedByVersionId = version.id;
    }
  }

  notify(session.id, 'version_updated', { session: publicSession(session) });
  return version;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function notifySoon(sessionId, type, payload = {}) {
  setImmediate(() => notify(sessionId, type, payload));
}

function sendError(res, error) {
  sendJson(res, error.code || 400, {
    error: error.message,
    unresolvedCommentCount: error.unresolvedCommentCount
  });
}

function getSessionOrThrow(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    const error = new Error('Review session not found');
    error.code = 404;
    throw error;
  }
  return session;
}

function mimeType(pathname) {
  const ext = extname(pathname);
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8'
  }[ext] || 'application/octet-stream';
}

async function serveStatic(res, pathname) {
  const safePath = normalize(pathname === '/' ? '/index.html' : pathname);
  if (safePath.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const filePath = join(publicDir, safePath);
  const content = await readFile(filePath);
  res.writeHead(200, {
    'content-type': mimeType(filePath),
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self' about:; connect-src 'self'"
  });
  res.end(content);
}

const httpServer = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, baseUrl);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname.startsWith('/review/')) {
      await serveStatic(res, '/index.html');
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/events/')) {
      const sessionId = pathname.split('/')[2];
      getSessionOrThrow(sessionId);
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive'
      });
      res.write('\n');
      const clients = sseClients.get(sessionId) || new Set();
      clients.add(res);
      sseClients.set(sessionId, clients);
      res.on('error', () => {
        clients.delete(res);
      });
      req.on('close', () => {
        clients.delete(res);
      });
      return;
    }

    const apiMatch = pathname.match(/^\/api\/sessions\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?$/);
    if (apiMatch) {
      const [, sessionId, resource, resourceId] = apiMatch;
      const session = getSessionOrThrow(sessionId);

      if (req.method === 'GET' && !resource) {
        sendJson(res, 200, publicSession(session));
        return;
      }

      if (req.method === 'POST' && resource === 'comments') {
        const body = await readJson(req);
        const createdAt = now();
        const comment = {
          id: newId('comment'),
          versionId: session.currentVersionId,
          quote: String(body.quote || ''),
          prefix: String(body.prefix || ''),
          suffix: String(body.suffix || ''),
          comment: String(body.comment || ''),
          startOffset: Number.isFinite(Number(body.startOffset)) ? Number(body.startOffset) : null,
          endOffset: Number.isFinite(Number(body.endOffset)) ? Number(body.endOffset) : null,
          status: 'draft',
          createdAt
        };
        session.comments.push(comment);
        session.updatedAt = createdAt;
        sendJson(res, 201, comment);
        notifySoon(session.id, 'comment_changed', { session: publicSession(session) });
        return;
      }

      if (req.method === 'PATCH' && resource === 'comments' && resourceId) {
        const body = await readJson(req);
        const comment = session.comments.find((item) => item.id === resourceId);
        if (!comment) throw Object.assign(new Error('Comment not found'), { code: 404 });
        if (body.status === 'resolved') {
          if (!['submitted', 'addressed', 'stale'].includes(comment.status)) {
            throw new Error('Only submitted, addressed, or stale comments can be resolved');
          }
          comment.status = 'resolved';
          comment.resolvedAt = now();
        } else {
          if (comment.status !== 'draft') throw new Error('Only draft comments can be edited');
          comment.comment = String(body.comment ?? comment.comment);
        }
        session.updatedAt = now();
        sendJson(res, 200, comment);
        notifySoon(session.id, 'comment_changed', { session: publicSession(session) });
        return;
      }

      if (req.method === 'DELETE' && resource === 'comments' && resourceId) {
        const comment = session.comments.find((item) => item.id === resourceId);
        if (!comment) throw Object.assign(new Error('Comment not found'), { code: 404 });
        if (comment.status !== 'draft') throw new Error('Only draft comments can be deleted');
        session.comments = session.comments.filter((item) => item.id !== resourceId);
        session.updatedAt = now();
        sendJson(res, 200, { ok: true });
        notifySoon(session.id, 'comment_changed', { session: publicSession(session) });
        return;
      }

      if (req.method === 'POST' && resource === 'submit-comments') {
        const body = await readJson(req);
        sendJson(res, 200, submitComments(session, String(body.generalComment || '')));
        return;
      }

      if (req.method === 'POST' && resource === 'approve') {
        const body = await readJson(req);
        sendJson(res, 200, approveSession(session, Boolean(body.force)));
        return;
      }
    }

    if (req.method === 'GET') {
      await serveStatic(res, pathname);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (error) {
    sendError(res, error);
  }
});

httpServer.listen(port, host, () => {
  console.error(`Review MCP web server listening at ${baseUrl}`);
});

// Keep the review UI available even if an MCP client closes stdio after creating
// a session. Review pages still need the HTTP API for comments and approval.
setInterval(() => {}, 1 << 30);

function toolResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

async function callTool(name, args = {}) {
  if (name === 'create_review_session') {
    const session = createSession(args);
    const reviewUrl = `${baseUrl}/review/${session.id}`;
    return toolResult({
      sessionId: session.id,
      reviewUrl,
      instruction: `Show this URL to the user and ask them to review it in a browser: ${reviewUrl}. Then call wait_for_review with sessionId="${session.id}" and wait for either comments_submitted or approved. If comments_submitted is returned, revise the document, call update_review_document, and then call wait_for_review again until approved.`
    });
  }

  if (name === 'wait_for_review') {
    const session = getSessionOrThrow(args.sessionId);
    if (session.pendingAgentEvents.length > 0) {
      return toolResult(session.pendingAgentEvents.shift());
    }
    if (session.approval) {
      return toolResult({
        status: 'approved',
        sessionId: session.id,
        versionId: session.approval.versionId,
        approvedAt: session.approval.approvedAt,
        unresolvedCommentCount: session.approval.unresolvedCommentCount
      });
    }
    const timeoutSeconds = Math.max(1, Number(args.timeoutSeconds || 3600));
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        const pending = waiters.get(session.id) || [];
        waiters.set(session.id, pending.filter((item) => item.resolve !== resolve));
        resolve({ status: 'timeout', sessionId: session.id });
      }, timeoutSeconds * 1000);
      const pending = waiters.get(session.id) || [];
      pending.push({ resolve, timer });
      waiters.set(session.id, pending);
    });
    return toolResult(result);
  }

  if (name === 'update_review_document') {
    const session = getSessionOrThrow(args.sessionId);
    const version = addVersion(session, String(args.content || ''), String(args.summary || ''));
    return toolResult({
      sessionId: session.id,
      versionId: version.id,
      reviewUrl: `${baseUrl}/review/${session.id}`
    });
  }

  if (name === 'get_review_session') {
    const session = getSessionOrThrow(args.sessionId);
    return toolResult(publicSession(session));
  }

  throw new Error(`Unknown tool: ${name}`);
}

const tools = [
  {
    name: 'create_review_session',
    description: 'Create a browser-based review session for a Markdown or HTML document.',
    inputSchema: {
      type: 'object',
      required: ['format', 'content'],
      properties: {
        title: { type: 'string' },
          format: { type: 'string', enum: ['markdown', 'md', 'html'] },
        content: { type: 'string' }
      }
    }
  },
  {
    name: 'wait_for_review',
    description: 'Call this immediately after create_review_session. It waits until the human reviewer clicks Submit Comments or Approve in the browser, then returns comments_submitted, approved, or timeout. If comments_submitted is returned, each comment includes quote/context plus position.startOffset and position.endOffset. Offsets are 0-based UTF-16 offsets into the rendered preview plain text for that version; startOffset is inclusive and endOffset is exclusive. They are anchors for locating the reviewed text, not byte offsets and not guaranteed Markdown/HTML source offsets. Revise the document and call update_review_document with the new content, then call wait_for_review again until approved.',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' },
        timeoutSeconds: { type: 'number', default: 3600 }
      }
    }
  },
  {
    name: 'update_review_document',
    description: 'Publish a revised document version after receiving comments_submitted from wait_for_review. The review page updates to the latest version; then call wait_for_review again to wait for more comments or approval.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'content'],
      properties: {
        sessionId: { type: 'string' },
        content: { type: 'string' },
        summary: { type: 'string' }
      }
    }
  },
  {
    name: 'get_review_session',
    description: 'Return the current review session state.',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' }
      }
    }
  }
];

async function handleRpc(message) {
  if (message.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'bt-7274-review-mcp', version: '0.1.0' }
      }
    };
  }

  if (message.method === 'notifications/initialized') return null;

  if (message.method === 'tools/list') {
    return { jsonrpc: '2.0', id: message.id, result: { tools } };
  }

  if (message.method === 'tools/call') {
    const result = await callTool(message.params?.name, message.params?.arguments || {});
    return { jsonrpc: '2.0', id: message.id, result };
  }

  return {
    jsonrpc: '2.0',
    id: message.id,
    error: { code: -32601, message: `Method not found: ${message.method}` }
  };
}

let stdinBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdinBuffer += chunk;
  let newlineIndex = stdinBuffer.indexOf('\n');
  while (newlineIndex >= 0) {
    const line = stdinBuffer.slice(0, newlineIndex).trim();
    stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
    newlineIndex = stdinBuffer.indexOf('\n');
    if (!line) continue;

    Promise.resolve()
      .then(() => handleRpc(JSON.parse(line)))
      .then((response) => {
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      })
      .catch((error) => {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: error.message }
        }) + '\n');
      });
  }
});
