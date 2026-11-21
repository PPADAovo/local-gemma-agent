# Blender 범용 모델링 도우미 (app_script의 Blender 어댑터가 사용자 코드보다 먼저 불러 둡니다).
# 물체별 함수(와인잔·머그컵 등)는 두지 않습니다. 물체 예시는 app-adapters/blender.md의 패턴 예시를 보세요.
# 원칙: 회전체(잔·컵·병·그릇·꽃병)는 "단면 프로파일 (반지름 r, 높이 z) 점 목록 → 축 회전(lathe) → 두께(Solidify)
#       → 부드럽게(Subdivision + Shade Smooth)"로 만들고, 손잡이·뚜껑 같은 부속은 따로 만들어 붙입니다.
# 단위는 미터입니다(와인잔 높이 약 0.2, 머그 높이 약 0.1).
import math
import bpy
import bmesh
import mathutils


def clear_scene():
    """기본 큐브·카메라·조명을 포함해 장면의 모든 물체를 지웁니다."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.curves):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _new(name, data):
    """같은 이름의 물체가 이미 있으면(이전 실행의 '접시', '접시.001' 복사본 포함) 지우고 새로 놓습니다.
    수정 요청에서 코드를 다시 실행해도 복사본이 쌓이지 않고 그 물체가 바뀝니다(2026-11-21 "왜 자꾸 새로 만들어")."""
    import re
    pattern = re.compile(re.escape(name) + r'(\.\d{3})?$')
    for old in [o for o in bpy.data.objects if pattern.fullmatch(o.name)]:
        bpy.data.objects.remove(old, do_unlink=True)
    return _link(bpy.data.objects.new(name, data))


def lathe(name, profile, segments=64, thickness=0.002, subdivision=1, smooth=True):
    """profile=[(r, z), ...] 한 줄로 이어진 단면을 Z축으로 360° 회전시켜 물체를 만듭니다."""
    if len(profile) < 2:
        raise ValueError('profile에는 점이 2개 이상 필요합니다.')
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new((max(0.0, float(r)), 0.0, float(z))) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, axis=(0, 0, 1), cent=(0, 0, 0), angle=math.tau,
                   steps=int(segments), use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = _new(name, mesh)
    if thickness:
        mod = obj.modifiers.new('두께', 'SOLIDIFY')
        mod.thickness = float(thickness)
        mod.offset = 0.0
        mod.use_even_offset = True
    if subdivision:
        mod = obj.modifiers.new('부드럽게', 'SUBSURF')
        mod.levels = int(subdivision)
        mod.render_levels = int(subdivision) + 1
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    return obj


def material(kind='ceramic', color=(0.9, 0.9, 0.88, 1.0), name=None):
    """kind: glass(유리) | ceramic(도자기) | metal(금속) | plastic(플라스틱)."""
    mat = bpy.data.materials.new(name or kind)
    mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)

    def put(key, value):
        if bsdf and key in bsdf.inputs:
            bsdf.inputs[key].default_value = value
    put('Base Color', tuple(color))
    mat.diffuse_color = tuple(color)
    if kind == 'glass':
        put('Base Color', (0.95, 0.98, 1.0, 1.0))
        put('Roughness', 0.02)
        put('Transmission Weight', 1.0)
        put('IOR', 1.45)
        mat.diffuse_color = (0.8, 0.9, 1.0, 0.35)
    elif kind == 'metal':
        put('Metallic', 1.0)
        put('Roughness', 0.25)
    elif kind == 'plastic':
        put('Roughness', 0.4)
    else:
        put('Roughness', 0.3)
        put('Coat Weight', 0.4)
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def tube_arc(name, center=(0, 0, 0), radius=0.03, tube_radius=0.004, start_deg=-90, end_deg=90,
             plane='XZ', mat=None, parent=None, steps=32, sides=16):
    """원호를 따라가는 관(손잡이·고리·테두리·파이프 굽은 부분). plane='XZ'면 X-Z 평면의 원호입니다."""
    cx, cy, cz = center
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rows = []
    a0, a1 = math.radians(start_deg), math.radians(end_deg)
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps
        row = []
        for j in range(sides):
            b = math.tau * j / sides
            rr = radius + math.cos(b) * tube_radius
            u, v, w = math.cos(a) * rr, math.sin(b) * tube_radius, math.sin(a) * rr
            p = {'XZ': (u, v, w), 'XY': (u, w, v), 'YZ': (v, u, w)}[plane]
            row.append(bm.verts.new((cx + p[0], cy + p[1], cz + p[2])))
        rows.append(row)
    for i in range(steps):
        for j in range(sides):
            k = (j + 1) % sides
            bm.faces.new((rows[i][j], rows[i][k], rows[i + 1][k], rows[i + 1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = _new(name, mesh)
    if mat:
        assign(obj, mat)
    if parent:
        obj.parent = parent
    return obj


def _primitive(name, build, location, mat):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    build(bm)
    bm.to_mesh(mesh)
    bm.free()
    obj = _new(name, mesh)
    obj.location = location
    if mat:
        assign(obj, mat)
    return obj


def box(name, size=(0.1, 0.1, 0.1), location=(0, 0, 0), mat=None):
    """가로·세로·높이(m) 상자. location은 상자 가운데."""
    def build(bm):
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    return _primitive(name, build, location, mat)


def cylinder(name, radius=0.05, depth=0.1, location=(0, 0, 0), mat=None, segments=48):
    """Z축 원기둥(다리·기둥·판). location은 가운데."""
    def build(bm):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth)
    return _primitive(name, build, location, mat)


def sphere(name, radius=0.05, location=(0, 0, 0), mat=None):
    """구(손잡이 꼭지·장식)."""
    def build(bm):
        bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=radius)
        for f in bm.faces:
            f.smooth = True
    return _primitive(name, build, location, mat)


def setup_scene(target=None, floor=True, background=(0.92, 0.93, 0.95)):
    """카메라·조명·바닥을 놓고 카메라가 대상을 보게 합니다. 여러 번 불러도 앞서 놓은 것을 바꿔 끼웁니다
    (실시간 연결에서 물체를 더한 뒤 다시 불러 구도를 맞출 때 카메라·바닥이 겹치지 않게)."""
    scene = bpy.context.scene
    for old in [o for o in scene.objects if o.name.split('.')[0] in ('바닥', '카메라', '조명', '햇빛')]:
        bpy.data.objects.remove(old, do_unlink=True)
    bpy.context.view_layer.update()
    # 대상을 안 주면 바닥을 뺀 모든 메쉬를 한 덩어리로 보고 그 전체가 들어오게 찍습니다
    # (2026-11-20 와인잔: 볼·스템·받침을 따로 만들면 첫 물체만 보고 볼이 화면 밖으로 잘림).
    targets = [target] if target else [o for o in scene.objects if o.type == 'MESH' and o.name != '바닥']
    corners = [o.matrix_world @ mathutils.Vector(c) for o in targets for c in o.bound_box]
    if corners:
        lo = [min(p[i] for p in corners) for i in range(3)]
        hi = [max(p[i] for p in corners) for i in range(3)]
        size = max(hi[i] - lo[i] for i in range(3)) or 0.2
        center_z = (lo[2] + hi[2]) / 2
    else:
        size, center_z = 0.2, 0.1
    if floor:
        mesh = bpy.data.meshes.new('바닥')
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size * 6)
        bm.to_mesh(mesh)
        bm.free()
        plane = _new('바닥', mesh)
        assign(plane, material('plastic', (0.8, 0.8, 0.82, 1.0), '바닥'))
    cam = _new('카메라', bpy.data.cameras.new('카메라'))
    dist = size * 2.4
    cam.location = (dist * 0.7, -dist, center_z + size * 0.6)
    look = mathutils.Vector((0, 0, center_z)) - cam.location
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    key = _new('조명', bpy.data.lights.new('조명', 'AREA'))
    key.data.energy = 80 * (size / 0.2) ** 2
    key.data.size = size * 2
    key.location = (-size * 2, -size * 2, size * 3)
    key.rotation_euler = (mathutils.Vector((0, 0, center_z)) - key.location).to_track_quat('-Z', 'Y').to_euler()
    sun = _new('햇빛', bpy.data.lights.new('햇빛', 'SUN'))
    sun.data.energy = 2.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.type == 'BACKGROUND'), None)
    if bg:
        bg.inputs[0].default_value = (*background, 1.0)
        bg.inputs[1].default_value = 0.8
    return cam


def render_png(path, size=512):
    scene = bpy.context.scene
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'CYCLES', 'BLENDER_WORKBENCH'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    if scene.render.engine == 'CYCLES':
        scene.cycles.samples = 32
    scene.render.resolution_x = scene.render.resolution_y = int(size)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def report():
    """장면의 물체·치수·메쉬 상태를 숫자로 돌려줍니다(결과 확인용)."""
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    scene = bpy.context.scene
    from bpy_extras.object_utils import world_to_camera_view

    def inside(p):
        v = world_to_camera_view(scene, scene.camera, p)
        return 0 <= v.x <= 1 and 0 <= v.y <= 1 and v.z > 0

    def in_view(obj):
        if not scene.camera:
            return None
        corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        return any(inside(p) for p in corners + [sum(corners, mathutils.Vector()) / 8])

    def fully_in_view(obj, mesh):
        """실제 꼭짓점이 모두 화면 안 = 잘리지 않고 전체가 보임.
        (경계 상자 모서리로 재면 둥근 물체는 모서리만 튀어나와 멀쩡한데도 잘렸다고 나옴)"""
        if not scene.camera:
            return None
        verts = mesh.vertices
        step = max(1, len(verts) // 3000)   # 큰 메쉬는 골고루 3천 개 정도만 확인
        margin = 0.01
        for i in range(0, len(verts), step):
            v = world_to_camera_view(scene, scene.camera, obj.matrix_world @ verts[i].co)
            if not (-margin <= v.x <= 1 + margin and -margin <= v.y <= 1 + margin and v.z > 0):
                return False
        return True
    rows = []
    for obj in bpy.context.scene.objects:
        row = {'name': obj.name, 'type': obj.type, 'dimensions': [round(v, 4) for v in obj.dimensions],
               'location': [round(v, 4) for v in obj.location]}
        if obj.type == 'MESH':
            ev = obj.evaluated_get(depsgraph)
            data = ev.to_mesh()
            row.update(verts=len(data.vertices), faces=len(data.polygons),
                       materials=[m.name for m in obj.data.materials if m],
                       modifiers=[m.type for m in obj.modifiers])
            row['fully_in_view'] = fully_in_view(obj, data)
            ev.to_mesh_clear()
            row['invalid_geometry_fixed'] = bool(obj.data.validate(verbose=False))
            row['in_camera_view'] = in_view(obj)
            corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
            row['bbox_min'] = [round(min(p[i] for p in corners), 4) for i in range(3)]
            row['bbox_max'] = [round(max(p[i] for p in corners), 4) for i in range(3)]
        rows.append(row)
    return rows


def remove_objects(*prefixes):
    """이름이 prefixes 중 하나로 시작하는 물체(복사본 '접시.001' 포함)를 모두 지웁니다.
    실시간 연결에서 같은 물체를 다시 만들기 전에 부르세요. 예: remove_objects('접시', '쿠키')"""
    removed = []
    for obj in list(bpy.context.scene.objects):
        if any(obj.name.startswith(p) for p in prefixes):
            removed.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
    return removed
