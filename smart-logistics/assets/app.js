// Smart Logistics — depot planner UI.
//
// The page is a single document with four sections; nav buttons toggle which
// one is visible. All data lives on the server: every mutation posts, then
// refresh() re-reads the snapshot and re-renders.

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let state = { products: [], suppliers: [], rules: [], drafts: [], demand: {}, runs: [], movements: [] };

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

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2200);
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);

/* Chrome: dialogs and page navigation -------------------------------------- */

// Cancel buttons are type="button" so they never submit; they just close.
$$('[data-close]').forEach(button => {
  button.onclick = () => $('#' + button.dataset.close).close();
});

$$('nav button').forEach(button => {
  button.onclick = () => {
    $$('nav button, .page').forEach(element => element.classList.remove('active'));
    button.classList.add('active');
    $('#' + button.dataset.page).classList.add('active');
    if (button.dataset.page === 'skills') loadSkills();
  };
});

/* Rendering ---------------------------------------------------------------- */

async function refresh() {
  const [snapshot, ruleData, draftData, demandData, runData, movementData] = await Promise.all([
    api('/api/snapshot'),
    api('/api/rules'),
    api('/api/drafts'),
    api('/api/demand'),
    api('/api/analysis'),
    api('/api/movements')
  ]);
  state = {
    ...snapshot,
    rules: ruleData.rules,
    drafts: draftData.drafts,
    demand: groupDemand(demandData.demand),
    runs: runData.runs,
    movements: movementData.movements
  };
  render();
}

// Daily rows arrive flat and ordered; the sparklines want them per product.
function groupDemand(rows) {
  const byProduct = {};
  for (const row of rows) (byProduct[row.product_id] ??= []).push(row);
  return byProduct;
}

function render() {
  renderSummary();
  renderProducts();
  renderSuppliers();
  renderMovements();
  renderRules();
  renderDrafts();
  renderRuns();
}

function renderSummary() {
  const summary = state.summary;
  const metrics = [
    ['Products', summary.product_count],
    ['Low stock', summary.low_stock_count],
    ['Open drafts', summary.draft_count],
    ['Inventory value', money(summary.inventory_value_cents)]
  ];
  $('#summary').innerHTML = metrics
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
    .join('');
}

function renderProducts() {
  $('#product-rows').innerHTML = state.products.map(product => {
    const cheapestMoq = Math.min(...product.sources.map(source => source.minimum_order_quantity), Infinity);
    const short = product.available + product.incoming < cheapestMoq;
    const incoming = product.incoming
      ? `${product.incoming} incoming${product.incoming_eta ? ' · due ' + escapeHtml(product.incoming_eta) : ''}`
      : 'none incoming';
    const sources = product.sources.map(source => `
      <div class="source">
        <span>${escapeHtml(source.supplier_name)}</span>
        ${source.preferred ? '<span class="tag">preferred</span>' : ''}
        <span class="muted">
          ${money(source.unit_price_cents, source.currency)} ·
          ${source.lead_time_days}d lead · case ${source.case_size} · min ${source.minimum_order_quantity}
        </span>
      </div>`).join('') || '<div class="muted">No supplier — cannot be ordered.</div>';
    return `
      <tr>
        <td>
          <strong>${escapeHtml(product.sku)}</strong>
          <div>${escapeHtml(product.name)}</div>
          <div class="muted">${escapeHtml(product.category)}</div>
        </td>
        <td class="${short ? 'risk' : ''}">
          ${product.on_hand} on hand · ${product.reserved} reserved
          <div class="muted">${incoming} · ${product.available} available · cap ${product.capacity}</div>
        </td>
        <td>${demandCell(product.id)}</td>
        <td>${sources}</td>
        <td><button onclick="openMovement(${product.id})">Movement</button></td>
        <td><button onclick="editProduct(${product.id})">Edit</button></td>
      </tr>`;
  }).join('');
}

function demandCell(productId) {
  const days = state.demand[productId] ?? [];
  if (!days.length) return '<span class="muted">No history</span>';
  const total = days.reduce((sum, day) => sum + day.quantity, 0);
  const average = total / days.length;
  return `
    ${sparkline(days.map(day => day.quantity))}
    <div class="muted">${average.toFixed(1)}/day · ${total} total</div>`;
}

