'use strict';
// 一次性迁移脚本：把 english_expression_toolkit.html 拆成 sections/*.html + categories.json
// 用法: node migrate.js [源html路径]
const fs = require('fs');
const path = require('path');
const {renderSection} = require('./lib/render');

const root = __dirname;
const src = process.argv[2] || path.join(root, 'english_expression_toolkit.html');
const html = fs.readFileSync(src, 'utf8');

const decode = s => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const strip = s => decode(s.replace(/<[^>]+>/g, '')).trim();
const pick = (re, s) => { const m = re.exec(s); return m ? strip(m[1]) : ''; };

const slug = t => t.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'expr';

function parseCard(a) {
  const examples = [];
  const exRe = /<div class="en">([\s\S]*?)<\/div><div class="zh">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = exRe.exec(a))) examples.push({en: strip(m[1]), zh: strip(m[2])});
  return {
    title: pick(/<h3>([\s\S]*?)<\/h3>/, a),
    tag: pick(/<span class="tag">([\s\S]*?)<\/span>/, a),
    meaning: pick(/<p class="meaning">([\s\S]*?)<\/p>/, a),
    use: pick(/<p class="use"><strong>[^<]*<\/strong>([\s\S]*?)<\/p>/, a),
    examples
  };
}

const store = new Map(); // id -> data
const sameContent = (a, b) => JSON.stringify({...a, id: ''}) === JSON.stringify({...b, id: ''});

function register(data) {
  const base = slug(data.title);
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    const ex = store.get(id);
    if (!ex) { store.set(id, {...data, id}); return id; }
    if (sameContent(ex, data)) return id;
  }
}

const categories = [];
const secRe = /<section class="section" data-section="([^"]*)">([\s\S]*?)<\/section>/g;
let sm;
while ((sm = secRe.exec(html))) {
  const items = [];
  const artRe = /<article class="card"[^>]*>([\s\S]*?)<\/article>/g;
  let am;
  while ((am = artRe.exec(sm[2]))) {
    const id = register(parseCard(am[1]));
    if (!items.includes(id)) items.push(id);
  }
  categories.push({id: 'c' + String(categories.length + 1).padStart(2, '0'), name: decode(sm[1]), items});
}

const quick = [];
const rowRe = /<tr data-search="[^"]*"><td>([\s\S]*?)<\/td><td><code>([\s\S]*?)<\/code>/g;
let rm;
while ((rm = rowRe.exec(html))) quick.push({want: strip(rm[1]), say: strip(rm[2])});

const dir = path.join(root, 'sections');
fs.mkdirSync(dir, {recursive: true});
for (const d of store.values()) fs.writeFileSync(path.join(dir, d.id + '.html'), renderSection(d), 'utf8');

const out = {
  title: 'English Expression Toolkit',
  subtitle: '英语表达速查手册',
  categories,
  quick
};
fs.writeFileSync(path.join(root, 'categories.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log(`表达 ${store.size} 个，分类 ${categories.length} 个，速查 ${quick.length} 条`);
console.log('分类中引用总数:', categories.reduce((n, c) => n + c.items.length, 0));
