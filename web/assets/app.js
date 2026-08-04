var msgs = document.getElementById('messages');
var input = document.getElementById('input');
var sendBtn = document.getElementById('send');
var fileInput = document.getElementById('file-input');
var attachBtn = document.getElementById('attach');
var filesToggle = document.getElementById('files-toggle');
var filesClose = document.getElementById('files-close');
var filesPanel = document.getElementById('files-panel');
var filesList = document.getElementById('files-list');
var pendingBar = document.getElementById('pending');
var editor = document.getElementById('editor');
var editorBox = editor.querySelector('.editor-box');
var editorCodeWrap = editor.querySelector('.editor-code-wrap');
var editorName = document.getElementById('editor-name');
var editorCode = document.getElementById('editor-code');
var editorOut = document.getElementById('editor-output');
var editorSplit = document.getElementById('editor-split');
var editorRun = document.getElementById('editor-run');
var editorSave = document.getElementById('editor-save');
var editorFull = document.getElementById('editor-full');
var editorClose = document.getElementById('editor-close');
var NEW_SCRIPT = 'namespace sandbox.guest\n\ndef runTask(): Unit =\n  println "hello"\n';
var NL = String.fromCharCode(10);
var busy = false;
var currentSession = null;
var sessionList = [];
var pending = [];   // File objects staged for the next message (not yet uploaded)
var approvalCards = {};

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// A reusable "show more": renders `text` in a body (styled by `bodyClass`),
// clamped to `maxLines` with a toggle when it is longer. Returns the wrapper.
function collapsible(text, maxLines, bodyClass) {
  maxLines = maxLines || 3;
  var lineCount = String(text).split(NL).length;
  var wrap = el('div', 'collapsible');
  var body = el('div', 'collapsible-body' + (bodyClass ? ' ' + bodyClass : ''));
  body.textContent = text;
  wrap.appendChild(body);

  if (lineCount > maxLines) {
    wrap.classList.add('clamped');
    wrap.style.setProperty('--max-lines', maxLines);
    var hidden = lineCount - maxLines;
    var moreLabel = 'Show ' + hidden + ' more line' + (hidden === 1 ? '' : 's');
    var toggle = el('button', 'show-more', moreLabel);
    toggle.addEventListener('click', function () {
      toggle.textContent = wrap.classList.toggle('expanded') ? 'Show less' : moreLabel;
    });
    wrap.appendChild(toggle);
  }
  return wrap;
}

// --- Jo syntax highlighting ---
//
// A small tokenizer ported from the VS Code TextMate grammar (tools/vscode).
// One ordered regex scans the source; alternatives are tried left-to-right at
// each position, so comments/strings win over keywords/operators. Every piece of
// text is HTML-escaped (the code is untrusted — agent- or user-written), so the
// returned markup is XSS-safe.
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

var JO_TOKEN = new RegExp([
  '(?<c>\\/\\/+\\[[\\s\\S]*?\\/\\/+\\]|\\/\\/.*)',                                  // comments (block //[ … //], line //)
  '(?<s>"""[\\s\\S]*?"""|"(?:\\\\.|[^"\\\\])*"|`(?:\\\\.|[^`\\\\\\n])*`|\'(?:\\\\.|[^\'\\\\])\')', // strings, regex, char
  '(?<n>\\b0[xX][0-9a-fA-F_]+\\b|\\b\\d[\\d_]*\\.\\d[\\d_]*(?:[eE][+-]?\\d+)?\\b|\\b\\d[\\d_]*\\b)', // numbers
  '(?<k>\\b(?:if|then|else|while|do|for|in|match|case|end|begin|return|break|continue|rescue|annotation|def|val|var|fun|type|class|object|interface|extension|pattern|union|param|section|allow|as|auto|defer|import|namespace|new|private|receives|view|is|with)\\b)', // keywords
  '(?<l>\\b(?:true|false|this)\\b)',                                               // literals
  '(?<t>\\b[A-Z][A-Za-z0-9_]*\\b)',                                                // type names
  '(?<o>=>|[+\\-*/%|&^><=:?!@~]+)'                                                 // operators
].join('|'), 'g');

var JO_CLASS = { c: 'hl-c', s: 'hl-s', n: 'hl-n', k: 'hl-k', l: 'hl-l', t: 'hl-t', o: 'hl-o' };

// The keyword set (whole-word), shared by the CodeMirror stream tokenizer.
var JO_KW = /^(?:if|then|else|while|do|for|in|match|case|end|begin|return|break|continue|rescue|annotation|def|val|var|fun|type|class|object|interface|extension|pattern|union|param|section|allow|as|auto|defer|import|namespace|new|private|receives|view|is|with)$/;

function highlightJo(code) {
  var out = '', last = 0, m;
  JO_TOKEN.lastIndex = 0;
  while ((m = JO_TOKEN.exec(code)) !== null) {
    if (m[0].length === 0) { JO_TOKEN.lastIndex++; continue; }   // guard against zero-width
    out += escapeHtml(code.slice(last, m.index));
    var key = Object.keys(m.groups).filter(function (g) { return m.groups[g] !== undefined; })[0];
    out += '<span class="' + JO_CLASS[key] + '">' + escapeHtml(m[0]) + '</span>';
    last = m.index + m[0].length;
  }
  return out + escapeHtml(code.slice(last));
}

// Markdown via markdown-it (loaded from CDN in <head>). Default options
// keep html:false, so raw HTML in the model's reply is escaped, not run
// (XSS-safe without a separate sanitizer). A ```Jo fence is syntax-highlighted
// via `highlightJo` (which returns escaped markup). Returns null if the library
// failed to load (e.g. offline), so the caller can fall back to plain text.
var md = (typeof markdownit !== 'undefined')
  ? markdownit({
      linkify: true, breaks: true,
      highlight: function (code, lang) {
        return /^jo$/i.test(lang || '') ? highlightJo(code) : '';
      }
    })
  : null;

