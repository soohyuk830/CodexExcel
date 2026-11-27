const itemDialog = document.querySelector('#item-picker');
const itemDialogTitle = document.querySelector('#item-picker-title');
const itemSearchForm = document.querySelector('#item-search-form');
const itemQuery = document.querySelector('#item-query');
const itemSearchMessage = document.querySelector('#item-search-message');
const itemSearchResults = document.querySelector('#item-search-results');
const itemSearchRows = document.querySelector('#item-search-rows');
const itemSearchHeadings = itemSearchResults.querySelectorAll('thead th:not(:first-child)');
const confirmItemPicker = document.querySelector('#confirm-item-picker');
const pickerOptions = [
  {
    opener: document.querySelector('#open-item-picker'),
    summary: document.querySelector('#selected-item'),
    empty: document.querySelector('#item-unselected'),
    label: '품목',
    path: '/api/items',
    columns: ['코드', '품목명', '규격'],
    getRows: (data) => data.items.map(({ code, name, spec }) => [code, name, spec]),
  },
  {
    opener: document.querySelector('#open-customer-picker'),
    summary: document.querySelector('#selected-customer'),
    empty: document.querySelector('#customer-unselected'),
    label: '거래처',
    path: '/api/customers',
    columns: ['거래처코드', '거래처명', '담당자'],
    getRows: (data) => data.rows,
  },
];
let activePicker;
let itemSearchTimer;
let itemSearchRequest;
let draftRecord;

function clearItemSearch() {
  clearTimeout(itemSearchTimer);
  itemSearchRequest?.abort();
  draftRecord = null;
  confirmItemPicker.disabled = true;
  itemSearchResults.hidden = true;
  itemSearchRows.replaceChildren();
}

function renderSearchResults(records) {
  const rows = document.createDocumentFragment();
  for (const record of records) {
    const [code, name] = record;
    const row = document.createElement('tr');
    const choiceCell = document.createElement('td');
    const choice = document.createElement('input');
    choice.type = 'radio';
    choice.name = 'item-candidate';
    choice.value = code;
    choice.setAttribute('aria-label', `${code} ${name}`);
    choice.addEventListener('change', () => {
      draftRecord = record;
      confirmItemPicker.disabled = false;
    });
    row.addEventListener('click', (event) => {
      if (event.target !== choice) choice.click();
    });
    choiceCell.append(choice);
    row.append(choiceCell);

    for (const value of record) {
      const cell = document.createElement('td');
      cell.textContent = value || '—';
      row.append(cell);
    }
    rows.append(row);
  }
  itemSearchRows.replaceChildren(rows);
  itemSearchResults.hidden = records.length === 0;
  itemSearchMessage.textContent = records.length
    ? `검색 결과 ${records.length.toLocaleString('ko-KR')}건`
    : '검색 결과가 없습니다.';
}

async function searchRecords() {
  clearItemSearch();
  if (!itemDialog.open) return;

  const request = new AbortController();
  const picker = activePicker;
  itemSearchRequest = request;
  itemSearchMessage.textContent = `${picker.label} 검색 중입니다.`;

  try {
    const params = new URLSearchParams({ q: itemQuery.value.trim() });
    const response = await fetch(`${picker.path}?${params}`, { signal: request.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!request.signal.aborted && itemDialog.open) renderSearchResults(picker.getRows(data));
  } catch {
    if (!request.signal.aborted && itemDialog.open) {
      itemSearchMessage.textContent = `${picker.label} 조회에 실패했습니다. 다시 검색하세요.`;
    }
  } finally {
    if (itemSearchRequest === request) itemSearchRequest = null;
  }
}

function scheduleItemSearch() {
  if (!itemDialog.open) return;
  clearItemSearch();
  itemSearchMessage.textContent = `${activePicker.label} 검색 중입니다.`;
  itemSearchTimer = setTimeout(searchRecords, 220);
}

for (const picker of pickerOptions) {
  picker.opener.addEventListener('click', () => {
    activePicker = picker;
    itemDialogTitle.textContent = `${picker.label} 검색`;
    itemSearchResults.setAttribute('aria-label', `${picker.label} 검색 결과`);
    itemSearchHeadings.forEach((heading, index) => {
      heading.textContent = picker.columns[index];
    });
    itemQuery.placeholder = `${picker.columns.join('·')} 검색`;
    itemQuery.value = '';
    itemDialog.showModal();
    searchRecords();
  });
}
itemSearchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  searchRecords();
});
itemQuery.addEventListener('input', (event) => {
  if (!event.isComposing) scheduleItemSearch();
});
itemQuery.addEventListener('compositionend', scheduleItemSearch);

document.querySelector('#close-item-picker').addEventListener('click', () => itemDialog.close());
document.querySelector('#cancel-item-picker').addEventListener('click', () => itemDialog.close());
itemDialog.addEventListener('close', () => {
  if (itemDialog.open) return;
  clearItemSearch();
  activePicker?.opener.focus();
  activePicker = null;
});

confirmItemPicker.addEventListener('click', () => {
  if (!draftRecord) return;

  activePicker.summary.querySelectorAll('dd').forEach((detail, index) => {
    detail.textContent = draftRecord[index] || '—';
  });
  activePicker.empty.hidden = true;
  activePicker.summary.hidden = false;
  itemDialog.close();
});
