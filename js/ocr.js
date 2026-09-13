// 스크린샷에서 글자 읽기 (한글 Tesseract). 폰 안에서만 돌아가고 사진은 아무 데도 안 보낸다.
//
// 여기는 '사진 → 글' 딱 한 가지만 한다. 그 글을 품목·가격으로 바꾸는 규칙은
// js/calc.js 의 parseOrderText 에 있다 — 나중에 읽는 방법을 바꿔도(예: 비전 API)
// 이 파일만 갈아 끼우면 되도록 나눠 뒀다.
//
// 처음 한 번은 라이브러리·wasm·한글 학습 데이터(합쳐 5MB 남짓)를 받는다. 그 뒤로는 브라우저가 캐시한다.
const V = '7.0.0';

// 한글 학습 데이터는 **best_int** 를 쓴다. 기본값인 tessdata.projectnaptha.com/4.0.0 은
// 한글 글자 사이에 공백을 넣어 버려서(`[ 사 조 대 림 ]`) 품목 이름을 못 쓴다 — 실제 컬리 주문
// 화면으로 재 보면 글자 정확도가 40% 대 84% 로 갈렸다. 게다가 이쪽이 2.2MB 로 15.3MB 보다 작다.
const LANG_V = '1.0.0';

// 주소를 전부 못 박아 둔다. 안 그러면 라이브러리가 제 버전에 맞는 파일을 스스로 찾아가느라
// 버전이 어긋날 수 있다. 시험할 때 같은 출처 사본으로 바꿔 끼우려고 밖으로 열어 뒀다.
export const paths = {
  lib: `https://cdn.jsdelivr.net/npm/tesseract.js@${V}/dist/tesseract.min.js`,
  worker: `https://cdn.jsdelivr.net/npm/tesseract.js@${V}/dist/worker.min.js`,
  core: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${V}`,
  lang: `https://cdn.jsdelivr.net/npm/@tesseract.js-data/kor@${LANG_V}/4.0.0_best_int`,
};

let loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('script'));
    document.head.appendChild(el);
  });
}

// 라이브러리는 쓸 때 한 번만 받는다 (앱을 켤 때마다 15MB를 받으면 안 된다).
async function tesseract() {
  if (window.Tesseract) return window.Tesseract;
  loading = loading ?? loadScript(paths.lib);
  await loading;
  if (!window.Tesseract) throw new Error('tesseract');
  return window.Tesseract;
}

// 이 브라우저에서 쓸 수 있는지 (오래된 웹뷰 대비).
export const supported = () => typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';

// file(사진) → 읽은 글. onProgress(0~1) 로 진행률을 알려 준다.
// 주문 내역은 '한 칸에 위에서 아래로 쌓인 글' 이다. 기본값(3 = 알아서 판단)보다
// 4(한 칸짜리 글) 가 이 화면에서 확실히 낫다 (글자 정확도 78% → 84%).
const PAGESEG_SINGLE_COLUMN = '4';

export async function readText(file, onProgress = () => {}) {
  const T = await tesseract();
  const worker = await T.createWorker('kor', 1, {
    workerPath: paths.worker,
    corePath: paths.core,
    langPath: paths.lang,
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(m.progress ?? 0);
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PAGESEG_SINGLE_COLUMN });
    const { data } = await worker.recognize(file);
    return data.text ?? '';
  } finally {
    await worker.terminate();
  }
}
