const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const studioRoot = path.join(__dirname, 'studio');
const siteRoot = path.join(root, '_site');
const contentFile = path.join(root, 'src', '_data', 'studioContent.json');
const host = '127.0.0.1';
const port = Number(process.env.STUDIO_PORT || 4173);
const token = crypto.randomBytes(24).toString('hex');
let mutation = Promise.resolve();

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8'
};

function command(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: root,
      windowsHide: true,
      env: process.env,
      ...options
    });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk; });
    child.stderr?.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(output.trim() || `${program} exited with code ${code}`));
    });
  });
}

const git = process.platform === 'win32' ? 'git.exe' : 'git';

async function build() {
  return command(process.execPath, [path.join(root, 'node_modules', '@11ty', 'eleventy', 'cmd.cjs')]);
}

function clearDataCache() {
  for (const name of ['studioContent.json', 'presentation.js', 'siteContent.js', 'linkedin.js']) {
    const resolved = path.join(root, 'src', '_data', name);
    try { delete require.cache[require.resolve(resolved)]; } catch (_) {}
  }
}

function loadSiteModel() {
  clearDataCache();
  const content = require(path.join(root, 'src', '_data', 'siteContent.js'));
  const presentation = require(path.join(root, 'src', '_data', 'presentation.js'));
  const seen = new Set();
  const posts = [...content.articles, ...content.projects, ...content.openSource]
    .filter((item) => {
      if (seen.has(item.slug)) return false;
      seen.add(item.slug);
      return !item.placeholder;
    })
    .map((item) => ({
      id: item.slug,
      type: 'post',
      group: item.section,
      kind: item.kind,
      title: item.studio?.title || presentation[item.slug]?.displayTitle || item.title || item.paragraphs?.[0]?.split('\n')[0] || item.slug,
      url: item.fullPageUrl,
      sectionUrl: item.sectionUrl,
      presentation: presentation[item.slug] || {}
    }));
  return {
    posts,
    pages: [
      { id: 'about', type: 'page', group: 'pages', kind: 'Page', title: 'About', url: '/about/' },
      { id: 'bc2', type: 'page', group: 'projects', kind: 'Project', title: 'BC2', url: '/bc2/' },
      { id: 'bc2Console', type: 'page', group: 'pages', kind: 'Page', title: 'BC2 Console', url: '/bc2/console/' }
    ]
  };
}

function readStudioContent() {
  return JSON.parse(fs.readFileSync(contentFile, 'utf8'));
}

