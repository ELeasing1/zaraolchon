// Пересборка сайта из исходников: node build.mjs
// Нужна, только если меняли src/style.css или src/app.js вручную.
// Тексты и фото меняются через админку (/admin/) — она пересобирает index.html сама.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { render } from './admin/render.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const write = (p, s) => writeFileSync(new URL(p, import.meta.url), s);

const minCss = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/\s*([{};,>])\s*/g, '$1')
  .replace(/([^\s(]):\s+/g, '$1:')
  .replace(/;}/g, '}')
  .trim() + '\n';

const minJs = s => {
  const lines = s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.trim()).filter(Boolean);
  let out = '';
  for (const l of lines) out += (!out || ';{}(,'.includes(out.at(-1)) || '})'.includes(l[0]) ? '' : '\n') + l;
  return out + '\n';
};

const css = minCss(read('src/style.css'));
const js = minJs(read('src/app.js'));
write('assets/style.css', css);
write('assets/app.js', js);

const content = JSON.parse(read('content.json'));
const v = createHash('sha1').update(css + js).digest('hex').slice(0, 8);
if (content.build?.v !== v) {
  content.build = { ...content.build, v };
  write('content.json', JSON.stringify(content, null, 2) + '\n');
}
write('index.html', render(content));
console.log(`Готово: index.html, assets/style.css (${css.length} байт), assets/app.js (${js.length} байт), версия ${v}`);
