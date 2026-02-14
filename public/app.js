const extSelect = document.getElementById('extSelect');
const extCount = document.getElementById('extCount');
const statusText = document.getElementById('statusText');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const latestBtn = document.getElementById('latestBtn');
const resultsEl = document.getElementById('results');
const detailEl = document.getElementById('detail');
const detailPanel = document.getElementById('detailPanel');
const backBtn = document.getElementById('backBtn');
const paginationEl = document.getElementById('pagination');
const typeSwitchEl = document.getElementById('typeSwitch');
const typeLabelEl = document.getElementById('typeLabel');
const chapterTitleEl = document.getElementById('chapterTitle');
const readerEl = document.getElementById('reader');
const prevBtn = document.getElementById('prevChapter');
const nextBtn = document.getElementById('nextChapter');
const prevBtnBottom = document.getElementById('prevChapterBottom');
const nextBtnBottom = document.getElementById('nextChapterBottom');
const viewerBackBtn = document.getElementById('viewerBack');
const navHomeBtn = document.getElementById('navHome');
const navSearchBtn = document.getElementById('navSearch');
const navSearchToggleBtn = document.getElementById('navSearchToggle');
const navSearchInput = document.getElementById('navSearchInput');
const navSearchBar = document.getElementById('navSearchBar');
const siteNav = document.querySelector('.site-nav');

let currentHls = null;

const state = {
  extensions: [],
  currentExt: null,
  currentManga: null,
  currentChapter: null,
  chapterNav: { prev: null, next: null },
  currentPage: 1,
  currentType: '',
  mode: 'latest',
  isLoadingManga: false,
  isLoadingChapter: false,
  autoOpenPlayer: false,
  autoOpenBlocked: false
};

function setStatus(text) {
  if (statusText) statusText.textContent = text;
}

function updateNavOffset() {
  if (!siteNav) return;
  const navHeight = siteNav.getBoundingClientRect().height;
  let extra = 0;
  if (document.body.classList.contains('reading')) {
    document.documentElement.style.setProperty('--nav-height', `${navHeight}px`);
    document.documentElement.style.setProperty('--nav-offset', '0px');
    return;
  }
  if (document.body.classList.contains('nav-search-open') && navSearchBar) {
    extra = navSearchBar.scrollHeight || navSearchBar.getBoundingClientRect().height;
  }
  document.documentElement.style.setProperty('--nav-height', `${navHeight}px`);
  document.documentElement.style.setProperty(
    '--nav-offset',
    `${navHeight + extra}px`
  );
}

function getSearchValue() {
  const fromMain = searchInput?.value?.trim();
  if (fromMain) return fromMain;
  const fromNav = navSearchInput?.value?.trim();
  return fromNav || '';
}

function setSearchValue(value) {
  if (searchInput) searchInput.value = value;
  if (navSearchInput) navSearchInput.value = value;
}

function normalizeUrl(value) {
  if (!value) return '';
  try {
    const u = new URL(value, window.location.origin);
    u.hash = '';
    return u.toString().replace(/\/?$/, '/');
  } catch (err) {
    return value.split('#')[0];
  }
}

function deriveNavFromList(currentUrl) {
  const chapters = state.currentManga?.chapters || [];
  if (!chapters.length) return { prev: null, next: null, found: false };
  const target = normalizeUrl(currentUrl);
  const urls = chapters.map((ch) => normalizeUrl(ch.url));
  const idx = urls.indexOf(target);
  if (idx === -1) return { prev: null, next: null, found: false };
  const isDesc = isChapterListDescending(chapters);
  const prevIdx = isDesc ? idx + 1 : idx - 1;
  const nextIdx = isDesc ? idx - 1 : idx + 1;
  return {
    prev: chapters[prevIdx]?.url || null,
    next: chapters[nextIdx]?.url || null,
    found: true
  };
}

