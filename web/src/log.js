const el = () => document.getElementById('log');

function stamp() {
  const d = new Date();
  return `${d.toLocaleTimeString()}`;
}

function paint(tag, line) {
  const node = el();
  if (!node) return;
  const cls =
    tag === 'freighter' ? 'tag' :
    tag === 'stellar'   ? 'tag-stellar' :
    tag === 'ui'        ? 'tag-ui' :
    tag === 'err'       ? 'err' :
    tag === 'ok'        ? 'ok' :
    'tag';
  node.insertAdjacentHTML('beforeend',
    `<span class="${cls}">[${tag}]</span> ${escape(line)}\n`);
  node.scrollTop = node.scrollHeight;
}

function escape(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function log(tag, ...parts) {
  const line = parts.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join(' ');
  console.log(`[${tag}]`, ...parts);
  paint(tag, line);
}

export function ok(line)  { log('ok', line); }
export function err(line) { log('err', line); }
