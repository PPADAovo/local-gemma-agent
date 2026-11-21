const CHARS_PER_MINUTE = 300;
const PART_CHARS = 1000;
const MAX_PARTS = 80;
const ATTEMPTS_PER_PART = 3;

function charCount(text) {
  return Array.from(text.replace(/\s+/gu, ' ').trim()).length;
}

function targetSize(input, minutes) {
  const specified = input.match(/([\d][\d,]*(?:\.\d+)?)\s*(천|만)?\s*자(?:\s*분량|\s*이상|\s*정도|\s*내외|\s*이하|\b|(?=[가-힣\s,.!?]|$))/u);
  const unit = specified?.[2];
  const chars = specified && Number(specified[1].replaceAll(',', '')) * (unit === '만' ? 10000 : unit === '천' ? 1000 : 1);
  if (Number.isFinite(chars) && chars > 0) return Math.ceil(chars);
  const duration = Number(minutes);
  return Math.max(1, Math.ceil((Number.isFinite(duration) && duration > 0 ? duration : 10) * CHARS_PER_MINUTE));
}

// Character shingles also catch Korean text that differs only in spacing or punctuation.
function shingles(text) {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const result = [];
  for (let i = 0; i + 12 <= normalized.length; i++) result.push(normalized.slice(i, i + 12));
  return result;
}

