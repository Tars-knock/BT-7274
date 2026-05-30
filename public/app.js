const state = {
  sessionId: location.pathname.split('/').filter(Boolean).pop(),
  session: null,
  selected: null,
  view: 'preview'
};

const els = {
  title: document.getElementById('sessionTitle'),
  meta: document.getElementById('versionMeta'),
  document: document.getElementById('document'),
  toc: document.getElementById('toc'),
  comments: document.getElementById('commentList'),
  popover: document.getElementById('commentPopover'),
  selectedQuote: document.getElementById('selectedQuote'),
  commentInput: document.getElementById('commentInput'),
  generalComment: document.getElementById('generalComment'),
  submitComments: document.getElementById('submitComments'),
  approveReview: document.getElementById('approveReview'),
  banner: document.getElementById('statusBanner'),
  diff: document.getElementById('diff'),
  history: document.getElementById('history')
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function slugify(text, index) {
  const slug = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '');
  return slug || `heading-${index}`;
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let inCode = false;
  let paragraph = [];
  let headingIndex = 0;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${escapeHtml(paragraph.join(' ')).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`);
      paragraph = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      flushParagraph();
      if (inCode) {
        html.push('</code></pre>');
      } else {
        html.push('<pre><code>');
      }
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      headingIndex += 1;
      const level = heading[1].length;
      const text = heading[2].trim();
      html.push(`<h${level} id="${slugify(text, headingIndex)}">${escapeHtml(text)}</h${level}>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  if (inCode) html.push('</code></pre>');
  return html.join('\n');
}

function sanitizeHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script, iframe, object, embed, link, meta').forEach((node) => node.remove());
  template.content.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attr) => {
      if (attr.name.startsWith('on')) node.removeAttribute(attr.name);
      if (['src', 'href'].includes(attr.name) && /^javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
    });
  });
  return template.innerHTML;
}

function currentVersion() {
  return state.session.versions.find((version) => version.id === state.session.currentVersionId);
}

function setBanner(message) {
  if (!message) {
    els.banner.classList.add('hidden');
    els.banner.textContent = '';
    return;
  }
  els.banner.textContent = message;
  els.banner.classList.remove('hidden');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.data = data;
    throw error;
  }
  return data;
}

async function loadSession() {
  state.session = await api(`/api/sessions/${state.sessionId}`);
  render();
}

function render() {
  const version = currentVersion();
  els.title.textContent = state.session.title;
  els.meta.textContent = `Version ${version.number} · ${state.session.status} · ${state.session.comments.length} comments`;

  if (state.session.format === 'markdown') {
    els.document.innerHTML = renderMarkdown(version.content);
    els.document.onmouseup = () => handleSelection(document, els.document);
    renderToc(els.document);
  } else {
    renderHtmlFrame(version.content);
  }
  renderComments();
  renderDiff();
  renderHistory();

  if (state.session.status === 'approved') {
    setBanner(`评审已通过 · Version ${version.number}`);
  } else {
    setBanner('');
  }
}

function renderHtmlFrame(content) {
  els.document.onmouseup = null;
  els.document.innerHTML = '<iframe id="htmlFrame" class="html-frame" sandbox="allow-same-origin" title="HTML preview"></iframe>';
  const frame = document.getElementById('htmlFrame');
  const html = sanitizeHtml(content);
  frame.srcdoc = `
    <!doctype html>
    <html>
      <head>
        <base target="_blank">
        <style>
          body { margin: 0; padding: 36px 44px 72px; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; color: #20231f; }
          h1, h2, h3 { line-height: 1.2; margin-top: 1.5em; }
          pre { background: #1f2521; color: #f6f8f5; overflow: auto; padding: 14px; border-radius: 8px; }
          code { background: #eef2ea; padding: 2px 4px; border-radius: 4px; }
          pre code { background: transparent; padding: 0; }
        </style>
      </head>
      <body>${html}</body>
    </html>
  `;
  frame.addEventListener('load', () => {
    const frameDoc = frame.contentDocument;
    frameDoc.addEventListener('mouseup', () => handleSelection(frameDoc, frameDoc.body, frame));
    renderToc(frameDoc.body, frame);
  }, { once: true });
}

function renderToc(root, frame = null) {
  const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  if (headings.length === 0) {
    els.toc.className = 'toc empty';
    els.toc.textContent = 'No headings';
    return;
  }

  els.toc.className = 'toc';
  els.toc.innerHTML = '';
  headings.forEach((heading, index) => {
    if (!heading.id) heading.id = slugify(heading.textContent, index);
    const button = document.createElement('button');
    button.className = 'toc-item';
    button.style.paddingLeft = `${8 + (Number(heading.tagName.slice(1)) - 1) * 12}px`;
    button.textContent = heading.textContent;
    button.addEventListener('click', () => {
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (frame) frame.contentWindow.focus();
    });
    els.toc.appendChild(button);
  });
}

