# /// script
# requires-python = "==3.12.*"
# dependencies = ["rembg[cpu]==2.0.67"]
# ///
"""Segment a photo locally, optionally trim transparent margins and save RGBA PNG."""

import argparse
import json
import os
from pathlib import Path
import tempfile

from PIL import Image, ImageChops, ImageOps
from rembg import new_session


def cached_session(model):
    import hashlib
    import onnxruntime as ort
    from rembg.sessions.dis_general_use import DisSession

    class CachedDisSession(DisSession):
        @classmethod
        def download_models(cls, *args, **kwargs):
            model_file = Path(cls.u2net_home()) / (model + ".onnx")
            if not model_file.is_file():
                raise FileNotFoundError("PHOTO_CACHE_MISS: 누끼 모델이 로컬 캐시에 없습니다.")
            with model_file.open("rb") as stream:
                digest = hashlib.file_digest(stream, "md5").hexdigest()
            if digest != "fc16ebd8b0c10d971d3513d564d01e29":
                raise ValueError("PHOTO_CACHE_MISS: 캐시된 누끼 모델이 불완전합니다.")
            return model_file

    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 2
    return CachedDisSession(model, options, providers=["CPUExecutionProvider"])


def edge_counts(alpha):
    w, h = alpha.size
    strips = {"left": (0, 0, 1, h), "top": (0, 0, w, 1),
              "right": (w-1, 0, w, h), "bottom": (0, h-1, w, h)}
    return {name: sum(alpha.crop(strip).histogram()[96:]) for name, strip in strips.items()}


def significant_edges(alpha, counts):
    return [name for name, count in counts.items()
            if count >= max(2, round((alpha.width if name in ("top", "bottom") else alpha.height)*.02))]


def cutout(source, destination, crop, padding, region, offline=False, auto_region=False):
    if source.resolve() == destination.resolve() or destination.suffix.lower() != ".png":
        raise ValueError("원본과 다른 PNG 경로를 지정하세요.")
    if padding < 0:
        raise ValueError("여백은 0 이상의 정수여야 합니다.")
    with Image.open(source) as opened:
        photo = ImageOps.exif_transpose(opened).convert("RGBA")
    width, height = photo.size
    region_box = (0, 0, width, height)
    if region is not None:
        left, top, right, bottom = region
        if not (0 <= left < right <= 1000 and 0 <= top < bottom <= 1000):
            raise ValueError("선택 영역 좌표가 잘못되었습니다.")
        # Round outwards against the EXIF-oriented, full-resolution photo.
        region_box = (left*width//1000, top*height//1000,
                      (right*width+999)//1000, (bottom*height+999)//1000)
        if min(region_box[2]-region_box[0], region_box[3]-region_box[1]) < 2:
            raise ValueError("선택 영역의 너비와 높이는 각각 2픽셀 이상이어야 합니다.")
    model = "isnet-general-use"
    session = cached_session(model) if offline else new_session(model, providers=["CPUExecutionProvider"])
    def segment(box):
        part = photo.crop(box)
        mask, = session.predict(part.convert("RGB"))
        return part, ImageChops.multiply(part.getchannel("A"), mask.convert("L"))

    initial_box = region_box
    part, alpha = segment(region_box)
    counts = edge_counts(alpha)
    sides = ("left", "top", "right", "bottom")
    full_box = (0, 0, width, height)
    touched = significant_edges(alpha, counts)
    clipped = [side for i, side in enumerate(sides)
               if region_box[i] != full_box[i] and side in touched]
    check = {"mode": "subject-hint" if region and auto_region else "fixed" if region else "full",
             "initialBox": initial_box, "initialEdgePixels": counts,
             "internalEdges": clipped, "adjusted": False}
    for attempt in range(2):
        if not region or not auto_region or not clipped:
            break
        expanded = (tuple(full_box[i] if side in clipped else coord
                          for i, (side, coord) in enumerate(zip(sides, region_box)))
                    if attempt == 0 else full_box)
        retry_part, retry_alpha = segment(expanded)
        # Keep the originally selected subject when zooming out to inspect its boundaries.
        offset_box = (region_box[0]-expanded[0], region_box[1]-expanded[1],
                      region_box[2]-expanded[0], region_box[3]-expanded[1])
        old_core = alpha.point(lambda value: 255 if value >= 128 else 0)
        new_core = retry_alpha.crop(offset_box).point(lambda value: 255 if value >= 64 else 0)
        count = old_core.histogram()[255]
        overlap = ImageChops.multiply(old_core, new_core).histogram()[255]
        if not count or overlap/count < .55:
            raise ValueError("확대한 영역에서 같은 피사체를 확인하지 못했습니다. 전체 사진을 다시 보고 영역을 선택하세요.")
        part, alpha, region_box = retry_part, retry_alpha, expanded
        check.update(adjusted=True, overlap=round(overlap/count, 3))
        touched = significant_edges(alpha, edge_counts(alpha))
        clipped = [side for i, side in enumerate(sides) if side in touched and expanded[i] != full_box[i]]
    photo = part
    final_edges = significant_edges(alpha, edge_counts(alpha))
    check["sourceEdges"] = [side for i,side in enumerate(sides)
                            if side in final_edges and region_box[i] == full_box[i]]
    check["finalBox"] = region_box
    # Clear the faint haze that model interpolation can leave in the background.
    # Keep soft hair/fur edges above this floor.
    alpha = alpha.point(lambda value: 0 if value < 4 else value)
    bounds = alpha.getbbox()
    if not bounds or alpha.getextrema()[1] < 128:
        raise ValueError("사진에서 뚜렷한 전경을 찾지 못했습니다.")
    if alpha.getextrema()[0] == 255:
        raise ValueError("전경과 분리되는 배경을 찾지 못했습니다.")
    photo.putalpha(alpha)
    # Zero hidden RGB as well, so transparent pixels contain no original backdrop.
    photo.paste((0, 0, 0, 0), mask=alpha.point(lambda value: 255 if value == 0 else 0))
    left, top, right, bottom = bounds
    bounds = (left+region_box[0], top+region_box[1], right+region_box[0], bottom+region_box[1])
    crop_box = ((max(0, bounds[0]-padding), max(0, bounds[1]-padding),
                 min(width, bounds[2]+padding), min(height, bounds[3]+padding))
                if crop else (0, 0, width, height))
    result = Image.new("RGBA", (crop_box[2]-crop_box[0], crop_box[3]-crop_box[1]))
    result.paste(photo, (region_box[0]-crop_box[0], region_box[1]-crop_box[1]))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, suffix=".png", delete=False) as tmp:
        temporary = Path(tmp.name)
    try:
        result.save(temporary, format="PNG")
        with Image.open(temporary) as saved:
            saved.load()
            histogram = saved.getchannel("A").histogram()
            size = saved.size
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return {"path": str(destination.resolve()), "width": size[0], "height": size[1],
            "originalWidth": width, "originalHeight": height, "bounds": bounds,
            "regionBox": region_box, "cropBox": crop_box, "regionCheck": check,
            "transparentPixels": histogram[0], "foregroundPixels": sum(histogram[128:]),
            "model": model}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--crop", action="store_true")
    parser.add_argument("--padding", type=int, default=0)
    parser.add_argument("--region", type=int, nargs=4)
    parser.add_argument("--auto-region", action="store_true")
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    print(json.dumps(cutout(args.source, args.destination, args.crop, args.padding, args.region,
                            args.offline, args.auto_region)))
