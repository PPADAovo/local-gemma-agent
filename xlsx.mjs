// 엑셀(.xlsx) 만들기 — Python 없이 Node만으로. 한셀·엑셀에서 열립니다.
// spec: {"sheets":[{"name":"시트1","rows":[["이름","점수"],["홍길동",100],["합계","=SUM(B2:B2)"]],"widths":[20,10]}]}
// 숫자는 숫자 칸, "="로 시작하면 수식, 그 밖의 글자(긴 숫자 문자열 포함)는 글자 칸으로 그대로 저장합니다.
import fs from 'node:fs/promises';
import {writeZip,readZip} from './pptx.mjs';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
const col = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

function sheetXml(sheet) {
  const rows = Array.isArray(sheet.rows) ? sheet.rows.slice(0, 100000) : [];
  const maxCols = Math.max(1, ...rows.map(r => Array.isArray(r) ? r.length : 1));
  const widths = Array.from({length: maxCols}, (_, c) => {
    const w = Array.isArray(sheet.widths) && Number(sheet.widths[c]) > 0 ? Number(sheet.widths[c]) : Math.min(60, Math.max(8, ...rows.map(r => String((Array.isArray(r) ? r : [r])[c] ?? '').length + 2)));
    return `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`;
  }).join('');
  const body = rows.map((r, i) => {
    const cells = (Array.isArray(r) ? r : [r]).map((v, c) => {
      const ref = col(c) + (i + 1), style = i === 0 && sheet.header !== false ? ' s="1"' : '';
      if (v === null || v === undefined || v === '') return '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      if (typeof v === 'boolean') return `<c r="${ref}" t="b"${style}><v>${v ? 1 : 0}</v></c>`;
      const s = String(v);
      if (s.startsWith('=') && s.length > 1) return `<c r="${ref}"${style}><f>${esc(s.slice(1))}</f></c>`;
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(s)}</t></is></c>`;
    }).join('');
    return `<row r="${i + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths}</cols><sheetData>${body}</sheetData></worksheet>`;
}

export function parseSheetSpec(json){
  return JSON.parse(json,(_key,value,context)=>{
    if(typeof value!=='number')return value;
    const digits=context.source.split(/[eE]/)[0].replace(/\D/g,'').replace(/^0+/,'');
    return digits.length>15 || !Number.isFinite(value)?context.source:value;
  });
}
export async function verifyRequestedPrecision(spec,input){
  const request=/(?:원주율|π|\bpi\b)[^\n]{0,30}?(\d{1,5})\s*자리/i.exec(input);
  if(!request)return;
  const exact=(await import('./calc.mjs')).calc('pi '+request[1]).split('\n')[0];
  const sheets=spec.sheets||[spec];
  if(!sheets.some(s=>s.rows?.some(r=>(Array.isArray(r)?r:[r]).some(cell=>String(cell).includes(exact)))))
    throw Error('시트에서 요청한 원주율 전체 값을 찾지 못했습니다. calc 결과 첫 줄을 문자열 셀로 넣으세요: '+exact);
}
export async function makeXlsx(spec, outPath) {
  let sheets = Array.isArray(spec?.sheets) ? spec.sheets : Array.isArray(spec?.rows) ? [{name: spec.name || '시트1', rows: spec.rows}] : [];
  sheets = sheets.slice(0, 20).filter(s => Array.isArray(s.rows));
  if (!sheets.length) throw Error('sheets(또는 rows)가 비어 있습니다. 예: {"sheets":[{"name":"시트1","rows":[["A","B"],[1,2]]}]}');
  const used = new Set();
  const names = sheets.map((s, i) => { let n = String(s.name || '시트' + (i + 1)).replace(/[\\/?*\[\]:]/g, '_').slice(0, 31) || '시트' + (i + 1); while (used.has(n)) n = n.slice(0, 28) + '_' + i; used.add(n); return n; });
  const files = new Map();
  files.set('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  files.set('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files.set('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  files.set('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files.set('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF7"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach((s, i) => files.set(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  await fs.writeFile(outPath, writeZip(files));
  const saved=readZip(await fs.readFile(outPath));
  for(const [name,content] of files){if(!saved.get(name)?.equals(Buffer.from(content)))throw Error("저장 후 검증 실패: "+name);}
  return '저장: ' + outPath + ' (시트 ' + sheets.length + '개, ' + sheets.reduce((n, s) => n + s.rows.length, 0) + '행)';
}
