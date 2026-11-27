const workbookViews = {
  materials: { title: '재질 목록', file: '재질정보.xlsx', url: '/api/materials' },
  products: { title: '품목 목록', file: '품목내역.xlsx', url: '/api/products' },
  customers: { title: '거래처 목록', file: '거래처내역.xlsx', url: '/api/customers' },
  orders: { title: '주문 내역', file: '주문내역.xlsx', url: '/api/orders' },
};

const workbookButtons = document.querySelectorAll('[data-workbook]');
const workbookTitle = document.querySelector('#workbook-title');
const workbookSource = document.querySelector('#workbook-source');
const workbookCount = document.querySelector('#workbook-count');
const materialPicker = document.querySelector('#material-picker');
const materialCode = document.querySelector('#material-code');
const materialDensity = document.querySelector('#material-density');
const weightVolume = document.querySelector('#weight-volume');
const weightQuantity = document.querySelector('#weight-quantity');
const unitWeight = document.querySelector('#unit-weight');
const totalWeight = document.querySelector('#total-weight');
const weightMessage = document.querySelector('#weight-message');
const workbookTools = document.querySelector('#workbook-tools');
const workbookSearch = document.querySelector('#workbook-search');
const workbookRefresh = document.querySelector('#workbook-refresh');
const workbookSync = document.querySelector('#workbook-sync');
const workbookMessage = document.querySelector('#workbook-message');
const workbookRetry = document.querySelector('#workbook-retry');
const workbookTable = document.querySelector('#workbook-table');
const tableHead = workbookTable.querySelector('thead');
const tableBody = workbookTable.querySelector('tbody');
const numberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 12 });
const weightNumberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 });
const weightUnits = [
  { label: 'kg', kgPerUnit: 1 },
  { label: 'g', kgPerUnit: 1e-3 },
  { label: 'mg', kgPerUnit: 1e-6 },
  { label: 'µg', kgPerUnit: 1e-9 },
];
const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });
const refreshInterval = 15_000;
let selectedWorkbook = 'materials';
let pendingRequest;
let currentTable;
let currentSignature;
let densityByCode = new Map();
let sortColumn = -1;
let sortAscending = true;

function formatWeight(kg) {
  if (kg === undefined) return '—';
  if (kg === 0) return '0 g';

  const { label, kgPerUnit } = weightUnits.find((unit) => kg >= unit.kgPerUnit) ?? weightUnits.at(-1);
  const amount = kg / kgPerUnit;
  const formatted = amount < 0.001 || amount >= 1e12
    ? amount.toExponential(3)
    : weightNumberFormat.format(amount);
  return `${formatted} ${label}`;
}

function showWeight(message, unitKg, totalKg) {
  unitWeight.value = formatWeight(unitKg);
  totalWeight.value = formatWeight(totalKg);
  if (weightMessage.textContent !== message) weightMessage.textContent = message;
  weightMessage.hidden = !message;
}

function calculateWeight() {
  const density = densityByCode.get(materialCode.value);
  const volume = weightVolume.valueAsNumber;
  const quantity = weightQuantity.valueAsNumber;

  if (density === undefined) return showWeight('재질을 선택하세요.');
  if (!Number.isFinite(density) || density < 0) return showWeight('선택한 재질의 밀도를 확인하세요.');
  if (weightVolume.value === '' && !weightVolume.validity.badInput) {
    return showWeight('개당 부피를 입력하세요.');
  }
  if (!Number.isFinite(volume) || volume <= 0) return showWeight('개당 부피는 0보다 커야 합니다.');
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return showWeight('수량은 1 이상의 정수로 입력하세요.');
  }

  const unroundedUnitKg = (volume * density) / 1000;
  const totalKg = unroundedUnitKg * quantity;
  if (!Number.isFinite(totalKg)) return showWeight('입력값이 너무 커서 중량을 계산할 수 없습니다.');
  showWeight('', unroundedUnitKg, totalKg);
}

function updateSelectedDensity() {
  const density = densityByCode.get(materialCode.value);
  materialDensity.value = density == null ? '' : String(density);
  calculateWeight();
}

function renderMaterialOptions(materials) {
  const selectedCode = materialCode.value;
  densityByCode = new Map(materials.map(({ code, densityGPerCm3 }) => [code, densityGPerCm3]));

  materialCode.replaceChildren(
    new Option('재질을 선택하세요', ''),
    ...materials.map(({ code, name }) => new Option(name, code)),
  );
  materialCode.value = densityByCode.has(selectedCode) ? selectedCode : '';
  materialCode.disabled = materials.length === 0;
  updateSelectedDensity();
}

function toTable(workbook, data) {
  if (workbook !== 'materials') return data;

  return {
    columns: ['재질코드', '재질명', '계산용 밀도 (g/cm³)', '사용여부', '비고'],
    rows: data.materials.map(({ code, name, densityGPerCm3, active, notes }) => [
      code, name, densityGPerCm3, active ? 'Y' : 'N', notes,
    ]),
  };
}

