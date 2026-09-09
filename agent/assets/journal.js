// journal.js — poll the journal and show it as lanes.
//
// The server hands back whole entries the page has not seen yet, keyed by how
// many have been logged.
//
// GROUPING IS STRUCTURAL AND KNOWS NOTHING. A record's `context` is its scope
// chain innermost-first, so reversed it is the path from the root. A LANE IS A
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
// The feed's URL comes from the page, because the driver decides where it
// mounted the viewer.

const EVENTS = (window.JOURNAL || {}).events || '/events';
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
  return html.length <= CLIP_CHARS
    ? html
    : `${body}<button class="more" data-key="${key}">${open ? 'less' : 'more'}</button>`;
}

// ---------------------------------------------------------------- rendering

// Anything that is not part of the envelope, as key/value pairs.
//
// A record of short scalars — a model call's provider and token counts — reads
// as one run rather than four stacked lines, which is most of the vertical space
// a busy journal wastes.
function fieldLines(e, skip) {
  const keys = Object.keys(e).filter(k => !ENVELOPE.includes(k) && !skip.includes(k));
  if (keys.length === 0) return '';

  const pair = k => {
    let v = e[k];
    if (v !== null && typeof v === 'object') v = JSON.stringify(v, null, 1);
    return [k, String(v)];
  };
  const pairs = keys.map(pair);
  const inline = pairs.every(([, v]) => v.length <= 40 && !v.includes('\n'));

  if (inline) {
    return `<div class="fields inline">`
      + pairs.map(([k, v]) => `<span class="pair"><span class="k">${esc(k)}</span> ${esc(v)}</span>`).join('')
      + `</div>`;
  }
  return pairs.map(([k, v]) => `<div class="fields"><span class="k">${esc(k)}</span> ${esc(v)}</div>`).join('');
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
      + fieldLines(e, ['role', 'text', 'calls']);
  }

  if (e.role === 'tool_results') {
    const each = (e.results || []).map(r =>
      `<div class="fields"><span class="k">${esc(r.id)}</span> ${esc(r.content)}</div>`).join('');
    return clip(`<div class="speech tool_results"><span class="role">results</span>${each}</div>`, key)
      + fieldLines(e, ['role', 'results']);
  }

  return clip(fieldLines(e, []), key) || '<span class="fields k">—</span>';
}

// -------------------------------------------------------------------- paths

// A record's path from the root. `context` is innermost-first (ContextLogger
// appends outward), so reversing it gives the enclosing scopes in order.
const pathOf = e => [...(e.context || [])].reverse();


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
  if (rest.length === 0) return '<span class="chips"></span>';

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
  const rows = matches
    .filter(({ e }) => within(pathOf(e), prefix))
    .map(({ e, i }) => row(e, i, key, prefix));

  const crumb = `<span class="all">${esc(prefix.length ? prefix[prefix.length - 1] : 'all')}</span>`;

  const shut = close
    ? `<button type="button" class="close" data-close="${close}" aria-label="Close this lane">✕</button>`
    : '';

  return `<section class="lane" style="${place}" data-path="${esc(JSON.stringify(prefix))}">`
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
  el.lanes.innerHTML = gap + `<div class="lanegrid" style="${cols}">${html.join('')}</div>`;

  if (el.follow.checked)
    for (const rows of el.lanes.querySelectorAll('.rows')) rows.scrollTop = rows.scrollHeight;
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
    const res = await fetch(EVENTS + (EVENTS.includes('?') ? '&' : '?') + 'seen=' + seen);
    const data = await res.json();

    if (data.seen < seen) {          // a different journal, or a restarted one
      entries = []; raws = []; seen = 0; dropped = 0;
      opened.clear(); expanded.clear(); branches = [];
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
