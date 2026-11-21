# PDF 합치기·나누기·글자 뽑기·쪽수 확인. 준비: pip install pypdf
# 사용:
#   python pdf-tools.py info  <파일.pdf>
#   python pdf-tools.py text  <파일.pdf> [출력.txt]
#   python pdf-tools.py merge <출력.pdf> <입력1.pdf> <입력2.pdf> ...
#   python pdf-tools.py split <파일.pdf> <시작쪽> <끝쪽> <출력.pdf>      (쪽 번호는 1부터)
import os
import sys

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    sys.exit("pypdf가 없습니다. 먼저 실행하세요: pip install pypdf")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def fail(message):
    sys.exit("오류: " + message)


def must_exist(path):
    if not os.path.isfile(path):
        fail("파일이 없습니다: " + path)
    return path


def keep_existing(path):
    if os.path.exists(path):
        fail("이미 있는 파일은 덮어쓰지 않습니다: " + path)
    return path


def main(argv):
    if len(argv) < 2:
        fail("사용법은 이 파일 맨 위 설명을 보세요.")
    action, args = argv[0], argv[1:]
    if action == "info":
        reader = PdfReader(must_exist(args[0]))
        print("쪽수: %d · 암호: %s" % (len(reader.pages), "있음" if reader.is_encrypted else "없음"))
    elif action == "text":
        reader = PdfReader(must_exist(args[0]))
        pages = ["[%d쪽]\n%s" % (n + 1, page.extract_text() or "") for n, page in enumerate(reader.pages)]
        text = "\n\n".join(pages)
        if not "".join(text.split()).replace("[", "").replace("]", "").replace("쪽", "").strip("0123456789"):
            print("글자를 찾지 못했습니다. 스캔한 그림 PDF일 수 있습니다.")
        if len(args) > 1:
            with open(keep_existing(args[1]), "w", encoding="utf-8") as handle:
                handle.write(text)
            print("저장: %s (%d쪽)" % (os.path.abspath(args[1]), len(reader.pages)))
        else:
            print(text)
    elif action == "merge":
        if len(args) < 3:
            fail("합칠 PDF를 두 개 이상 주세요.")
        writer, total = PdfWriter(), 0
        for source in args[1:]:
            reader = PdfReader(must_exist(source))
            for page in reader.pages:
                writer.add_page(page)
            total += len(reader.pages)
        with open(keep_existing(args[0]), "wb") as handle:
            writer.write(handle)
        print("저장: %s (%d개 파일, 모두 %d쪽)" % (os.path.abspath(args[0]), len(args) - 1, total))
    elif action == "split":
        if len(args) != 4:
            fail("split <파일.pdf> <시작쪽> <끝쪽> <출력.pdf> 형식으로 주세요.")
        reader = PdfReader(must_exist(args[0]))
        first, last = int(args[1]), int(args[2])
        if first < 1 or last > len(reader.pages) or first > last:
            fail("쪽 범위가 맞지 않습니다. 이 파일은 1~%d쪽입니다." % len(reader.pages))
        writer = PdfWriter()
        for index in range(first - 1, last):
            writer.add_page(reader.pages[index])
        with open(keep_existing(args[3]), "wb") as handle:
            writer.write(handle)
        print("저장: %s (%d~%d쪽, %d쪽)" % (os.path.abspath(args[3]), first, last, last - first + 1))
    else:
        fail("모르는 동작입니다: " + action)


if __name__ == "__main__":
    main(sys.argv[1:])