function renderComments() {
  els.comments.innerHTML = '';
  if (state.session.comments.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'toc empty';
    empty.textContent = 'No comments';
    els.comments.appendChild(empty);
    return;
  }

  for (const comment of state.session.comments) {
    const card = document.createElement('article');
    card.className = 'comment-card';
    card.innerHTML = `
      <div class="comment-status">${escapeHtml(comment.status)} · ${escapeHtml(comment.versionId)}</div>
      <div class="quote">${escapeHtml(comment.quote)}</div>
    `;
    const textarea = document.createElement('textarea');
    textarea.value = comment.comment;
    textarea.disabled = comment.status !== 'draft';
    card.appendChild(textarea);

    if (comment.status === 'draft') {
      const actions = document.createElement('div');
      actions.className = 'comment-actions';
      const save = document.createElement('button');
      save.className = 'button';
      save.textContent = 'Save';
      save.addEventListener('click', async () => {
        await api(`/api/sessions/${state.sessionId}/comments/${comment.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ comment: textarea.value })
        });
        await loadSession();
      });
      const del = document.createElement('button');
      del.className = 'button ghost';
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        await api(`/api/sessions/${state.sessionId}/comments/${comment.id}`, { method: 'DELETE' });
        await loadSession();
      });
      actions.append(save, del);
      card.appendChild(actions);
    } else if (['submitted', 'addressed', 'stale'].includes(comment.status)) {
      const actions = document.createElement('div');
      actions.className = 'comment-actions';
      const resolve = document.createElement('button');
      resolve.className = 'button';
      resolve.textContent = 'Resolve';
      resolve.addEventListener('click', async () => {
        await api(`/api/sessions/${state.sessionId}/comments/${comment.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'resolved' })
        });
        await loadSession();
      });
      actions.appendChild(resolve);
      card.appendChild(actions);
    }

    els.comments.appendChild(card);
  }
}

function renderDiff() {
  const versions = state.session.versions;
  if (versions.length < 2) {
    els.diff.innerHTML = '<div class="toc empty">No previous version</div>';
    return;
  }
  const before = versions[versions.length - 2].content.split(/\r?\n/);
  const after = versions[versions.length - 1].content.split(/\r?\n/);
  const max = Math.max(before.length, after.length);
  const lines = [];
  for (let index = 0; index < max; index += 1) {
    if (before[index] === after[index]) {
      lines.push(`<div class="diff-line">  ${escapeHtml(before[index] || '')}</div>`);
    } else {
      if (before[index] !== undefined) lines.push(`<div class="diff-line remove">- ${escapeHtml(before[index])}</div>`);
      if (after[index] !== undefined) lines.push(`<div class="diff-line add">+ ${escapeHtml(after[index])}</div>`);
    }
  }
  els.diff.innerHTML = lines.join('');
}

function renderHistory() {
  els.history.innerHTML = state.session.versions.map((version) => `
    <div class="history-item">
      <strong>Version ${version.number}</strong>
      <div class="meta">${escapeHtml(version.createdAt)}</div>
      <p>${escapeHtml(version.summary || 'No summary')}</p>
    </div>
  `).join('');
}

function selectionContext(text, fullText) {
  const index = fullText.indexOf(text);
  if (index < 0) return { prefix: '', suffix: '' };
  return {
    prefix: fullText.slice(Math.max(0, index - 80), index),
    suffix: fullText.slice(index + text.length, index + text.length + 80)
  };
}

function handleSelection(selectionDocument, root, frame = null) {
  const selection = selectionDocument.getSelection();
  const quote = selection.toString().trim();
  if (!quote) return;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const frameRect = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
  const fullText = root.textContent;
  state.selected = { quote, ...selectionContext(quote, fullText) };
  els.selectedQuote.textContent = quote;
  els.commentInput.value = '';
  els.popover.style.left = `${Math.min(frameRect.left + rect.left, window.innerWidth - 340)}px`;
  els.popover.style.top = `${Math.min(frameRect.top + rect.bottom + 8, window.innerHeight - 220)}px`;
  els.popover.classList.remove('hidden');
}

document.getElementById('cancelComment').addEventListener('click', () => {
  els.popover.classList.add('hidden');
  state.selected = null;
});

document.getElementById('saveComment').addEventListener('click', async () => {
  if (!state.selected || !els.commentInput.value.trim()) return;
  await api(`/api/sessions/${state.sessionId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ ...state.selected, comment: els.commentInput.value.trim() })
  });
  els.popover.classList.add('hidden');
  state.selected = null;
  window.getSelection().removeAllRanges();
  await loadSession();
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.view = tab.dataset.view;
    document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab));
    document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
    document.getElementById(`${state.view}View`).classList.add('active');
  });
});

els.submitComments.addEventListener('click', async () => {
  try {
    await api(`/api/sessions/${state.sessionId}/submit-comments`, {
      method: 'POST',
      body: JSON.stringify({ generalComment: els.generalComment.value })
    });
    els.generalComment.value = '';
    await loadSession();
  } catch (error) {
    alert(error.message);
  }
});

els.approveReview.addEventListener('click', async () => {
  const unresolved = state.session.comments.filter((comment) =>
    ['draft', 'submitted', 'addressed', 'stale'].includes(comment.status)
  ).length;
  const message = unresolved > 0
    ? `当前仍有 ${unresolved} 条未解决评论。确认仍要评审通过当前版本吗？`
    : '确认通过当前版本？通过后 agent 将收到 approval 状态。';
  if (!confirm(message)) return;

  await api(`/api/sessions/${state.sessionId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ force: unresolved > 0 })
  });
  await loadSession();
});

const events = new EventSource(`/events/${state.sessionId}`);
events.addEventListener('version_updated', loadSession);
events.addEventListener('approved', loadSession);
events.addEventListener('comments_submitted', loadSession);
events.addEventListener('comment_changed', loadSession);

loadSession().catch((error) => {
  els.document.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
});
