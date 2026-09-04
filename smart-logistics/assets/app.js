// Smart Logistics — depot planner UI.
//
// One document, several sections; the hash chooses which is visible, so every
// page is a link, the back button works, and a reload comes back where it left
// off. All data lives on the server: every mutation posts, then refresh()
// re-reads and re-renders. No inline event handlers anywhere — the page is
// served under a Content-Security-Policy that forbids them, so clicks are
// delegated from data-act attributes at the bottom of this file.

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let state = {
  products: [], suppliers: [], checks: [], drafts: [],
  warnings: [], runs: [], movements: [], summary: {}
};

// What the reader has done to the view, as opposed to what the depot holds.
// Kept apart from state so a refresh never throws it away.
const ui = {
  page: 'stock',
  confirm: null,          // { act, id, status } — an irreversible action, asked once
  receive: null,          // { id, amounts, note } — a delivery being counted in
  openRuns: new Set(),
  showDecided: false,
  movementFilter: 0,
  skill: { loaded: '', dirty: false, pending: '' }
};

/* Helpers ------------------------------------------------------------------ */

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!response.ok) throw Error(await refusal(response));
  return response.json();
}

// A refused write says why, as JSON. Anything else that goes wrong does not,
// and there is nothing useful to quote from it — so the reader is told that
// plainly rather than shown a page of server text.
async function refusal(response) {
  const body = await response.text();
  try {
    const reason = JSON.parse(body).error;
    if (reason) return reason;
  } catch { /* not a refusal we can read */ }
  return 'the depot could not complete that';
}

const post = (path, data) => api(path, { method: 'POST', body: JSON.stringify(data) });

const money = (cents, currency = 'CHF') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// SQLite writes UTC without a zone marker; say so before parsing.
const stamp = value => Date.parse(value.replace(' ', 'T') + 'Z');

