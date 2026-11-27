# CodexExcel 작업 지침

## 적용 범위

이 지침은 `C:/Users/soohy/CodexExcel`과 그 하위 폴더에 적용합니다. 작업을 시작할 때 이 파일을 기준으로 삼고, 작업 대상까지의 하위 경로에 `AGENTS.md`가 있으면 함께 확인.

## 프로젝트 문서 확인

추가 지침과 기록은 프로젝트 루트의 `.agents/`에서 찾으세요. `.agents/rules/`, `.agents/memory/`, `.agents/plans/`, `.agents/skills/`에 현재 작업과 관련된 문서가 있으면 읽으세요. `.agents/memory/user-preferences.md`가 있으면 작업 시작 시 확인하세요.

### 웹문서 작성

- HTML 구조는 `.html` 파일에, 스타일은 `.css` 파일에, 동작은 `.js` 파일에 작성하세요.
- HTML에서 CSS 파일은 `<link rel="stylesheet" href="…">`로, JavaScript 파일은 `<script src="…"></script>`로 연결하세요.

## 이 프로젝트 작업 규칙

- 데이터로 쓰는 엑셀 파일은 'excel/'에 있는걸 사용해
- 사이트의 주문은 프로젝트 루트의 `excel/주문내역.xlsx`에 저장하세요.
- 서버는 node를 사용해
- 항상 동적 페이지로 만들어
