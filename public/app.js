const state = {
  sessionId: location.pathname.split('/').filter(Boolean).pop(),
  session: null,
  selected: null,
  view: 'preview'
};

const anchorableCommentStatuses = ['draft', 'submitted', 'addressed', 'stale'];

const els = {
  title: document.getElementById('sessionTitle'),
  meta: document.getElementById('versionMeta'),
  document: document.getElementById('document'),
  documentPanel: document.querySelector('.document-panel'),
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

function setBanner(message, state = 'info') {
  if (!message) {
    els.banner.classList.add('hidden');
    els.banner.textContent = '';
    els.banner.removeAttribute('data-state');
    return;
  }
  els.banner.textContent = message;
  els.banner.dataset.state = state;
  els.banner.classList.remove('hidden');
}

function statusLabel(status) {
  return {
    reviewing: '评审中',
    waiting_for_agent: '等待 agent 修改',
    approved: '已通过'
  }[status] || status;
}

function hidePopover() {
  els.popover.classList.add('hidden');
  removePopoverListeners();
  state.selected = null;
}

function addPopoverListeners(selectionDocument, frame = null) {
  removePopoverListeners();
  const listeners = [
    [window, 'scroll', schedulePopoverPosition, true],
    [window, 'resize', schedulePopoverPosition, false],
    [els.documentPanel, 'scroll', schedulePopoverPosition, false]
  ];
  if (frame?.contentWindow) listeners.push([frame.contentWindow, 'scroll', schedulePopoverPosition, false]);
  if (selectionDocument !== document) listeners.push([selectionDocument, 'scroll', schedulePopoverPosition, false]);

  for (const [target, event, handler, options] of listeners) {
    target.addEventListener(event, handler, options);
  }
  state.popoverListeners = listeners;
}

function removePopoverListeners() {
  if (!state.popoverListeners) return;
  for (const [target, event, handler, options] of state.popoverListeners) {
    target.removeEventListener(event, handler, options);
  }
  state.popoverListeners = null;
  if (state.popoverFrame) cancelAnimationFrame(state.popoverFrame);
  state.popoverFrame = null;
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
  els.meta.textContent = `Version ${version.number} · ${statusLabel(state.session.status)} · ${state.session.comments.length} comments`;

  if (state.session.format === 'markdown') {
    els.document.innerHTML = version.renderedHtml || '';
    els.document.onmouseup = () => handleSelection(document, els.document);
    renderCommentAnchors(els.document);
    renderToc(els.document);
  } else {
    renderHtmlFrame(version.content);
  }
  renderComments();
  renderDiff();
  renderHistory();

  const isWaitingForAgent = state.session.status === 'waiting_for_agent';
  const isApproved = state.session.status === 'approved';
  els.submitComments.disabled = isWaitingForAgent || isApproved;
  els.approveReview.disabled = isWaitingForAgent || isApproved;
  els.submitComments.textContent = isWaitingForAgent ? '等待修改' : '提交评论';

  if (isWaitingForAgent) {
    setBanner(`评论已提交 · 正在等待 agent 修改文档`, 'waiting');
  } else if (isApproved) {
    setBanner(`评审已通过 · Version ${version.number}`, 'approved');
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
          body { margin: 0; padding: 48px 56px 88px; background: #ffffff; font-family: "Airbnb Cereal VF", Circular, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; line-height: 1.5; color: #3f3f3f; }
          a { color: #222222; text-decoration: underline; text-underline-offset: 3px; }
          h1, h2, h3, h4, h5, h6 { color: #222222; line-height: 1.2; margin: 1.6em 0 0.65em; font-weight: 600; letter-spacing: 0; }
          h1 { font-size: 28px; }
          h2 { font-size: 22px; }
          h3 { font-size: 20px; }
          p, li { font-size: 16px; line-height: 1.5; }
          table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 14px; line-height: 1.43; }
          th, td { border-bottom: 1px solid #dddddd; padding: 12px; text-align: left; vertical-align: top; }
          th { color: #222222; font-weight: 600; background: #f7f7f7; }
          hr { height: 1px; border: 0; margin: 32px 0; background: #dddddd; }
          pre { background: #f7f7f7; color: #222222; overflow: auto; padding: 18px; border: 1px solid #dddddd; border-radius: 14px; }
          code { background: #f7f7f7; color: #222222; padding: 2px 6px; border-radius: 8px; }
          pre code { background: transparent; padding: 0; }
          .comment-anchor { border-radius: 4px; background: #fff0f3; color: inherit; text-decoration: underline; text-decoration-color: #ff385c; text-decoration-thickness: 2px; text-underline-offset: 3px; cursor: pointer; transition: background-color 140ms ease, box-shadow 140ms ease; }
          .comment-anchor:hover, .comment-anchor.active { background: #ffd1da; box-shadow: 0 0 0 1px #ff385c; }
          .comment-anchor.approximate { text-decoration-style: dashed; }
        </style>
      </head>
      <body>${html}</body>
    </html>
  `;
  frame.addEventListener('load', () => {
    const frameDoc = frame.contentDocument;
    frameDoc.addEventListener('mousedown', () => {
      if (!els.popover.classList.contains('hidden')) hidePopover();
    });
    frameDoc.addEventListener('mouseup', () => handleSelection(frameDoc, frameDoc.body, frame));
    renderCommentAnchors(frameDoc.body, frame);
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
    card.dataset.commentId = comment.id;
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="comment-status">${escapeHtml(comment.status)} · ${escapeHtml(comment.versionId)}</div>
      <div class="quote">${escapeHtml(comment.quote)}</div>
    `;
    card.addEventListener('click', (event) => {
      if (event.target.closest('button, textarea')) return;
      scrollToCommentAnchor(comment.id);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      scrollToCommentAnchor(comment.id);
    });
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

function selectionContextAt(startOffset, endOffset, fullText, fallbackText) {
  if (
    Number.isInteger(startOffset) &&
    Number.isInteger(endOffset) &&
    startOffset >= 0 &&
    endOffset >= startOffset
  ) {
    return {
      prefix: fullText.slice(Math.max(0, startOffset - 80), startOffset),
      suffix: fullText.slice(endOffset, endOffset + 80)
    };
  }
  return selectionContext(fallbackText, fullText);
}

function textOffset(root, targetNode, targetOffset) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let node = walker.nextNode();
  while (node) {
    if (node === targetNode) return offset + targetOffset;
    offset += node.nodeValue.length;
    node = walker.nextNode();
  }
  return null;
}

function anchorableComments() {
  return state.session.comments.filter((comment) =>
    anchorableCommentStatuses.includes(comment.status) &&
    comment.quote
  );
}

function commentOffsets(comment, fullText) {
  const start = Number(comment.startOffset);
  const end = Number(comment.endOffset);
  if (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= fullText.length &&
    fullText.slice(start, end).trim() === String(comment.quote).trim()
  ) {
    return { start, end };
  }

  const quote = String(comment.quote || '').trim();
  if (!quote) return null;

  const matches = [];
  let index = fullText.indexOf(quote);
  while (index >= 0) {
    matches.push({ start: index, end: index + quote.length });
    index = fullText.indexOf(quote, index + quote.length);
  }
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const prefix = String(comment.prefix || '').slice(-40);
  const suffix = String(comment.suffix || '').slice(0, 40);
  return matches
    .map((match) => {
      const before = fullText.slice(Math.max(0, match.start - prefix.length), match.start);
      const after = fullText.slice(match.end, match.end + suffix.length);
      return {
        ...match,
        score: (prefix && before.endsWith(prefix) ? 1 : 0) + (suffix && after.startsWith(suffix) ? 1 : 0)
      };
    })
    .sort((a, b) => b.score - a.score)[0];
}

function clampedRange(start, end, fullText) {
  if (fullText.length === 0) return null;
  const safeStart = Math.max(0, Math.min(fullText.length - 1, start));
  const safeEnd = Math.max(safeStart + 1, Math.min(fullText.length, end));
  return { start: safeStart, end: safeEnd };
}

function allIndexesOf(text, needle) {
  const indexes = [];
  let index = text.indexOf(needle);
  while (index >= 0) {
    indexes.push(index);
    index = text.indexOf(needle, index + Math.max(1, needle.length));
  }
  return indexes;
}

function closestIndex(text, needle, target) {
  if (!needle) return null;
  const indexes = allIndexesOf(text, needle);
  if (indexes.length === 0) return null;
  return indexes.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
}

function contextBoundary(text, context, target, side) {
  const value = String(context || '');
  const maxLength = Math.min(80, value.length);
  for (let length = maxLength; length >= 12; length -= 8) {
    const needle = side === 'prefix' ? value.slice(-length) : value.slice(0, length);
    const index = closestIndex(text, needle, target);
    if (index !== null) return side === 'prefix' ? index + needle.length : index;
  }
  return null;
}

function approximateCommentOffsets(comment, fullText) {
  if (!fullText) return null;
  const oldStart = Number(comment.startOffset);
  const oldEnd = Number(comment.endOffset);
  const hasOldOffsets = Number.isInteger(oldStart) && Number.isInteger(oldEnd) && oldEnd > oldStart;
  const targetStart = hasOldOffsets ? Math.max(0, Math.min(fullText.length, oldStart)) : 0;
  const targetEnd = hasOldOffsets ? Math.max(targetStart, Math.min(fullText.length, oldEnd)) : targetStart;
  const estimateLength = Math.max(12, Math.min(160, String(comment.quote || '').trim().length || targetEnd - targetStart || 32));
  const prefixEnd = contextBoundary(fullText, comment.prefix, targetStart, 'prefix');
  const suffixStart = contextBoundary(fullText, comment.suffix, targetEnd, 'suffix');

  if (prefixEnd !== null && suffixStart !== null) {
    if (prefixEnd < suffixStart && suffixStart - prefixEnd <= Math.max(240, estimateLength * 3)) {
      return { ...clampedRange(prefixEnd, suffixStart, fullText), approximate: true };
    }
    return { ...clampedRange(prefixEnd, prefixEnd + estimateLength, fullText), approximate: true };
  }

  if (prefixEnd !== null) {
    return { ...clampedRange(prefixEnd, prefixEnd + estimateLength, fullText), approximate: true };
  }

  if (suffixStart !== null) {
    return { ...clampedRange(suffixStart - estimateLength, suffixStart, fullText), approximate: true };
  }

  if (hasOldOffsets) {
    return { ...clampedRange(targetStart, targetStart + estimateLength, fullText), approximate: true };
  }

  return null;
}

function commentAnchorOffsets(comment, fullText) {
  const exact = commentOffsets(comment, fullText);
  if (exact) return exact;
  return approximateCommentOffsets(comment, fullText);
}

function textSegmentsForOffsets(root, startOffset, endOffset) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest('script,style,textarea')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const segments = [];
  let offset = 0;
  let node = walker.nextNode();
  while (node && offset < endOffset) {
    const nextOffset = offset + node.nodeValue.length;
    if (nextOffset > startOffset && offset < endOffset) {
      segments.push({
        node,
        start: Math.max(0, startOffset - offset),
        end: Math.min(node.nodeValue.length, endOffset - offset)
      });
    }
    offset = nextOffset;
    node = walker.nextNode();
  }
  return segments.filter((segment) => segment.end > segment.start);
}

function wrapTextSegment(segment, commentId, approximate = false) {
  let selectedNode = segment.node;
  if (segment.end < selectedNode.nodeValue.length) selectedNode.splitText(segment.end);
  if (segment.start > 0) selectedNode = selectedNode.splitText(segment.start);

  const mark = selectedNode.ownerDocument.createElement('mark');
  mark.className = approximate ? 'comment-anchor approximate' : 'comment-anchor';
  mark.dataset.commentId = commentId;
  mark.tabIndex = 0;
  selectedNode.parentNode.insertBefore(mark, selectedNode);
  mark.appendChild(selectedNode);
  return mark;
}

function clearActiveComment() {
  document.querySelectorAll('.comment-card.active, .comment-anchor.active').forEach((node) => {
    node.classList.remove('active');
  });
  const frame = document.getElementById('htmlFrame');
  frame?.contentDocument?.querySelectorAll('.comment-anchor.active').forEach((node) => {
    node.classList.remove('active');
  });
}

function setActiveComment(commentId) {
  clearActiveComment();
  document.querySelectorAll(`[data-comment-id="${CSS.escape(commentId)}"]`).forEach((node) => {
    node.classList.add('active');
  });
  const frame = document.getElementById('htmlFrame');
  frame?.contentDocument?.querySelectorAll(`[data-comment-id="${CSS.escape(commentId)}"]`).forEach((node) => {
    node.classList.add('active');
  });
}

function scrollToCommentCard(commentId) {
  const card = els.comments.querySelector(`[data-comment-id="${CSS.escape(commentId)}"]`);
  if (!card) return;
  setActiveComment(commentId);
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function scrollToCommentAnchor(commentId) {
  let anchor = els.document.querySelector(`[data-comment-id="${CSS.escape(commentId)}"]`);
  let frame = null;
  if (!anchor) {
    frame = document.getElementById('htmlFrame');
    anchor = frame?.contentDocument?.querySelector(`[data-comment-id="${CSS.escape(commentId)}"]`);
  }
  if (!anchor) return;

  setActiveComment(commentId);
  if (frame) frame.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  anchor.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
}

function bindCommentAnchor(anchor, commentId) {
  anchor.addEventListener('click', () => scrollToCommentCard(commentId));
  anchor.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    scrollToCommentCard(commentId);
  });
}

function renderCommentAnchors(root) {
  const fullText = root.textContent || '';
  const comments = anchorableComments()
    .map((comment) => ({ comment, offsets: commentAnchorOffsets(comment, fullText) }))
    .filter((item) => item.offsets)
    .sort((a, b) => b.offsets.start - a.offsets.start);

  for (const { comment, offsets } of comments) {
    const segments = textSegmentsForOffsets(root, offsets.start, offsets.end);
    const anchors = segments.map((segment) => wrapTextSegment(segment, comment.id, offsets.approximate));
    anchors.forEach((anchor) => bindCommentAnchor(anchor, comment.id));
  }
}

function positionPopover() {
  if (!state.selected?.range || els.popover.classList.contains('hidden')) return;
  const rect = state.selected.range.getBoundingClientRect();
  const frameRect = state.selected.frame
    ? state.selected.frame.getBoundingClientRect()
    : { left: 0, top: 0 };
  const popoverRect = els.popover.getBoundingClientRect();
  const margin = 16;
  const preferredLeft = frameRect.left + rect.left;
  const preferredTop = frameRect.top + rect.bottom + 8;
  const maxLeft = window.innerWidth - popoverRect.width - margin;
  const maxTop = window.innerHeight - popoverRect.height - margin;
  const left = Math.max(margin, Math.min(preferredLeft, maxLeft));
  const top = Math.max(margin, Math.min(preferredTop, maxTop));
  els.popover.style.left = `${left}px`;
  els.popover.style.top = `${top}px`;
}

function schedulePopoverPosition() {
  if (state.popoverFrame) return;
  state.popoverFrame = requestAnimationFrame(() => {
    state.popoverFrame = null;
    positionPopover();
  });
}

function handleSelection(selectionDocument, root, frame = null) {
  const selection = selectionDocument.getSelection();
  const quote = selection.toString().trim();
  if (!quote) return;
  const range = selection.getRangeAt(0);
  const fullText = root.textContent;
  const startOffset = textOffset(root, range.startContainer, range.startOffset);
  const endOffset = textOffset(root, range.endContainer, range.endOffset);
  state.selected = {
    quote,
    ...selectionContextAt(startOffset, endOffset, fullText, quote),
    startOffset,
    endOffset,
    range: range.cloneRange(),
    selectionDocument,
    frame
  };
  els.selectedQuote.textContent = quote;
  els.commentInput.value = '';
  els.popover.classList.remove('hidden');
  positionPopover();
  addPopoverListeners(selectionDocument, frame);
}

document.getElementById('cancelComment').addEventListener('click', () => {
  hidePopover();
});

document.getElementById('saveComment').addEventListener('click', async () => {
  if (!state.selected || !els.commentInput.value.trim()) return;
  try {
    await api(`/api/sessions/${state.sessionId}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        quote: state.selected.quote,
        prefix: state.selected.prefix,
        suffix: state.selected.suffix,
        startOffset: state.selected.startOffset,
        endOffset: state.selected.endOffset,
        comment: els.commentInput.value.trim()
      })
    });
    state.selected.selectionDocument?.getSelection()?.removeAllRanges();
    hidePopover();
    await loadSession();
  } catch (error) {
    alert(error.message);
  }
});

document.addEventListener('mousedown', (event) => {
  if (els.popover.classList.contains('hidden')) return;
  if (els.popover.contains(event.target)) return;
  hidePopover();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.popover.classList.contains('hidden')) {
    hidePopover();
  }
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