function extractChapterNumber(text) {
  if (!text) return null;
  const normalized = String(text).replace(',', '.');
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function getBoundaryChapterNumber(chapters, fromStart) {
  const list = fromStart ? chapters : [...chapters].reverse();
  for (const ch of list) {
    const num = extractChapterNumber(ch.name || ch.title || '');
    if (num !== null) return num;
  }
  return null;
}

function isChapterListDescending(chapters) {
  if (!chapters || chapters.length < 2) return false;
  const firstNum = getBoundaryChapterNumber(chapters, true);
  const lastNum = getBoundaryChapterNumber(chapters, false);
  if (firstNum === null || lastNum === null) return false;
  return firstNum > lastNum;
}

function sanitizeNav(nav, currentUrl) {
  const current = normalizeUrl(currentUrl);
  const clean = {
    prev: nav?.prev ? normalizeUrl(nav.prev) : '',
    next: nav?.next ? normalizeUrl(nav.next) : ''
  };
  const invalid = (value) =>
    !value || value === '/' || value === current || value.endsWith('#');

  return {
    prev: invalid(clean.prev) ? null : nav.prev,
    next: invalid(clean.next) ? null : nav.next
  };
}
function viewUrl(view) {
  const hash = view && view !== 'list' ? `#${view}` : '';
  return `${location.pathname}${location.search}${hash}`;
}

function persistViewState(view, payload = {}) {
  try {
    sessionStorage.setItem(
      'readerView',
      JSON.stringify({ view, ...payload })
    );
  } catch (err) {
    // ignore storage issues
  }
}

function persistHistoryView(viewState) {
  if (!viewState) {
    persistViewState('list', { view: 'list' });
    return;
  }
  persistViewState(viewState.view || 'list', viewState);
}

function getPersistedViewState() {
  try {
    const raw = sessionStorage.getItem('readerView');
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function replaceViewState(view, payload = {}) {
  history.replaceState({ view, ...payload }, '', viewUrl(view));
  persistViewState(view, payload);
}

function pushViewState(view, payload = {}) {
  history.pushState({ view, ...payload }, '', viewUrl(view));
  persistViewState(view, payload);
}

function isMobileLayout() {
  return window.matchMedia('(max-width: 960px)').matches;
}

function openDetailView() {
  if (!isMobileLayout()) return;
  document.body.classList.add('detail-open');
  if (detailPanel) {
    detailPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function closeDetailView() {
  document.body.classList.remove('detail-open');
}

function setReadingMode(active) {
  document.body.classList.toggle('reading', active);
  updateNavOffset();
}

function clearChapterView() {
  state.currentChapter = null;
  state.chapterNav = { prev: null, next: null };
  chapterTitleEl.textContent = 'Belum dipilih';
  readerEl.innerHTML = '';
  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }
  state.autoOpenPlayer = false;
  state.autoOpenBlocked = false;
  prevBtn.disabled = true;
  nextBtn.disabled = true;
  if (prevBtnBottom) prevBtnBottom.disabled = true;
  if (nextBtnBottom) nextBtnBottom.disabled = true;
}

function exitReader() {
  setReadingMode(false);
  if (state.currentManga?.url) {
    openDetailView();
    replaceViewState('detail', {
      ext: state.currentExt?.id,
      mangaUrl: state.currentManga.url
    });
  } else {
    closeDetailView();
    replaceViewState('list', {
      ext: state.currentExt?.id,
      page: state.currentPage,
      type: getTypeForView(),
      mode: state.mode
    });
  }
}

function updateTypeLabel(label) {
  if (!typeLabelEl) return;
  typeLabelEl.textContent = label || 'All';
}

function getActiveTypeFromUI() {
  const active = typeSwitchEl?.querySelector('.type-btn.active');
  return active ? active.dataset.type || '' : '';
}

function isTypeSupported() {
  return state.currentExt?.id === 'doujindesu';
}

function updateTypeVisibility() {
  const supported = isTypeSupported();
  const display = supported ? '' : 'none';
  if (typeSwitchEl) {
    typeSwitchEl.hidden = !supported;
    typeSwitchEl.style.display = display;
  }
  if (typeLabelEl) {
    typeLabelEl.hidden = !supported;
    typeLabelEl.style.display = display;
  }
  if (!supported) {
    updateTypeLabel('');
  }
}

function getTypeForView() {
  return isTypeSupported() ? state.currentType : '';
}

function persistTypePreference(type) {
  try {
    localStorage.setItem('readerType', type || '');
  } catch (err) {
    // ignore storage issues
  }
}

function restoreTypePreference() {
  try {
    const saved = localStorage.getItem('readerType');
    if (saved !== null && saved !== undefined) {
      state.currentType = saved;
    }
  } catch (err) {
    // ignore storage issues
  }
  syncTypeUI(state.currentType);
}

function syncTypeUI(type = state.currentType) {
  const normalized = type || '';
  let label = normalized || 'All';
  if (typeSwitchEl) {
    typeSwitchEl.querySelectorAll('.type-btn').forEach((btn) => {
      const match = (btn.dataset.type || '') === normalized;
      btn.classList.toggle('active', match);
      if (match) {
        label = btn.textContent.trim() || label;
      }
    });
  }
  updateTypeLabel(label);
}

function setChapterLoading(activeButton) {
  state.isLoadingChapter = true;
  detailEl.querySelectorAll('.chapter').forEach((btn) => {
    btn.disabled = true;
    btn.classList.remove('loading');
  });
  [prevBtn, nextBtn, prevBtnBottom, nextBtnBottom].forEach((btn) => {
    if (!btn) return;
    btn.disabled = true;
    btn.classList.remove('loading');
  });
  if (activeButton) activeButton.classList.add('loading');
}

function clearChapterLoading() {
  state.isLoadingChapter = false;
  detailEl.querySelectorAll('.chapter').forEach((btn) => {
    btn.disabled = false;
    btn.classList.remove('loading');
  });
  [prevBtn, nextBtn, prevBtnBottom, nextBtnBottom].forEach((btn) => {
    if (!btn) return;
    btn.classList.remove('loading');
  });
}

function setMangaLoading(activeButton) {
  state.isLoadingManga = true;
  resultsEl.querySelectorAll('.title-btn').forEach((btn) => {
    btn.disabled = true;
  });
  if (activeButton) {
    activeButton.classList.add('loading');
  }
}

function clearMangaLoading() {
  state.isLoadingManga = false;
  resultsEl.querySelectorAll('.title-btn').forEach((btn) => {
    btn.disabled = false;
    btn.classList.remove('loading');
  });
}

function renderPagination(currentPage) {
  if (!paginationEl) return;
  if (state.mode !== 'latest') {
    paginationEl.innerHTML = '';
    return;
  }

  const current = Number(currentPage) || 1;
  let start = Math.max(1, current - 3);
  let end = start + 7;
  if (current <= 4) {
    start = 1;
    end = 8;
  }

  paginationEl.innerHTML = '';

  const prev = document.createElement('button');
  prev.className = 'page-btn page-nav';
  prev.textContent = '<';
  prev.dataset.page = String(Math.max(1, current - 1));
  prev.disabled = current === 1;

  const next = document.createElement('button');
  next.className = 'page-btn page-nav';
  next.textContent = '>';
  next.dataset.page = String(current + 1);

  const grid = document.createElement('div');
  grid.className = 'page-grid';

  for (let page = start; page <= end; page += 1) {
    const btn = document.createElement('button');
    btn.className = 'page-btn';
    if (page === current) btn.classList.add('active');
    btn.textContent = String(page);
    btn.dataset.page = String(page);
    grid.appendChild(btn);
  }

  paginationEl.appendChild(prev);
  paginationEl.appendChild(grid);
  paginationEl.appendChild(next);
}


function proxyImage(url) {
  if (!url) return '';
  const referer = state.currentExt ? state.currentExt.baseUrl : '';
  const params = new URLSearchParams({
    url,
    referer
  });
  return `/api/image?${params.toString()}`;
}

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Request gagal');
  }
  return res.json();
}

function renderResults(items) {
  resultsEl.innerHTML = '';
  if (!items || items.length === 0) {
    resultsEl.innerHTML = '<p>Tidak ada hasil.</p>';
    return;
  }
  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.url = item.url || '';
    const cover = item.cover ? proxyImage(item.cover) : '';
    const qualityText = item.quality ? String(item.quality).trim() : '';
    const qualityBadge = qualityText
      ? `<span class="quality-badge" data-quality="${qualityText}">${qualityText}</span>`
      : '';
    card.innerHTML = `
      <div class="card-cover">
        <img src="${cover}" alt="" loading="lazy" />
        ${qualityBadge}
      </div>
      <button class="title-btn" type="button" data-url="${item.url || ''}">
        ${item.title || 'Tanpa judul'}
        <span class="dots" aria-hidden="true"></span>
      </button>
    `;
    resultsEl.appendChild(card);
  });
}

