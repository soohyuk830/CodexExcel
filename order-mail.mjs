import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { OrderError } from './orders.mjs';

const directory = new URL('./data/mail-preview/', import.meta.url);
const subject = '[CodexExcel] 중량 견적 요청';
const detailNumber = new Intl.NumberFormat('ko-KR', { maximumSignificantDigits: 15 });
const weightNumber = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 });
const receiptTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
});
const weightUnits = [
  ['kg', 1], ['g', 1e-3], ['mg', 1e-6], ['µg', 1e-9],
];

function mailbox(value) {
  const address = typeof value === 'string' ? value.trim() : '';
  if (address.length > 254) return '';
  const parts = address.split('@');
  if (parts.length !== 2) return '';
  const [local, domain] = parts;
  const localAtom = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/;
  const domainLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  const domainParts = domain.split('.');
  if (local.length > 64 || !local.split('.').every((part) => localAtom.test(part))) return '';
  if (domainParts.length < 2 || !domainParts.every((part) => domainLabel.test(part))) return '';
  return `${local}@${domain.toLowerCase()}`;
}

function describe(requestId, recipient, draftSubject, body) {
  const normalizedBody = body.replace(/\r\n?/g, '\n');
  const version = createHash('sha256').update(JSON.stringify([draftSubject, normalizedBody])).digest('hex');
  return { requestId, mode: 'preview', recipient, subject: draftSubject, body: normalizedBody, version };
}

function readableWeight(kg) {
  if (!Number.isFinite(kg) || kg < 0) return '—';
  if (kg === 0) return '0 g';
  const [unit, scale] = weightUnits.find(([, threshold]) => kg >= threshold) ?? weightUnits.at(-1);
  const amount = kg / scale;
  const displayed = amount < 0.001 || amount >= 1e12 ? amount.toExponential(3) : weightNumber.format(amount);
  return `${displayed} ${unit}`;
}

function readableTime(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? `${receiptTime.format(date)} (한국시간)` : value || '—';
}

function draftFromOrder(order, recipient = '') {
  const body = [
    '안녕하세요.', '',
    '아래 품목의 견적을 요청드립니다.', '',
    '[품목과 수량]',
    `품목: ${order.itemName} (${order.itemCode})`,
    `규격: ${order.spec || '—'}`,
    `수량: ${detailNumber.format(order.quantity)}개`,
    `총중량: ${readableWeight(order.totalWeightKg)}`, '',
    '[중량 계산 기준]',
    `재질: ${order.materialName} (${order.materialCode})`,
    `개당 부피: ${detailNumber.format(order.volumeCm3)} cm³`,
    `적용 밀도: ${detailNumber.format(order.densityGPerCm3)} g/cm³`,
    `개당 중량: ${readableWeight(order.unitWeightKg)}`, '',
    '[접수 정보]',
    `거래처: ${order.customerName} (${order.customerCode})`,
    `담당자: ${order.contact || '—'}`,
    `접수일시: ${readableTime(order.submittedAt)}`,
    `요청ID: ${order.requestId}`, '',
    '감사합니다.',
  ].join('\n');
  return describe(order.requestId, mailbox(recipient), subject, body);
}

function fileFor(id) {
  return new URL(`${id}.eml`, directory);
}

async function readSaved(id) {
  try {
    return await readFile(fileFor(id));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function describeSaved(id, bytes) {
  const [headers, payload] = bytes.toString('ascii').split('\r\n\r\n', 2);
  const recipient = headers.match(/^To: ([^\r\n]+)$/m)?.[1];
  const encodedSubject = headers.match(/^Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/m)?.[1];
  if (!recipient || !encodedSubject || !payload) throw new Error('저장된 메일 미리보기 형식이 올바르지 않습니다.');
  const draftSubject = Buffer.from(encodedSubject, 'base64').toString('utf8');
  const body = Buffer.from(payload, 'base64').toString('utf8').replaceAll('\r\n', '\n');
  return {
    ...describe(id, recipient, draftSubject, body),
    downloadUrl: `/api/orders/${id}/mail-preview.eml`,
  };
}

export async function getMailPreview(order, loadRecipient) {
  const saved = await readSaved(order.requestId);
  return saved
    ? describeSaved(order.requestId, saved)
    : draftFromOrder(order, await loadRecipient(order.customerCode));
}

function eml(preview, recipient) {
  const date = new Date().toUTCString().replace(/GMT$/, '+0000');
  const encodedSubject = Buffer.from(preview.subject).toString('base64');
  const encodedBody = Buffer.from(preview.body.replace(/\r?\n/g, '\r\n')).toString('base64');
  return [
    `Date: ${date}`,
    'From: CodexExcel Preview <preview@codexexcel.invalid>',
    `To: ${recipient}`,
    `Subject: =?UTF-8?B?${encodedSubject}?=`,
    `Message-ID: <${preview.requestId}@codexexcel.invalid>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'X-CodexExcel-Mode: preview', '',
    ...encodedBody.match(/.{1,76}/g), '',
  ].join('\r\n');
}

function reusePreview(id, bytes, recipient, version) {
  const previous = describeSaved(id, bytes);
  if (previous.recipient !== recipient || previous.version !== version) {
    throw new OrderError(409, '이 주문에 이미 다른 내용으로 만든 미리보기가 있습니다. 창을 다시 열어 기존 파일을 확인해 주세요.');
  }
  return { ...previous, created: false };
}

export async function createMailPreview(order, input) {
  const recipient = mailbox(input.recipient);
  if (!recipient) throw new OrderError(400, '유효한 이메일 주소 한 개를 입력해 주세요.');
  const id = order.requestId;
  const saved = await readSaved(id);
  if (saved) return reusePreview(id, saved, recipient, input.version);

  const draft = draftFromOrder(order);
  if (input.version !== draft.version) {
    throw new OrderError(409, '주문 내용이 바뀌었습니다. 미리보기를 다시 열어 확인해 주세요.');
  }

  await mkdir(directory, { recursive: true });
  const temporary = new URL(`.preview-${randomUUID()}.tmp`, directory);
  const contents = Buffer.from(eml(draft, recipient));
  try {
    await writeFile(temporary, contents, { flag: 'wx', flush: true });
    try {
      await link(temporary, fileFor(id));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return reusePreview(id, await readFile(fileFor(id)), recipient, input.version);
    }
    return { ...describeSaved(id, contents), created: true };
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') console.error('임시 메일 파일 정리 실패:', error.code);
    });
  }
}

export async function downloadMailPreview(id) {
  const file = await readSaved(id);
  if (!file) throw new OrderError(404, '먼저 메일 미리보기 파일을 만들어 주세요.');
  return file;
}
