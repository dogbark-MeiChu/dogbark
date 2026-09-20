// Keeps `ssh -N -L <local>:<remote>` alive for the whole demo. The console never runs SQL over ssh;
// ssh only carries the TCP port, and every write goes through node-pg on 127.0.0.1:<local>.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { config } from './config.js';

// Reconnecting past these is pointless: the operator has to fix something first.
const FATAL = /Permission denied|Host key verification failed|Could not resolve hostname|No such file or directory|not found in known_hosts/i;

const state = { child: null, status: 'stopped', since: null, lastError: null, retries: 0 };
let stopping = false;
let watchdog = null;

/**
 * Whether ssh will actually be able to read the key. A key that is present but group-readable is
 * refused by ssh with a message that looks nothing like "wrong permissions", so it is checked here
 * and reported in the status bar instead of at 12s of silence during a demo.
 */
export function keyState() {
  const path = config.sshKey;
  if (!path) return { path: null, ok: true, note: 'no key configured; ssh will use its own defaults' };
  try {
    const st = fs.statSync(path);
    fs.accessSync(path, fs.constants.R_OK);
    const mode = st.mode & 0o777;
    if (mode & 0o077) {
      return { path, ok: false, note: `permissions are ${mode.toString(8)}; ssh refuses anything looser than 600 — run: chmod 600 ${path}` };
    }
    return { path, ok: true, note: `mode ${mode.toString(8)}` };
  } catch (err) {
    return { path, ok: false, note: err.code === 'ENOENT' ? 'file not found' : err.message };
  }
}

/** True when something is already listening on the local port (a tunnel from an earlier run). */
export function portInUse(port = config.localPort) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (result) => { socket.destroy(); resolve(result); };
    socket.setTimeout(700);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** The status the operator sees is the port, not the process: ssh can be alive and still refused. */
export async function tunnelState() {
  const open = await portInUse();
  if (state.status === 'up' && !open) state.status = 'starting';
  if (state.child && open) state.status = 'up';
  return {
    status: state.status,
    portOpen: open,
    key: keyState(),
    since: state.since,
    lastError: state.lastError,
    target: `127.0.0.1:${config.localPort} -> ${config.sshHost} ${config.remoteHost}:${config.remotePort}`,
  };
}

export async function startTunnel({ force = false } = {}) {
  // "Restart tunnel" has to mean restart, including when a half-open child is still hanging on a
  // connect that will never finish.
  if (state.child) {
    if (!force) return tunnelState();
    stopTunnel();
  }
  if (!force && await portInUse()) {
    state.status = 'external'; // someone already forwards this port; use it as-is
    state.since = new Date().toISOString();
    return tunnelState();
  }
  stopping = false;
  const key = keyState();
  if (!key.ok) {
    state.status = 'failed';
    state.lastError = `ssh key ${key.path}: ${key.note}`;
    return tunnelState();
  }
  state.retries = 0;
  spawnTunnel();
  const opened = await waitFor(() => portInUse(), 12000);
  if (opened) { state.status = 'up'; startWatchdog(); }
  else {
    // Leaving a hanging ssh behind would pile up a process per attempt.
    const why = state.lastError || 'ssh did not open the port within 12s';
    stopTunnel();
    state.status = 'failed';
    state.lastError = why;
  }
  return tunnelState();
}

function spawnTunnel() {
  const key = keyState();
  const args = [
    '-N', '-T',
    // Only when the file is really usable; a broken -i would mask the config's own IdentityFile.
    ...(config.sshKey && key.ok ? ['-i', config.sshKey, '-o', 'IdentitiesOnly=yes'] : []),
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'BatchMode=yes',
    '-L', `${config.localPort}:${config.remoteHost}:${config.remotePort}`,
    config.sshHost,
  ];
  const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  state.child = child;
  state.status = 'starting';
  state.since = new Date().toISOString();
  child.stderr.on('data', (buf) => { state.lastError = String(buf).trim().slice(0, 400); });
  child.once('spawn', () => { if (state.status !== 'up') state.status = 'starting'; });
  child.once('exit', (code, signal) => {
    state.child = null;
    if (stopping) { state.status = 'stopped'; return; }
    state.lastError = state.lastError || `ssh exited (code ${code}, signal ${signal})`;
    // A dropped link mid-demo is worth reconnecting through; a rejected key never is, and retrying
    // it would only hammer the VM with failing logins.
    if (FATAL.test(state.lastError)) { state.status = 'failed'; return; }
    state.status = 'down';
    if (state.retries < 10) {
      state.retries += 1;
      // Backing off matters as much as retrying: a burst of failed logins is what gets a laptop
      // banned by the VM's fail2ban, and then nothing connects for the next hour.
      const delay = Math.min(2000 * 2 ** (state.retries - 1), 30000);
      setTimeout(() => { if (!stopping && !state.child) spawnTunnel(); }, delay);
    } else {
      state.status = 'failed';
      state.lastError = `${state.lastError} (gave up after ${state.retries} retries)`;
    }
  });
}

/**
 * ssh can stay alive with a forward that no longer carries anything (a slept laptop, a dropped
 * link). The process being up is not proof, so the port is probed and a wedged child replaced.
 */
function startWatchdog() {
  clearInterval(watchdog);
  let misses = 0;
  watchdog = setInterval(async () => {
    if (stopping || !state.child) return;
    if (await portInUse()) { misses = 0; state.status = 'up'; state.retries = 0; return; }
    misses += 1;
    if (misses >= 2) {          // ~20s of a dead forward
      misses = 0;
      state.lastError = 'forward stopped carrying traffic; restarting';
      state.child.kill('SIGTERM');   // the exit handler respawns with backoff
    }
  }, 10000);
}

export function stopTunnel() {
  stopping = true;
  clearInterval(watchdog);
  state.retries = 0;
  if (state.child) state.child.kill('SIGTERM');
  state.child = null;
  state.status = 'stopped';
  state.lastError = null;
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// Ctrl-C on the console must not leave a forwarded port open behind it.
const cleanup = () => { if (state.child) state.child.kill('SIGTERM'); };
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { cleanup(); process.exit(0); });
}