function renderHeaders(columns) {
  const header = document.createElement('tr');
  if (selectedWorkbook === 'orders') {
    const actions = document.createElement('th');
    actions.scope = 'col';
    actions.className = 'order-row-actions';
    actions.textContent = '관리';
    header.append(actions);
  }
  for (const [index, label] of columns.entries()) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'column-sort';
    button.textContent = label;
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    button.append(arrow);
    button.addEventListener('click', () => {
      sortAscending = sortColumn !== index || !sortAscending;
      sortColumn = index;
      renderCurrentView();
    });
    cell.append(button);
    header.append(cell);
  }
  tableHead.replaceChildren(header);
}

function renderSortDirection() {
  for (const [index, button] of Array.from(tableHead.querySelectorAll('.column-sort')).entries()) {
    const cell = button.parentElement;
    const arrow = button.querySelector('span');
    if (index === sortColumn) {
      cell.setAttribute('aria-sort', sortAscending ? 'ascending' : 'descending');
      arrow.textContent = sortAscending ? '↑' : '↓';
    } else {
      cell.removeAttribute('aria-sort');
      arrow.textContent = '↕';
    }
  }
}

function statusText(column, value) {
  if (column !== '사용여부') return '';
  if (value === 'Y') return '사용';
  if (value === 'N') return '미사용';
  return '';
}

function renderRows(columns, rows) {
  const body = document.createDocumentFragment();
  const orderColumns = selectedWorkbook === 'orders'
    ? ['요청ID', '거래처명', '품목명'].map((label) => columns.indexOf(label))
    : null;
  for (const values of rows) {
    const row = document.createElement('tr');
    if (orderColumns) {
      const [id, customer, item] = orderColumns.map((index) => values[index]);
      const action = document.createElement('td');
      action.className = 'order-row-actions';
      if (id) {
        const mail = document.createElement('button');
        mail.type = 'button';
        mail.className = 'outline-button';
        mail.textContent = '메일';
        mail.dataset.mailRequestId = id;
        mail.setAttribute('aria-label', `주문 ${id} 메일 미리보기`);
        mail.setAttribute('aria-haspopup', 'dialog');
        mail.setAttribute('aria-controls', 'mail-preview-dialog');
        action.append(mail);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'outline-button danger-button';
        button.textContent = '삭제';
        button.dataset.orderRequestId = id;
        button.dataset.orderCustomer = customer ?? '';
        button.dataset.orderItem = item ?? '';
        button.setAttribute('aria-label', `주문 ${id} 삭제`);
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', 'order-delete-dialog');
        action.append(button);
      }
      row.append(action);
    }
    for (const [index, value] of values.entries()) {
      const cell = document.createElement('td');
      const label = statusText(columns[index], value);

      if (label) {
        const status = document.createElement('span');
        status.className = value === 'Y' ? 'status active' : 'status';
        status.textContent = label;
        cell.append(status);
      } else if (typeof value === 'number') {
        cell.className = 'numeric';
        cell.textContent = numberFormat.format(value);
      } else {
        cell.textContent = value == null || value === '' ? '—' : value;
      }

      row.append(cell);
    }
    body.append(row);
  }
  tableBody.replaceChildren(body);
}

function searchText(value) {
  return String(value ?? '').normalize('NFC').toLocaleLowerCase('ko-KR');
}

function compareCells(left, right) {
  const leftBlank = left == null || left === '';
  const rightBlank = right == null || right === '';
  if (leftBlank || rightBlank) return Number(leftBlank) - Number(rightBlank);

  const comparison = typeof left === 'number' && typeof right === 'number'
    ? left - right
    : collator.compare(String(left), String(right));
  return sortAscending ? comparison : -comparison;
}

function renderCurrentView() {
  const { columns, rows } = currentTable;
  const query = searchText(workbookSearch.value.trim());
  const visible = query ? rows.filter((row) => row.some((value, index) => {
    const displayed = statusText(columns[index], value)
      || (typeof value === 'number' ? numberFormat.format(value) : value);
    return searchText(displayed).includes(query) || searchText(value).includes(query);
  })) : rows;
  const sorted = sortColumn < 0 ? visible : [...visible].sort((left, right) => (
    compareCells(left[sortColumn], right[sortColumn])
  ));

  workbookCount.textContent = query && rows.length
    ? `${numberFormat.format(visible.length)} / ${numberFormat.format(rows.length)}건`
    : `${numberFormat.format(rows.length)}건`;
  workbookCount.hidden = false;
  workbookSearch.disabled = rows.length === 0;
  workbookTable.hidden = sorted.length === 0;
  workbookMessage.hidden = sorted.length > 0;
  if (rows.length === 0) {
    const emptyMessage = {
      materials: '등록된 재질이 없습니다.',
      orders: '등록된 주문이 없습니다.',
    };
    workbookMessage.textContent = emptyMessage[selectedWorkbook] ?? '표시할 데이터가 없습니다.';
  } else if (visible.length === 0) {
    workbookMessage.textContent = '검색 결과가 없습니다.';
  }

  renderSortDirection();
  renderRows(columns, sorted);
}

