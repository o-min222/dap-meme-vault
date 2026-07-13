# Meme Vault (짤 저장소)

현재 버전: **0.3.0**

재밌는 이미지를 DAP의 로컬 전용 저장소에 모아두고, 제목과 태그로 찾아 채팅이나 글에 바로 넣는 외부 플러그인입니다.

## 사용법

1. `Ctrl+Shift+M` 또는 펫 메뉴의 **짤 저장소**를 엽니다.
2. **+ 짤 추가**를 누르고 파일 또는 클립보드에서 이미지를 가져옵니다.
3. 같은 화면에서 제목과 태그를 입력한 뒤 저장합니다.
4. 카드를 클릭해 직전에 사용하던 앱에 붙여넣거나, 이미지를 끌어 채팅/에디터에 첨부합니다.

DAP 채팅에서 `축하 짤`, `당황 밈`처럼 말하면 해당 검색어로 저장소가 열립니다.

## 특징

- 이미지 원본과 메타데이터는 `<userData>/plugin-data/io.github.o-min222.meme_vault/`에만 저장
- 제목·태그 검색, 검색 결과 랜덤 선택, 사용 횟수/최근 사용순
- 같은 이미지는 중복 저장하지 않고 제목·태그만 갱신
- PNG·JPEG·GIF·WebP 파일 등록 (파일당 최대 20MB)
- 클릭 붙여넣기가 안 되는 앱에서는 이미지 카드를 직접 드래그

## 권한

- `clipboard.history`: 최근 복사한 이미지 읽기 (DAP 설정에서 별도 옵트인 필요)
- `storage.private`: 이미지와 제목·태그 영구 보관
- `window.palette`: 저장소 UI 표시
- `input.synthesize`: 이미지 붙여넣기
- `dragdrop.export`: 이미지 파일 드래그

## 개발 설치

이 폴더를 `%APPDATA%\dap\plugins\io.github.o-min222.meme_vault\`에 복사한 뒤 DAP에서 활성화합니다.

```powershell
node test/plugin.test.mjs
```

카탈로그 배포 전에는 공개 저장소와 버전 태그를 만든 후 `dap-plugins/plugin_catalog.json`에 같은 `id`를 등록해야 합니다.
