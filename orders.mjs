import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const orderDirectory = new URL('./excel/', import.meta.url);
const orderFile = new URL('주문내역.xlsx', orderDirectory);
const orderFields = new Map([
  ['요청ID', 'requestId'], ['접수일시', 'submittedAt'],
  ['거래처코드', 'customerCode'], ['거래처명', 'customerName'], ['담당자', 'contact'],
  ['품목코드', 'itemCode'], ['품목명', 'itemName'], ['규격', 'spec'],
  ['재질코드', 'materialCode'], ['재질명', 'materialName'], ['적용밀도_g_cm3', 'densityGPerCm3'],
  ['개당부피_cm3', 'volumeCm3'], ['수량', 'quantity'],
  ['개당중량_kg', 'unitWeightKg'], ['총중량_kg', 'totalWeightKg'],
]);
const columns = [...orderFields.keys()];
const fields = [...orderFields.values()];
const inputFields = ['customerCode', 'itemCode', 'materialCode', 'volumeCm3', 'quantity'];
let orderWrite = Promise.resolve();

export class OrderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validateRequestId(requestId) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof requestId !== 'string' || !uuid.test(requestId)) throw new OrderError(400, '요청ID 형식이 올바르지 않습니다.');
  return requestId.toLowerCase();
}

export async function readJsonObject(request) {
  const contentType = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new OrderError(415, '요청은 JSON으로 보내 주세요.');
  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 4096) {
      request.resume();
      throw new OrderError(413, '요청이 너무 큽니다.');
    }
    chunks.push(chunk);
  }

  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new OrderError(400, '요청 형식이 올바르지 않습니다.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new OrderError(400, '요청 형식이 올바르지 않습니다.');
  }
  return data;
}

export async function readOrderInput(request) {
  const data = await readJsonObject(request);
  const { volumeCm3, quantity } = data;
  const readCode = (key, label) => {
    const code = typeof data[key] === 'string' ? data[key].trim() : '';
    if (!code) throw new OrderError(400, `${label} 코드를 선택해 주세요.`);
    return code;
  };
  const customerCode = readCode('customerCode', '거래처');
  const itemCode = readCode('itemCode', '품목');
  const materialCode = readCode('materialCode', '재질');
  if (!Number.isFinite(volumeCm3) || volumeCm3 <= 0) throw new OrderError(400, '개당 부피는 0보다 커야 합니다.');
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new OrderError(400, '수량은 1 이상의 정수여야 합니다.');

  const requestId = validateRequestId(data.requestId ?? randomUUID());
  return { requestId, customerCode, itemCode, materialCode, volumeCm3, quantity };
}

async function openOrders() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(orderFile));
  const sheet = workbook.getWorksheet('주문');
  if (!sheet || columns.some((column, index) => sheet.getRow(1).getCell(index + 1).value !== column)) {
    throw new Error('주문 시트의 헤더가 주문 양식과 일치하지 않습니다.');
  }
  return { workbook, sheet };
}

function storedRows(sheet) {
  const rows = [];
  sheet.eachRow((row, index) => {
    if (index !== 1 && row.getCell(1).value) {
      rows.push(fields.map((_, column) => row.getCell(column + 1).value ?? null));
    }
  });
  return rows;
}

export async function readOrders() {
  const { sheet } = await openOrders();
  return { columns, rows: storedRows(sheet) };
}

function orderFromRow(row) {
  return Object.fromEntries(fields.map((field, index) => [field, row[index]]));
}

export async function readOrder(id) {
  const requestId = validateRequestId(id);
  const { sheet } = await openOrders();
  const matches = storedRows(sheet).filter(([savedId]) => savedId === requestId);
  if (matches.length !== 1) {
    throw matches.length
      ? new OrderError(409, '같은 요청ID를 가진 주문이 여러 건 있습니다.')
      : new OrderError(404, '해당 요청ID의 주문을 찾을 수 없습니다.');
  }
  return orderFromRow(matches[0]);
}

async function commitOrder(workbook) {
  const pendingFile = new URL(`.orders-${randomUUID()}.tmp`, orderDirectory);
  try {
    const buffer = await workbook.xlsx.writeBuffer();
    await writeFile(pendingFile, buffer, { flag: 'wx', flush: true });
    await rename(pendingFile, orderFile);
  } catch (error) {
    if (['EBUSY', 'EPERM'].includes(error.code)) {
      throw new OrderError(503, '주문 저장 파일을 사용할 수 없습니다. 파일을 열어 둔 경우 닫고 다시 시도해 주세요.');
    }
    throw error;
  } finally {
    await unlink(pendingFile).catch((error) => {
      if (error.code !== 'ENOENT') console.error('임시 주문 파일 정리 실패:', fileURLToPath(pendingFile), error.code);
    });
  }
}

function queueOrderWrite(operation) {
  const write = orderWrite.then(operation);
  orderWrite = write.catch(() => {});
  return write;
}

export function saveOrder(input, loadReferences) {
  return queueOrderWrite(async () => {
    const { workbook, sheet } = await openOrders();
    const existing = storedRows(sheet).find(([requestId]) => requestId === input.requestId);
    if (existing) {
      const order = orderFromRow(existing);
      if (inputFields.some((field) => input[field] !== order[field])) {
        throw new OrderError(409, '같은 요청ID에 다른 주문 값이 이미 저장되어 있습니다.');
      }
      return { order, created: false };
    }

    const reference = await loadReferences(input);
    const unitWeightKg = (input.volumeCm3 * reference.densityGPerCm3) / 1000;
    const totalWeightKg = unitWeightKg * input.quantity;
    if (!(unitWeightKg > 0) || !Number.isFinite(totalWeightKg)) {
      throw new OrderError(422, '입력한 부피와 수량으로 중량을 저장할 수 없습니다.');
    }

    const order = {
      ...input, ...reference, submittedAt: new Date().toISOString(), unitWeightKg, totalWeightKg,
    };
    sheet.addRow(fields.map((field) => order[field]));
    await commitOrder(workbook);
    return { order, created: true };
  });
}

export function deleteOrder(id) {
  const requestId = validateRequestId(id);
  return queueOrderWrite(async () => {
    const { workbook, sheet } = await openOrders();
    const idColumn = columns.indexOf('요청ID') + 1;
    let matchedRow;
    sheet.eachRow((row) => {
      if (row.getCell(idColumn).value !== requestId) return;
      if (matchedRow) throw new OrderError(409, '같은 요청ID를 가진 주문이 여러 건 있어 삭제할 수 없습니다.');
      matchedRow = row;
    });
    if (!matchedRow) throw new OrderError(404, '해당 요청ID의 주문을 찾을 수 없습니다.');

    sheet.spliceRows(matchedRow.number, 1);
    await commitOrder(workbook);
  });
}