function validatePart(text, goal, previousShingles) {
  if (charCount(text) < Math.min(goal, Math.max(80, Math.floor(goal * 0.4)))) {
    return '요청된 분량에 비해 본문이 너무 짧습니다.';
  }
  const lines = text.split(/\n+/u).map(line => line.trim()).filter(Boolean);
  const outline = /^(?:#{1,6}\s|[-*•]\s|\d+[.)]\s|(?:도입|전개|결론|마무리|서론|본론|기승전결|오프닝|클로징)\s*[:：]|(?:파트|섹션|챕터)\s*\d+\s*[:：]|\[?\d{1,2}:\d{2}\s*[-–~])/iu;
  if (/^(?:#{1,6}\s*)?(?:\*\*)?(?:목차|대본\s*(?:구성안|개요)|시놉시스|outline|table of contents)\s*[:：*\n]/iu.test(text) ||
      (lines.length >= 3 && lines.filter(line => outline.test(line)).length >= lines.length * 0.6)) {
    return '목차나 항목 설명 대신 실제로 말할 문장을 써 주세요.';
  }
  const grams = shingles(text);
  const unique = new Set(grams);
  if (grams.length >= 70 && (unique.size / grams.length < 0.53 ||
      [...unique].filter(gram => previousShingles.has(gram)).length > unique.size * 0.54)) {
    return '앞부분과 겹치는 문장을 버리고 새로운 내용으로 이어 주세요.';
  }
  return '';
}

function cleanBody(output) {
  if (typeof output !== 'string') return '';
  return output.trim()
    .replace(/^\x60{3}(?:text|markdown)?\s*\n([\s\S]*)\n\x60{3}$/iu, '$1')
    .replace(/^(?:물론(?:입니다|이죠)[.!]?\s*)?(?:다음은|아래는)[^\n]{0,100}(?:대본|스크립트)입니다[.!:]?\s*\n+/u, '')
    .trim();
}

// Verify precise figures against supplied text when an informational script
// is based on that text. Image-only evidence needs model judgment.
function unsupportedSpecifics(passage, material) {
  const pattern = /(?:버전|패치|version|patch|v)\s*\d+\.\d+(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:%|퍼센트|미터|킬로미터|밀리초|초간|초마다|배율|데미지|대미지|피해량|HP\b|km\b|ms\b)/giu;
  const normal = text => text.toLowerCase().replace(/[\s,]/gu, '').replace(/퍼센트/gu, '%')
    .replace(/^(?:버전|version|v)/u, 'v').replace(/^(?:패치|patch)/u, 'patch');
  const source = new Set((material.match(pattern) || []).map(normal));
  return (passage.match(pattern) || []).find(value => !source.has(normal(value)));
}

// One small plan per long script. Quotes have to match actual input before
// they are presented as evidence. The titles are writing directions only.
async function makeSectionPlan(generate, material, assignment, context, targetChars) {
  if (targetChars <= PART_CHARS) return [];
  const count = Math.min(8, Math.ceil(targetChars / PART_CHARS));
  const system = '사용자가 지정한 범위와 순서가 최우선인 대본 편집자입니다. 요청과 원자료를 ' + count +
    '개의 서로 다른 작성 범위로 나누세요. 사용자가 먼저 알고 싶은 대상·이름·답을 첫 범위에 두고, 요청된 목록의 끝까지 빠짐없이 배분하세요. ' +
    '지도 이름, 모드, 버전 등을 임의로 보강하지 마세요. 각 scope는 60자 이내의 작성 지시, quote는 그 범위와 관련된 원문의 짧은 연속 인용입니다. ' +
    '글로 확인할 수 없는 부분은 quote를 빈 문자열로 두세요. 결과는 {"sections":[{"scope":"…","quote":"…"}]} 형식의 JSON만 반환하세요.';
  const result = await generate({
    messages: [{role:'system',content:system}, ...context, assignment], format:'json', maxTokens:800
  });
  try {
    const parsed = JSON.parse(String(result).trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/giu, ''));
    if (!Array.isArray(parsed.sections)) return [];
    const seen = new Set();
    return parsed.sections.slice(0,count).flatMap(item => {
      const scope = typeof item?.scope === 'string' ? item.scope.trim().slice(0,100) : '';
      if (!scope || seen.has(scope)) return [];
      seen.add(scope);
      const quote = typeof item.quote === 'string' ? item.quote.trim().slice(0,160) : '';
      return [{scope,quote:quote && material.includes(quote) ? quote : ''}];
    });
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return [];
  }
}

/**
 * generate receives ordinary chat messages and a per-call token limit.
 * The caller chooses the model and transports optional base64 images.
 */
export async function generateLongScript({minutes, input, recent = [], sources = '', images = [], initialAnswer = '', generate, progress = () => {}}) {
  if (typeof generate !== 'function' || typeof input !== 'string' || !input.trim()) {
    throw new TypeError('대본 요청과 생성 함수가 필요합니다.');
  }
  const targetChars = targetSize(input, minutes);
  const parts = initialAnswer.trim() ? [initialAnswer] : [];
  const previousShingles = new Set(shingles(initialAnswer));
  let actualChars = charCount(initialAnswer);
  let reason = '';
  let complete = false;
  const context = recent.filter(m => ['user','assistant'].includes(m?.role) && typeof m.content === 'string')
    .slice(-8).map(m => ({role: m.role, content: m.content.slice(-1800)}));
  const assignment = {role: 'user', content: input + (sources ? '\n\n참고 자료 (사실과 소재로만 사용):\n' + sources.slice(0, 16000) : '')};
  if (images.length) assignment.images = images;
  const material = [assignment, ...context.filter(m => m.role === 'user')].map(m => m.content).join('\n');
  const verifySourceFigures = !images.length && Boolean(sources.trim())
    && !/상상|가상|팬픽|창작|소설|허구/u.test(input);
  let plan = [];
  if (targetChars - actualChars > PART_CHARS) {
    progress('대본의 순서와 참고 자료를 정리합니다.');
    try {
      plan = await makeSectionPlan(generate, material, assignment, context, targetChars);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // Providers without JSON mode can still generate the body in request order.
    }
  }
  let nextScope = Math.min(plan.length, Math.floor(plan.length * actualChars / targetChars));

  while (!complete && parts.length < MAX_PARTS) {
    // Leave enough room for an actual ending even if the previous section ran long.
    const remaining = Math.max(targetChars - actualChars, parts.length ? Math.min(200, targetChars) : 1);
    const count = Math.max(1, Math.ceil(remaining / PART_CHARS));
    const goal = Math.ceil(remaining / count);
    const ending = count === 1;
    const scopeEnd = ending ? plan.length : Math.min(plan.length, Math.ceil(plan.length * (actualChars + goal) / targetChars));
    const scopes = plan.slice(nextScope, scopeEnd);
    const nearby = nextScope > 0 ? plan[nextScope - 1]?.scope : '';
    progress('대본 작성 중 · ' + (parts.length + 1) + '번째 부분');
    let accepted = '';
    let bestEnding = '';
    let failed = false;
    for (let attempt = 0; attempt < ATTEMPTS_PER_PART; attempt++) {
      const previous = parts.length ? parts[parts.length - 1].slice(attempt ? -260 : -1600) : '';
      const coverage = parts.slice(0, -1).map(p => p.slice(0, 100) + ' … ' + p.slice(-120)).join('\n').slice(-3600);
      const prompt = [
        '전체 대본 목표는 약 ' + targetChars + '자입니다. 지금은 ' + (parts.length + 1) + '번째 부분을 약 ' + goal + '자로 작성하세요.',
        ending ? '이 부분에서 주제를 충분히 마무리하고 완결된 문장으로 끝내세요.' : '다음 부분이 이어지므로 지금 결론이나 끝인사를 하지 마세요.',
        !parts.length && '정보를 묻는 대본은 첫 문장부터 요청한 실제 이름·핵심 답을 말하세요. 지도명을 요구했다면 근거가 있는 지도명이 먼저입니다. 창작극이면 사용자가 의도한 장면과 대사부터 시작하세요.',
        '사용자가 명시한 순서·범위가 내부 계획보다 우선합니다. 계획은 사실 근거가 아닙니다. 사용자가 제공한 설명·자료에서 확인한 내용과 직접 보이는 이미지에 근거하세요. ' +
          '자료에 없는 세부 수치, 고유명, 버전, 게임 모드, 업데이트 내역을 만들어 내거나 다른 버전의 사실을 섞지 마세요. 모르는 항목이 필수라면 짧게 한계를 밝혀 주세요.',
        scopes.length ? '이번에 순서대로 다룰 범위 (본문에 목차로 출력하지 않음):\n' +
          scopes.map(s => s.scope + (s.quote ? ' — 원문: ' + s.quote : '')).join('\n') :
          (nearby && !ending ? '직전 범위에서 아직 설명하지 않은 근거나 사례로 한 단계 더 진행하세요: ' + nearby : ''),
        scopeEnd < plan.length && '후속 부분으로 남겨 둘 범위: ' + plan.slice(scopeEnd).map(s=>s.scope).join(' / '),
        '읽어 줄 본문과 요청된 대사만 쓰세요. 목차·작성 계획·분량 보고·다음 부분 예고를 넣지 마세요.',
        coverage && '이미 다룬 앞부분의 발췌:\n' + coverage,
        previous && '직전 부분의 끝 (되풀이하지 말고 바로 이어 쓰세요):\n' + previous,
        attempt > 0 && '다시 작성할 때 고칠 점: ' + reason + ' 앞에서 이미 말한 목록을 다시 나열하지 말고, 요청 범위 안에서 아직 다루지 않은 사례 하나를 골라 원리와 실제 적용 순서까지 구체적으로 설명하세요.'
      ].filter(Boolean).join('\n\n');
      const messages = [
        {role: 'system', content: '당신은 방송 대본 작가입니다. 사용자의 언어, 주제, 화자, 형식, 참고 자료를 따라 한 편의 일관된 대본을 여러 차례에 걸쳐 작성합니다.'},
        ...context, assignment, {role: 'user', content: prompt}
      ];
      let part;
      try {
        part = cleanBody(await generate({messages, maxTokens: Math.max(384, Math.min(3072, Math.ceil(goal * 2.4)))}));
      } catch (error) {
        if (error?.name === 'AbortError' || (!parts.length && !bestEnding)) throw error;
        reason = '모델이 다음 부분을 생성하지 못했습니다.';
        failed = true;
        break;
      }
      reason = validatePart(part, goal, previousShingles);
      if (reason) continue;
      const ungrounded = verifySourceFigures && unsupportedSpecifics(part, material);
      if (ungrounded) {
        reason = '원문에서 확인할 수 없는 세부 수치(' + ungrounded + ')를 빼고 근거가 있는 설명을 써 주세요.';
        continue;
      }
      // A closing passage should finish the script in this call. Otherwise repeated
      // tiny closing paragraphs can push the total over the target without adding substance.
      if (ending) {
        const short = actualChars + charCount(part) < targetChars;
        const unfinished = !/[.!?。！？…다요죠음임][”’"'」』)\]*]*$/u.test(part);
        if (short || unfinished) {
          if (part.length > bestEnding.length) bestEnding = part;
          reason = short ? '마지막 부분은 완결된 본문으로 ' + goal + '자 이상 작성해 주세요.' : '중간에 끊긴 표현을 피하고 마지막 문장을 완결해 주세요.';
          continue;
        }
      }
      accepted = part;
      break;
    }
    const next = accepted || bestEnding;
    if (next) {
      parts.push(next);
      for (const gram of shingles(next)) previousShingles.add(gram);
      actualChars += charCount(next) + (parts.length === 1 ? 0 : 1);
    }
    if (!accepted || failed) break;
    nextScope = scopeEnd;
    complete = ending && actualChars >= targetChars;
  }
  return {answer: parts.join('\n\n'), complete, targetChars, actualChars,
    reason: complete ? '' : reason || '한 번에 작성할 수 있는 최대 구간 수에 도달했습니다.'};
}
