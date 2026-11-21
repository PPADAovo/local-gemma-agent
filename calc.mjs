// 정확한 계산: 원주율·e·제곱근 자릿수와 큰 수 계산을 기억이 아니라 실제로 계산합니다.
import vm from 'node:vm';

function piDigits(n) { // Machin 공식: pi = 16 atan(1/5) - 4 atan(1/239)
  const guard = 10n, scale = 10n ** (BigInt(n) + guard);
  const atanInv = x => { let sum = 0n, term = scale / x, k = 1n, sign = 1n; const x2 = x * x; while (term !== 0n) { sum += sign * (term / k); term /= x2; k += 2n; sign = -sign; } return sum; };
  return (16n * atanInv(5n) - 4n * atanInv(239n)) / 10n ** guard;
}
function eDigits(n) { const guard = 10n, scale = 10n ** (BigInt(n) + guard); let sum = 0n, term = scale, k = 1n; while (term !== 0n) { sum += term; term /= k; k++; } return sum / 10n ** guard; }
function sqrtDigits(v, n) { const scale = 10n ** (2n * BigInt(n)); const N = BigInt(v) * scale; let x = BigInt(Math.floor(Math.sqrt(v) * 1e6)) * 10n ** BigInt(n) / 1000000n || 1n; for (;;) { const y = (x + N / x) / 2n; if (y >= x && y - x <= 1n) return x; x = y; } }
const fmt = (big, n) => { const s = big.toString().padStart(n + 1, '0'); return s.slice(0, s.length - n) + '.' + s.slice(s.length - n); };

export function calc(text) {
  const t = String(text || '').trim();
  const m = t.match(/^(pi|π|원주율|e|자연상수|sqrt\s*\(?\s*(\d+)\s*\)?|루트\s*(\d+))\s*[, ]\s*(\d{1,5})(?:\s*자리)?$/i);
  if (m) {
    const n = Number(m[4]); if (n < 1 || n > 20000) throw Error('자릿수는 1~20,000 사이로 주세요.');
    const kind = m[1].toLowerCase();
    let value;
    if (/^(pi|π|원주율)$/.test(kind)) value = fmt(piDigits(n), n);
    else if (/^(e|자연상수)$/.test(kind)) value = fmt(eDigits(n), n);
    else value = fmt(sqrtDigits(Number(m[2] || m[3]), n), n);
    return value + '\n(소수점 아래 ' + n + '자리, 실제로 계산한 값 · 반올림 없이 자름)';
  }
  if (t.length > 2000) throw Error('계산식이 너무 깁니다.');
  const result = vm.runInNewContext(t, Object.create(null), {timeout: 3000});
  return typeof result === 'bigint' ? result.toString() + ' (BigInt)' : typeof result === 'object' ? JSON.stringify(result) : String(result);
}