function renderDetail(data) {
  if (!data) {
    detailEl.innerHTML = '<p>Belum ada data.</p>';
    return;
  }

  const summary =
    data.description ||
    data.author ||
    data.artist ||
    data.status ||
    data.type ||
    'Tidak ada deskripsi.';
  const genres = (data.genres || []).map(
    (genre) => `<span class="badge">${genre}</span>`
  );
  const chapters = data.chapters || [];

  detailEl.innerHTML = `
    <div class="detail-card">
      <div class="detail-top">
        <img src="${proxyImage(data.cover)}" alt="" />
        <div>
          <div class="title-link">${data.title || 'Tanpa judul'}</div>
          <p>${summary}</p>
          <div class="badges">${genres.join('')}</div>
          <p><strong>Status:</strong> ${data.status || '-'} | <strong>Type:</strong> ${data.type || '-'}</p>
          <p><strong>Author:</strong> ${data.author || '-'} | <strong>Artist:</strong> ${data.artist || '-'}</p>
        </div>
      </div>
      <div>
        <h3>Chapters</h3>
        <div class="chapters">
          ${chapters
            .map(
              (ch) =>
                `<button class="chapter" type="button" data-url="${ch.url}">
                  <span class="chapter-title">${ch.name || ch.url}</span>
                  <span class="dots" aria-hidden="true"></span>
                </button>`
            )
            .join('')}
        </div>
      </div>
    </div>
  `;
}

