// 마크다운 글을 Word 문서(.docx)로 저장합니다. 추가 설치 없이 Node만으로 동작합니다.
// 사용: node make-docx.mjs <입력.md> <출력.docx>
// 지원: # 제목(1~3단계), 문단, - 글머리표, 1. 번호 목록, | 표 |, **굵게**
import fs from 'node:fs';
import path from 'node:path';

const [,, input, output] = process.argv;
if (!input || !output) { console.error('사용법: node make-docx.mjs <입력.md> <출력.docx>'); process.exit(2); }
if (!/\.docx$/i.test(output)) { console.error('출력 파일 이름은 .docx로 끝나야 합니다.'); process.exit(2); }

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const FONT = '<w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕"/>';
function runs(text, size = 22, bold = false) {
  return String(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(part => {
    const strong = /^\*\*[^*]+\*\*$/.test(part);
    const value = strong ? part.slice(2, -2) : part;
    return `<w:r><w:rPr>${FONT}${bold || strong ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${esc(value)}</w:t></w:r>`;
  }).join('');
}
const para = (text, {size = 22, bold = false, before = 0, after = 120, indent = 0, hanging = 0} = {}) =>
  `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${after}" w:line="320" w:lineRule="auto"/>${indent ? `<w:ind w:left="${indent}" w:hanging="${hanging}"/>` : ''}</w:pPr>${runs(text, size, bold)}</w:p>`;
const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
function table(rows) {
  const width = Math.max(...rows.map(r => r.length));
  const col = Math.floor(9000 / width);
  const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(n => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join('');
  const body = rows.map((row, r) => '<w:tr>' + Array.from({length: width}, (_, c) =>
    `<w:tc><w:tcPr><w:tcW w:w="${col}" w:type="dxa"/>${r === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ''}</w:tcPr>${para(row[c] ?? '', {size: 20, bold: r === 0, after: 40})}</w:tc>`).join('') + '</w:tr>').join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${col}"/>`.repeat(width)}</w:tblGrid>${body}</w:tbl>${para('', {after: 60})}`;
}

const lines = fs.readFileSync(input, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
let body = '', count = {heading: 0, paragraph: 0, list: 0, table: 0}, number = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!/^\s*\d+[.)]\s+/.test(line)) number = 0;
  if (!line.trim()) continue;
  const h = line.match(/^(#{1,3})\s+(.*)$/);
  if (h) { const level = h[1].length; body += para(h[2], {size: [36, 28, 24][level - 1], bold: true, before: level === 1 ? 0 : 240, after: 140}); count.heading++; continue; }
  if (/^\s*\|.*\|\s*$/.test(line)) {
    const rows = [];
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(cells(lines[i])); i++; }
    i--; if (rows.length) { body += table(rows); count.table++; } continue;
  }
  const bullet = line.match(/^(\s*)[-*•]\s+(.*)$/);
  if (bullet) { const depth = Math.min(2, Math.floor(bullet[1].length / 2)); body += para('• ' + bullet[2], {indent: 360 + depth * 360, hanging: 240, after: 60}); count.list++; continue; }
  const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
  if (ordered) { number++; body += para(number + '. ' + ordered[1], {indent: 420, hanging: 300, after: 60}); count.list++; continue; }
  body += para(line.trim()); count.paragraph++;
}
if (!body) { console.error('입력 파일에 내용이 없습니다.'); process.exit(1); }

const files = {
  '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
};

// 압축하지 않는 ZIP(저장 방식). docx는 ZIP 묶음입니다.
const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const parts = [], central = []; let offset = 0;
for (const [name, text] of Object.entries(files)) {
  const nameBuf = Buffer.from(name, 'utf8'), data = Buffer.from(text, 'utf8'), crc = crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  const head = Buffer.alloc(46); head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x0800, 8); head.writeUInt16LE(0, 10); head.writeUInt16LE(0, 12); head.writeUInt16LE(0x21, 14);
  head.writeUInt32LE(crc, 16); head.writeUInt32LE(data.length, 20); head.writeUInt32LE(data.length, 24); head.writeUInt16LE(nameBuf.length, 28); head.writeUInt32LE(offset, 42);
  parts.push(local, nameBuf, data); central.push(head, nameBuf); offset += 30 + nameBuf.length + data.length;
}
const centralSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
const out = path.resolve(output);
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, Buffer.concat([...parts, ...central, end]));
const size = fs.statSync(out).size;
console.log(`저장: ${out} (${size.toLocaleString('en-US')}바이트) · 제목 ${count.heading}개, 문단 ${count.paragraph}개, 목록 ${count.list}줄, 표 ${count.table}개`);
