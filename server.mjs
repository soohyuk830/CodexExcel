import { createServer } from 'node:http';
import { handleRequest } from './app.mjs';

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
const server = createServer(handleRequest);

server.on('error', (error) => {
  console.error(`서버를 시작할 수 없습니다: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`서버 실행 중: http://${host}:${server.address().port}/`);
});
