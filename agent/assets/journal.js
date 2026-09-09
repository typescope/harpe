// journal.js — poll the journal and show it as lanes.
//
// The server hands back whole entries the page has not seen yet, keyed by how
// many have been logged.
//
// GROUPING IS STRUCTURAL AND KNOWS NOTHING. A record's `context` IS its path
// from the root, outermost first. A LANE IS A
// PATH PREFIX: the leftmost lane is the empty prefix — every record, in arrival
// order — and clicking a scope opens the lane one level deeper. That is the
// whole model. No event name, no scope key and no record's position decides
// what a lane contains, so a producer can invent scopes forever and they nest
// correctly without this file learning about them.
//
// The knowledge that remains is PRESENTATION ONLY, and every bit of it falls
// back: `body` renders a message record as speech and anything else as its
// fields, and `family` tints by event prefix. Nothing here interprets a record
// to decide where it goes.
//
// The feed is this page's own URL with a `seen` cursor on it, so the driver
// mounts one path and the two ends agree on the rest between themselves.

const POLL_MS = 1000;
const CLIP_CHARS = 700;

const el = {
  lanes: document.getElementById('lanes'),
  raw: document.getElementById('raw'),
  rawEvent: document.getElementById('rawEvent'),
  rawScope: document.getElementById('rawScope'),
  rawBody: document.getElementById('rawBody'),
  rawClose: document.getElementById('rawClose'),
  dot: document.getElementById('dot'),
  counts: document.getElementById('counts'),
  status: document.getElementById('status'),
  filter: document.getElementById('filter'),
  follow: document.getElementById('follow'),
};

let seen = 0;
let dropped = 0;          // entries aged out of the server's tail, never seen here
let entries = [];
let raws = [];            // the same records as the server sent them, same indices
// Both are keyed by LANE AND ROW, not by row alone: one record appears in every
// lane along its path, and expanding it in one lane is not a statement about
// the others.
let opened = new Set();   // rows whose clipped body the reader expanded
let expanded = new Set(); // rows showing the rest of their path, not just its innermost
// Branches the reader FLIPPED from how they open by default — not the ones that
// happen to be open. A set of "opened" could not close a branch whose default is
// open, which is every outermost one.
let flipped = new Set();
// Branches the reader asked to see in full, past the first few.
let widened = new Set();

// Navigation state: the open branches, each a path from the root. They form a
// TREE, laid out as a grid — a branch is a row, a scope's depth is its column,
// and the root lane is column one spanning every row. Opening a context never
// closes another, so several deep contexts stay in view at once.
let branches = [];

// ------------------------------------------------------------------ helpers

const ENVELOPE = ['time', 'event', 'context'];