function renderChapter(data) {
  chapterTitleEl.textContent = data.title || 'Chapter';
  readerEl.innerHTML = '';
  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }
  if (data.video) {
    const frame = document.createElement('div');
    frame.className = 'video-frame';
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    if (data.poster) {
      video.poster = proxyImage(data.poster);
    }
    frame.appendChild(video);
    readerEl.appendChild(frame);

    const sources = Array.isArray(data.videos) && data.videos.length
      ? data.videos
      : [{ label: 'Auto', url: data.video }];

    const setSource = (url) => {
      if (!url) return;
      if (currentHls) {
        currentHls.destroy();
        currentHls = null;
      }
      if (window.Hls && window.Hls.isSupported() && /\.m3u8($|\?)/i.test(url)) {
        currentHls = new window.Hls();
        currentHls.loadSource(url);
        currentHls.attachMedia(video);
      } else {
        video.src = url;
      }
    };

    if (sources.length > 1) {
      const quality = document.createElement('div');
      quality.className = 'quality-switch';
      const label = document.createElement('span');
      label.className = 'quality-label';
      label.textContent = 'Quality';
      quality.appendChild(label);

      sources.forEach((item, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quality-btn';
        btn.textContent = item.label || `Stream ${index + 1}`;
        if (index === 0) btn.classList.add('active');
        btn.addEventListener('click', () => {
          quality.querySelectorAll('.quality-btn').forEach((el) => {
            el.classList.remove('active');
          });
          btn.classList.add('active');
          setSource(item.url);
        });
        quality.appendChild(btn);
      });

      readerEl.insertBefore(quality, frame);
    }

    setSource(sources[0]?.url || data.video);
  }
  if (data.iframe) {
    if (state.autoOpenPlayer) {
      const note = document.createElement('div');
      note.className = 'player-note';
      note.innerHTML = `
        <p>Player dibuka otomatis di tab baru.</p>
        ${
          state.autoOpenBlocked
            ? '<p>Popup diblokir browser. Klik tombol di bawah untuk membuka manual.</p>'
            : '<p>Jika tab baru tidak muncul, gunakan tombol di bawah.</p>'
        }
        <a href="${data.iframe}" target="_blank" rel="noopener noreferrer">
          Buka Player
        </a>
      `;
      readerEl.appendChild(note);
      return;
    }
    const frame = document.createElement('div');
    frame.className = 'video-frame';
    frame.innerHTML = `
      <iframe
        src="${data.iframe}"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        loading="lazy"
      ></iframe>
      <div class="player-fallback">
        <p>Player tidak bisa ditampilkan di sini. Buka di tab baru:</p>
        <a href="${data.iframe}" target="_blank" rel="noopener noreferrer">
          Buka Player
        </a>
      </div>
    `;
    readerEl.appendChild(frame);

    const iframe = frame.querySelector('iframe');
    const fallback = frame.querySelector('.player-fallback');
    if (iframe && fallback) {
      let resolved = false;
      const timer = window.setTimeout(() => {
        if (!resolved) fallback.classList.add('show');
      }, 3500);
      iframe.addEventListener('load', () => {
        resolved = true;
        window.clearTimeout(timer);
        fallback.classList.remove('show');
      });
    }
  }
  if (!data.images || data.images.length === 0) {
    if (data.iframe || data.video) return;
    readerEl.innerHTML = '<p>Gambar tidak ditemukan.</p>';
    return;
  }
  data.images.forEach((img) => {
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.src = proxyImage(img);
    readerEl.appendChild(image);
  });
}

