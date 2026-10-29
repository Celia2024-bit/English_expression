'use strict';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

function normalize(d) {
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const examples = (Array.isArray(d.examples) ? d.examples : [])
    .map(e => ({en: str(e && e.en), zh: str(e && e.zh)}))
    .filter(e => e.en || e.zh);
  return {id: str(d.id), title: str(d.title), tag: str(d.tag), meaning: str(d.meaning), use: str(d.use), examples};
}

function validate(d) {
  if (!ID_RE.test(d.id)) return 'id 不合法（只允许小写字母、数字和连字符）';
  if (!d.title) return '缺少英文表达';
  if (!d.meaning) return '缺少中文释义';
  return null;
}

function toneOf(tag) {
  for (const t of ['职场', '比喻', '句式']) if (tag.includes(t)) return t;
  if (tag.includes('正式') || tag.includes('书面')) return '正式';
  if (tag.includes('口语')) return '口语';
  return '通用';
}

function renderSection(raw) {
  const d = normalize(raw);
  // 转义 "<" 以免 JSON 中出现 </script>
  const json = JSON.stringify(d, null, 2).replace(/</g, '\\u003c');
  const examples = d.examples.map(e =>
    `<div class="example"><div class="en">${esc(e.en)}</div><div class="zh">${esc(e.zh)}</div></div>`).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.title)}｜English Expression Toolkit</title>
<link rel="stylesheet" href="../style.css">
<link rel="icon" href="data:,">
</head>
<body class="detail-page">
<main class="detail-main">
<p><a class="back" href="../index.html">← 返回手册</a></p>
<article class="card detail-card">
<div class="card-top"><h1 class="detail-title">${esc(d.title)}</h1>${d.tag ? `<span class="tag" data-tone="${toneOf(d.tag)}">${esc(d.tag)}</span>` : ''}</div>
<p class="meaning">${esc(d.meaning)}</p>
${d.use ? `<p class="use"><strong>快速定位：</strong>${esc(d.use)}</p>` : ''}
<div class="examples">${examples}</div>
</article>
</main>
<script type="application/json" id="expression-data">
${json}
</script>
</body>
</html>
`;
}

module.exports = {esc, ID_RE, normalize, validate, renderSection};