const FULL_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function ago(value) {
  const minutes = Math.round((Date.now() - stamp(value)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${plural(hours, 'hour')} ago`;
  return `${plural(Math.round(hours / 24), 'day')} ago`;
}

// One way of saying when, everywhere: recent times read as a distance, older
// ones as a date, and the exact stamp is always a hover away.
function timeHtml(value, className = '') {
  if (!value) return '<span class="muted">—</span>';
  const at = stamp(value);
  const recent = Date.now() - at < 7 * 86400000;
  return `<time class="${className}" datetime="${escapeHtml(value)}" title="${escapeHtml(FULL_DATE.format(at))}">`
    + `${escapeHtml(recent ? ago(value) : FULL_DATE.format(at))}</time>`;
}

let toastTimer = 0;
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 4000);
}

const showError = (selector, message) => {
  const element = $(selector);
  element.textContent = message;
  element.hidden = false;
};
const clearError = selector => {
  const element = $(selector);
  element.textContent = '';
  element.hidden = true;
};

// One rule for whether a product is in trouble — what is left will not outlast
// the wait for a delivery — read by the headline, the nav count and the row, so
// they cannot say different things about the same product.
const AGENT_NAME = { plan: 'Planner', watch: 'Watcher' };
const RUN_STATUS = { running: 'Running', success: 'Finished', error: 'Failed' };

const NO_DEMAND = 999;
function risk(product) {
  if (product.days_of_cover === NO_DEMAND) return { tone: 'fine', label: 'no demand' };
  if (product.days_of_cover < product.lead_time_days) return { tone: 'critical', label: 'short' };
  if (product.days_of_cover < product.lead_time_days + 5) return { tone: 'soon', label: 'tight' };
  return { tone: 'fine', label: 'covered' };
}
const atRisk = () => state.products.filter(p => p.enabled && risk(p).tone === 'critical');
// Where an order is in its life. Outstanding means the supplier still owes us
// something on it, which is exactly what counts towards cover.
const OUTSTANDING = ['ordered', 'part_received'];
const pendingDrafts = () => state.drafts.filter(order => order.status === 'draft');
const inTransit = () => state.drafts.filter(order => OUTSTANDING.includes(order.status));
const closedOrders = () => state.drafts.filter(
  order => order.status !== 'draft' && !OUTSTANDING.includes(order.status));

const STATUS_LABEL = {
  ordered: 'on order', part_received: 'part delivered',
  received: 'delivered', rejected: 'rejected', cancelled: 'cancelled'
};

/* Routing ------------------------------------------------------------------ */

const PAGES = {
  stock: 'Stock', orders: 'Orders', agents: 'Agents', checks: 'Checks',
  movements: 'Movements', suppliers: 'Suppliers', skills: 'Skills'
};

let routed = false;

function showPage() {
  const key = location.hash.replace(/^#\/?/, '');
  ui.page = PAGES[key] ? key : 'stock';
  $$('.page').forEach(section => section.classList.toggle('active', section.id === ui.page));
  $$('#nav a').forEach(link => {
    if (link.dataset.page === ui.page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = `${PAGES[ui.page]} · Smart Logistics`;
  if (ui.page === 'skills') loadSkills();
  // Moving the reader's focus to the new heading, but only when they navigated
  // — not on the first paint, where focus belongs at the top of the document.
  if (routed) {
    const heading = $(`#${ui.page} h1`);
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }
  routed = true;
}

window.addEventListener('hashchange', showPage);

/* Loading ------------------------------------------------------------------ */

const loadingRow = columns =>
  `<tr class="empty-row"><td colspan="${columns}">Loading…</td></tr>`;

function renderLoading() {
  $('#product-rows').innerHTML = loadingRow(6);
  $('#movement-rows').innerHTML = loadingRow(6);
  $('#supplier-rows').innerHTML = loadingRow(6);
}

async function refresh() {
  const movementsPath = ui.movementFilter
    ? `/api/movements?product_id=${ui.movementFilter}` : '/api/movements';
  const [snapshot, warnings, checks, drafts, runs, movements] = await Promise.all([
    api('/api/snapshot'), api('/api/warnings'), api('/api/checks'),
    api('/api/drafts'), api('/api/runs'), api(movementsPath)
  ]);
  state = {
    ...snapshot,
    warnings: warnings.warnings,
    checks: checks.checks,
    drafts: drafts.drafts,
    runs: runs.runs,
    movements: movements.movements
  };
  render();
}

function render() {
  renderStatus();
  renderCounts();
  renderLive();
  renderWarnings();
  renderProducts();
  renderDrafts();
  renderChecks();
  renderMovements();
  renderSuppliers();
  renderAgents();
  renderRuns();
  adoptRunningRun();
}

/* The problem, and what is waiting ----------------------------------------- */

function renderStatus() {
  const risky = atRisk();
  $('#status').classList.toggle('clear', risky.length === 0);
  $('#headline').textContent = risky.length === 0
    ? 'Every product has enough cover to outlast its delivery time.'
    : `${plural(risky.length, 'product')} will run out before a delivery could arrive.`;

  // Say which ones, so the sentence and the table are about the same thing.
  const names = risky.slice(0, 3).map(product => product.name);
  const rest = risky.length - names.length;
  $('#headline-detail').textContent = risky.length
    ? names.join(', ') + (rest > 0 ? `, and ${rest} more` : '')
    : '';

  const checked = state.summary.last_checked;
  $('#checked').innerHTML = checked
    ? `The watcher last checked ${timeHtml(checked)}.`
    : 'The watcher has not checked yet.';

  $('#banner-action').innerHTML = nextStep();
  syncTriggers();
}

// The banner carries one action: whatever the depot actually needs next. A
// product that is short but already covered by a draft does not need planning
// again — it needs someone to look at the draft. When there is nothing to
// answer, the banner says so and offers nothing; both agents keep a permanent
// home on the Agents page.
function nextStep() {
  const drafted = new Set();
  for (const draft of pendingDrafts()) {
    for (const line of draft.lines) drafted.add(line.product_id);
  }
  const unplanned = atRisk().filter(product => !drafted.has(product.id));
  if (unplanned.length) return triggerHtml('plan');
  const waiting = pendingDrafts().length;
  if (waiting) {
    return `<a class="button primary" href="#/orders">Review ${plural(waiting, 'order')} →</a>`;
  }
  return '';
}

function setCount(key, value, noun, tone = '') {
  const element = $(`[data-count="${key}"]`);
  element.className = `count ${tone}`.trim();
  element.textContent = value ? String(value) : '';
  if (value) element.setAttribute('aria-label', `${value} ${noun}`);
  else element.removeAttribute('aria-label');
}

function renderCounts() {
  const risky = atRisk().length;
  setCount('stock', risky, 'products short of cover', risky ? 'critical' : '');
  setCount('orders', pendingDrafts().length, 'orders waiting for review');
  setCount('checks', state.checks.filter(check => check.enabled).length, 'active checks');
  const running = state.runs.filter(run => run.status === 'running').length;
  setCount('agents', running, 'runs in progress', 'busy');
}

function renderWarnings() {
  $('#warnings').innerHTML = state.warnings.map(warning => `
    <div class="warning ${escapeHtml(warning.severity)}">
      <span class="pill ${escapeHtml(warning.severity)}">${escapeHtml(warning.severity)}</span>
      <div class="body">
        <div><strong>${escapeHtml(warning.product_name)}</strong> — ${escapeHtml(warning.text)}</div>
        ${warning.check_text
          ? `<div class="from-check">Check: ${escapeHtml(warning.check_text)}</div>`
          : ''}
      </div>
      <span class="muted">${timeHtml(warning.last_seen)}</span>
    </div>`).join('');
}

/* Stock -------------------------------------------------------------------- */

function renderProducts() {
  $('#product-rows').innerHTML = state.products.map(product => {
    const preferred = product.sources.find(source => source.preferred) ?? product.sources[0];
    const others = product.sources.length - 1;
    const standing = risk(product);
    const onOrder = product.on_order ? `<div class="sub">${product.on_order} on order</div>` : '';
    return `
      <tr class="${standing.tone === 'critical' ? 'at-risk' : ''}">
        <td data-label="Product">
          <div>
            <div class="sku">${escapeHtml(product.name)}</div>
            <div class="sub">${escapeHtml(product.sku)} · ${escapeHtml(product.category)}</div>
          </div>
        </td>
        <td class="num" data-label="In stock"><div>${product.on_hand}${onOrder}</div></td>
        <td class="num" data-label="Sells/day"><div>${product.sells_per_day}</div></td>
        <td class="num" data-label="Days left">
          <div>
            <div class="days ${standing.tone}">${product.days_of_cover === NO_DEMAND ? '—' : product.days_of_cover}</div>
            ${standing.tone === 'fine' ? '' : `<div class="days-tag ${standing.tone}">${standing.label}</div>`}
            <div class="days-note">delivery takes ${product.lead_time_days}d</div>
          </div>
        </td>
        <td data-label="Supplier">
          <div>
            <div class="source-line">${escapeHtml(preferred ? preferred.supplier_name : '—')}</div>
            ${others > 0 ? `<div class="sub">${plural(others, 'other source')}</div>` : ''}
          </div>
        </td>
        <td class="actions-cell">
          <button data-act="edit-product" data-id="${product.id}">Edit</button>
          <button data-act="move" data-id="${product.id}">Movement</button>
        </td>
      </tr>`;
  }).join('') || '<tr class="empty-row"><td colspan="6">No products yet. Add one to get started.</td></tr>';
}

/* Orders to review --------------------------------------------------------- */

// Accepting is not reversible from this page, so it asks once, in place, and
// says what it means rather than relying on the reader to know.
const CONFIRM_COPY = {
  accepted: {
    question: 'Accept this order? The units count as on order from now on, and this cannot be undone here.',
    verb: 'Accept order'
  },
  rejected: {
    question: 'Reject this order? The draft is closed for good.',
    verb: 'Reject order'
  },
  cancelled: {
    question: 'Cancel this order? Anything already delivered stays in stock; the rest stops counting towards cover.',
    verb: 'Cancel order'
  }
};

const lineHtml = (order, line) => `
  <li>
    <span>${escapeHtml(line.sku)} — ${escapeHtml(line.name)}</span>
    <span class="qty">${line.quantity} × ${money(line.unit_price_cents, order.currency)}</span>
  </li>`;

// On an order that is out with a supplier, the quantity that matters is what
// has not turned up yet — so the line says what has arrived of what was asked.
const transitLineHtml = line => `
  <li>
    <span>${escapeHtml(line.sku)} — ${escapeHtml(line.name)}</span>
    <span class="qty ${line.outstanding_quantity ? '' : 'done'}">
      ${line.received_quantity} of ${line.quantity} delivered
    </span>
  </li>`;

const confirmHtml = (order, scope) => {
  const asking = ui.confirm && ui.confirm.act === scope && ui.confirm.id === order.id;
  if (!asking) return '';
  const copy = CONFIRM_COPY[ui.confirm.status];
  return `
    <div class="confirm">
      <p>${escapeHtml(copy.question)}</p>
      <button class="primary" data-act="draft-status" data-id="${order.id}" data-status="${ui.confirm.status}">${copy.verb}</button>
      <button data-act="cancel-ask">Cancel</button>
    </div>`;
};

const cardHead = (order, pill) => `
  <div class="card-head">
    <div>
      <strong>#${order.id} · ${escapeHtml(order.supplier_name)}</strong>
      <div class="muted">${timeHtml(order.created_at)} · ${money(order.total_cents, order.currency)}</div>
    </div>
    ${pill}
  </div>`;

/* A proposal, waiting for a person ----------------------------------------- */

function draftCard(order) {
  const asking = ui.confirm && ui.confirm.act === 'draft' && ui.confirm.id === order.id;
  // While the question is on screen it is the only thing to answer: the buttons
  // that raised it step aside rather than sitting above their own confirmation.
  const decide = asking ? '' : `
    <button class="primary" data-act="ask" data-scope="draft" data-id="${order.id}" data-status="accepted">Accept</button>
    <button data-act="ask" data-scope="draft" data-id="${order.id}" data-status="rejected">Reject</button>`;

  return `
    <article class="card">
      ${cardHead(order, '')}
      <p>${escapeHtml(order.rationale)}</p>
      <ul class="lines">${order.lines.map(line => lineHtml(order, line)).join('')}</ul>
      <div class="actions">
        ${decide}
        <button data-act="export" data-id="${order.id}">View as JSON</button>
      </div>
      ${confirmHtml(order, 'draft')}
    </article>`;
}

/* Placed, and not yet here -------------------------------------------------- */

// When it is due, and whether that has already passed. An order placed before
// this app recorded due dates has none, and says so rather than inventing one.
function dueHtml(order) {
  if (!order.expected_at) return '<span class="muted">no delivery date recorded</span>';
  const days = Math.round((stamp(order.expected_at + ' 00:00:00') - Date.now()) / 86400000);
  if (order.overdue) return `<span class="late">late — due ${plural(Math.abs(days), 'day')} ago</span>`;
  if (days <= 0) return '<span class="due">due today</span>';
  return `<span class="due">due in ${plural(days, 'day')}</span>`;
}

function transitCard(order) {
  const receiving = ui.receive && ui.receive.id === order.id;
  const asking = ui.confirm && ui.confirm.act === 'transit' && ui.confirm.id === order.id;
  const actions = receiving || asking ? '' : `
    <button class="primary" data-act="open-receive" data-id="${order.id}">Record delivery</button>
    <button data-act="ask" data-scope="transit" data-id="${order.id}" data-status="cancelled">Cancel order</button>
    <button data-act="export" data-id="${order.id}">View as JSON</button>`;

  return `
    <article class="card ${order.overdue ? 'overdue' : ''}">
      ${cardHead(order, `<span class="pill ${escapeHtml(order.status)}">${STATUS_LABEL[order.status]}</span>`)}
      <p class="due-line">${dueHtml(order)}</p>
      <ul class="lines">${order.lines.map(transitLineHtml).join('')}</ul>
      <div class="actions">${actions}</div>
      ${receiving ? receiveForm(order) : ''}
      ${confirmHtml(order, 'transit')}
    </article>`;
}

// Counting a delivery in. Every outstanding line is offered, filled in with
// what is still owed, because a delivery that matches the order is the common
// case and should need no typing at all. What the reader types is kept in `ui`
// so a refresh underneath them does not empty the boxes.
function receiveForm(order) {
  const owed = order.lines.filter(line => line.outstanding_quantity > 0);
  const rows = owed.map(line => `
    <label class="receive-row">
      <span class="receive-name">${escapeHtml(line.sku)} — ${escapeHtml(line.name)}</span>
      <input type="number" min="0" max="${line.outstanding_quantity}" step="1"
             data-receive-line="${line.id}" aria-label="Delivered of ${escapeHtml(line.sku)}"
             value="${escapeHtml(ui.receive.amounts[line.id] ?? line.outstanding_quantity)}">
      <span class="muted">of ${line.outstanding_quantity} owed</span>
    </label>`).join('');

  return `
    <div class="confirm receive">
      <p>What arrived? Anything short of the full amount stays on order.</p>
      ${rows}
      <label class="receive-row">
        <span class="receive-name">Note</span>
        <input type="text" data-receive-note placeholder="Delivery note, damage, anything worth keeping"
               aria-label="Note" value="${escapeHtml(ui.receive.note)}">
      </label>
      <p id="receive-error" class="form-error" hidden></p>
      <div class="actions">
        <button class="primary" data-act="receive" data-id="${order.id}">Book into stock</button>
        <button data-act="cancel-receive">Cancel</button>
      </div>
    </div>`;
}

/* Done with, one way or another --------------------------------------------- */

function closedCard(order) {
  const delivered = order.receipts.reduce((total, receipt) => total + receipt.quantity, 0);
  return `
    <article class="card settled">
      ${cardHead(order, `<span class="pill ${escapeHtml(order.status)}">${STATUS_LABEL[order.status]}</span>`)}
      <ul class="lines">${order.lines.map(transitLineHtml).join('')}</ul>
      <div class="actions">
        ${delivered ? `<span class="muted">${plural(delivered, 'unit')} went into stock</span>` : ''}
        <button data-act="export" data-id="${order.id}">View as JSON</button>
      </div>
    </article>`;
}

function renderDrafts() {
  const waiting = pendingDrafts();
  const coming = inTransit();
  const closed = closedOrders();

  $('#waiting-title').textContent = waiting.length
    ? `Waiting for you (${waiting.length})` : 'Waiting for you';
  $('#draft-list').innerHTML = waiting.map(draftCard).join('')
    || '<p class="empty">Nothing waiting. Press <b>Plan orders</b> to prepare some.</p>';

  const late = coming.filter(order => order.overdue).length;
  $('#in-transit').innerHTML = coming.length ? `
    <h2 class="group-title">
      On order (${coming.length})
      ${late ? `<span class="late">${late} late</span>` : ''}
    </h2>
    <div class="cards">${coming.map(transitCard).join('')}</div>` : '';

  $('#decided').innerHTML = closed.length ? `
    <h2 class="group-title">
      Closed (${closed.length})
      <button class="ghost" data-act="toggle-decided">${ui.showDecided ? 'Hide' : 'Show'}</button>
    </h2>
    ${ui.showDecided ? `<div class="cards">${closed.map(closedCard).join('')}</div>` : ''}` : '';
}

/* Checks ------------------------------------------------------------------- */

function renderChecks() {
  $('#check-list').innerHTML = state.checks.map(check => {
    const asking = ui.confirm && ui.confirm.act === 'check' && ui.confirm.id === check.id;
    const confirm = asking ? `
      <div class="confirm">
        <p>Delete this check? Both agents stop reading it, and the wording is not kept.</p>
        <button class="primary" data-act="delete-check" data-id="${check.id}">Delete check</button>
        <button data-act="cancel-ask">Cancel</button>
      </div>` : '';
    return `
      <article class="card">
        <div class="card-head">
          <p class="check-text">${escapeHtml(check.text)}</p>
          <span class="pill ${check.enabled ? 'enabled' : 'off'}">${check.enabled ? 'Active' : 'Off'}</span>
        </div>
        ${asking ? '' : `
        <div class="actions">
          <button data-act="edit-check" data-id="${check.id}">Edit</button>
          <button data-act="toggle-check" data-id="${check.id}">${check.enabled ? 'Turn off' : 'Turn on'}</button>
          <button class="danger" data-act="ask" data-scope="check" data-id="${check.id}">Delete</button>
        </div>`}
        ${confirm}
      </article>`;
  }).join('') || '<p class="empty">No checks yet. Add one in plain English.</p>';
}

/* Records ------------------------------------------------------------------ */

const MOVEMENT_KIND = {
  issue: 'Issue — shipped out',
  receipt: 'Receipt — arrived',
  adjustment: 'Adjustment — correction'
};

function renderMovements() {
  const filter = $('#movement-filter');
  filter.innerHTML = '<option value="0">All products</option>'
    + state.products.map(product =>
      `<option value="${product.id}">${escapeHtml(product.sku)} — ${escapeHtml(product.name)}</option>`).join('');
  filter.value = String(ui.movementFilter);

  // The endpoint returns at most 100 rows, so the page says so rather than
  // presenting a truncated ledger as the whole of it.
  $('#movement-count').textContent = state.movements.length < 100
    ? plural(state.movements.length, 'movement')
    : 'The 100 most recent movements';

  $('#movement-rows').innerHTML = state.movements.map(movement => `
    <tr>
      <td data-label="When">${timeHtml(movement.occurred_at)}</td>
      <td data-label="Product">
        <div>
          <div class="sku">${escapeHtml(movement.sku)}</div>
          <div class="sub">${escapeHtml(movement.name)}</div>
        </div>
      </td>
      <td data-label="Kind">${escapeHtml(MOVEMENT_KIND[movement.kind] ?? movement.kind)}</td>
      <td class="num" data-label="Quantity">${movement.quantity > 0 ? '+' : ''}${movement.quantity}</td>
      <td data-label="Reference">${escapeHtml(movement.reference) || '<span class="muted">—</span>'}</td>
      <td class="sub" data-label="Note">${escapeHtml(movement.note) || '<span class="muted">—</span>'}</td>
    </tr>`).join('') || '<tr class="empty-row"><td colspan="6">No movements recorded.</td></tr>';
}

function renderSuppliers() {
  $('#supplier-rows').innerHTML = state.suppliers.map(supplier => `
    <tr>
      <td class="sku" data-label="Supplier">${escapeHtml(supplier.name)}</td>
      <td data-label="Currency">${escapeHtml(supplier.currency)}</td>
      <td data-label="Status">
        <span class="pill ${supplier.enabled ? 'enabled' : 'off'}">${supplier.enabled ? 'Active' : 'Off'}</span>
      </td>
      <td class="num" data-label="Products">${supplier.product_count}</td>
      <td class="num" data-label="Preferred for">${supplier.preferred_count}</td>
      <td class="num" data-label="Orders">${supplier.draft_count}</td>
    </tr>`).join('') || '<tr class="empty-row"><td colspan="6">No suppliers.</td></tr>';
}

/* Activity ----------------------------------------------------------------- */

function renderRuns() {
  $('#run-list').innerHTML = state.runs.map(run => `
    <details class="run" ${ui.openRuns.has(run.id) ? 'open' : ''}>
      <summary data-run="${run.id}">
        <span class="pill ${escapeHtml(run.status)}">${escapeHtml(RUN_STATUS[run.status] ?? run.status)}</span>
        <strong>${escapeHtml(AGENT_NAME[run.kind] ?? run.kind)}</strong>
        <span class="run-when">#${run.id} · ${escapeHtml(run.trigger)} · ${timeHtml(run.started_at)}</span>
        ${run.note ? `<span class="run-when">“${escapeHtml(run.note)}”</span>` : ''}
      </summary>
      <div class="report-body">${run.status === 'running'
        ? '<p class="muted">Still running…</p>' : reportHtml(run.summary)}</div>
    </details>`).join('') || '<p class="empty">Neither agent has run yet.</p>';
}

/* The two agents ----------------------------------------------------------- */

// Reports come back as markdown. Rendering the whole of it would be a library;
// these three shapes are what the two prompts actually produce, and raw ** and
// ``` in the panel read as noise. Every segment is escaped before any tag is
// added, so this stays a formatter, never a way into the DOM.
function reportHtml(text) {
  if (!text || !text.trim()) {
    return '<p class="muted">The run finished without saying anything.</p>';
  }
  const inline = value => escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return text.split(/```/).map((chunk, index) => {
    // Odd chunks sit between fences: keep them verbatim, since the planner
    // lays its lines out in columns that only survive in a pre.
    if (index % 2) return `<pre>${escapeHtml(chunk.replace(/^\n/, ''))}</pre>`;
    // A blank line starts a paragraph; a single newline is a line break, which
    // is what keeps a bulleted list from running together into one sentence.
    return chunk.split(/\n\s*\n/)
      .filter(block => block.trim())
      .map(block => `<p>${inline(block.trim()).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }).join('');
}

const ICON = (paths) =>
  `<svg class="btn-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
    stroke-linejoin="round">${paths}</svg>`;

const AGENTS = {
  plan: {
    idle: 'Plan orders', label: 'Planning…', tone: 'primary',
    icon: ICON('<path d="M8 1.9l1.5 3.4 3.6.4-2.7 2.5.8 3.6L8 10l-3.2 1.8.8-3.6L2.9 5.7l3.6-.4z"/>'
      + '<path d="M12.6 12.4l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/>'),
    waiting: 'The planner is working out what to order…'
  },
  watch: {
    idle: 'Check now', label: 'Checking…', tone: 'primary',
    icon: ICON('<path d="M1.6 8S4.1 3.7 8 3.7 14.4 8 14.4 8 11.9 12.3 8 12.3 1.6 8 1.6 8z"/>'
      + '<circle cx="8" cy="8" r="1.9"/>'),
    waiting: 'The watcher is going through the depot…'
  }
};

// Every trigger for an agent is built here, so the banner's and the card's are
// the same button wherever they appear. Both agents get the primary treatment:
// each is the only action on its own card. Which matters more is said by the
// order the cards stand in, not by dressing one button down.
const triggerHtml = kind => {
  const agent = AGENTS[kind];
  return `<button class="${agent.tone}" data-run-agent="${kind}">`
    + `${agent.icon}<span class="btn-label">${agent.idle}</span></button>`;
};

// An agent can be started from more than one place — the banner offers the step
// the depot needs, the Agents page keeps both — so the running state is pushed
// out to every trigger rather than remembered on one button.
function syncTriggers() {
  $$('[data-run-agent]').forEach(button => {
    const kind = button.dataset.runAgent;
    const busy = Boolean(tracked[kind]);
    button.disabled = busy;
    button.querySelector('.btn-label').textContent = busy ? AGENTS[kind].label : AGENTS[kind].idle;
  });
}

// What each agent last did, said where the agent is rather than in a feed.
function renderAgents() {
  for (const kind of Object.keys(AGENTS)) {
    const last = state.runs.find(run => run.kind === kind);
    $(`#${kind}-last`).innerHTML = last
      ? `Last run ${timeHtml(last.started_at)} · ${escapeHtml((RUN_STATUS[last.status] ?? last.status).toLowerCase())}`
      : 'Has not run yet.';
    $(`[data-trigger="${kind}"]`).innerHTML = triggerHtml(kind);
  }
  syncTriggers();
}

// A run outlives the page that started it. The POST only returns when the run
// is over — minutes later — and the browser may be long gone by then, but the
// server thread carries on and writes its result either way. So the page never
// relies on that response: it watches the run list. That is what makes a
// refresh mid-run harmless, since the reloaded page finds the run still going
// and picks it back up instead of pretending nothing is happening.
// The two agents hold separate locks and can run at once, so each is tracked
// and reported on its own card.
const tracked = {};
const live = {};

const elapsed = entry => `${Math.max(0, Math.round((Date.now() - entry.started) / 1000))}s`;

function followUp(kind) {
  const links = [];
  if (kind === 'plan' && pendingDrafts().length) {
    links.push(`<a class="button primary" href="#/orders">Review ${plural(pendingDrafts().length, 'order')} →</a>`);
  }
  if (kind === 'watch' && state.warnings.length) {
    links.push(`<a class="button primary" href="#/stock">See ${plural(state.warnings.length, 'warning')} →</a>`);
  }
  links.push('<a class="button" href="#/agents">All runs</a>');
  return links.join('');
}

function renderLive() {
  $('#live').innerHTML = Object.entries(live).map(([kind, entry]) => {
    if (entry.phase === 'running') {
      return `
        <section class="live-card running">
          <div class="live-head">
            <span class="spinner"></span>
            <strong>${escapeHtml(AGENTS[kind].waiting)}</strong>
            <span class="elapsed" data-elapsed="${kind}">${elapsed(entry)}</span>
          </div>
        </section>`;
    }
    return `
      <section class="live-card ${entry.failed ? 'failed' : 'done'}">
        <div class="live-head">
          <span class="pill ${entry.failed ? 'failed' : 'success'}">
            ${AGENT_NAME[kind]} ${entry.failed ? 'failed' : 'finished'}</span>
          <span class="elapsed">took ${entry.took}s</span>
          <span class="spacer"></span>
          <button class="ghost" data-act="dismiss-live" data-kind="${kind}">Dismiss</button>
        </div>
        <div class="report-body">${reportHtml(entry.report)}</div>
        <div class="actions">${entry.failed ? '' : followUp(kind)}</div>
      </section>`;
  }).join('');
}

function tickElapsed(kind) {
  const element = $(`[data-elapsed="${kind}"]`);
  if (element && live[kind]) element.textContent = elapsed(live[kind]);
}

function stopTracking(kind) {
  const entry = tracked[kind];
  if (!entry) return;
  clearInterval(entry.tick);
  clearInterval(entry.poll);
  delete tracked[kind];
  syncTriggers();
}

function track(kind, since, startedAt) {
  if (tracked[kind]) return;
  const entry = { since, tick: 0, poll: 0 };
  tracked[kind] = entry;
  live[kind] = { phase: 'running', started: startedAt ?? Date.now() };
  syncTriggers();
  renderLive();
  entry.tick = setInterval(() => tickElapsed(kind), 1000);
  entry.poll = setInterval(() => poll(kind), 3000);
}

function finish(kind, report, failed) {
  const started = live[kind] ? live[kind].started : Date.now();
  stopTracking(kind);
  // The note belonged to this run and is recorded against it, so it is cleared
  // once the run is safely home — never on the way out, where a failure would
  // take a long pasted block with it.
  if (kind === 'plan' && !failed) $('#note').value = '';
  live[kind] = {
    phase: 'done', report, failed: Boolean(failed),
    took: Math.max(0, Math.round((Date.now() - started) / 1000))
  };
  renderLive();
}

async function poll(kind) {
  let runs;
  // A blip here is not worth surrendering the run over; the next tick retries.
  try { ({ runs } = await api('/api/runs')); } catch { return; }
  const entry = tracked[kind];
  if (!entry) return;
  const mine = runs.filter(run => run.kind === kind && run.id > entry.since);
  const alive = mine.find(run => run.status === 'running');
  // Once the row exists, count from the server's clock rather than from the
  // click, so the elapsed time survives a reload and reads as the run's age.
  if (alive && live[kind]) live[kind].started = stamp(alive.started_at);
  const done = mine.find(run => run.status !== 'running');
  if (!done) return;
  finish(kind, done.summary, done.status !== 'success');
  await refresh();
}

// Adopt runs this page did not start — the ones a reload left behind, and the
// scheduled checks nobody clicked for.
function adoptRunningRun() {
  for (const run of state.runs) {
    if (run.status === 'running' && AGENTS[run.kind] && !tracked[run.kind]) {
      track(run.kind, run.id - 1, stamp(run.started_at));
    }
  }
}

function start(kind, send) {
  const since = state.runs.length ? state.runs[0].id : 0;
  track(kind, since);
  $('#live').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  // Deliberately not awaited — see the note above.
  send().then(async result => {
    if (!tracked[kind]) return;            // the poller got there first
    finish(kind, result.report, false);
    if (!result.busy) await refresh();
  }).catch(error => {
    if (!tracked[kind]) return;
    finish(kind, '**Could not reach the server** — ' + error.message, true);
  });
}

const SEND = {
  plan: () => post('/api/plan', { note: $('#note').value }),
  watch: () => post('/api/check-now', {})
};

/* Products ----------------------------------------------------------------- */

const productForm = $('#product-form');

function openProduct(product = {}) {
  productForm.reset();
  clearError('#product-error');
  for (const [field, value] of Object.entries(product)) {
    if (productForm.elements[field]) productForm.elements[field].value = value;
  }
  renderSourceRows(product.sources ?? []);
  const existing = Boolean(product.id);
  $('#product-title').textContent = existing ? `Edit ${product.name}` : 'Add product';
  $('#opening-field').hidden = existing;
  $('#stock-hint').textContent = existing
    ? `${product.on_hand} on hand from the ledger, ${product.on_order} on order. `
      + 'Record a movement to change stock.'
    : 'Opening stock is recorded as a receipt in the ledger.';
  $('#product-dialog').showModal();
  productForm.elements.sku.focus();
}

// Source rows are built by hand rather than as named form fields: the set is
// variable, and only the rows on screen when Save is pressed are submitted.
function renderSourceRows(sources) {
  $('#source-rows').innerHTML = (sources.length ? sources : [{ preferred: 1 }])
    .map(sourceRow).join('');
}

function sourceRow(source) {
  const chosen = source.supplier_id ?? (state.suppliers[0] ?? {}).id;
  const supplier = state.suppliers.find(item => item.id === chosen);
  const options = state.suppliers.map(item =>
    `<option value="${item.id}"${item.id === chosen ? ' selected' : ''}>${escapeHtml(item.name)}</option>`
  ).join('');
  // Money is read and written the way it is spoken; the cents are the
  // database's business, converted on the way in and out.
  const price = ((source.unit_price_cents ?? 0) / 100).toFixed(2);
  return `
    <div class="source-row">
      <label>Supplier<select data-source="supplier_id">${options}</select></label>
      <label class="price">Unit price
        <span class="price-input">
          <input data-source="unit_price" type="number" min="0" step="0.01" value="${price}">
          <span class="currency">${escapeHtml(supplier ? supplier.currency : '')}</span>
        </span>
      </label>
      <label>Lead days<input data-source="lead_time_days" type="number" min="0" value="${source.lead_time_days ?? 1}"></label>
      <label>Case<input data-source="case_size" type="number" min="1" value="${source.case_size ?? 1}"></label>
      <label class="check"><input type="radio" name="preferred" ${source.preferred ? 'checked' : ''}> Preferred</label>
      <button type="button" class="danger" data-act="drop-source">Remove</button>
    </div>`;
}

function collectSources() {
  return $$('#source-rows .source-row').map(row => {
    const source = { preferred: row.querySelector('input[type=radio]').checked };
    row.querySelectorAll('[data-source]').forEach(field => {
      source[field.dataset.source] = Number(field.value);
    });
    source.unit_price_cents = Math.round((source.unit_price || 0) * 100);
    delete source.unit_price;
    return source;
  });
}

// A product with no preferred source has no default for the planner, so the
// first row takes the role rather than letting the choice go missing.
function keepOnePreferred() {
  const radios = $$('#source-rows input[type=radio]');
  if (radios.length && !radios.some(radio => radio.checked)) radios[0].checked = true;
}

$('#save-product').onclick = async event => {
  event.preventDefault();
  clearError('#product-error');
  if (!productForm.reportValidity()) return;
  const sources = collectSources();
  if (!sources.length) {
    return showError('#product-error', 'A product needs at least one source to be ordered from.');
  }
  if (!sources.some(source => source.preferred)) sources[0].preferred = true;
  const data = Object.fromEntries(new FormData(productForm));
  ['id', 'capacity', 'opening_stock'].forEach(key => data[key] = Number(data[key] || 0));
  data.sources = sources;
  try {
    await post('/api/products', data);
  } catch (error) {
    return showError('#product-error', 'Could not save: ' + error.message);
  }
  $('#product-dialog').close();
  await refresh();
  toast('Product saved');
};

/* Movements ---------------------------------------------------------------- */

const movementForm = $('#movement-form');

function openMovement(product) {
  if (!state.products.length) return toast('Add a product before recording a movement');
  movementForm.reset();
  clearError('#movement-error');
  $('#movement-product').innerHTML = state.products.map(item =>
    `<option value="${item.id}">${escapeHtml(item.sku)} — ${escapeHtml(item.name)}</option>`).join('');
  if (product) $('#movement-product').value = String(product.id);
  showStanding();
  $('#movement-dialog').showModal();
  movementForm.elements.quantity.focus();
}

function showStanding() {
  const product = state.products.find(item => item.id === Number($('#movement-product').value));
  $('#movement-standing').textContent = product
    ? `${product.on_hand} on hand, ${product.on_order} on order, capacity ${product.capacity}.`
    : '';
}

$('#movement-product').onchange = showStanding;

$('#save-movement').onclick = async event => {
  event.preventDefault();
  clearError('#movement-error');
  if (!movementForm.reportValidity()) return;
  const data = Object.fromEntries(new FormData(movementForm));
  data.product_id = Number(data.product_id);
  data.quantity = Number(data.quantity);
  if (data.occurred_at) data.occurred_at = data.occurred_at.replace('T', ' ') + ':00';
  try {
    await post('/api/movements', data);
  } catch (error) {
    return showError('#movement-error', 'Refused: ' + error.message);
  }
  $('#movement-dialog').close();
  await refresh();
  toast('Movement recorded');
};

/* Checks ------------------------------------------------------------------- */

const checkForm = $('#check-form');

function openCheck(check = {}) {
  checkForm.reset();
  clearError('#check-error');
  checkForm.elements.id.value = check.id ?? '';
  checkForm.elements.text.value = check.text ?? '';
  checkForm.elements.enabled.checked = check.id ? Boolean(check.enabled) : true;
  $('#check-title').textContent = check.id ? 'Edit check' : 'Add check';
  $('#check-dialog').showModal();
  checkForm.elements.text.focus();
};

$('#save-check').onclick = async event => {
  event.preventDefault();
  clearError('#check-error');
  if (!checkForm.reportValidity()) return;
  try {
    await post('/api/checks', {
      id: Number(checkForm.elements.id.value || 0),
      text: checkForm.elements.text.value,
      enabled: checkForm.elements.enabled.checked
    });
  } catch (error) {
    return showError('#check-error', 'Could not save: ' + error.message);
  }
  $('#check-dialog').close();
  await refresh();
  toast('Check saved — it applies on the next run');
};

/* Skills ------------------------------------------------------------------- */

// The server keeps one built-in method and refuses to delete it; the page says
// so up front rather than asking to confirm something that will be turned down.
const BUILT_IN_SKILL = 'planning';

const slugify = name => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function loadSkills() {
  const { skills } = await api('/api/skills');
  $('#skill-list').innerHTML = skills.map(name => `
    <button data-act="read-skill" data-name="${escapeHtml(name)}"
            aria-current="${name === ui.skill.loaded}">${escapeHtml(name)}</button>`).join('');
}

async function readSkill(name) {
  const skill = await api('/api/skills/read?name=' + encodeURIComponent(name));
  $('#skill-name').value = skill.name;
  $('#skill-content').value = skill.content;
  ui.skill = { loaded: skill.name, dirty: false, pending: '' };
  clearError('#skill-error');
  updateSkillChrome();
  await loadSkills();
  await loadRevisions(skill.name);
}

// What Save will do, said before it is pressed: the server slugifies the name,
// so an edited name writes a second skill rather than renaming the first.
function updateSkillChrome() {
  const slug = slugify($('#skill-name').value);
  const forking = Boolean(ui.skill.loaded) && slug && slug !== ui.skill.loaded;
  $('#skill-slug').textContent = !slug ? 'Give the skill a name.'
    : forking ? `Saves as a new skill, ${slug}.md — ${ui.skill.loaded}.md stays as it is.`
    : `Saves as ${slug}.md.`;
  $('#save-skill').textContent = forking ? 'Save as new skill' : 'Save skill';
  $('#delete-skill').hidden = !ui.skill.loaded || ui.skill.loaded === BUILT_IN_SKILL;
}

async function loadRevisions(name) {
  const box = $('#skill-revisions');
  if (!name) return (box.innerHTML = '');
  const { revisions } = await api('/api/skills/revisions?name=' + encodeURIComponent(name));
  box.innerHTML = revisions.length
    ? `<h3>Saved revisions</h3>${revisions.map(revision => `
        <button class="revision" data-act="read-revision"
                data-name="${escapeHtml(name)}" data-revision="${revision.revision}">
          rev ${revision.revision} · ${timeHtml(revision.created_at)}
          <span class="muted">${revision.size} chars</span>
        </button>`).join('')}`
    : '<p class="muted">No saved revisions yet. Saving this skill records one.</p>';
}

// Unsaved words are the reader's work; switching away asks rather than discards.
function guardDirty(next) {
  if (!ui.skill.dirty) return true;
  ui.skill.pending = next;
  showError('#skill-error',
    'This skill has unsaved changes. Save it, or discard them to open another.');
  $('#skill-error').insertAdjacentHTML('beforeend',
    ' <button data-act="discard-skill" class="danger">Discard changes</button>');
  return false;
}

$('#skill-name').oninput = () => { ui.skill.dirty = true; updateSkillChrome(); };
$('#skill-content').oninput = () => { ui.skill.dirty = true; };

$('#new-skill').onclick = () => {
  if (!guardDirty('')) return;
  $('#skill-name').value = '';
  $('#skill-content').value = '# New planning skill\n\n';
  $('#skill-revisions').innerHTML = '';
  ui.skill = { loaded: '', dirty: false, pending: '' };
  clearError('#skill-error');
  updateSkillChrome();
  loadSkills();
  $('#skill-name').focus();
};

$('#save-skill').onclick = async () => {
  clearError('#skill-error');
  const name = $('#skill-name').value;
  if (!slugify(name)) return showError('#skill-error', 'Give the skill a name first.');
  let saved;
  try {
    saved = await post('/api/skills', { name, content: $('#skill-content').value });
  } catch (error) {
    return showError('#skill-error', 'Could not save: ' + error.message);
  }
  ui.skill = { loaded: saved.name, dirty: false, pending: '' };
  updateSkillChrome();
  await loadSkills();
  await loadRevisions(saved.name);
  toast(`Saved ${saved.name}.md — the planner reads it on its next run`);
};

$('#delete-skill').onclick = () => {
  const name = ui.skill.loaded;
  if (!name) return;
  clearError('#skill-error');
  showError('#skill-error', `Delete ${name}.md? The file goes; its revisions stay in the database.`);
  $('#skill-error').insertAdjacentHTML('beforeend',
    ` <button data-act="delete-skill-now" data-name="${escapeHtml(name)}" class="danger">Delete skill</button>`
    + ' <button data-act="cancel-ask">Cancel</button>');
};

/* Delegated actions -------------------------------------------------------- */

$('#new-product').onclick = () => openProduct();
$('#new-check').onclick = () => openCheck();
$('#new-movement').onclick = () => openMovement(state.products[0]);
$('#add-source').onclick = () => {
  $('#source-rows').insertAdjacentHTML('beforeend', sourceRow({}));
  keepOnePreferred();
};

$('#movement-filter').onchange = async event => {
  ui.movementFilter = Number(event.target.value);
  await refresh();
};

$('#copy-export').onclick = async () => {
  const text = $('#export-text');
  try {
    await navigator.clipboard.writeText(text.value);
    toast('Copied');
  } catch {
    text.select();
    toast('Press Ctrl+C to copy');
  }
};

// A supplier's currency belongs to the supplier, so the price field says which
// money it is asking for as soon as the source changes.
$('#source-rows').onchange = event => {
  const select = event.target.closest('select[data-source="supplier_id"]');
  if (!select) return;
  const supplier = state.suppliers.find(item => item.id === Number(select.value));
  const label = select.closest('.source-row').querySelector('.currency');
  if (label) label.textContent = supplier ? supplier.currency : '';
};

const byId = (list, id) => list.find(item => item.id === Number(id));

document.addEventListener('click', async event => {
  const closer = event.target.closest('[data-close]');
  if (closer) return $('#' + closer.dataset.close).close();

  const trigger = event.target.closest('[data-run-agent]');
  if (trigger) {
    const kind = trigger.dataset.runAgent;
    return tracked[kind] ? undefined : start(kind, SEND[kind]);
  }

  const summary = event.target.closest('summary[data-run]');
  if (summary) {
    // Track which reports are open so a refresh mid-read does not shut them.
    event.preventDefault();
    const id = Number(summary.dataset.run);
    if (ui.openRuns.has(id)) ui.openRuns.delete(id); else ui.openRuns.add(id);
    return renderRuns();
  }

  const target = event.target.closest('[data-act]');
  if (!target) return;
  const { act, id, status, name, revision, kind, scope } = target.dataset;

  if (act === 'edit-product') return openProduct(byId(state.products, id));
  if (act === 'move') return openMovement(byId(state.products, id));
  if (act === 'edit-check') return openCheck(byId(state.checks, id));
  if (act === 'drop-source') {
    target.closest('.source-row').remove();
    return keepOnePreferred();
  }
  if (act === 'dismiss-live') { delete live[kind]; return renderLive(); }
  if (act === 'toggle-decided') { ui.showDecided = !ui.showDecided; return renderDrafts(); }

  if (act === 'ask') {
    ui.confirm = { act: scope, id: Number(id), status };
    ui.receive = null;
    if (scope === 'check') renderChecks(); else renderDrafts();
    // The question replaces the button that asked it, so the keyboard follows.
    return $('.confirm .primary')?.focus();
  }
  if (act === 'cancel-ask') {
    const wasCheck = ui.confirm && ui.confirm.act === 'check';
    ui.confirm = null;
    clearError('#skill-error');
    return wasCheck ? (renderChecks(), undefined) : renderDrafts();
  }

  if (act === 'read-skill') {
    if (!guardDirty(name)) return;
    return readSkill(name);
  }
  if (act === 'discard-skill') {
    const next = ui.skill.pending;
    ui.skill.dirty = false;
    clearError('#skill-error');
    return next ? readSkill(next) : $('#new-skill').click();
  }
  if (act === 'delete-skill-now') {
    const result = await post('/api/skills/delete', { name });
    clearError('#skill-error');
    if (!result.ok) return showError('#skill-error', 'This skill could not be deleted.');
    $('#skill-name').value = '';
    $('#skill-content').value = '';
    $('#skill-revisions').innerHTML = '';
    ui.skill = { loaded: '', dirty: false, pending: '' };
    updateSkillChrome();
    await loadSkills();
    return toast(`Deleted ${name}.md`);
  }
  if (act === 'read-revision') {
    if (!ui.skill.dirty || confirmDiscardRevision()) {
      const past = await api(
        `/api/skills/revision?name=${encodeURIComponent(name)}&revision=${revision}`);
      $('#skill-content').value = past.content;
      ui.skill.dirty = true;
      return toast(`Loaded revision ${revision} — save to restore it`);
    }
    return;
  }

  if (act === 'toggle-check') {
    const check = byId(state.checks, id);
    await post('/api/checks', { id: check.id, text: check.text, enabled: !check.enabled });
    await refresh();
    return toast(check.enabled ? 'Check turned off' : 'Check turned on');
  }
  if (act === 'delete-check') {
    ui.confirm = null;
    await post('/api/checks/delete', { id: Number(id) });
    await refresh();
    return toast('Check deleted');
  }
  if (act === 'draft-status') {
    ui.confirm = null;
    const result = await post('/api/drafts/status', { id: Number(id), status });
    await refresh();
    if (!result.ok) return toast('That order has already moved on');
    return toast(status === 'accepted'
      ? `Order #${id} accepted — now counted as on order until it arrives`
      : `Order #${id} ${status}`);
  }
  if (act === 'open-receive') {
    ui.confirm = null;
    ui.receive = { id: Number(id), amounts: {}, note: '' };
    renderDrafts();
    return $('.receive input')?.focus();
  }
  if (act === 'cancel-receive') {
    ui.receive = null;
    return renderDrafts();
  }
  if (act === 'receive') {
    const order = byId(state.drafts, id);
    // An empty box means none of that line arrived, which is a normal thing for
    // a delivery to say — so it is left out rather than sent as a zero.
    const lines = order.lines
      .filter(line => line.outstanding_quantity > 0)
      .map(line => ({
        line_id: line.id,
        quantity: Number(ui.receive.amounts[line.id] ?? line.outstanding_quantity)
      }))
      .filter(line => line.quantity > 0);
    if (!lines.length) {
      return showError('#receive-error', 'Nothing to book in — say how much arrived.');
    }
    let result;
    try {
      result = await post('/api/orders/receive',
        { order_id: order.id, lines, note: ui.receive.note });
    } catch (error) {
      return showError('#receive-error', 'Refused: ' + error.message);
    }
    ui.receive = null;
    await refresh();
    const now = byId(state.drafts, order.id);
    return toast(now && now.status === 'received'
      ? `${plural(result.received, 'unit')} booked in — order #${order.id} is complete`
      : `${plural(result.received, 'unit')} booked in — the rest is still on order`);
  }
  if (act === 'export') {
    const data = await api(`/api/drafts/export?id=${Number(id)}`);
    $('#export-title').textContent = `Order #${id} as JSON`;
    $('#export-text').value = JSON.stringify(data.orders, null, 2);
    return $('#export-dialog').showModal();
  }
});

// What is typed into a delivery is kept in `ui`, not read off the boxes at the
// end: a run finishing underneath the reader re-renders the page, and their
// half-counted delivery has to survive that.
document.addEventListener('input', event => {
  if (!ui.receive) return;
  const line = event.target.closest('[data-receive-line]');
  if (line) ui.receive.amounts[line.dataset.receiveLine] = line.value;
  else if (event.target.closest('[data-receive-note]')) ui.receive.note = event.target.value;
});

// Loading a past revision replaces the editor, which is the point; it only asks
// when there is unsaved work of the reader's own to lose.
const confirmDiscardRevision = () => {
  showError('#skill-error', 'Save or discard your changes before loading a revision.');
  return false;
};

/* Start -------------------------------------------------------------------- */

renderLoading();
showPage();
updateSkillChrome();
refresh().catch(error => {
  $('#headline').textContent = 'Could not load the depot';
  $('#headline-detail').textContent = error.message;
});
