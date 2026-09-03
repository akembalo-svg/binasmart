// pm2 entry: `pm2 start start.mjs --name bina-mcp` (cwd = mcp-server/).
import { main } from './server.mjs';
main().catch(e => { console.error('[mcp] fatal:', e); process.exit(1); });