// A `[text](chordbox:name)` link points at a file in this session's data dir.
// The agent uses this scheme (see AGENT.md) rather than guessing a filesystem
// path. We rewrite it to the real `/api/file` download URL at render time — the
// session is known then, not when the rule is installed — and reduce `name` to a
// basename so a stray path (e.g. a copied `/mnt/data/...`) still resolves.
if (md) {
  var okLink = md.validateLink.bind(md);
  md.validateLink = function (url) {
    return /^chordbox:/i.test(url) || okLink(url);
  };
  var baseLinkOpen = md.renderer.rules.link_open
    || function (t, i, o, e, s) { return s.renderToken(t, i, o); };
  md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
    var tok = tokens[idx];
    var hi = tok.attrIndex('href');
    if (hi >= 0) {
      var m = /^chordbox:(.*)$/i.exec(tok.attrs[hi][1]);
      if (m) {
        var name = m[1].replace(/^.*[\\/]/, '');   // basename
        tok.attrs[hi][1] = (currentSession && name) ? fileUrl(currentSession, name) : '#';
        tok.attrSet('target', '_blank');
        tok.attrSet('rel', 'noopener');
      }
    }
    return baseLinkOpen(tokens, idx, options, env, self);
  };
}

function renderMarkdown(src) {
  return md ? md.render(src) : null;
}

function addMessage(role, text) {
  var empty = document.getElementById('empty');
  if (empty) empty.style.display = 'none';
  var wrap = el('div', 'msg ' + role);
  var row = el('div', 'row');
  var bubble = el('div', 'bubble', text);
  row.appendChild(bubble);
  wrap.appendChild(row);
  msgs.appendChild(wrap);
  scrollDown();
  return row;
}

function scrollDown() {
  var main = document.querySelector('main');
  main.scrollTop = main.scrollHeight;
}

// --- attachments ---

var SVG = 'http://www.w3.org/2000/svg';

function svgIcon(paths, extra) {
  var s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  paths.forEach(function (d) {
    var p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
  });
  (extra || []).forEach(function (e) { s.appendChild(e); });
  return s;
}

// Classify a file into a coarse kind from its MIME type, falling back to the
// filename extension (uploads may arrive with an empty or generic MIME).
function fileKind(mime, name) {
  var m = (mime || '').toLowerCase();
  var ext = (name || '').toLowerCase().split('.').pop();
  if (m.indexOf('image/') === 0 || /^(png|jpe?g|gif|webp|svg|bmp|heic|tiff?)$/.test(ext)) return 'image';
  if (m.indexOf('pdf') >= 0 || ext === 'pdf') return 'pdf';
  if (m.indexOf('word') >= 0 || m.indexOf('wordprocessing') >= 0 || ext === 'doc' || ext === 'docx') return 'word';
  if (m.indexOf('excel') >= 0 || m.indexOf('spreadsheet') >= 0 || ext === 'xls' || ext === 'xlsx' || ext === 'csv') return 'excel';
  if (m.indexOf('powerpoint') >= 0 || m.indexOf('presentation') >= 0 || ext === 'ppt' || ext === 'pptx') return 'presentation';
  if (m.indexOf('text/html') >= 0 || ext === 'html' || ext === 'htm') return 'html';
  if (m.indexOf('markdown') >= 0 || ext === 'md' || ext === 'markdown') return 'markdown';
  if (m.indexOf('json') >= 0 || ext === 'json' || ext === 'jsonl') return 'json';
  if (m.indexOf('zip') >= 0 || m.indexOf('compressed') >= 0 || /^(zip|tar|gz|tgz|bz2|xz|7z|rar)$/.test(ext)) return 'archive';
  if (m.indexOf('audio/') === 0 || /^(mp3|wav|m4a|aac|flac|ogg|opus)$/.test(ext)) return 'audio';
  if (m.indexOf('video/') === 0 || /^(mp4|webm|mov|mkv|avi|m4v)$/.test(ext)) return 'video';
  if (/^(jo|js|jsx|ts|tsx|py|rb|rs|go|java|c|cc|cpp|h|hpp|css|scss|sql|sh|toml|ya?ml|xml)$/.test(ext)) return 'code';
  if (m.indexOf('text/plain') >= 0 || ext === 'txt' || ext === 'log') return 'text';
  return 'file';
}

