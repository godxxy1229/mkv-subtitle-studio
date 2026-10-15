# 배포 안내

저장소 관리자와 직접 호스팅하려는 분을 위한 문서입니다. 사이트만 쓰려면 [README](README.md)의 링크를 열면 됩니다.

## 구조

빌드 단계가 없는 정적 사이트입니다. 실제로 배포되는 파일은 `index.html`, `src/`, `LICENSE`뿐이고 나머지(`tests/`, `scripts/`, `docs/` 등)는 개발용입니다.

| 워크플로 | 실행 시점 | 하는 일 |
| --- | --- | --- |
| `.github/workflows/tests.yml` | 모든 push, pull request | 단위 테스트, ffmpeg 통합 테스트, 장시간 테스트 |
| `.github/workflows/pages.yml` | `main`에 push, 수동 실행 | 단위 테스트 후 배포 파일만 모아 GitHub Pages에 배포 |

## 처음 한 번: 저장소 만들기와 Pages 켜기

### 명령줄 (git, GitHub CLI)

[GitHub CLI](https://cli.github.com/)에 로그인된 상태(`gh auth status`)에서 프로젝트 폴더에서 실행합니다.

```sh
git init -b main
git add .
git commit -m "Initial release"
gh repo create godxxy1229/mkv-subtitle-studio --public --source . --remote origin \
  --description "Add an SRT subtitle track to MKV files in the browser — no upload, no re-encoding"
gh api -X POST repos/godxxy1229/mkv-subtitle-studio/pages -f build_type=workflow
git push -u origin main
```

`gh api` 줄은 Pages의 배포 방식을 GitHub Actions로 켭니다. 이 명령이 실패하면 웹에서 Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 바꾼 뒤, Actions 탭에서 **Publish GitHub Pages** 워크플로를 다시 실행하세요.

### 웹 업로드 (git 없이)

1. GitHub에서 New repository로 `mkv-subtitle-studio` 공개 저장소를 만듭니다. README 추가 옵션은 체크하지 않습니다.
2. 프로젝트 폴더의 **내용물**을 업로드 화면에 끌어다 놓습니다. 폴더 자체가 아니라 그 안의 파일들을 올려야 합니다.
3. 업로드된 목록에 `.github/workflows/` 폴더가 포함됐는지 확인하세요. 점(`.`)으로 시작하는 폴더는 운영체제 설정에 따라 빠질 수 있고, 빠지면 자동 배포가 동작하지 않습니다.
4. Settings → Pages → Source를 **GitHub Actions**로 바꾸고, Actions 탭에서 **Publish GitHub Pages**를 실행합니다.

배포가 끝나면 사이트 주소는 `https://godxxy1229.github.io/mkv-subtitle-studio/`입니다.

## 이후 업데이트

`main`에 push하면 단위 테스트를 통과한 경우에만 자동으로 다시 배포됩니다. Actions 탭에서 **Publish GitHub Pages**를 수동으로 실행할 수도 있습니다.

## 배포 후 확인

- [ ] Actions 탭에서 Tests와 Publish GitHub Pages가 모두 성공했는지
- [ ] 사이트가 열리고 브라우저 콘솔에 오류가 없는지
- [ ] 작은 MKV/SRT로 저장, 기본 자막 지정, 작업 취소가 동작하는지
- [ ] 결과 MKV를 플레이어로 열어 영상·음성, 자막 시각, 탐색이 정상인지
- [ ] DevTools Network 탭에 영상 업로드 요청이 없는지

작은 샘플로 확인한 뒤 큰 파일로 넓혀 가세요.

## 다른 곳에 직접 호스팅

`index.html`, `src/`, `LICENSE`를 HTTPS 정적 호스팅(Netlify, Cloudflare Pages, 자체 웹 서버 등)에 그대로 올리면 됩니다. 서버 측 코드나 빌드는 필요 없습니다. 디스크 직접 저장 기능은 HTTPS나 localhost에서만 동작합니다.

## 참고: 커밋 작성자 정보

공개 저장소의 커밋 기록에는 `git config user.email`에 설정된 이메일이 그대로 남습니다. 개인 메일을 공개하고 싶지 않다면 GitHub의 noreply 주소(Settings → Emails에서 확인)를 이 저장소에만 설정할 수 있습니다.

```sh
git config user.email "ID+사용자명@users.noreply.github.com"
```

공식 문서:
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