function writeStudioContent(content) {
  const temporary = `${contentFile}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, contentFile);
}

function cleanVariants(input) {
  const allowed = {
    titlePlacement: new Set(['outside', 'top', 'bottom', 'left', 'right', 'fade']),
    cropAspect: new Set(['wide', 'landscape']),
    cropFill: new Set(['blank', 'match'])
  };
  const result = {};
  for (const mode of ['dedicated', 'shared']) {
    for (const device of ['desktop', 'mobile']) {
      const candidate = input?.[mode]?.[device];
      if (!candidate || typeof candidate !== 'object') continue;
      const values = {};
      for (const [key, choices] of Object.entries(allowed)) {
        if (choices.has(candidate[key])) values[key] = candidate[key];
      }
      for (const key of ['cropX', 'cropY', 'cropZoom']) {
        const number = Number(candidate[key]);
        if (!Number.isFinite(number)) continue;
        values[key] = key === 'cropZoom'
          ? Math.min(3, Math.max(.5, number))
          : Math.min(100, Math.max(-100, number));
      }
      if (/^#[0-9a-f]{6}$/i.test(candidate.cropColor || '')) values.cropColor = candidate.cropColor.toLowerCase();
      if (Object.keys(values).length) {
        result[mode] ||= {};
        result[mode][device] = values;
      }
    }
  }
  return result;
}

function cleanHtml(value) {
  return String(value || '')
    .replace(/<(script|style|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

function enqueue(action) {
  const next = mutation.then(action, action);
  mutation = next.catch(() => {});
  return next;
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(value));
}

function readJson(request, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('That file is too large for the Studio.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (_) { reject(new Error('The Studio received invalid data.')); }
    });
    request.on('error', reject);
  });
}

function safeSegment(value, fallback) {
  const clean = String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || fallback;
}

async function status() {
  const [branch, changes] = await Promise.all([
    command(git, ['branch', '--show-current']),
    command(git, ['status', '--short'])
  ]);
  return { branch, dirty: Boolean(changes), changes: changes ? changes.split(/\r?\n/).length : 0 };
}

async function api(request, response, url) {
  if (request.method !== 'GET' && request.headers['x-studio-token'] !== token) {
    sendJson(response, 403, { ok: false, error: 'This request did not come from the local Studio.' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/site') {
    const model = loadSiteModel();
    sendJson(response, 200, { ok: true, ...model, status: await status(), liveUrl: 'https://anasmalas.com/' });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/save') {
    const input = await readJson(request);
    const result = await enqueue(async () => {
      const content = readStudioContent();
      if (input.type === 'post') {
        const known = loadSiteModel().posts.some((item) => item.id === input.id);
        if (!known) throw new Error('That post is not part of this site.');
        const previous = content.posts[input.id] || {};
        content.posts[input.id] = {
          ...previous,
          title: String(input.title || '').trim(),
          bodyHtml: cleanHtml(input.bodyHtml),
          presentation: {
            ...(previous.presentation || {}),
            ...Object.fromEntries(Object.entries(input.presentation || {}).filter(([key]) => ['date', 'image', 'alt', 'fit', 'repo', 'relatedUrl', 'relatedLabel', 'titlePlacement'].includes(key))),
            defaultExpanded: Boolean(input.presentation?.defaultExpanded),
            variants: cleanVariants(input.presentation?.variants)
          }
        };
      } else if (input.type === 'page' && ['about', 'bc2', 'bc2Console'].includes(input.id)) {
        content.pages[input.id] = {
          ...(content.pages[input.id] || {}),
          title: String(input.title || '').trim(),
          bodyHtml: cleanHtml(input.bodyHtml)
        };
      } else {
        throw new Error('The Studio cannot save this page yet.');
      }
      writeStudioContent(content);
      await build();
      return status();
    });
    sendJson(response, 200, { ok: true, status: await result });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/reorder') {
    const input = await readJson(request);
    const result = await enqueue(async () => {
      const model = loadSiteModel();
      const post = model.posts.find((item) => item.id === input.id);
      if (!post) throw new Error('That post is not part of this site.');
      if (!['up', 'down'].includes(input.direction)) throw new Error('Choose whether to move the post up or down.');
      const ids = model.posts.filter((item) => item.group === post.group).map((item) => item.id);
      const index = ids.indexOf(post.id);
      const target = input.direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= ids.length) return status();
      [ids[index], ids[target]] = [ids[target], ids[index]];
      const content = readStudioContent();
      content.order ||= {};
      content.order[post.group] = ids;
      writeStudioContent(content);
      await build();
      return status();
    });
    sendJson(response, 200, { ok: true, status: await result });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/upload') {
    const input = await readJson(request);
    const match = String(input.data || '').match(/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,(.+)$/s);
    if (!match) throw new Error('Choose a PNG, JPEG, WebP, GIF, or SVG image.');
    const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg' };
    const slug = safeSegment(input.slug, 'page');
    const original = path.parse(String(input.name || 'image'));
    const filename = `${safeSegment(original.name, 'image')}${extensions[match[1]]}`;
    const directory = path.join(root, 'src', 'assets', 'images', 'posts', slug);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, filename), Buffer.from(match[2], 'base64'));
    sendJson(response, 200, { ok: true, path: `/assets/images/posts/${slug}/${filename}` });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/publish') {
    const result = await enqueue(async () => {
      await build();
      await command(git, ['add', '-A']);
      const staged = await command(git, ['diff', '--cached', '--name-only']);
      let committed = false;
      if (staged) {
        await command(git, ['commit', '-m', 'Update site from local Studio']);
        committed = true;
      }
      const pushed = await command(git, ['push', 'origin', 'HEAD:main']);
      return { committed, pushed, status: await status() };
    });
    sendJson(response, 200, { ok: true, ...result, liveUrl: 'https://anasmalas.com/' });
    return;
  }

  sendJson(response, 404, { ok: false, error: 'Unknown Studio action.' });
}

function staticPath(rootDirectory, pathname) {
  let relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  const resolved = path.resolve(rootDirectory, relative);
  if (!resolved.startsWith(`${path.resolve(rootDirectory)}${path.sep}`)) return null;
  return resolved;
}

function serveFile(response, file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  response.writeHead(200, {
    'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': file.endsWith('.html') ? 'no-store' : 'public, max-age=60'
  });
  fs.createReadStream(file).pipe(response);
  return true;
}

async function handle(request, response) {
  const url = new URL(request.url, `http://${host}:${port}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await api(request, response, url);
      return;
    }
    if (url.pathname === '/__studio/config.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(`window.__STUDIO__=${JSON.stringify({ token, liveUrl: 'https://anasmalas.com/' })};`);
      return;
    }
    if (url.pathname === '/studio' || url.pathname === '/studio/') {
      response.writeHead(302, { Location: '/__studio/' });
      response.end();
      return;
    }
    if (url.pathname.startsWith('/__studio/')) {
      const pathname = url.pathname.slice('/__studio/'.length);
      if (serveFile(response, staticPath(studioRoot, pathname))) return;
    } else if (serveFile(response, staticPath(siteRoot, url.pathname))) {
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message || 'Studio action failed.' });
  }
}

async function main() {
  process.stdout.write('Building the site…\n');
  await build();
  const server = http.createServer(handle);
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error.code === 'EADDRINUSE' ? new Error(`The Studio is already open at http://${host}:${port}/studio/`) : error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
  const studioUrl = `http://${host}:${port}/studio/`;
  process.stdout.write(`\nAnas Malas Studio is ready at ${studioUrl}\n`);
  process.stdout.write('Keep this window open while editing. Press Ctrl+C to stop.\n');
  if (!process.env.STUDIO_NO_OPEN) {
    const opener = process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', 'start', '', studioUrl], { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [studioUrl], { detached: true, stdio: 'ignore' });
    opener.unref();
  }
}

main().catch((error) => {
  process.stderr.write(`\nStudio could not start:\n${error.message}\n`);
  process.exitCode = 1;
});
