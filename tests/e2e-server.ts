import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = mkdtempSync(join(tmpdir(), 'drinkdrink-next-e2e-'));
process.env.LEDGER_DATA_DIR = directory;
process.env.PORT = '4186';
process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
await import('../scripts/preview.ts');
