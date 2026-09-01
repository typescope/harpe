// Smart Logistics — depot planner UI.
//
// The page is a single document with four sections; nav buttons toggle which
// one is visible. All data lives on the server: every mutation posts, then
// refresh() re-reads the snapshot and re-renders.

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let state = { products: [], suppliers: [], rules: [], drafts: [] };

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
  const [snapshot, ruleData, draftData] = await Promise.all([
    api('/api/snapshot'),
    api('/api/rules'),
    api('/api/drafts')
  ]);
  state = { ...snapshot, rules: ruleData.rules, drafts: draftData.drafts };
  render();
}

function render() {
  renderSummary();
  renderProducts();
  renderRules();
  renderDrafts();
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
    const short = product.available + product.incoming < product.minimum_order_quantity;
    return `
      <tr>
        <td>
          <strong>${escapeHtml(product.sku)}</strong>
          <div>${escapeHtml(product.name)}</div>
          <div class="muted">${escapeHtml(product.category)}</div>
        </td>
        <td>${escapeHtml(product.supplier_name)}</td>
        <td class="${short ? 'risk' : ''}">
          ${product.on_hand} on hand · ${product.reserved} reserved
          <div class="muted">${product.incoming} incoming · ${product.available} available</div>
        </td>
        <td>
          case ${product.case_size} · min ${product.minimum_order_quantity}
          <div class="muted">${product.lead_time_days}d lead · cap ${product.capacity}</div>
        </td>
        <td>${money(product.unit_price_cents, product.currency)}</td>
        <td><button onclick="editProduct(${product.id})">Edit</button></td>
      </tr>`;
  }).join('');
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

const PRODUCT_NUMBER_FIELDS = [
  'id', 'supplier_id', 'on_hand', 'reserved', 'incoming', 'capacity',
  'case_size', 'minimum_order_quantity', 'lead_time_days', 'unit_price_cents'
];

const productForm = $('#product-form');

$('#new-product').onclick = () => openProduct();
window.editProduct = id => openProduct(state.products.find(product => product.id === id));

function openProduct(product = {}) {
  productForm.reset();
  for (const [field, value] of Object.entries(product)) {
    if (productForm.elements[field]) productForm.elements[field].value = value;
  }
  productForm.elements.supplier_id.innerHTML = state.suppliers
    .map(supplier => `<option value="${supplier.id}">${escapeHtml(supplier.name)}</option>`)
    .join('');
  if (product.supplier_id) productForm.elements.supplier_id.value = product.supplier_id;
  $('#product-dialog').showModal();
}

$('#save-product').onclick = async event => {
  event.preventDefault();
  if (!productForm.reportValidity()) return;
  const data = Object.fromEntries(new FormData(productForm));
  for (const field of PRODUCT_NUMBER_FIELDS) data[field] = Number(data[field] || 0);
  data.enabled = true;
  await post('/api/products', data);
  $('#product-dialog').close();
  await refresh();
  toast('Product saved');
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
};

$('#new-skill').onclick = () => {
  $('#skill-name').value = '';
  $('#skill-content').value = '# New planning skill\n\n';
};

$('#save-skill').onclick = async () => {
  await post('/api/skills', { name: $('#skill-name').value, content: $('#skill-content').value });
  await loadSkills();
  toast('Skill saved');
};

$('#delete-skill').onclick = async () => {
  const name = $('#skill-name').value;
  if (!name || !confirm(`Delete ${name}?`)) return;
  const result = await post('/api/skills/delete', { name });
  if (!result.ok) return toast('This built-in skill cannot be deleted');
  $('#skill-name').value = '';
  $('#skill-content').value = '';
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
