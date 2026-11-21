// PPT(.pptx) 만들기 — Python 없이 Node만으로. ppt-template.pptx(빈 16:9 문서)에 슬라이드를 넣어 저장합니다.
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

const TEMPLATE = fileURLToPath(new URL('./ppt-template.pptx', import.meta.url));
const THEMES = {blue: ['1F3A68', 'FFFFFF', 'EAF1FB', '1F3A68'], dark: ['111827', 'F9FAFB', '1F2937', 'F9FAFB'], green: ['14532D', 'FFFFFF', 'ECFDF3', '14532D'], warm: ['7C2D12', 'FFFFFF', 'FFF7ED', '7C2D12']};
const W = 12192000, H = 6858000, EMU = 914400, FONT = '맑은 고딕';

// ---- ZIP 읽기/쓰기 ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

export function readZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw Error('템플릿이 올바른 zip이 아닙니다.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(off + 26), lxlen = buf.readUInt16LE(off + 28);
    const data = buf.slice(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    files.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

export function writeZip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, content] of files) {
    const nameBuf = Buffer.from(name, 'utf8'), data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp); centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

// ---- 슬라이드 XML ----
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const run = (t, sz, color, bold) => `<a:r><a:rPr lang="ko-KR" sz="${sz}"${bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/></a:rPr><a:t>${esc(t)}</a:t></a:r>`;
function textBox(id, x, y, w, h, paras, anchor = 't') {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}
function rect(id, x, y, w, h, color) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Rect ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
}
function slideXml(s, i, n, theme) {
  const [accent, onAccent, bodyBg, bodyFg] = theme;
  const bullets = Array.isArray(s.bullets) ? s.bullets : [];
  const cover = (i === 0 || i === n - 1) && !bullets.length;
  let bg, shapes;
  if (cover) {
    bg = accent;
    shapes = textBox(2, EMU * 0.8, EMU * 2.4, W - EMU * 1.6, EMU * 1.8, `<a:p><a:pPr algn="ctr"/>${run(s.title, 5400, onAccent, true)}</a:p>`, 'ctr')
      + (s.subtitle ? textBox(3, EMU * 0.8, EMU * 4.3, W - EMU * 1.6, EMU * 1.0, `<a:p><a:pPr algn="ctr"/>${run(s.subtitle, 2400, onAccent)}</a:p>`) : '');
  } else {
    bg = bodyBg;
    const paras = (s.subtitle ? `<a:p><a:pPr><a:spcAft><a:spcPts val="1800"/></a:spcAft></a:pPr>${run(s.subtitle, 2400, accent, true)}</a:p>` : '')
      + bullets.map(b => `<a:p><a:pPr><a:spcAft><a:spcPts val="1400"/></a:spcAft></a:pPr>${run('•  ' + b, 2800, bodyFg)}</a:p>`).join('');
    shapes = rect(2, 0, 0, W, EMU * 1.3, accent)
      + textBox(3, EMU * 0.6, EMU * 0.2, W - EMU * 1.2, EMU * 0.95, `<a:p>${run(s.title, 3400, onAccent, true)}</a:p>`, 'ctr')
      + textBox(4, EMU * 0.9, EMU * 1.8, W - EMU * 1.8, H - EMU * 2.4, paras || '<a:p><a:endParaRPr lang="ko-KR"/></a:p>');
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

export async function makePptx(spec, outPath) {
  const slides = Array.isArray(spec?.slides) ? spec.slides.slice(0, 60) : [];
  if (!slides.length) throw Error('slides가 비어 있습니다.');
  const theme = THEMES[spec.theme] || THEMES.blue;
  const files = readZip(await fs.readFile(TEMPLATE));
  const layoutRel = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout7.xml"/></Relationships>';
  let pres = files.get('ppt/presentation.xml').toString('utf8');
  let rels = files.get('ppt/_rels/presentation.xml.rels').toString('utf8');
  let types = files.get('[Content_Types].xml').toString('utf8');
  const ids = [];
  slides.forEach((s, i) => {
    const n = i + 1;
    files.set(`ppt/slides/slide${n}.xml`, slideXml(s, i, slides.length, theme));
    files.set(`ppt/slides/_rels/slide${n}.xml.rels`, layoutRel);
    rels = rels.replace('</Relationships>', `<Relationship Id="rIdS${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/></Relationships>`);
    types = types.replace('</Types>', `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`);
    ids.push(`<p:sldId id="${255 + n}" r:id="rIdS${n}"/>`);
  });
  pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, '').replace('</p:sldMasterIdLst>', '</p:sldMasterIdLst><p:sldIdLst>' + ids.join('') + '</p:sldIdLst>')
    .replace(/<p:sldSz[^>]*\/>/, `<p:sldSz cx="${W}" cy="${H}"/>`);
  files.set('ppt/presentation.xml', pres); files.set('ppt/_rels/presentation.xml.rels', rels); files.set('[Content_Types].xml', types);
  await fs.writeFile(outPath, writeZip(files));
  const saved=readZip(await fs.readFile(outPath));
  for(const [name,content] of files){if(!saved.get(name)?.equals(Buffer.from(content)))throw Error("저장 후 검증 실패: "+name);}
  return '저장: ' + outPath + ' (' + slides.length + '장)';
}
