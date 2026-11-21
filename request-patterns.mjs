// 요청 문장을 보고 판단하는 키워드 규칙을 한곳에 모은 파일입니다.
// 같은 판단을 여러 파일에 복사해 두면 한쪽만 고쳐져 어긋나므로, 모든 파일이 여기 것을 가져다 씁니다.

export const SCREENSHOT=/(?:스크린\s*[샷숏]|스샷|캡[처쳐]|화면.{0,8}찍|screenshot)/i;
export const MAIL=/(?:이메일|메일|지메일|gmail|e-?mail)/i;
export const SEND=/보내|발송|전송|send/i;
export const ATTACHMENT=/(?:첨부|스크린\s*[샷숏]|스샷|캡[처쳐]|screenshot)/i;
// "10초 정도 찍어서", "1분 동안 촬영"처럼 시간을 말하고 찍으라고 하면 사진이 아니라 동영상 녹화입니다.
export const VIDEO_RECORDING=/(?:화면|바탕\s*화면|데스크톱|컴퓨터\s*화면).{0,16}(?:녹화|동영상)|(?:녹화|record(?:ing)?).{0,16}(?:화면|데스크톱|screen|desktop)|(?:record|recording) (?:my |the )?(?:desktop|screen)|\d+\s*(?:초|분)\s*(?:정도|가량|쯤)?\s*(?:간|동안)?\s*(?:찍|촬영|담아|녹화)/i;
export const MANY_SHOTS=/(?:[2-9]|\d{2,}|두|세|네|다섯|여러)\s*(?:장|번|개)/;

const text=value=>String(value??'');
export const isScreenshotRequest=value=>SCREENSHOT.test(text(value)) && !VIDEO_RECORDING.test(text(value));
export const isScreenshotMail=value=>isScreenshotRequest(value) && MAIL.test(text(value)) && SEND.test(text(value));
export const isMailAttachmentRequest=value=>MAIL.test(text(value)) && ATTACHMENT.test(text(value));
export const isVideoRecordingRequest=value=>VIDEO_RECORDING.test(text(value));
export const wantsManyShots=value=>MANY_SHOTS.test(text(value));
