const orderSubmit = document.querySelector('#submit-order');
const orderFeedback = document.querySelector('#order-feedback');
const showOrders = document.querySelector('#show-orders');
const previewSavedOrder = document.querySelector('#preview-saved-order');
let pendingSubmission;

function showOrderFeedback(message, state) {
  orderFeedback.textContent = message;
  orderFeedback.dataset.state = state;
  orderFeedback.hidden = false;
}

orderSubmit.addEventListener('click', async () => {
  const input = {
    customerCode: document.querySelector('#selected-customer-code').textContent,
    itemCode: document.querySelector('#selected-item-code').textContent,
    materialCode: document.querySelector('#material-code').value,
    volumeCm3: document.querySelector('#weight-volume').valueAsNumber,
    quantity: document.querySelector('#weight-quantity').valueAsNumber,
  };
  if (!input.customerCode || !input.itemCode || !input.materialCode) {
    return showOrderFeedback('거래처, 품목, 재질을 모두 선택해 주세요.', 'error');
  }
  if (!Number.isFinite(input.volumeCm3) || input.volumeCm3 <= 0) {
    return showOrderFeedback('개당 부피는 0보다 커야 합니다.', 'error');
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
    return showOrderFeedback('수량은 1 이상의 정수여야 합니다.', 'error');
  }

  const key = JSON.stringify(input);
  if (pendingSubmission?.key !== key) pendingSubmission = { key, requestId: crypto.randomUUID() };
  orderSubmit.disabled = true;
  showOrders.hidden = true;
  showOrderFeedback('주문을 저장하는 중입니다.', 'pending');

  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, requestId: pendingSubmission.requestId }),
    });
    const result = await response.json();
    if (!response.ok) {
      return showOrderFeedback(result.error || '주문을 저장하지 못했습니다. 다시 시도해 주세요.', 'error');
    }

    const { requestId } = result.order;
    pendingSubmission = null;
    showOrders.hidden = false;
    previewSavedOrder.dataset.mailRequestId = requestId;
    previewSavedOrder.hidden = false;
    try {
      const list = await fetch('/api/orders');
      if (!list.ok) throw new Error(`HTTP ${list.status}`);
      const { columns, rows } = await list.json();
      const idColumn = columns.indexOf('요청ID');
      if (!rows.some((row) => row[idColumn] === requestId)) throw new Error('Missing saved order');
      showOrderFeedback(`주문을 저장했습니다. 요청ID ${requestId}`, 'success');
    } catch {
      showOrderFeedback(`주문을 저장했지만 목록을 다시 읽지 못했습니다. 요청ID ${requestId}`, 'error');
    }
  } catch {
    showOrderFeedback('저장 결과를 확인하지 못했습니다. 같은 입력으로 다시 시도해 주세요.', 'error');
  } finally {
    orderSubmit.disabled = false;
  }
});

showOrders.addEventListener('click', () => document.querySelector('[data-workbook="orders"]').click());
