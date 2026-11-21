# FreeCAD (app_script app="freecad", Python FreeCAD/Part)

## 실행 방식
- 창 없는 실행기(FreeCADCmd)에서 새 문서 `doc`에 코드를 실행하고 .FCStd로 저장합니다. 렌더 이미지는 없고, 물체별 크기·부피·유효성이 결과로 옵니다.
- 미리 있는 이름: `App`(=FreeCAD), `Part`, `doc`, `Vector`, `math`. 단위는 **mm**.
- 저장·내보내기·파일 열기는 도구가 합니다(코드에서 막힘). 끝나면 open_file로 .FCStd를 열어 보여 줍니다.

## 기본 패턴
- 형상 만들기: `Part.makeBox(가로,세로,높이, Vector(x,y,z))`, `Part.makeCylinder(반지름,높이, Vector(..))`, `Part.makeSphere(r)`
- 불리언: `a.fuse(b)`, `a.cut(b)`, `a.common(b)`; 모서리 둥글게 `shape.makeFillet(r, shape.Edges)`
- 문서에 넣기(이름은 요청 낱말로): `doc.addObject("Part::Feature", "브래킷").Shape = 형상`
- 회전체: `Part.Face(Part.makePolygon([Vector(...), ...닫힌 점]))` 를 `.revolve(Vector(0,0,0), Vector(0,0,1), 360)`

## 지켜야 할 것
- 결과의 물체 목록·치수·isValid만 사실입니다. 거기 없는 것을 답에 쓰지 마세요.
