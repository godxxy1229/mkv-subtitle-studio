# v0.2.0 검증 결과 — 2026-10-15

## 완료

- Node.js v22.16.0: 단위 테스트 21/21 통과.
- 실제 5초 MPEG4 + AAC MKV에 SRT 추가 후, 출력 MKV에 SRT를 다시 추가하는 통합 테스트 통과.
- ffprobe: 영상 1개, 음성 1개, 자막 2개 확인. 기존 기본 자막 해제 / 새 기본 자막 지정 확인.
- FFmpeg의 encoded stream SHA-256 비교: 원본과 출력의 영상·음성 데이터 동일.
- ffprobe의 자막 packet PTS/duration과 입력 SRT 시각이 일치. FFmpeg -copyts로 추출한 SRT도 일치.
- 생성된 MKV의 3초 지점 탐색/디코딩 확인.
- 재생 시간이 10,800초인 저비트레이트 합성 MKV(175,112 bytes): 시작, 중간, 끝 자막 시각 및 종료부 탐색 통과.
- 가상 5 GiB 초과 파일 단위 테스트: 큰 오프셋 처리, 읽기 크기 제한 및 cue 재계산 검증.

## 검증하지 못한 항목

- 실제 수십 GB 영상의 저장 속도·메모리 측정. 위 가상 파일 테스트는 실제 대용량 복사 실험이 아님.
- 브라우저에서 파일 선택부터 네이티브 저장 대화상자를 거친 디스크 저장까지의 전체 과정. 저장 대화상자는 자동화 테스트로 다룰 수 없어 수동 확인이 필요함.
- 다양한 브라우저, TV, VLC/mpv 전체 버전 및 특수한 MKV 파일과의 호환성.

## 재현

```sh
npm test
npm run test:integration
npm run test:long
```

Node.js 20 이상이 필요하고, 통합/장시간 테스트는 개발 PC에 ffmpeg와 ffprobe가 있어야 합니다. 웹페이지 방문자에게는 이 프로그램들이 필요하지 않습니다.

FFmpeg는 기본적으로 음수 start_time 같은 입력 시간 오프셋을 정규화할 수 있습니다. 테스트는 저장된 자막 시각을 ffprobe로 직접 검사하고 추출 때 -copyts를 사용합니다.
공식 문서: https://ffmpeg.org/ffmpeg.html#Advanced-options
