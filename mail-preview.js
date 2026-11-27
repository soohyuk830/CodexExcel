const mailDialog = document.querySelector('#mail-preview-dialog');
const mailClose = document.querySelector('#close-mail-preview');
const mailForm = document.querySelector('#mail-preview-form');
const mailStatus = document.querySelector('#mail-preview-status');
const mailRecipient = document.querySelector('#mail-preview-recipient');
const mailSubject = document.querySelector('#mail-preview-subject');
const mailBody = document.querySelector('#mail-preview-body');
const mailCreate = document.querySelector('#create-mail-preview');
const mailDownload = document.querySelector('#download-mail-preview');
let mailOpener;
let mailLoad;
let mailDraft;
let mailCreating = false;

function setMailStatus(message, state = '') {
  mailStatus.textContent = message;
  mailStatus.dataset.state = state;
}

function showMailDraft(draft) {
  mailDraft = draft;
  mailRecipient.value = draft.recipient;
  mailSubject.textContent = draft.subject;
  mailBody.textContent = draft.body;
  const created = Boolean(draft.downloadUrl);
  mailRecipient.readOnly = created;
  mailCreate.hidden = created;
  mailDownload.hidden = !created;
  if (created) {
    mailDownload.href = draft.downloadUrl;
    mailDownload.download = `order-${draft.requestId}.eml`;
  } else {
    mailDownload.removeAttribute('href');
  }
  mailForm.hidden = false;
}

document.addEventListener('click', async (event) => {
  const opener = event.target.closest('button[data-mail-request-id]');
  if (!opener || mailDialog.open) return;
  mailLoad?.abort();
  const load = new AbortController();
  mailLoad = load;
  mailOpener = opener;
  mailDraft = null;
  mailForm.hidden = true;
  setMailStatus('저장된 주문에서 미리보기를 불러오는 중입니다.');
  mailDialog.showModal();

  try {
    const id = encodeURIComponent(opener.dataset.mailRequestId);
    const response = await fetch(`/api/orders/${id}/mail-preview`, { signal: load.signal });
    const data = await response.json();
    if (load.signal.aborted || !mailDialog.open) return;
    if (!response.ok) throw new Error(data.error || '메일 미리보기를 불러오지 못했습니다.');
    showMailDraft(data);
    setMailStatus(data.downloadUrl ? '이미 만들어 둔 미리보기입니다. 실제 발송은 하지 않았습니다.' : '');
  } catch (error) {
    if (!load.signal.aborted && mailDialog.open) {
      setMailStatus(error instanceof TypeError ? '미리보기를 불러오지 못했습니다. 다시 열어 주세요.' : error.message, 'error');
    }
  }
});

mailClose.addEventListener('click', () => mailDialog.close());
mailDialog.addEventListener('cancel', (event) => {
  if (mailCreating) event.preventDefault();
});
mailDialog.addEventListener('close', () => {
  if (mailDialog.open) return;
  mailLoad?.abort();
  if (mailOpener?.isConnected) mailOpener.focus();
});

mailForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!mailDraft || mailDraft.downloadUrl || mailCreating) return;
  mailCreating = true;
  mailCreate.disabled = true;
  mailClose.disabled = true;
  mailRecipient.readOnly = true;
  setMailStatus('미리보기 파일을 만드는 중입니다.');

  try {
    const id = encodeURIComponent(mailDraft.requestId);
    const response = await fetch(`/api/orders/${id}/mail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: mailRecipient.value.trim(), version: mailDraft.version }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '미리보기 파일을 만들지 못했습니다.');
    showMailDraft(data);
    setMailStatus(data.created
      ? '.eml 파일을 만들었습니다. 실제 발송은 하지 않았습니다.'
      : '이미 만든 .eml 파일을 사용합니다. 실제 발송은 하지 않았습니다.');
    mailDownload.focus();
  } catch (error) {
    setMailStatus(error instanceof TypeError ? '파일 생성 결과를 확인하지 못했습니다. 같은 수신자로 다시 시도해 주세요.' : error.message, 'error');
  } finally {
    mailCreating = false;
    mailCreate.disabled = false;
    mailClose.disabled = false;
    mailRecipient.readOnly = Boolean(mailDraft.downloadUrl);
  }
});
