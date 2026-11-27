import { handleRequest } from '../app.mjs';

export default function handler(request, response) {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/handler') {
    url.pathname = `/api/${url.searchParams.get('__path') ?? ''}`;
    url.searchParams.delete('__path');
  }
  return handleRequest(request, response, { hosted: true, url: url.pathname + url.search });
}