// A record arrives as a four-key envelope. Flatten its `fields` up so the rest
// of the viewer reads one plain object; the envelope wins a name clash, since
// this is display, not data.
const flatten = e => ({ ...(e.fields || {}), time: e.time, event: e.event, context: e.context || [] });

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = s => String(s).replace(/[&<>"]/g, c => ESC[c]);
const clock = t => (t || '').slice(11, 19) || '--:--:--';

function severity(e) {
  if (e.error !== undefined) return 'err';
  if (e.warning !== undefined) return 'warn';
  return '';
}

// Which subsystem logged this, for colour. The event name is a dotted,
// reverse-namespaced identifier, so its prefix is the grouping already.
function family(e) {
  const c = e.event || '';
  if (c.startsWith('harpe.turn.')) return 'fam-turn';
  if (c.startsWith('harpe.tools.')) return 'fam-tools';
  return 'fam-other';
}

function clip(html, key) {
  const open = opened.has(key);
  const body = `<span class="clip${open ? ' open' : ''}">${html}</span>`;
  // Measured on what is READ, not on the markup: a field tree carries a tag per
  // line, so by length of HTML a five-line tree looked longer than a wall of text.
  const text = html.replace(/<[^>]*>/g, '');
  return text.length <= CLIP_CHARS
    ? html
    : `${body}<button class="more" data-key="${key}">${open ? 'less' : 'more'}</button>`;
}

// ---------------------------------------------------------------- rendering

// Anything that is not part of the envelope, as key/value pairs.
//
// A record of short scalars — a model call's provider and token counts — reads
// as one run rather than four stacked lines, which is most of the vertical space
// a busy journal wastes.
// A field value may be a TREE — `Value` nests maps and lists — so it is drawn
// as one: a line per entry, indented by depth, with no braces or quotes to read
// past. As JSON text a small map and a deep tree looked the same and `clip` cut
// whichever it was mid-brace.
const isBranch = v => v !== null && typeof v === 'object';

const entriesOf = v => Array.isArray(v)
  ? v.map((item, i) => [String(i), item])
  : Object.entries(v);

// What a closed branch says about itself: enough to decide whether to open it.
const closedAs = v => Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).length}}`;

// How many lines a value would take fully open. Counting stops once the budget
// is passed, so a huge structure costs no more to reject than a small one.
function spread(value, budget) {
  if (!isBranch(value)) return 1;
  let n = 1;
  for (const [, child] of entriesOf(value)) {
    n += spread(child, budget - n);
    if (n > budget) return n;
  }
  return n;
}

// A branch opens by default while everything under it still fits in a few
// lines — the common shape is a handful of keys and short arrays, and making
// those click to open is friction for nothing. Size, not depth, decides: bulk
// is bulk wherever it sits.
const OPEN_LINES = 8;

// However a branch came to be open, only its first few entries are drawn. A
// long list is worth knowing about, not worth reading by default, and the count
// on the control says what asking for the rest costs.
const SHOW_MAX = 10;

// A long value is clipped WHERE IT IS, keyed by its own path. Clipping the
// record instead capped the whole block at one long leaf, hiding the branches
// beside it and the controls that fold them.
// A long value is bounded in the DOM, not merely hidden by CSS: emitting half a
// megabyte and capping its height still costs the page half a megabyte. Only
// what is shown is emitted, and the whole of it once the reader asks.
function clipText(text, at) {
  if (text.length <= CLIP_CHARS) return esc(text);
  const open = opened.has(at);
  return `<span class="clip${open ? ' open' : ''}">${esc(open ? text : text.slice(0, CLIP_CHARS))}</span>`
    + `<button class="more" data-key="${at}">${open ? 'less' : `more · ${text.length} chars`}</button>`;
}

// Draw at most `SHOW_MAX` of `items`, and a counted control for the rest. Every
// list of entries goes through here — a record's fields, a branch's children,
// a batch of tool results — so none can be drawn uncapped by omission.
function capped(items, at, depth, draw) {
  const all = widened.has(at);
  const shown = all ? items : items.slice(0, SHOW_MAX);
  const rest = items.length - shown.length;

  // The way back matters as much as the way in — at this level there may be no
  // branch to fold, so the control that opened the list is what closes it.
  const label = rest ? `… ${rest} more` : (all && items.length > SHOW_MAX ? 'less' : '');

  return shown.map(draw).join('')
    + (label
       ? `<div class="leaf" style="--d:${depth}">`
         + `<button type="button" class="wider" data-wider="${esc(at)}">${label}</button></div>`
       : '');
}

const keySpan = key =>
  key === null ? '' : `<span class="k" title="${esc(key)}">${esc(key)}</span> `;

const leafLine = (depth, key, value, at) =>
  `<div class="leaf" style="--d:${depth}">`
  + keySpan(key)
  + `<span class="v">${clipText(String(value), at)}</span></div>`;

function tree(value, key, path, rowKey, depth) {
  const at = `${rowKey}|${path}`;
  if (!isBranch(value)) return leafLine(depth, key, value, at);

  const kids = entriesOf(value);
  // Either way the reader's click flips it.
  const byDefault = spread(value, OPEN_LINES) <= OPEN_LINES;
  const open = flipped.has(at) ? !byDefault : byDefault;

  const head = `<div class="leaf" style="--d:${depth}">`
    + `<button type="button" class="fold" data-fold="${esc(at)}">${open ? '▾' : '▸'}</button>`
    + keySpan(key)
    + `<span class="brief">${esc(closedAs(value))}</span></div>`;

  if (!open) return head;

  return head + capped(kids, at, depth + 1,
    ([k, v]) => tree(v, k, `${path}.${k}`, rowKey, depth + 1));
}

function fieldLines(e, skip, rowKey) {
  const keys = Object.keys(e).filter(k => !ENVELOPE.includes(k) && !skip.includes(k));
  if (keys.length === 0) return '';

  // The compact form, for a record whose fields are all short scalars — most of
  // them, and a run of them reads better than a stack.
  const short = k => !isBranch(e[k]) && String(e[k]).length <= 40 && !String(e[k]).includes('\n');
  if (keys.length <= SHOW_MAX && keys.every(short)) {
    return `<div class="fields inline">`
      + keys.map(k => `<span class="pair">${keySpan(k)}${esc(String(e[k]))}</span>`).join('')
      + `</div>`;
  }

  return `<div class="fields">`
    + capped(keys, rowKey, 0, k => tree(e[k], k, k, rowKey, 0))
    + `</div>`;
}

function body(e, key) {
  // A message entry leads with what was said; its structure follows.
  if (e.role === 'user' || e.role === 'assistant') {
    const calls = (e.calls || [])
      .map(c => `<span class="call">${esc(c.name)}</span>`)
      .join('');
    // No text but tool calls: the chips are the whole content, and an empty
    // speech block would be a tinted box saying nothing.
    const text = e.text
      ? clip(`<div class="speech ${e.role}"><span class="role">${e.role}</span>${esc(e.text)}</div>`, key)
      : (calls ? '' : `<div class="speech ${e.role}"><span class="role">${e.role}</span><span class="k">(no text)</span></div>`);
    return text
      + (calls ? `<div class="calls">${calls}</div>` : '')
      + fieldLines(e, ['role', 'text', 'calls'], key);
  }

  if (e.role === 'tool_results') {
    const each = capped(e.results || [], `${key}|results`, 0, r =>
      `<div class="fields"><span class="k">${esc(r.id)}</span> ${esc(r.content)}</div>`);
    return clip(`<div class="speech tool_results"><span class="role">results</span>${each}</div>`, key)
      + fieldLines(e, ['role', 'results'], key);
  }

  // No clip around the whole block: its leaves clip themselves, and its branches
  // fold, so both are bounded at the place the reader is looking.
  return fieldLines(e, [], key) || '<span class="fields k">—</span>';
}

// -------------------------------------------------------------------- paths

// A record's path from the root. `context` is already in that order —
// outermost first — so the left-to-right of the lanes is the order the scopes
// were entered.
const pathOf = e => e.context || [];


// Is `path` inside `prefix`? A lane holds a scope's records AND everything
// nested under it, which is what "all of this context" means. A scope is a
// string identity, so comparing scopes is comparing strings.
const within = (path, prefix) => prefix.every((s, i) => path[i] === s);

// ---------------------------------------------------------------- the lanes

// Reveals on hover (and on keyboard focus): the record behind this line. The
// braces carry an ellipsis because an empty pair reads as nothing to open.
const rawButton = i =>
  `<button type="button" class="raw" data-raw="${i}" title="Raw entry" aria-label="Show raw entry">{...}</button>`;

// The chips a row offers, RELATIVE TO ITS LANE: a lane is already its prefix, so
// repeating it on every row says nothing. Only what the record adds below the
// lane shows, collapsed to the innermost because a deep path on every line
// buries the log it annotates. Each chip drills to the prefix ending at it.
function chips(e, i, key, prefix) {
  const rest = pathOf(e).slice(prefix.length);
  if (rest.length === 0) return '';

  const open = expanded.has(key);
  const shown = open ? rest : rest.slice(-1);
  const from = prefix.length + (open ? 0 : rest.length - 1);

  const each = shown.map((scope, n) =>
    `<button type="button" class="chip" data-depth="${from + n + 1}" data-row="${i}"`
    + ` title="Show only this context">${esc(scope)}</button>`).join('<span class="sep">›</span>');

  const caret = rest.length > 1
    ? `<button type="button" class="caret" data-key="${key}" aria-label="Show the rest of the path">${open ? '‹' : '▾'}</button>`
    : '';
  return `<span class="chips">${each}${caret}</span>`;
}

function row(e, i, lane, prefix) {
  const key = `${lane}:${i}`;
  return `<div class="row ${family(e)} ${severity(e)}">`
    + `<span class="time">${esc(clock(e.time))}</span>`
    + `<span class="cat">${esc(e.event || '?')}</span>`
    + `<div class="body">${body(e, key)}</div>`
    + chips(e, i, key, prefix)
    + rawButton(i)
    + `</div>`;
}

// One lane: every record within `prefix`, in arrival order. `place` is its grid
// position, and `key` scopes this lane's own expand/collapse state.
function laneHtml(prefix, key, place, close, matches) {
  const depth = prefix.length;
  const rows = matches
    .filter(({ e }) => within(pathOf(e), prefix))
    .map(({ e, i }) => row(e, i, key, prefix));

  const crumb = `<span class="all">${esc(prefix.length ? prefix[prefix.length - 1] : 'all')}</span>`;

  const shut = close
    ? `<button type="button" class="close" data-close="${close}" aria-label="Close this lane">✕</button>`
    : '';

  return `<section class="lane" style="${place} --lane-depth: ${depth};" data-path="${esc(JSON.stringify(prefix))}">`
    + `<header class="lanehead">${crumb}<span class="n">${rows.length}</span>${shut}</header>`
    + `<div class="rows">${rows.join('') || '<p class="empty">Nothing here.</p>'}</div>`
    + `</section>`;
}

function render() {
  const q = el.filter.value.trim().toLowerCase();
  const matches = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !q || JSON.stringify(e).toLowerCase().includes(q));

  el.counts.textContent = matches.length === entries.length
    ? `${entries.length} entries`
    : `${matches.length} of ${entries.length} entries`;

  // The tail the server keeps is bounded, so say so rather than presenting
  // what survived as the whole journal.
  const gap = dropped
    ? `<p class="gap">${dropped} earlier ${dropped === 1 ? 'entry' : 'entries'} aged out of the journal</p>`
    : '';

  if (entries.length === 0) {
    el.lanes.innerHTML = gap + '<p class="placeholder">Waiting for the first entry…</p>';
    return;
  }

  // The grid: one column per depth, one row per branch, the root spanning them
  // all. A branch's last lane runs to the right edge, since nothing deeper in
  // that row is claiming the space.
  const depth = branches.reduce((n, b) => Math.max(n, b.length), 0);
  const rows = Math.max(branches.length, 1);

  const html = [laneHtml([], 'root', `grid-column: 1 / ${depth ? 2 : -1}; grid-row: 1 / span ${rows};`, '', matches)];

  branches.forEach((path, b) => {
    path.forEach((_, d) => {
      const last = d === path.length - 1;
      const col = `grid-column: ${d + 2} / ${last ? -1 : d + 3}; grid-row: ${b + 1};`;
      html.push(laneHtml(path.slice(0, d + 1), `${b}.${d}`, col, `${b}.${d}`, matches));
    });
  });

  const cols = `grid-template-columns: ${depth ? 'minmax(240px, 0.9fr) ' : ''}repeat(${depth || 1}, minmax(240px, 1fr));`;
  const before = scrollOf(el.lanes);
  el.lanes.innerHTML = gap + `<div class="lanegrid" style="${cols}">${html.join('')}</div>`;
  restoreScroll(before);
}

// Where each lane was scrolled, keyed by the path it shows. A render replaces
// the whole grid, so without this every poll would drop the reader wherever the
// browser lands — which is what made `follow` re-scroll a lane a second after
// they scrolled it themselves.
function scrollOf(root) {
  const state = new Map();
  for (const lane of root.querySelectorAll('.lane')) {
    const rows = lane.querySelector('.rows');
    if (rows) state.set(lane.dataset.path, {
      top: rows.scrollTop,
      atEnd: rows.scrollHeight - rows.clientHeight - rows.scrollTop <= 8,
    });
  }
  return state;
}

function restoreScroll(state) {
  for (const lane of el.lanes.querySelectorAll('.lane')) {
    const rows = lane.querySelector('.rows');
    if (!rows) continue;
    const was = state.get(lane.dataset.path);

    // A lane that was not there a moment ago was just opened, so it shows the
    // START of the context asked for. Only the root, which is a live tail
    // rather than a context, opens at the newest record.
    if (!was) {
      if (el.follow.checked && lane.dataset.path === '[]') rows.scrollTop = rows.scrollHeight;
      continue;
    }

    // Following means keeping up with the end, not dragging the reader there:
    // a lane they scrolled back through keeps its place.
    rows.scrollTop = was.atEnd && el.follow.checked ? rows.scrollHeight : was.top;
  }
}

// Open the context this chip names. Opening NEVER closes anything: a path that
// extends an open branch grows that branch rightward, and one that does not
// starts a branch of its own on a new row.
function drill(rowIndex, depth) {
  const path = pathOf(entries[rowIndex]).slice(0, depth);

  // Already on screen: say where it is rather than opening it twice.
  const existing = el.lanes.querySelector(`.lane[data-path='${JSON.stringify(path).replace(/'/g, "\\'")}']`);
  if (existing) { flash(existing); return; }

  // The deepest open branch this path continues, if any.
  let host = -1;
  branches.forEach((b, n) => {
    if (b.length < path.length && within(path, b) && (host < 0 || b.length > branches[host].length)) host = n;
  });

  if (host >= 0) branches[host] = path;
  else branches.push(path);
  render();
}

