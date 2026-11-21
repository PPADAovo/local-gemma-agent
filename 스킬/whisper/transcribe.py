import sys, os, tempfile
sys.stdout.reconfigure(encoding='utf-8')

def add_cuda_dlls():
    # pip 의 nvidia-cublas-cu12 / nvidia-cudnn-cu12 DLL 폴더를 찾을 수 있게 등록한다.
    try:
        import nvidia
    except ImportError:
        return
    for base in getattr(nvidia, '__path__', []):
        for name in ('cublas', 'cudnn'):
            d = os.path.join(base, name, 'bin')
            if os.path.isdir(d):
                os.add_dll_directory(d)
                os.environ['PATH'] = d + os.pathsep + os.environ.get('PATH', '')

def run(src, device):
    from faster_whisper import WhisperModel
    if device == 'cuda':
        model = WhisperModel('large-v3-turbo', device='cuda', compute_type='float16')
    else:
        model = WhisperModel('small', device='cpu', compute_type='int8')
    segments, info = model.transcribe(src, language='ko', vad_filter=True)
    return '\n'.join(s.text.strip() for s in segments)  # 실제 계산은 여기서 일어난다

def record(seconds):
    import sounddevice as sd, wave
    rate = 16000
    print(f'{seconds}초 녹음합니다...', flush=True)
    data = sd.rec(int(seconds * rate), samplerate=rate, channels=1, dtype='int16'); sd.wait()
    path = os.path.join(tempfile.gettempdir(), 'whisper-record.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(data.tobytes())
    return path

if len(sys.argv) < 2:
    sys.exit('사용법: transcribe.py 파일경로  |  transcribe.py --record 초')
src = record(int(sys.argv[2]) if len(sys.argv) > 2 else 30) if sys.argv[1] == '--record' else sys.argv[1]
if not os.path.isfile(src):
    sys.exit('파일이 없습니다: ' + src)
add_cuda_dlls()
try:
    text = run(src, 'cuda')
    used = '그래픽카드(large-v3-turbo)'
except Exception as e:
    print('그래픽카드로 실행하지 못해 CPU로 다시 합니다: ' + str(e)[:200], flush=True)
    text = run(src, 'cpu')
    used = 'CPU(small)'
out = os.path.splitext(src)[0] + '.txt'
with open(out, 'w', encoding='utf-8') as f:
    f.write(text)
print(text)
print('\n저장: ' + out + ' · 사용: ' + used)
