const orderDeleteDialog = document.querySelector('#order-delete-dialog');
const orderDeleteCancel = document.querySelector('#cancel-delete-order');
const orderDeleteConfirm = document.querySelector('#confirm-delete-order');
const orderDeleteError = document.querySelector('#order-delete-error');
const orderDeleteFeedback = document.querySelector('#order-delete-feedback');
let orderDeleteOpener;
let orderDeleteRunning = false;

workbookTable.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-order-request-id]');
  if (!button) return;

  orderDeleteOpener = button;
  document.querySelector('#delete-order-id').textContent = button.dataset.orderRequestId;
  document.querySelector('#delete-order-customer').textContent = button.dataset.orderCustomer || '—';
  document.querySelector('#delete-order-item').textContent = button.dataset.orderItem || '—';
  orderDeleteError.hidden = true;
  orderDeleteFeedback.hidden = true;
  orderDeleteDialog.showModal();
});

orderDeleteCancel.addEventListener('click', () => orderDeleteDialog.close());
orderDeleteDialog.addEventListener('cancel', (event) => {
  if (orderDeleteRunning) event.preventDefault();
});
orderDeleteDialog.addEventListener('close', () => {
  const fallback = document.querySelector('[data-workbook="orders"]');
  (orderDeleteOpener?.isConnected ? orderDeleteOpener : fallback).focus();
});

orderDeleteConfirm.addEventListener('click', async () => {
  if (orderDeleteRunning || !orderDeleteOpener) return;
  const id = orderDeleteOpener.dataset.orderRequestId;
  orderDeleteRunning = true;
  orderDeleteConfirm.disabled = true;
  orderDeleteCancel.disabled = true;
  orderDeleteError.hidden = true;

  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || '주문을 삭제하지 못했습니다. 다시 시도해 주세요.');
    }

    const refreshed = await refreshWorkbook({ force: true });
    orderDeleteFeedback.textContent = refreshed
      ? '주문을 삭제했습니다.'
      : '주문은 삭제됐습니다. 목록을 다시 불러와 주세요.';
    orderDeleteFeedback.hidden = false;
    orderDeleteDialog.close();
  } catch (error) {
    orderDeleteError.textContent = error instanceof TypeError
      ? '삭제 결과를 확인하지 못했습니다. 주문 목록을 확인해 주세요.'
      : error.message;
    orderDeleteError.hidden = false;
  } finally {
    orderDeleteRunning = false;
    orderDeleteConfirm.disabled = false;
    orderDeleteCancel.disabled = false;
  }
});
