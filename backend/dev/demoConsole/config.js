// Configuration for the demo console. Values come from dev/demoConsole/.env (gitignored) or the
// surrounding environment; everything except the database password has a working default.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env reader: dotenv would also overwrite the backend's own variables when both are loaded.
function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const value = line.slice(eq + 1).trim();
    out[line.slice(0, eq).trim()] = value.replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const file = readEnvFile(path.join(here, '.env'));
const get = (key, fallback = '') => process.env[key] ?? file[key] ?? fallback;

const expandHome = (p) => (p.startsWith('~/') ? path.join(process.env.HOME || '', p.slice(2)) : p);

const dbUrl = get('DEMO_DATABASE_URL');
const localPort = Number(get('DEMO_LOCAL_PORT', '6543'));

export const config = {
  // --- ssh tunnel
  sshHost: get('DEMO_SSH_HOST', 'sh17-devel-mc-hackathon-04'),
  localPort,
  remoteHost: get('DEMO_REMOTE_HOST', '127.0.0.1'),
  remotePort: Number(get('DEMO_REMOTE_PORT', '5432')),
  // Passed to ssh as -i. Without it ssh falls back to ~/.ssh/id_* and the agent, which is how a
  // demo ends up at "Permission denied (publickey)" with the right key sitting on disk unused.
  sshKey: expandHome(get('DEMO_SSH_KEY', '~/.ssh/id_ed25519')),
  autoTunnel: get('DEMO_AUTO_TUNNEL', '1') !== '0',
  // --- database (through the tunnel)
  databaseUrl: dbUrl || buildUrl(),
  resetDatabaseUrl: get('DEMO_RESET_DATABASE_URL', ''),
  // --- misc
  port: Number(get('DEMO_CONSOLE_PORT', '4180')),
  // The pickup code is HMAC(secret, dealId). The console derives and verifies with its own copy, so
  // any 32+ char value lets deals be advanced; only a code read off the handset needs the real one.
  codeSecret: get('MARKET_CODE_SECRET') || get('AUTH_LOOKUP_SECRET') || 'demo-console-local-pickup-code-secret-0001',
  // Unlike the pickup code, this one has to be the VM's real value: the phone -> login_hash lookup
  // is HMAC(secret, phone), so a different secret simply finds no account.
  authSecret: get('AUTH_LOOKUP_SECRET', ''),
  // Optional: `ssh <host> <command>` used by the snapshot actions.
  snapshotDir: get('DEMO_SNAPSHOT_DIR', '~/demo-snapshots'),
  dbName: get('DEMO_DB_NAME', 'agrilink'),
};

function buildUrl() {
  const user = get('DEMO_DB_USER', 'agrilink_app');
  const password = get('DEMO_DB_PASSWORD', '');
  const name = get('DEMO_DB_NAME', 'agrilink');
  if (!password) return '';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${localPort}/${name}`;
}

export const redact = (url) => String(url || '').replace(/:\/\/([^:@/]+):[^@]*@/, '://$1:***@');