// A document-page glyph (folded corner) with an optional format label baked in
// and a type color; `currentColor` drives both the outline and the label.
function docGlyph(label, color) {
  var svg = svgIcon(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6']);
  if (label) {
    var t = document.createElementNS(SVG, 'text');
    t.setAttribute('x', '12'); t.setAttribute('y', '17');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', '6'); t.setAttribute('font-weight', '700');
    t.setAttribute('fill', 'currentColor'); t.setAttribute('stroke', 'none');
    t.textContent = label;
    svg.appendChild(t);
  }
  if (color) svg.style.color = color;
  return svg;
}

// A per-format icon: a distinct picture glyph for images; a colored, labeled
// page for recognized document formats; a plain page for anything else.
var FILE_COLORS = {
  pdf: '#e5484d', word: '#2b6cb0', excel: '#2f855a',
  presentation: '#b7791f', html: '#0891b2', markdown: '#4a5568',
  json: '#6b46c1', archive: '#718096', audio: '#b83280', video: '#5a67d8', text: '#4a5568'
};
var FILE_LABELS = {
  pdf: 'PDF', word: 'DOC', excel: 'XLS', presentation: 'PPT',
  html: 'HTML', markdown: 'MD', json: 'JSON', archive: 'ZIP',
  audio: 'AUD', video: 'VID', text: 'TXT'
};

function fileIcon(mime, name) {
  var kind = fileKind(mime, name);
  if (kind === 'image') {
    var circle = document.createElementNS(SVG, 'circle');
    circle.setAttribute('cx', '9'); circle.setAttribute('cy', '9'); circle.setAttribute('r', '2');
    var img = svgIcon(['M21 15l-5-5L5 21'], [rect('3', '3', '18', '18', '2'), circle]);
    img.style.color = '#8257e6';
    return img;
  }
  if (kind === 'code') {
    var g = svgIcon(['M8 9l-3 3 3 3', 'M16 9l3 3-3 3', 'M13.5 7l-3 10']);
    g.style.color = 'var(--accent)';
    return g;
  }
  return docGlyph(FILE_LABELS[kind] || null, FILE_COLORS[kind] || null);
}

function rect(x, y, w, h, r) {
  var e = document.createElementNS(SVG, 'rect');
  e.setAttribute('x', x); e.setAttribute('y', y);
  e.setAttribute('width', w); e.setAttribute('height', h); e.setAttribute('rx', r);
  return e;
}

function humanSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

// A clickable card for one attachment. When a session is known the card links
// to the file (inline-served, so images/PDFs preview in a new tab).
function fileCard(att, session) {
  var card = el('a', 'file-card');
  if (session) {
    card.href = '/api/file?session=' + encodeURIComponent(session) + '&name=' + encodeURIComponent(att.name);
    card.target = '_blank';
    card.rel = 'noopener';
  }
  card.appendChild(fileIcon(att.mime, att.name));
  var meta = el('div');
  meta.appendChild(el('div', 'file-name', att.name));
  var sz = humanSize(att.size);
  if (sz) meta.appendChild(el('div', 'file-size', sz));
  card.appendChild(meta);
  return card;
}

function appendAttachments(row, atts, session) {
  if (!atts || !atts.length) return;
  var wrap = el('div', 'attachments');
  atts.forEach(function (a) { wrap.appendChild(fileCard(a, session)); });
  row.appendChild(wrap);
}

function fileUrl(session, name) {
  return '/api/file?session=' + encodeURIComponent(session) + '&name=' + encodeURIComponent(name);
}

// A file the agent delivered that no longer resolves on disk: still shown, since
// the delivery is part of the dialog, but as a muted, non-clickable card.
function missingCard(f) {
  var card = el('div', 'file-card file-missing');
  card.appendChild(fileIcon(f.mime, f.name));
  var meta = el('div');
  meta.appendChild(el('div', 'file-name', f.name));
  meta.appendChild(el('div', 'file-size', 'no longer available'));
  card.appendChild(meta);
  return card;
}

// One file the agent delivered via sendFile: an inline preview for images, a
// download card otherwise (or a missing card if it is gone).
function outFile(f, session) {
  if (f.missing) return missingCard(f);
  if (fileKind(f.mime, f.name) === 'image') {
    var a = el('a', 'out-image');
    a.href = fileUrl(session, f.name); a.target = '_blank'; a.rel = 'noopener'; a.title = f.name;
    var img = el('img'); img.src = fileUrl(session, f.name); img.alt = f.name; img.loading = 'lazy';
    a.appendChild(img);
    return a;
  }
  return fileCard(f, session);
}

// The files the agent delivered (sendFile), shown on its reply.
function appendSentFiles(row, files, session) {
  if (!files || !files.length) return;
  var wrap = el('div', 'attachments');
  files.forEach(function (f) { wrap.appendChild(outFile(f, session)); });
  row.appendChild(wrap);
}

// The runCode trace under an agent reply: a collapsed "Ran N programs"
// disclosure that expands to each Jo program (copyable) and its output. The
// programs and output come straight from the transcript, so it survives reload.
function codeTrace(steps) {
  var d = el('details', 'trace');
  var sum = el('summary');
  var chev = svgIcon(['M9 18l6-6-6-6']); chev.setAttribute('class', 'chev');
  sum.appendChild(chev);
  sum.appendChild(el('span', null, 'Ran ' + steps.length + (steps.length === 1 ? ' program' : ' programs')));
  d.appendChild(sum);

  steps.forEach(function (st, i) {
    var step = el('div', 'trace-step');
    if (steps.length > 1) step.appendChild(el('div', 'lbl', 'Program ' + (i + 1)));

    var codeWrap = el('div', 'trace-code');
    var pre = el('pre'); pre.innerHTML = highlightJo(st.code);

    var btns = el('div', 'trace-btns');
    var edit = el('button', 'trace-btn', 'Edit & run');
    edit.addEventListener('click', function () { openEditor('script.jo', st.code); });
    var copy = el('button', 'trace-btn', 'Copy');
    copy.addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(st.code);
      copy.textContent = 'Copied';
      setTimeout(function () { copy.textContent = 'Copy'; }, 1200);
    });
    btns.appendChild(edit);
    btns.appendChild(copy);

    codeWrap.appendChild(pre);
    codeWrap.appendChild(btns);
    step.appendChild(codeWrap);

    if (st.output) {
      step.appendChild(el('div', 'lbl', 'Output'));
      step.appendChild(collapsible(st.output, 3, 'trace-out'));
    }
    d.appendChild(step);
  });
  return d;
}

// --- pending (staged) files ---

function addFiles(fileList) {
  for (var i = 0; i < fileList.length; i++) pending.push(fileList[i]);
  renderPending();
}

function removePending(idx) {
  pending.splice(idx, 1);
  renderPending();
}

function renderPending() {
  pendingBar.innerHTML = '';
  pendingBar.style.display = pending.length ? 'flex' : 'none';
  pending.forEach(function (f, i) {
    var chip = el('div', 'chip');
    chip.appendChild(el('span', 'nm', f.name));
    var x = el('span', 'x', '×');
    x.title = 'Remove';
    x.addEventListener('click', function () { removePending(i); });
    chip.appendChild(x);
    pendingBar.appendChild(chip);
  });
}