async function loadExtensions() {
  setStatus('Memuat extension...');
  const data = await api('/api/extensions');
  state.extensions = data.extensions || [];
  if (extCount) extCount.textContent = state.extensions.length;
  extSelect.innerHTML = state.extensions
    .map((ext) => `<option value="${ext.id}">${ext.name}</option>`)
    .join('');
  state.currentExt = state.extensions[0] || null;
  updateTypeVisibility();
  setStatus('Siap');
}

async function loadLatest() {
  if (!state.currentExt) return;
  closeDetailView();
  setReadingMode(false);
  clearChapterView();
  state.mode = 'latest';
  updateTypeVisibility();
  if (isTypeSupported()) {
    state.currentType = getActiveTypeFromUI() || state.currentType;
    syncTypeUI(state.currentType);
  }
  const viewType = getTypeForView();
  replaceViewState('list', {
    ext: state.currentExt.id,
    page: state.currentPage,
    type: viewType,
    mode: 'latest'
  });
  setStatus('Memuat terbaru...');
  const typeParam = viewType ? `&type=${encodeURIComponent(viewType)}` : '';
  const data = await api(
    `/api/${state.currentExt.id}/latest?page=${state.currentPage}${typeParam}`
  );
  renderResults(data.items);
  renderPagination(state.currentPage);
  setStatus('Siap');
}

async function search() {
  if (!state.currentExt) return;
  const q = getSearchValue();
  if (!q) return;
  closeDetailView();
  setReadingMode(false);
  clearChapterView();
  state.mode = 'search';
  updateTypeLabel('');
  setSearchValue(q);
  replaceViewState('list', { ext: state.currentExt.id, q, mode: 'search' });
  setStatus('Mencari...');
  const data = await api(
    `/api/${state.currentExt.id}/search?q=${encodeURIComponent(q)}`
  );
  renderResults(data.items);
  renderPagination(0);
  setStatus('Siap');
}

async function loadManga(url, opts = {}) {
  if (!state.currentExt) return;
  setStatus('Memuat detail...');
  const data = await api(
    `/api/${state.currentExt.id}/manga?url=${encodeURIComponent(url)}`
  );
  state.currentManga = data.data;
  renderDetail(state.currentManga);
  openDetailView();
  setReadingMode(false);
  clearChapterView();
  if (opts.push !== false) {
    pushViewState('detail', {
      ext: state.currentExt.id,
      mangaUrl: url
    });
  }
  setStatus('Siap');
}

