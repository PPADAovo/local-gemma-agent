import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const helper = fileURLToPath(new URL('./photo-cutout.py', import.meta.url));

export async function cutoutPhoto(inputPath, outputPath, {crop=true, padding=0, region, offline=true, autoRegion=false}={}) {
  if (typeof crop !== 'boolean' || !Number.isSafeInteger(padding) || padding < 0) {
    throw Error('크롭 설정과 여백을 확인하세요. 여백은 0 이상의 정수입니다.');
  }
  if (region !== undefined && !(Array.isArray(region) && region.length === 4 &&
      region.every(n => Number.isInteger(n) && n >= 0 && n <= 1000) &&
      region[0] < region[2] && region[1] < region[3])) {
    throw Error('선택 영역은 0~1000의 정수 [왼쪽, 위, 오른쪽, 아래]로 지정하세요.');
  }
  const executable = process.platform === 'win32' ? 'uv.exe' : 'uv';
  const userInstall = path.join(os.homedir(), '.local', 'bin', executable);
  const uv = await access(userInstall).then(() => userInstall, () => executable);
  const args = ['run', ...(offline?['--offline','--no-python-downloads']:[]), '--script', helper, ...(offline?['--offline']:[]), ...(crop ? ['--crop'] : []),
    '--padding', String(padding), ...(region ? ['--region', ...region.map(String)] : []),
    ...(region && autoRegion===true?['--auto-region']:[]),
    '--', path.resolve(inputPath), path.resolve(outputPath)];
  try {
    const {stdout} = await run(uv, args, {windowsHide:true, timeout:300000,
      maxBuffer:2*1024*1024, env:{...process.env, OMP_NUM_THREADS:'2', PYTHONUTF8:'1'}});
    return JSON.parse(stdout.trim());
  } catch (error) {
    if (error.code === 'ENOENT') throw Error('사진 누끼에 필요한 uv 실행기를 찾을 수 없습니다.');
    const diagnostics=String(error.stderr || error.message);
    if(offline && /PHOTO_CACHE_MISS|offline mode|network connectivity is disabled|no (?:download |interpreter)|not (?:available|found) in the cache/i.test(diagnostics)){
      throw Object.assign(Error('누끼에 필요한 모델이나 실행 패키지가 로컬 캐시에 없습니다.'),{code:'PHOTO_CACHE_MISS'});
    }
    const detail = diagnostics.trim().split(/\r?\n/).at(-1);
    throw Error('사진 전경 분리에 실패했습니다. ' + detail);
  }
}
