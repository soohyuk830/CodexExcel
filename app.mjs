import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSheet } from 'read-excel-file/node';
import { OrderError, deleteOrder, readJsonObject, readOrder, readOrderInput, readOrders, saveOrder } from './orders.mjs';
import { createMailPreview, downloadMailPreview, getMailPreview } from './order-mail.mjs';

const staticFiles = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/script.js', ['script.js', 'text/javascript']],
  ['/item-picker.js', ['item-picker.js', 'text/javascript']],
  ['/order-submit.js', ['order-submit.js', 'text/javascript']],
  ['/order-delete.js', ['order-delete.js', 'text/javascript']],
  ['/mail-preview.js', ['mail-preview.js', 'text/javascript']],
]);
const productSource = { file: '품목내역.xlsx', sheet: '품목' };
const customerSource = { file: '거래처내역.xlsx', sheet: '거래처' };
const productSearchColumns = ['품목코드', '품목명', '규격'];
const customerSearchColumns = ['거래처코드', '거래처명', '담당자'];
const localWorkbookDirectory = fileURLToPath(new URL('./excel/', import.meta.url));
const workbookRoutes = new Map([
  ['/api/products', productSource],
  ['/api/customers', customerSource],
]);

function readWorkbook(file, sheet, directory = localWorkbookDirectory) {
  return readSheet(join(directory, file), sheet);
}

function hasValues(row) {
  return row.some((cell) => cell != null && String(cell).trim() !== '');
}

async function readTable({ file, sheet }, directory) {
  const [headers = [], ...rows] = await readWorkbook(file, sheet, directory);
  const columns = headers.flatMap((header, index) => {
    const label = String(header ?? '').trim();
    return label ? [{ label, index }] : [];
  });

  if (columns.length === 0) throw new Error(`${sheet} 시트에 열 제목이 없습니다.`);

  return {
    columns: columns.map(({ label }) => label),
    rows: rows.map((row) => columns.map(({ index }) => row[index] ?? null)).filter(hasValues),
  };
}

async function findRows(source, searchColumns, query, directory) {
  const { columns, rows } = await readTable(source, directory);
  const indices = searchColumns.map((label) => columns.indexOf(label));
  const missing = searchColumns.filter((_, index) => indices[index] === -1);
  if (missing.length) throw new Error(`${source.sheet} 시트에 필요한 열이 없습니다: ${missing.join(', ')}`);

  const normalize = (value) => value.normalize('NFC').toLocaleLowerCase('ko-KR');
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matches = [];
  for (const row of rows) {
    const values = indices.map((index) => String(row[index] ?? '').trim());
    if (!values[0] || !values[1]) continue;
    const text = normalize(values.join(' '));
    if (terms.every((term) => text.includes(term))) matches.push(values);
  }
  return matches;
}

async function readMaterials(directory) {
  const [headers = [], ...rows] = await readWorkbook('재질정보.xlsx', '재질', directory);
  const columns = ['재질코드', '재질명', '계산용밀도_g_cm3', '사용여부', '비고'];
  const indices = columns.map((column) => headers.indexOf(column));
  const missingColumns = columns.filter((_, index) => indices[index] === -1);

  if (missingColumns.length > 0) {
    throw new Error(`재질 시트에 필요한 열이 없습니다: ${missingColumns.join(', ')}`);
  }

  const materials = [];
  for (const [index, row] of rows.entries()) {
    if (!hasValues(row)) continue;

    const [codeCell, nameCell, densityGPerCm3, activeCell, notes] = indices.map((column) => row[column]);
    const code = String(codeCell ?? '').trim();
    const name = String(nameCell ?? '').trim();
    const active = String(activeCell ?? '').trim();

    if (!code || !name || !Number.isFinite(densityGPerCm3) || !['Y', 'N'].includes(active)) {
      throw new Error(`재질 시트 ${index + 2}행의 코드, 이름, 밀도 또는 사용여부가 올바르지 않습니다.`);
    }

    materials.push({ code, name, densityGPerCm3, active: active === 'Y', notes: notes ?? '' });
  }
  return materials;
}

function findActiveRecord(table, code, label) {
  const codeIndex = table.columns.indexOf(`${label}코드`);
  const row = table.rows.find((values) => String(values[codeIndex] ?? '').trim() === code);
  const record = row && Object.fromEntries(table.columns.map((column, index) => [column, row[index]]));
  if (!record || record['사용여부'] !== 'Y' || !record[`${label}명`]) {
    throw new OrderError(422, `사용 가능한 ${label}를 선택해 주세요.`);
  }
  return record;
}

async function loadOrderReferences({ customerCode, itemCode, materialCode }) {
  const [customers, items, materials] = await Promise.all([
    readTable(customerSource), readTable(productSource), readMaterials(),
  ]);
  const customer = findActiveRecord(customers, customerCode, '거래처');
  const item = findActiveRecord(items, itemCode, '품목');
  const material = materials.find(({ code }) => code === materialCode);
  if (!material?.active || !(material.densityGPerCm3 > 0)) {
    throw new OrderError(422, '사용 가능하고 밀도가 0보다 큰 재질을 선택해 주세요.');
  }
  return {
    customerName: customer['거래처명'], contact: customer['담당자'] ?? '',
    itemName: item['품목명'], spec: item['규격'] ?? '',
    materialName: material.name, densityGPerCm3: material.densityGPerCm3,
  };
}

