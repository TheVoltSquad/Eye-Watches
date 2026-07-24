(function () {
  const statusEl = document.getElementById('status-text');
  const validTimeEl = document.getElementById('valid-time');
  const refreshBtn = document.getElementById('refresh-btn');
  const importPaletteBtn = document.getElementById('import-palette-btn');
  const paletteFileInput = document.getElementById('palette-file-input');
  const opacityInput = document.getElementById('opacity');
  const opacityVal = document.getElementById('opacity-val');
  const minDbzInput = document.getElementById('min-dbz');
  const minDbzVal = document.getElementById('min-dbz-val');
  const autoRefreshInput = document.getElementById('auto-refresh');
  const prevFrameBtn = document.getElementById('prev-frame-btn');
  const nextFrameBtn = document.getElementById('next-frame-btn');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const frameSlider = document.getElementById('frame-slider');
  const frameLabel = document.getElementById('frame-label');
  const legendBar = document.getElementById('legend-bar');

  const MAX_HISTORY_FRAMES = 34;
  let frameKeys = [];
  let frameCache = {};
  let currentFrameIndex = -1;
  let playTimer = null;
  let isPlaying = false;

  const MRMS_PRIMARY_URL =
    'https://mrms.ncep.noaa.gov/data/2D/MergedReflectivityQCComposite/MRMS_MergedReflectivityQCComposite.latest.grib2.gz';
  const MRMS_S3_BUCKET = 'https://noaa-mrms-pds.s3.amazonaws.com';
  const MRMS_S3_PREFIX = 'CONUS/MergedReflectivityQCComposite_00.50/';
  const AUTO_REFRESH_MS = 2 * 60 * 1000;

  const DBZ_STOPS = [
    [5, 4, 233, 231],
    [10, 1, 159, 244],
    [15, 3, 0, 244],
    [20, 2, 253, 2],
    [25, 1, 197, 1],
    [30, 0, 142, 0],
    [35, 253, 248, 2],
    [40, 229, 188, 0],
    [45, 253, 149, 0],
    [50, 253, 0, 0],
    [55, 212, 0, 0],
    [60, 188, 0, 0],
    [65, 248, 0, 253],
    [70, 152, 84, 198],
    [75, 253, 253, 253],
  ];

  const CMAP_MIN = -30;
  const CMAP_MAX = 80;
  const CMAP_STEP = 0.5;
  const CMAP_SIZE = Math.round((CMAP_MAX - CMAP_MIN) / CMAP_STEP) + 1;
  const CMAP = new Uint8ClampedArray(CMAP_SIZE * 4);
  let paletteStops = DBZ_STOPS.map((stop) => [...stop, 255]);

  function parsePaletteFile(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*/, '').replace(/;.*/, '').trim())
      .filter((line) => line.length > 0);

    const entries = [];
    let scale = 1;

    const normalizeColor = (value) => {
      if (!Number.isFinite(value)) return 255;
      if (value >= 0 && value <= 1) return Math.round(value * 255);
      return Math.round(value);
    };

    lines.forEach((rawLine) => {
      const match = rawLine.match(/^([a-zA-Z0-9]+)\s*:\s*(.*)$/i);
      if (!match) return;

      const key = match[1].toLowerCase();
      const value = match[2].trim();

      if (key === 'scale') {
        const s = Number(value);
        if (Number.isFinite(s) && s !== 0) scale = s;
        return;
      }

      if (!['color', 'color4', 'solidcolor', 'solidcolor4', 'colour', 'colour4', 'solidcolour', 'solidcolour4'].includes(key)) return;

      const hasAlpha = key.endsWith('4');
      const solid = key.startsWith('solid');
      const comps = hasAlpha ? 4 : 3;
      const nums = value.split(/\s+/).map(Number).filter((n) => !isNaN(n));
      if (nums.length < 1 + comps) return;

      const val = nums[0] / scale;
      const readColor = (offset) => ({
        r: normalizeColor(nums[offset]),
        g: normalizeColor(nums[offset + 1]),
        b: normalizeColor(nums[offset + 2]),
        a: hasAlpha && Number.isFinite(nums[offset + 3]) ? normalizeColor(nums[offset + 3]) : 255,
      });

      const start = readColor(1);
      const hasSecond = !solid && nums.length >= 1 + comps * 2;
      const end = hasSecond ? readColor(1 + comps) : { ...start };
      entries.push({ val, start, end, solid, hasSecond });
    });

    if (!entries.length) {
      lines.forEach((line) => {
        const parts = line.split(/\s+/).map(Number);
        if (parts.length >= 4 && parts.slice(0, 4).every(Number.isFinite)) {
          const value = parts[0] / scale;
          const r = normalizeColor(parts[1]);
          const g = normalizeColor(parts[2]);
          const b = normalizeColor(parts[3]);
          const a = parts.length >= 5 && Number.isFinite(parts[4]) ? normalizeColor(parts[4]) : 255;
          entries.push({ val: value, start: { r, g, b, a }, end: { r, g, b, a }, solid: true, hasSecond: false });
        }
      });
    }

    if (!entries.length) {
      throw new Error('No valid palette stops found.');
    }

    entries.sort((a, b) => a.val - b.val);

    const colors = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const next = entries[i + 1];
      colors.push({ val: entry.val, ...entry.start });

      if (!next) {
        if (entry.hasSecond) {
          colors.push({ val: entry.val + Math.abs(entry.val || 1) * 0.001 + 0.001, ...entry.end });
        }
        continue;
      }

      const span = next.val - entry.val;
      const eps = Math.max(span * 0.001, 1e-6);

      if (entry.solid) {
        colors.push({ val: next.val - eps, ...entry.start });
      } else if (entry.hasSecond) {
        colors.push({ val: next.val - eps, ...entry.end });
      }
    }

    colors.sort((a, b) => a.val - b.val);

    const deduped = [];
    for (const c of colors) {
      const last = deduped[deduped.length - 1];
      if (!last || last.val !== c.val || last.r !== c.r || last.g !== c.g || last.b !== c.b || last.a !== c.a) {
        deduped.push(c);
      }
    }

    return deduped.map((c) => [c.val, c.r, c.g, c.b, c.a]);
  }

  function getPaletteColorAt(dbz) {
    if (!paletteStops.length) return [0, 0, 0, 0];
    if (dbz <= paletteStops[0][0]) {
      return paletteStops[0].slice(1);
    }
    for (let i = 0; i < paletteStops.length - 1; i++) {
      const current = paletteStops[i];
      const next = paletteStops[i + 1];
      if (dbz >= current[0] && dbz < next[0]) {
        const span = next[0] - current[0] || 1;
        const t = (dbz - current[0]) / span;
        const r = Math.round(current[1] + (next[1] - current[1]) * t);
        const g = Math.round(current[2] + (next[2] - current[2]) * t);
        const b = Math.round(current[3] + (next[3] - current[3]) * t);
        const a = Math.round(current[4] + (next[4] - current[4]) * t);
        return [r, g, b, a];
      }
    }
    return paletteStops[paletteStops.length - 1].slice(1);
  }

  function buildColormap() {
    for (let i = 0; i < CMAP_SIZE; i++) {
      const dbz = CMAP_MIN + i * CMAP_STEP;
      const [r, g, b, a] = getPaletteColorAt(dbz);
      const o = i * 4;
      CMAP[o] = r;
      CMAP[o + 1] = g;
      CMAP[o + 2] = b;
      CMAP[o + 3] = a;
    }
  }

  buildColormap();

  function dbzToColorIndex(dbz) {
    if (dbz < CMAP_MIN) return -1;
    const i = Math.round((Math.min(dbz, CMAP_MAX) - CMAP_MIN) / CMAP_STEP);
    return i;
  }

  function legendGradientCSS() {
    const parts = paletteStops.map(([d, r, g, b]) => {
      const pct = ((d - 5) / 70) * 100;
      return `rgb(${r},${g},${b}) ${pct.toFixed(1)}%`;
    });
    return `linear-gradient(to right, ${parts.join(', ')})`;
  }

  function setStatus(text, isError) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.classList.toggle('error', !!isError);
    }
  }

  function setValidTime(text) {
    if (validTimeEl) {
      validTimeEl.textContent = text;
    }
  }

  function mercY(latDeg) {
    const rad = (latDeg * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + rad / 2));
  }

  function gridEdges(grid) {
    const north = grid.la1 + grid.dj / 2;
    const south = grid.la2 - grid.dj / 2;
    let west = grid.lo1 - grid.di / 2;
    let east = grid.lo2 + grid.di / 2;
    if (west > 180) west -= 360;
    if (east > 180) east -= 360;
    return { north, south, west, east };
  }

  function gridCoordinates(grid) {
    const { north, south, west, east } = gridEdges(grid);
    return [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ];
  }

  function renderToCanvas(decoded, grid, minDbz) {
    const factor = 2;
    const w = Math.max(1, Math.floor(decoded.ni / factor));
    const h = Math.max(1, Math.floor(decoded.nj / factor));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const px = img.data;
    const vals = decoded.values;
    const ni = decoded.ni;
    const nj = decoded.nj;

    const edges = gridEdges(grid);
    const mercN = mercY(edges.north);
    const mercS = mercY(edges.south);

    for (let y = 0; y < h; y++) {
      const my = mercN + ((y + 0.5) / h) * (mercS - mercN);
      const lat = (Math.atan(Math.sinh(my)) * 180) / Math.PI;
      let srcJ = Math.round((edges.north - lat) / grid.dj - 0.5);
      if (srcJ < 0) srcJ = 0;
      if (srcJ > nj - factor) srcJ = nj - factor;

      const row0 = srcJ * ni;
      const row1 = row0 + ni;
      for (let x = 0; x < w; x++) {
        const c = x * factor;
        let v = vals[row0 + c];
        const v2 = vals[row0 + c + 1];
        const v3 = vals[row1 + c];
        const v4 = vals[row1 + c + 1];
        if (v2 > v) v = v2;
        if (v3 > v) v = v3;
        if (v4 > v) v = v4;
        if (v < minDbz || v <= -90) continue;
        const ci = dbzToColorIndex(v);
        if (ci < 0) continue;
        const o = (y * w + x) * 4;
        const co = ci * 4;
        px[o] = CMAP[co];
        px[o + 1] = CMAP[co + 1];
        px[o + 2] = CMAP[co + 2];
        px[o + 3] = CMAP[co + 3];
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function gunzipIfNeeded(buffer) {
    const b = new Uint8Array(buffer);
    if (b[0] === 0x47 && b[1] === 0x52 && b[2] === 0x49 && b[3] === 0x42) return buffer;
    if (b[0] === 0x1f && b[1] === 0x8b) {
      const out = pako.ungzip(b);
      return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    }
    throw new Error('Unrecognized file format (not gzip or GRIB2)');
  }

  function parseGrib2(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    if (bytes[0] !== 0x47 || bytes[1] !== 0x52 || bytes[2] !== 0x49 || bytes[3] !== 0x42) {
      throw new Error('Not a GRIB2 file');
    }
    const result = { grid: null, packing: null, refTime: null, dataSection: null };
    let pos = 16;
    while (pos < bytes.length - 4) {
      if (bytes[pos] === 0x37 && bytes[pos + 1] === 0x37 && bytes[pos + 2] === 0x37 && bytes[pos + 3] === 0x37) {
        break;
      }
      const secLen = view.getUint32(pos);
      const secNum = bytes[pos + 4];
      if (secNum === 1) {
        const year = view.getUint16(pos + 12);
        const month = bytes[pos + 14];
        const day = bytes[pos + 15];
        const hour = bytes[pos + 16];
        const minute = bytes[pos + 17];
        const second = bytes[pos + 18];
        result.refTime = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      } else if (secNum === 3) {
        const template = view.getUint16(pos + 12);
        if (template !== 0) throw new Error(`Unsupported grid template 3.${template}`);
        result.grid = {
          ni: view.getUint32(pos + 30),
          nj: view.getUint32(pos + 34),
          la1: view.getInt32(pos + 46) / 1e6,
          lo1: view.getUint32(pos + 50) / 1e6,
          la2: view.getInt32(pos + 55) / 1e6,
          lo2: view.getUint32(pos + 59) / 1e6,
          di: view.getUint32(pos + 63) / 1e6,
          dj: view.getUint32(pos + 67) / 1e6,
          scan: bytes[pos + 71],
        };
      } else if (secNum === 5) {
        const template = view.getUint16(pos + 9);
        result.packing = {
          template,
          R: view.getFloat32(pos + 11),
          E: view.getInt16(pos + 15),
          D: view.getInt16(pos + 17),
          nbits: bytes[pos + 19],
          npoints: view.getUint32(pos + 5),
        };
      } else if (secNum === 7) {
        result.dataSection = bytes.subarray(pos + 5, pos + secLen);
      }
      pos += secLen;
    }
    if (!result.grid || !result.packing || !result.dataSection) {
      throw new Error('GRIB2 file missing required sections');
    }
    return result;
  }

  function decodeGrib2Values(grib) {
    const { packing, grid, dataSection } = grib;
    const n = grid.ni * grid.nj;
    const values = new Float32Array(n);
    const scaleE = Math.pow(2, packing.E);
    const scaleD = Math.pow(10, packing.D);
    const R = packing.R;
    if (packing.template === 41) {
      const png = UPNG.decode(
        dataSection.buffer.slice(dataSection.byteOffset, dataSection.byteOffset + dataSection.byteLength)
      );
      const raw = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength);
      const nbits = packing.nbits;
      if (nbits === 16) {
        for (let i = 0; i < n; i++) {
          const v = (raw[i * 2] << 8) | raw[i * 2 + 1];
          values[i] = (v * scaleE + R) / scaleD;
        }
      } else if (nbits === 8) {
        for (let i = 0; i < n; i++) {
          values[i] = (raw[i] * scaleE + R) / scaleD;
        }
      } else {
        throw new Error(`Unsupported PNG bit depth: ${nbits}`);
      }
    } else if (packing.template === 0) {
      const nbits = packing.nbits;
      if (nbits === 0) {
        values.fill(R / scaleD);
      } else {
        let bitPos = 0;
        for (let i = 0; i < n; i++) {
          let v = 0;
          for (let b = 0; b < nbits; b++) {
            const byteIdx = bitPos >> 3;
            const bitIdx = 7 - (bitPos & 7);
            v = (v << 1) | ((dataSection[byteIdx] >> bitIdx) & 1);
            bitPos++;
          }
          values[i] = (v * scaleE + R) / scaleD;
        }
      }
    } else {
      throw new Error(`Unsupported data representation template 5.${packing.template}`);
    }
    return { values, ni: grid.ni, nj: grid.nj };
  }

  function fetchPrimary() {
    return fetch(MRMS_PRIMARY_URL, { mode: 'cors' }).then((res) => {
      if (!res.ok) throw new Error(`NOAA MRMS HTTP ${res.status}`);
      return res.arrayBuffer().then((buffer) => ({ buffer, source: 'mrms.ncep.noaa.gov' }));
    });
  }

  async function fetchS3Latest() {
    for (let back = 0; back < 2; back++) {
      const d = new Date(Date.now() - back * 86400000);
      const ymd =
        d.getUTCFullYear().toString() +
        String(d.getUTCMonth() + 1).padStart(2, '0') +
        String(d.getUTCDate()).padStart(2, '0');
      const prefix = `${MRMS_S3_PREFIX}${ymd}/`;
      let latestKey = null;
      let token = '';
      do {
        const url =
          `${MRMS_S3_BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}` +
          `&max-keys=1000${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`;
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(`S3 list HTTP ${res.status}`);
        const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
        const keys = Array.from(xml.getElementsByTagName('Key'))
          .map((k) => k.textContent)
          .filter((k) => k && k.endsWith('.grib2.gz'));
        if (keys.length) latestKey = keys[keys.length - 1];
        const truncated = xml.getElementsByTagName('IsTruncated')[0];
        const next = xml.getElementsByTagName('NextContinuationToken')[0];
        token = truncated && truncated.textContent === 'true' && next ? next.textContent : '';
      } while (token);
      if (latestKey) {
        const res = await fetch(`${MRMS_S3_BUCKET}/${latestKey}`, { mode: 'cors' });
        if (!res.ok) throw new Error(`S3 fetch HTTP ${res.status}`);
        return { buffer: await res.arrayBuffer(), source: 'NOAA Open Data (S3)' };
      }
    }
    throw new Error('No MRMS files found on S3');
  }

  function updateRadarLayer(canvas, grid) {
    if (!map) return;

    const style = map.getStyle && map.getStyle();
    const layers = style && Array.isArray(style.layers) ? style.layers : [];
    if (!layers.length) {
      requestAnimationFrame(() => updateRadarLayer(canvas, grid));
      return;
    }

    const url = canvas.toDataURL('image/png');
    const coords = gridCoordinates(grid);
    const existing = map.getSource('radar');
    if (existing && typeof existing.updateImage === 'function') {
      existing.updateImage({ url, coordinates: coords });
      return;
    }
    if (existing && existing.type !== 'image') {
      map.removeSource('radar');
    }
    if (!map.getSource('radar')) {
      map.addSource('radar', { type: 'image', url, coordinates: coords });
    }
    if (map.getLayer && map.getLayer('radar-layer')) {
      map.getSource('radar').updateImage({ url, coordinates: coords });
      return;
    }
    const insertionLayer = layers.find((l) => l.type === 'line' || l.type === 'symbol');
    map.addLayer(
      {
        id: 'radar-layer',
        type: 'raster',
        source: 'radar',
        paint: {
          'raster-opacity': Number(opacityInput?.value || 70) / 100,
          'raster-resampling': 'nearest',
          'raster-fade-duration': 0,
        },
      },
      insertionLayer ? insertionLayer.id : undefined
    );
  }

  let map = null;
  let lastDecoded = null;
  let loading = false;
  let refreshTimer = null;
  let initialized = false;

  function updateFrameLabel() {
    if (!frameLabel) return;
    if (!frameKeys.length) {
      frameLabel.textContent = 'Frame 0 / 0';
      return;
    }
    frameLabel.textContent = `Frame ${currentFrameIndex + 1} / ${frameKeys.length}`;
  }

  function setSliderBounds() {
    if (!frameSlider) return;
    frameSlider.min = '0';
    frameSlider.max = String(Math.max(frameKeys.length - 1, 0));
    frameSlider.value = String(Math.max(currentFrameIndex, 0));
  }

  function stopPlayback() {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
    isPlaying = false;
    if (playPauseBtn) {
      playPauseBtn.textContent = 'Play';
    }
  }

  function startPlayback() {
    if (isPlaying || frameKeys.length <= 1) return;
    isPlaying = true;
    if (playPauseBtn) playPauseBtn.textContent = 'Pause';
    playTimer = setInterval(() => {
      const nextIndex = currentFrameIndex + 1;
      if (nextIndex >= frameKeys.length) {
        currentFrameIndex = 0;
      } else {
        currentFrameIndex = nextIndex;
      }
      loadFrameIndex(currentFrameIndex);
    }, 1200);
  }

  function togglePlayback() {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    startPlayback();
  }

  function prevFrame() {
    if (!frameKeys.length) return;
    stopPlayback();
    const nextIndex = currentFrameIndex - 1;
    loadFrameIndex(nextIndex < 0 ? frameKeys.length - 1 : nextIndex);
  }

  function nextFrame() {
    if (!frameKeys.length) return;
    stopPlayback();
    const nextIndex = currentFrameIndex + 1;
    loadFrameIndex(nextIndex >= frameKeys.length ? 0 : nextIndex);
  }

  function handleFrameSliderChange() {
    if (!frameSlider) return;
    stopPlayback();
    const index = Number(frameSlider.value);
    if (!Number.isNaN(index)) {
      loadFrameIndex(index);
    }
  }

  function getFrameListKeyDates() {
    if (!frameKeys.length) return 'Latest';
    return `${frameKeys[currentFrameIndex]}`;
  }

  async function fetchFrameKeys() {
    const keys = [];
    for (let back = 0; back < 2; back++) {
      const d = new Date(Date.now() - back * 86400000);
      const ymd =
        d.getUTCFullYear().toString() +
        String(d.getUTCMonth() + 1).padStart(2, '0') +
        String(d.getUTCDate()).padStart(2, '0');
      const prefix = `${MRMS_S3_PREFIX}${ymd}/`;
      let token = '';
      do {
        const url =
          `${MRMS_S3_BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}` +
          `&max-keys=1000${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`;
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(`S3 list HTTP ${res.status}`);
        const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
        const pageKeys = Array.from(xml.getElementsByTagName('Key'))
          .map((k) => k.textContent)
          .filter((k) => k && k.endsWith('.grib2.gz'));
        keys.push(...pageKeys);
        const truncated = xml.getElementsByTagName('IsTruncated')[0];
        const next = xml.getElementsByTagName('NextContinuationToken')[0];
        token = truncated && truncated.textContent === 'true' && next ? next.textContent : '';
      } while (token);
    }
    keys.sort();
    return keys.slice(-MAX_HISTORY_FRAMES);
  }

  async function fetchFrameData(key) {
    const res = await fetch(`${MRMS_S3_BUCKET}/${encodeURIComponent(key)}`, { mode: 'cors' });
    if (!res.ok) throw new Error(`MRMS frame HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    const gribBuffer = gunzipIfNeeded(buffer);
    const grib = parseGrib2(gribBuffer);
    const decoded = decodeGrib2Values(grib);
    return {
      key,
      decoded,
      grid: grib.grid,
      refTime: grib.refTime,
    };
  }

  async function ensureFrameKeys() {
    if (frameKeys.length) return;
    try {
      frameKeys = await fetchFrameKeys();
    } catch (err) {
      console.warn('Unable to fetch MRMS frame keys', err);
      frameKeys = [];
    }
    currentFrameIndex = frameKeys.length - 1;
    setSliderBounds();
    updateFrameLabel();
  }

  async function loadFrameIndex(index, { forceReload = false } = {}) {
    if (!frameKeys.length || index < 0 || index >= frameKeys.length) return;
    currentFrameIndex = index;
    const key = frameKeys[index];
    if (!frameCache[key] || forceReload) {
      frameCache[key] = await fetchFrameData(key);
      const keys = Object.keys(frameCache);
      if (keys.length > MAX_HISTORY_FRAMES) {
        const removeKey = keys[0];
        delete frameCache[removeKey];
      }
    }
    const frame = frameCache[key];
    const canvas = renderToCanvas(frame.decoded, frame.grid, Number(minDbzInput?.value || 5));
    updateRadarLayer(canvas, frame.grid);
    const t = frame.refTime;
    setValidTime(t ? `Valid ${t.toISOString().slice(0, 16).replace('T', ' ')}Z` : '');
    setStatus(`MRMS frame ${index + 1} / ${frameKeys.length}`);
    setSliderBounds();
    updateFrameLabel();
    if (frameSlider) frameSlider.value = String(index);
  }

  async function loadLatestFrame() {
    await ensureFrameKeys();
    if (frameKeys.length) {
      await loadFrameIndex(frameKeys.length - 1, { forceReload: true });
      return;
    }
    // fallback to single latest frame if history is unavailable
    await loadRadar();
  }

  async function loadRadar() {
    if (loading || !map) return;
    if (map.isStyleLoaded && !map.isStyleLoaded()) {
      setTimeout(() => loadRadar(), 250);
      return;
    }
    loading = true;
    refreshBtn?.classList.add('spinning');
    try {
      setStatus('Refreshing MRMS frame list…');
      frameKeys = [];
      await ensureFrameKeys();
      if (frameKeys.length) {
        await loadFrameIndex(frameKeys.length - 1, { forceReload: true });
        return;
      }
      setStatus('Fetching MRMS data…');
      let result;
      try {
        result = await fetchPrimary();
      } catch (err) {
        setStatus('NOAA direct blocked, using NOAA S3 mirror…');
        result = await fetchS3Latest();
      }
      setStatus('Decompressing…');
      const gribBuffer = gunzipIfNeeded(result.buffer);
      setStatus('Decoding GRIB2…');
      const grib = parseGrib2(gribBuffer);
      const decoded = decodeGrib2Values(grib);
      lastDecoded = { decoded, grid: grib.grid, refTime: grib.refTime };
      setStatus('Rendering…');
      const canvas = renderToCanvas(decoded, grib.grid, Number(minDbzInput?.value || 5));
      updateRadarLayer(canvas, grib.grid);
      const t = grib.refTime;
      setValidTime(t ? `Valid ${t.toISOString().slice(0, 16).replace('T', ' ')}Z` : '');
      setStatus(`Live · ${result.source}`);
      frameLabel && (frameLabel.textContent = 'Latest');
    } catch (err) {
      console.warn('MRMS radar load failed', err);
      setStatus(`Error: ${err.message}`, true);
    } finally {
      loading = false;
      refreshBtn?.classList.remove('spinning');
    }
  }

  function rerenderCurrentFrame() {
    if (!map) return;
    if (frameKeys.length && currentFrameIndex >= 0) {
      const key = frameKeys[currentFrameIndex];
      const frame = key ? frameCache[key] : null;
      if (frame) {
        const canvas = renderToCanvas(frame.decoded, frame.grid, Number(minDbzInput?.value || 5));
        updateRadarLayer(canvas, frame.grid);
        return true;
      }
    }
    if (!lastDecoded) return false;
    const canvas = renderToCanvas(lastDecoded.decoded, lastDecoded.grid, Number(minDbzInput?.value || 5));
    updateRadarLayer(canvas, lastDecoded.grid);
    return true;
  }

  function scheduleAutoRefresh() {
    clearInterval(refreshTimer);
    if (autoRefreshInput?.checked) {
      refreshTimer = setInterval(loadRadar, AUTO_REFRESH_MS);
    }
  }

  async function handlePaletteImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.pal$/i.test(file.name)) {
      setStatus('Please choose a .PAL file.', true);
      return;
    }
    try {
      const text = await file.text();
      paletteStops = parsePaletteFile(text);
      buildColormap();
      legendBar && (legendBar.style.background = legendGradientCSS());
      setStatus(`Loaded palette ${file.name}`);
      rerenderCurrentFrame();
    } catch (err) {
      console.warn('Palette import failed', err);
      setStatus(`Palette import failed: ${err.message}`, true);
    } finally {
      event.target.value = '';
    }
  }

  refreshBtn?.addEventListener('click', loadRadar);
  importPaletteBtn?.addEventListener('click', () => paletteFileInput?.click());
  paletteFileInput?.addEventListener('change', handlePaletteImport);
  opacityInput?.addEventListener('input', () => {
    opacityVal && (opacityVal.textContent = `${opacityInput.value}%`);
    if (map && map.getLayer && map.getLayer('radar-layer')) {
      map.setPaintProperty('radar-layer', 'raster-opacity', Number(opacityInput.value) / 100);
    }
  });

  let minDbzTimer = null;
  minDbzInput?.addEventListener('input', () => {
    minDbzVal && (minDbzVal.textContent = minDbzInput.value);
    clearTimeout(minDbzTimer);
    minDbzTimer = setTimeout(rerenderCurrentFrame, 250);
  });

  autoRefreshInput?.addEventListener('change', scheduleAutoRefresh);
  prevFrameBtn?.addEventListener('click', prevFrame);
  nextFrameBtn?.addEventListener('click', nextFrame);
  playPauseBtn?.addEventListener('click', togglePlayback);
  frameSlider?.addEventListener('input', handleFrameSliderChange);

  function initRadar() {
    if (!window.map || initialized) return;
    initialized = true;
    map = window.map;
    legendBar && (legendBar.style.background = legendGradientCSS());

    const start = () => {
      if (map && map.isStyleLoaded && !map.isStyleLoaded()) {
        setTimeout(start, 250);
        return;
      }
      loadRadar();
      scheduleAutoRefresh();
    };

    if (map && map.loaded && map.loaded()) {
      start();
      return;
    }

    map.on('load', start);
    setTimeout(start, 250);
  }

  window.addEventListener('mapready', initRadar);
  window.addEventListener('load', initRadar);
  setTimeout(initRadar, 100);
  if (window.map && window.map.loaded && window.map.loaded()) {
    initRadar();
  }
})();
