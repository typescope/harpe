// Smart Logistics — depot planner UI.
//
// One document, several sections; the nav toggles which is visible. All data
// lives on the server: every mutation posts, then refresh() re-reads and
// re-renders. No inline event handlers anywhere — the page is served under a
// Content-Security-Policy that forbids them, so clicks are delegated from
// data-act attributes at the bottom of this file.

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let state = {
  products: [], suppliers: [], checks: [], drafts: [],
  warnings: [], runs: [], movements: [], summary: {}
};

/* Helpers ------------------------------------------------------------------ */

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!response.ok) throw Error(await response.text());
  return response.json();
}

const post = (path, data) => api(path, { method: 'POST', body: JSON.stringify(data) });

const money = (cents, currency = 'CHF') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// SQLite writes UTC without a zone marker; say so before parsing.
function ago(stamp) {
  if (!stamp) return '';
  const then = new Date(stamp.replace(' ', 'T') + 'Z');
  const minutes = Math.round((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${plural(hours, 'hour')} ago`;
  return `${plural(Math.round(hours / 24), 'day')} ago`;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2400);
}

function busy(button, label, run) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  return run().finally(() => {
    button.disabled = false;
    button.textContent = original;
  });
}

/* Rendering ---------------------------------------------------------------- */

async function refresh() {
  const [snapshot, warnings, checks, drafts, runs, movements] = await Promise.all([
    api('/api/snapshot'), api('/api/warnings'), api('/api/checks'),
    api('/api/drafts'), api('/api/runs'), api('/api/movements')
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
  renderWarnings();
  renderProducts();
  renderDrafts();
  renderChecks();
  renderMovements();
  renderSuppliers();
  renderRuns();
}

// The problem, in the reader's words, before anything else on the page.
function renderStatus() {
  const atRisk = state.summary.at_risk_count ?? 0;
  const bar = $('.status');
  bar.classList.toggle('clear', atRisk === 0);
  $('#headline').textContent = atRisk === 0
    ? 'Every product has enough cover to outlast its delivery time.'
    : `${plural(atRisk, 'product')} will run out before a delivery could arrive.`;
  const checked = state.summary.last_checked;
  $('#checked').textContent = checked ? `checked ${ago(checked)}` : 'not checked yet';
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
      <span class="muted">${escapeHtml(ago(warning.last_seen))}</span>
    </div>`).join('');
}

function coverClass(product) {
  if (product.days_of_cover === 999) return 'fine';
  if (product.days_of_cover < product.lead_time_days) return 'critical';
  if (product.days_of_cover < product.lead_time_days + 5) return 'soon';
  return 'fine';
}

function renderProducts() {
  $('#product-rows').innerHTML = state.products.map(product => {
    const preferred = product.sources.find(s => s.preferred) ?? product.sources[0];
    const others = product.sources.length - 1;
    const onOrder = product.on_order
      ? `<div class="sub">${product.on_order} on order</div>` : '';
    return `
      <tr>
        <td>
          <div class="sku">${escapeHtml(product.name)}</div>
          <div class="sub">${escapeHtml(product.sku)} · ${escapeHtml(product.category)}</div>
        </td>
        <td class="num">${product.on_hand}${onOrder}</td>
        <td class="num">${product.sells_per_day}</td>
        <td class="num">
          <div class="days ${coverClass(product)}">${product.days_of_cover === 999 ? '—' : product.days_of_cover}</div>
          <div class="days-note">delivery takes ${product.lead_time_days}d</div>
        </td>
        <td>
          <div class="source-line">${escapeHtml(preferred ? preferred.supplier_name : '—')}</div>
          ${others > 0 ? `<div class="sub">${plural(others, 'other source')}</div>` : ''}
        </td>
        <td class="num">
          <button data-act="edit-product" data-id="${product.id}">Edit</button>
          <button data-act="move" data-id="${product.id}">Movement</button>
        </td>
      </tr>`;
  }).join('');
}

function renderDrafts() {
  $('#draft-list').innerHTML = state.drafts.map(draft => {
    const lines = draft.lines.map(line =>
      `<li>${escapeHtml(line.sku)} — ${escapeHtml(line.name)} · ${line.quantity} × ${money(line.unit_price_cents, draft.currency)}</li>`
    ).join('');
    const decisions = draft.status === 'draft'
      ? `<button class="primary" data-act="draft-status" data-id="${draft.id}" data-status="accepted">Accept</button>
         <button data-act="draft-status" data-id="${draft.id}" data-status="rejected">Reject</button>`
      : '';
    return `
      <article class="card">
        <div class="card-head">
          <div>
            <strong>#${draft.id} · ${escapeHtml(draft.supplier_name)}</strong>
            <div class="muted">${escapeHtml(draft.created_at)} · ${money(draft.total_cents, draft.currency)}</div>
          </div>
          <span class="pill ${escapeHtml(draft.status)}">${escapeHtml(draft.status)}</span>
        </div>
        <p>${escapeHtml(draft.rationale)}</p>
        <ul class="lines">${lines}</ul>
        <div class="actions">
          ${decisions}
          <button data-act="export" data-id="${draft.id}">Export JSON</button>
        </div>
      </article>`;
  }).join('') || '<p class="muted">No orders to review. Use <b>Plan orders</b> to prepare some.</p>';
}

function renderChecks() {
  $('#check-list').innerHTML = state.checks.map(check => `
    <article class="card">
      <div class="card-head">
        <p class="check-text">${escapeHtml(check.text)}</p>
        <span class="pill ${check.enabled ? 'enabled' : ''}">${check.enabled ? 'Active' : 'Off'}</span>
      </div>
      <div class="actions">
        <button data-act="edit-check" data-id="${check.id}">Edit</button>
        <button class="danger" data-act="delete-check" data-id="${check.id}">Delete</button>
      </div>
    </article>`).join('')
    || '<p class="muted">No checks yet. Add one in plain English.</p>';
}

function renderMovements() {
  $('#movement-rows').innerHTML = state.movements.map(movement => `
    <tr>
      <td>${escapeHtml(movement.occurred_at)}</td>
      <td>${escapeHtml(movement.sku)}<div class="sub">${escapeHtml(movement.name)}</div></td>
      <td>${escapeHtml(movement.kind)}</td>
      <td class="num">${movement.quantity > 0 ? '+' : ''}${movement.quantity}</td>
      <td>${escapeHtml(movement.reference)}</td>
      <td class="sub">${escapeHtml(movement.note)}</td>
    </tr>`).join('');
}

function renderSuppliers() {
  $('#supplier-rows').innerHTML = state.suppliers.map(supplier => `
    <tr>
      <td class="sku">${escapeHtml(supplier.name)}</td>
      <td>${escapeHtml(supplier.currency)}</td>
      <td><span class="pill ${supplier.enabled ? 'enabled' : ''}">${supplier.enabled ? 'Active' : 'Off'}</span></td>
      <td class="num">${supplier.product_count}</td>
      <td class="num">${supplier.preferred_count}</td>
      <td class="num">${supplier.draft_count}</td>
    </tr>`).join('');
}

function renderRuns() {
  $('#run-list').innerHTML = state.runs.map(run => `
    <details class="run">
      <summary>
        <span class="pill ${run.status === 'success' ? 'enabled' : ''}">${escapeHtml(run.kind)}</span>
        #${run.id} · ${escapeHtml(run.trigger)} · ${escapeHtml(ago(run.started_at))}
        ${run.note ? `· “${escapeHtml(run.note)}”` : ''}
      </summary>
      <pre>${escapeHtml(run.summary) || 'No report recorded.'}</pre>
    </details>`).join('');
}

/* Products ----------------------------------------------------------------- */

const productForm = $('#product-form');

function openProduct(product = {}) {
  productForm.reset();
  for (const [field, value] of Object.entries(product)) {
    if (productForm.elements[field]) productForm.elements[field].value = value;
  }
  renderSourceRows(product.sources ?? []);
  const existing = Boolean(product.id);
  $('#opening-field').hidden = existing;
  $('#stock-hint').textContent = existing
    ? `${product.on_hand} on hand from the ledger, ${product.on_order} on order. `
      + 'Record a movement to change stock.'
    : 'Opening stock is recorded as a receipt in the ledger.';
  $('#product-dialog').showModal();
}

// Source rows are built by hand rather than as named form fields: the set is
// variable, and only the rows on screen when Save is pressed are submitted.
function renderSourceRows(sources) {
  $('#source-rows').innerHTML = (sources.length ? sources : [{ preferred: 1 }])
    .map(sourceRow).join('');
}

function sourceRow(source) {
  const options = state.suppliers.map(supplier =>
    `<option value="${supplier.id}"${supplier.id === source.supplier_id ? ' selected' : ''}>${escapeHtml(supplier.name)}</option>`
  ).join('');
  return `
    <div class="source-row">
      <select data-source="supplier_id">${options}</select>
      <label>Price, cents<input data-source="unit_price_cents" type="number" min="0" value="${source.unit_price_cents ?? 0}"></label>
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
    return source;
  });
}

$('#save-product').onclick = async event => {
  event.preventDefault();
  if (!productForm.reportValidity()) return;
  const data = Object.fromEntries(new FormData(productForm));
  ['id', 'capacity', 'opening_stock'].forEach(k => data[k] = Number(data[k] || 0));
  data.sources = collectSources();
  try {
    await post('/api/products', data);
  } catch (error) {
    return toast('Could not save: ' + error.message);
  }
  $('#product-dialog').close();
  await refresh();
  toast('Product saved');
};

/* Movements ---------------------------------------------------------------- */

const movementForm = $('#movement-form');

function openMovement(product) {
  movementForm.reset();
  movementForm.elements.product_id.value = product.id;
  $('#movement-product').textContent =
    `${product.sku} — ${product.name}. ${product.on_hand} on hand, capacity ${product.capacity}.`;
  $('#movement-dialog').showModal();
}

$('#save-movement').onclick = async event => {
  event.preventDefault();
  if (!movementForm.reportValidity()) return;
  const data = Object.fromEntries(new FormData(movementForm));
  data.product_id = Number(data.product_id);
  data.quantity = Number(data.quantity);
  if (data.occurred_at) data.occurred_at = data.occurred_at.replace('T', ' ') + ':00';
  try {
    await post('/api/movements', data);
  } catch (error) {
    return toast('Refused: ' + error.message);
  }
  $('#movement-dialog').close();
  await refresh();
  toast('Movement recorded');
};

/* Checks ------------------------------------------------------------------- */

const checkForm = $('#check-form');

function openCheck(check = {}) {
  checkForm.reset();
  checkForm.elements.id.value = check.id ?? '';
  checkForm.elements.text.value = check.text ?? '';
  checkForm.elements.enabled.checked = check.id ? Boolean(check.enabled) : true;
  $('#check-dialog').showModal();
}

$('#save-check').onclick = async event => {
  event.preventDefault();
  if (!checkForm.reportValidity()) return;
  await post('/api/checks', {
    id: Number(checkForm.elements.id.value || 0),
    text: checkForm.elements.text.value,
    enabled: checkForm.elements.enabled.checked
  });
  $('#check-dialog').close();
  await refresh();
  toast('Check saved — it applies on the next run');
};

/* Skills ------------------------------------------------------------------- */

async function loadSkills() {
  const { skills } = await api('/api/skills');
  $('#skill-list').innerHTML = skills.map(name =>
    `<button data-act="read-skill" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`
  ).join('');
}

async function readSkill(name) {
  const skill = await api('/api/skills/read?name=' + encodeURIComponent(name));
  $('#skill-name').value = skill.name;
  $('#skill-content').value = skill.content;
  await loadRevisions(skill.name);
}

async function loadRevisions(name) {
  const box = $('#skill-revisions');
  if (!name) return (box.innerHTML = '');
  const { revisions } = await api('/api/skills/revisions?name=' + encodeURIComponent(name));
  box.innerHTML = revisions.length
    ? `<h3>Saved revisions</h3>${revisions.map(revision => `
        <button class="revision" data-act="read-revision"
                data-name="${escapeHtml(name)}" data-revision="${revision.revision}">
          rev ${revision.revision} · ${escapeHtml(revision.created_at)}
          <span class="muted">${revision.size} chars</span>
        </button>`).join('')}`
    : '<p class="muted">No saved revisions yet. Saving this skill records one.</p>';
}

$('#new-skill').onclick = () => {
  $('#skill-name').value = '';
  $('#skill-content').value = '# New planning skill\n\n';
  $('#skill-revisions').innerHTML = '';
};

$('#save-skill').onclick = async () => {
  const name = $('#skill-name').value;
  try {
    await post('/api/skills', { name, content: $('#skill-content').value });
  } catch (error) {
    return toast('Could not save: ' + error.message);
  }
  await loadSkills();
  await loadRevisions(name);
  toast('Skill saved');
};

$('#delete-skill').onclick = async () => {
  const name = $('#skill-name').value;
  if (!name || !confirm(`Delete ${name}?`)) return;
  const result = await post('/api/skills/delete', { name });
  if (!result.ok) return toast('This built-in skill cannot be deleted');
  $('#skill-name').value = '';
  $('#skill-content').value = '';
  $('#skill-revisions').innerHTML = '';
  await loadSkills();
};

/* The two agents ----------------------------------------------------------- */

$('#plan').onclick = event => busy(event.target, 'Planning…', async () => {
  $('#report').textContent = 'The planner is working out what to order…';
  try {
    const result = await post('/api/plan', { note: $('#note').value });
    $('#report').textContent = result.report;
    await refresh();
  } catch (error) {
    $('#report').textContent = 'Planning failed: ' + error.message;
  }
});

$('#check-now').onclick = event => busy(event.target, 'Checking…', async () => {
  try {
    const result = await post('/api/check-now', {});
    $('#report').textContent = result.report;
    await refresh();
  } catch (error) {
    $('#report').textContent = 'Check failed: ' + error.message;
  }
});

/* Chrome and delegated actions --------------------------------------------- */

$$('nav button').forEach(button => {
  button.onclick = () => {
    $$('nav button, .page').forEach(element => element.classList.remove('active'));
    button.classList.add('active');
    $('#' + button.dataset.page).classList.add('active');
    if (button.dataset.page === 'skills') loadSkills();
  };
});

$('#new-product').onclick = () => openProduct();
$('#new-check').onclick = () => openCheck();
$('#new-movement').onclick = () => openMovement(state.products[0]);
$('#add-source').onclick = () =>
  $('#source-rows').insertAdjacentHTML('beforeend', sourceRow({}));

const byId = (list, id) => list.find(item => item.id === Number(id));

document.addEventListener('click', async event => {
  const closer = event.target.closest('[data-close]');
  if (closer) return $('#' + closer.dataset.close).close();

  const target = event.target.closest('[data-act]');
  if (!target) return;
  const { act, id, status, name, revision } = target.dataset;

  if (act === 'edit-product') return openProduct(byId(state.products, id));
  if (act === 'move') return openMovement(byId(state.products, id));
  if (act === 'edit-check') return openCheck(byId(state.checks, id));
  if (act === 'drop-source') return target.closest('.source-row').remove();
  if (act === 'read-skill') return readSkill(name);
  if (act === 'read-revision') {
    const past = await api(
      `/api/skills/revision?name=${encodeURIComponent(name)}&revision=${revision}`);
    $('#skill-content').value = past.content;
    return toast(`Loaded revision ${revision} — save to restore it`);
  }
  if (act === 'delete-check') {
    if (!confirm('Delete this check?')) return;
    await post('/api/checks/delete', { id: Number(id) });
    await refresh();
    return toast('Check deleted');
  }
  if (act === 'draft-status') {
    const result = await post('/api/drafts/status', { id: Number(id), status });
    await refresh();
    return toast(result.ok
      ? `Order ${status}${status === 'accepted' ? ' — now counted as on order' : ''}`
      : 'That order is no longer a draft');
  }
  if (act === 'export') {
    const data = await api(`/api/drafts/export?id=${Number(id)}`);
    $('#report').textContent = JSON.stringify(data.orders, null, 2);
    return toast('Exported into the run panel');
  }
});

refresh().catch(error => {
  $('#headline').textContent = 'Could not load the depot: ' + error.message;
});
