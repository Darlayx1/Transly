// Vite aliases cloudflare:workers here during the portable Node preview only.
import { localDatabase } from './local-db';
export const env = { ...process.env, DB: localDatabase() };
