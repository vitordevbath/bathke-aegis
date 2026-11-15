// Layout check in a real headless Chromium, driven over the DevTools protocol
// with Node's built-in WebSocket (no browser automation dependency). For each
// viewport width it loads authenticated pages and measures: horizontal page
// overflow, every main navigation link fully inside the viewport, console
// errors and Content-Security-Policy violations. The session token is placed
// in localStorage the same way the app stores it, and is never printed.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** A headless shell that Playwright may have downloaded on a developer machine (any version). */
function playwrightShell() {
  const cache = join(homedir(), '.cache/ms-playwright');
  if (!existsSync(cache)) return undefined;
  return readdirSync(cache)
    .filter((name) => name.startsWith('chromium_headless_shell-'))
    .sort()
    .reverse()
    .map((name) => join(cache, name, 'chrome-headless-shell-linux64/chrome-headless-shell'))
    .find((path) => existsSync(path));
}

/** `AEGIS_CHROME`, a system Chrome/Chromium (CI runners ship Google Chrome), or a Playwright headless shell. */
export const findChrome = () =>
  [process.env.AEGIS_CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', playwrightShell()]
    .filter(Boolean)
    .find((path) => existsSync(path));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launch(chrome) {
  const profile = mkdtempSync(join(tmpdir(), 'aegis-chrome-'));
  const child = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox', 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const endpoint = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('chrome did not start')), 20_000);
    child.stderr.on('data', (chunk) => {
      buffer += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('exit', () => reject(new Error('chrome exited')));
  });
  return { child, endpoint, close: () => (child.kill('SIGKILL'), rmSync(profile, { recursive: true, force: true })) };
}

function connect(endpoint) {
  const socket = new WebSocket(endpoint);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  socket.addEventListener('message', (message) => {
    const data = JSON.parse(String(message.data));
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      data.error ? reject(new Error(data.error.message)) : resolve(data.result);
    } else if (data.method) {
      for (const listener of listeners) listener(data);
    }
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { ready, send, on: (listener) => listeners.push(listener), close: () => socket.close() };
}

/** Measures every page at every width. Returns one result per (path, width). */
export async function checkLayout({ chrome, base, token, workspaceId, paths, widths, waitForText, screenshotDir, prepare }) {
  const browser = await launch(chrome);
  const cdp = connect(browser.endpoint);
  try {
    await cdp.ready;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => cdp.send(method, params, sessionId);
    const problems = [];
    cdp.on((event) => {
      if (event.sessionId !== sessionId) return;
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') problems.push(`console: ${event.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      if (event.method === 'Runtime.exceptionThrown') problems.push(`exception: ${event.params.exceptionDetails.text}`);
      if (event.method === 'Log.entryAdded' && ['error'].includes(event.params.entry.level)) problems.push(`log(${event.params.entry.source}): ${event.params.entry.text}`);
    });
    await page('Runtime.enable');
    await page('Log.enable');
    await page('Page.enable');
    const evaluate = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    const navigate = async (url) => {
      await page('Page.navigate', { url });
      for (let i = 0; i < 100 && (await evaluate('document.readyState')) !== 'complete'; i += 1) await sleep(100);
    };

    // Same origin first, then the session as the app keeps it (ADR-017).
    await navigate(`${base}/login`);
    await evaluate(`localStorage.setItem('aegis.auth.token', ${JSON.stringify(token)}); localStorage.setItem('aegis.workspace.active', ${JSON.stringify(workspaceId)}); true`);
    // CSP violations are reported to the page as events; collect them there too.
    await page('Page.addScriptToEvaluateOnNewDocument', { source: "window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI));" });

    const results = [];
    for (const path of paths) {
      for (const width of widths) {
        await page('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
        await navigate(`${base}${path}`);
        const marker = waitForText?.[path];
        for (let i = 0; marker && i < 100 && !(await evaluate(`document.body.innerText.includes(${JSON.stringify(marker)})`)); i += 1) await sleep(100);
        if (prepare) await evaluate(prepare);
        await sleep(300);
        const metrics = await evaluate(`(() => {
          const root = document.documentElement;
          const view = root.clientWidth;
          const links = [...document.querySelectorAll('.nav__link')].map((a) => { const r = a.getBoundingClientRect(); return { text: a.textContent.trim(), inside: r.left >= 0 && r.right <= view + 0.5 && r.width > 0 && r.height > 0 }; });
          const offenders = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > view + 1; }).slice(0, 5).map((el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
          return { view, scrollWidth: root.scrollWidth, links, offenders, csp: window.__csp ?? [], hasMarker: true };
        })()`);
        if (screenshotDir) {
          const shot = await page('Page.captureScreenshot', { format: 'png' });
          writeFileSync(join(screenshotDir, `${path.replace(/[^a-z0-9]+/gi, '_')}-${width}.png`), Buffer.from(shot.data, 'base64'));
        }
        results.push({ path, width, ...metrics, problems: problems.splice(0) });
      }
    }
    return results;
  } finally {
    cdp.close();
    browser.close();
  }
}

/** One line per measurement; `ok` is false on overflow, a hidden nav link, console errors or CSP violations. */
export function judge(results) {
  return results.map((r) => {
    const hidden = r.links.filter((link) => !link.inside).map((link) => link.text);
    const ok = r.scrollWidth <= r.view && hidden.length === 0 && r.links.length > 0 && r.problems.length === 0 && r.csp.length === 0;
    const detail = ok
      ? `${r.links.length} links visíveis, sem rolagem horizontal`
      : `scrollWidth ${r.scrollWidth}/${r.view}; ocultos: ${hidden.join(', ') || '—'}; excedem: ${r.offenders.join(', ') || '—'}; erros: ${r.problems.join(' | ') || '—'}; CSP: ${r.csp.join(' | ') || '—'}`;
    return { ok, line: `${r.path} @ ${r.width}px — ${detail}` };
  });
}