async function loadCustomerRecipient(customerCode) {
  const { columns, rows } = await readTable(customerSource);
  const codeIndex = columns.indexOf('거래처코드');
  const emailIndex = columns.indexOf('이메일');
  const customer = rows.find((values) => String(values[codeIndex] ?? '').trim() === customerCode);
  return customer?.[emailIndex] ?? '';
}

function decodeOrderId(encoded) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new OrderError(400, '요청ID 형식이 올바르지 않습니다.');
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

export async function handleRequest(request, response, { hosted = false, url = request.url } = {}) {
  const pathname = url.split('?')[0];
  const isOrderRoute = pathname === '/api/orders';
  const isOrderWrite = isOrderRoute && request.method === 'POST';
  const orderById = /^\/api\/orders\/([^/]+)$/.exec(pathname);
  const isOrderDelete = orderById !== null && request.method === 'DELETE';
  const orderMail = /^\/api\/orders\/([^/]+)\/(mail|mail-preview|mail-preview\.eml)$/.exec(pathname);
  const mailAction = orderMail?.[2];
  const isMailWrite = mailAction === 'mail' && request.method === 'POST';
  if (hosted && (isOrderRoute || orderById || orderMail)) {
    sendJson(response, 503, { error: '주문 및 메일 기능은 로컬 서버에서 사용할 수 있습니다.' });
    return;
  }
  const readMethod = request.method === 'GET' || request.method === 'HEAD';
  if ((!readMethod && !isOrderWrite && !isOrderDelete && !isMailWrite) || (readMethod && mailAction === 'mail')) {
    const allowed = isOrderRoute ? 'GET, HEAD, POST' : orderById ? 'DELETE' : mailAction === 'mail' ? 'POST' : 'GET, HEAD';
    response.setHeader('Allow', allowed);
    sendJson(response, 405, { error: '지원하지 않는 HTTP 메서드입니다.' });
    return;
  }

  const params = new URLSearchParams(url.slice(pathname.length));
  const workbookDirectory = hosted ? join(process.cwd(), 'excel') : localWorkbookDirectory;
  try {
    if (isOrderDelete) {
      await deleteOrder(decodeOrderId(orderById[1]));
      response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      return;
    }

    if (orderMail) {
      const input = isMailWrite ? await readJsonObject(request) : null;
      const order = await readOrder(decodeOrderId(orderMail[1]));
      if (mailAction === 'mail-preview') {
        sendJson(response, 200, await getMailPreview(order, loadCustomerRecipient));
      } else if (isMailWrite) {
        const preview = await createMailPreview(order, input);
        sendJson(response, preview.created ? 201 : 200, preview);
      } else {
        const file = await downloadMailPreview(order.requestId);
        response.writeHead(200, {
          'Content-Type': 'message/rfc822',
          'Content-Disposition': `attachment; filename="order-${order.requestId}.eml"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(file);
      }
      return;
    }

    if (isOrderRoute) {
      if (isOrderWrite) {
        const input = await readOrderInput(request);
        const { order, created } = await saveOrder(input, loadOrderReferences);
        sendJson(response, created ? 201 : 200, { order });
      } else {
        sendJson(response, 200, await readOrders());
      }
      return;
    }

    if (pathname === '/api/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (pathname === '/api/materials') {
      sendJson(response, 200, { materials: await readMaterials(workbookDirectory) });
      return;
    }

    if (pathname === '/api/items') {
      const rows = await findRows(productSource, productSearchColumns, params.get('q') ?? '', workbookDirectory);
      sendJson(response, 200, { items: rows.map(([code, name, spec]) => ({ code, name, spec })) });
      return;
    }

    if (pathname === '/api/customers' && (hosted || params.has('q'))) {
      const rows = await findRows(customerSource, customerSearchColumns, params.get('q') ?? '', workbookDirectory);
      sendJson(response, 200, { columns: customerSearchColumns, rows });
      return;
    }

    const workbook = workbookRoutes.get(pathname);
    if (workbook) {
      sendJson(response, 200, await readTable(workbook, workbookDirectory));
      return;
    }

    const asset = staticFiles.get(pathname);
    if (!hosted && asset) {
      const [file, contentType] = asset;
      const body = await readFile(new URL(file, import.meta.url));
      response.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
      response.end(body);
      return;
    }

    sendJson(response, 404, { error: '요청한 경로를 찾을 수 없습니다.' });
  } catch (error) {
    if (error instanceof OrderError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    console.error(`${request.method} ${pathname}:`, error.message);
    let message = '요청을 처리할 수 없습니다.';
    if (isOrderWrite) message = '주문을 저장하지 못했습니다. 같은 입력으로 다시 시도해 주세요.';
    else if (isOrderDelete) message = '주문을 삭제하지 못했습니다. 다시 시도해 주세요.';
    else if (orderMail) message = '메일 미리보기를 처리하지 못했습니다. 다시 시도해 주세요.';
    else if (isOrderRoute || pathname === '/api/materials' || pathname === '/api/items' || workbookRoutes.has(pathname)) {
      message = '엑셀 데이터를 읽을 수 없습니다. 서버 로그를 확인하세요.';
    }
    sendJson(response, 500, { error: message });
  }
}
