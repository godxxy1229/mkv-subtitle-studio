# MKV Subtitle Studio

브라우저에서 MKV 영상에 SRT 자막 트랙을 추가합니다. 업로드도, 재인코딩도 하지 않습니다.

**▶ [앱 열기](https://godxxy1229.github.io/mkv-subtitle-studio/)** · [English](README.md)

## 사용법

1. 데스크톱 Chrome 또는 Edge에서 앱을 엽니다. 오른쪽 위 **한국어** 버튼으로 화면 언어를 바꿀 수 있습니다.
2. `.mkv` 영상과 `.srt` 자막을 끌어다 놓습니다.
3. 자막 언어와 트랙 이름을 정하고 **자막 추가 후 저장**을 누릅니다.
4. 새 MKV를 플레이어에서 열고 자막 트랙을 켭니다.

## 알아두기

- 영상·음성은 그대로 복사하고 자막 트랙만 추가합니다. 원본은 수정하거나 덮어쓰지 않습니다.
- 파일은 업로드되지 않습니다. 모든 처리가 브라우저 안에서 이루어지고, 페이지의 보안 정책(CSP)이 네트워크 요청을 막습니다.
- 데스크톱 Chrome·Edge는 디스크에 바로 저장해 큰 파일도 처리할 수 있습니다. 다른 브라우저는 256 MiB까지입니다.
- SRT만 지원합니다(UTF-8, BOM이 있는 UTF-16, CP949/EUC-KR). 최대 16 MiB, 50,000구간입니다.
- 일부 MKV 구조는 안전을 위해 거부합니다(여러 Segment, 크기를 알 수 없는 Cluster 등). MKVToolNix를 대체하지는 않습니다.
- 베타(v0.2)입니다. 수 GB 이상 실제 파일로는 아직 검증하지 않았으니 원본을 보관하세요. [검증 결과](docs/TEST_RESULTS.md)

문제가 있으면 브라우저, 오류 메시지, `ffprobe -show_streams` 출력을 [이슈](https://github.com/godxxy1229/mkv-subtitle-studio/issues)로 남겨 주세요. 영상 파일은 첨부하지 마세요.

개발과 배포는 [README.md](README.md#development)와 [DEPLOY.md](DEPLOY.md)를 참고하세요. 라이선스: [MIT](LICENSE).
