# PPT 만들기: JSON 슬라이드 목록을 .pptx 파일로 저장합니다 (한쇼·파워포인트 모두 열림).
# 사용: python make_ppt.py slides.json 출력.pptx
# slides.json 예: {"title":"자기소개","theme":"blue","slides":[{"title":"홍길동 자기소개","subtitle":"2026"},{"title":"소개","bullets":["이름: 홍길동","취미: 기타 연주"]},{"title":"감사합니다"}]}
import json, sys
sys.stdout.reconfigure(encoding='utf-8')
try:
    from pptx import Presentation
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN
except ImportError:
    print('NEED_PYTHON_PPTX'); sys.exit(3)

THEMES = {
    'blue': ('1F3A68', 'FFFFFF', 'EAF1FB', '1F3A68'),
    'dark': ('111827', 'F9FAFB', '1F2937', 'F9FAFB'),
    'green': ('14532D', 'FFFFFF', 'ECFDF3', '14532D'),
    'warm': ('7C2D12', 'FFFFFF', 'FFF7ED', '7C2D12'),
}
FONT = '맑은 고딕'

def rgb(h): return RGBColor.from_string(h)

def fill(slide, prs, color):
    bg = slide.background.fill; bg.solid(); bg.fore_color.rgb = rgb(color)

def text(tf, s, size, color, bold=False, align=None):
    tf.clear(); p = tf.paragraphs[0]; r = p.add_run(); r.text = s
    r.font.size = Pt(size); r.font.bold = bold; r.font.color.rgb = rgb(color); r.font.name = FONT
    if align is not None: p.alignment = align
    return p

def main(src, out):
    spec = json.load(open(src, encoding='utf-8'))
    slides = spec.get('slides') or []
    if not slides: raise SystemExit('slides가 비어 있습니다.')
    accent, on_accent, body_bg, body_fg = THEMES.get(spec.get('theme', 'blue'), THEMES['blue'])
    prs = Presentation(); prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    W, H = prs.slide_width, prs.slide_height
    for i, s in enumerate(slides):
        sl = prs.slides.add_slide(blank)
        bullets = s.get('bullets') or []
        cover = (i == 0 or i == len(slides) - 1) and not bullets
        if cover:
            fill(sl, prs, accent)
            box = sl.shapes.add_textbox(Inches(0.8), Inches(2.6), W - Inches(1.6), Inches(1.6))
            box.text_frame.word_wrap = True
            text(box.text_frame, s.get('title', ''), 54, on_accent, True, PP_ALIGN.CENTER)
            if s.get('subtitle'):
                sub = sl.shapes.add_textbox(Inches(0.8), Inches(4.3), W - Inches(1.6), Inches(1))
                text(sub.text_frame, s['subtitle'], 24, on_accent, False, PP_ALIGN.CENTER)
        else:
            fill(sl, prs, body_bg)
            bar = sl.shapes.add_shape(1, 0, 0, W, Inches(1.3)); bar.fill.solid(); bar.fill.fore_color.rgb = rgb(accent); bar.line.fill.background()
            t = sl.shapes.add_textbox(Inches(0.6), Inches(0.25), W - Inches(1.2), Inches(0.9))
            text(t.text_frame, s.get('title', ''), 34, on_accent, True)
            body = sl.shapes.add_textbox(Inches(0.9), Inches(1.8), W - Inches(1.8), H - Inches(2.4))
            tf = body.text_frame; tf.word_wrap = True; tf.clear()
            for j, b in enumerate(bullets):
                p = tf.paragraphs[0] if j == 0 else tf.add_paragraph()
                r = p.add_run(); r.text = '•  ' + str(b)
                r.font.size = Pt(28); r.font.color.rgb = rgb(body_fg); r.font.name = FONT
                p.space_after = Pt(14)
        if s.get('notes'):
            sl.notes_slide.notes_text_frame.text = s['notes']
    prs.save(out)
    print('저장: ' + out + ' (' + str(len(slides)) + '장)')

if __name__ == '__main__':
    if len(sys.argv) < 3: raise SystemExit('사용법: make_ppt.py slides.json 출력.pptx')
    main(sys.argv[1], sys.argv[2])