// Read one File as base64 and POST it to /api/upload. Resolves to the stored
// file's metadata {session, name, size, mime}; the first upload of a new chat
// mints the session, which the caller adopts for the message that follows.
function uploadOne(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('read failed')); };
    reader.onload = function () {
      var b64 = String(reader.result).split(',')[1] || '';
      fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: currentSession || '', name: file.name, mime: file.type, data: b64 })
      }).then(function (r) { return r.json(); }).then(resolve).catch(reject);
    };
    reader.readAsDataURL(file);
  });
}

// Upload staged files in order, adopting the session id the server returns.
function uploadAll(files) {
  var out = [];
  var chain = Promise.resolve();
  files.forEach(function (f) {
    chain = chain.then(function () {
      return uploadOne(f).then(function (meta) {
        if (meta.error) throw new Error(meta.error);
        if (meta.session && meta.session !== currentSession) {
          currentSession = meta.session;
          history.replaceState({}, '', '/c/' + currentSession);
        }
        out.push({ name: meta.name, size: meta.size, mime: meta.mime });
      });
    });
  });
  return chain.then(function () { return out; });
}

// --- session files panel (right rail) ---

function isWide() { return window.innerWidth > 1000; }

function setFilesOpen(on) {
  document.body.classList.toggle('files-open', on);
  filesToggle.classList.toggle('on', on);
}

function toggleFilesPanel() {
  var open = !document.body.classList.contains('files-open');
  setFilesOpen(open);
  if (open) refreshFiles(false);
}

// Count badge on the folder toggle, so files are discoverable while the panel
// is closed (and it stays empty/absent for a session with no files).
function setFilesBadge(n) {
  var b = filesToggle.querySelector('.badge');
  if (!n) { if (b) b.remove(); return; }
  if (!b) { b = el('span', 'badge'); filesToggle.appendChild(b); }
  b.textContent = n > 99 ? '99+' : String(n);
}

function isScript(name) { return /\.jo$/i.test(name || ''); }

function renderFiles(files) {
  filesList.innerHTML = '';

  // The panel is the session's workspace, so a new script always lives here.
  var neu = el('div', 'frow frow-new');
  neu.appendChild(svgIcon(['M12 5v14', 'M5 12h14']));
  neu.appendChild(el('span', 'file-name', 'New script'));
  neu.addEventListener('click', function () { openEditor('script.jo', NEW_SCRIPT); });
  filesList.appendChild(neu);

  if (!files.length) {
    filesList.appendChild(el('div', 'empty-files', 'No files in this session yet.'));
    return;
  }
  files.forEach(function (f) {
    // A .jo script opens in the editor (edit + run); other files download.
    var script = isScript(f.name);
    var row = el(script ? 'div' : 'a', 'frow');
    if (script) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', function () { openScriptFile(f.name); });
    } else {
      row.href = '/api/file?session=' + encodeURIComponent(currentSession) + '&name=' + encodeURIComponent(f.name);
      row.target = '_blank';
      row.rel = 'noopener';
    }
    row.appendChild(fileIcon(f.mime, f.name));
    row.appendChild(el('span', 'file-name', f.name));
    row.appendChild(el('span', 'file-size', humanSize(f.size)));
    filesList.appendChild(row);
  });
}

// Fetch the session's files, refresh the list + badge, and — when `autoOpen`
// (a session load) — open the panel on a wide screen if there are files to show.
function refreshFiles(autoOpen) {
  if (!currentSession) {
    renderFiles([]);
    setFilesBadge(0);
    if (autoOpen) setFilesOpen(false);
    return;
  }
  fetch('/api/files?session=' + encodeURIComponent(currentSession))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var files = d.files || [];
      renderFiles(files);
      setFilesBadge(files.length);
      if (autoOpen) setFilesOpen(files.length > 0 && isWide());
    }).catch(function () {
      filesList.innerHTML = '<div class="empty-files">Could not load files.</div>';
    });
}

// --- code editor (edit + run a session script) ---

// --- CodeMirror 6 (lazy-loaded from a CDN; the plain textarea is the fallback) ---
//
// All @codemirror/* are pinned to one version set and cross-linked with `?deps`,
// so they share a single @codemirror/state instance (mixing versions triggers
// "multiple instances" errors). If the import fails (offline), we simply keep the
// textarea.
var cmView = null;
var cmModules = null;   // cached Promise<[modules] | null>
var CMV = { st: '6.4.1', vw: '6.26.3', lg: '6.10.2', cm: '6.6.0', lz: '1.2.0' };

// Fetch the CodeMirror module graph (once). Kicked off at page-load idle so the
// modules are warm in the cache before the user clicks "Edit"; a later call
// resolves the same cached promise. Resolves to null (not rejects) on failure, so
// the caller falls back to the textarea.
function loadCM() {
  if (cmModules) return cmModules;
  var base = 'https://esm.sh/';
  var dView = '@codemirror/state@' + CMV.st;
  var dLang = '@codemirror/state@' + CMV.st + ',@codemirror/view@' + CMV.vw + ',@lezer/highlight@' + CMV.lz;
  var dCmds = '@codemirror/state@' + CMV.st + ',@codemirror/view@' + CMV.vw + ',@codemirror/language@' + CMV.lg;
  cmModules = Promise.all([
    import(base + '@codemirror/state@' + CMV.st),
    import(base + '@codemirror/view@' + CMV.vw + '?deps=' + dView),
    import(base + '@codemirror/language@' + CMV.lg + '?deps=' + dLang),
    import(base + '@codemirror/commands@' + CMV.cm + '?deps=' + dCmds),
    import(base + '@lezer/highlight@' + CMV.lz)
  ]).catch(function () { return null; });
  return cmModules;
}

// Build the editor view once, from the (pre)loaded modules.
function ensureCodeMirror() {
  if (cmView) return;
  loadCM().then(function (m) {
    if (m && !cmView) buildCodeMirror(m[0], m[1], m[2], m[3], m[4]);
  });
}

