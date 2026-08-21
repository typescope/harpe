// journal.js — poll the journal and render it as turns.
//
// The server hands back whole entries the page has not seen yet, keyed by a
// line count. Everything here is presentation: grouping the flat stream into
// the turns a driver bracketed, and rendering each entry by what it carries.

const POLL_MS = 1000;
const CLIP_CHARS = 700;

const el = {
  log: document.getElementById('log'),
  dot: document.getElementById('dot'),
  counts: document.getElementById('counts'),
  status: document.getElementById('status'),
  filter: document.getElementById('filter'),
  turnsOnly: document.getElementById('turns'),
  follow: document.getElementById('follow'),
};

let seen = 0;
let entries = [];
let opened = new Set();   // indices whose clipped body the reader expanded

// ------------------------------------------------------------------ helpers

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = s => String(s).replace(/[&<>"]/g, c => ESC[c]);
const clock = t => (t || '').slice(11, 19) || '--:--:--';
const isTurn = e => (e.category || '').startsWith('harpe.turn.');

function severity(e) {
  if (e.error !== undefined) return 'err';
  if (e.warning !== undefined) return 'warn';
  return '';
}

// Which subsystem logged this, for colour. The category is a dotted,
// reverse-namespaced identifier, so its prefix is the grouping already.
function family(e) {
  const c = e.category || '';
  if (c.startsWith('harpe.turn.')) return 'fam-turn';
  if (c.startsWith('harpe.tools.')) return 'fam-tools';
  return 'fam-other';
}

function clip(html, i) {
  const open = opened.has(i);
  const body = `<span class="clip${open ? ' open' : ''}">${html}</span>`;
  return html.length <= CLIP_CHARS
    ? html
    : `${body}<button class="more" data-i="${i}">${open ? 'less' : 'more'}</button>`;
}

// ---------------------------------------------------------------- rendering

// Anything that is not `time` or `category`, as key/value pairs.
//
// A record of short scalars — a model call's provider and token counts — reads
// as one run rather than four stacked lines, which is most of the vertical space
// a busy journal wastes.
function fieldLines(e, skip) {
  const keys = Object.keys(e).filter(k => k !== 'time' && k !== 'category' && !skip.includes(k));
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

function body(e, i) {
  // A message entry leads with what was said; its structure follows.
  if (e.role === 'user' || e.role === 'assistant') {
    const calls = (e.calls || [])
      .map(c => `<span class="call">${esc(c.name)}</span>`)
      .join('');
    // No text but tool calls: the chips are the whole content, and an empty
    // speech block would be a tinted box saying nothing.
    const text = e.text
      ? clip(`<div class="speech ${e.role}"><span class="role">${e.role}</span>${esc(e.text)}</div>`, i)
      : (calls ? '' : `<div class="speech ${e.role}"><span class="role">${e.role}</span><span class="k">(no text)</span></div>`);
    return text
      + (calls ? `<div class="calls">${calls}</div>` : '')
      + fieldLines(e, ['role', 'text', 'calls']);
  }

  if (e.role === 'tool_results') {
    const each = (e.results || []).map(r =>
      `<div class="fields"><span class="k">${esc(r.id)}</span> ${esc(r.content)}</div>`).join('');
    return clip(`<div class="speech tool_results"><span class="role">results</span>${each}</div>`, i)
      + fieldLines(e, ['role', 'results']);
  }

  return clip(fieldLines(e, []), i) || '<span class="fields k">—</span>';
}

function row(e, i) {
  return `<div class="row ${family(e)} ${severity(e)}">`
    + `<span class="time">${esc(clock(e.time))}</span>`
    + `<span class="cat">${esc(e.category || '?')}</span>`
    + `<div class="body">${body(e, i)}</div>`
    + `</div>`;
}

// ------------------------------------------------------------------ turns

// Group the flat stream: a `harpe.turn.request` opens a turn, the matching
// response closes it, and anything outside a bracket is loose machinery.
function group(list) {
  const groups = [];
  let turn = null;

  for (const item of list) {
    const cat = item.e.category;
    if (cat === 'harpe.turn.request') {
      turn = { kind: 'turn', request: item.e, rows: [], outcome: 'running' };
      groups.push(turn);
    } else if (cat === 'harpe.turn.response' && turn) {
      turn.response = item.e;
      turn = null;
    } else if (turn) {
      if (cat === 'harpe.turn.answered') turn.outcome = 'answered';
      if (cat === 'harpe.turn.failed') turn.outcome = 'failed';
      if (cat === 'harpe.turn.interrupted') turn.outcome = 'interrupted';
      turn.rows.push(item);
    } else {
      const last = groups[groups.length - 1];
      if (last && last.kind === 'loose') last.rows.push(item);
      else groups.push({ kind: 'loose', rows: [item] });
    }
  }
  return groups;
}

function turnHead(g) {
  const data = (g.request || {}).data || {};
  const prompt = typeof data === 'object' ? (data.text || '') : String(data);
  const files = (data.files || []).length;
  const suffix = files ? ` <span class="badge">${files} file${files > 1 ? 's' : ''}</span>` : '';
  return `<div class="head">`
    + `<span class="time">${esc(clock(g.request.time))}</span>`
    + `<span class="prompt">${esc(prompt) || '<span class="k">(no text)</span>'}</span>`
    + suffix
    + `<span class="badge ${g.outcome}">${g.outcome}</span>`
    + `</div>`;
}

function render() {
  const q = el.filter.value.trim().toLowerCase();
  const wanted = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !q || JSON.stringify(e).toLowerCase().includes(q))
    .filter(({ e }) => !el.turnsOnly.checked || isTurn(e));

  el.counts.textContent = wanted.length === entries.length
    ? `${entries.length} entries`
    : `${wanted.length} of ${entries.length} entries`;

  if (wanted.length === 0) {
    el.log.innerHTML = `<p class="empty">${entries.length ? 'Nothing matches.' : 'Waiting for the first entry…'}</p>`;
    return;
  }

  el.log.innerHTML = group(wanted).map(g =>
    g.kind === 'turn'
      ? `<section class="turn ${g.outcome}">${turnHead(g)}${g.rows.map(r => row(r.e, r.i)).join('')}</section>`
      : `<section class="loose">${g.rows.map(r => row(r.e, r.i)).join('')}</section>`
  ).join('');

  if (el.follow.checked) window.scrollTo(0, document.body.scrollHeight);
}

// ------------------------------------------------------------------ polling

function setStatus(state, text) {
  el.dot.className = 'dot ' + state;
  el.status.textContent = text;
}

async function poll() {
  try {
    const res = await fetch('/events?seen=' + seen);
    const data = await res.json();

    if (data.seen < seen) {          // the journal was truncated or replaced
      entries = []; seen = 0; opened.clear();
      render();
    } else if (data.entries.length) {
      entries = entries.concat(data.entries);
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
el.turnsOnly.addEventListener('change', render);

el.log.addEventListener('click', ev => {
  const more = ev.target.closest('.more');
  if (!more) return;
  const i = Number(more.dataset.i);
  opened.has(i) ? opened.delete(i) : opened.add(i);
  render();
});

document.addEventListener('keydown', ev => {
  if (ev.target.tagName === 'INPUT') {
    if (ev.key === 'Escape') { ev.target.value = ''; ev.target.blur(); render(); }
    return;
  }
  if (ev.key === '/') { ev.preventDefault(); el.filter.focus(); }
  if (ev.key === 'f') { el.follow.checked = !el.follow.checked; render(); }
  if (ev.key === 't') { el.turnsOnly.checked = !el.turnsOnly.checked; render(); }
});

setStatus('', 'connecting');
poll();