// Bring an already-open lane into view and mark it, so a second click on a chip
// answers "it is over there" instead of doing nothing.
function flash(lane) {
  lane.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  lane.classList.remove('flash');
  void lane.offsetWidth;              // restart the animation if it is still running
  lane.classList.add('flash');
  setTimeout(() => lane.classList.remove('flash'), 1200);
}

// ------------------------------------------------------------------ polling

function setStatus(state, text) {
  el.dot.className = 'dot ' + state;
  el.status.textContent = text;
}

async function poll() {
  try {
    const res = await fetch(location.pathname + '?seen=' + seen);
    const data = await res.json();

    if (data.seen < seen) {          // a different journal, or a restarted one
      entries = []; raws = []; seen = 0; dropped = 0;
      opened.clear(); expanded.clear(); flipped.clear(); widened.clear(); branches = [];
      render();
    } else if (data.entries.length) {
      entries = entries.concat(data.entries.map(flatten));
      raws = raws.concat(data.entries);
      dropped += data.dropped || 0;
      seen = data.seen;
      render();
    }
    setStatus('live', 'live');
  } catch (err) {
    setStatus('down', 'server unreachable');
  }
  setTimeout(poll, POLL_MS);
}

// ------------------------------------------------------------------- events

el.filter.addEventListener('input', render);