// A plain polyline: no chart library, and it scales to the tallest day.
function sparkline(values, width = 120, height = 26) {
  const peak = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((value, index) => `${(index * step).toFixed(1)},${(height - (value / peak) * height).toFixed(1)}`)
    .join(' ');
  return `
    <svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
         role="img" aria-label="Daily demand, peak ${peak}">
      <polyline points="${points}"></polyline>
    </svg>`;
}

const MOVEMENT_LABELS = { receipt: 'Receipt', issue: 'Issue', adjustment: 'Adjustment' };

function renderMovements() {
  $('#movement-rows').innerHTML = state.movements.map(movement => `
      <tr>
        <td class="muted">${escapeHtml(movement.occurred_at)}</td>
        <td><strong>${escapeHtml(movement.sku)}</strong><div class="muted">${escapeHtml(movement.name)}</div></td>
        <td>${MOVEMENT_LABELS[movement.kind] ?? escapeHtml(movement.kind)}</td>
        <td class="${movement.quantity < 0 ? 'out' : 'in'}">${movement.quantity > 0 ? '+' : ''}${movement.quantity}</td>
        <td>${escapeHtml(movement.reference)}</td>
        <td class="muted">${escapeHtml(movement.note)}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No movements recorded yet.</td></tr>';
}

function renderSuppliers() {
  $('#supplier-rows').innerHTML = state.suppliers.map(supplier => `
      <tr>
        <td><strong>${escapeHtml(supplier.name)}</strong></td>
        <td>${escapeHtml(supplier.currency)}</td>
        <td><span class="pill ${supplier.enabled ? 'enabled' : ''}">${supplier.enabled ? 'Active' : 'Disabled'}</span></td>
        <td>${supplier.product_count}</td>
        <td>${supplier.preferred_count}</td>
        <td>${supplier.draft_count}</td>
      </tr>`).join('');
}

function renderRuns() {
  $('#run-list').innerHTML = state.runs.map(run => `
      <details class="run">
        <summary>
          <span class="pill ${run.status === 'success' ? 'enabled' : ''}">${escapeHtml(run.status)}</span>
          #${run.id} · ${escapeHtml(run.trigger)} · ${escapeHtml(run.started_at)}
        </summary>
        <pre>${escapeHtml(run.summary) || 'No report recorded.'}</pre>
      </details>`).join('') || '<p class="muted">No analysis has been recorded yet.</p>';
}

function renderRules() {
  $('#rule-list').innerHTML = state.rules.map(rule => `
      <article class="card">
        <div class="card-head">
          <p class="rule-text">${escapeHtml(rule.text)}</p>
          <span class="pill ${rule.enabled ? 'enabled' : ''}">${rule.enabled ? 'Active' : 'Inactive'}</span>
        </div>
        <div class="muted">Updated ${escapeHtml(rule.updated_at)}</div>
        <div class="actions">
          <button onclick="editRule(${rule.id})">Edit</button>
          <button class="danger" onclick="deleteRule(${rule.id})">Delete</button>
        </div>
      </article>`).join('') || '<p>No rules yet. Add one in plain language.</p>';
}

function renderDrafts() {
  $('#draft-list').innerHTML = state.drafts.map(draft => {
    const lines = draft.lines
      .map(line => `<li>${escapeHtml(line.sku)} · ${line.quantity} × ${money(line.unit_price_cents, draft.currency)}</li>`)
      .join('');
    const decisions = draft.status === 'draft'
      ? `<button class="primary" onclick="statusDraft(${draft.id},'accepted')">Accept</button>
         <button onclick="statusDraft(${draft.id},'rejected')">Reject</button>`
      : '';
    return `
      <article class="card">
        <div class="card-head">
          <div>
            <strong>Draft #${draft.id} · ${escapeHtml(draft.supplier_name)}</strong>
            <div class="muted">${escapeHtml(draft.created_at)} · ${money(draft.total_cents, draft.currency)}</div>
          </div>
          <span class="pill ${draft.status}">${draft.status}</span>
        </div>
        <p>${escapeHtml(draft.rationale)}</p>
        <ul class="lines">${lines}</ul>
        <div class="actions">
          ${decisions}
          <a href="/api/drafts/export?id=${draft.id}" target="_blank"><button>Export JSON</button></a>
        </div>
      </article>`;
  }).join('') || '<p>No draft requests yet. Run an analysis to create justified drafts.</p>';
}

/* Products ----------------------------------------------------------------- */

const PRODUCT_NUMBER_FIELDS = ['reserved', 'incoming', 'capacity'];

const productForm = $('#product-form');

$('#new-product').onclick = () => openProduct();
window.editProduct = id => openProduct(state.products.find(product => product.id === id));

function openProduct(product = {}) {
  productForm.reset();
  for (const [field, value] of Object.entries(product)) {
    if (productForm.elements[field]) productForm.elements[field].value = value;
  }
  renderSourceRows(product.sources ?? []);
  // Stock on an existing product is the ledger's answer, so it is shown, not typed.
  const existing = Boolean(product.id);
  $('#opening-field').hidden = existing;
  $('#stock-hint').textContent = existing
    ? `${product.on_hand} on hand, from the stock ledger. Record a movement to change it.`
    : 'Opening stock is recorded as a receipt in the stock ledger.';
  $('#product-dialog').showModal();
}

// Sourcing rows are built by hand rather than named form fields: the set is
// variable, and only the rows on screen when Save is pressed are submitted.
function renderSourceRows(sources) {
  const rows = sources.length ? sources : [{ preferred: 1 }];
  $('#source-rows').innerHTML = rows.map(sourceRow).join('');
}

function sourceRow(source) {
  const options = state.suppliers
    .map(supplier => `<option value="${supplier.id}"${supplier.id === source.supplier_id ? ' selected' : ''}>${escapeHtml(supplier.name)}</option>`)
    .join('');
  return `
    <div class="source-row">
      <select data-source="supplier_id">${options}</select>
      <label>Price, cents<input data-source="unit_price_cents" type="number" min="0" value="${source.unit_price_cents ?? 0}"></label>
      <label>Lead days<input data-source="lead_time_days" type="number" min="0" value="${source.lead_time_days ?? 1}"></label>
      <label>Case<input data-source="case_size" type="number" min="1" value="${source.case_size ?? 1}"></label>
      <label>Min order<input data-source="minimum_order_quantity" type="number" min="1" value="${source.minimum_order_quantity ?? 1}"></label>
      <label class="check"><input type="radio" name="preferred" ${source.preferred ? 'checked' : ''}> Preferred</label>
      <button type="button" class="danger" onclick="this.closest('.source-row').remove()">Remove</button>
    </div>`;
}

$('#add-source').onclick = () => {
  $('#source-rows').insertAdjacentHTML('beforeend', sourceRow({}));
};

function collectSources() {
  return [...$$('#source-rows .source-row')].map(row => {
    const source = { preferred: row.querySelector('input[type=radio]').checked };
    row.querySelectorAll('[data-source]').forEach(field => {
      source[field.dataset.source] = Number(field.value || 0);
    });
    return source;
  });
}

$('#save-product').onclick = async event => {
  event.preventDefault();
  if (!productForm.reportValidity()) return;
  const sources = collectSources();
  if (!sources.length) return toast('A product needs at least one supplier');
  if (sources.some(source => source.minimum_order_quantity % source.case_size !== 0)) {
    return toast('Minimum order must be a whole number of cases');
  }
  const data = Object.fromEntries(new FormData(productForm));
  for (const field of ['id', 'opening_stock', ...PRODUCT_NUMBER_FIELDS]) {
    data[field] = Number(data[field] || 0);
  }
  data.enabled = true;
  data.sources = sources;
  await post('/api/products', data);
  $('#product-dialog').close();
  await refresh();
  toast('Product saved');
};

/* Stock movements ---------------------------------------------------------- */

const movementForm = $('#movement-form');

$('#new-movement').onclick = () => openMovement(state.products[0]?.id);

window.openMovement = productId => {
  const product = state.products.find(candidate => candidate.id === productId);
  if (!product) return toast('Add a product first');
  movementForm.reset();
  movementForm.elements.product_id.value = product.id;
  $('#movement-product').textContent =
    `${product.sku} · ${product.name} — ${product.on_hand} on hand, capacity ${product.capacity}`;
  $('#movement-dialog').showModal();
};

$('#save-movement').onclick = async event => {
  event.preventDefault();
  if (!movementForm.reportValidity()) return;
  const data = Object.fromEntries(new FormData(movementForm));
  data.product_id = Number(data.product_id);
  data.quantity = Number(data.quantity);
  // datetime-local gives "2026-09-02T14:30"; SQLite wants a space and seconds.
  data.occurred_at = data.occurred_at ? data.occurred_at.replace('T', ' ') + ':00' : '';
  try {
    await post('/api/movements', data);
  } catch (error) {
    return toast('Rejected: the ledger cannot go negative or past capacity');
  }
  $('#movement-dialog').close();
  await refresh();
  toast('Movement recorded');
};

/* Rules -------------------------------------------------------------------- */

const ruleForm = $('#rule-form');

$('#new-rule').onclick = () => openRule();
window.editRule = id => openRule(state.rules.find(rule => rule.id === id));

function openRule(rule = { enabled: 1 }) {
  ruleForm.reset();
  ruleForm.elements.id.value = rule.id ?? '';
  ruleForm.elements.text.value = rule.text ?? '';
  ruleForm.elements.enabled.checked = !!rule.enabled;
  $('#rule-dialog').showModal();
}

$('#save-rule').onclick = async event => {
  event.preventDefault();
  if (!ruleForm.reportValidity()) return;
  const data = {
    id: Number(ruleForm.elements.id.value || 0),
    text: ruleForm.elements.text.value,
    enabled: ruleForm.elements.enabled.checked
  };
  await post('/api/rules', data);
  $('#rule-dialog').close();
  await refresh();
  toast('Rule saved');
};

window.deleteRule = async id => {
  if (!confirm('Delete this rule?')) return;
  await post('/api/rules/delete', { id });
  await refresh();
};

/* Draft requests ----------------------------------------------------------- */

window.statusDraft = async (id, status) => {
  await post('/api/drafts/status', { id, status });
  await refresh();
  toast(`Draft ${status}`);
};

/* Skills ------------------------------------------------------------------- */

async function loadSkills() {
  const { skills } = await api('/api/skills');
  $('#skill-list').innerHTML = skills
    .map(name => `<button onclick="readSkill('${name}')">${escapeHtml(name)}</button>`)
    .join('');
}

window.readSkill = async name => {
  const skill = await api('/api/skills/read?name=' + encodeURIComponent(name));
  $('#skill-name').value = skill.name;
  $('#skill-content').value = skill.content;
  await loadRevisions(skill.name);
};

async function loadRevisions(name) {
  const box = $('#skill-revisions');
  if (!name) return (box.innerHTML = '');
  const { revisions } = await api('/api/skills/revisions?name=' + encodeURIComponent(name));
  box.innerHTML = revisions.length
    ? `<h3>Saved revisions</h3>${revisions.map(revision => `
        <button class="revision" onclick="readRevision('${name}',${revision.revision})">
          rev ${revision.revision} · ${escapeHtml(revision.created_at)}
          <span class="muted">${revision.size} chars</span>
        </button>`).join('')}`
    : '<p class="muted">No saved revisions yet. Saving this skill records one.</p>';
}

// Loads an old revision into the editor for reading; saving it restores it.
window.readRevision = async (name, revision) => {
  const past = await api(`/api/skills/revision?name=${encodeURIComponent(name)}&revision=${revision}`);
  $('#skill-content').value = past.content;
  toast(`Loaded revision ${revision} — save to restore it`);
};

$('#new-skill').onclick = () => {
  $('#skill-name').value = '';
  $('#skill-content').value = '# New planning skill\n\n';
  $('#skill-revisions').innerHTML = '';
};

$('#save-skill').onclick = async () => {
  const name = $('#skill-name').value;
  await post('/api/skills', { name, content: $('#skill-content').value });
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

/* Analysis ----------------------------------------------------------------- */

$('#analyze').onclick = async () => {
  const button = $('#analyze');
  button.disabled = true;
  button.textContent = 'Analyzing…';
  $('#report').textContent = 'The planner is inspecting inventory and demand…';
  try {
    const result = await post('/api/analyze', {});
    $('#report').textContent = result.report;
    await refresh();
  } catch (error) {
    $('#report').textContent = 'Analysis failed: ' + error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Analyze depot';
  }
};

refresh().catch(error => {
  $('#report').textContent = 'Could not load depot: ' + error.message;
});
