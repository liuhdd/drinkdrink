import next from 'next';
import { startLocalServer } from './local-server.ts';

const port = Number(process.env.PORT ?? 4173);
const app = next({ dev: true, hostname: '127.0.0.1', port });
await app.prepare();
await startLocalServer(port, app.getRequestHandler(), () => app.close());