el.lanes.addEventListener('click', ev => {
  const chip = ev.target.closest('.chip');
  if (chip) { drill(Number(chip.dataset.row), Number(chip.dataset.depth)); return; }

  const caret = ev.target.closest('.caret');
  if (caret) {
    const key = caret.dataset.key;
    expanded.has(key) ? expanded.delete(key) : expanded.add(key);
    render();
    return;
  }

  // Closing a lane closes what is to its right in the same branch, and drops
  // the branch when nothing of it is left.
  const close = ev.target.closest('.close');
  if (close) {
    const [b, d] = close.dataset.close.split('.').map(Number);
    branches[b] = branches[b].slice(0, d);
    branches = branches.filter(path => path.length > 0);
    render();
    return;
  }

  const raw = ev.target.closest('.raw');
  if (raw) { showRaw(Number(raw.dataset.raw)); return; }

  const fold = ev.target.closest('.fold');
  if (fold) {
    const at = fold.dataset.fold;
    flipped.has(at) ? flipped.delete(at) : flipped.add(at);
    render();
    return;
  }

  const wider = ev.target.closest('.wider');
  if (wider) {
    const at = wider.dataset.wider;
    widened.has(at) ? widened.delete(at) : widened.add(at);
    render();
    return;
  }

  const more = ev.target.closest('.more');
  if (!more) return;
  const key = more.dataset.key;
  opened.has(key) ? opened.delete(key) : opened.add(key);
  render();
});

