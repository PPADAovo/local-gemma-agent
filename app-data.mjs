// 앱 설정·비밀번호·스킬 상태 등을 두는 폴더.
// GEMMA_DATA_DIR(앱이 실행할 때 넘김)이 있으면 그곳, 없으면 %LOCALAPPDATA%\LocalGemmaDesktop.
// 앱 폴더 옆에 "사용자데이터" 폴더가 있으면 데스크톱 앱이 그 경로를 GEMMA_DATA_DIR로 넘깁니다(따로 쓰는 시험·휴대용 설치).
import os from 'node:os';
import path from 'node:path';
export const appDataDir=()=>process.env.GEMMA_DATA_DIR||path.join(process.env.LOCALAPPDATA||os.homedir(),'LocalGemmaDesktop');