async function loadChapter(url, opts = {}) {
  if (!state.currentExt) return;
  setStatus('Memuat chapter...');
  const shouldAutoOpen =
    opts.userInitiated && state.currentExt.id === 'lk21';
  let popup = null;
  if (shouldAutoOpen) {
    try {
      popup = window.open('', '_blank');
    } catch (err) {
      popup = null;
    }
  }
  const data = await api(
    `/api/${state.currentExt.id}/chapter?url=${encodeURIComponent(url)}`
  );
  state.currentChapter = data.data;
  state.autoOpenPlayer = Boolean(shouldAutoOpen && state.currentChapter?.iframe);
  state.autoOpenBlocked = false;
  if (state.autoOpenPlayer) {
    if (popup && !popup.closed) {
      popup.location = state.currentChapter.iframe;
    } else {
      state.autoOpenBlocked = true;
    }
  } else if (popup && !popup.closed) {
    popup.close();
  }
  renderChapter(state.currentChapter);
  const baseNav = sanitizeNav(state.currentChapter?.nav, url);
  const derivedNav = deriveNavFromList(url);
  state.chapterNav = derivedNav.found
    ? { prev: derivedNav.prev, next: derivedNav.next }
    : { prev: baseNav.prev, next: baseNav.next };
  prevBtn.disabled = !state.chapterNav.prev;
  nextBtn.disabled = !state.chapterNav.next;
  if (prevBtnBottom) prevBtnBottom.disabled = !state.chapterNav.prev;
  if (nextBtnBottom) nextBtnBottom.disabled = !state.chapterNav.next;
  setReadingMode(true);
  if (opts.push !== false) {
    pushViewState('chapter', {
      ext: state.currentExt.id,
      mangaUrl: state.currentManga ? state.currentManga.url : null,
      chapterUrl: url
    });
  }
  setStatus('Siap');
}

extSelect.addEventListener('change', () => {
  const selected = state.extensions.find((ext) => ext.id === extSelect.value);
  state.currentExt = selected || null;
  state.currentPage = 1;
  updateTypeVisibility();
  loadLatest();
});

searchBtn?.addEventListener('click', search);
latestBtn?.addEventListener('click', () => {
  state.currentPage = 1;
  loadLatest();
});
searchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') search();
});

navSearchBtn?.addEventListener('click', () => {
  const query = getSearchValue();
  if (query) {
    setSearchValue(query);
    search();
    if (navSearchInput) {
      navSearchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } else if (navSearchInput) {
    navSearchInput.focus();
  }
});

navHomeBtn?.addEventListener('click', () => {
  document.body.classList.remove('nav-search-open');
  updateNavOffset();
  if (state.currentExt) {
    state.mode = 'latest';
    if (!state.currentPage) state.currentPage = 1;
    loadLatest();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

viewerBackBtn?.addEventListener('click', () => {
  exitReader();
});

navSearchToggleBtn?.addEventListener('click', () => {
  const isOpen = document.body.classList.toggle('nav-search-open');
  if (isOpen) {
    navSearchInput?.focus();
  }
  updateNavOffset();
});

navSearchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    setSearchValue(navSearchInput.value);
    search();
  }
});

searchInput?.addEventListener('input', () => {
  if (navSearchInput && navSearchInput.value !== searchInput.value) {
    navSearchInput.value = searchInput.value;
  }
});

navSearchInput?.addEventListener('input', () => {
  if (searchInput && searchInput.value !== navSearchInput.value) {
    searchInput.value = navSearchInput.value;
  }
});

prevBtn.addEventListener('click', () => {
  if (state.isLoadingChapter) return;
  if (!state.chapterNav.prev) return;
  setChapterLoading(prevBtn);
  loadChapter(state.chapterNav.prev, { userInitiated: true })
    .catch(() => {})
    .finally(() => {
      clearChapterLoading();
    });
});

nextBtn.addEventListener('click', () => {
  if (state.isLoadingChapter) return;
  if (!state.chapterNav.next) return;
  setChapterLoading(nextBtn);
  loadChapter(state.chapterNav.next, { userInitiated: true })
    .catch(() => {})
    .finally(() => {
      clearChapterLoading();
    });
});

prevBtnBottom?.addEventListener('click', () => {
  if (state.isLoadingChapter) return;
  if (!state.chapterNav.prev) return;
  setChapterLoading(prevBtnBottom);
  loadChapter(state.chapterNav.prev, { userInitiated: true })
    .catch(() => {})
    .finally(() => {
      clearChapterLoading();
    });
});

nextBtnBottom?.addEventListener('click', () => {
  if (state.isLoadingChapter) return;
  if (!state.chapterNav.next) return;
  setChapterLoading(nextBtnBottom);
  loadChapter(state.chapterNav.next, { userInitiated: true })
    .catch(() => {})
    .finally(() => {
      clearChapterLoading();
    });
});

backBtn?.addEventListener('click', () => {
  if (history.state && history.state.view && history.state.view !== 'list') {
    history.back();
  } else {
    closeDetailView();
    setReadingMode(false);
    clearChapterView();
    replaceViewState('list', {
      ext: state.currentExt?.id,
      page: state.currentPage,
      type: state.currentType,
      mode: state.mode
    });
  }
});

resultsEl.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-url]');
  if (!target) return;
  if (state.isLoadingManga) return;
  const url = target.dataset.url;
  if (!url) return;
  const card = event.target.closest('.card');
  const btn = card ? card.querySelector('.title-btn') : null;
  setMangaLoading(btn);
  try {
    await loadManga(url);
  } finally {
    clearMangaLoading();
  }
});