function buildCodeMirror(S, V, L, C, H) {
  var tg = H.tags;
  // A Jo stream tokenizer, from the same grammar as highlightJo. `st.m` tracks the
  // one multi-line construct on each side: block comment (//[ … //]) and """ … """.
  var joLang = L.StreamLanguage.define({
    startState: function () { return { m: null }; },
    token: function (s, st) {
      if (st.m === 'c') { if (s.match(/^.*?\/\/+\]/)) st.m = null; else s.skipToEnd(); return 'comment'; }
      if (st.m === 't') { if (s.match(/^.*?"""/)) st.m = null; else s.skipToEnd(); return 'string'; }
      if (s.eatSpace()) return null;
      if (s.match(/^\/\/+\[/)) { if (!s.match(/^.*?\/\/+\]/)) { st.m = 'c'; s.skipToEnd(); } return 'comment'; }
      if (s.match(/^\/\/.*/)) return 'comment';
      if (s.match(/^"""/)) { if (!s.match(/^.*?"""/)) { st.m = 't'; s.skipToEnd(); } return 'string'; }
      if (s.match(/^"(?:\\.|[^"\\])*"/) || s.match(/^'(?:\\.|[^'\\])'/) || s.match(/^`(?:\\.|[^`\\])*`/)) return 'string';
      if (s.match(/^0[xX][0-9a-fA-F_]+/) || s.match(/^\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/)) return 'number';
      if (s.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
        var w = s.current();
        if (JO_KW.test(w)) return 'keyword';
        if (w === 'true' || w === 'false' || w === 'this') return 'atom';
        return /^[A-Z]/.test(w) ? 'typeName' : null;
      }
      if (s.match(/^(?:=>|[+\-*/%|&^><=:?!@~]+)/)) return 'operator';
      s.next(); return null;
    },
    tokenTable: {
      comment: tg.comment, string: tg.string, number: tg.number,
      keyword: tg.keyword, atom: tg.atom, typeName: tg.typeName, operator: tg.operator
    }
  });

  var joHl = L.HighlightStyle.define([
    { tag: tg.comment, color: '#8b949e', fontStyle: 'italic' },
    { tag: tg.string, color: '#a5d6ff' },
    { tag: tg.number, color: '#79c0ff' },
    { tag: tg.keyword, color: '#ff7b72' },
    { tag: tg.atom, color: '#79c0ff' },
    { tag: tg.typeName, color: '#ffa657' },
    { tag: tg.operator, color: '#d2a8ff' }
  ]);

  var mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  var joTheme = V.EditorView.theme({
    '&': { height: '100%', color: '#e6edf3', backgroundColor: '#0d1117' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: mono, fontSize: '13.5px', lineHeight: '1.65' },
    '.cm-content': { caretColor: '#e6edf3', padding: '10px 0' },
    '.cm-gutters': { backgroundColor: '#0d1117', color: '#484f58', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.035)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,.035)' },
    '.cm-cursor': { borderLeftColor: '#e6edf3' }
  }, { dark: true });

  cmView = new V.EditorView({
    doc: editorCode.value,   // seed from the textarea (whatever is open now)
    parent: editorCodeWrap,
    extensions: [
      V.lineNumbers(), V.highlightActiveLine(), V.drawSelection(), V.dropCursor(),
      C.history(), L.bracketMatching(), L.indentOnInput(),
      joLang, L.syntaxHighlighting(joHl), joTheme,
      S.EditorState.tabSize.of(2),
      V.keymap.of([].concat(C.defaultKeymap, C.historyKeymap, [
        C.indentWithTab,
        { key: 'Mod-Enter', run: function () { runEditor(); return true; } }
      ]))
    ]
  });
  editorCode.style.display = 'none';   // retire the textarea fallback
  cmView.focus();
}

// Read/write/focus the code through CodeMirror when it is up, else the textarea.
function editorGetCode() { return cmView ? cmView.state.doc.toString() : editorCode.value; }
function editorSetCode(code) {
  if (cmView) cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: code || '' } });
  else editorCode.value = code || '';
}
function editorFocusCode() { (cmView || editorCode).focus(); }

function openEditor(name, code) {
  editorName.value = name || '';
  editorName.classList.remove('needs-name');
  editorName.placeholder = 'filename.jo';
  editorSetCode(code);
  editorBox.classList.remove('has-output');
  editorOut.textContent = '';
  editorOut.classList.remove('err');
  editorRun.disabled = false; editorRun.classList.remove('running');
  editorSave.disabled = false; editorSave.classList.remove('saved');
  editor.style.display = 'flex';
  ensureCodeMirror();
  editorFocusCode();
}

function closeEditor() { editor.style.display = 'none'; }

// Load a saved .jo file from the files panel back into the editor.
function openScriptFile(name) {
  fetch('/api/file?session=' + encodeURIComponent(currentSession) + '&name=' + encodeURIComponent(name))
    .then(function (r) { return r.text(); })
    .then(function (txt) { openEditor(name, txt); })
    .catch(function () {});
}

function showEditorOutput(summary, text, isErr) {
  editorOut.classList.toggle('err', !!isErr);
  editorOut.innerHTML = '';
  if (summary) editorOut.appendChild(el('div', 'osum', summary));
  editorOut.appendChild(document.createTextNode(text || ''));
  editorBox.classList.add('has-output');
  editorOut.scrollTop = 0;
}

// Adopt the session the server minted (a script written in a fresh chat).
function adoptSession(id) {
  if (id && id !== currentSession) {
    currentSession = id;
    history.replaceState({}, '', '/c/' + currentSession);
    loadSessions();
  }
}

function runEditor() {
  var code = editorGetCode();
  if (!code.trim()) return;
  editorRun.disabled = true; editorRun.classList.add('running');
  fetch('/api/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: currentSession || '', code: code })
  }).then(function (r) { return r.json(); }).then(function (d) {
    editorRun.disabled = false; editorRun.classList.remove('running');
    adoptSession(d.session);
    if (d.error) { showEditorOutput('', d.error, true); return; }
    var isErr = /crash|did not compile|timed out|no executable/i.test(d.summary || '');
    showEditorOutput(d.summary || '', d.result || '', isErr);
    refreshFiles(false);   // a run may have written files
  }).catch(function () {
    editorRun.disabled = false; editorRun.classList.remove('running');
    showEditorOutput('', 'Could not reach the server.', true);
  });
}

function saveEditor() {
  var name = (editorName.value || '').trim();
  if (!name) {
    // Make the missing-name obvious instead of silently doing nothing.
    editorName.classList.add('needs-name');
    editorName.placeholder = 'name the file first…';
    editorName.focus();
    setTimeout(function () { editorName.classList.remove('needs-name'); }, 1500);
    return;
  }
  if (name.indexOf('.') < 0) name += '.jo';
  editorName.value = name;
  editorSave.disabled = true;
  fetch('/api/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: currentSession || '', name: name, content: editorGetCode() })
  }).then(function (r) { return r.json(); }).then(function (d) {
    editorSave.disabled = false;
    if (d.error) return;
    adoptSession(d.session);
    if (d.name) editorName.value = d.name;
    refreshFiles(false);
    editorSave.classList.add('saved');
    setTimeout(function () { editorSave.classList.remove('saved'); }, 1200);
  }).catch(function () { editorSave.disabled = false; });
}

function loadInfo() {
  fetch('/api/info').then(function (r) { return r.json(); }).then(function (d) {
    document.getElementById('title').textContent = d.name;
    document.getElementById('doctitle').textContent = d.name;
  }).catch(function () {});
}

// --- sessions: URL <-> conversation ---

function appendMessage(role, text, attachments, steps, files) {
  var displayRole = role === 'error' ? 'agent' : role;
  var row = addMessage(displayRole, '');
  var bubble = row.querySelector('.bubble');
  if (role === 'error') {
    showTurnError(bubble, text);
  } else if (role === 'agent') {
    var html = renderMarkdown(text);
    if (html === null) bubble.textContent = text; else bubble.innerHTML = html;
  } else {
    bubble.textContent = text;
    if (!text) bubble.style.display = 'none';
  }
  appendAttachments(row, attachments, currentSession);
  if (role === 'agent') {
    appendSentFiles(row, files, currentSession);
    if (steps && steps.length) row.appendChild(codeTrace(steps));
  }
  return row;
}

function showEmpty(on) {
  var empty = document.getElementById('empty');
  if (empty) empty.style.display = on ? '' : 'none';
}

function clearMessages() {
  msgs.innerHTML = '';
  showEmpty(true);
}

function sessionFromPath() {
  var m = location.pathname.match(/^\/c\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function renderSessions() {
  var c = document.getElementById('sessions');
  c.innerHTML = '';
  sessionList.forEach(function (s) {
    var item = el('div', 'session-item' + (s.id === currentSession ? ' active' : ''), s.title || 'New chat');
    item.title = s.title || '';
    item.addEventListener('click', function () { openSession(s.id); });
    c.appendChild(item);
  });
}

function loadSessions() {
  fetch('/api/sessions').then(function (r) { return r.json(); }).then(function (d) {
    sessionList = d.sessions || [];
    renderSessions();
  }).catch(function () {});
}

// While a conversation loads, a centered indicator replaces the transcript
// and the composer is disabled, so a half-loaded session can't be typed
// into. `loadSeq` makes the latest load win if sessions are switched fast.
var loadSeq = 0;

function setLoading(on) {
  document.getElementById('loading').style.display = on ? '' : 'none';
  input.disabled = on;
  sendBtn.disabled = on;
}

// `quiet` re-renders in place from the transcript without the loading spinner
// or a blank flash — used to fold in a just-finished turn's code trace.
function loadHistory(id, quiet) {
  var seq = ++loadSeq;
  if (!quiet) { msgs.innerHTML = ''; showEmpty(false); setLoading(true); }

  return fetch('/api/history?session=' + encodeURIComponent(id))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (seq !== loadSeq) return;
      setLoading(false);
      msgs.innerHTML = '';
      var list = d.messages || [];
      var active = d.state && d.state.active;
      if (list.length === 0 && !active) { showEmpty(true); }
      else { showEmpty(false); list.forEach(function (m) { appendMessage(m.role, m.text, m.attachments, m.steps, m.files); }); }
      // A turn is still running on the server — reconnect and follow it live.
      if (active) reconnect(id, d.state, seq);
      scrollDown();
      input.focus();
    }).catch(function () {
      if (seq !== loadSeq) return;
      setLoading(false);
      if (!quiet) showEmpty(true);
    });
}

function openSession(id) {
  if (id === currentSession) return;
  currentSession = id;
  history.pushState({}, '', '/c/' + id);
  renderSessions();
  loadHistory(id);
  refreshFiles(true);
}

function newChat() {
  loadSeq++;          // abandon any in-flight history load
  setLoading(false);
  currentSession = null;
  history.pushState({}, '', '/');
  clearMessages();
  renderSessions();
  pending = [];
  renderPending();
  setFilesOpen(false);
  setFilesBadge(0);
  renderFiles([]);
  input.focus();
}

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}

function clearBusy() {
  busy = false;
  sendBtn.classList.remove('stop');
  sendBtn.setAttribute('aria-label', 'Send');
}

function send() {
  if (busy || input.disabled) return;
  var text = input.value.trim();
  var files = pending.slice();
  if (!text && !files.length) return;
  input.value = '';
  autoGrow();
  pending = [];
  renderPending();

  // The user turn: text bubble (hidden if empty) plus a card per staged file.
  // Cards get their download link once the session is known (below).
  var urow = addMessage('user', text);
  if (!text) urow.querySelector('.bubble').style.display = 'none';
  var localAtts = files.map(function (f) { return { name: f.name, size: f.size, mime: f.type }; });
  appendAttachments(urow, localAtts, currentSession);

  busy = true;
  sendBtn.classList.add('stop');
  sendBtn.setAttribute('aria-label', 'Stop');

  var row = addMessage('agent', '');
  var bubble = row.querySelector('.bubble');
  var status = el('div', 'status');
  status.appendChild(el('span', 'dot'));
  var statusText = el('span', null, files.length ? 'uploading' : 'thinking');
  status.appendChild(statusText);
  row.appendChild(status);
  scrollDown();

  function finish() {
    status.remove();
    clearBusy();
    input.focus();
    loadSessions();
    refreshFiles(false);   // update the list + badge; don't change open state
    // Re-render successful turns so their code trace folds in. A failed turn has
    // no assistant transcript message, so keep its streamed error visible.
    if (currentSession && !bubble.classList.contains('error')) loadHistory(currentSession, true);
    else scrollDown();
  }

  uploadAll(files).then(function (uploaded) {
    // Re-render the user's cards now that the session (and any de-duplicated
    // server-side names) are known, so each card links to its stored file.
    if (uploaded.length) {
      var old = urow.querySelector('.attachments');
      if (old) old.remove();
      appendAttachments(urow, uploaded, currentSession);
    }
    statusText.textContent = 'thinking';
    return streamTurn(text, uploaded, bubble, statusText, finish);
  }).catch(function () {
    statusText.textContent = 'upload failed';
    clearBusy();
  });
}

// Drain one NDJSON event stream, dispatching each line through handle() into
// `bubble`/`statusText`; calls onDone() when the stream ends. Shared by the
// send path (POST /api/message) and the reconnect path (GET /api/subscribe).
function readStream(resp, bubble, statusText, onDone) {
  var reader = resp.body.getReader();
  var decoder = new TextDecoder();
  var buf = '';
  function pump() {
    return reader.read().then(function (res) {
      if (res.done) { onDone(); return; }
      buf += decoder.decode(res.value, { stream: true });
      var idx;
      while ((idx = buf.indexOf(NL)) >= 0) {
        var line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) handle(JSON.parse(line), bubble, statusText);
      }
      return pump();
    });
  }
  return pump();
}

// POST one message and render its progress/answer stream into `bubble`.
function streamTurn(text, attachments, bubble, statusText, finish) {
  var body = { text: text, attachments: attachments || [] };
  if (currentSession) body.session = currentSession;

  return fetch('/api/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (resp) {
    return readStream(resp, bubble, statusText, finish);
  }).catch(function () {
    statusText.textContent = 'connection error';
    clearBusy();
  });
}

// Reconnect to a turn already running on the server (e.g. after a page refresh,
// or in a second tab opened mid-turn). The pending user message isn't in the
// committed history yet, so it is rendered from the live `state`; then we follow
// the turn's events until it ends, and reload the (now-committed) history.
function reconnect(id, state, seq) {
  appendMessage('user', state.text || '', state.attachments);

  busy = true;
  sendBtn.classList.add('stop');
  sendBtn.setAttribute('aria-label', 'Stop');

  var row = addMessage('agent', '');
  var bubble = row.querySelector('.bubble');
  var status = el('div', 'status');
  status.appendChild(el('span', 'dot'));
  var statusText = el('span', null, 'working');
  status.appendChild(statusText);
  row.appendChild(status);
  scrollDown();

  function finish() {
    status.remove();
    clearBusy();
    // Preserve a streamed failure. It has no assistant transcript message and
    // would otherwise disappear as soon as history is reloaded.
    if (seq === loadSeq && !bubble.classList.contains('error')) loadHistory(id, true);
    loadSessions();
    refreshFiles(false);   // a reconnected turn may have produced files
  }

  fetch('/api/subscribe?session=' + encodeURIComponent(id))
    .then(function (resp) { return readStream(resp, bubble, statusText, finish); })
    .catch(function () { status.remove(); clearBusy(); });
}

// Progress is transient: while the turn runs, the pulsing dot plus one
// line of small text show the latest step (thinking / tool summaries);
// it all disappears when the turn's result arrives (finish() removes the
// status element). Only the result lands in the transcript.
function handle(ev, bubble, statusText) {
  if (ev.type === 'session') {
    currentSession = ev.id;
    history.pushState({}, '', '/c/' + ev.id);
  } else if (ev.type === 'status') {
    statusText.textContent = ev.label;
  } else if (ev.type === 'tool') {
    statusText.textContent = ev.summary;
  } else if (ev.type === 'approval') {
    showApproval(ev, bubble, statusText);
  } else if (ev.type === 'approval-ended') {
    finishApproval(ev.id, ev.decision);
  } else if (ev.type === 'answer') {
    var html = renderMarkdown(ev.text);
    if (html === null) bubble.textContent = ev.text;
    else bubble.innerHTML = html;
  } else if (ev.type === 'error') {
    showTurnError(bubble, ev.detail);
  } else if (ev.type === 'interrupted') {
    bubble.classList.add('notice');
    bubble.textContent = 'Stopped.';
  } else if (ev.type === 'failed') {
    showTurnError(bubble, ev.detail || 'Please try again.');
  }
  scrollDown();
}

function showTurnError(bubble, detail) {
  bubble.classList.add('error');
  bubble.innerHTML = '';
  var disclosure = el('details', 'turn-error');
  disclosure.appendChild(el('summary', 'error-title', 'Request failed'));
  disclosure.appendChild(el('div', 'error-detail', detail));
  bubble.appendChild(disclosure);
}

function showApproval(ev, bubble, statusText) {
  if (approvalCards[ev.id]) return;

  statusText.textContent = 'waiting for your approval';
  bubble.innerHTML = '';
  bubble.classList.add('approval-bubble');

  var card = el('div', 'approval-card');
  card.appendChild(el('div', 'approval-label', 'Approval required'));
  card.appendChild(el('div', 'approval-title', ev.title));

  if (ev.detail) {
    var detail = el('div', 'approval-detail');
    var html = renderMarkdown(ev.detail);
    if (html === null) detail.textContent = ev.detail;
    else detail.innerHTML = html;
    card.appendChild(detail);
  }

  var actions = el('div', 'approval-actions');
  var reject = el('button', 'approval-btn reject', 'Reject');
  var approve = el('button', 'approval-btn approve', 'Approve');
  actions.appendChild(reject);
  actions.appendChild(approve);
  card.appendChild(actions);
  bubble.appendChild(card);

  approvalCards[ev.id] = { card: card, approve: approve, reject: reject };

  function decide(decision) {
    approve.disabled = true;
    reject.disabled = true;
    fetch('/api/approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: currentSession,
        id: ev.id,
        decision: decision
      })
    }).then(function (resp) { return resp.json(); })
      .then(function (result) {
        if (!result.ok) finishApproval(ev.id, 'cancelled');
      })
      .catch(function () {
        approve.disabled = false;
        reject.disabled = false;
      });
  }

  approve.addEventListener('click', function () { decide('approved'); });
  reject.addEventListener('click', function () { decide('rejected'); });
}

function finishApproval(id, decision) {
  var current = approvalCards[id];
  if (!current) return;

  current.approve.disabled = true;
  current.reject.disabled = true;
  var labels = {
    approved: 'Approved',
    rejected: 'Rejected',
    timed_out: 'Approval timed out',
    cancelled: 'Approval cancelled'
  };
  current.card.appendChild(el('div', 'approval-result', labels[decision] || 'Approval ended'));
  delete approvalCards[id];
}

// While a turn runs, the send button becomes a stop button: it asks the
// server to cancel the session's turn (takes effect at the next model/tool
// boundary; the stream then ends with an "interrupted" event).
function stopTurn() {
  if (!currentSession) return;
  fetch('/api/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: currentSession })
  });
}

sendBtn.addEventListener('click', function () {
  if (busy) stopTurn(); else send();
});
input.addEventListener('input', autoGrow);
input.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
document.getElementById('collapse').addEventListener('click', function () {
  document.body.classList.add('collapsed');
});
document.getElementById('opener').addEventListener('click', function () {
  document.body.classList.remove('collapsed');
});
document.getElementById('newchat').addEventListener('click', newChat);
document.getElementById('title').addEventListener('click', newChat);

// Attach files: the clip opens the picker; chosen files are staged, not sent.
attachBtn.addEventListener('click', function () { fileInput.click(); });
fileInput.addEventListener('change', function () {
  if (fileInput.files && fileInput.files.length) addFiles(fileInput.files);
  fileInput.value = '';   // let the same file be re-picked later
});

// Drag-and-drop anywhere over the chat pane stages the files.
var chat = document.querySelector('.chat');
['dragenter', 'dragover'].forEach(function (ev) {
  chat.addEventListener(ev, function (e) {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) {
      e.preventDefault();
      document.body.classList.add('dragging');
    }
  });
});
['dragleave', 'drop'].forEach(function (ev) {
  chat.addEventListener(ev, function (e) {
    if (ev === 'dragleave' && e.relatedTarget && chat.contains(e.relatedTarget)) return;
    document.body.classList.remove('dragging');
  });
});
chat.addEventListener('drop', function (e) {
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  }
});

// Paste an image (e.g. a screenshot) straight into the composer.
input.addEventListener('paste', function (e) {
  var items = (e.clipboardData || {}).items || [];
  var files = [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].kind === 'file') { var f = items[i].getAsFile(); if (f) files.push(f); }
  }
  if (files.length) { e.preventDefault(); addFiles(files); }
});

filesToggle.addEventListener('click', toggleFilesPanel);
filesClose.addEventListener('click', function () { setFilesOpen(false); });

// code editor
editorRun.addEventListener('click', runEditor);
editorSave.addEventListener('click', saveEditor);
editorFull.addEventListener('click', function () { editor.classList.toggle('full'); editorFocusCode(); });
editorClose.addEventListener('click', closeEditor);

// Drag the handle between code and output to resize the split (sets --out-h,
// the output row's height; the code row fills the rest).
(function () {
  var dragging = false;
  editorSplit.addEventListener('mousedown', function (e) {
    dragging = true;
    editorSplit.classList.add('dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var r = editorBox.getBoundingClientRect();
    var h = r.bottom - e.clientY;                 // output height, measured from the bottom
    h = Math.max(56, Math.min(r.height - 180, h)); // keep room for the code area
    editorBox.style.setProperty('--out-h', h + 'px');
  });
  document.addEventListener('mouseup', function () {
    if (!dragging) return;
    dragging = false;
    editorSplit.classList.remove('dragging');
    document.body.style.userSelect = '';
  });
})();
editor.addEventListener('click', function (e) { if (e.target === editor) closeEditor(); });
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && editor.style.display !== 'none') closeEditor();
});
editorCode.addEventListener('keydown', function (e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runEditor(); }
  else if (e.key === 'Tab') {
    e.preventDefault();
    var s = editorCode.selectionStart, en = editorCode.selectionEnd;
    editorCode.value = editorCode.value.slice(0, s) + '  ' + editorCode.value.slice(en);
    editorCode.selectionStart = editorCode.selectionEnd = s + 2;
  }
});

window.addEventListener('popstate', function () {
  currentSession = sessionFromPath();
  renderSessions();
  if (currentSession) loadHistory(currentSession); else clearMessages();
  refreshFiles(true);
});

currentSession = sessionFromPath();
loadInfo();
loadSessions();
if (currentSession) { loadHistory(currentSession); refreshFiles(true); }
input.focus();

// Warm CodeMirror in the background so the editor opens instantly on first click.
// On idle (or a short delay), so it never competes with the initial render.
if (window.requestIdleCallback) requestIdleCallback(loadCM, { timeout: 3000 });
else setTimeout(loadCM, 1500);
