# 열린 Blender 실시간 연결(IDLE처럼): `blender --python blender_bridge.py`로 띄운 창 안에서 동작합니다.
# - 127.0.0.1의 임의 포트에 소켓 서버를 열고, 포트·토큰·PID를 GEMMA_BLENDER_BRIDGE_FILE(JSON)에 적습니다.
# - 받은 코드는 bpy.app.timers로 Blender 메인 스레드에서 실행합니다(화면에 바로 반영).
# - 실행 공간(변수)과 장면은 호출 사이에 유지됩니다. 장면을 새로 시작하려면 코드에서 clear_scene()을 부릅니다.
# - 실행 후 장면 보고(이름·크기·카메라 시야 안 여부), .blend 저장, 작은 렌더 PNG를 돌려줍니다.
import contextlib
import io
import json
import os
import queue
import secrets
import socket
import sys
import threading
import traceback

import bpy

APP_DIR = os.path.dirname(os.path.abspath(__file__))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)
import blender_helpers as recipes  # noqa: E402

STATE_FILE = os.environ.get('GEMMA_BLENDER_BRIDGE_FILE') or os.path.join(
    os.environ.get('LOCALAPPDATA', APP_DIR), 'LocalGemmaDesktop', 'blender-bridge.json')
TOKEN = secrets.token_hex(16)
jobs = queue.Queue()
namespace = {'__name__': '__gemma__', 'bpy': bpy}
namespace.update({k: v for k, v in vars(recipes).items() if not k.startswith('_')})
for module in ('math', 'bmesh', 'mathutils'):
    namespace[module] = __import__(module)


def scene_sizes():
    return {o.name: [round(v, 4) for v in o.dimensions] for o in bpy.context.scene.objects}


def run_job(request):
    global recipes
    result = {'ok': True, 'error': '', 'output': '', 'live': True}
    try:
        # 앱이 레시피를 고쳐도 창을 다시 띄우지 않고 반영되게, 매번 다시 불러옵니다(사용자가 만든 변수는 유지).
        import importlib
        recipes = importlib.reload(recipes)
        namespace.update({k: v for k, v in vars(recipes).items() if not k.startswith('_')})

        def clear_and_mark():
            recipes.clear_scene()
            namespace['_scene_cleared'] = True
        namespace['clear_scene'] = clear_and_mark
        result['before'] = scene_sizes()
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer):
                exec(compile(request.get('code', ''), 'blender_python', 'exec'), namespace)
        except Exception:
            result['ok'] = False
            result['error'] = traceback.format_exc(limit=6)[-3000:]
        result['output'] = buffer.getvalue()[-3000:]
        if result['ok']:
            # 구도는 사용자가 요청한 내용이 아니므로, 카메라가 없거나 부품이 화면 밖·잘림이면 도구가 다시 맞춥니다.
            rows = recipes.report()
            cut = [r for r in rows if r.get('type') == 'MESH' and r.get('name') != '바닥' and r.get('fully_in_view') is False]
            if cut or not any(o.type == 'CAMERA' for o in bpy.context.scene.objects):
                recipes.setup_scene()
                result['reframed'] = True
                rows = recipes.report()
            result['objects'] = rows
            blend = request.get('blend')
            # 이 창에서 이미 저장한 문서가 있으면 그 파일을 고쳐 덮어씁니다(실행마다 새 이름 파일이 생기지 않게).
            # 새 문서는 clear_scene()으로 장면을 비운 뒤에만 새 이름으로 저장합니다.
            if bpy.data.filepath and not request.get('new_document') and not namespace.get('_scene_cleared'):
                blend = bpy.data.filepath
                result['same_document'] = True
            namespace['_scene_cleared'] = False
            if blend:
                os.makedirs(os.path.dirname(blend), exist_ok=True)
                bpy.ops.wm.save_as_mainfile(filepath=blend, check_existing=False)
                result['blend'] = blend
            png, size = request.get('png'), int(request.get('size') or 0)
            if result.get('same_document'):
                png = os.path.splitext(blend)[0] + '.png'
            if png and size > 0:
                recipes.render_png(png, size)
                result['png'] = png
    except Exception:
        result['ok'] = False
        result['error'] = (result['error'] + '\n' + traceback.format_exc(limit=6))[-3000:]
    return result


def pump():
    try:
        while True:
            request, conn = jobs.get_nowait()
            try:
                answer = run_job(request)
            except Exception:
                answer = {'ok': False, 'error': traceback.format_exc(limit=4)}
            try:
                conn.sendall((json.dumps(answer, ensure_ascii=False) + '\n').encode('utf-8'))
            finally:
                conn.close()
    except queue.Empty:
        pass
    return 0.1


def serve(server):
    while True:
        conn, _ = server.accept()
        try:
            data = b''
            while not data.endswith(b'\n') and len(data) < 2_000_000:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                data += chunk
            request = json.loads(data.decode('utf-8'))
            if request.get('token') != TOKEN:
                conn.close()
                continue
            if request.get('ping'):
                conn.sendall(b'{"ok": true, "pong": true}\n')
                conn.close()
                continue
            jobs.put((request, conn))
        except Exception:
            try:
                conn.close()
            except Exception:
                pass


def start():
    if os.environ.get('GEMMA_BLENDER_FRESH') == '1':
        recipes.clear_scene()
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(('127.0.0.1', 0))
    server.listen(4)
    threading.Thread(target=serve, args=(server,), daemon=True).start()
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, 'w', encoding='utf-8') as handle:
        json.dump({'port': server.getsockname()[1], 'token': TOKEN, 'pid': os.getpid()}, handle)
    bpy.app.timers.register(pump, persistent=True)
    print('[gemma] Blender 실시간 연결 준비:', server.getsockname()[1])


start()