paginationEl?.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-page]');
  if (!btn) return;
  const page = Number(btn.dataset.page);
  if (!page || page < 1) return;
  state.currentPage = page;
  loadLatest();
});

typeSwitchEl?.addEventListener('click', (event) => {
  const btn = event.target.closest('.type-btn');
  if (!btn) return;
  state.currentType = btn.dataset.type || '';
  persistTypePreference(state.currentType);
  syncTypeUI(state.currentType);
  state.currentPage = 1;
  loadLatest();
});


detailEl.addEventListener('click', (event) => {
  const target = event.target.closest('.chapter');
  if (!target) return;
  if (state.isLoadingChapter) return;
  const url = target.dataset.url;
  if (!url) return;
  setChapterLoading(target);
  loadChapter(url, { userInitiated: true })
    .catch(() => {})
    .finally(() => {
      clearChapterLoading();
    });
});

async function init() {
  restoreTypePreference();
  await loadExtensions();
  const saved = getPersistedViewState();
  const hashView = window.location.hash.replace('#', '');
  const desiredView = hashView || saved?.view || 'list';
  if (saved?.ext) {
    const selected = state.extensions.find((ext) => ext.id === saved.ext);
    if (selected) {
      state.currentExt = selected;
      extSelect.value = selected.id;
    }
  }
  updateTypeVisibility();

  if (desiredView === 'detail' && saved?.mangaUrl) {
    await loadManga(saved.mangaUrl, { push: false });
    return;
  }

  if (desiredView === 'chapter' && saved?.chapterUrl) {
    if (saved?.mangaUrl) {
      await loadManga(saved.mangaUrl, { push: false });
    }
    await loadChapter(saved.chapterUrl, { push: false });
    return;
  }

  if (saved?.mode === 'search' && saved?.q) {
    searchInput.value = saved.q;
    await search();
    return;
  }

  if (saved?.page) {
    state.currentPage = Number(saved.page) || 1;
  }
  if (typeof saved?.type === 'string') {
    state.currentType = saved.type;
    syncTypeUI(state.currentType);
  }
  await loadLatest();
}

init().catch((err) => {
  setStatus('Gagal');
  resultsEl.innerHTML = `<p>${err.message}</p>`;
});

updateNavOffset();
window.addEventListener('resize', updateNavOffset);
window.addEventListener('load', updateNavOffset);

window.addEventListener('popstate', (event) => {
  const viewState = event.state || { view: 'list' };
  persistHistoryView(viewState);
  if (!viewState.view || viewState.view === 'list') {
    closeDetailView();
    setReadingMode(false);
    clearChapterView();
    return;
  }
  if (viewState.view === 'detail') {
    if (viewState.mangaUrl) {
      loadManga(viewState.mangaUrl, { push: false });
    } else {
      closeDetailView();
      setReadingMode(false);
      clearChapterView();
    }
    return;
  }
  if (viewState.view === 'chapter') {
    if (viewState.chapterUrl) {
      loadChapter(viewState.chapterUrl, { push: false });
    } else {
      setReadingMode(false);
      clearChapterView();
    }
  }
});