function selectWorkbook(key) {
  pendingRequest?.abort();
  pendingRequest = null;
  selectedWorkbook = key;
  if (location.protocol !== 'file:' && location.hash !== `#${key}`) history.replaceState(null, '', `#${key}`);
  const view = workbookViews[key];
  currentTable = null;
  currentSignature = null;
  sortColumn = -1;
  sortAscending = true;

  for (const button of workbookButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.workbook === key));
  }
  workbookTitle.textContent = view.title;
  workbookSource.textContent = view.file;
  materialPicker.hidden = key !== 'materials';
  if (key === 'materials') renderMaterialOptions([]);
  workbookSearch.value = '';
  workbookTools.hidden = true;
  workbookSync.hidden = true;
  document.querySelector('#order-delete-feedback').hidden = true;
  workbookCount.hidden = true;
  workbookTable.scrollLeft = 0;
  workbookTable.hidden = true;
  workbookRetry.hidden = true;
  workbookMessage.hidden = false;

  if (location.protocol === 'file:') {
    workbookMessage.textContent = '엑셀 데이터를 보려면 로컬 서버 주소에서 이 페이지를 열어 주세요.';
    return;
  }

  workbookMessage.textContent = '엑셀 데이터를 불러오는 중입니다.';
  refreshWorkbook();
}

async function refreshWorkbook({ force = false } = {}) {
  if (location.protocol === 'file:' || (pendingRequest && !force)) return false;
  pendingRequest?.abort();
  const request = new AbortController();
  const { signal } = request;
  const key = selectedWorkbook;
  pendingRequest = request;
  workbookRefresh.disabled = true;

  try {
    const response = await fetch(workbookViews[key].url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (signal.aborted) return false;

    const table = toTable(key, data);
    const signature = JSON.stringify(table);
    if (signature !== currentSignature) {
      if (!currentTable || JSON.stringify(table.columns) !== JSON.stringify(currentTable.columns)) {
        const sortedLabel = currentTable?.columns[sortColumn];
        sortColumn = table.columns.indexOf(sortedLabel);
        renderHeaders(table.columns);
      }
      currentTable = table;
      currentSignature = signature;
      renderCurrentView();
      if (key === 'materials') renderMaterialOptions(data.materials);
    }
    workbookTools.hidden = false;
    workbookSync.hidden = true;
    workbookRetry.hidden = true;
    return true;
  } catch {
    if (signal.aborted) return false;
    if (currentTable) {
      workbookSync.textContent = key === 'materials'
        ? '재질 목록을 다시 읽지 못해 마지막으로 불러온 데이터를 표시합니다.'
        : '엑셀을 다시 읽지 못해 마지막으로 불러온 데이터를 표시합니다.';
      workbookSync.hidden = false;
    } else {
      workbookMessage.textContent = key === 'materials'
        ? '재질 목록 조회에 실패했습니다.'
        : '엑셀 데이터를 불러오지 못했습니다.';
      workbookRetry.hidden = false;
    }
    return false;
  } finally {
    if (pendingRequest === request) {
      pendingRequest = null;
      workbookRefresh.disabled = false;
    }
  }
}

const hosted = document.body.hasAttribute('data-hosted');
if (hosted) {
  document.querySelector('#hosted-notice').hidden = false;
  document.querySelector('[data-workbook="orders"]').disabled = true;
  document.querySelector('#submit-order').hidden = true;
}

for (const button of workbookButtons) {
  button.addEventListener('click', () => {
    if (button.dataset.workbook !== selectedWorkbook) selectWorkbook(button.dataset.workbook);
  });
}
materialCode.addEventListener('change', updateSelectedDensity);
weightVolume.addEventListener('input', calculateWeight);
weightQuantity.addEventListener('input', calculateWeight);
workbookSearch.addEventListener('input', renderCurrentView);
workbookRefresh.addEventListener('click', refreshWorkbook);
workbookRetry.addEventListener('click', refreshWorkbook);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshWorkbook();
});
setInterval(() => {
  if (!document.hidden) refreshWorkbook();
}, refreshInterval);
const initialWorkbook = location.hash.slice(1);
const canOpenWorkbook = Object.hasOwn(workbookViews, initialWorkbook) && !(hosted && initialWorkbook === 'orders');
selectWorkbook(canOpenWorkbook ? initialWorkbook : selectedWorkbook);