// The record as the server sent it, plus the path it sits at — which is the
// whole of what decides which lanes it appears in.
function showRaw(i) {
  const record = raws[i];
  if (!record) return;

  const path = pathOf(record);
  el.rawEvent.textContent = record.event || '?';
  el.rawScope.textContent = path.length ? path.join('  ›  ') : 'no context';
  el.rawBody.textContent = JSON.stringify(record, null, 2);
  el.raw.showModal();
}

el.rawClose.addEventListener('click', () => el.raw.close());

// Clicking the backdrop closes it: the dialog fills its own box, so a click
// landing on the element itself landed outside the content.
el.raw.addEventListener('click', ev => { if (ev.target === el.raw) el.raw.close(); });

document.addEventListener('keydown', ev => {
  if (el.raw.open) return;          // the dialog handles its own keys
  if (ev.target.tagName === 'INPUT') {
    if (ev.key === 'Escape') { ev.target.value = ''; ev.target.blur(); render(); }
    return;
  }
  if (ev.key === '/') { ev.preventDefault(); el.filter.focus(); }
  if (ev.key === 'f') { el.follow.checked = !el.follow.checked; render(); }
  // Escape closes the most recently opened lane, so drilling in stays reversible.
  if (ev.key === 'Escape' && branches.length) {
    const last = branches.length - 1;
    branches[last] = branches[last].slice(0, -1);
    branches = branches.filter(path => path.length > 0);
    render();
  }
});

setStatus('', 'connecting');
poll();
