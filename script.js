// --- BEGIN: Replace individual .txt fetches with Google Sheet template loader ---
const TEMPLATE_SHEET_ID = '';
const TEMPLATE_API_KEY = 'AIzaSyAnjraIjs-jdsZA6pK1Ab5GjgWIifhykM4'; // used also elsewhere in this script

function fetchFallbackTemplates() {
  // Minimal fallback to original text files if sheet fetch fails
  const files = {
    'TORE.txt': 'ToreTemplate',
    'PDS TOR.txt': 'pdsTorTemplate',
    'PDS TOR Radar Indicated.txt': 'pdsTorRadarTemplate',
    'OBSERVED TOR.txt': 'observedTorTemplate',
    'TOR.txt': 'TorTemplate',
    'PDS SVR.txt': 'pdsSvrTemplate',
    'PDS SVR 90+ MPH WINDS.txt': 'pdsSvr90Template',
    'PDS SVR 100 MPH WINDS.txt': 'pdsSvr100Template',
    'PDS SVR 2.75+ IN HAIL.txt': 'pdsSvrHail275Template',
    'Considerable SVR.txt': 'considerableSvrTemplate',
    'SVR.txt': 'SvrTemplate',
    'FFWE.txt': 'FfweTemplate',
    'Considerable FFW.txt': 'considerableFfwTemplate',
    'FFW.txt': 'FfwTemplate',
    'TEST.txt': 'TestTemplate'
  };
  Object.entries(files).forEach(([file, varName]) => {
    fetch(file).then(r => r.text()).then(txt => {
      window[varName] = txt;
      console.log('Fallback loaded', file, '->', varName);
    }).catch(() => {
      window[varName] = window[varName] || `No ${file} found.`;
    });
  });
}

function loadTemplatesFromGoogleSheet(sheetId, apiKey, range = 'Sheet1') {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
  fetch(url)
    .then(res => res.json())
    .then(obj => {
      const values = obj.values || [];
      if (!values.length) {
        throw new Error('No sheet values returned');
      }
      const headers = values[0].map(h => String(h || '').trim());
      // build columns: header -> array of non-empty cells below header
      const cols = {};
      headers.forEach(h => { cols[h] = []; });
      for (let r = 1; r < values.length; r++) {
        for (let c = 0; c < headers.length; c++) {
          const cell = values[r][c];
          if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
            cols[headers[c]].push(String(cell));
          }
        }
      }

      // Normalized header -> window var mapping (case-insensitive)
      const normalizedMap = {
        'TORE': 'ToreTemplate',
        'PDS TOR': 'pdsTorTemplate',
        'PDS TOR RADAR INDICATED': 'pdsTorRadarTemplate',
        'OBSERVED TOR': 'observedTorTemplate',
        'TOR': 'TorTemplate',
        'PDS SVR': 'pdsSvrTemplate',
        'PDS SVR 90+ MPH WINDS': 'pdsSvr90Template',
        'PDS SVR 100 MPH WINDS': 'pdsSvr100Template',
        'PDS SVR 2.75+ IN HAIL': 'pdsSvrHail275Template',
        'CONSIDERABLE SVR': 'considerableSvrTemplate',
        'SVR': 'SvrTemplate',
        'FFWE': 'FfweTemplate',
        'CONSIDERABLE FFW': 'considerableFfwTemplate',
        'FFW': 'FfwTemplate',
        'TEST': 'TestTemplate'
      };

      // populate window variables from columns (join rows into single text block)
      headers.forEach(header => {
        const n = header.toUpperCase().replace(/\s+/g, ' ').trim();
        const varName = normalizedMap[n];
        const text = (cols[header] || []).join('\n').trim();
        if (varName) {
          window[varName] = text || (window[varName] || `No ${header} template found.`);
          console.log('Template mapped from sheet:', header, '->', varName, window[varName] ? '(loaded)' : '(empty)');
        } else {
          // If header doesn't map, also make it available by header name (safe lookup)
          const safeVar = header.replace(/\W+/g, '_');
          window['template_' + safeVar] = text;
          console.log('Unmapped template column available as', 'template_' + safeVar);
        }
      });

      // If key templates weren't present in sheet, fallback-fetch them
      const requiredVars = ['ToreTemplate','pdsTorTemplate','pdsTorRadarTemplate','observedTorTemplate','TorTemplate','TestTemplate'];
      const missing = requiredVars.some(v => !window[v] || window[v].length === 0);
      if (missing) {
        console.warn('Some required templates missing in sheet — using fallback fetch for missing files.');
        fetchFallbackTemplates();
      }
    })
    .catch(err => {
      console.warn('Google Sheet template load failed:', err);
      fetchFallbackTemplates();
    });
}

// Kick off template loading (sheet range can be changed if templates are on a different sheet/tab)
loadTemplatesFromGoogleSheet(TEMPLATE_SHEET_ID, TEMPLATE_API_KEY, 'Sheet1');

// Store polygons for lookup
let polygonsById = {};
// Map original alert id -> array of polygon ids (zone polygons or original polygon)
window.alertToZoneIds = {};
let alertPolygonRefreshQueued = false;

function getAlertPolygonFeatures() {
  return Object.values(polygonsById)
    .filter((p) => p && p.properties && !String(p.properties.id || '').startsWith('sheet-eyewatch-'))
    .sort((a, b) => (Number(b.properties.priority) || 0) - (Number(a.properties.priority) || 0));
}

function hideAlertSummaryPanel() {
  try {
    const panel = document.getElementById('alertSummaryPanel');
    if (panel) panel.style.display = 'none';
  } catch (e) { /* ignore */ }
  try {
    stopPolygonFlash();
  } catch (e) { /* ignore */ }
}

function showAlertDescriptionOnly(alertId, feature) {
  const targetFeature = feature || (alertId && polygonsById && polygonsById[alertId]) || null;
  const title = (targetFeature?.properties?.displayEvent || targetFeature?.properties?.event || 'Alert') + ' DESCRIPTION';
  const color = targetFeature?.properties?.fillColor || 'rgba(90, 0, 120, 0.95)';
  hideAlertSummaryPanel();
  showAlertDescription({
    color,
    title,
    summary: targetFeature?.properties?.displayEvent || targetFeature?.properties?.event || '',
    alertId
  });
}

function queueAlertPolygonRefresh() {
  if (alertPolygonRefreshQueued) return;
  alertPolygonRefreshQueued = true;
  requestAnimationFrame(() => {
    alertPolygonRefreshQueued = false;
    const geojson = {
      type: 'FeatureCollection',
      features: getAlertPolygonFeatures()
    };
    getAlertPolygonMaps().forEach((m) => {
      try {
        const source = m && m.getSource && m.getSource('nws-alert-polygons');
        if (source) {
          source.setData(geojson);
        }
      } catch (e) { /* ignore per-map errors */ }
    });
  });
}

// Helper: return all map instances that should display alert polygons (main + split)
function getAlertPolygonMaps() {
  const maps = [];
  if (window.map && typeof window.map.getStyle === 'function') {
    try { window.map.getStyle(); maps.push(window.map); } catch { /* style not ready yet */ }
  }
  if (window.mapWrapper && window.mapWrapper.dualMap && typeof window.mapWrapper.dualMap.getStyle === 'function') {
    try { window.mapWrapper.dualMap.getStyle(); maps.push(window.mapWrapper.dualMap); } catch { /* style not ready yet */ }
  }
  return maps;
}

// Find a sensible insertion layer id so polygon layers are placed beneath labels/symbols
function findFirstLabelLayerId(mapInstance) {
  try {
    const layers = (mapInstance.getStyle && mapInstance.getStyle().layers) || [];
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (!l) continue;
      if (l.type === 'symbol') return l.id;
      const id = String(l.id || '');
      if (/label|place|city|town/i.test(id)) return l.id;
    }
  } catch (e) { /* ignore */ }
  return null;
}

// NEW: Track currently flashing polygon
window._flashingPolygonId = null;
window._flashingInterval = null;
// RainViewer/radar functionality removed (radar UI and tile layer omitted)

// NEW: Start flashing animation for a polygon outline with fade transition
function startPolygonFlash(polygonId, polygonColor) {
  // Don't flash eye watch polygons (sheet polygons)
  if (Array.isArray(polygonId)) {
    polygonId = polygonId.filter(id => !(typeof id === 'string' && id.startsWith('sheet-eyewatch-')));
    if (polygonId.length === 0) return;
  } else {
    if (polygonId && typeof polygonId === 'string' && polygonId.startsWith('sheet-eyewatch-')) return;
  }

  stopPolygonFlash();

  window._flashingPolygonId = polygonId;
  let fade = 0;
  let direction = 1;

  // Create/update a separate flashing outline layer if it doesn't exist
  const flashLayerId = 'nws-alert-polygons-flash-outline';
  getAlertPolygonMaps().forEach(m => {
    if (!m || typeof m.getLayer !== 'function') return;
    if (!m.getLayer(flashLayerId)) {
      const insertionLayerId = findFirstLabelLayerId(m);
      const layerDef = {
        id: flashLayerId,
        type: 'line',
        source: 'nws-alert-polygons',
        paint: {
          'line-color': '#ffffff',
          'line-width': 3,
          'line-opacity': 0
        },
        filter: ['==', ['get', 'id'], '']
      };
      try {
        if (insertionLayerId) m.addLayer(layerDef, insertionLayerId);
        else m.addLayer(layerDef);
      } catch (e) {
        // fall back to addLayer without insertion if moving fails
        try { m.addLayer(layerDef); } catch (err) { /* ignore */ }
      }
    }
    // Expose helper so other scripts (UI toggles) can request an immediate re-check
    try { window._ensureNwsAlertPolygonsLayers = ensureNwsAlertPolygonsLayers; } catch (e) { /* ignore */ }
    // Set filter depending on single id or multiple ids
    try {
      if (Array.isArray(polygonId)) {
        // Build a filter that matches any of the provided ids: ['any', ['==', ['get','id'], id1], ...]
        const clauses = polygonId.map(id => ['==', ['get', 'id'], id]);
        const filter = ['any'].concat(clauses);
        console.debug('[flash] setting any-filter for', flashLayerId, 'ids:', polygonId);
        m.setFilter(flashLayerId, filter);
      } else {
        console.debug('[flash] setting eq-filter for', flashLayerId, 'id:', polygonId);
        m.setFilter(flashLayerId, ['==', ['get', 'id'], polygonId]);
      }
    } catch (e) {
      console.warn('Error setting flash filter', e);
    }
  });

  window._flashingInterval = setInterval(() => {
    try {
      // Fade opacity from 1 to 0 (white fades out)
      let opacity = 1 - (fade / 20);

      getAlertPolygonMaps().forEach(m => {
        try {
          if (m.getLayer && m.getLayer(flashLayerId)) {
            m.setPaintProperty(flashLayerId, 'line-opacity', opacity);
          }
        } catch (e) { /* ignore per-map errors */ }
      });

      fade += direction;
      if (fade >= 20) direction = -1;
      if (fade <= 0) direction = 1;
    } catch (e) {
      console.warn('Error updating flash animation', e);
    }
  }, 40);
}

// NEW: Stop flashing animation
function stopPolygonFlash() {
  if (window._flashingInterval) {
    clearInterval(window._flashingInterval);
    window._flashingInterval = null;
  }

  // Reset flash layer opacity to 0 and clear filter
  try {
    const flashLayerId = 'nws-alert-polygons-flash-outline';
    // Reset on all alert polygon maps
    getAlertPolygonMaps().forEach(m => {
      try {
        if (m && m.getLayer && m.getLayer(flashLayerId)) {
          m.setPaintProperty(flashLayerId, 'line-opacity', 0);
          m.setFilter(flashLayerId, ['==', ['get', 'id'], '']);
        }
      } catch (e) { /* ignore per-map reset errors */ }
    });
  } catch (e) {
    console.warn('Error resetting flash layer', e);
  }

  window._flashingPolygonId = null;
}

// --- Persisted alert color helpers (localStorage v1) ---
window.savedAlertColors = {};
function loadSavedAlertColors() {
  try { return JSON.parse(localStorage.getItem('savedAlertColors:v1') || '{}'); } catch (e) { return {}; }
}
function saveSavedAlertColors() {
  try { localStorage.setItem('savedAlertColors:v1', JSON.stringify(window.savedAlertColors || {})); } catch(e){/*ignore*/ }
}
// initialize
window.savedAlertColors = loadSavedAlertColors();

// --- Persisted alert visibility helpers (localStorage v1) ---
window.savedAlertVisibility = {};
function loadSavedAlertVisibility() {
  try { return JSON.parse(localStorage.getItem('savedAlertVisibility:v1') || '{}'); } catch (e) { return {}; }
}
function saveSavedAlertVisibility() {
  try { localStorage.setItem('savedAlertVisibility:v1', JSON.stringify(window.savedAlertVisibility || {})); } catch(e) { /* ignore */ }
}
// initialize
window.savedAlertVisibility = loadSavedAlertVisibility();

const defaultHiddenAlertEvents = [
  'Shelter In Place Warning',
  'Evacuation Immediate',
  'Civil Danger Warning',
  'Civil Emergency Message',
  'Law Enforcement Warning',
  'Local Area Emergency',
  '911 Telephone Outage',
  'Hazardous Weather Outlook',
  'Short Term Forecast',
  'Dust Advisory',
  'Blowing Dust Advisory',
  'Lake Wind Advisory',
  'Wind Advisory',
  'Freezing Fog Advisory',
  'Air Stagnation Advisory',
  'Air Quality Alert'
].map(normalizeEventKey);

function isAlertVisibleByDefault(eventName) {
  if (!eventName) return true;
  return !defaultHiddenAlertEvents.includes(normalizeEventKey(eventName));
}

// --- Persisted alert sound helpers (localStorage v1) ---
window.savedAlertSounds = {};
function loadSavedAlertSounds() {
  try { return JSON.parse(localStorage.getItem('savedAlertSounds:v1') || '{}'); } catch (e) { return {}; }
}
function saveSavedAlertSounds() {
  try { localStorage.setItem('savedAlertSounds:v1', JSON.stringify(window.savedAlertSounds || {})); } catch (e) { /* ignore */ }
}
window.savedAlertSounds = loadSavedAlertSounds();

window.savedAlertSoundBehavior = {};
function loadSavedAlertSoundBehavior() {
  try { return JSON.parse(localStorage.getItem('savedAlertSoundBehavior:v1') || '{}'); } catch (e) { return {}; }
}
function saveSavedAlertSoundBehavior() {
  try { localStorage.setItem('savedAlertSoundBehavior:v1', JSON.stringify(window.savedAlertSoundBehavior || {})); } catch (e) { /* ignore */ }
}
window.savedAlertSoundBehavior = loadSavedAlertSoundBehavior();

// --- Incoming alert auto-flash script (separate from existing polygon flash logic) ---
window.savedAlertFlashBehavior = window.savedAlertFlashBehavior || {};
function loadSavedAlertFlashBehavior() {
  try { return JSON.parse(localStorage.getItem('savedAlertFlashBehavior:v1') || '{}'); } catch (e) { return {}; }
}
function saveSavedAlertFlashBehavior() {
  try { localStorage.setItem('savedAlertFlashBehavior:v1', JSON.stringify(window.savedAlertFlashBehavior || {})); } catch (e) { /* ignore */ }
}
window.savedAlertFlashBehavior = loadSavedAlertFlashBehavior();

window._autoFlashingAlertIds = [];
window._autoFlashingInterval = null;
window._autoFlashingTimeout = null;

function getAlertFlashConfig(event) {
  const normalizedEvent = normalizeEventKey(event);
  const behavior = (window.savedAlertFlashBehavior && (
    window.savedAlertFlashBehavior[event] ||
    window.savedAlertFlashBehavior[normalizedEvent]
  )) || {};
  const soundBehavior = (window.savedAlertSoundBehavior && (
    window.savedAlertSoundBehavior[event] ||
    window.savedAlertSoundBehavior[normalizedEvent]
  )) || {};
  return {
    flashOnNew: typeof behavior.flashOnNew === 'boolean'
      ? behavior.flashOnNew
      : (typeof soundBehavior.playOnNew === 'boolean' ? soundBehavior.playOnNew : true),
    flashOnUpdated: typeof behavior.flashOnUpdated === 'boolean'
      ? behavior.flashOnUpdated
      : (typeof soundBehavior.playOnUpdated === 'boolean' ? soundBehavior.playOnUpdated : false),
    flashColorNew: behavior.flashColorNew || '#000000',
    flashColorUpdated: behavior.flashColorUpdated || '#000000',
    flashDurationNew: Number.isFinite(Number(behavior.flashDurationNew)) ? Math.max(1, Number(behavior.flashDurationNew)) : 12,
    flashDurationUpdated: Number.isFinite(Number(behavior.flashDurationUpdated)) ? Math.max(1, Number(behavior.flashDurationUpdated)) : 12
  };
}

function stopAutoAlertFlash() {
  if (window._autoFlashingInterval) {
    clearInterval(window._autoFlashingInterval);
    window._autoFlashingInterval = null;
  }
  if (window._autoFlashingTimeout) {
    clearTimeout(window._autoFlashingTimeout);
    window._autoFlashingTimeout = null;
  }

  const flashLayerId = 'nws-alert-polygons-auto-flash-outline';
  getAlertPolygonMaps().forEach((m) => {
    try {
      if (m && m.getLayer && m.getLayer(flashLayerId)) {
        m.setPaintProperty(flashLayerId, 'line-opacity', 0);
        m.setFilter(flashLayerId, ['==', ['get', 'id'], '']);
      }
    } catch (e) { /* ignore */ }
  });

  window._autoFlashingAlertIds = [];
}

function stopAutoAlertFlashForId(alertId) {
  if (!alertId || !Array.isArray(window._autoFlashingAlertIds) || window._autoFlashingAlertIds.length === 0) return;
  if (!window._autoFlashingAlertIds.includes(alertId)) return;
  stopAutoAlertFlash();
}

function startAutoAlertFlash(alertIds, flashColor, durationMs) {
  let ids = Array.isArray(alertIds) ? alertIds.slice() : [alertIds];
  ids = ids.filter(id => id && !(typeof id === 'string' && id.startsWith('sheet-eyewatch-')));
  if (ids.length === 0) return;

  stopAutoAlertFlash();
  window._autoFlashingAlertIds = Array.from(new Set(ids));

  const flashLayerId = 'nws-alert-polygons-auto-flash-outline';
  const color = flashColor || '#000000';

  getAlertPolygonMaps().forEach((m) => {
    try {
      if (!m || typeof m.getLayer !== 'function') return;
      if (!m.getLayer(flashLayerId)) {
        const insertionLayerId = findFirstLabelLayerId(m);
        const layerDef = {
          id: flashLayerId,
          type: 'line',
          source: 'nws-alert-polygons',
          paint: {
            'line-color': color,
            'line-width': 3,
            'line-opacity': 0
          },
          filter: ['==', ['get', 'id'], '']
        };
        try {
          if (insertionLayerId) m.addLayer(layerDef, insertionLayerId);
          else m.addLayer(layerDef);
        } catch (e) {
          try { m.addLayer(layerDef); } catch (err) { /* ignore */ }
        }
      }
      const clauses = window._autoFlashingAlertIds.map(id => ['==', ['get', 'id'], id]);
      m.setFilter(flashLayerId, ['any'].concat(clauses));
    } catch (e) { /* ignore */ }
  });

  let fade = 0;
  let direction = 1;
  window._autoFlashingInterval = setInterval(() => {
    const opacity = 1 - (fade / 20);
    const pulseColor = fade >= 10 ? '#000000' : color;
    getAlertPolygonMaps().forEach((m) => {
      try {
        if (m && m.getLayer && m.getLayer(flashLayerId)) {
          m.setPaintProperty(flashLayerId, 'line-opacity', opacity);
          m.setPaintProperty(flashLayerId, 'line-color', pulseColor);
        }
      } catch (e) { /* ignore */ }
    });
    fade += direction;
    if (fade >= 20) direction = -1;
    if (fade <= 0) direction = 1;
  }, 40);

  window._autoFlashingTimeout = setTimeout(() => {
    stopAutoAlertFlash();
  }, Math.max(1000, Number(durationMs) || 12000));
}

function maybeStartAlertFlash(eventName, triggerType, polygonId, fallbackColor) {
  const cfg = getAlertFlashConfig(eventName);
  if (triggerType === 'new' && !cfg.flashOnNew) return;
  if (triggerType === 'updated' && !cfg.flashOnUpdated) return;
  const color = triggerType === 'updated' ? (cfg.flashColorUpdated || fallbackColor || '#000000') : (cfg.flashColorNew || fallbackColor || '#000000');
  const seconds = triggerType === 'updated' ? cfg.flashDurationUpdated : cfg.flashDurationNew;
  startAutoAlertFlash(polygonId, color, Math.round(seconds * 1000));
}

function updateAlertFlashBehavior(event, key, value) {
  window.savedAlertFlashBehavior = window.savedAlertFlashBehavior || {};
  window.savedAlertFlashBehavior[event] = window.savedAlertFlashBehavior[event] || {};
  window.savedAlertFlashBehavior[event][key] = value;
  saveSavedAlertFlashBehavior();
}
window.updateAlertFlashBehavior = updateAlertFlashBehavior;

const ALERT_SOUND_OPTIONS = {
  none: null,
  'Radar Omega Chime': 'Radar Omega Chime',
  'Radar Omega Alarm': 'Radar Omega Alarm'
};

function getAlertSoundConfig(event) {
  const normalizedEvent = normalizeEventKey(event);
  const selectedSound = (window.savedAlertSounds && (
    window.savedAlertSounds[event] ||
    window.savedAlertSounds[normalizedEvent]
  )) || 'none';
  const behavior = (window.savedAlertSoundBehavior && (
    window.savedAlertSoundBehavior[event] ||
    window.savedAlertSoundBehavior[normalizedEvent]
  )) || {};
  return {
    sound: selectedSound,
    playOnNew: typeof behavior.playOnNew === 'boolean' ? behavior.playOnNew : true,
    playOnUpdated: typeof behavior.playOnUpdated === 'boolean' ? behavior.playOnUpdated : false
  };
}

function playAlertSoundByName(soundName) {
  if (!soundName || soundName === 'none') return;
  const baseName = ALERT_SOUND_OPTIONS[soundName];
  if (!baseName) return;

  const candidates = [
    `${baseName}.mp3`,
    `${baseName}.wav`,
    `${baseName}.ogg`,
    `sound/${baseName}.mp3`,
    `sound/${baseName}.wav`,
    `sound/${baseName}.ogg`
  ];

  const tryPlay = (index) => {
    if (index >= candidates.length) return;
    const audio = new Audio(candidates[index]);
    audio.addEventListener('error', () => tryPlay(index + 1), { once: true });
    audio.play().catch(() => {
      // Browser may block autoplay or this candidate may not exist.
      tryPlay(index + 1);
    });
  };

  tryPlay(0);
}
window.playAlertSoundByName = playAlertSoundByName;

function maybePlayAlertSound(eventName, triggerType) {
  const cfg = getAlertSoundConfig(eventName);
  if (triggerType === 'new' && !cfg.playOnNew) return;
  if (triggerType === 'updated' && !cfg.playOnUpdated) return;
  playAlertSoundByName(cfg.sound);
}

function updateAlertSound(event, soundName) {
  window.savedAlertSounds = window.savedAlertSounds || {};
  window.savedAlertSounds[event] = soundName;
  saveSavedAlertSounds();
}
window.updateAlertSound = updateAlertSound;

function updateAlertSoundBehavior(event, key, enabled) {
  window.savedAlertSoundBehavior = window.savedAlertSoundBehavior || {};
  window.savedAlertSoundBehavior[event] = window.savedAlertSoundBehavior[event] || {};
  window.savedAlertSoundBehavior[event][key] = !!enabled;
  saveSavedAlertSoundBehavior();
}
window.updateAlertSoundBehavior = updateAlertSoundBehavior;

// Helper: normalize event name keys for saved visibility (strip emoji/prefixes and trim)
function normalizeEventKey(name) {
  if (!name) return '';
  try {
    // remove common emoji/prefix characters at start and trim
    return String(name).replace(/^\s*[^A-Za-z0-9]+\s*/, '').trim();
  } catch (e) { return String(name || '').trim(); }
}

// --- County lookup helpers: fetch Plotly counties GeoJSON and test intersections ---
const STATE_FIPS = {
  '01':'Alabama','02':'Alaska','04':'Arizona','05':'Arkansas','06':'California','08':'Colorado','09':'Connecticut','10':'Delaware','11':'District of Columbia','12':'Florida','13':'Georgia','15':'Hawaii','16':'Idaho','17':'Illinois','18':'Indiana','19':'Iowa','20':'Kansas','21':'Kentucky','22':'Louisiana','23':'Maine','24':'Maryland','25':'Massachusetts','26':'Michigan','27':'Minnesota','28':'Mississippi','29':'Missouri','30':'Montana','31':'Nebraska','32':'Nevada','33':'New Hampshire','34':'New Jersey','35':'New Mexico','36':'New York','37':'North Carolina','38':'North Dakota','39':'Ohio','40':'Oklahoma','41':'Oregon','42':'Pennsylvania','44':'Rhode Island','45':'South Carolina','46':'South Dakota','47':'Tennessee','48':'Texas','49':'Utah','50':'Vermont','51':'Virginia','53':'Washington','54':'West Virginia','55':'Wisconsin','56':'Wyoming','72':'Puerto Rico'
};

// State abbreviation lookup (FIPS -> USPS)
const STATE_ABBR = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY','72':'PR'
};

// Defaults: number of counties to show before summarizing and whether to use state abbreviations
window._maxCountiesToShow = window._maxCountiesToShow || 6;
window.useStateAbbr = typeof window.useStateAbbr === 'boolean' ? window.useStateAbbr : false;

async function fetchCountiesGeoJson() {
  if (window._countiesGeoJson) return window._countiesGeoJson;
  try {
    const res = await fetch('https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json');
    const obj = await res.json();
    window._countiesGeoJson = obj;
    // Precompute simple bboxes for features to speed intersection checks
    window._countyFeatureBBoxes = window._countyFeatureBBoxes || new Array(obj.features.length);
    obj.features.forEach((f, i) => {
      if (window._countyFeatureBBoxes[i]) return;
      const coords = f.geometry && (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat(1) : []);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      (coords || []).forEach(ring => {
        ring.forEach(pt => {
          const x = pt[0], y = pt[1];
          if (x < minX) minX = x; if (y < minY) minY = y;
          if (x > maxX) maxX = x; if (y > maxY) maxY = y;
        });
      });
      if (!isFinite(minX)) { minX = -180; minY = -90; maxX = 180; maxY = 90; }
      window._countyFeatureBBoxes[i] = { minX, minY, maxX, maxY };
    });
    return window._countiesGeoJson;
  } catch (e) {
    console.warn('Failed to fetch counties GeoJSON', e);
    return null;
  }
}

// --- Canadian regions GeoJSON loader (fallback for Canadian polygons) ---
async function fetchCanadianRegionsGeoJson() {
  if (window._canadianRegionsGeoJson) return window._canadianRegionsGeoJson;
  try {
    const res = await fetch('canadian-regions.json');
    const geo = await res.json();
    if (!geo || !Array.isArray(geo.features)) {
      window._canadianRegionsGeoJson = null;
      return null;
    }
    // Precompute simple bboxes for region features for quick rejection
    window._canadianRegionFeatureBBoxes = window._canadianRegionFeatureBBoxes || {};
    geo.features.forEach((f, i) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      try {
        const coords = (f.geometry && f.geometry.type === 'MultiPolygon')
          ? f.geometry.coordinates.flatMap(poly => poly[0] || [])
          : (f.geometry && f.geometry.coordinates && f.geometry.coordinates[0]) || [];
        coords.forEach(pt => {
          if (!pt || pt.length < 2) return;
          const x = Number(pt[0]), y = Number(pt[1]);
          if (x < minX) minX = x; if (y < minY) minY = y;
          if (x > maxX) maxX = x; if (y > maxY) maxY = y;
        });
      } catch (e) { /* ignore */ }
      if (!isFinite(minX)) { minX = -180; minY = -90; maxX = 180; maxY = 90; }
      window._canadianRegionFeatureBBoxes[i] = { minX, minY, maxX, maxY };
    });
    window._canadianRegionsGeoJson = geo;
    return geo;
  } catch (e) {
    console.warn('Failed to fetch Canadian regions GeoJSON', e);
    window._canadianRegionsGeoJson = null;
    return null;
  }
}

function normalizePolyToLngLat(poly) {
  if (!Array.isArray(poly) || poly.length === 0) return [];
  // poly may be [[lat,lng],...] or [[lng,lat],...]. Choose orientation that yields most points inside US bounds.
  const asLatLng = poly.map(p => ({ lat: Number(p[0]), lng: Number(p[1]) }));
  const asLngLat = poly.map(p => ({ lat: Number(p[1]), lng: Number(p[0]) }));
  function countUS(points) {
    let c = 0;
    for (const pt of points) {
      if (pt.lat >= 10 && pt.lat <= 75 && pt.lng >= -180 && pt.lng <= -50) c++;
    }
    return c;
  }
  const cntLatLng = countUS(asLatLng);
  const cntLngLat = countUS(asLngLat);
  const chosen = cntLngLat >= cntLatLng ? asLngLat : asLatLng;
  return chosen.map(p => [p.lng, p.lat]); // return as [lng, lat]
}

function pointInRing(point, ring) {
  // Ray-casting algorithm for point-in-polygon. point = [lng, lat], ring = [[lng,lat],...]
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 0.0) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInFeature(point, feature) {
  if (!feature || !feature.geometry) return false;
  const g = feature.geometry;
  if (g.type === 'Polygon') {
    // exterior ring first
    const rings = g.coordinates || [];
    if (rings.length === 0) return false;
    if (pointInRing(point, rings[0])) return true;
    return false;
  } else if (g.type === 'MultiPolygon') {
    for (const poly of (g.coordinates || [])) {
      if (poly && poly[0] && pointInRing(point, poly[0])) return true;
    }
    return false;
  }
  return false;
}

async function countiesInPolygon(polygonPoints) {
  // polygonPoints: array of [lat,lng] or [lng,lat]; function normalizes and returns array of county names
  if (!Array.isArray(polygonPoints) || polygonPoints.length < 3) return [];
  const pts = normalizePolyToLngLat(polygonPoints);
  if (!pts || pts.length < 3) return [];

  const geo = await fetchCountiesGeoJson();
  if (!geo || !Array.isArray(geo.features)) return [];

  // compute bbox of polygon
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pts.forEach(p => { const x = p[0], y = p[1]; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; });

  const matches = new Map();
  // For performance: iterate counties, skip those whose bbox doesn't intersect
  for (let i = 0; i < geo.features.length; i++) {
    const f = geo.features[i];
    const bbox = (window._countyFeatureBBoxes && window._countyFeatureBBoxes[i]) || null;
    if (bbox) {
      if (bbox.maxX < minX || bbox.minX > maxX || bbox.maxY < minY || bbox.minY > maxY) continue;
    }

    let matched = false;
    // For each vertex of our polygon, test whether it lies inside county feature
    for (let j = 0; j < pts.length; j++) {
      const p = pts[j];
      try {
        if (pointInFeature(p, f)) {
          matched = true;
          break;
        }
      } catch (e) { /* ignore individual test errors */ }
    }

    // If no alert vertex was inside the county feature, test county vertices inside the alert polygon.
    if (!matched && f.geometry) {
      const coords = f.geometry.type === 'MultiPolygon'
        ? f.geometry.coordinates.flatMap(poly => poly[0] || [])
        : (f.geometry.coordinates && f.geometry.coordinates[0]) || [];
      for (const cpt of coords) {
        try {
          if (pointInPolygonUsingFeature([Number(cpt[0]), Number(cpt[1])], [pts])) {
            matched = true;
            break;
          }
        } catch (e) { /* ignore invalid coordinates */ }
      }
    }

    if (matched) {
      const cname = (f.properties && (f.properties.NAME || f.properties.name || f.properties.COUNTY)) || null;
      let rawState = (f.properties && (f.properties.STATE || f.properties.STATEFP || f.properties.STATE_FIPS || f.properties.STATEFP10)) || '';
      rawState = String(rawState || '').padStart(2, '0').slice(-2);
      const sname = STATE_FIPS[rawState] || rawState || '';
      if (cname) {
        const key = `${cname}||${rawState}`;
        if (!matches.has(key)) matches.set(key, { name: String(cname), state: sname, stateCode: rawState });
      }
    }
  }

  const arr = Array.from(matches.values());
  arr.sort((a,b) => (a.state + ' ' + a.name).localeCompare(b.state + ' ' + b.name));
  // If no US counties matched, attempt to find Canadian regions and return those instead
  if (arr.length === 0) {
    try {
      const regions = await regionsInPolygon(polygonPoints);
      if (regions && regions.length > 0) return regions;
    } catch (e) { /* ignore */ }
  }
  return arr;
}

function formatCountyList(countyObjs) {
  if (!countyObjs || countyObjs.length === 0) return '';
  // countyObjs: [{name: 'Autauga', state: 'Alabama'}, ...]
  const parts = countyObjs.map(c => {
    // If this object represents a Canadian region, prefer 'Region' suffix and province name
    if (c.isRegion) {
      const rawProvince = String(c.province || '').trim();
      const prov = rawProvince && rawProvince.toUpperCase() !== 'CAN' ? ` ${rawProvince}` : '';
      const name = String(c.name || '');
      const suffix = name.toLowerCase().includes('region') ? '' : ' Region';
      return `${name}${suffix}${prov}`;
    }
    const s = c.state ? ` ${c.state}` : '';
    const suffix = (String(c.state || '').toLowerCase() === 'louisiana' || String(c.type || '').toLowerCase() === 'parish') ? ' Parish' : ' County';
    return `${c.name}${suffix}${s}`;
  });
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  const last = parts.pop();
  return `${parts.join(', ')}, and ${last}`;
}

function shouldUseParishes(countyObjs) {
  if (!Array.isArray(countyObjs) || countyObjs.length === 0) return false;
  return countyObjs.every(c => {
    const state = String(c.state || '').trim().toLowerCase();
    const type = String(c.type || '').trim().toLowerCase();
    return state === 'louisiana' || type === 'parish';
  });
}

function replaceCountyHeaderPhrases(text, countyObjs) {
  if (!text) return text;
  // If all objects are regions, use 'Region(s)'
  if (Array.isArray(countyObjs) && countyObjs.length > 0 && countyObjs.every(c => c && c.isRegion)) {
    return String(text).replace(/counties/ig, match => {
      if (match === match.toUpperCase()) return 'REGIONS';
      if (match[0] === match[0].toUpperCase()) return 'Regions';
      return 'regions';
    });
  }
  if (!shouldUseParishes(countyObjs)) return text;
  return String(text).replace(/counties/ig, match => {
    if (match === match.toUpperCase()) return 'PARISHES';
    if (match[0] === match[0].toUpperCase()) return 'Parishes';
    return 'parishes';
  });
}

function replaceCountyPlaceholderInText(text, countyObjs) {
  if (!text) return text;
  const formatted = formatCountyList(countyObjs || []);
  if (!formatted) return text;
  const re = /\(?\s*(?:County|Parish|Region|Counties|Parishes|Regions?)\s+that\s+(?:is|are)\s+in\s+the\s+eye\s+watch\s+polygon\s*\)?/ig;
  let out = String(text).replace(re, formatted);
  return replaceCountyHeaderPhrases(out, countyObjs);
}

// Find Canadian regions that intersect a given polygon. Returns array of objects
// with { name, province, isRegion: true }
async function regionsInPolygon(polygonPoints) {
  if (!Array.isArray(polygonPoints) || polygonPoints.length < 3) return [];
  const pts = normalizePolyToLngLat(polygonPoints);
  if (!pts || pts.length < 3) return [];

  const geo = await fetchCanadianRegionsGeoJson();
  if (!geo || !Array.isArray(geo.features)) return [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pts.forEach(p => { const x = p[0], y = p[1]; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; });

  const matches = new Map();
  for (let i = 0; i < geo.features.length; i++) {
    const f = geo.features[i];
    const bbox = (window._canadianRegionFeatureBBoxes && window._canadianRegionFeatureBBoxes[i]) || null;
    if (bbox) {
      if (bbox.maxX < minX || bbox.minX > maxX || bbox.maxY < minY || bbox.minY > maxY) continue;
    }

    let matched = false;
    for (let j = 0; j < pts.length; j++) {
      const p = pts[j];
      try { if (pointInFeature(p, f)) { matched = true; break; } } catch (e) { }
    }

    if (!matched && f.geometry) {
      const coords = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flatMap(poly => poly[0] || []) : (f.geometry.coordinates && f.geometry.coordinates[0]) || [];
      for (const cpt of coords) {
        try {
          if (pointInPolygonUsingFeature([Number(cpt[0]), Number(cpt[1])], [pts])) { matched = true; break; }
        } catch (e) { }
      }
    }

    if (matched) {
      const name = (f.properties && (
        f.properties.shapeName ||
        f.properties.SHAPE_NAME ||
        f.properties.NAME ||
        f.properties.name ||
        f.properties.REGION ||
        f.properties.REGION_NAME
      )) || null;
      const prov = (f.properties && (
        f.properties.PROV ||
        f.properties.province ||
        f.properties.PROVINCE ||
        f.properties.PROV_NAME ||
        f.properties.shapeGroup
      )) || '';
      if (name) {
        const key = `${name}||${prov}`;
        if (!matches.has(key)) matches.set(key, { name: String(name), province: String(prov || ''), isRegion: true });
      }
    }
  }

  const out = Array.from(matches.values());
  out.sort((a,b) => (a.province + ' ' + a.name).localeCompare(b.province + ' ' + b.name));
  return out;
}

function getSavedColorForEvent(event, fallbackEvent) {
  if (!event) return null;
  return (window.savedAlertColors && (window.savedAlertColors[event] || (fallbackEvent && window.savedAlertColors[fallbackEvent]))) || null;
}

// --- US Cities CSV loader + polygon-city lookup helpers ---
// Loads `uscities.csv`, finds cities inside a polygon (or touching its bbox),
// and formats a human-readable list like: "Houston, Sugar Land, Richmond, and Meadows Place"
window._usCities = window._usCities || null;
window._canadaCities = window._canadaCities || null;
function parseCSV(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  function parseRow(row) {
    const res = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') {
        if (inQuotes && row[i+1] === '"') { cur += '"'; i++; } else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        res.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    res.push(cur);
    return res;
  }
  const headers = parseRow(lines.shift()).map(h => String(h).replace(/^"|"$/g, '').trim());
  const out = lines.map(line => {
    const row = parseRow(line);
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i] || `col${i}`;
      obj[key] = typeof row[i] === 'undefined' ? '' : String(row[i]).replace(/^"|"$/g, '');
    }
    return obj;
  });
  return out;
}

function loadCanadaCitiesJSON() {
  if (window._canadaCities && Array.isArray(window._canadaCities)) return Promise.resolve(window._canadaCities);
  return fetch('canada-cities.json').then(res => res.json()).then(arr => {
    if (!Array.isArray(arr)) return [];
    const filtered = arr.map(c => ({
      city: String(c.name || c.asciiName || '').trim(),
      state_id: String(c.admin1Code || '').trim(),
      county: '',
      lat: Number(c.latitude),
      lng: Number(c.longitude),
      population: Number(c.population) || 0,
      countryCode: String(c.countryCode || 'CA').trim().toUpperCase()
    })).filter(c => c.city && !isNaN(c.lat) && !isNaN(c.lng));
    window._canadaCities = filtered;
    return filtered;
  }).catch(() => []);
}

function tryFetchUScities(paths) {
  const attempt = (i) => {
    if (i >= paths.length) return Promise.reject(new Error('Could not fetch uscities.csv'));
    return fetch(paths[i]).then(r => {
      if (!r.ok) throw new Error('fetch failed');
      return r.text();
    }).catch(() => attempt(i+1));
  };
  return attempt(0);
}
function loadUSCitiesCSV() {
  if (window._usCities && Array.isArray(window._usCities)) return Promise.resolve(window._usCities);
  // Prefer Google Sheets source (user-provided). Fallback to local CSV files if sheet fetch fails.
  const SHEETS_USCITIES_URL = 'https://sheets.googleapis.com/v4/spreadsheets/1KXx_iU5LIG26lfwhHjH8RjwrOeBTYCDY1drLJ52_DdY/values/Sheet1!A:E?key=AIzaSyAnjraIjs-jdsZA6pK1Ab5GjgWIifhykM4';

  function mapCityObj(o) {
    const lat = parseFloat(o.lat || o.latitude || o.Lat || o.LAT || o.Latitude || o.Latitude_deg || '0');
    const lng = parseFloat(o.lng || o.longitude || o.Lng || o.LON || o.Longitude || '0');
    return {
      city: o.city || o.city_ascii || o.City || o.City_ascii || '',
      state_id: o.state_id || o.state || o.state_name || '',
      county: o.county_name || o.county || '',
      lat: isNaN(lat) ? 0 : lat,
      lng: isNaN(lng) ? 0 : lng,
      population: Number(o.population) || 0,
      countryCode: String(o.countryCode || o.country || 'US').trim().toUpperCase()
    };
  }

  // Try sheet first
  return fetch(SHEETS_USCITIES_URL).then(res => res.json()).then(obj => {
    const vals = obj && obj.values ? obj.values : null;
    if (!vals || !Array.isArray(vals) || vals.length === 0) throw new Error('No sheet values');

    // If sheet rows are single-cell CSV lines (uploaded CSV in one column), join and parse
    if (vals[0].length === 1 && typeof vals[0][0] === 'string' && vals[0][0].toLowerCase().includes('city')) {
      const csvText = vals.map(r => r[0]).join('\n');
      const parsed = parseCSV(csvText);
      return parsed.map(o => mapCityObj(o));
    }

    // Otherwise treat as normal sheet with header row
    const headers = vals[0].map(h => String(h || '').trim());
    const rows = vals.slice(1).map(r => {
      const obj = {};
      for (let i = 0; i < headers.length; i++) obj[headers[i]] = r[i] !== undefined ? r[i] : '';
      return obj;
    });
    return rows.map(o => mapCityObj(o));
  }).catch(() => {
    // Fallback: try local CSV files (existing behavior)
    const candidates = ['uscities.csv','/uscities.csv','src/uscities.csv','/src/uscities.csv'];
    return tryFetchUScities(candidates).then(txt => {
      const parsed = parseCSV(txt);
      return parsed.map(o => mapCityObj(o));
    });
  }).then(objs => {
    const filtered = (objs || []).filter(c => c.city && !isNaN(c.lat) && !isNaN(c.lng));
    return loadCanadaCitiesJSON().then(canadaCities => {
      const combined = filtered.concat(canadaCities || []);
      window._usCities = combined;
      return combined;
    });
  });
}

function normalizeInputToRings(poly) {
  // Returns an array of rings. Each ring is [[lng,lat],...]
  if (!Array.isArray(poly)) return [];
  const isPair = arr => Array.isArray(arr) && arr.length >= 2 && (typeof arr[0] === 'number' || typeof arr[0] === 'string') && (typeof arr[1] === 'number' || typeof arr[1] === 'string');
  const rings = [];
  function recurse(a) {
    if (!Array.isArray(a)) return;
    if (a.length > 0 && isPair(a[0])) { // this is a ring
      rings.push(a);
      return;
    }
    for (const e of a) recurse(e);
  }
  recurse(poly);
  // normalize orientation/ordering to [lng,lat] using existing helper if available
  return rings.map(r => normalizePolyToLngLat(r));
}

function computeBBoxFromRings(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      const x = Number(p[0]), y = Number(p[1]);
      if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function pointInPolygonUsingFeature(pointLngLat, rings) {
  // pointLngLat = [lng, lat], rings = array of rings in [lng,lat]
  if (!Array.isArray(rings) || rings.length === 0) return false;
  // Build a GeoJSON-like feature and reuse existing pointInFeature
  const geometry = { type: 'Polygon', coordinates: [ ...rings ] };
  const feat = { geometry };
  return pointInFeature(pointLngLat, feat);
}

function getCitiesInPolygon(polygonPoints, opts = {}) {
  // opts: { includeBBoxFallback: true, maxResults: 50 }
  const includeBBoxFallback = typeof opts.includeBBoxFallback === 'boolean' ? opts.includeBBoxFallback : true;
  const DEFAULT_MAX_RESULTS = 500;
  const maxResults = Number(opts.maxResults) || DEFAULT_MAX_RESULTS;
  return loadUSCitiesCSV().then(cities => {
    if (!Array.isArray(cities) || cities.length === 0) return [];
    const rings = normalizeInputToRings(polygonPoints);
    if (!rings || rings.length === 0) return [];
    const bbox = computeBBoxFromRings(rings);
    const insideList = [];
    const bboxList = [];
    const seen = new Set();
    for (const c of cities) {
      const pt = [Number(c.lng), Number(c.lat)];
      let inside = false;
      try { inside = pointInPolygonUsingFeature(pt, rings); } catch (e) { inside = false; }
      let inBBox = false;
      if (!inside && includeBBoxFallback) {
        if (pt[0] >= bbox.minX && pt[0] <= bbox.maxX && pt[1] >= bbox.minY && pt[1] <= bbox.maxY) inBBox = true;
      }
      if (inside || inBBox) {
        const key = `${c.city}||${c.state_id || ''}||${c.countryCode || ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          const entry = Object.assign({}, c, { inside: inside, inBBox: inBBox });
          if (inside) insideList.push(entry);
          else bboxList.push(entry);
        }
      }
    }

    // prefer interior matches first, then bbox-only matches; within each group sort by population desc then name
    const sortGroup = (arr) => arr.sort((a,b) => (b.population || 0) - (a.population || 0) || a.city.localeCompare(b.city));
    sortGroup(insideList);
    sortGroup(bboxList);
    const combined = insideList.concat(bboxList);
    return combined.slice(0, maxResults);
  });
}

function formatCityList(cityNames) {
  if (!Array.isArray(cityNames) || cityNames.length === 0) return '';
  const parts = cityNames;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  const last = parts.pop();
  return `${parts.join(', ')}, and ${last}`;
}

function townsImpactedLabel(polygonPoints, opts = {}) {
  // Returns a Promise that resolves to the formatted label string
  return getCitiesInPolygon(polygonPoints, opts).then(arr => {
    const names = (arr || []).map(c => c.city).filter(Boolean);
    return formatCityList(names);
  });
}

// Expose helpers to global scope for use elsewhere in the app
window.loadUSCitiesCSV = loadUSCitiesCSV;
window.getCitiesInPolygon = getCitiesInPolygon;
window.formatCityList = formatCityList;
window.townsImpactedLabel = townsImpactedLabel;

// RainViewer/radar state and slider removed

const VOLTADAR_ALERTS_API = 'https://a8890-c7a1.e.jrnm.app/eventstream';

window.__voltadarAlertsSseHealthy = false;
window.__voltadarAlertsEventSource = null;

function ingestVoltadarSsePayloadString(dataStr) {
  try {
    const t = String(dataStr ?? '').trim();
    if (!t) {
      console.warn('[alerts] Empty SSE data string');
      return null;
    }
    console.log('[alerts] Parsing SSE data string (first 500 chars):', t.substring(0, 500));
    const parsed = JSON.parse(t);
    console.log('[alerts] Parsed JSON structure keys:', Object.keys(parsed));
    const normalized = { features: normalizeAlertsPayload(parsed) };
    console.log('[alerts] Normalized payload has', normalized.features.length, 'features');
    return normalized;
  } catch (e) {
    console.error('[alerts] Voltadar SSE payload parse FAILED:', e.message, 'dataStr:', dataStr);
    return null;
  }
}

function normalizeVoltadarAlertToFeature(alert) {
  if (!alert || typeof alert !== 'object') return null;
  if (alert.type === 'Feature' && alert.properties) return alert;

  const props = Object.assign({}, alert.properties || {});
  const alertInfo = (alert.alertinfo && typeof alert.alertinfo === 'object') ? alert.alertinfo : {};
  const ugcList = Array.isArray(alert.ugc) ? alert.ugc : (Array.isArray(props.ugc) ? props.ugc : []);
  props.ugc = ugcList;
  props.alertinfo = alertInfo;
  props.areaDesc = alert.areaDesc || props.areaDesc || '';
  props.description = alert.description || props.description || '';
  props.expires = alert.expires || props.expires || '';
  props.sent = alert.sent || props.sent || '';
  props.sender = alert.sender || props.sender || '';
  props.event = alert.event || props.event || '';

  const parameters = Object.assign({}, props.parameters || {});
  if (!parameters.maxHailSize && alertInfo.MAX_HAIL_SIZE) parameters.maxHailSize = [alertInfo.MAX_HAIL_SIZE];
  if (!parameters.maxWindGust && alertInfo.MAX_WIND_GUST) parameters.maxWindGust = [alertInfo.MAX_WIND_GUST];
  if (!parameters.tornadoDamageThreat && alertInfo.TORNADO_DAMAGE_THREAT) parameters.tornadoDamageThreat = [alertInfo.TORNADO_DAMAGE_THREAT];
  if (!parameters.thunderstormDamageThreat && alertInfo.THUNDERSTORM_DAMAGE_THREAT) parameters.thunderstormDamageThreat = [alertInfo.THUNDERSTORM_DAMAGE_THREAT];
  if (!parameters.flashFloodDamageThreat && alertInfo.FLASH_FLOOD_DAMAGE_THREAT) parameters.flashFloodDamageThreat = [alertInfo.FLASH_FLOOD_DAMAGE_THREAT];
  if (!parameters.tornadoDetection && alertInfo.TORNADO) parameters.tornadoDetection = [alertInfo.TORNADO];
  props.parameters = parameters;
  props.geocode = props.geocode || {};
  if (!props.geocode.UGC && ugcList.length) props.geocode.UGC = ugcList;

  let geometry = null;
  const coords = Array.isArray(alert.coordinates) ? alert.coordinates : [];
  if (coords.length >= 3) {
    const ring = coords
      .map(pt => Array.isArray(pt) && pt.length >= 2 ? [Number(pt[1]), Number(pt[0])] : null)
      .filter(pt => pt && Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
    if (ring.length >= 3) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
      geometry = { type: 'Polygon', coordinates: [ring] };
    }
  }

  return {
    type: 'Feature',
    id: alert.id || props.id || `${props.sender || 'ALERT'}.${Date.now()}`,
    geometry: geometry,
    properties: props
  };
}

function normalizeAlertsPayload(data) {
  if (data && Array.isArray(data.features)) return data.features;
  if (Array.isArray(data)) return data.map(normalizeVoltadarAlertToFeature).filter(Boolean);
  if (data && Array.isArray(data.alerts)) return data.alerts.map(normalizeVoltadarAlertToFeature).filter(Boolean);
  if (data && data.alert) {
    if (Array.isArray(data.alert)) {
      return data.alert.map(normalizeVoltadarAlertToFeature).filter(Boolean);
    }
    return [normalizeVoltadarAlertToFeature(data.alert)].filter(Boolean);
  }
  // Handle single alert object (not in an array)
  if (data && typeof data === 'object' && data.id) return [normalizeVoltadarAlertToFeature(data)].filter(Boolean);
  return [];
}

async function fetchActiveAlertsHttp() {
  try {
    const response = await fetch(VOLTADAR_ALERTS_API);
    if (!response.ok) throw new Error(`Voltadar alerts HTTP ${response.status}`);
    const data = await response.json();
    const normalized = { features: normalizeAlertsPayload(data) };
    console.debug('[FETCH] Received new alert data:', normalized);
    if (typeof window.pollNwsAlerts === 'function') {
      console.debug('[FETCH] Calling pollNwsAlerts immediately after fetch');
      window.pollNwsAlerts(normalized);
    }
    return normalized;
  } catch (err) {
    console.warn('[alerts] Voltadar API unavailable, falling back to weather.gov', err);
    const response = await fetch('https://api.weather.gov/alerts/active');
    const data = await response.json();
    const normalized = { features: normalizeAlertsPayload(data) };
    console.debug('[FETCH] Received new alert data (weather.gov fallback):', normalized);
    if (typeof window.pollNwsAlerts === 'function') {
      console.debug('[FETCH] Calling pollNwsAlerts immediately after weather.gov fetch');
      window.pollNwsAlerts(normalized);
    }
    return normalized;
  }
}

async function fetchActiveAlertsData() {
  return fetchActiveAlertsHttp();
}

function loadVoltadarAlertsForInitialBootstrap() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sse = null;
    let watchdogTimer = null;

    function cleanupWatchdog() {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    }

    function finishViaHttp(extraMsg) {
      if (settled) return;
      settled = true;
      cleanupWatchdog();
      if (sse) {
        try { sse.close(); } catch (_) {}
        sse = null;
      }
      window.__voltadarAlertsEventSource = null;
      window.__voltadarAlertsSseHealthy = false;
      if (extraMsg) console.warn(extraMsg);
      fetchActiveAlertsHttp().then(resolve).catch(reject);
    }

    watchdogTimer = setTimeout(() => {
      finishViaHttp('[alerts] Voltadar SSE snapshot timeout; using HTTP');
    }, 12000);

    if (typeof EventSource === 'undefined') {
      finishViaHttp(null);
      return;
    }

    try {
      sse = new EventSource(VOLTADAR_ALERTS_API);
      window.__voltadarAlertsEventSource = sse;
      console.log('[SSE] EventSource opened for:', VOLTADAR_ALERTS_API);

      const handleVoltadarSseEvent = (ev) => {
        console.log('[SSE] Raw event received:', { type: ev.type, dataLength: (ev.data || '').length, dataPreview: (ev.data || '').substring(0, 200) });
        
        let snap = null;
        try {
          snap = ingestVoltadarSsePayloadString(ev.data);
        } catch (parseErr) {
          console.error('[SSE] Failed to parse payload:', parseErr, 'rawData:', ev.data);
          return;
        }
        
        console.log('[SSE] Parsed payload:', snap);
        if (!snap || !Array.isArray(snap.features)) {
          console.warn('[SSE] Invalid snapshot structure or no features');
          return;
        }

        console.log('[SSE] Valid features count:', snap.features.length);
        window.nwsAlertFeatures = snap.features;
        window.__voltadarAlertsSseHealthy = true;

        if (!settled) {
          settled = true;
          cleanupWatchdog();
          resolve(snap);
          // Also process immediately for UI
          if (typeof window.pollNwsAlerts === 'function') {
            console.debug('[SSE] Calling pollNwsAlerts immediately after SSE bootstrap');
            window.pollNwsAlerts(snap);
          }
          return;
        }

        try {
          if (typeof window.pollNwsAlerts === 'function') {
            console.debug('[SSE] Calling pollNwsAlerts for live SSE update with', snap.features.length, 'features');
            window.pollNwsAlerts(snap);
          }
        } catch (e) {
          console.warn('[alerts] merge after Voltadar SSE snapshot failed', e);
        }
      };

      sse.onopen = () => {
        console.log('[SSE] Connection established');
      };
      
      sse.onmessage = handleVoltadarSseEvent;
      sse.addEventListener('alert', handleVoltadarSseEvent);

      sse.onerror = () => {
        if (!settled) {
          finishViaHttp('[alerts] Voltadar SSE failed before bootstrap; using HTTP fetch');
          return;
        }
        console.warn('[alerts] Voltadar SSE connection lost; reverting to HTTP polling');
        window.__voltadarAlertsSseHealthy = false;
        try { sse.close(); } catch (_) {}
        sse = null;
        window.__voltadarAlertsEventSource = null;
        try {
          if (typeof window.pollNwsAlerts === 'function') {
            // Force an immediate poll with no snapshot (will fetch fresh data)
            window.pollNwsAlerts(null);
            // Set up continuous polling via HTTP
            // Clear any existing interval to prevent multiple polling loops
            if (window._pollNwsAlertsInterval) {
              clearInterval(window._pollNwsAlertsInterval);
            }
            window._pollNwsAlertsInterval = setInterval(() => {
              if (typeof window.pollNwsAlerts === 'function') {
                window.pollNwsAlerts(null);
              }
            }, 2000);
          }
        } catch (_) {}
      };
    } catch (e) {
      finishViaHttp('[alerts] Voltadar SSE unavailable: ' + (e && e.message));
    }
  });
}

// Fetch NWS alerts and add polygons to the map (prefer SSE snapshot; Voltadar HTTP + weather.gov fallback)
loadVoltadarAlertsForInitialBootstrap()
  .then(async data => {
    // Store original features globally for SOURCE extraction
    window.nwsAlertFeatures = data.features || [];

    // Clear only the NWS alerts container.
    // document.getElementById("nws-alerts").innerHTML = "";
    // globalAlerts.length = 0;
    const now = new Date();
    let polygonsToAdd = [];
    let alertListHtml = '';
    polygonsById = {}; // Reset
    // queue alerts that lack geometry so we can fetch zone polygons for them
    const queuedAlertsWithoutGeometry = [];

    for (const feature of data.features) {
      const props = feature.properties;
      const event = props.event;
      const expiresText = props.expires;
      const expires = expiresText ? new Date(expiresText) : null;
      if (!event || !expiresText) continue;
      if (now > expires) continue;
      let fillColor = 'grey'; // default
      let flashThreat = null, tornadoDetection = null, tornadoDamageThreat = null, thunderstormDamageThreat = null;
      let priority = 0;
      // Parse additional parameter values
      const parameters = props.parameters || {};
      let maxHailSize = '', maxWindGust = '';
      if (parameters.maxHailSize) maxHailSize = parameters.maxHailSize[0];
      if (parameters.maxWindGust) maxWindGust = parameters.maxWindGust[0];
      if (parameters.flashFloodDamageThreat) flashThreat = parameters.flashFloodDamageThreat[0];
      if (parameters.tornadoDetection) tornadoDetection = parameters.tornadoDetection[0];
      if (parameters.tornadoDamageThreat) tornadoDamageThreat = parameters.tornadoDamageThreat[0];
      if (parameters.thunderstormDamageThreat) thunderstormDamageThreat = parameters.thunderstormDamageThreat[0];

      // Enhanced display event logic
      let displayEvent = event;
      if (event.includes('Flash Flood Warning')) {
        if (flashThreat === 'CATASTROPHIC') {
          displayEvent = '⚠ Flash Flood Emergency';
        } else if (flashThreat === 'CONSIDERABLE') {
          displayEvent = 'Considerable Flash Flood Warning';
        }
      } else if (event.includes('Tornado Warning')) {
        if (tornadoDetection === 'OBSERVED' && tornadoDamageThreat === 'CATASTROPHIC') {
          displayEvent = '⚠ Tornado Emergency';
        } else if ((tornadoDetection === 'OBSERVED' || tornadoDetection === 'RADAR INDICATED') &&
                   tornadoDamageThreat === 'CONSIDERABLE') {
          displayEvent = '⚠ PDS Tornado Warning';
        } else if (tornadoDetection === 'OBSERVED') {
          displayEvent = 'Observed Tornado Warning';
        } else if (tornadoDetection === 'RADAR INDICATED') {
          displayEvent = 'Radar Indicated Tornado Warning';
        }
      } else if (event.includes('Severe Thunderstorm Warning')) {
        if (thunderstormDamageThreat === 'DESTRUCTIVE') {
          displayEvent = '⚠ Destructive Severe Thunderstorm Warning';
        } else if (thunderstormDamageThreat === 'CONSIDERABLE') {
          displayEvent = 'Considerable Severe Thunderstorm Warning';
        }
      }

      if (event.includes('Tornado Warning')) {
        if (tornadoDetection === 'OBSERVED' && tornadoDamageThreat === 'CATASTROPHIC') { fillColor = '#460095'; priority = 110; }
        else if ((tornadoDetection === 'OBSERVED' || tornadoDetection === 'RADAR INDICATED') &&
                 tornadoDamageThreat === 'CONSIDERABLE') { fillColor = '#DE17C9'; priority = 100; }
        else if (tornadoDetection === 'OBSERVED') { fillColor = '#8B0000'; priority = 90; }
        else if (tornadoDetection === 'RADAR INDICATED') { fillColor = 'red'; priority = 70; }
        else { fillColor = 'red'; priority = 70; }
      }
      else if (event.includes('Flash Flood Warning')) {
          if (flashThreat === 'CATASTROPHIC') { fillColor = 'green'; priority = 80; }
          else if (flashThreat === 'CONSIDERABLE') { fillColor = '#01b70e'; priority = 40; }
          else { fillColor = 'lime'; priority = 30; }
        }
        else if (event.includes('Severe Thunderstorm Warning')) {
          if (thunderstormDamageThreat === 'DESTRUCTIVE') { fillColor = '#FF8100'; priority = 65; }
          else if (thunderstormDamageThreat === 'CONSIDERABLE') { fillColor = '#B8860B'; priority = 60; }
          else { fillColor = '#FFAA00'; priority = 55; }
        }
      else if (event.includes('Snow Squal Warning')) {
        fillColor = 'rgb(149, 149, 149)'; priority = 19;
      }
      else if (event.includes('Special Weather Statement')) {
        fillColor = 'rgb(160, 106, 217)'; priority = 18;
      }
      else if (event.includes('Marine Weather Statement')) {
        fillColor = 'rgb(206, 198, 144)'; priority = 17.5;
      }
      else if (event.includes('Flood Advisory')) {
          fillColor = 'rgb(156, 255, 170)'; priority = 9;
        }
        else if (event.includes('Flood Warning')) {
          fillColor = 'rgb(92, 255, 114)'; priority = 8;
        }
        else if (event.includes('Flood Watch')) {
          fillColor = 'rgb(159, 255, 246)'; priority = 8;
        }
      else if (event.includes('Special Marine Warning')) {
        fillColor = 'rgb(219, 71, 255)'; priority = 14;
      }
      else if (event.includes('Tornado Watch')) {
        fillColor = 'rgb(255, 85, 85)'; priority = 14.9;
      }
      else if (event.includes('Severe Thunderstorm Watch')) {
        fillColor = 'rgb(253, 255, 133)'; priority = 14.8;
      }
      else if (event.includes('Flash Flood Watch')) {
        fillColor = 'rgb(159, 255, 246)'; priority = 14.7;
      }
      else if (event.includes('Blizzard Warning')) {
        fillColor = '#0000f6'; priority = 13.95;
      }
      else if (event.includes('Ice Storm Warning')) {
        fillColor = '#6C2DA5'; priority = 13.9;
      }
      else if (event.includes('Winter Storm Warning')) {
        fillColor = '#0073ff'; priority = 13.85;
      }
      else if (event.includes('Winter Weather Advisory')) {
        fillColor = '#657fff'; priority = 13.8;
      }
      else if (event.includes('Lake Effect Snow Warning')) {
        fillColor = '#008B8A'; priority = 13.75;
      }
      else if (event.includes('Avalanche Warning')) {
        fillColor = '#36C6FF'; priority = 13.7;
      }
      else if (event.includes('Extreme Cold Warning')) {
        fillColor = '#0A47FF'; priority = 13.65;
      }
      else if (event.includes('Freeze Warning')) {
        fillColor = '#5F4B7C'; priority = 13.6;
      }
      else if (event.includes('Blizzard Watch')) {
        fillColor = '#5a6bd9'; priority = 13.55;
      }
      else if (event.includes('Winter Storm Watch')) {
        fillColor = '#75B6FF'; priority = 13.5;
      }
      else if (event.includes('Avalanche Watch')) {
        fillColor = '#F4A261'; priority = 13.45;
      }
      else if (event.includes('Extreme Cold Watch')) {
        fillColor = '#4DB6AC'; priority = 13.4;
      }
      else if (event.includes('Freeze Watch')) {
        fillColor = '#00F2E6'; priority = 13.35;
      }
      else if (event.includes('Cold Weather Advisory')) {
        fillColor = '#CFF8F0'; priority = 13.3;
      }
      else if (event.includes('Frost Advisory')) {
        fillColor = '#6EA7FF'; priority = 13.25;
      }
      else if (event.includes('Dust Storm Warning')) {
        fillColor = '#ffe9d1'; priority = 15.85;
      }
      else if (event.includes('Blowing Dust Warning')) {
        fillColor = '#fff0d5'; priority = 15.8;
      }
      else if (event.includes('Dense Fog Advisory')) {
        fillColor = '#6f7b84'; priority = 12.6;
      }
      else if (event.includes('Dense Fog (marine) Advisory')) {
        fillColor = '#6d7d86'; priority = 12.55;
      }
      else if (event.includes('Dense Smoke Advisory')) {
        fillColor = '#fff2a8'; priority = 12.5;
      }
      else if (event.includes('Blowing Dust Advisory')) {
        fillColor = '#d1bd6c'; priority = 7;
      }
      else if (event.includes('Dust Advisory')) {
        fillColor = '#c4b55d'; priority = 7;
      }
      else if (event.includes('Lake Wind Advisory')) {
        fillColor = '#d6b681'; priority = 7;
      }
      else if (event == 'Wind Advisory' || (event.includes('Wind Advisory') && !event.includes('Brisk Wind Advisory') && !event.includes('Lake Wind Advisory'))) {
        fillColor = '#d2b67d'; priority = 7;
      }
      else if (event.includes('Freezing Fog Advisory')) {
        fillColor = '#008B8A'; priority = 7;
      }
      else if (event.includes('Air Stagnation Advisory')) {
        fillColor = '#7d7d7d'; priority = 7;
      }
      else if (event.includes('Air Quality Alert')) {
        fillColor = '#7d7d7d'; priority = 7;
      }
      else if (event.includes('Extreme Wind Warning')) {
        fillColor = '#ff9a1a'; priority = 12.95;
      }
      else if (event.includes('Hurricane Force Wind Warning')) {
        fillColor = '#c75b5b'; priority = 12.9;
      }
      else if (event.includes('High Wind Warning')) {
        fillColor = '#efb700'; priority = 12.75;
      }
      else if (event.includes('Hurricane Force Wind Watch')) {
        fillColor = '#8e44ff'; priority = 12.7;
      }
      else if (event.includes('High Wind Watch')) {
        fillColor = '#ffc800'; priority = 12.65;
      }
      else if (event.includes('Red Flag Warning')) {
        fillColor = '#ff956e'; priority = 13.2;
      }
      // Tropical alerts (11.x)
      else if (event.includes('Storm Surge Warning')) {
        fillColor = '#263447'; priority = 11.9;
      }
      else if (event.includes('Hurricane Warning')) {
        fillColor = '#5a0d0d'; priority = 11.85;
      }
      else if (event.includes('Typhoon Warning')) {
        fillColor = '#d63b4e'; priority = 11.8;
      }
      else if (event.includes('Tropical Storm Warning')) {
        fillColor = '#d9534f'; priority = 11.75;
      }
      else if (event.includes('Storm Surge Watch')) {
        fillColor = '#6d5ed6'; priority = 11.5;
      }
      else if (event.includes('Hurricane Watch')) {
        fillColor = '#7a2b2b'; priority = 11.45;
      }
      else if (event.includes('Typhoon Watch')) {
        fillColor = '#c97b7b'; priority = 11.4;
      }
      else if (event.includes('Tropical Storm Watch')) {
        fillColor = '#e05a4f'; priority = 11.35;
      }
      // Marine alerts (9.x)
      else if (event.includes('Heavy Freezing Spray Warning')) {
        fillColor = '#39c5ff'; priority = 9.95;
      }
      else if (event.includes('Gale Warning')) {
        fillColor = '#e8c7ff'; priority = 9.9;
      }
      else if (event.includes('Hazardous Seas Warning')) {
        fillColor = '#4b4f5a'; priority = 9.85;
      }
      else if (event.includes('Storm Warning')) {
        fillColor = '#4b5370'; priority = 9.8;
      }
      else if (event.includes('Small Craft Advisory')) {
        fillColor = '#e0c3f2'; priority = 9.6;
      }
      else if (event.includes('Freezing Spray Advisory')) {
        fillColor = '#26c8ff'; priority = 9.55;
      }
      else if (event.includes('Brisk Wind Advisory')) {
        fillColor = '#e9d3f0'; priority = 9.5;
      }
      else if (event.includes('Low Water Advisory')) {
        fillColor = '#8b2f2f'; priority = 9.45;
      }
      else if (event.includes('Storm Watch')) {
        fillColor = '#f3d9a5'; priority = 9.3;
      }
      else if (event.includes('Gale Watch')) {
        fillColor = '#f1bfc2'; priority = 9.25;
      }
      else if (event.includes('Hazardous Seas Watch')) {
        fillColor = '#4b3b6d'; priority = 9.2;
      }
      else if (event.includes('Heavy Freezing Spray Watch')) {
        fillColor = '#b57a75'; priority = 9.15;
      }
      // Heat alerts (10.x)
      else if (event.includes('Extreme Heat Warning')) {
        fillColor = '#d9006a'; priority = 10.95;
      }
      else if (event.includes('Extreme Heat Watch')) {
        fillColor = '#5a0000'; priority = 10.9;
      }
      else if (event.includes('Heat Advisory')) {
        fillColor = '#ff8a00'; priority = 10.5;
      }
      else if (event.includes('Fire Warning')) {
        fillColor = '#a24f2f'; priority = 10.85;
      }
      else if (event.includes('Fire Weather Watch')) {
        fillColor = '#ffd9a6'; priority = 10.4;
      }
      // Civil/public safety alerts (9.x)
      else if (event.includes('Shelter In Place Warning')) {
        fillColor = '#a1599f'; priority = 9.95;
      }
      else if (event.includes('Evacuation Immediate')) {
        fillColor = '#9f5a7d'; priority = 9.9;
      }
      else if (event.includes('Civil Danger Warning')) {
        fillColor = '#993333'; priority = 9.85;
      }
      else if (event.includes('Civil Emergency Message')) {
        fillColor = '#884477'; priority = 9.8;
      }
      else if (event.includes('Law Enforcement Warning')) {
        fillColor = '#664466'; priority = 9.75;
      }
      else if (event.includes('Local Area Emergency')) {
        fillColor = '#5a5c63'; priority = 9.7;
      }
      else if (event.includes('911 Telephone Outage')) {
        fillColor = '#5f4f5f'; priority = 9.65;
      }
      else if (event.includes('Hazardous Weather Outlook')) {
        fillColor = '#fffee0'; priority = 9.6;
      }
      else if (event.includes('Short Term Forecast')) {
        fillColor = '#7a7a7a'; priority = 9.55;
      }
      // Marine alerts (9.x)
      else if (event.includes('Heavy Freezing Spray Warning')) {
        fillColor = '#39c5ff'; priority = 9.95;
      }
      // allow user override stored in localStorage (match displayEvent first)
      const savedOverride = getSavedColorForEvent(displayEvent, event);
      if (savedOverride) fillColor = savedOverride;
      if (feature.geometry) {
        // GeoJSON polygons: coordinates[0] is [ [lng, lat], ... ]
        let geometry = null;
        if (feature.geometry.type === "Polygon") {
          geometry = {
            type: "Polygon",
            coordinates: feature.geometry.coordinates
          };
        } else if (feature.geometry.type === "MultiPolygon") {
          geometry = {
            type: "MultiPolygon",
            coordinates: feature.geometry.coordinates
          };
        } else {
          continue;
        }
        // Respect saved visibility toggles: skip adding this alert if user turned it off
        try {
          const visMap = window.savedAlertVisibility || {};
          const nKey = normalizeEventKey(displayEvent);
          const isVisible = (typeof visMap[displayEvent] !== 'undefined') ? !!visMap[displayEvent] : (typeof visMap[nKey] !== 'undefined' ? !!visMap[nKey] : isAlertVisibleByDefault(displayEvent));
          if (!isVisible) {
            // still map the alert id to empty so it won't be shown later
            window.alertToZoneIds[feature.id] = window.alertToZoneIds[feature.id] || [];
            continue;
          }
        } catch (e) { /* ignore visibility errors and proceed */ }

        const polygonFeature = {
          type: "Feature",
          geometry: geometry,
          properties: {
            id: feature.id,
            event: event,
           // Add the computed display event so UI can use the enhanced label
           displayEvent: displayEvent,
            fillColor: fillColor,
            priority: priority,
            expires: expiresText,
            areaDesc: props.areaDesc || '',
            maxHailSize: maxHailSize,
            maxWindGust: maxWindGust,
            description: props.description || '',
            parameters: props.parameters || {}
          }
        };
        polygonsToAdd.push(polygonFeature);
        polygonsById[feature.id] = polygonFeature;
        // Map this alert id to its own polygon id
        window.alertToZoneIds[feature.id] = [feature.id];
        // when building alert list HTML ensure it uses effective fillColor (including saved override)
        alertListHtml += `
          <div class="nws-alert-item" data-alert-id="${feature.id}" style="cursor:pointer;">
            <span class="nws-alert-color-box" style="background:${fillColor};"></span>
            <span class="nws-alert-event">${displayEvent}</span>
            <div class="nws-alert-expires">Expires: ${expiresText.replace('T',' ').replace('Z',' UTC')}</div>
          </div>
        `;
      } else {
        // queue for later zone fetch and add a sidebar entry so the alert is visible
        // If no geometry, queue for zone fetch but respect visibility toggles
        try {
          const visMap2 = window.savedAlertVisibility || {};
          const nKey2 = normalizeEventKey(displayEvent);
          const isVisible2 = (typeof visMap2[displayEvent] !== 'undefined') ? !!visMap2[displayEvent] : (typeof visMap2[nKey2] !== 'undefined' ? !!visMap2[nKey2] : isAlertVisibleByDefault(displayEvent));
          if (isVisible2) {
            queuedAlertsWithoutGeometry.push({ feature, props, displayEvent, fillColor, priority, expiresText, maxHailSize, maxWindGust });
            alertListHtml += `
              <div class="nws-alert-item" data-alert-id="${feature.id}" style="cursor:pointer;opacity:0.9;">
                <span class="nws-alert-color-box" style="background:${fillColor};"></span>
                <span class="nws-alert-event">${displayEvent} (zone)</span>
                <div class="nws-alert-expires">Expires: ${expiresText.replace('T',' ').replace('Z',' UTC')}</div>
              </div>
            `;
            console.debug('[alerts] queued alert for zone fetch', feature.id, displayEvent);
          } else {
            // respect off state: ensure mapping exists but don't queue or list
            window.alertToZoneIds[feature.id] = window.alertToZoneIds[feature.id] || [];
          }
        } catch (e) {
          // fallback to original behavior on error
          queuedAlertsWithoutGeometry.push({ feature, props, displayEvent, fillColor, priority, expiresText, maxHailSize, maxWindGust });
          alertListHtml += `
            <div class="nws-alert-item" data-alert-id="${feature.id}" style="cursor:pointer;opacity:0.9;">
              <span class="nws-alert-color-box" style="background:${fillColor};"></span>
              <span class="nws-alert-event">${displayEvent} (zone)</span>
              <div class="nws-alert-expires">Expires: ${expiresText.replace('T',' ').replace('Z',' UTC')}</div>
            </div>
          `;
          console.debug('[alerts] queued alert for zone fetch', feature.id, displayEvent);
        }
      }
    }

    // Update the alert list in the sidebar
    document.getElementById('nws-alerts-list-content').innerHTML = alertListHtml || '<div>No active alerts.</div>';

    // If there are queued alerts (no geometry), attempt to fetch zone polygons for their UGCs
    if (queuedAlertsWithoutGeometry.length > 0 && typeof window.fetchZoneGeometry === 'function' && typeof window.extractAlertUGCs === 'function') {
      const zoneFetchPromises = [];
      for (const queued of queuedAlertsWithoutGeometry) {
        const { feature, props, displayEvent, fillColor, priority, expiresText, maxHailSize, maxWindGust } = queued;
        const ugcs = extractAlertUGCs(props) || [];
        const failedUgcs = [];
        for (const ugc of ugcs) {
          zoneFetchPromises.push((async () => {
            try {
              console.debug('[alerts] fetching zone for ugc', ugc, 'for alert', feature.id);
              const geometry = await fetchZoneGeometry(ugc);
              if (!geometry) {
                failedUgcs.push(ugc);
                console.warn('[alerts] no geometry returned for', ugc, 'alert', feature.id);
                return null;
              }
              // Build a synthetic id so it doesn't collide with original alert id
              const syntheticId = `${feature.id}-zone-${ugc}`;
              if (polygonsById[syntheticId]) return null;
              const polygonFeature = {
                type: 'Feature',
                geometry: geometry,
                properties: {
                  id: syntheticId,
                  event: feature.properties.event,
                  displayEvent: displayEvent,
                  fillColor: fillColor,
                  priority: priority,
                  expires: expiresText,
                  areaDesc: props.areaDesc || '',
                  maxHailSize: maxHailSize,
                  maxWindGust: maxWindGust,
                  description: props.description || '',
                  parameters: props.parameters || {},
                  _ugc_source: ugc,
                  parentAlertId: feature.id
                }
              };
              polygonsToAdd.push(polygonFeature);
              polygonsById[syntheticId] = polygonFeature;
              // Map the original alert id to its zone polygon ids (append)
              window.alertToZoneIds[feature.id] = window.alertToZoneIds[feature.id] || [];
              if (!window.alertToZoneIds[feature.id].includes(syntheticId)) {
                window.alertToZoneIds[feature.id].push(syntheticId);
              }
              console.debug('[alerts] added zone polygon for', feature.id, 'ugc', ugc, 'syntheticId', syntheticId);
              return polygonFeature;
            } catch (e) {
              failedUgcs.push(ugc);
              console.warn('[alerts] error fetching zone for', ugc, 'alert', feature.id, e);
              return null;
            }
          })());
        }
      }
      // Wait for all zone fetches to finish (best-effort)
      try { const results = await Promise.all(zoneFetchPromises); console.debug('[alerts] zone fetch results count', results.filter(Boolean).length); } catch(e) { console.warn('[alerts] zone fetch promise error', e); }
      // Ensure polygon layers/sources are (re)added now that we've added zone polygons
      try {
        if (typeof ensureNwsAlertPolygonsLayers === 'function') {
          try { ensureNwsAlertPolygonsLayers(); } catch (e) { console.warn('ensureNwsAlertPolygonsLayers failed', e); }
        }
      } catch(e) { /* ignore */ }
    }

    // CHANGE TO: Sort alerts by priority before adding them
    if (alertListHtml) {
      const alertContainer = document.getElementById('nws-alerts-list-content');
      // Convert existing items to array and add new ones
      // Build a unique list keyed by original alert id so we don't show one item per UGC zone
      const alertMap = {};
      // If we have explicit alert->zone mapping, use it to pick a representative feature per alert
      const alertIds = (window.alertToZoneIds && Object.keys(window.alertToZoneIds).length) ? Object.keys(window.alertToZoneIds) : Object.keys(polygonsById);
      alertIds.forEach(aid => {
        const zoneIds = (window.alertToZoneIds && window.alertToZoneIds[aid]) || [aid];
        // prefer the original polygon if present, otherwise the first available zone polygon
        let rep = polygonsById[aid] || null;
        if (!rep) {
          for (const zid of zoneIds) {
            if (polygonsById[zid]) { rep = polygonsById[zid]; break; }
          }
        }
        if (rep) {
          // store a shallow copy with id set to the alert id for labeling
          alertMap[aid] = Object.assign({}, rep, { properties: Object.assign({}, rep.properties, { id: aid }) });
        }
      });

      const alertFeatures = Object.keys(alertMap).map(k => ({ id: k, feature: alertMap[k] }));
      // Sort by priority (highest first)
      alertFeatures.sort((a, b) => (Number(b.feature.properties.priority) || 0) - (Number(a.feature.properties.priority) || 0));

      // Generate HTML in priority order, one item per original alert id
      const sortedHtml = alertFeatures.map(({ id, feature }) => `
        <div class="nws-alert-item" data-alert-id="${id}" style="cursor:pointer;">
          <span class="nws-alert-color-box" style="background:${feature.properties.fillColor};"></span>
          <span class="nws-alert-event">${feature.properties.displayEvent}</span>
          <div class="nws-alert-expires">Expires: ${feature.properties.expires.replace('T',' ').replace('Z',' UTC')}</div>
        </div>
      `).join('');

      alertContainer.innerHTML = sortedHtml || '<div>No active alerts.</div>';
    }

    // Add click event to each alert item
    document.querySelectorAll('.nws-alert-item').forEach(item => {
  item.addEventListener('click', function() {
    const alertId = this.getAttribute('data-alert-id');
    // pick a representative feature: prefer the original polygon if present, otherwise the first zone polygon
    let feature = polygonsById[alertId] || null;
    let associatedIds = (window.alertToZoneIds && window.alertToZoneIds[alertId]) || (feature ? [alertId] : []);
    // Deduplicate associated IDs to avoid duplicates after repeated updates
    associatedIds = Array.from(new Set(associatedIds));
    if ((!feature || !feature.geometry) && associatedIds && associatedIds.length) {
      for (const aid of associatedIds) {
        if (polygonsById[aid]) { feature = polygonsById[aid]; break; }
      }
    }
    // Calculate and fit bounds using all associated polygons where available
    if (associatedIds && associatedIds.length > 0) {
      let allCoords = [];
      associatedIds.forEach(id => {
        const pf = polygonsById[id];
        if (!pf || !pf.geometry) return;
        if (pf.geometry.type === 'Polygon') {
          allCoords = allCoords.concat(pf.geometry.coordinates[0]);
        } else if (pf.geometry.type === 'MultiPolygon') {
          pf.geometry.coordinates.forEach(mp => { if (mp && mp[0]) allCoords = allCoords.concat(mp[0]); });
        }
      });
      if (allCoords.length > 0) {
        let bounds = allCoords.reduce(function(bounds, coord) {
          return bounds.extend(coord);
        }, new maplibregl.LngLatBounds(allCoords[0], allCoords[0]));
        map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 4000 });
      }
    } else if (feature && feature.geometry) {
      // fallback to single feature bounds
      let coordinates = [];
      if (feature.geometry.type === "Polygon") coordinates = feature.geometry.coordinates[0];
      else if (feature.geometry.type === "MultiPolygon") coordinates = feature.geometry.coordinates[0][0];
      if (coordinates && coordinates.length) {
        let bounds = coordinates.reduce(function(bounds, coord) { return bounds.extend(coord); }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
        map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 4000 });
      }
    }

    // Keep the alert row click focused on the map and avoid opening the summary panel or description.
      });
    });

    if (polygonsToAdd.length === 0) return;

    // Sort polygons so higher priority (larger number) are drawn last (on top)
    polygonsToAdd.sort((a, b) => (Number(a.properties.priority) || 0) - (Number(b.properties.priority) || 0));

    const geojson = {
      type: "FeatureCollection",
      features: polygonsToAdd
    };

    // Apply saved visibility overrides (hide events user turned off)
    try {
      const visMap = window.savedAlertVisibility || {};
      // build a normalized visibility map to account for displayEvent differences (emoji/prefixes)
      const normVis = {};
      Object.keys(visMap).forEach(k => { normVis[k] = visMap[k]; normVis[normalizeEventKey(k)] = visMap[k]; });

      polygonsToAdd.forEach(f => {
        const ev = (f.properties && (f.properties.displayEvent || f.properties.event)) || '';
        const n = normalizeEventKey(ev);
        if ((normVis.hasOwnProperty(ev) && normVis[ev] === false) || (normVis.hasOwnProperty(n) && normVis[n] === false)) {
          if (typeof f.properties._originalFillColor === 'undefined') f.properties._originalFillColor = f.properties.fillColor || '#00FFFF';
          f.properties.fillColor = 'rgba(0,0,0,0)';
          f.properties.outlineColor = 'rgba(0,0,0,0)';
          f.properties._visible = false;
        }
      });
      // also ensure polygonsById reflects the same
      Object.values(polygonsById).forEach(f => {
        const ev = (f.properties && (f.properties.displayEvent || f.properties.event)) || '';
        const n = normalizeEventKey(ev);
        if ((normVis.hasOwnProperty(ev) && normVis[ev] === false) || (normVis.hasOwnProperty(n) && normVis[n] === false)) {
          if (typeof f.properties._originalFillColor === 'undefined') f.properties._originalFillColor = f.properties.fillColor || '#00FFFF';
          f.properties.fillColor = 'rgba(0,0,0,0)';
          f.properties.outlineColor = 'rgba(0,0,0,0)';
          f.properties._visible = false;
        }
      });
    } catch (e) { /* ignore */ }

    function addNwsAlertPolygonsLayers(targetMap, geojsonData = geojson) {
      // Allow this to be used as an event handler (e.g. map.once('load', addNwsAlertPolygonsLayers))
      if (targetMap && typeof targetMap.getStyle !== 'function') {
        targetMap = null;
      }
      const m = targetMap || window.map;
      if (!m || typeof m.getStyle !== 'function') return;

      // Respect the main app's Alerts toggle: if alerts are disabled in layerSettings,
      // remove any existing NWS alert polygon layers/sources and do not add them.
      let layerSettings = {};
      try { layerSettings = JSON.parse(localStorage.getItem('layerSettings') || '{}'); } catch (e) { layerSettings = {}; }
      if (layerSettings.alertsEnabled === false) {
        try {
          if (m.getLayer && m.getLayer('nws-alert-polygons-fill')) m.removeLayer('nws-alert-polygons-fill');
          if (m.getLayer && m.getLayer('nws-alert-polygons-outline-black')) m.removeLayer('nws-alert-polygons-outline-black');
          if (m.getLayer && m.getLayer('nws-alert-polygons-outline-colored')) m.removeLayer('nws-alert-polygons-outline-colored');
          if (m.getSource && m.getSource('nws-alert-polygons')) m.removeSource('nws-alert-polygons');
        } catch (e) { /* ignore removal errors */ }
        return;
      }
      // Determine insertion point: try to place polygon layers beneath label/symbol layers
      const insertionLayerId = findFirstLabelLayerId(m);

      const sourceExists = !!m.getSource('nws-alert-polygons');
      if (!sourceExists) {
        m.addSource('nws-alert-polygons', {
          type: 'geojson',
          data: geojsonData
        });
      } else {
        try {
          m.getSource('nws-alert-polygons').setData(geojsonData);
        } catch (e) { /* ignore */ }
      }

      // Add polygon fill layer beneath everything (before the bottom-most layer)
      // This ensures fill sits under roads, highways, county borders, etc.
      const fillLayer = {
        id: 'nws-alert-polygons-fill',
        type: 'fill',
        source: 'nws-alert-polygons',
        layout: {
          'fill-sort-key': ['get', 'priority']
        },
        paint: {
          'fill-color': ['get', 'fillColor'],
          'fill-opacity': ['case', ['==', ['get', '_visible'], false], 0, 0.55],
          'fill-outline-color': ['coalesce', ['get', 'outlineColor'], ['get', 'fillColor'], 'rgba(0,0,0,0)']
        }
      };
      if (insertionLayerId) {
        m.addLayer(fillLayer, insertionLayerId);
      } else {
        m.addLayer(fillLayer);
      }
      if (m.getLayer && m.getLayer('radar-layer') && m.getLayer('nws-alert-polygons-fill')) {
        try {
          m.moveLayer('nws-alert-polygons-fill', 'radar-layer');
        } catch (e) {
          console.warn('Could not move NWS alert fill beneath radar-layer:', e);
        }
      }

      // Add black outline (placed above fill but beneath labels)
      const blackOutline = {
        id: 'nws-alert-polygons-outline-black',
        type: 'line',
        source: 'nws-alert-polygons',
        layout: {
          'line-sort-key': ['get', 'priority']
        },
        paint: {
          'line-color': '#000000',
          'line-width': 5,
          'line-opacity': ['case', ['==', ['get', '_visible'], false], 0, 1]
        }
      };
      const coloredOutline = {
        id: 'nws-alert-polygons-outline-colored',
        type: 'line',
        source: 'nws-alert-polygons',
        layout: {
          'line-sort-key': ['get', 'priority']
        },
        paint: {
          'line-color': ['coalesce', ['get', 'outlineColor'], ['get', 'fillColor'], '#ffffff'],
          'line-width': 3,
          'line-opacity': ['case', ['==', ['get', '_visible'], false], 0, 1]
        }
      };
      try {
        if (insertionLayerId) {
          m.addLayer(blackOutline, insertionLayerId);
          m.addLayer(coloredOutline, insertionLayerId);
        } else {
          m.addLayer(blackOutline);
          m.addLayer(coloredOutline);
        }
      } catch (e) {
        try { m.addLayer(blackOutline); m.addLayer(coloredOutline); } catch (err) { /* ignore */ }
      }
    }

    // --- POLYGON LAYER AUTO-RE-ADDER ---
    function ensureNwsAlertPolygonsLayers() {
      // Respect Alerts toggle from main app — do nothing if alerts disabled
      let layerSettings = {};
      try { layerSettings = JSON.parse(localStorage.getItem('layerSettings') || '{}'); } catch (e) { layerSettings = {}; }
      if (layerSettings.alertsEnabled === false) {
        // Remove any existing NWS polygon layers/sources from maps
        try {
          getAlertPolygonMaps().forEach((m) => {
            if (!m) return;
            try {
              if (m.getLayer && m.getLayer('nws-alert-polygons-fill')) m.removeLayer('nws-alert-polygons-fill');
              if (m.getLayer && m.getLayer('nws-alert-polygons-outline-black')) m.removeLayer('nws-alert-polygons-outline-black');
              if (m.getLayer && m.getLayer('nws-alert-polygons-outline-colored')) m.removeLayer('nws-alert-polygons-outline-colored');
              if (m.getSource && m.getSource('nws-alert-polygons')) m.removeSource('nws-alert-polygons');
            } catch (e) { /* ignore per-map removal errors */ }
          });
        } catch (e) { /* ignore */ }
        return;
      }

      if (!window.nwsAlertFeatures || !Array.isArray(window.nwsAlertFeatures)) return;
      // Only re-add if polygons exist and source/layers are missing
      const polygonsExist = Object.keys(polygonsById).length > 0;
      if (!polygonsExist) return;

      const geojson = {
        type: 'FeatureCollection',
        features: Object.values(polygonsById)
      };

      getAlertPolygonMaps().forEach((m) => {
        if (!m || typeof m.getSource !== 'function') return;
        const sourceMissing = !m.getSource('nws-alert-polygons');
        const fillMissing = !m.getLayer('nws-alert-polygons-fill');
        const outlineMissing = !m.getLayer('nws-alert-polygons-outline-black');
        const colorMissing = !m.getLayer('nws-alert-polygons-outline-colored');
        if (sourceMissing || fillMissing || outlineMissing || colorMissing) {
          addNwsAlertPolygonsLayers(m, geojson);
        }
      });
    }

    // Listen for map style changes (both maps) and periodically check for missing layers
    getAlertPolygonMaps().forEach((m) => {
      if (m && m.on) {
        m.on('styledata', ensureNwsAlertPolygonsLayers);
      }
    });
    setInterval(() => {
      ensureNwsAlertPolygonsLayers();
      if (typeof window._ensureSheetPolygonsOnMaps === 'function') {
        window._ensureSheetPolygonsOnMaps();
      }
    }, 2000);

    // Ensure layers exist on both maps
    getAlertPolygonMaps().forEach((m) => {
      if (!m) return;
      if (m.loaded && m.loaded()) {
        addNwsAlertPolygonsLayers(m);
      } else if (m.once) {
        m.once('load', () => addNwsAlertPolygonsLayers(m));
      }
    });
  })
  .catch(console.error);

// --- Show/Hide Alert Description Overlay ---
function showAlertDescription({ color, title, summary, alertId }) {
  document.getElementById("alertDescriptionHeader").style.background = `linear-gradient(135deg, ${color} 0%, black 100%)`;
  document.getElementById("alertDescriptionHeader").textContent = title;

  const descText = document.getElementById("alertDescriptionText");
  descText.textContent = "Loading description...";
  descText.style.background = "black";
  descText.style.fontFamily = "'Bebas Neue',sans-serif";
  descText.style.fontWeight = "bold";
  descText.style.fontSize = "18px";
  descText.style.maxHeight = "300px";
  descText.style.overflowY = "auto";
  descText.style.textAlign = "left";

  const overlay = document.getElementById("alertDescriptionOverlay");
  overlay.style.display = "flex";
  overlay.style.opacity = "0";
  overlay.style.pointerEvents = "auto";
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
  });

    // Prefer any description attached to the polygonsById synthetic feature (immediate),
    // then fall back to the NWS-stub, and finally (for sheet features) request the specific sheet cell.
    let description = '';
    if (alertId && polygonsById && polygonsById[alertId] && polygonsById[alertId].properties && polygonsById[alertId].properties.description) {
      description = polygonsById[alertId].properties.description;
    } else {
      const originalFeature = (window.nwsAlertFeatures || []).find(f => f.id === alertId);
      if (originalFeature && originalFeature.properties && originalFeature.properties.description) {
        description = originalFeature.properties.description;
      }
    }
    
    if (description) {
      // If this is a sheet Eye Watch, attempt to replace county placeholder asynchronously
      if (alertId && alertId.startsWith('sheet-eyewatch-')) {
        (async () => {
          try {
            const poly = polygonsById?.[alertId]?.geometry?.coordinates?.[0] || null;
            if (poly) {
              const counties = await countiesInPolygon(poly);
              let replaced = replaceCountyPlaceholderInText(description, counties);
              // Prune TORNADO section when Tornado not selected in menu unless this
              // feature is a Severe Thunderstorm or a Flash Flood type.
              try {
                const tornadoChecked = Array.from(document.querySelectorAll('#tornadoCheckboxList input[type=checkbox]:checked')).length > 0;
                const ftype = (polygonsById?.[alertId]?.properties?.type) || (polygonsById?.[alertId]?.properties?.event) || '';
                const isSevere = /severe thunderstorm/i.test(ftype || '');
                const isFlash = /flash flood/i.test(ftype || '');
                const isTornadoFeature = /tornado/i.test(ftype || '');
                if (!tornadoChecked && !isSevere && !isFlash && !isTornadoFeature) {
                  replaced = replaced.replace(/(^|\n)\s*TORNADO(?:\s*\.{1,3})?[^\n]*\n?/ig, '$1');
                  replaced = replaced.replace(/\(SELECTED PART OF THE TORNADO SECTION\)/ig, '');
                  replaced = replaced.replace(/\n{3,}/g, '\n\n');
                }
              } catch (e) { /* ignore */ }
              if (polygonsById && polygonsById[alertId] && polygonsById[alertId].properties) polygonsById[alertId].properties.description = replaced;
              descText.textContent = replaced;
              return;
            }
          } catch (e) { console.warn('County replacement failed', e); }
          // if county replacement not performed, possibly prune tornado here
          try {
            let out = description;
            const tornadoChecked = Array.from(document.querySelectorAll('#tornadoCheckboxList input[type=checkbox]:checked')).length > 0;
            const ftype = (polygonsById?.[alertId]?.properties?.type) || (polygonsById?.[alertId]?.properties?.event) || '';
            const isSevere = /severe thunderstorm/i.test(ftype || '');
            const isFlash = /flash flood/i.test(ftype || '');
            const isTornadoFeature = /tornado/i.test(ftype || '');
            if (!tornadoChecked && !isSevere && !isFlash && !isTornadoFeature) {
              out = out.replace(/(^|\n)\s*TORNADO(?:\s*\.{1,3})?[^\n]*\n?/ig, '$1');
              out = out.replace(/\(SELECTED PART OF THE TORNADO SECTION\)/ig, '');
              out = out.replace(/\n{3,}/g, '\n\n');
            }
            descText.textContent = out;
          } catch (e) { descText.textContent = description; }
        })();
      } else {
        // Non-sheet features: also prune tornado when menu not selected (unless severe/flash)
        try {
          let out = description;
          const tornadoChecked = Array.from(document.querySelectorAll('#tornadoCheckboxList input[type=checkbox]:checked')).length > 0;
          const ftype = (polygonsById?.[alertId]?.properties?.type) || (polygonsById?.[alertId]?.properties?.event) || '';
          const isSevere = /severe thunderstorm/i.test(ftype || '');
          const isFlash = /flash flood/i.test(ftype || '');
          const isTornadoFeature = /tornado/i.test(ftype || '');
          if (!tornadoChecked && !isSevere && !isFlash && !isTornadoFeature) {
            out = out.replace(/(^|\n)\s*TORNADO(?:\s*\.{1,3})?[^\n]*\n?/ig, '$1');
            out = out.replace(/\(SELECTED PART OF THE TORNADO SECTION\)/ig, '');
            out = out.replace(/\n{3,}/g, '\n\n');
          }
          descText.textContent = out;
        } catch (e) { descText.textContent = description; }
      }
    } else if (alertId && alertId.startsWith('sheet-eyewatch-')) {
      // If it's a sheet Eye Watch and we don't have a description yet, fetch the specific sheet row cell.
      descText.textContent = "Loading description from sheet...";
      try {
        const idx = parseInt(alertId.split('-').pop(), 10);
        const sheetId = '1vlDnxcNf8PtsdmmgnUIKg5gqz4qJBmv07Qu5xLGbMsU'; // sheet used for Eye Watch polygons
        const apiKey = TEMPLATE_API_KEY; // reuse global API key
        const row = idx + 1;
        fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A${row}?key=${apiKey}`)
          .then(res => res.json())
          .then(obj => {
            const cell = obj?.values?.[0]?.[0] || '';
            let parsed = null;
            try { parsed = JSON.parse(cell); } catch (e) { /* ignore */ }
            let found = '';
            if (parsed && parsed.description) found = parsed.description;
            // attempt rudimentary regex extraction if cell is JSON-like string and parse failed
            if (!found && typeof cell === 'string') {
              const m = cell.match(/"description"\s*:\s*"([^"]*)"/i);
              if (m) found = m[1];
            }
            found = found || 'No description available.';

            // attempt county replacement asynchronously then cache and display
            (async () => {
              try {
                const poly = polygonsById?.[alertId]?.geometry?.coordinates?.[0] || null;
                if (poly) {
                  const counties = await countiesInPolygon(poly);
                  found = replaceCountyPlaceholderInText(found, counties);
                }
              } catch (e) { console.warn('County replacement failed', e); }
              // cache it for next time
              if (polygonsById && polygonsById[alertId] && polygonsById[alertId].properties) polygonsById[alertId].properties.description = found;
              descText.textContent = found;
            })();
          })
          .catch(() => { descText.textContent = 'No description available.'; });
      } catch (e) {
        descText.textContent = 'No description available.';
      }
    } else {
      descText.textContent = "No description available.";
    }
}

// Add back the close function and ensure the overlay's close button calls it
function closeAlertDescription() {
  const overlay = document.getElementById("alertDescriptionOverlay");
  if (!overlay) return;
  overlay.style.opacity = "0";
  overlay.style.pointerEvents = "none";
  setTimeout(() => { overlay.style.display = "none"; }, 260);
}

// --- Ensure CLOSE button on description overlay closes it ---
const closeDescBtn = document.getElementById('closeAlertDescriptionBtn');
if (closeDescBtn) {
  closeDescBtn.onclick = closeAlertDescription;
}

// NEW helper to close the summary panel (used by the new sheet popup CLOSE button)
function closeAlertSummary() {
  const panel = document.getElementById("alertSummaryPanel");
  if (panel) panel.style.display = "none";
  // STOP the flashing when closing
  stopPolygonFlash();
}

// NEW: helper to close the report summary panel
function closeReportSummary() {
  const panel = document.getElementById("reportSummaryPanel");
  if (panel) panel.style.display = "none";
}

// --- LSR (Local Storm Report) API integration and panel logic ---
let lsrFeatures = [];
let lsrMarkers = [];

window._lsrReportsEnabled = (() => {
  try {
    const settings = JSON.parse(localStorage.getItem('layerSettings') || '{}');
    if (settings.nwsReportsEnabled !== undefined) {
      return settings.nwsReportsEnabled;
    }
    return settings.nwsTornadoReportsEnabled === true ||
      settings.nwsWindReportsEnabled === true ||
      settings.nwsHailReportsEnabled === true;
  } catch {
    return false;
  }
})();

window.setLsrReportsEnabled = function(enabled) {
  window._lsrReportsEnabled = !!enabled;
  if (!window._lsrReportsEnabled) {
    lsrMarkers.forEach(m => m.remove && m.remove());
    lsrMarkers = [];
    return;
  }
  fetchAndDisplayLSR();
};

function fetchAndDisplayLSR() {
  if (window._lsrReportsEnabled === false) {
    lsrMarkers.forEach(m => m.remove && m.remove());
    lsrMarkers = [];
    return;
  }

  fetch('https://mesonet.agron.iastate.edu/geojson/lsr.geojson?hours=3')
    .then(res => res.json())
    .then(data => {
      lsrFeatures = (data.features || []);
      if (window._lsrReportsEnabled !== false) {
        addLSRMarkersToMap();
      }
    })
    .catch(console.error);
}

function addLSRMarkersToMap() {
  // Remove old markers
  lsrMarkers.forEach(m => m.remove && m.remove());
  lsrMarkers = [];
  if (!window.maplibregl || !window.map) return;
  lsrFeatures.forEach((feature, idx) => {
    const coords = feature.geometry && feature.geometry.coordinates;
    if (!coords || coords.length < 2) return;
    // Use typetext for color (fallback blue)
    const color = getLSRColor(feature.properties.typetext);
    const el = document.createElement('div');
    el.className = 'lsr-dot';
    el.style.width = '18px';
    el.style.height = '18px';
    el.style.borderRadius = '50%';
    el.style.background = `radial-gradient(circle at 60% 40%, ${color} 0%, #222 100%)`;
    el.style.border = '2px solid #fff';
    el.style.boxShadow = '0 0 8px 2px ' + color;
    el.style.cursor = 'pointer';
    el.title = feature.properties.typetext || 'Storm Report';
    el.onclick = () => showReportSummaryPanel(feature, color);
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([coords[0], coords[1]])
      .addTo(window.map);
    lsrMarkers.push(marker);
  });
}

function getLSRColor(typetext) {
  // Priority-ordered robust mapping for LSR types
  if (!typetext) return '#00bfff';
  const t = typetext.toLowerCase();
  // Priority: 1 = highest
  const lsrTypePriority = [
    { match: ['tornado'], color: '#ff0000' }, // 1
    { match: ['funnel cloud'], color: '#ff6767' }, // 1
    { match: ['hail'], color: '#e1ff00' },    // 2
    { match: ['waterspout'], color: '#e048ff' }, // 3
    { match: ['non-tstm', 'non tstm', 'non-thunderstorm', 'non thunderstorm'], color: '#ffaa00' }, // 4
    { match: ['tstm wnd gst'], color: '#ffaa00' }, // 5
    { match: ['tstm wnd dmg'], color: '#ffc757' }, // 5.9
    { match: ['wildfire'], color: '#663800' }, // 7
    { match: ['flash flood'], color: '#2dc100' }, // 6
    { match: ['flood'], color: '#4dff00' }, // 8
    { match: ['high sust winds'], color: '#ebffb0' }, // 9
    { match: ['rain'], color: '#50ffb3' }, // 10
    { match: ['landslide'], color: '#b2a684' }, // 10.5
    { match: ['avalanche'], color: '#0800ff' }, // 11
    { match: ['snow'], color: '#b0e0ff' }, // 12
    { match: ['marine tstm wind'], color: '#f9a4ff' }, // 13
  ];
  for (const type of lsrTypePriority) {
    for (const key of type.match) {
      if (t.includes(key)) return type.color;
    }
  }
  return '#00bfff'; // Default
}

function showReportSummaryPanel(feature, color) {
  const props = feature.properties || {};
  const typetext = props.typetext || 'Storm Report';
  let valid = props.valid || '';
  // Format valid time if present
  if (valid) {
    const d = new Date(valid);
    if (!isNaN(d)) {
      valid = d.toLocaleString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    }
  }
  let magnitude = props.magnitude || '';
  // Format magnitude: if typetext contains 'wnd', 'wind', or 'winds', append 'MPH'; otherwise, append 'INCH'
  if (magnitude) {
    const t = (typetext || '').toLowerCase();
    if (t.includes('wnd') || t.includes('wind') || t.includes('winds')) {
      magnitude = magnitude + ' MPH';
    } else
    if (t.includes('wildfire')) {
      magnitude = magnitude + ' acres';
    } else {
      magnitude = magnitude + ' INCH';
    }
  }
  const city = props.city || '';
  const source = props.source || '';
  const remarks = props.remark || '';
  // Compose panel content
  const content = `
    <div style="background: black;">
      <div class="lsr-gradient" style="--lsr-color:${color}">${typetext}</div>
      <div class="lsr-grey">${valid ? 'Valid: ' + valid : ''}</div>
      <div class="lsr-gradient" style="--lsr-color:${color}">${magnitude ? 'Magnitude: ' + magnitude : ''}</div>
      <div class="lsr-grey">${city ? 'Location: ' + city : ''}</div>
      <div class="lsr-gradient" style="--lsr-color:${color}">${source ? 'Source: ' + source : ''}</div>
      <div style="display: flex; justify-content: space-between; align-items:center; padding: 15px;">
        <button id="viewRemarksBtn" style="background:transparent;color:white;border:2px solid ${color};padding:8px 18px;border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:16px;cursor:pointer;font-weight:bold;">View Remarks</button>
        <button style="background:none;border:none;color:white;font-size:inherit;cursor:pointer;padding:0;font-family:'Bebas Neue',sans-serif;font-weight:bold;" onclick="closeReportSummary()">CLOSE</button>
      </div>
    </div>
  `;
  document.getElementById('reportSummaryTitle').textContent = '';
  document.getElementById('reportSummaryContent').innerHTML = content;
  document.getElementById('reportSummaryPanel').style.display = 'block';
  document.getElementById('reportSummaryPanel').style.background = 'none';
  document.getElementById('reportSummaryPanel').style.borderRadius = '0px';
  setTimeout(() => {
    const btn = document.getElementById('viewRemarksBtn');
    if (btn) {
      btn.onclick = function() {
        showLSRRemarks({ color, title: typetext + ' Remarks', remarks });
      };
    }
  }, 10);
}

// Show remarks overlay (like alert description)
function showLSRRemarks({ color, title, remarks }) {
  document.getElementById("alertDescriptionHeader").style.background = `linear-gradient(135deg, ${color} 0%, black 100%)`;
  document.getElementById("alertDescriptionHeader").textContent = title;
  const descText = document.getElementById("alertDescriptionText");
  descText.textContent = remarks || 'No remarks.';
  descText.style.background = "black";
  descText.style.fontFamily = "'Bebas Neue',sans-serif";
  descText.style.fontWeight = "bold";
  descText.style.fontSize = "18px";
  descText.style.maxHeight = "300px";
  descText.style.overflowY = "auto";
  descText.style.textAlign = "left";
  const overlay = document.getElementById("alertDescriptionOverlay");
  overlay.style.display = "flex";
  overlay.style.opacity = "0";
  setTimeout(() => { overlay.style.opacity = "1"; }, 10);
}

// Call this after map is initialized
if (window.map && window.maplibregl) {
  fetchAndDisplayLSR();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(fetchAndDisplayLSR, 2000);
  });
}

// Refresh LSR every 10 seconds
setInterval(fetchAndDisplayLSR, 10 * 1000);

// Add CSS for .lsr-dot if not present
if (!document.getElementById('lsr-dot-style')) {
  const style = document.createElement('style');
  style.id = 'lsr-dot-style';
  style.textContent = `.lsr-dot { transition: box-shadow 0.2s; } .lsr-dot:hover { box-shadow: 0 0 16px 4px #fff; }`;
  document.head.appendChild(style);
}

// NEW: helper to remove any editable polygon + helper markers (used by the X close button)
function removeEditablePolygon() {
  try {
    // remove center marker if present
    if (window._temporaryEyeWatchCenterMarker && typeof window._temporaryEyeWatchCenterMarker.remove === 'function') {
      try { window._temporaryEyeWatchCenterMarker.remove(); } catch(e){/*ignore*/ }
      window._temporaryEyeWatchCenterMarker = null;
    }

    // remove draggable helper markers if any
    if (Array.isArray(window.editablePolygonMarkers)) {
      window.editablePolygonMarkers.forEach(m => { try { m.remove(); } catch(e){} });
      window.editablePolygonMarkers = [];
    }

    // remove editable polygon layers and source
    const fillId = 'editable-polygon';
    const outlineId = 'editable-polygon-outline';
    if (map.getLayer(outlineId)) { try { map.removeLayer(outlineId); } catch(e){} }
    if (map.getLayer(fillId)) { try { map.removeLayer(fillId); } catch(e){} }
    
    if (map.getSource(fillId)) { try { map.removeSource(fillId); } catch(e){} }

    // remove storm tracker marker and line if present
    if (window._stormTracker && window._stormTracker.marker && typeof window._stormTracker.marker.remove === 'function') {
      try { window._stormTracker.marker.remove(); } catch(e){}
      window._stormTracker.marker = null;
    }
    // remove storm tracker 'x' marker if present
    if (window._stormTracker && window._stormTracker.xMarker && typeof window._stormTracker.xMarker.remove === 'function') {
      try { window._stormTracker.xMarker.remove(); } catch(e){}
      window._stormTracker.xMarker = null;
    }
    // remove any zoom handler we attached
    try {
      if (window._stormTracker && window._stormTracker.zoomHandler) {
        try { map.off('zoom', window._stormTracker.zoomHandler); } catch(e){}
        window._stormTracker.zoomHandler = null;
      }
    } catch (e) { /* ignore */ }
    try { if (map.getLayer('storm-tracker-line')) map.removeLayer('storm-tracker-line'); } catch(e){}
    try { if (map.getSource('storm-tracker-line')) map.removeSource('storm-tracker-line'); } catch(e){}
    try { if (map.getLayer('storm-tracker-line-tip')) map.removeLayer('storm-tracker-line-tip'); } catch(e){}
    try { if (map.getSource('storm-tracker-line-tip')) map.removeSource('storm-tracker-line-tip'); } catch(e){}
    window._stormTracker = null;

    // clear saved points
    window.editablePolygonPoints = [];
  } catch (e) {
    console.warn('removeEditablePolygon error', e);
  }
}

// Toggle WarnGen menu visibility with state tracking
const menu = document.getElementById('menu');
const closeWarnGenMenuBtn = document.getElementById('closeWarnGenMenuBtn');

window.eyeWatchMenuState = false;

if (closeWarnGenMenuBtn) {
  closeWarnGenMenuBtn.addEventListener('click', () => {
    window.eyeWatchMenuState = false;
    if (menu) menu.style.display = 'none';
    // remove the editable polygon (if any)
    try { removeEditablePolygon(); } catch (e) { /* ignore */ }
  });
} else {
  console.warn('closeWarnGenMenuBtn not found');
}

function updateTornadoWindSpeedVisibility() {
  const type = document.getElementById('alertType')?.value || '';
  const container = document.getElementById('tornadoWindSpeedContainer');
  if (!container) return;
  const showTypes = ['TEST', 'Observed Tornado', 'PDS Tornado', 'Tornado Emergency'];
  container.style.display = showTypes.includes(type) ? 'block' : 'none';
}

function makeCheckboxSectionSingleSelect(sectionSelector) {
  document.querySelectorAll(sectionSelector).forEach((section) => {
    const inputs = Array.from(section.querySelectorAll('input[type=checkbox]'));
    inputs.forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        inputs.forEach((other) => {
          if (other !== input) other.checked = false;
        });
      });
    });
  });
}

const alertTypeSelect = document.getElementById('alertType');
if (alertTypeSelect) {
  alertTypeSelect.addEventListener('change', updateTornadoWindSpeedVisibility);
}
updateTornadoWindSpeedVisibility();

makeCheckboxSectionSingleSelect('#hailThreatsList');
makeCheckboxSectionSingleSelect('#basisList');
makeCheckboxSectionSingleSelect('#tornadoCheckboxList');
makeCheckboxSectionSingleSelect('#menu .inline-checkbox');

// NEW: Toggle Alert Color Menu
const changeAlertColorsBtn = document.getElementById('changeAlertColorsBtn');
const alertColorMenu = document.getElementById('alertColorMenu');
const closeAlertColorMenuBtn = document.getElementById('closeAlertColorMenuBtn');

if (changeAlertColorsBtn) {
  changeAlertColorsBtn.addEventListener('click', () => {
    if (!alertColorMenu) return;
    alertColorMenu.style.display = alertColorMenu.style.display === 'block' ? 'none' : 'block';
    if (alertColorMenu.style.display === 'block') {
      try { populateAlertColorList(); } catch (e) { console.warn('populateAlertColorList failed', e); }
    }
  });
} else {
  console.warn('changeAlertColorsBtn not found');
}

if (closeAlertColorMenuBtn) {
  closeAlertColorMenuBtn.addEventListener('click', () => {
    if (alertColorMenu) alertColorMenu.style.display = 'none';
  });
} else {
  console.warn('closeAlertColorMenuBtn not found');
}

// NEW: Function to populate alert color list with all alert types
function populateAlertColorList() {
  const alertColorList = document.getElementById('alertColorList');
  alertColorList.innerHTML = ''; // Clear existing

  // Helper function to convert rgb() and named colors to hex
  function colorToHex(color) {
    if (!color) return '#000000';
    if (color.startsWith('#')) return color.toLowerCase();
    if (color.startsWith('rgb')) {
      const match = color.match(/\d+/g);
      if (!match || match.length < 3) return '#000000';
      const r = parseInt(match[0]).toString(16).padStart(2, '0');
      const g = parseInt(match[1]).toString(16).padStart(2, '0');
      const b = parseInt(match[2]).toString(16).padStart(2, '0');
      return '#' + r + g + b;
    }
    const colorMap = { 'red': '#ff0000', 'green': '#008000', 'lime': '#00ff00', 'cyan': '#00ffff' };
    return colorMap[color.toLowerCase()] || '#000000';
  }

  // Define all possible alert types and their default colors
  const alertTypes = [
    { event: 'Tornado Emergency', defaultColor: '#460095' },
    { event: 'PDS Tornado Warning', defaultColor: '#DE17C9' },
    { event: 'Observed Tornado Warning', defaultColor: '#8B0000' },
    { event: 'Radar Indicated Tornado Warning', defaultColor: '#ff0000' },
    { event: 'Flash Flood Emergency', defaultColor: '#008000' },
    { event: 'Considerable Flash Flood Warning', defaultColor: '#01b70e' },
    { event: 'Flash Flood Warning', defaultColor: '#00ff00' },
    { event: 'Destructive Severe Thunderstorm Warning', defaultColor: '#FF8100' },
    { event: 'Considerable Severe Thunderstorm Warning', defaultColor: '#B8860B' },
    { event: 'Severe Thunderstorm Warning', defaultColor: '#FFAA00' },
    { event: 'Snow Squall Warning', defaultColor: '#959595' },
    { event: 'Special Weather Statement', defaultColor: '#a06ad9' },
    { event: 'Marine Weather Statement', defaultColor: 'rgb(206, 198, 144)' },
    { event: 'Flood Advisory', defaultColor: '#9cffaa' },
    { event: 'Flood Warning', defaultColor: '#5cff72' },
    { event: 'Flood Watch', defaultColor: '#9fffff' },
    { event: 'Special Marine Warning', defaultColor: '#db47ff' },
    { event: 'Tornado Watch', defaultColor: '#ff5555' },
    { event: 'Severe Thunderstorm Watch', defaultColor: '#fdfd85' },
    { event: 'Flash Flood Watch', defaultColor: '#9fffff' },
    { event: 'Blizzard Warning', defaultColor: '#0000f6' },
    { event: 'Ice Storm Warning', defaultColor: '#6C2DA5' },
    { event: 'Winter Storm Warning', defaultColor: '#0073ff' },
    { event: 'Winter Weather Advisory', defaultColor: '#657fff' },
    { event: 'Lake Effect Snow Warning', defaultColor: '#008B8A' },
    { event: 'Avalanche Warning', defaultColor: '#36C6FF' },
    { event: 'Extreme Cold Warning', defaultColor: '#0A47FF' },
    { event: 'Freeze Warning', defaultColor: '#5F4B7C' },
    { event: 'Blizzard Watch', defaultColor: '#5a6bd9' },
    { event: 'Winter Storm Watch', defaultColor: '#75B6FF' },
    { event: 'Avalanche Watch', defaultColor: '#F4A261' },
    { event: 'Extreme Cold Watch', defaultColor: '#4DB6AC' },
    { event: 'Freeze Watch', defaultColor: '#00F2E6' },
    { event: 'Cold Weather Advisory', defaultColor: '#CFF8F0' },
    { event: 'Frost Advisory', defaultColor: '#6EA7FF' },
    { event: 'Dust Storm Warning', defaultColor: '#ffe9d1' },
    { event: 'Blowing Dust Warning', defaultColor: '#fff0d5' },
    { event: 'Dense Fog Advisory', defaultColor: '#6f7b84' },
    { event: 'Dense Fog (marine) Advisory', defaultColor: '#6d7d86' },
    { event: 'Dense Smoke Advisory', defaultColor: '#fff2a8' },
    { event: 'Dust Advisory', defaultColor: '#c4b55d' },
    { event: 'Blowing Dust Advisory', defaultColor: '#d1bd6c' },
    { event: 'Lake Wind Advisory', defaultColor: '#d6b681' },
    { event: 'Wind Advisory', defaultColor: '#d2b67d' },
    { event: 'Freezing Fog Advisory', defaultColor: '#008B8A' },
    { event: 'Air Stagnation Advisory', defaultColor: '#7d7d7d' },
    { event: 'Air Quality Alert', defaultColor: '#7d7d7d' },
    { event: 'Extreme Wind Warning', defaultColor: '#ff9a1a' },
    { event: 'Hurricane Force Wind Warning', defaultColor: '#c75b5b' },
    { event: 'High Wind Warning', defaultColor: '#efb700' },
    { event: 'Hurricane Force Wind Watch', defaultColor: '#8e44ff' },
    { event: 'High Wind Watch', defaultColor: '#ffc800' },
    // Tropical alerts (added if missing)
    { event: 'Storm Surge Warning', defaultColor: '#263447' },
    { event: 'Hurricane Warning', defaultColor: '#5a0d0d' },
    { event: 'Typhoon Warning', defaultColor: '#d63b4e' },
    { event: 'Tropical Storm Warning', defaultColor: '#d9534f' },
    { event: 'Storm Surge Watch', defaultColor: '#6d5ed6' },
    { event: 'Hurricane Watch', defaultColor: '#7a2b2b' },
    { event: 'Typhoon Watch', defaultColor: '#c97b7b' },
    { event: 'Tropical Storm Watch', defaultColor: '#e05a4f' },
    // Marine alerts / advisories
    { event: 'Heavy Freezing Spray Warning', defaultColor: '#39c5ff' },
    { event: 'Gale Warning', defaultColor: '#e8c7ff' },
    { event: 'Hazardous Seas Warning', defaultColor: '#4b4f5a' },
    { event: 'Storm Warning', defaultColor: '#4b5370' },
    { event: 'Storm Watch', defaultColor: '#f3d9a5' },
    { event: 'Gale Watch', defaultColor: '#f1bfc2' },
    { event: 'Hazardous Seas Watch', defaultColor: '#4b3b6d' },
    { event: 'Heavy Freezing Spray Watch', defaultColor: '#b57a75' },
    { event: 'Small Craft Advisory', defaultColor: '#e0c3f2' },
    { event: 'Freezing Spray Advisory', defaultColor: '#26c8ff' },
    { event: 'Brisk Wind Advisory', defaultColor: '#e9d3f0' },
    { event: 'Low Water Advisory', defaultColor: '#8b2f2f' },
    // Heat alerts
    { event: 'Extreme Heat Warning', defaultColor: '#d9006a' },
    { event: 'Extreme Heat Watch', defaultColor: '#5a0000' },
    { event: 'Heat Advisory', defaultColor: '#ff8a00' },
    { event: 'Fire Warning', defaultColor: '#a24f2f' },
    { event: 'Fire Weather Watch', defaultColor: '#ffd9a6' },
    { event: 'Red Flag Warning', defaultColor: '#ff956e' },
    // Additional 9.x alert types
    { event: 'Hazardous Weather Outlook', defaultColor: '#fffee0' },
    { event: 'Short Term Forecast', defaultColor: '#7a7a7a' },
    // Public Safety Alerts
    { event: 'Shelter In Place Warning', defaultColor: '#a1599f' },
    { event: 'Evacuation Immediate', defaultColor: '#9f5a7d' },
    { event: 'Civil Danger Warning', defaultColor: '#993333' },
    { event: 'Civil Emergency Message', defaultColor: '#884477' },
    { event: 'Law Enforcement Warning', defaultColor: '#664466' },
    { event: 'Local Area Emergency', defaultColor: '#5a5c63' },
    { event: '911 Telephone Outage', defaultColor: '#5f4f5f' }
  ];

  // Gather current colors preferring saved overrides, then map features, then defaults
  const currentColors = {};
  // saved overrides first
  Object.keys(window.savedAlertColors || {}).forEach(k => { currentColors[k] = colorToHex(window.savedAlertColors[k]); });
  // then existing features
  Object.values(polygonsById).forEach(feature => {
    const ev = feature.properties.displayEvent || feature.properties.event;
    if (!currentColors[ev]) currentColors[ev] = colorToHex(feature.properties.fillColor);
  });

  // Build UI rows for each alert type (color input + visibility + sound controls)
  alertTypes.forEach(type => {
    const eventName = type.event;
    const currentColor = currentColors[eventName] || type.defaultColor;

    const row = document.createElement('div');
    row.className = 'alert-color-item';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.margin = '6px 0';

    const label = document.createElement('div');
    label.textContent = eventName;
    label.style.flex = '1';
    label.style.color = '#fff';
    label.style.fontSize = '13px';
    label.style.marginRight = '8px';

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.alignItems = 'center';
    controls.style.flexWrap = 'wrap';

    // color input
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = colorToHex(currentColor);
    colorInput.dataset.event = eventName;
    colorInput.title = 'Change color for ' + eventName;
    colorInput.style.width = '36px';
    colorInput.style.height = '24px';

    // visibility toggle (checkbox)
    const visLabel = document.createElement('label');
    visLabel.style.display = 'inline-flex';
    visLabel.style.alignItems = 'center';
    visLabel.style.gap = '6px';
    visLabel.style.cursor = 'pointer';
    const visCheckbox = document.createElement('input');
    visCheckbox.type = 'checkbox';
    const currentVisibility = (window.savedAlertVisibility && (typeof window.savedAlertVisibility[eventName] !== 'undefined')) ? !!window.savedAlertVisibility[eventName] : isAlertVisibleByDefault(eventName);
    visCheckbox.checked = currentVisibility;
    visCheckbox.dataset.event = eventName;
    const visText = document.createElement('span');
    visText.textContent = currentVisibility ? 'On' : 'Off';
    visText.style.fontSize = '12px';
    visText.style.color = '#ddd';

    visLabel.appendChild(visCheckbox);
    visLabel.appendChild(visText);

    const soundSelect = document.createElement('select');
    soundSelect.dataset.event = eventName;
    soundSelect.style.fontSize = '12px';
    soundSelect.style.maxWidth = '160px';
    const currentSound = (window.savedAlertSounds && window.savedAlertSounds[eventName]) || 'none';
    ['none', 'Radar Omega Chime', 'Radar Omega Alarm'].forEach((soundOption) => {
      const option = document.createElement('option');
      option.value = soundOption;
      option.textContent = soundOption === 'none' ? 'No Sound' : soundOption;
      if (soundOption === currentSound) option.selected = true;
      soundSelect.appendChild(option);
    });

    const behavior = (window.savedAlertSoundBehavior && window.savedAlertSoundBehavior[eventName]) || {};

    const newLabel = document.createElement('label');
    newLabel.style.display = 'inline-flex';
    newLabel.style.alignItems = 'center';
    newLabel.style.gap = '4px';
    const newCheckbox = document.createElement('input');
    newCheckbox.type = 'checkbox';
    newCheckbox.checked = typeof behavior.playOnNew === 'boolean' ? behavior.playOnNew : true;
    newCheckbox.dataset.event = eventName;
    const newText = document.createElement('span');
    newText.textContent = 'New';
    newText.style.fontSize = '12px';
    newText.style.color = '#ddd';
    newLabel.appendChild(newCheckbox);
    newLabel.appendChild(newText);

    const updatedLabel = document.createElement('label');
    updatedLabel.style.display = 'inline-flex';
    updatedLabel.style.alignItems = 'center';
    updatedLabel.style.gap = '4px';
    const updatedCheckbox = document.createElement('input');
    updatedCheckbox.type = 'checkbox';
    updatedCheckbox.checked = typeof behavior.playOnUpdated === 'boolean' ? behavior.playOnUpdated : false;
    updatedCheckbox.dataset.event = eventName;
    const updatedText = document.createElement('span');
    updatedText.textContent = 'Updated';
    updatedText.style.fontSize = '12px';
    updatedText.style.color = '#ddd';
    updatedLabel.appendChild(updatedCheckbox);
    updatedLabel.appendChild(updatedText);

    controls.appendChild(colorInput);
    controls.appendChild(visLabel);
    controls.appendChild(soundSelect);
    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'alert-preview-btn';
    previewButton.textContent = 'Preview';
    previewButton.style.fontSize = '11px';
    previewButton.style.padding = '2px 6px';
    previewButton.style.cursor = 'pointer';
    controls.appendChild(previewButton);
    controls.appendChild(newLabel);
    controls.appendChild(updatedLabel);

    row.appendChild(label);
    row.appendChild(controls);
    alertColorList.appendChild(row);

    // wire events
    colorInput.addEventListener('input', (ev) => {
      const eName = ev.target.dataset.event;
      updateAlertColors(eName, ev.target.value);
    });

    visCheckbox.addEventListener('change', (ev) => {
      const eName = ev.target.dataset.event;
      const visible = !!ev.target.checked;
      visText.textContent = visible ? 'On' : 'Off';
      updateAlertVisibility(eName, visible);
    });

    soundSelect.addEventListener('change', (ev) => {
      const eName = ev.target.dataset.event;
      updateAlertSound(eName, ev.target.value);
    });
    previewButton.addEventListener('click', () => {
      playAlertSoundByName(soundSelect.value);
    });

    newCheckbox.addEventListener('change', (ev) => {
      const eName = ev.target.dataset.event;
      updateAlertSoundBehavior(eName, 'playOnNew', ev.target.checked);
    });

    updatedCheckbox.addEventListener('change', (ev) => {
      const eName = ev.target.dataset.event;
      updateAlertSoundBehavior(eName, 'playOnUpdated', ev.target.checked);
    });
  });

  // Add reset button
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'alert-reset-btn';
  resetBtn.textContent = 'Reset Colors';
  resetBtn.style.marginTop = '10px';
  resetBtn.style.width = '100%';
  resetBtn.addEventListener('click', () => {
    alertTypes.forEach(type => {
      const input = alertColorList.querySelector(`input[data-event="${type.event}"]`);
      if (input) {
        input.value = type.defaultColor;
        updateAlertColors(type.event, type.defaultColor);
        if (window.savedAlertColors && window.savedAlertColors[type.event]) delete window.savedAlertColors[type.event];
          if (window.savedAlertSounds && window.savedAlertSounds[type.event]) delete window.savedAlertSounds[type.event];
          if (window.savedAlertSoundBehavior && window.savedAlertSoundBehavior[type.event]) delete window.savedAlertSoundBehavior[type.event];
      }
    });
    saveSavedAlertColors();
      saveSavedAlertSounds();
      saveSavedAlertSoundBehavior();
  });
  alertColorList.appendChild(resetBtn);

  // Add event listeners to color inputs
  alertColorList.querySelectorAll('input[type="color"]').forEach(input => {
    input.addEventListener('change', (e) => {
      const event = e.target.getAttribute('data-event');
      const newColor = e.target.value;
      updateAlertColors(event, newColor);
    });
    input.addEventListener('input', (e) => {
      const event = e.target.getAttribute('data-event');
      const newColor = e.target.value;
      updateAlertColors(event, newColor);
    });
  });
}

// NEW: Function to update alert visibility dynamically
function updateAlertVisibility(event, visible) {
  window.savedAlertVisibility = window.savedAlertVisibility || {};
  window.savedAlertVisibility[event] = !!visible;
  saveSavedAlertVisibility();

  // Update polygonsById features for this event
  Object.values(polygonsById).forEach(feature => {
    const props = feature.properties || {};
    const ev = props.displayEvent || props.event || '';
    if (ev === event || normalizeEventKey(ev) === normalizeEventKey(event)) {
      if (typeof props._originalFillColor === 'undefined') props._originalFillColor = props.fillColor || '#00FFFF';
      if (visible) {
        props.fillColor = props._originalFillColor;
        if (props._originalOutlineColor) props.outlineColor = props._originalOutlineColor;
        props._visible = true;
      } else {
        // hide by making transparent
        props._originalOutlineColor = props.outlineColor || props._originalOutlineColor;
        props.fillColor = 'rgba(0,0,0,0)';
        props.outlineColor = 'rgba(0,0,0,0)';
        props._visible = false;
      }
    }
  });

  // refresh map source if present
  try {
    queueAlertPolygonRefresh();
  } catch (e) { /* ignore */ }

  // hide/show list items
  document.querySelectorAll('.nws-alert-item').forEach(item => {
    try {
      const id = item.getAttribute('data-alert-id');
      const f = polygonsById[id];
      const ev = f && (f.properties.displayEvent || f.properties.event);
      if (ev === event || normalizeEventKey(ev) === normalizeEventKey(event)) item.style.display = visible ? '' : 'none';
    } catch (e) {}
  });
}

// NEW: Function to update alert colors dynamically
function updateAlertColors(event, newColor) {
  // persist the user's choice
  window.savedAlertColors = window.savedAlertColors || {};
  window.savedAlertColors[event] = newColor;
  saveSavedAlertColors();
  
  // Update polygonsById
  Object.values(polygonsById).forEach(feature => {
    if ((feature.properties.displayEvent || feature.properties.event) === event || normalizeEventKey(feature.properties.displayEvent || feature.properties.event) === normalizeEventKey(event)) {
      // backup original color
      if (typeof feature.properties._originalFillColor === 'undefined') feature.properties._originalFillColor = feature.properties.fillColor || newColor;
      // if this event is currently disabled, keep it hidden
      const vis = (window.savedAlertVisibility && typeof window.savedAlertVisibility[event] !== 'undefined') ? !!window.savedAlertVisibility[event] : true;
      if (!vis) {
        feature.properties.fillColor = 'rgba(0,0,0,0)';
        feature.properties.outlineColor = 'rgba(0,0,0,0)';
        feature.properties._visible = false;
      } else {
        feature.properties.fillColor = newColor;
        feature.properties._visible = true;
      }
    }
  });

  // Refresh map layers with updated colors
  queueAlertPolygonRefresh();

  // Update alert list colors
  document.querySelectorAll('.nws-alert-item').forEach(item => {
    const alertId = item.getAttribute('data-alert-id');
    const feature = polygonsById[alertId];
    if (feature && ((feature.properties.displayEvent || feature.properties.event) === event || normalizeEventKey(feature.properties.displayEvent || feature.properties.event) === normalizeEventKey(event))) {
      const colorBox = item.querySelector('.nws-alert-color-box');
      if (colorBox) colorBox.style.background = (window.savedAlertVisibility && window.savedAlertVisibility[event] === false) ? 'transparent' : newColor;
      // hide item if disabled
      item.style.display = (window.savedAlertVisibility && window.savedAlertVisibility[event] === false) ? 'none' : '';
    }
  });
}

// Handle "Draw Polygon" button click
const drawPolygonBtn = document.getElementById('drawPolygonBtn');

drawPolygonBtn.addEventListener('click', () => {
  // Ensure any existing editable polygon/markers/trackers are removed
  try { removeEditablePolygon(); } catch (e) { /* ignore */ }

  // Create a marker at the center of the map
  const marker = new maplibregl.Marker({ draggable: true })
    .setLngLat(map.getCenter())
    .addTo(map);

  // make the center marker available for removal if user clicks X before dragging completes
  window._temporaryEyeWatchCenterMarker = marker;

  // Add a label to the marker
  const label = document.createElement('div');
  label.textContent = 'Drag me to the storm';
  label.style.position = 'absolute';
  label.style.top = '-25px';
  label.style.left = '-50px';
  label.style.background = 'rgba(0, 0, 0, 0)';
  label.style.color = 'white';
  label.style.padding = '5px 10px';
  label.style.borderRadius = '5px';
  label.style.fontFamily = "'Bebas Neue', sans-serif";
  label.style.fontSize = '14px';
  label.style.textAlign = 'center';

  marker.getElement().appendChild(label);

  // Replace marker with polygon on drag
  marker.on('dragend', () => {
    const lngLat = marker.getLngLat();
    // If user dropped the center marker onto an existing storm center icon,
    // prefer using that storm center as the pivot for the storm-tracker '✕'.
    try {
      if (map && typeof map.project === 'function' && typeof map.queryRenderedFeatures === 'function') {
        const pt = map.project([lngLat.lng, lngLat.lat]);
        const nearby = map.queryRenderedFeatures(pt) || [];
        for (const f of nearby) {
          const props = f.properties || {};
          // storm center features include storm_id, nexrad or posh properties
          if (props && (props.storm_id || props.nexrad || typeof props.posh !== 'undefined')) {
            window._stormTracker = window._stormTracker || {};
            // Always use the actual dropped marker location for the pivot so
            // the '✕' appears exactly where the user dropped the marker.
            window._stormTracker.pivot = { lng: lngLat.lng, lat: lngLat.lat };
            // Preserve the underlying feature reference if needed later
            window._stormTracker.pivotFeature = f;
            window._stormTracker.pivotFromDrop = true;
            break;
          }
        }
      }
    } catch (e) { console.warn('storm pivot detect failed', e); }

    // Ensure we have a pivot set even if no nearby storm center was detected
    try {
      window._stormTracker = window._stormTracker || {};
      if (!window._stormTracker.pivot) {
        window._stormTracker.pivot = { lng: lngLat.lng, lat: lngLat.lat };
        window._stormTracker.pivotFromDrop = true;
      }
      console.log('[StormTracker] pivot set from drop:', window._stormTracker.pivot, 'pivotFromDrop=', window._stormTracker.pivotFromDrop);
    } catch (e) { /* ignore */ }

    marker.remove();
    // clear temporary center marker reference (we removed it)
    window._temporaryEyeWatchCenterMarker = null;

    // Create an initial rectangle oriented to the northeast (visual NE using screen pixels)
    // Compute the rectangle size in real-world meters and convert to pixels so
    // the geographic footprint is consistent across zoom levels (avoids huge shapes).
    const angle = Math.PI / 6; // 30 degrees
    let basePoints;
    if (map && typeof map.project === 'function' && typeof map.unproject === 'function' && typeof map.getZoom === 'function') {
      // meters per pixel at current latitude & zoom (WebMercator approximation)
      const zoom = map.getZoom();
      const metersPerPixel = 156543.03392 * Math.cos(lngLat.lat * Math.PI / 180) / Math.pow(2, zoom);

      // Desired half-dimensions in meters (tweak these to change default size)
      const halfLengthMeters = 30000; // 30 km half-length -> 60 km total length
      const halfWidthMeters = 10000;  // 10 km half-width  -> 20 km total width

      // Convert meters to pixels at current zoom
      let halfLengthPx = halfLengthMeters / Math.max(1e-6, metersPerPixel);
      let halfWidthPx = halfWidthMeters / Math.max(1e-6, metersPerPixel);

      // Clamp pixel dims so shape remains visible but not absurd on extreme zooms
      halfLengthPx = Math.max(20, Math.min(halfLengthPx, 1200));
      halfWidthPx = Math.max(8, Math.min(halfWidthPx, 800));

      const centerPx = map.project([lngLat.lng, lngLat.lat]);
      const ux = Math.cos(angle), uy = Math.sin(angle);
      const vx = -Math.sin(angle), vy = Math.cos(angle);
      const p1px = { x: centerPx.x - ux * halfLengthPx - vx * halfWidthPx, y: centerPx.y - uy * halfLengthPx - vy * halfWidthPx };
      const p2px = { x: centerPx.x + ux * halfLengthPx - vx * halfWidthPx, y: centerPx.y + uy * halfLengthPx - vy * halfWidthPx };
      const p3px = { x: centerPx.x + ux * halfLengthPx + vx * halfWidthPx, y: centerPx.y + uy * halfLengthPx + vy * halfWidthPx };
      const p4px = { x: centerPx.x - ux * halfLengthPx + vx * halfWidthPx, y: centerPx.y - uy * halfLengthPx + vy * halfWidthPx };
      const l1 = map.unproject([p1px.x, p1px.y]);
      const l2 = map.unproject([p2px.x, p2px.y]);
      const l3 = map.unproject([p3px.x, p3px.y]);
      const l4 = map.unproject([p4px.x, p4px.y]);
      basePoints = [[l1.lng, l1.lat], [l2.lng, l2.lat], [l3.lng, l3.lat], [l4.lng, l4.lat]];
    } else {
      // Fallback: compute in lon/lat space (approximate)
      const halfLength = 0.12; // degrees
      const halfWidth = 0.05;  // degrees
      const ux = Math.cos(angle), uy = Math.sin(angle);
      const vx = -Math.sin(angle), vy = Math.cos(angle);
      const cx = lngLat.lng, cy = lngLat.lat;
      const p1 = [cx - ux * halfLength - vx * halfWidth, cy - uy * halfLength - vy * halfWidth];
      const p2 = [cx + ux * halfLength - vx * halfWidth, cy + uy * halfLength - vy * halfWidth];
      const p3 = [cx + ux * halfLength + vx * halfWidth, cy + uy * halfLength + vy * halfWidth];
      const p4 = [cx - ux * halfLength + vx * halfWidth, cy - uy * halfLength + vy * halfWidth];
      basePoints = [p1, p2, p3, p4];
    }

    // Persist initial editable polygon points in global for later JSON output
    // If the pivot was set from dropping the center marker, nudge the
    // polygon and tracker visuals up a few pixels so the '✕' sits visually
    // centered on the dropped marker and the line/dot/polygon clear the label.
    try {
      if (window._stormTracker && window._stormTracker.pivotFromDrop && map && typeof map.project === 'function' && typeof map.unproject === 'function') {
        const nudgePx = -12; // negative -> move up
        const shifted = basePoints.map(p => {
          try {
            const px = map.project([p[0], p[1]]);
            const newPx = [px.x, px.y + nudgePx];
            const lnglat = map.unproject(newPx);
            return [lnglat.lng, lnglat.lat];
          } catch (e) { return p; }
        });
        basePoints = shifted;
      }
    } catch (e) { /* ignore */ }

    window.editablePolygonPoints = basePoints.map(p => p.slice());

    // ensure global marker array exists and use it in this scope
    window.editablePolygonMarkers = window.editablePolygonMarkers || [];
    let markers = window.editablePolygonMarkers;

    const polygonId = 'editable-polygon';

    map.addSource(polygonId, {
      type: 'geojson',
      data: buildPolygonGeoJSON(basePoints)
    });

    // determine insertion point for fill (place beneath road/highway lines and other map features)
    // This matches the same insertion logic used for NWS alert polygons.
    let insertBeforeForFill = null;
    const layersForInsert = map.getStyle().layers || [];
    for (const layer of layersForInsert) {
      if (!insertBeforeForFill && (layer.type === 'line' || layer.type === 'symbol')) {
        insertBeforeForFill = layer.id;
      }
      if (insertBeforeForFill) break;
    }

    // Add polygon fill layer (insert below other map features)
    map.addLayer({
      id: polygonId,
      type: 'fill',
      source: polygonId,
      paint: {
        'fill-color': '#ff0000',
        'fill-opacity': 0.4,
        'fill-outline-color': '#ff0000'
      }
    }, insertBeforeForFill);

    // Add polygon outline layer on top
    map.addLayer({
      id: `${polygonId}-outline`,
      type: 'line',
      source: polygonId,
      paint: {
        'line-color': '#ff0000',
        'line-width': 4
      }
    });

    // Radar layer removed — no re-insert required

    rebuildMarkers();

    // --- Storm tracker: create a draggable dot and a line from polygon centroid to the dot.
    // Dragging the dot will rotate the polygon so its "tail" (west midpoint) aligns with the line.
    (function setupStormTracker() {
      window._stormTracker = window._stormTracker || { marker: null, sourceAdded: false, isDragging: false };

      function computeCentroid(points) {
        // If map projection is available, compute centroid in pixel space
        // (more visually accurate) and convert back to lon/lat. Otherwise
        // fall back to simple average of vertices.
        try {
          if (map && typeof map.project === 'function' && typeof map.unproject === 'function') {
            const px = points.map(p => map.project([p[0], p[1]]));
            // polygon centroid via signed area (shoelace) in pixel coordinates
            let A = 0, Cx = 0, Cy = 0;
            for (let i = 0; i < px.length; i++) {
              const j = (i + 1) % px.length;
              const xi = px[i].x, yi = px[i].y;
              const xj = px[j].x, yj = px[j].y;
              const cross = xi * yj - xj * yi;
              A += cross;
              Cx += (xi + xj) * cross;
              Cy += (yi + yj) * cross;
            }
            if (Math.abs(A) < 1e-6) {
              // degenerate: fallback to average
              let sx = 0, sy = 0;
              for (const p of points) { sx += Number(p[0]); sy += Number(p[1]); }
              return [sx / points.length, sy / points.length];
            }
            A = A / 2;
            Cx = Cx / (6 * A);
            Cy = Cy / (6 * A);
            const lnglat = map.unproject([Cx, Cy]);
            return [lnglat.lng, lnglat.lat];
          }
        } catch (e) {
          /* ignore and fallback */
        }

        // Fallback: arithmetic mean of vertices (previous behavior)
        let cx = 0, cy = 0;
        for (const p of points) { cx += Number(p[0]); cy += Number(p[1]); }
        return [cx / points.length, cy / points.length];
      }

      function getTailMidpoint(points) {
        // Choose the leftmost edge midpoint in screen (pixel) space if the map
        // is available so the "tail" corresponds to what the user sees.
        try {
          if (map && typeof map.project === 'function' && typeof map.unproject === 'function') {
            let minX = Infinity;
            let tailMidPx = null;
            let tailEdgeIndex = 0;
            for (let i = 0; i < points.length; i++) {
              const next = (i + 1) % points.length;
              const aPx = map.project([points[i][0], points[i][1]]);
              const bPx = map.project([points[next][0], points[next][1]]);
              const midPx = { x: (aPx.x + bPx.x) / 2, y: (aPx.y + bPx.y) / 2 };
              if (midPx.x < minX) { minX = midPx.x; tailMidPx = midPx; tailEdgeIndex = i; }
            }
            if (tailMidPx) {
              const midLngLat = map.unproject([tailMidPx.x, tailMidPx.y]);
              return { mid: [midLngLat.lng, midLngLat.lat], edgeIndex: tailEdgeIndex };
            }
          }
        } catch (e) {
          /* ignore and fallback */
        }

        // Fallback: choose the edge with smallest longitude midpoint (previous behavior)
        let minLng = Infinity;
        let tailMid = null;
        let tailEdgeIndex = 0;
        for (let i = 0; i < points.length; i++) {
          const next = (i + 1) % points.length;
          const mid = [(points[i][0] + points[next][0]) / 2, (points[i][1] + points[next][1]) / 2];
          if (mid[0] < minLng) { minLng = mid[0]; tailMid = mid; tailEdgeIndex = i; }
        }
        return { mid: tailMid, edgeIndex: tailEdgeIndex };
      }

      function rotatePointAround(center, point, angle) {
        try {
          // Prefer rotating in screen (pixel) space for visual consistency
          if (map && typeof map.project === 'function' && typeof map.unproject === 'function') {
            const cPx = map.project([center[0], center[1]]);
            const pPx = map.project([point[0], point[1]]);
            const dx = pPx.x - cPx.x;
            const dy = pPx.y - cPx.y;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            const rx = cPx.x + dx * cos - dy * sin;
            const ry = cPx.y + dx * sin + dy * cos;
            const lnglat = map.unproject([rx, ry]);
            return [lnglat.lng, lnglat.lat];
          }
        } catch (e) {
          console.warn('rotatePointAround (project) failed, falling back', e);
        }

        // Fallback: rotate in lon/lat space (approximate)
        const dx = point[0] - center[0];
        const dy = point[1] - center[1];
        const cos = Math.cos(angle), sin = Math.sin(angle);
        return [ center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos ];
      }

      function updateTrackerDotSizeForZoom(marker) {
        try {
          if (!marker || typeof marker.getElement !== 'function') return;
          const el = marker.getElement();
          const z = (map && typeof map.getZoom === 'function') ? map.getZoom() : 8;
          let size = 14 + Math.round((z - 7) * 1.8);
          size = Math.max(8, Math.min(40, size));
          el.style.width = size + 'px';
          el.style.height = size + 'px';
        } catch (e) { /* ignore */ }
      }

      function updateStormTrackerLine(markerLngLat) {
        try {
          if (!markerLngLat) return;

          const centroid = computeCentroid(basePoints);

          // compute adaptive style based on zoom
          const zoom = (map && typeof map.getZoom === 'function') ? map.getZoom() : 8;
          function computeLineStyle(z) {
            let width = Math.max(1, Math.round((z - 3) * 0.7));
            if (!isFinite(width)) width = 2;
            width = Math.min(12, width);
            let factor;
            if (z <= 6) factor = 0.35;
            else if (z <= 10) factor = 0.35 + (z - 6) * (0.55 / 4);
            else if (z <= 14) factor = 0.9 + (z - 10) * (0.7 / 4);
            else factor = 1.6;
            const dash1 = Math.max(1, Math.round(2 * (width / 2)));
            const dash2 = Math.max(2, Math.round(4 * (width / 2)));
            return { width, factor, dasharray: [dash1, dash2], opacity: 0.95 };
          }

          const style = computeLineStyle(zoom);

          // compute an endpoint in pixel space so the visual length scales with zoom
          // Prefer an intersection with the polygon boundary and then extend the
          // tip slightly outward so it appears outside the polygon (like the
          // reference image). Fall back to a scaled point if intersection fails.
          let end = [markerLngLat.lng, markerLngLat.lat];
          // default marker boundary point (falls back to marker center)
          let markerBoundaryLngLat = [markerLngLat.lng, markerLngLat.lat];
          if (map && typeof map.project === 'function' && typeof map.unproject === 'function') {
            // Use pivot as origin when available so intersections/ray use pivot->marker
            const st = window._stormTracker || {};
            const origin = (st && st.pivot) ? st.pivot : { lng: centroid[0], lat: centroid[1] };
            const originPx = map.project([origin.lng, origin.lat]);
            const mPx = map.project([markerLngLat.lng, markerLngLat.lat]);
            const dx = mPx.x - originPx.x;
            const dy = mPx.y - originPx.y;
            
            // Compute the point on the marker circle where the ray from centroid
            // meets the marker. This makes the line enter the marker at the
            // correct boundary point instead of passing through the center.
            try {
              const mk = window._stormTracker && window._stormTracker.marker;
              let sizePx = 14;
              if (mk && typeof mk.getElement === 'function') {
                const el = mk.getElement();
                // prefer inline style width if present, otherwise measured width
                const styledW = parseFloat(el.style && el.style.width) || 0;
                if (styledW > 0) sizePx = styledW;
                else {
                  const rect = el.getBoundingClientRect && el.getBoundingClientRect();
                  if (rect && rect.width) sizePx = rect.width;
                }
              }
              const radius = Math.max(2, sizePx / 2);
              const rx = dx, ry = dy;
              const rlen = Math.sqrt(rx * rx + ry * ry) || 1;
              const tEnter = Math.max(0, 1 - radius / rlen);
              const interPx = { x: originPx.x + rx * tEnter, y: originPx.y + ry * tEnter };
              const interLngLat = map.unproject([interPx.x, interPx.y]);
              markerBoundaryLngLat = [interLngLat.lng, interLngLat.lat];
            } catch (e) {
              markerBoundaryLngLat = [markerLngLat.lng, markerLngLat.lat];
            }

            let endPx = null;
            // If we have polygon points, try to find the nearest intersection of
            // the ray (centroid -> marker) with the polygon edges in pixel space
            // and then push the endpoint a few pixels outward.
            if (Array.isArray(basePoints) && basePoints.length >= 2) {
              try {
                const p = { x: originPx.x, y: originPx.y };
                const r = { x: dx, y: dy };
                const intersections = [];
                for (let i = 0; i < basePoints.length; i++) {
                  const a = basePoints[i];
                  const b = basePoints[(i + 1) % basePoints.length];
                  const aPx = map.project([a[0], a[1]]);
                  const bPx = map.project([b[0], b[1]]);
                  const q = { x: aPx.x, y: aPx.y };
                  const s = { x: bPx.x - aPx.x, y: bPx.y - aPx.y };
                  const denom = r.x * s.y - r.y * s.x;
                  if (Math.abs(denom) < 1e-6) continue;
                  const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / denom;
                  const u = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / denom;
                  if (t > 0 && u >= 0 && u <= 1) {
                    const ix = p.x + t * r.x;
                    const iy = p.y + t * r.y;
                    intersections.push({ t, x: ix, y: iy });
                  }
                }
                if (intersections.length) {
                  intersections.sort((A, B) => A.t - B.t);
                  const first = intersections[0];
                  const len = Math.sqrt(r.x * r.x + r.y * r.y) || 1;
                  const ux = r.x / len;
                  const uy = r.y / len;
                  const offsetPixels = Math.max(40, Math.round(style.width * 2.5));
                  endPx = { x: first.x + ux * offsetPixels, y: first.y + uy * offsetPixels };
                }
              } catch (e) {
                /* ignore and fallback */
              }
            }

            // Fallback: use scaled factor but ensure endpoint is at or beyond the
            // marker (factor >= 1.0) so the tip doesn't sit inside the polygon.
            if (!endPx) {
              const useFactor = Math.max(style.factor, 2.0);
              endPx = { x: originPx.x + dx * useFactor, y: originPx.y + dy * useFactor };
            }

            const epLngLat = map.unproject([endPx.x, endPx.y]);
            end = [epLngLat.lng, epLngLat.lat];
          } else {
            const dx = markerLngLat.lng - centroid[0];
            const dy = markerLngLat.lat - centroid[1];
            const useFactor = Math.max(style.factor, 2.0);
            end = [centroid[0] + dx * useFactor, centroid[1] + dy * useFactor];
          }

          // Use the computed marker boundary point so the line enters the dot
          // at its visible edge instead of aiming at the center.
          const coords = [[centroid[0], centroid[1]], [markerBoundaryLngLat[0], markerBoundaryLngLat[1]], end];

          // Create or update a small '✕' marker at the line tip. The marker is
          // always created (so it's visible), but we avoid moving it while the
          // user is actively rotating the polygon.
          try {
            window._stormTracker = window._stormTracker || {};
            const st = window._stormTracker;
            if (!st.xMarker) {
              const xEl = document.createElement('div');
              xEl.className = 'storm-tracker-x';
              xEl.style.width = '26px';
              xEl.style.height = '26px';
              xEl.style.borderRadius = '50%';
              xEl.style.background = '#ffdd00';
              xEl.style.color = '#222';
              xEl.style.display = 'flex';
              xEl.style.alignItems = 'center';
              xEl.style.justifyContent = 'center';
              xEl.style.fontWeight = '700';
              xEl.style.fontSize = '14px';
              xEl.style.boxShadow = '0 0 4px rgba(0,0,0,0.6)';
              xEl.style.border = '2px solid rgba(0,0,0,0.15)';
              xEl.style.pointerEvents = 'none';
              xEl.style.zIndex = '9999';
              xEl.textContent = '✕';
              try {
                  // Debug: log pivot/end so we can see why x may be misplaced
                  try { console.log('[StormTracker] updateStormTrackerLine pivot=', st.pivot, 'end=', end); } catch(e){}
                  // If a pivot was pre-set (e.g. user dropped onto a storm center), use it for the x marker position.
                  const xPos = (st && st.pivot) ? [st.pivot.lng, st.pivot.lat] : end;
                  const xm = new maplibregl.Marker({ element: xEl, draggable: false })
                    .setLngLat(xPos)
                    .addTo(map);
                  try { console.log('[StormTracker] xMarker created at', xPos); } catch (e) {}
                // Mark the x marker as fixed so it does not move on subsequent line updates
                st.xMarker = xm;
                st.xMarkerFixed = true;
                // Only set pivot from the created marker if one wasn't provided already
                if (!st.pivot) {
                  try {
                    const pos = xm.getLngLat && xm.getLngLat();
                    if (pos) st.pivot = { lng: pos.lng, lat: pos.lat };
                  } catch (e) { /* ignore */ }
                }
              } catch (e) { /* ignore marker add errors */ }
            } else {
              // Only update the x marker if it is not marked as fixed.
              if (!st.xMarkerFixed && st.xMarker && typeof st.xMarker.setLngLat === 'function') {
                try { st.xMarker.setLngLat(end); } catch (e) { /* ignore */ }
              }
            }
          } catch (e) { /* ignore x marker errors */ }

          // If a pivot exists (the '✕' marker), draw the line from the pivot to the tracker
          // so the pivot becomes the rotation center. Otherwise keep previous behavior
          // (centroid -> marker boundary -> end).
          let finalCoords = coords;
          try {
            const st = window._stormTracker || {};
            if (st.pivot) {
              finalCoords = [[st.pivot.lng, st.pivot.lat], [markerBoundaryLngLat[0], markerBoundaryLngLat[1]]];
            }
          } catch (e) { /* ignore pivot detection errors */ }

          if (map.getSource('storm-tracker-line')) {
            map.getSource('storm-tracker-line').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: finalCoords } });
            try {
              map.setPaintProperty('storm-tracker-line', 'line-width', style.width);
              map.setPaintProperty('storm-tracker-line', 'line-dasharray', style.dasharray);
              map.setPaintProperty('storm-tracker-line', 'line-opacity', style.opacity);
            } catch (e) { /* ignore paint updates if not supported */ }
          } else {
            map.addSource('storm-tracker-line', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
            map.addLayer({
              id: 'storm-tracker-line',
              type: 'line',
              source: 'storm-tracker-line',
              layout: {
                'line-cap': 'round',
                'line-join': 'round'
              },
              paint: {
                'line-color': '#ffdd00',
                'line-width': style.width,
                'line-dasharray': style.dasharray,
                'line-opacity': style.opacity
              }
            });
            window._stormTracker.sourceAdded = true;

            // attach zoom handler so the track updates when the map zooms
            try {
              window._stormTracker.zoomHandler = function () {
                try {
                  const m = window._stormTracker && window._stormTracker.marker;
                  if (!m) return;
                  updateStormTrackerLine(m.getLngLat());
                  try { updateTrackerDotSizeForZoom(m); } catch (e) { /* ignore */ }
                } catch (e) { /* ignore */ }
              };
              map.on('zoom', window._stormTracker.zoomHandler);
            } catch (e) { /* ignore */ }
          }

          // Also create/update a short solid tip segment so the dashed line
          // visually connects to the '✕' marker. This avoids a visible gap
          // caused by the dash pattern.
          try {
            const tipCoords = [[markerBoundaryLngLat[0], markerBoundaryLngLat[1]], end];
            if (map.getSource('storm-tracker-line-tip')) {
              map.getSource('storm-tracker-line-tip').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: tipCoords } });
              try {
                map.setPaintProperty('storm-tracker-line-tip', 'line-width', Math.max(1, style.width + 1));
                map.setPaintProperty('storm-tracker-line-tip', 'line-opacity', style.opacity);
              } catch (e) { /* ignore */ }
            } else {
              map.addSource('storm-tracker-line-tip', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: tipCoords } } });
              map.addLayer({
                id: 'storm-tracker-line-tip',
                type: 'line',
                source: 'storm-tracker-line-tip',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': '#ffdd00', 'line-width': Math.max(1, style.width + 1), 'line-opacity': style.opacity }
              });
            }
          } catch (e) { /* ignore tip layer errors */ }
        } catch (e) { console.warn('updateStormTrackerLine error', e); }
      }

      // Rotation state used to make rotation smooth and stable while dragging
      let _rotationState = { active: false, startBase: null, startCentroid: null, tailEdgeIndex: null, startAngle: 0 };

      // MPH selection table (5..100 step 5) — reduce max so center maps to ~40-50 MPH
      const _MPH_VALUES = Array.from({ length: 20 }, (_, i) => 5 * (i + 1));

      function computeStormTrackerSpeed(markerLngLat, centroid) {
        try {
          if (!markerLngLat) return null;
          // Normalize marker input (accept {lng,lat} or [lng,lat])
          const mkLng = (typeof markerLngLat.lng !== 'undefined') ? markerLngLat.lng : markerLngLat[0];
          const mkLat = (typeof markerLngLat.lat !== 'undefined') ? markerLngLat.lat : markerLngLat[1];

          if (!centroid) centroid = computeCentroid(basePoints);
          const ctLng = centroid[0], ctLat = centroid[1];

          // Attempt to find the polygon boundary intersection along the
          // centroid->marker ray (in pixel space). This yields a boundary
          // point closer to the marker and avoids using the full
          // centroid->marker distance for very long polygons.
          let distKm;
          const toRad = Math.PI / 180;
          const R = 6371; // Earth radius in km

          try {
            if (map && typeof map.project === 'function' && typeof map.unproject === 'function' && Array.isArray(basePoints) && basePoints.length >= 2) {
              const originPx = map.project([ctLng, ctLat]);
              const mPx = map.project([mkLng, mkLat]);
              const p = { x: originPx.x, y: originPx.y };
              const r = { x: mPx.x - originPx.x, y: mPx.y - originPx.y };
              const intersections = [];
              for (let i = 0; i < basePoints.length; i++) {
                const a = basePoints[i];
                const b = basePoints[(i + 1) % basePoints.length];
                const aPx = map.project([a[0], a[1]]);
                const bPx = map.project([b[0], b[1]]);
                const q = { x: aPx.x, y: aPx.y };
                const s = { x: bPx.x - aPx.x, y: bPx.y - aPx.y };
                const denom = r.x * s.y - r.y * s.x;
                if (Math.abs(denom) < 1e-6) continue;
                const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / denom;
                const u = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / denom;
                if (t > 0 && u >= 0 && u <= 1) {
                  intersections.push({ t, x: p.x + t * r.x, y: p.y + t * r.y });
                }
              }
              if (intersections.length) {
                intersections.sort((A, B) => A.t - B.t);
                const first = intersections[0];
                const inter = map.unproject([first.x, first.y]);
                const dLat = (mkLat - inter.lat) * toRad;
                const dLng = (mkLng - inter.lng) * toRad;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                          Math.cos(inter.lat * toRad) * Math.cos(mkLat * toRad) *
                          Math.sin(dLng / 2) * Math.sin(dLng / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                distKm = R * c;
              }
            }
          } catch (e) {
            /* ignore pixel-intersection failures and fallback to centroid */
          }

          // Fallback: use centroid distance if intersection wasn't available
          if (typeof distKm === 'undefined') {
            const dLat = (mkLat - ctLat) * toRad;
            const dLng = (mkLng - ctLng) * toRad;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(ctLat * toRad) * Math.cos(mkLat * toRad) *
                      Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            distKm = R * c;
          }

          // Map radial distance to an approximate speed (mph).
          const HORIZON_HOURS = 0.25; // 15 minutes
          const KM_TO_MILES = 0.621371;
          const MAX_SPEED = 200;
          let speed = (distKm / HORIZON_HOURS) * KM_TO_MILES;
          if (!isFinite(speed) || speed < 0) speed = 0;
          // Round to nearest 5 mph increment
          speed = Math.round(speed / 5) * 5;
          if (speed > MAX_SPEED) speed = MAX_SPEED;
          return speed;
        } catch (e) {
          console.warn('computeStormTrackerSpeed failed', e);
          return null;
        }
      }

      // expose for other functions (buildEyeWatchJSON uses it)
      window.computeStormTrackerSpeed = computeStormTrackerSpeed;

      // Allow external callers (radar animation) to nudge the storm-tracker
      // marker based on the current speed (MPH) and a time delta.
      // This function is intentionally attached to `window` so it can be
      // invoked from the animation controller when frames advance/rewind.
      window._updateStormTrackerAfterMove = function () {
        try {
          if (!window._stormTracker || !window._stormTracker.marker) return;
          try {
            updateStormTrackerLine(window._stormTracker.marker.getLngLat());
          } catch (e) { /* ignore if map update fails */ }
          try {
            const m = window._stormTracker.marker;
            const mph = computeStormTrackerSpeed(m.getLngLat());
            if (mph != null) {
              window._stormTracker = window._stormTracker || {};
              // honor a manual speed lock if present (do not overwrite user-set speed)
              if (!window._stormTracker.speedLocked) {
                window._stormTracker.currentSpeed = mph;
              }
              try {
                const ta = document.getElementById('editDescriptionTextarea');
                if (ta && /\(MPH\)/.test(ta.value) && (!window._stormTracker || !window._stormTracker.speedLocked)) {
                  ta.value = ta.value.replace(/\(MPH\)/g, `${mph} MPH`);
                }
              } catch (e) { /* ignore UI update errors */ }
              try {
                const pre = document.getElementById('geojson-pre');
                if (pre && pre.textContent) {
                  try {
                    const obj = JSON.parse(pre.textContent);
                    if (obj && obj.description && /\(MPH\)/.test(obj.description) && (!window._stormTracker || !window._stormTracker.speedLocked)) {
                      obj.description = obj.description.replace(/\(MPH\)/g, `${mph} MPH`);
                      pre.textContent = JSON.stringify(obj, null, 2);
                    }
                  } catch (e) { /* ignore parse errors */ }
                }
              } catch (e) { /* ignore */ }
            }
          } catch (e) { /* ignore */ }
        } catch (e) { /* ignore overall */ }
      };

      // Move the storm tracker marker by an amount implied by its speed and
      // a time delta. `deltaMs` is the absolute time difference in ms; if
      // `forward` is true the marker moves north (lat increases), otherwise
      // it moves south. Movement is simple north/south translation (no
      // bearing correction) using ~69 miles per degree latitude.
      window.advanceStormTrackerByTimeDelta = function (deltaMs, forward = true) {
        try {
          if (!window._stormTracker || !window._stormTracker.marker) return;
          if (!isFinite(deltaMs) || deltaMs === 0) return;
          const marker = window._stormTracker.marker;
          const pos = marker.getLngLat();
          let speed = (window._stormTracker.currentSpeed != null) ? window._stormTracker.currentSpeed : computeStormTrackerSpeed(pos);
          if (!isFinite(speed) || speed <= 0) return;
          const hours = Math.abs(deltaMs) / (1000 * 60 * 60);
          const miles = speed * hours;
          if (!isFinite(miles) || miles === 0) return;
          const latDelta = miles / 69.0; // approx miles per degree latitude
          const newLat = pos.lat + (forward ? 1 : -1) * latDelta;
          try {
            marker.setLngLat([pos.lng, newLat]);
          } catch (e) { /* ignore setLngLat errors */ }
          // update visuals and recompute speed preview
          try { if (typeof window._updateStormTrackerAfterMove === 'function') window._updateStormTrackerAfterMove(); } catch (e) { /* ignore */ }
        } catch (e) { console.warn('advanceStormTrackerByTimeDelta failed', e); }
      };

      // Convenience: called by external animation code with two ISO timestamps
      // or Date-compatible values. On the first call we snapshot the current
      // tracker position and compute the straight bearing from the polygon
      // centroid to the marker. Subsequent calls move the marker along that
      // fixed straight line by the distance implied by the (MPH) speed and
      // the time delta between frames. When steps stop (no calls for a
      // short period) the marker is restored to its original position.
      window.onRadarAnimationStep = function (oldTs, newTs) {
        try {
          if (!oldTs || !newTs) return;
          const a = (typeof oldTs === 'number') ? oldTs : new Date(oldTs).getTime();
          const b = (typeof newTs === 'number') ? newTs : new Date(newTs).getTime();
          if (!isFinite(a) || !isFinite(b)) return;
          const deltaMs = Math.abs(b - a);
          const forward = (b - a) >= 0;

          const st = window._stormTracker || {};
          const marker = st.marker;
          if (!marker) return;

          // don't animate while user is actively dragging
          if (st.isDragging) return;

          st.anim = st.anim || {};

          // initialize animation state on first step
          if (!st.anim.active) {
            try {
              st.anim.active = true;
              st.anim.savedPos = marker.getLngLat(); // {lng, lat}

              // compute centroid from editable polygon points if available
              let centroid = null;
              const pts = (Array.isArray(window.editablePolygonPoints) && window.editablePolygonPoints.length >= 3) ? window.editablePolygonPoints : null;
              if (pts) {
                let sumLng = 0, sumLat = 0, n = 0;
                for (const p of pts) { sumLng += Number(p[0]); sumLat += Number(p[1]); n++; }
                centroid = { lng: sumLng / n, lat: sumLat / n };
              } else {
                // fallback: use a point slightly west of marker so we still get a bearing
                const p = marker.getLngLat();
                centroid = { lng: p.lng - 0.001, lat: p.lat };
              }

              // compute initial bearing from centroid -> marker (radians)
              const toRad = Math.PI / 180;
              const φ1 = centroid.lat * toRad;
              const φ2 = marker.getLngLat().lat * toRad;
              const Δλ = (marker.getLngLat().lng - centroid.lng) * toRad;
              const y = Math.sin(Δλ) * Math.cos(φ2);
              const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
              const bearing = Math.atan2(y, x);
              st.anim.bearing = bearing; // radians
            } catch (e) {
              st.anim.active = false;
            }
          }

          // if animation state failed to initialize, fallback to simple north/south
          if (!st.anim.active) {
            window.advanceStormTrackerByTimeDelta(deltaMs, forward);
            return;
          }

          // compute step distance (miles) from speed
          const pos = marker.getLngLat();
          let speed = (st.currentSpeed != null) ? st.currentSpeed : computeStormTrackerSpeed(pos);
          if (!isFinite(speed) || speed <= 0) return;
          const hours = deltaMs / (1000 * 60 * 60);
          const miles = speed * hours;
          if (!isFinite(miles) || miles === 0) return;

          // move along the stored bearing by 'miles' distance using great-circle
          // destination formula. Use current marker position as the step origin
          // so movement accumulates smoothly.
          try {
            const toRad = Math.PI / 180;
            const toDeg = 180 / Math.PI;
            const R = 6371; // earth radius km
            const dKm = miles * 1.609344;
            const δ = dKm / R;
            const φ1 = pos.lat * toRad;
            const λ1 = pos.lng * toRad;
            // Reverse direction mapping so that 'rewind' moves the marker
            // along the stored bearing (up on the map) while 'forward'
            // (playing) moves the opposite direction.
            const θ = st.anim.bearing + (forward ? Math.PI : 0);

            const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
            const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
            const y2 = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
            const x2 = Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2);
            const λ2 = λ1 + Math.atan2(y2, x2);

            const newLat = φ2 * toDeg;
            const newLng = ((λ2 * toDeg + 540) % 360) - 180; // normalize
            try { marker.setLngLat([newLng, newLat]); } catch (e) { /* ignore */ }
            try { if (typeof window._updateStormTrackerAfterMove === 'function') window._updateStormTrackerAfterMove(); } catch (e) { /* ignore */ }
          } catch (e) { /* ignore movement errors */ }

          // reset/refresh the restore timer (restore to saved pos after inactivity)
          try {
            if (st.anim.restoreTimer) clearTimeout(st.anim.restoreTimer);
            st.anim.restoreTimer = setTimeout(() => {
              try {
                const m = st.marker;
                if (m && st.anim && st.anim.savedPos) {
                  try { m.setLngLat([st.anim.savedPos.lng, st.anim.savedPos.lat]); } catch (e) { /* ignore */ }
                  try { if (typeof window._updateStormTrackerAfterMove === 'function') window._updateStormTrackerAfterMove(); } catch (e) { /* ignore */ }
                }
              } catch (e) { /* ignore */ } finally {
                if (st.anim) {
                  st.anim.active = false;
                  if (st.anim.restoreTimer) { clearTimeout(st.anim.restoreTimer); st.anim.restoreTimer = null; }
                  st.anim.savedPos = null;
                  st.anim.bearing = null;
                }
              }
            }, 1300);
          } catch (e) { /* ignore timer errors */ }

        } catch (e) {
          /* ignore overall errors to avoid breaking animation */
        }
      };

      function alignPolygonToMarker(markerLngLat, commit = false) {
        try {
          if (!Array.isArray(basePoints) || basePoints.length < 3) return;

          // Use snapshot from dragstart when active to avoid re-selecting tail edge
          const useStart = _rotationState.active && Array.isArray(_rotationState.startBase);
          const startBase = useStart ? _rotationState.startBase : basePoints;
          const centroid = useStart && _rotationState.startCentroid ? _rotationState.startCentroid : computeCentroid(startBase);
          const tailIndex = (useStart && _rotationState.tailEdgeIndex != null) ? _rotationState.tailEdgeIndex : (getTailMidpoint(startBase) && getTailMidpoint(startBase).edgeIndex);
          const tailMid = (tailIndex != null) ? [(startBase[tailIndex][0] + startBase[(tailIndex + 1) % startBase.length][0]) / 2, (startBase[tailIndex][1] + startBase[(tailIndex + 1) % startBase.length][1]) / 2] : null;
          if (!tailMid) return;

          // Determine source polygon points (snapshot or current)
          const source = startBase;

          // Compute current reference angle by finding the polygon edge midpoint
          // whose direction from the centroid is closest to the line's bearing.
          // This ensures the visible edge/face of the polygon points along the
          // line direction rather than using a global PCA axis.
          let curAngle, tgtAngle;
          if (map && typeof map.project === 'function' && typeof map.unproject === 'function') {
            const centroidPx = map.project([centroid[0], centroid[1]]);
            const markerPx = map.project([markerLngLat.lng, markerLngLat.lat]);
            tgtAngle = Math.atan2(markerPx.y - centroidPx.y, markerPx.x - centroidPx.x);

            let bestDiff = Infinity;
            for (let i = 0; i < source.length; i++) {
              const j = (i + 1) % source.length;
              const aPx = map.project([source[i][0], source[i][1]]);
              const bPx = map.project([source[j][0], source[j][1]]);
              const midPx = { x: (aPx.x + bPx.x) / 2, y: (aPx.y + bPx.y) / 2 };
              const ang = Math.atan2(midPx.y - centroidPx.y, midPx.x - centroidPx.x);
              const diff = Math.atan2(Math.sin(ang - tgtAngle), Math.cos(ang - tgtAngle));
              if (Math.abs(diff) < bestDiff) { bestDiff = Math.abs(diff); curAngle = ang; }
            }
            if (typeof curAngle === 'undefined') {
              const vPx = map.project([source[0][0], source[0][1]]);
              curAngle = Math.atan2(vPx.y - centroidPx.y, vPx.x - centroidPx.x);
            }
          } else {
            tgtAngle = Math.atan2(markerLngLat.lat - centroid[1], markerLngLat.lng - centroid[0]);
            let bestDiff = Infinity;
            for (let i = 0; i < source.length; i++) {
              const j = (i + 1) % source.length;
              const mid = [(source[i][0] + source[j][0]) / 2, (source[i][1] + source[j][1]) / 2];
              const ang = Math.atan2(mid[1] - centroid[1], mid[0] - centroid[0]);
              const diff = Math.atan2(Math.sin(ang - tgtAngle), Math.cos(ang - tgtAngle));
              if (Math.abs(diff) < bestDiff) { bestDiff = Math.abs(diff); curAngle = ang; }
            }
            if (typeof curAngle === 'undefined') curAngle = Math.atan2(source[0][1] - centroid[1], source[0][0] - centroid[0]);
          }

          // If we are using a start snapshot, compute delta relative to the startAngle
          let baseAngle = (useStart && typeof _rotationState.startAngle === 'number') ? _rotationState.startAngle : curAngle;
          let delta = tgtAngle - baseAngle;
          while (delta > Math.PI) delta -= 2*Math.PI;
          while (delta <= -Math.PI) delta += 2*Math.PI;

          // Also consider flipping axis by 180° if that yields a smaller rotation
          let alt = tgtAngle - (baseAngle + Math.PI);
          while (alt > Math.PI) alt -= 2*Math.PI;
          while (alt <= -Math.PI) alt += 2*Math.PI;
          if (Math.abs(alt) < Math.abs(delta)) delta = alt;

          // Rotate from the startBase so rotations don't accumulate numerically
          const rotated = source.map(p => rotatePointAround(centroid, p, delta));

          // After rotation, translate the polygon so its centroid sits at the
          // midpoint of the visible storm-tracker line. Determine the visual
          // line endpoints: use pivot (if present) or polygon centroid as the
          // origin, and use the marker boundary (where the line meets the
          // marker) as the other endpoint. Prefer pixel-space math.
          let translated = rotated.map(p => p.slice());
          try {
            const st = window._stormTracker || {};
            if (map && typeof map.project === 'function' && typeof map.unproject === 'function') {
              const origin = (st && st.pivot) ? { lng: st.pivot.lng, lat: st.pivot.lat } : { lng: centroid[0], lat: centroid[1] };
              const originPx = map.project([origin.lng, origin.lat]);
              const markerPx = map.project([markerLngLat.lng, markerLngLat.lat]);

              // approximate marker boundary point (pixel) using marker element size
              let sizePx = 14;
              try {
                const mk = st.marker;
                if (mk && typeof mk.getElement === 'function') {
                  const el = mk.getElement();
                  const styledW = parseFloat(el.style && el.style.width) || 0;
                  if (styledW > 0) sizePx = styledW;
                  else {
                    const rect = el.getBoundingClientRect && el.getBoundingClientRect();
                    if (rect && rect.width) sizePx = rect.width;
                  }
                }
              } catch (e) { /* ignore */ }

              const radius = Math.max(2, sizePx / 2);
              const rx = markerPx.x - originPx.x;
              const ry = markerPx.y - originPx.y;
              const rlen = Math.sqrt(rx * rx + ry * ry) || 1;
              const tEnter = Math.max(0, 1 - radius / rlen);
              const markerBoundaryPx = { x: originPx.x + rx * tEnter, y: originPx.y + ry * tEnter };

              // midpoint between originPx and markerBoundaryPx
              const midPx = { x: (originPx.x + markerBoundaryPx.x) / 2, y: (originPx.y + markerBoundaryPx.y) / 2 };

              // compute translation vector in pixel space from current polygon centroid
              const centroidPxNow = map.project([centroid[0], centroid[1]]);
              const dx = midPx.x - centroidPxNow.x;
              const dy = midPx.y - centroidPxNow.y;

              translated = rotated.map(p => {
                const pPx = map.project([p[0], p[1]]);
                const newPx = [pPx.x + dx, pPx.y + dy];
                const lnglat = map.unproject(newPx);
                return [lnglat.lng, lnglat.lat];
              });
            } else {
              // Fallback: translate lon/lat so centroid moves halfway toward marker
              const dx = (markerLngLat.lng - centroid[0]) * 0.5;
              const dy = (markerLngLat.lat - centroid[1]) * 0.5;
              translated = rotated.map(p => [p[0] + dx, p[1] + dy]);
            }
          } catch (e) {
            translated = rotated.map(p => p.slice());
          }

          // Apply rotated+translated points; if commit==true we finalize, otherwise keep as current visual
          basePoints = translated.map(p => p.slice());
          rebuildPolygon();
          if (window._stormTracker && window._stormTracker.marker) updateStormTrackerLine(window._stormTracker.marker.getLngLat());
        } catch (e) { console.warn('alignPolygonToMarker error', e); }
      }

      function onTrackerDragStart() {
        try {
          // Indicate the storm tracker marker is being dragged.
          // We intentionally do NOT initialize any polygon rotation state here because
          // dragging the dot should NOT rotate the polygon — only the line and dot update.
          window._stormTracker = window._stormTracker || {};
          // clear any manual speed lock when the user starts dragging the tracker
          window._stormTracker.speedLocked = false;
          window._stormTracker.isDragging = true;

          // initialize speed preview (retain existing behavior)
          try {
            const m = window._stormTracker && window._stormTracker.marker;
            if (m) {
              const pos = m.getLngLat();
              const mph = computeStormTrackerSpeed(pos, computeCentroid(basePoints));
              if (mph != null) {
                  window._stormTracker = window._stormTracker || {};
                  if (!window._stormTracker.speedLocked) {
                    window._stormTracker.currentSpeed = mph;
                  }
                try {
                  const ta = document.getElementById('editDescriptionTextarea');
                  if (ta && /\(MPH\)/.test(ta.value) && (!window._stormTracker || !window._stormTracker.speedLocked)) ta.value = ta.value.replace(/\(MPH\)/g, `${mph} MPH`);
                } catch (e) { /* ignore UI update errors */ }
              }
            }
          } catch (e) { /* ignore */ }

          // If a pivot (the '✕' marker) exists, compute and store the pixel-space
          // radius so subsequent drags snap the dot to a circle around the pivot.
          try {
            const pivot = window._stormTracker && window._stormTracker.pivot;
            const m = window._stormTracker && window._stormTracker.marker;
            if (pivot && m && map && typeof map.project === 'function') {
              const pivotPx = map.project([pivot.lng, pivot.lat]);
              const mPx = map.project([m.getLngLat().lng, m.getLngLat().lat]);
              const dx = mPx.x - pivotPx.x;
              const dy = mPx.y - pivotPx.y;
              window._stormTracker.pivotRadiusPx = Math.sqrt(dx*dx + dy*dy) || 0;
              window._stormTracker.pivotCenterPx = pivotPx;
              // store current angle (screen pixel space) so we can enforce clockwise-only rotation
              try { window._stormTracker.prevAngle = Math.atan2(mPx.y - pivotPx.y, mPx.x - pivotPx.x); } catch (e) { window._stormTracker.prevAngle = null; }
              window._stormTracker.rotatingAroundPivot = true;
            } else {
              window._stormTracker.rotatingAroundPivot = false;
            }
          } catch (e) { window._stormTracker.rotatingAroundPivot = false; }
        } catch (e) { console.warn('onTrackerDragStart failed', e); }
      }

      function onTrackerDrag() {
        const m = window._stormTracker && window._stormTracker.marker;
        if (!m) return;
        let pos = m.getLngLat();
        // If rotating around a pivot, constrain the marker to the circle
        // centered at the pivot using the stored pixel radius.
        try {
          const st = window._stormTracker || {};
          if (st.rotatingAroundPivot && st.pivot && map && typeof map.project === 'function' && typeof map.unproject === 'function') {
            const pivotPx = st.pivotCenterPx || map.project([st.pivot.lng, st.pivot.lat]);
            const mPx = map.project([pos.lng, pos.lat]);

            // raw angle from pivot to current mouse position (pixel space)
            const rawAngle = Math.atan2(mPx.y - pivotPx.y, mPx.x - pivotPx.x);
            // current radius (allow radial motion and passing pivot)
            const r = Math.hypot(mPx.x - pivotPx.x, mPx.y - pivotPx.y) || 0;

            // enforce clockwise-only rotation by keeping a continuous prevAngle
            let prev = (typeof st.prevAngle === 'number') ? st.prevAngle : rawAngle;
            let candidate = rawAngle;
            // normalize candidate to be near prev (choose equivalent by +/- 2PI)
            while (candidate < prev - Math.PI) candidate += 2 * Math.PI;
            while (candidate > prev + Math.PI) candidate -= 2 * Math.PI;
            // if candidate moved CCW (angle decreased), clamp to prev; otherwise accept (clockwise)
            if (candidate < prev) {
              candidate = prev; // disallow counter-clockwise decrease
            } else {
              st.prevAngle = candidate; // accept new clockwise angle
            }

            // compute new pixel position using candidate angle and current radius
            const newPx = { x: pivotPx.x + Math.cos(candidate) * r, y: pivotPx.y + Math.sin(candidate) * r };
            const newLngLat = map.unproject([newPx.x, newPx.y]);
            try { m.setLngLat([newLngLat.lng, newLngLat.lat]); } catch (e) { /* ignore */ }
            pos = { lng: newLngLat.lng, lat: newLngLat.lat };
          }
        } catch (e) { /* ignore pivot snapping errors */ }

        updateStormTrackerLine(pos);
        // Do NOT rotate the polygon while dragging the tracker dot.
        try {
          const mph = computeStormTrackerSpeed(pos, _rotationState.startCentroid || computeCentroid(basePoints));
          if (mph != null) {
            window._stormTracker = window._stormTracker || {};
            if (!window._stormTracker.speedLocked) {
              window._stormTracker.currentSpeed = mph;
            }
            try {
              const ta = document.getElementById('editDescriptionTextarea');
              if (ta && /\(MPH\)/.test(ta.value) && (!window._stormTracker || !window._stormTracker.speedLocked)) {
                ta.value = ta.value.replace(/\(MPH\)/g, `${mph} MPH`);
              }
            } catch (e) { /* ignore UI update errors */ }
          }
        } catch (e) { /* ignore compute errors */ }
      }

      function onTrackerDragEnd() {
        try {
          const m = window._stormTracker && window._stormTracker.marker;
          // dragging finished
          if (window._stormTracker) window._stormTracker.isDragging = false;
          if (!m) return;
          const pos = m.getLngLat();
          // Do NOT rotate/commit polygon alignment on drag end. Polygon remains static.
          try {
            const mph = computeStormTrackerSpeed(pos, _rotationState.startCentroid || computeCentroid(basePoints));
            if (mph != null) {
              window._stormTracker = window._stormTracker || {};
              if (!window._stormTracker.speedLocked) {
                window._stormTracker.currentSpeed = mph;
              }
              // If modal textarea exists and still contains token, replace it
              try {
                const ta = document.getElementById('editDescriptionTextarea');
                if (ta && /\(MPH\)/.test(ta.value) && (!window._stormTracker || !window._stormTracker.speedLocked)) {
                  ta.value = ta.value.replace(/\(MPH\)/g, `${mph} MPH`);
                }
              } catch (e) { /* ignore */ }

              // update geojson preview if present
              try {
                const pre = document.getElementById('geojson-pre');
                if (pre && pre.textContent) {
                  try {
                    const obj = JSON.parse(pre.textContent);
                    if (obj && obj.description && /\(MPH\)/.test(obj.description) && (!window._stormTracker || !window._stormTracker.speedLocked)) {
                      obj.description = obj.description.replace(/\(MPH\)/g, `${mph} MPH`);
                      pre.textContent = JSON.stringify(obj, null, 2);
                    }
                  } catch (e) { /* not JSON or parse failed */ }
                }
              } catch (e) { /* ignore */ }
            }
          } catch (e) { /* ignore */ }
        } finally {
          try {
            // stop pivot rotation mode
            if (window._stormTracker) {
              // refresh pivot radius to current marker distance (so subsequent drags keep same radius)
              try {
                const st = window._stormTracker;
                if (st.pivot && st.marker && map && typeof map.project === 'function') {
                  const pivotPx = map.project([st.pivot.lng, st.pivot.lat]);
                  const mPx = map.project([st.marker.getLngLat().lng, st.marker.getLngLat().lat]);
                  st.pivotRadiusPx = Math.sqrt(Math.pow(mPx.x - pivotPx.x, 2) + Math.pow(mPx.y - pivotPx.y, 2)) || st.pivotRadiusPx;
                  st.pivotCenterPx = pivotPx;
                }
                window._stormTracker.rotatingAroundPivot = false;
              } catch (e) { /* ignore */ }
            }
          } catch (e) { /* ignore */ }
          _rotationState.active = false;
          _rotationState.startBase = null;
          _rotationState.startCentroid = null;
          _rotationState.tailEdgeIndex = null;
          _rotationState.startAngle = 0;
        }
      }

      const centroid = (basePoints && basePoints.length) ? computeCentroid(basePoints) : [lngLat.lng, lngLat.lat];
      // Position the tracker dot. If the pivot was set from dropping the center marker,
      // place the dot relative to that pivot so the '✕' will be centered on the dropped marker.
      let initialTrackerPos;
      try {
        const st = window._stormTracker || {};
        if (st.pivotFromDrop && st.pivot) {
          if (map && typeof map.project === 'function' && typeof map.unproject === 'function') {
            const pivotPx = map.project([st.pivot.lng, st.pivot.lat]);
            const offsetX = 40; // place dot to the right of pivot
            const offsetY = -12; // nudge up so dot/line/polygon clear label
            const targetPx = [pivotPx.x + offsetX, pivotPx.y + offsetY];
            const lnglat = map.unproject(targetPx);
            initialTrackerPos = { lng: lnglat.lng, lat: lnglat.lat };
          } else {
            initialTrackerPos = { lng: st.pivot.lng + 0.02, lat: st.pivot.lat };
          }
        } else {
          if (Array.isArray(basePoints) && basePoints.length) {
            const centroidLat = centroid[1];
            const intersects = [];
            for (let i = 0; i < basePoints.length; i++) {
              const a = basePoints[i];
              const b = basePoints[(i + 1) % basePoints.length];
              const latA = a[1], latB = b[1];
              const lngA = a[0], lngB = b[0];
              if (Math.abs(latA - latB) < 1e-12) {
                // horizontal edge: if it lies on the centroid latitude, add its endpoints' longitudes
                if (Math.abs(latA - centroidLat) < 1e-12) {
                  intersects.push(lngA, lngB);
                }
                continue;
              }
              if (centroidLat >= Math.min(latA, latB) && centroidLat <= Math.max(latA, latB)) {
                const t = (centroidLat - latA) / (latB - latA);
                const interLng = lngA + t * (lngB - lngA);
                intersects.push(interLng);
              }
            }

            if (intersects.length) {
              const interLng = Math.max.apply(null, intersects);
              // offset a few pixels inward so the dot sits visible just inside the polygon edge
              if (map && typeof map.project === 'function' && typeof map.unproject === 'function') {
                const px = map.project([interLng, centroidLat]);
                px.x += 40; // move 40 pixels right (outward) from the polygon boundary intersection
                const lnglat = map.unproject([px.x, px.y]);
                initialTrackerPos = { lng: lnglat.lng, lat: lnglat.lat };
              } else {
                initialTrackerPos = { lng: interLng - 0.01, lat: centroidLat };
              }
            } else {
              // fallback: place at eastmost edge midpoint (previous behavior)
              let maxLng = -Infinity;
              let eastMid = null;
              for (let i = 0; i < basePoints.length; i++) {
                const next = (i + 1) % basePoints.length;
                const mid = [(basePoints[i][0] + basePoints[next][0]) / 2, (basePoints[i][1] + basePoints[next][1]) / 2];
                if (mid[0] > maxLng) { maxLng = mid[0]; eastMid = mid; }
              }
              if (eastMid && map && typeof map.project === 'function' && typeof map.unproject === 'function') {
                const px = map.project([eastMid[0], eastMid[1]]);
                px.x += 80; // push fallback dot well outside the edge
                const lnglat = map.unproject([px.x, px.y]);
                initialTrackerPos = { lng: lnglat.lng, lat: lnglat.lat };
              } else if (eastMid) {
                initialTrackerPos = { lng: eastMid[0] + 0.02, lat: eastMid[1] };
              } else {
                initialTrackerPos = { lng: centroid[0] + 0.02, lat: centroid[1] };
              }
            }
          } else {
            initialTrackerPos = { lng: centroid[0] + 0.02, lat: centroid[1] };
          }
        }
      } catch (e) {
        initialTrackerPos = { lng: centroid[0] + 0.02, lat: centroid[1] };
      }
      const dot = document.createElement('div');
      dot.className = 'storm-tracker-dot';
      dot.style.width = '14px';
      dot.style.height = '14px';
      dot.style.borderRadius = '50%';
      dot.style.background = 'radial-gradient(circle at 35% 30%, #ffb84d 0%, #ff7a00 60%)';
      dot.style.border = '2px solid #fff';
      dot.style.boxShadow = '0 0 8px 2px rgba(255,122,0,0.6)';
      dot.style.cursor = 'grab';
      const trackerMarker = new maplibregl.Marker({ element: dot, draggable: true })
        .setLngLat([initialTrackerPos.lng, initialTrackerPos.lat])
        .addTo(map);
      trackerMarker.on('dragstart', onTrackerDragStart);
      trackerMarker.on('drag', onTrackerDrag);
      trackerMarker.on('dragend', onTrackerDragEnd);
      window._stormTracker.marker = trackerMarker;
      try {
        // Attempt to align the polygon so its tail/midpoint points toward the tracker
        // This makes the polygon and the line visually aligned after a drop.
        try { alignPolygonToMarker(trackerMarker.getLngLat()); } catch (e) { console.warn('initial alignPolygonToMarker failed', e); }
      } catch (e) { /* ignore */ }
      updateStormTrackerLine(trackerMarker.getLngLat());
      try { updateTrackerDotSizeForZoom(trackerMarker); } catch (e) { /* ignore */ }
    })();

    function midpoint(a, b) {
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }

    function buildPolygonGeoJSON(points) {
      const fullPoints = [];
      for (let i = 0; i < points.length; i++) {
        fullPoints.push(points[i]);
        const next = points[(i + 1) % points.length];
        fullPoints.push(midpoint(points[i], next));
      }
      return {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [fullPoints.concat([fullPoints[0]])]
        }
      };
    }

    function rebuildPolygon() {
      const geojson = buildPolygonGeoJSON(basePoints);
      if (map.getSource(polygonId)) map.getSource(polygonId).setData(geojson);
      // Update global copy whenever polygon changes
      window.editablePolygonPoints = basePoints.map(p => p.slice());
      rebuildMarkers();
    }

    function rebuildMarkers() {
      // remove existing helper markers
      markers.forEach(m => m.remove());
      markers.length = 0;

      const fullPoints = [];
      for (let i = 0; i < basePoints.length; i++) {
        fullPoints.push(basePoints[i]);
        const next = basePoints[(i + 1) % basePoints.length];
        fullPoints.push(midpoint(basePoints[i], next));
      }

      fullPoints.forEach((pt, i) => {
        const el = document.createElement('div');
        el.className = 'marker';
        el.style.width = '10px';
        el.style.height = '10px';
        el.style.backgroundColor = 'white';
        el.style.borderRadius = '0%';

        const m = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat(pt)
          .addTo(map);

        m.isMidpoint = i % 2 === 1;

        m.on('dragend', () => {
          const lngLat = m.getLngLat();
          const newPt = [lngLat.lng, lngLat.lat];

          if (m.isMidpoint) {
      const insertIndex = Math.floor(i / 2) + 1;
      basePoints.splice(insertIndex, 0, newPt);
          } else {
      const baseIndex = Math.floor(i / 2);
      basePoints[baseIndex] = newPt;
          }

          rebuildPolygon();
        });

        // track markers globally so close/X can remove them
        markers.push(m);
      });
    }
  }); // end marker.on('dragend')
}); // end drawPolygonBtn.addEventListener
 // --- Popup helpers for polygon clicks (added) ---
window._activeAlertMarker = null;
window._activeAlertMarkers = window._activeAlertMarkers || []; // array for stacked markers
window._nwsPopupHandlersInstalled = window._nwsPopupHandlersInstalled || false;
window._sheetPopupHandlersInstalled = window._sheetPopupHandlersInstalled || false;

function formatExpiresDisplay(expiresIso) {
  if (!expiresIso) return 'Expires: N/A';
  const now = new Date();
  const exp = new Date(expiresIso);
  if (isNaN(exp)) return 'Expires: N/A';
  const diffMinutes = Math.round((exp - now) / (1000 * 60));
  if (diffMinutes <= 0) return 'Expired';
  if (diffMinutes >= 60) {
    const hours = Math.floor(diffMinutes / 60);
    return `${hours} HOUR${hours > 1 ? 'S' : ''}`;
  }
  return `${diffMinutes} MINUTES LEFT`;
}

function getAlertPopupNote(props) {
  const desc = String(props.description || '');
  const eventTitle = String(props.displayEvent || props.event || '').toLowerCase();
  const parameters = props.parameters || {};
  let thunderstormDamageThreat = '';
  if (Array.isArray(parameters.thunderstormDamageThreat)) {
    thunderstormDamageThreat = String(parameters.thunderstormDamageThreat[0] || '').toLowerCase();
  } else if (typeof parameters.thunderstormDamageThreat === 'string') {
    thunderstormDamageThreat = parameters.thunderstormDamageThreat.toLowerCase();
  }

  const hasDestructiveThunderstormThreat = thunderstormDamageThreat.includes('destructive');
  const hasConsiderableThunderstormThreat = thunderstormDamageThreat.includes('considerable');
  const isDestructiveThunderstormEvent = /destructive\s+severe\s+thunderstorm|destructive\s+thunderstorm/i.test(eventTitle);
  const isConsiderableThunderstormEvent = /considerable\s+severe\s+thunderstorm|considerable\s+thunderstorm/i.test(eventTitle);
  const isDestructiveThunderstorm = hasDestructiveThunderstormThreat || isDestructiveThunderstormEvent;
  const isConsiderableThunderstorm = hasConsiderableThunderstormThreat || isConsiderableThunderstormEvent;

  const hasDangerText = /(?:extrem(?:e|ely|ly)\b[\s\S]{0,60}?danger(?:ous)?\b[\s\S]{0,60}?situation\b|danger(?:ous)?\b[\s\S]{0,60}?extrem(?:e|ely|ly)\b[\s\S]{0,60}?situation\b|situation\b[\s\S]{0,60}?extrem(?:e|ely|ly)\b[\s\S]{0,60}?danger(?:ous)?)/i.test(desc);

  if ((isDestructiveThunderstorm || isConsiderableThunderstorm) && hasDangerText) {
    return {
      text: 'THIS IS AN EXTREMELY DANGEROUS SITUATION',
      className: 'alert-note-pink'
    };
  }

  if (eventTitle.includes('pds tornado')) {
    return {
      text: 'THIS IS A PARTICULARLY DANGEROUS SITUATION',
      className: 'alert-note-pink'
    };
  }

  if (eventTitle.includes('tornado emergency')) {
    return {
      text: 'THIS IS AN EMERGENCY SITUATION',
      className: 'alert-note-purple'
    };
  }

  if (eventTitle.includes('flash flood emergency')) {
    return {
      text: 'THIS IS AN EMERGENCY SITUATION',
      className: 'alert-note-green'
    };
  }

  if (isDestructiveThunderstorm) {
    return {
      text: 'THIS IS A DESTRUCTIVE STORM',
      className: 'alert-note-red'
    };
  }

  return { text: '', className: '' };
}

function showAlertPopupForFeature(mapFeature, lngLat) {
  try {
    const id = mapFeature.properties && (mapFeature.properties.id || mapFeature.properties.sheetIndex !== undefined && mapFeature.properties.id) || null;
    const feature = (id && polygonsById[id]) ? polygonsById[id] : mapFeature;
    showStackedAlertPopups([feature], lngLat);
  } catch (e) {
    console.warn('showAlertPopupForFeature error', e);
  }
}

// NEW: remove any active alert markers (single or stacked)
function removeActiveAlertMarkers() {
  try {
    if (Array.isArray(window._activeAlertMarkers)) {
      window._activeAlertMarkers.forEach(m => { try { m.remove(); } catch(e){} });
      window._activeAlertMarkers.length = 0;
    }
    if (window._activeAlertMarker) {
      try { window._activeAlertMarker.remove(); } catch(e){}
      window._activeAlertMarker = null;
    }
  } catch (e) { console.warn('removeActiveAlertMarkers error', e); }
}

// NEW: build compact DOM element for a single alert row
function buildCompactPopupElement(feature) {
  const props = feature.properties || {};
  const title = props.displayEvent || props.event || 'Alert';
  const expiresLine = formatExpiresDisplay(props.expires || '');
  let color = props.fillColor || '#00FFFF';

  const desc = (props.description || '').toLowerCase();
  const titleLower = title.toLowerCase();
  const isTornadoOrFlashFlood = titleLower.includes('tornado warning') || 
                                titleLower.includes('flash flood warning') ||
                                titleLower.includes('tornado emergency') ||
                                titleLower.includes('flash flood emergency');

  if (desc.includes('this is an extremely dangerous situation') && !isTornadoOrFlashFlood) {
    color = 'rgb(255, 0, 200)';
  }

  const row = document.createElement('div');
  row.className = 'weatherwise-row';

  const colorBar = document.createElement('div');
  colorBar.className = 'color-bar';
  colorBar.style.background = color;

  const content = document.createElement('div');
  content.className = 'content';

  const titleEl = document.createElement('div');
  titleEl.className = 'title';
  titleEl.textContent = title;

  const expiresEl = document.createElement('div');
  expiresEl.className = 'expires-line';
  expiresEl.textContent = expiresLine ? `Expires ${expiresLine}` : '';

  content.appendChild(titleEl);
  
  let tagText = '';
  if (titleLower.includes('destructive severe thunderstorm warning')) {
    tagText = 'THIS IS A DESTRUCTIVE STORM';
  } else if (titleLower.includes('pds tornado warning')) {
    tagText = 'THIS IS A PARTICULALRY DANGEROUS SITUATION';
  } else if (titleLower.includes('tornado emergency') || titleLower.includes('flash flood emergency')) {
    tagText = 'THIS IS AN EMERGENCY SITUATION';
  } else if (titleLower.includes('dust storm warning') && desc.includes('this is a particularly dangerous situation')) {
    tagText = 'THIS IS A PARTICULARLY DANGEROUS SITUATION';
  }

  if (tagText) {
    const threatTag = document.createElement('div');
    threatTag.className = 'threat-tag dynamic-threat-tag';
    threatTag.textContent = tagText;
    threatTag.style.background = `linear-gradient(to right, black, ${color})`;
    threatTag.style.border = `2px solid ${color}`;
    content.appendChild(threatTag);
  }

  content.appendChild(expiresEl);

  const arrowEl = document.createElement('div');
  arrowEl.className = 'arrow';
  // Use SVG for the right arrow
  arrowEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

  row.appendChild(colorBar);
  row.appendChild(content);
  row.appendChild(arrowEl);

  // Click handler for this specific alert
  row.addEventListener('click', (ev) => {
    ev.stopPropagation();
    try {
      // Zoom to bounds or center without flashing the polygon
      // Zoom to bounds or center
      if (feature.geometry) {
        let coordinates = [];
        if (feature.geometry.type === "Polygon") {
          coordinates = feature.geometry.coordinates[0];
        } else if (feature.geometry.type === "MultiPolygon") {
          coordinates = feature.geometry.coordinates[0][0];
        }
        if (coordinates.length) {
          const bounds = coordinates.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
          map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 4000 });
        }
      }

      const alertId = (feature.properties && (feature.properties.parentAlertId || feature.properties.id)) || props.id || feature.id || null;
      // For popup rows, open the description overlay; do not open the summary panel.
      if (alertId) {
        showAlertDescriptionOnly(alertId, feature);
      } else {
        hideAlertSummaryPanel();
      }

      // Close the popup after clicking on the alert row
      removeActiveAlertMarkers();
    } catch (err) {
      console.warn('Error handling popup row click', err);
    }
  });

  return row;
}

// NEW: show multiple features stacked at a single lngLat
function showStackedAlertPopups(renderedFeatures, lngLat) {
  try {
    removeActiveAlertMarkers();
    if (!renderedFeatures || renderedFeatures.length === 0) return;

    // Deduplicate by ID and map to richer features
    const uniqueMap = new Map();
    renderedFeatures.forEach(f => {
      const pid = f.properties && (f.properties.id || (f.properties.sheetIndex !== undefined && f.properties.id)) || null;
      if (pid) {
        if (!uniqueMap.has(pid)) {
          uniqueMap.set(pid, polygonsById[pid] || f);
        }
      } else {
        uniqueMap.set(Math.random(), f);
      }
    });

    const enriched = Array.from(uniqueMap.values());

    // Sort by priority (highest first)
    enriched.sort((a, b) => (Number(b.properties?.priority) || 0) - (Number(a.properties?.priority) || 0));

    window._activeAlertMarkers = [];

    const wrapper = document.createElement('div');
    wrapper.className = 'weatherwise-popup';

    // We don't include radar station buttons. Just a close button in the footer.
    enriched.forEach((feat) => {
      // Stop flashing for all clicked polygons
      try { stopAutoAlertFlashForId(feat.properties && feat.properties.id); } catch (e) {}
      const rowEl = buildCompactPopupElement(feat);
      wrapper.appendChild(rowEl);
    });

    const footer = document.createElement('div');
    footer.className = 'weatherwise-footer';
    
    const closeBtn = document.createElement('div');
    closeBtn.className = 'weatherwise-close';
    closeBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeActiveAlertMarkers();
    });

    footer.appendChild(closeBtn);
    wrapper.appendChild(footer);

    const marker = new maplibregl.Marker({ element: wrapper, anchor: 'bottom', offset: [0, -10] })
      .setLngLat(lngLat)
      .addTo(map);

    window._activeAlertMarker = marker; // Keep backwards compatibility
    window._activeAlertMarkers.push(marker);

  } catch (e) {
    console.warn('showStackedAlertPopups error', e);
  }
}

// Insert the NWS layer click handlers right after the code that adds 'nws-alert-polygons-fill' and outlines.
// (This snippet should be placed immediately after the three map.addLayer(...) calls that add the NWS layers.)
// Unified safe click handler for alert polygons
function handleAlertPolygonClick(e, targetMap) {
  // Option A Toggle: If a popup is already open, do not open a new one.
  // We return early and let the background click handler close the existing popup.
  if (window._activeAlertMarkers && window._activeAlertMarkers.length > 0) {
    return;
  }

  try {
    let all = e.features || [];
    
    // Safely attempt to query both layers to get all overlapping features
    try {
      const layersToQuery = [];
      if (targetMap.getLayer('nws-alert-polygons-fill')) layersToQuery.push('nws-alert-polygons-fill');
      if (targetMap.getLayer('sheet-polygon-fill')) layersToQuery.push('sheet-polygon-fill');
      
      if (layersToQuery.length > 0) {
        const queried = targetMap.queryRenderedFeatures(e.point, { layers: layersToQuery });
        if (queried && queried.length > 0) {
          all = queried;
        }
      }
    } catch (err) {
      console.warn('Error querying overlapping layers:', err);
    }

    if (!all || all.length === 0) return;

    showStackedAlertPopups(all, e.lngLat);
    window._popupJustOpened = true;
    setTimeout(() => { window._popupJustOpened = false; }, 50);
  } catch (err) {
    console.warn('Error in handleAlertPolygonClick', err);
  }
}

if (!window._nwsPopupHandlersInstalled) {
  try {
    map.on('click', 'nws-alert-polygons-fill', function (e) {
      handleAlertPolygonClick(e, map);
    });
    map.on('mouseenter', 'nws-alert-polygons-fill', function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'nws-alert-polygons-fill', function () { map.getCanvas().style.cursor = ''; });
    window._nwsPopupHandlersInstalled = true;
  } catch (e) {
    console.warn('Failed to attach NWS polygon popup handlers', e);
  }
}

// Insert the sheet polygon handlers inside addSheetPolygonToMap after sheet-polygon-fill is added (or moved).
// Place this block right after the code that creates/moves 'sheet-polygon-fill'.
if (!window._sheetPopupHandlersInstalled && map.getLayer && map.getLayer('sheet-polygon-fill')) {
  try {
    map.on('click', 'sheet-polygon-fill', function (e) {
      handleAlertPolygonClick(e, map);
    });
    map.on('mouseenter', 'sheet-polygon-fill', function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'sheet-polygon-fill', function () { map.getCanvas().style.cursor = ''; });
    window._sheetPopupHandlersInstalled = true;
  } catch (e) {
    console.warn('Failed to attach sheet polygon popup handlers', e);
  }
}

// Close alert popups when clicking on the map background
function installBackgroundClickHandler(targetMap) {
  if (!targetMap || targetMap._backgroundClickHandlerInstalled) return;
  try {
    targetMap.on('click', function (e) {
      if (window._popupJustOpened) {
        // We just opened it in the layer handler, don't close it immediately
        return;
      }
      
      // If a popup is already open, ANY click on the map should close it
      if (window._activeAlertMarkers && window._activeAlertMarkers.length > 0) {
        removeActiveAlertMarkers();
      }
    });
    targetMap._backgroundClickHandlerInstalled = true;
  } catch (e) {
    console.warn('Failed to attach background map click handler', e);
  }
}

installBackgroundClickHandler(map);
if (window.mapWrapper && window.mapWrapper.dualMap) {
  installBackgroundClickHandler(window.mapWrapper.dualMap);
}

// --- Apply Warning Settings: assemble JSON and write to top-right box ---
// Attach handlers immediately (script is at end of body so DOM elements exist)
(function registerApplyHandlers() {
  const applyBtn = document.getElementById('applyWarningSettings');
  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      try {
        // Build the object but DO NOT output yet. Store pending object for editing.
        const pending = buildEyeWatchJSON();
        window._pendingEyeWatchJSON = pending;

        // Prefill the modal textarea with current description (or fallback summary)
        const ta = document.getElementById('editDescriptionTextarea');
        let desc = pending.description || pending.summary || window.eyeWatchDescriptionTemplate || '';

        // If description contains placeholders and we have polygon coords, attempt replacements
        try {
          const poly = pending.polygon || null;
          if (poly && Array.isArray(poly) && poly.length >= 3) {
            // County/Region placeholder replacement
            try {
              if (desc && /(County|Parish|Region) that is in the eye watch polygon/i.test(desc)) {
                const counties = await countiesInPolygon(poly);
                desc = replaceCountyPlaceholderInText(desc, counties);
                pending.description = desc;
              }
            } catch (e) {
              console.warn('County/Region replacement during Apply modal prepare failed', e);
            }

            // Towns placeholder replacement (existing behavior)
            try {
              if (desc && /\(\s*TOWNS?\s+THATS?\s+IMPACTED\s*\)|\(\s*TOWNS?\s+THAT\s+HAS\s+HIGH\s+WATER\s+SPOTS\s*\)/i.test(desc) || (desc && /\bTOWNS?\b.*\bIMPACT/i.test(desc))) {
                const townsLabel = await townsImpactedLabel(poly, { includeBBoxFallback: true, maxResults: 50000000000000000000000000000000000000 });
                if (townsLabel) {
                  desc = desc.replace(/\(\s*TOWNS?\s+THATS?\s+IMPACTED\s*\)/ig, townsLabel);
                  desc = desc.replace(/\(\s*TOWNS?\s+THAT\s+HAS\s+HIGH\s+WATER\s+SPOTS\s*\)/ig, townsLabel);
                  desc = desc.replace(/\(\s*TOWNS?\s*\)/ig, townsLabel);
                  pending.description = desc;
                }
              }
            } catch (e) {
              console.warn('Towns replacement during Apply modal prepare failed', e);
            }
          }
        } catch (e) {
          console.warn('Replacement during Apply modal prepare failed', e);
        }

        ta.value = desc;

              // If user selected an action from the sheet alerts UI, apply modifications
              try {
                const lastAction = window._lastSheetAction || null; // 'CONTINUE'|'UPGRADE'|'EXTEND'
                if (lastAction) {
                  if (lastAction === 'CONTINUE' || lastAction === 'UPGRADE') {
                    // change NEW -> CON in VTEC line(s)
                    try { desc = String(desc).replace(/(\/O\.)NEW\./g, '$1CON.'); } catch (e) {}
                    // replace county issuance text with remaining-in-effect wording
                    try { desc = desc.replace(/The Eye Watch has been issued for the following counties/ig, 'THIS EYE WATCH REMAINS IN EFFECT FOR THE FOLLOWING COUNTIES'); } catch(e){}
                  } else if (lastAction === 'EXTEND') {
                    try { desc = String(desc).replace(/(\/O\.)NEW\./g, '$1EXT.'); } catch (e) {}
                    try { desc = desc.replace(/The Eye Watch has been issued for the following counties/ig, 'This Eye Watch has been Extended for the following counties'); } catch(e){}
                  }
                } else {
                  // For new watches, ensure VTEC is NEW and text is "issued"
                  try { desc = String(desc).replace(/(\/O\.)CON\.|\/O\.EXT\./g, '$1NEW.'); } catch (e) {}
                  try { desc = desc.replace(/THIS EYE WATCH REMAINS IN EFFECT FOR THE FOLLOWING COUNTIES|This Eye Watch has been Extended for the following counties/ig, 'The Eye Watch has been issued for the following counties'); } catch(e){}
                }

                  // Update pending object and textarea value
                  pending.description = desc;
                  if (ta) ta.value = desc;
              } catch (e) { console.warn('apply modal sheet action adjustments failed', e); }

        // Show modal
        const modal = document.getElementById('editDescriptionModal');
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');

        // Focus the textarea for quick editing
        setTimeout(() => { ta.focus(); ta.setSelectionRange(0, ta.value.length); }, 50);

      } catch (e) {
        console.error('Error preparing editable Eye Watch JSON', e);
      }
    });
  }

  // Modal buttons
  const sendBtn = document.getElementById('sendDescriptionBtn');
  const cancelBtn = document.getElementById('cancelDescriptionBtn');
  const modal = document.getElementById('editDescriptionModal');
  const dragHandle = document.getElementById('editDescriptionDragHandle');
  const modalContent = document.getElementById('editDescriptionModalContent');

  // --- NEW: Make modal draggable ---
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  dragHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    const rect = modalContent.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    dragHandle.style.cursor = 'grabbing';
    // Remove dark overlay and allow map/other UI interaction
    modal.style.background = 'rgba(0,0,0,0)';
    modal.style.pointerEvents = 'none';
    modalContent.style.pointerEvents = 'auto';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging || modal.style.display !== 'flex') return;
    e.preventDefault();
    
    let x = e.clientX - dragOffsetX;
    let y = e.clientY - dragOffsetY;
    
    // Get modal dimensions
    const rect = modalContent.getBoundingClientRect();
    const modalWidth = rect.width;
    const modalHeight = rect.height;
    
    // Constrain to window bounds
    const minX = 0;
    const maxX = window.innerWidth - modalWidth;
    const minY = 0;
    const maxY = window.innerHeight - modalHeight;
    
    x = Math.max(minX, Math.min(x, maxX));
    y = Math.max(minY, Math.min(y, maxY));
    
    modalContent.style.position = 'fixed';
    modalContent.style.left = x + 'px';
    modalContent.style.top = y + 'px';
    modalContent.style.margin = '0';
    modalContent.style.transform = 'none';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    dragHandle.style.cursor = 'grab';
  });

  function restoreModalBackdrop() {
    modal.style.background = 'rgba(0,0,0,0.75)';
    modal.style.pointerEvents = '';
    modalContent.style.pointerEvents = 'auto';
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        restoreModalBackdrop();
      }
      // clear pending
      window._pendingEyeWatchJSON = null;
      // clear last action
      window._lastSheetAction = null;
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      try {
        const ta = document.getElementById('editDescriptionTextarea');
        const edited = ta ? ta.value : '';
        const pending = window._pendingEyeWatchJSON || buildEyeWatchJSON();

        // Replace description with edited text
        pending.description = edited;

        // Hide modal
        if (modal) {
          modal.style.display = 'none';
          modal.setAttribute('aria-hidden', 'true');
          restoreModalBackdrop();
        }

        // Send to JSON output (centered modal)
        const box = document.getElementById('top-right-square');
        if (box) {
          const pre = box.querySelector('#geojson-pre') || document.createElement('pre');
          pre.id = 'geojson-pre';
          pre.textContent = JSON.stringify(pending, null, 2);
          if (!box.contains(pre)) box.appendChild(pre);
          box.classList.add('expanded');
          box.setAttribute('aria-hidden', 'false');
        }

        // cleanup pending
        window._pendingEyeWatchJSON = null;
        // clear last action so it doesn't affect future new watches
        window._lastSheetAction = null;
      } catch (e) {
        console.error('Error sending edited Eye Watch JSON', e);
      }
    });
  }

  const copyBtn = document.getElementById('copy-geojson-btn');
  const feedback = document.getElementById('copy-feedback');

  // Cancel button wiring
  const closeBtn = document.getElementById('close-geojson-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const box = document.getElementById('top-right-square');
      if (box) {
        box.classList.remove('expanded');
        box.setAttribute('aria-hidden', 'true');
      }
    });
  }

  if (copyBtn) {
    // prevent copy button clicks from toggling the box (stop propagation)
    copyBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const box = document.getElementById('top-right-square');
      const pre = box.querySelector('#geojson-pre');
      const text = pre ? pre.textContent : '';
      if (!text) return;
      // Use clipboard API with fallback
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          if (feedback) {
            feedback.style.display = 'block';
            setTimeout(() => { feedback.style.display = 'none'; }, 1200);
          }
        }).catch((err) => {
          console.error('Clipboard write failed', err);
        });
      } else {
        // fallback: create temp textarea
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); if (feedback) { feedback.style.display = 'block'; setTimeout(()=>{ feedback.style.display='none'; }, 1200); } } catch(e){ console.error('Fallback copy failed', e); }
        ta.remove();
      }
    });
  }

  // New: close on Escape key when expanded or modal shown; allow ArrowUp/ArrowDown
  // to adjust the storm speed (MPH) while the edit modal is open.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      const box = document.getElementById('top-right-square');
      if (box && box.classList.contains('expanded')) {
        box.classList.remove('expanded');
        box.setAttribute('aria-hidden', 'true');
      }
      const modal = document.getElementById('editDescriptionModal');
      if (modal && modal.style.display === 'flex') {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        window._pendingEyeWatchJSON = null;
        // Restore backdrop and pointer events for next open
        restoreModalBackdrop();
      }
      return;
    }

    // When the edit modal is open, allow ArrowUp/ArrowDown to increase/decrease MPH.
    const modal = document.getElementById('editDescriptionModal');
    if (modal && modal.style.display === 'flex' && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      ev.preventDefault();
      const STEP = 5;
      let cur = 0;
      if (window._stormTracker && typeof window._stormTracker.currentSpeed !== 'undefined' && window._stormTracker.currentSpeed !== null) {
        cur = Number(window._stormTracker.currentSpeed) || 0;
      } else if (window._stormTracker && window._stormTracker.marker && typeof window.computeStormTrackerSpeed === 'function') {
        try {
          const marker = window._stormTracker.marker.getLngLat();
          let pts = (window.editablePolygonPoints && Array.isArray(window.editablePolygonPoints)) ? window.editablePolygonPoints : [];
          let centroidForSpeed = null;
          if (pts.length) {
            let sx = 0, sy = 0;
            for (const p of pts) { sx += Number(p[0]); sy += Number(p[1]); }
            centroidForSpeed = [sx / pts.length, sy / pts.length];
          }
          cur = Number(window.computeStormTrackerSpeed(marker, centroidForSpeed)) || 0;
        } catch (e) { cur = 0; }
      }

      if (ev.key === 'ArrowUp') cur = Math.min(cur + STEP, 200);
      else cur = Math.max(0, cur - STEP);

      window._stormTracker = window._stormTracker || {};
      window._stormTracker = window._stormTracker || {};
      window._stormTracker.currentSpeed = cur;
      // mark this speed as manually set so computed updates don't overwrite it
      window._stormTracker.speedLocked = true;

      // Update textarea (replace token or numeric MPH)
      const ta = document.getElementById('editDescriptionTextarea');
      if (ta) {
        if (/\(MPH\)/.test(ta.value)) {
          ta.value = ta.value.replace(/\(MPH\)/g, `${cur} MPH`);
        } else if (/\d+\s*MPH/i.test(ta.value)) {
          ta.value = ta.value.replace(/\d+\s*MPH/i, `${cur} MPH`);
        }
      }

      // Update geojson preview if present
      const pre = document.getElementById('geojson-pre');
      if (pre && pre.textContent) {
        try {
          const obj = JSON.parse(pre.textContent);
          if (obj && obj.description) {
            if (/\(MPH\)/.test(obj.description)) obj.description = obj.description.replace(/\(MPH\)/g, `${cur} MPH`);
            else if (/\d+\s*MPH/i.test(obj.description)) obj.description = obj.description.replace(/\d+\s*MPH/i, `${cur} MPH`);
            pre.textContent = JSON.stringify(obj, null, 2);
          }
        } catch (e) { /* ignore preview update errors */ }
      }
    }
  });
})();

// Build the JSON payload following the requested structure
function buildEyeWatchJSON() {
  const id = 'alert-' + Date.now();
  const issuedAt = new Date().toISOString();
  const expiresInMinutes = document.getElementById('expiration').value || '5';
  let expires = new Date(Date.now() + parseInt(expiresInMinutes, 10) * 60000).toISOString();

  // If a sheet polygon is selected in the Sheet Alerts dropdown, prefer
  // its explicit expires value (from the Google Sheet) for the description
  // 'Until' replacement so we don't overwrite the sheet-provided expiry.
  // However, if the user chose to EXTEND the alert or issue a NEW alert via the sheet Action
  // dialog, do NOT preserve the sheet expiry — use the UI expiration instead.
  try {
    const lastAction = window._lastSheetAction || null;
    if (lastAction === 'CONTINUE' || lastAction === 'UPGRADE') {
      const sel = document.getElementById('sheet-alerts-select');
      const selVal = sel && sel.value;
      if (selVal && String(selVal).startsWith('sheet-eyewatch-') && polygonsById && polygonsById[selVal]) {
        const pf = polygonsById[selVal];
        const sheetExpires = pf && pf.properties && pf.properties.expires;
        if (sheetExpires) {
          const parsed = new Date(sheetExpires);
          if (!isNaN(parsed.getTime())) {
            expires = parsed.toISOString();
          }
        }
      }
    }
  } catch (e) { /* ignore and keep UI expiration */ }
  // local description variable (avoid accidental global)
  let description = '';

  const type = document.getElementById('alertType').value || 'TEST';
  const name = document.getElementById('name').value || '';

  // Hail selection and max size mapping
  const hailSelected = Array.from(document.querySelectorAll('#hailThreatsList input[type=checkbox]:checked')).map(i => i.value);
  const hailSizeMap = {
    penny: 0.75, nickel: 0.875, quarter: 1, halfDollar: 1.25, pingPong: 1.5,

    golfBall: 1.75, twoInch: 2, tennisBall: 2.5, baseball: 2.75, apple: 3, softball: 4, dvd: 5
  };
  const hailMax = hailSelected.length ? Math.max(...hailSelected.map(s => hailSizeMap[s] || 0)) : 0;
  
  // Mapping for readable hail names
  const hailNameMap = {
    penny: 'Penny Size Hail',
    nickel: 'Nickel Size Hail',
    quarter: 'Quarter Size Hail',
    halfDollar: 'Half Dollar Size Hail',
    pingPong: 'Ping Pong Ball Size Hail',
    golfBall: 'Golf Ball Size Hail',
    twoInch: 'Two Inch Hail',
    tennisBall: 'Tennis Ball Size Hail',
    baseball: 'Baseball Size Hail',
    apple: 'Apple Size Hail',
    softball: 'Softball Size Hail',
    dvd: 'DVD Size Hail'
  };
  const hailReadable = hailSelected.map(s => hailNameMap[s]).filter(Boolean).join(', ');

  // Wind selections (inline-checkbox group)
  const windSelectedRaw = Array.from(document.querySelectorAll('#menu .inline-checkbox input[type=checkbox]:checked')).map(i => i.value);
  const windSelected = windSelectedRaw.map(v => parseInt(v, 10)).filter(n => !isNaN(n));
  const maxWindGust = windSelected.length ? Math.max(...windSelected) : 0;

  // Basis and tornado possible
  const basis = Array.from(document.querySelectorAll('#basisList input[type=checkbox]:checked')).map(i => i.value);
  // Clean basis: remove "Reported" and "Confirmed"
  const cleanedBasis = basis.map(b => b.replace(/ Reported/g, '').replace(/ Confirmed/g, ''));
  const basisJoined = cleanedBasis.length ? cleanedBasis.join(' and ') : '';

  const tornado = Array.from(document.querySelectorAll('#tornadoCheckboxList input[type=checkbox]:checked')).map(i => i.value) || '';
  const tornadoWindSpeed = document.getElementById('tornadoWindSpeed')?.value || '';
  const confidence = document.getElementById('confidence').value || '';

  // Polygon: grab persisted editable polygon points (basePoints are [lng, lat])
  const polygon = (window.editablePolygonPoints || []).map(p => [p[1], p[0]]); // convert to [lat, lng] as in example

  const priority = 120;

  // Build an HTML summary similar to the example
  const summary = `<strong>Eye Watch</strong><br/>
    Type: ${type}<br/>
    Name: ${name}<br/>
    Hail: ${hailSelected.join(', ') || 'none'}${hailMax ? ` (Max: ${hailMax})` : ''}<br/>
    Wind: ${windSelected.join(', ') || 'none'}${maxWindGust ? ` (Max: ${maxWindGust})` : ''}<br/>
    Tornado: ${tornado.length ? tornado.join(', ') : 'none'}<br/>
    Tornado Wind Speed: ${tornadoWindSpeed || 'none'}<br/>
    Basis: ${basis.join(', ') || 'none'}<br/>
    Confidence: ${confidence}<br/>
    Expires In: ${expiresInMinutes} minutes<br/>`;

  // Select description template based on type and basis
  if (type === 'Tornado Emergency') {
    description = window.ToreTemplate || '';
  } else if (type === 'PDS Tornado' && basisJoined.includes('Doppler Radar Indicated')) {
    description = window.pdsTorRadarTemplate || '';
  } else if (type === 'PDS Tornado') {
    description = window.pdsTorTemplate || '';
  } else if (type === 'Observed Tornado') {
    description = window.observedTorTemplate || '';
  } else if (type === 'Tornado') {
    description = window.TorTemplate || '';
  } else if (type === 'Destructive Severe Thunderstorm') {
    if (hailMax >= 2.75 && windSelected.some(w => [50, 55, 60, 65, 70, 75].includes(w))) {
      description = window.pdsSvrHail275Template || '';
    } else if (maxWindGust >= 100) {
      description = window.pdsSvr100Template || '';
    } else if (maxWindGust >= 90) {
      description = window.pdsSvr90Template || '';
    } else {
      description = window.pdsSvrTemplate || '';
    }
  } else if (type === 'Considerable Severe Thunderstorm') {
    description = window.considerableSvrTemplate || '';
  } else if (type === 'Severe Thunderstorm') {
    description = window.SvrTemplate || '';
  } else if (type === 'Flash Flood Emergency') {
    description = window.FfweTemplate || '';
  } else if (type === 'Considerable Flash Flood') {
    description = window.considerableFfwTemplate || '';
  } else if (type === 'Flash Flood') {
    description = window.FfwTemplate || '';
  } else if (type === 'TEST') {
    description = window.TestTemplate || '';
  } else {
    description = window.eyeWatchDescriptionTemplate || '';
  }
  
  // Handle HAZARD hail replacement
  if (hailReadable) {
    description = description.replace(/\(SLECTEED SIZES OF HAIL\)/g, hailReadable);
  } else {
    description = description.replace(/ and \(SLECTEED SIZES OF HAIL\)/g, '');
  }

  const isFlashFloodType = /flash flood/i.test(type || '');
  const hasRadarIndicatedBasis = basisJoined.includes('Doppler Radar Indicated');
  if (isFlashFloodType && !hasRadarIndicatedBasis) {
    description = description
      .replace(/Flash flooding is on going or\s+expected to begin shortly\./ig, 'Flash flooding is already occurring.')
      .replace(/Flash flooding is on going or expected to begin shortly\./ig, 'Flash flooding is already occurring.')
      .replace(/FLASH FLOOD\.\.\.RADAR INDICATED/ig, 'FLASH FLOOD...OBSERVED');
  }
  
  // Automatically replace placeholders with actual Eye Watch data
  const issuedDate = new Date(issuedAt);
  const expiresDate = new Date(expires);
  const issuedTimeFormatted = issuedDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', ''); // e.g., "952PM"
  const issuedTimeDisplay = `${issuedTimeFormatted.slice(0, -2)} ${issuedTimeFormatted.slice(-2)}`; // e.g., "952 PM"
  const issuedDateFormatted = issuedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); // e.g., "Mon Dec 1"
  const expiresTimeFormatted = expiresDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '').slice(0, -2) + ' ' + expiresDate.toLocaleTimeString('en-US', { hour12: true }).slice(-2); // e.g., "1045 PM"
  const issuedTimeZulu = issuedDate.toISOString().slice(11, 16).replace(':', ''); // e.g., "2023Z" (assuming UTC)
  const latLonFormatted = polygon.map(coord => `${Math.round(coord[0] * 100)} ${Math.round(coord[1] * 100)}`).join(' '); // e.g., "3082 9997 ..."

  description = description
    .replace(/\/O\.NEW\.\(ISSUED\)230124T2024Z-\(EXPIRES\)230124T2100Z\//g, `/O.NEW.${issuedAt.slice(0, 10).replace(/-/g, '').slice(2)}T${issuedTimeZulu.slice(0, 4)}Z-${expires.slice(0, 10).replace(/-/g, '').slice(2)}T${expiresTimeFormatted}00Z/`)
    .replace(/\(TIME AND THE DATE and year IT GOT ISSUED LIKE 952 PM Mon Dec 1 2025\)/g, `${issuedTimeDisplay} ${issuedDateFormatted}`)
    .replace(/\* Until \(WHEN IT EXPIRES LIKE 1045 PM\/AM\)\./g, `* Until ${expiresTimeFormatted}.`)
    .replace(/\(WHEN IT ISSUED LIKE At 952 PM\/AM\)/g, `${issuedTimeDisplay}`)
    .replace(/LAT\.\.\.LON \(LAT AND LON\)/g, `LAT...LON ${latLonFormatted}`)
    .replace(/TIME\.\.\. \(TIME LIKE 2023Z\)/g, `TIME... ${issuedTimeZulu}Z`)
    .replace(/\(BASIS\)/g, basisJoined)
    .replace(/\(CONFIDENCE LEVEL\)/g, confidence.toUpperCase())
    .replace(/\(NAME\)/g, name.toUpperCase())
    .replace(/\(SLECTEED SIZES OF HAIL\)/g, hailReadable)
    .replace(/\(MAX HAIL SIZE THAT WAS SELCTED\)/g, hailMax ? `${hailMax} IN` : '')
    .replace(/\(MAX WIND GUST THAT WAS SELCTED\)/g, maxWindGust ? `${maxWindGust} MPH` : '')
    .replace(/\(SELECTED PART OF THE TORNADO SECTION\)/g, (tornado.join(', ') || '').toUpperCase())
    .replace(/\(SELECTED TORNADO WIND SPEED\)/g, tornadoWindSpeed)
    .replace(/\(MAX WIND GUST AND SLECTED HAIL SIZE\)/g, (() => {
      let parts = [];
      if (maxWindGust) parts.push(`${maxWindGust} mph wind gusts`);
      if (hailReadable) parts.push(hailReadable);
      return parts.join(' and ');
    })());

  // If the Tornado option in the menu wasn't selected, prune the
  // standalone 'TORNADO' section from templates for non-tornado alerts.
  try {
    const tornadoSelectedFromMenu = Array.isArray(tornado) ? tornado.length > 0 : !!tornado;
    const isSevereThunder = /severe thunderstorm/i.test(type || '');
    const isFlashFloodType = /flash flood/i.test(type || '');
    const isAlertTypeTornado = /tornado/i.test(type || '');
    if (!tornadoSelectedFromMenu && !isSevereThunder && !isFlashFloodType && !isAlertTypeTornado) {
      // remove lines like 'TORNADO' or 'TORNADO...' that appear as section headings
      description = description.replace(/(^|\n)\s*TORNADO(?:\s*\.{1,3})?[^\n]*\n?/ig, '$1');
      // remove any leftover tornado placeholder text
      description = description.replace(/\(SELECTED PART OF THE TORNADO SECTION\)/ig, '');
      // collapse multiple blank lines
      description = description.replace(/\n{3,}/g, '\n\n');
    }
  } catch (e) { /* ignore pruning errors */ }

  // If a storm tracker dot exists, compute compass direction (opposite the tail marker)
  try {
    if (window._stormTracker && window._stormTracker.marker && Array.isArray(window.editablePolygonPoints) && window.editablePolygonPoints.length >= 3) {
      const mpos = window._stormTracker.marker.getLngLat(); // {lng, lat}
      // compute centroid of editable polygon points (points are [lng, lat])
      const pts = window.editablePolygonPoints;
      let sx = 0, sy = 0;
      for (const p of pts) { sx += Number(p[0]); sy += Number(p[1]); }
      const centroid = [sx / pts.length, sy / pts.length]; // [lng, lat]

      // Movement direction should be opposite the tail marker, so vector = centroid - marker
      const dx = centroid[0] - mpos.lng;
      const dy = centroid[1] - mpos.lat;
      let deg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360; // 0 = East, 90 = North
      const idx = Math.round(deg / 45) % 8;
      const dirNames = ['East','Northeast','North','Northwest','West','Southwest','South','Southeast'];
      const dirFull = dirNames[idx] || 'Unknown';

      // Replace common placeholder patterns in the selected description template
      try {
        // replace token like (N/S/E/W/NE/SE/NW/SW)
        description = description.replace(/\(N\/S\/E\/W\/NE\/SE\/NW\/SW\)/ig, dirFull);
        // replace patterns like "moving (N/S/E/...) at (MPH)" -> include computed speed if available
        try {
          let mphVal = null;
          if (window.computeStormTrackerSpeed && window._stormTracker && window._stormTracker.marker) {
            try { mphVal = window.computeStormTrackerSpeed(window._stormTracker.marker.getLngLat(), centroid); } catch(e) { mphVal = null; }
          }
          const speedSuffix = (mphVal != null) ? (' at ' + mphVal + ' MPH') : '';
          description = description.replace(/moving\s*\(N\/S\/E\/W\/NE\/SE\/NW\/SW\)\s*(?:at\s*\(MPH\))?/ig, 'moving ' + dirFull + speedSuffix);
        } catch (e) { description = description.replace(/moving\s*\(N\/S\/E\/W\/NE\/SE\/NW\/SW\)\s*(?:at\s*\(MPH\))?/ig, 'moving ' + dirFull); }
        } catch (e) { console.warn('Direction replacement failed', e); }

          // Replace the town-location placeholder(s) with the nearest city to the storm dot.
        try {
          const townPlaceholderRegex = /\(\s*(?:Town\s+Location\s+where\s+the\s+Storm\s+was\s+taking\s+place|Town\s+Location\s+where\s+the\s+tornado\s+formed|Town\s+Location\s+of\s+where\s+the\s+strong\s+rotation\s+of\s+the\s+storm\s+is)\s*\)/i;
          if (townPlaceholderRegex.test(description)) {
            const mlat = Number(mpos.lat), mlng = Number(mpos.lng);
            const toRad = Math.PI / 180;
            const R = 6371; // km
            function haversineKm(lat1, lon1, lat2, lon2) {
              const dLat = (lat2 - lat1) * toRad;
              const dLon = (lon2 - lon1) * toRad;
              const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon/2) * Math.sin(dLon/2);
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
              return R * c;
            }

            function replaceTownName(cityObj) {
              const townName = cityObj ? cityObj.city : 'the area';
              description = description.replace(townPlaceholderRegex, townName);
              try {
                const ta = document.getElementById('editDescriptionTextarea');
                if (ta && townPlaceholderRegex.test(ta.value)) ta.value = ta.value.replace(townPlaceholderRegex, townName);
              } catch (e) { /* ignore UI update errors */ }
              try {
                const pre = document.getElementById('geojson-pre');
                if (pre && pre.textContent) {
                  try {
                    const obj = JSON.parse(pre.textContent);
                    if (obj && obj.description && townPlaceholderRegex.test(obj.description)) {
                      obj.description = obj.description.replace(townPlaceholderRegex, townName);
                      pre.textContent = JSON.stringify(obj, null, 2);
                    }
                  } catch (e) { /* not JSON or parse failed */ }
                }
              } catch (e) { /* ignore preview errors */ }
              try {
                if (window._pendingEyeWatchJSON && window._pendingEyeWatchJSON.description) {
                  window._pendingEyeWatchJSON.description = window._pendingEyeWatchJSON.description.replace(townPlaceholderRegex, townName);
                }
              } catch (e) { /* ignore pending update errors */ }
            }

            function findAndReplaceFromList(list) {
              if (!Array.isArray(list) || list.length === 0) return false;
              let best = null, bestD = Infinity;
              for (const c of list) {
                if (!c || typeof c.lat === 'undefined' || typeof c.lng === 'undefined') continue;
                const d = haversineKm(mlat, mlng, Number(c.lat), Number(c.lng));
                if (d < bestD) { bestD = d; best = c; }
              }
              if (best) { replaceTownName(best); return true; }
              return false;
            }

            if (window._usCities && Array.isArray(window._usCities) && window._usCities.length) {
              findAndReplaceFromList(window._usCities);
            } else {
              // Load async and replace when available
              try {
                loadUSCitiesCSV().then(cities => {
                  if (Array.isArray(cities) && cities.length) findAndReplaceFromList(cities);
                }).catch(() => { /* ignore load errors */ });
              } catch (e) { /* ignore */ }
            }
          }
        } catch (e) { console.warn('Nearest-town replacement failed', e); }
    }
  } catch (e) { console.warn('Storm tracker direction compute failed', e); }
  
  // Final replacement: any leftover (MPH) tokens -> use tracked/current speed if available
  try {
    let speedVal = null;
    if (window._stormTracker && typeof window._stormTracker.currentSpeed !== 'undefined' && window._stormTracker.currentSpeed !== null) {
      speedVal = window._stormTracker.currentSpeed;
    } else if (window.computeStormTrackerSpeed && window._stormTracker && window._stormTracker.marker) {
      try {
        const marker = window._stormTracker.marker.getLngLat();
        const pts = window.editablePolygonPoints || [];
        let centroidForSpeed = null;
        if (Array.isArray(pts) && pts.length) {
          let sx = 0, sy = 0;
          for (const p of pts) { sx += Number(p[0]); sy += Number(p[1]); }
          centroidForSpeed = [sx / pts.length, sy / pts.length];
        }
        speedVal = window.computeStormTrackerSpeed(marker, centroidForSpeed);
      } catch (e) { speedVal = null; }
    }
    if (speedVal != null) {
      description = description.replace(/\(MPH\)/g, `${speedVal} MPH`);
    }
  } catch (e) { /* ignore final MPH replacement errors */ }

  return {
    id,
    issuedAt,
    expires,
    type,
    name,
    hail: {
      selectedSizes: hailSelected,
      maxSize: hailMax
    },
    wind: {
      selectedValues: windSelected,
      maxWindGust: maxWindGust
     
    },
    basis,
    tornado,
    tornadoWindSpeed,
    confidence,
    expiresInMinutes: String(expiresInMinutes),
    polygon,
    priority,
    summary,
    description // <-- now with replaced placeholders
  };
}

// NEW: fetch polygon from Google Sheets and add a cyan polygon layer

(function(){
  const sheetId = '1VPJEx2QKStXg-kHyWXW_C4fzOfBJQcXuf7rp0aapE6Y';
  const apiKey = 'AIzaSyAnjraIjs-jdsZA6pK1Ab5GjgWIifhykM4';
  const range = 'Sheet1!A:A';
  const feedUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;

  function parsePolygonFromSheetValues(values){
    // values: array of rows like [['{"polygon":[[lat,lng],...], "name":"Redbird2010", ...}'], ...]
    const results = [];
    for (const row of (values || [])) {
      const cell = row && row[0];
      if (!cell) continue;
      try {
        // Try parse the cell as JSON — expect objects that include polygon plus other fields
        const parsed = JSON.parse(cell);
        if (parsed && parsed.polygon && Array.isArray(parsed.polygon)) {
          // keep entire parsed object (polygon + metadata)
          results.push(parsed);
          continue;
        }
      } catch(e) {
        // If parsing failed, attempt to find a literal polygon array substring and parse just that (fallback)
        try {
          const maybe = cell.trim();
          if (maybe.startsWith('[')) {
            const parsedArr = JSON.parse(maybe);
            if (Array.isArray(parsedArr)) {
              results.push({ polygon: parsedArr });
            }
          }
        } catch(_) { /* ignore */ }
      }
    }
    return results.length ? results : null;
  }

  function addSheetPolygonToMap(polygonObjects) {
    if (!polygonObjects) return;
    // Normalize input
    const normalized = Array.isArray(polygonObjects) && polygonObjects.length && Array.isArray(polygonObjects[0]) && typeof polygonObjects[0][0] === 'number'
      ? [{ polygon: polygonObjects }] // single raw polygon array -> wrap as object
      : polygonObjects; // assume array of objects

    // Remove existing synthetic Eye Watch alerts before adding new ones
    Object.keys(polygonsById).forEach(id => {
      if (id.startsWith('sheet-eyewatch-')) {
        delete polygonsById[id];
        // Remove from alerts list
        const listContent = document.getElementById('nws-alerts-list-content');
        if (listContent) {
          const element = listContent.querySelector(`[data-alert-id="${id}"]`);
          if (element) element.remove();
        }
      }
    });

    const features = [];
    const parsedMeta = []; // keep original parsed objects for later when creating alert rows
    normalized.forEach((obj, idx) => {
      const poly = obj && obj.polygon ? obj.polygon : null;
      if (!Array.isArray(poly) || poly.length === 0) return;
      // Convert [lat, lng] to [lng, lat]
      const coords = poly.map(pt => [parseFloat(pt[1]), parseFloat(pt[0])]).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
      if (coords.length === 0) return;
      // ensure closed ring
      if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
        coords.push(coords[0].slice());
      }

      // Create a stable synthetic id based on sheet row index (so repeated fetches map to same feature)
      const stableId = `sheet-eyewatch-${idx}`;

      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: { sheetIndex: idx, id: stableId } // <-- include stable id in source feature properties
      });
      parsedMeta.push(obj);
    });
    if (features.length === 0) return;
    const geo = { type: 'FeatureCollection', features };
    // Persist the latest sheet polygon geojson so split maps created later can also render it
    window._sheetPolygonGeo = geo;

    // Helper: add/update sheet polygon layers on a particular map instance
    function addSheetPolygonsToMap(targetMap) {
      if (!targetMap || typeof targetMap.getStyle !== 'function') return;

      // Add or update source (single source for all sheet polygons)
      if (targetMap.getSource('sheet-polygon')) {
        targetMap.getSource('sheet-polygon').setData(geo);
        console.log('sheet-polygon source updated with', features.length, 'features');
      } else {
        targetMap.addSource('sheet-polygon', { type: 'geojson', data: geo });
        console.log('sheet-polygon source added with', features.length, 'features');
      }

      // Determine insertion points:
      // - sheetFillInsertBefore: keep fill beneath road/highway line layers and other map features (same as NWS alert polygons)
      // - sheetOutlineInsertBefore: place outlines above those features (before symbol layers)
      let sheetFillInsertBefore = null;
      let sheetOutlineInsertBefore = null;
      const layers = targetMap.getStyle().layers || [];
      for (const layer of layers) {
        // place fill beneath the first line/symbol layer to keep it under roads and labels
        if (!sheetFillInsertBefore && (layer.type === 'line' || layer.type === 'symbol')) {
          sheetFillInsertBefore = layer.id;
        }
        // place outlines just before symbol layers (so outlines draw on top of radar but beneath labels)
        if (!sheetOutlineInsertBefore && layer.type === 'symbol') {
          sheetOutlineInsertBefore = layer.id;
        }
        if (sheetFillInsertBefore && sheetOutlineInsertBefore) break;
      }

      // If we couldn't find a symbol layer, default to top (null) so polygon is on top.
      // Add fill (cyan) and outline (darker cyan). If layers already exist, update/move them.
      if (!targetMap.getLayer('sheet-polygon-fill')) {
        targetMap.addLayer({
          id: 'sheet-polygon-fill',
          type: 'fill',
          source: 'sheet-polygon',
          paint: {
            'fill-color': '#00FFFF',
            'fill-opacity': 0.35,
            'fill-outline-color': '#00FFFF'
          }
        }, sheetFillInsertBefore);
        console.log('sheet-polygon-fill added before:', sheetFillInsertBefore);
      } else {
        try {
          if (sheetFillInsertBefore) targetMap.moveLayer('sheet-polygon-fill', sheetFillInsertBefore);
          else targetMap.moveLayer('sheet-polygon-fill');
          console.log('sheet-polygon-fill moved to before:', sheetFillInsertBefore || 'top');
        } catch(e) { console.warn('Could not move sheet-polygon-fill:', e); }
      }

      if (!targetMap.getLayer('sheet-polygon-outline')) {
        targetMap.addLayer({
          id: 'sheet-polygon-outline',
          type: 'line',
          source: 'sheet-polygon',
          paint: {
            'line-color': '#00f9ef',
            'line-width': 5,
            'line-dasharray': [2, 2]
          }
        }, sheetOutlineInsertBefore);
        console.log('sheet-polygon-outline added before:', sheetOutlineInsertBefore);
      } else {
        try {
          if (sheetOutlineInsertBefore) targetMap.moveLayer('sheet-polygon-outline', sheetOutlineInsertBefore);
          else targetMap.moveLayer('sheet-polygon-outline');
          console.log('sheet-polygon-outline moved to before:', sheetOutlineInsertBefore || 'top');
        } catch(e) { console.warn('Could not move sheet-polygon-outline:', e); }
      }

      // ---------- NEW: attach popup/hover handlers so sheet polygons behave like NWS polygons ----------
      // Use WeakSet to ensure handlers are only attached once per map instance
      window._sheetPopupHandlerMaps = window._sheetPopupHandlerMaps || new WeakSet();
      if (!window._sheetPopupHandlerMaps.has(targetMap)) {
        try {
          targetMap.on('click', 'sheet-polygon-fill', function (e) {
            handleAlertPolygonClick(e, targetMap);
          });
          targetMap.on('mouseenter', 'sheet-polygon-fill', function () { targetMap.getCanvas().style.cursor = 'pointer'; });
          targetMap.on('mouseleave', 'sheet-polygon-fill', function () { targetMap.getCanvas().style.cursor = ''; });
          window._sheetPopupHandlerMaps.add(targetMap);
        } catch (e) {
          console.warn('Failed to attach sheet polygon popup handlers', e);
        }
      }
    }

    // Add polygons to all relevant maps (main + split/dual)
    getAlertPolygonMaps().forEach(addSheetPolygonsToMap);

    // Ensure future split/dual maps also get sheet polygons
    window._ensureSheetPolygonsOnMaps = () => {
      if (!window._sheetPolygonGeo) return;
      getAlertPolygonMaps().forEach(addSheetPolygonsToMap);
    };

    // --- NEW: register sheet polygons as "Eye Watch" alerts in the Active Alerts list ---
    try {
      // Ensure global arrays exist
      window.sheetPolygonFeatures = window.sheetPolygonFeatures || [];
      window.nwsAlertFeatures = window.nwsAlertFeatures || window.nwsAlertFeatures; // don't overwrite if absent

      const alertContainer = document.getElementById('nws-alerts-list-content');
      const sheetColor = (window.savedAlertColors && window.savedAlertColors['Eye Watch']) || '#00FFFF';

      // iterate over features and use parsedMeta to attach metadata (if available)
      features.forEach((ft, idx) => {
        const meta = parsedMeta[idx] || {};
        // Use the same stable id we injected into the feature properties
        const syntheticId = ft.properties.id || `sheet-eyewatch-${ft.properties.sheetIndex}`;
        const expiresIso = (meta.expires) ? meta.expires : new Date(Date.now() + 30 * 60000).toISOString(); // prefer sheet expires if present
        const areaDesc = meta.areaDesc || `Sheet polygon #${ft.properties.sheetIndex +  1}`;

        // Build synthetic feature compatible with polygonsById and other UI code
        const syntheticFeature = {
          type: 'Feature',
          id: syntheticId,
          geometry: ft.geometry,
          properties: {
            id: syntheticId,
            event: 'Eye Watch',
            displayEvent: 'Eye Watch',
            fillColor: sheetColor,
            priority: 115,
            expires: expiresIso,
            areaDesc: areaDesc,
            // copy sheet metadata into properties so the UI template can use them
            name: meta.name || meta.Name || meta.creator || '',
            type: meta.type || meta.alertType || meta.Type || 'Eye Watch',
            maxHailSize: meta.maxHailSize || meta.hail?.maxSize || '',
            maxWindGust: meta.maxWindGust || meta.wind?.maxWindGust || '',
            tornado: meta.tornado || '',
            tornadoWindSpeed: meta.tornadoWindSpeed || meta['Tornado Wind Speed'] || '',
            basis: meta.basis || '',
            confidence: meta.confidence || '',
            image: meta.image || meta.thumbnail || '',
            // Store description up-front for immediate display when user clicks View Description
            description: meta.description || meta.desc || meta.summary || ''
          }
        };

        // Save to globals for later reference by summary/description code
        polygonsById = polygonsById || {};
        polygonsById[syntheticId] = syntheticFeature;
        window.sheetPolygonFeatures.push(syntheticFeature);
        // Also push to window.nwsAlertFeatures so description lookup doesn't fail (minimal stub)
        window.nwsAlertFeatures = window.nwsAlertFeatures || [];
        window.nwsAlertFeatures.push({
          id: syntheticId,
          properties: {
            description: meta.description || `Eye Watch created from Google Sheet (sheet index ${ft.properties.sheetIndex}).`,
            parameters: {}
          },
          geometry: ft.geometry
        });

        // Append alert row to the Active Alerts list
        if (alertContainer) {
          const div = document.createElement('div');
          div.className = 'nws-alert-item';
          div.setAttribute('data-alert-id', syntheticId);
          div.style.cursor = 'pointer';
          div.style.marginBottom = '12px';
          div.style.paddingBottom = '8px';
          div.style.borderBottom = '1px solid rgba(0,150,255,0.2)';

          // Build a formatted expires text for the row display (keeps full ISO if that's what sheet provided)
          const expiresText = syntheticFeature.properties.expires || expiresIso;
          const name = syntheticFeature.properties.name || '';
          const type = syntheticFeature.properties.type || 'Eye Watch';
          const maxHailSize = syntheticFeature.properties.maxHailSize || '';
          const maxWindGust = syntheticFeature.properties.maxWindGust || '';
          const tornado = syntheticFeature.properties.tornado || '';
          const basis = syntheticFeature.properties.basis || '';
          const confidence = syntheticFeature.properties.confidence || '';
          // preserve possible image: prefer sheet image, fallback to #warnGenImage src if set
          const thumbnailSrc = syntheticFeature.properties.image || (document.getElementById('warnGenImage') ? document.getElementById('warnGenImage').src : '');

          // REPLACED: use same compact row markup as NWS alerts (removed thumbnail)
          div.innerHTML = `
            <span class="nws-alert-color-box" style="background:${sheetColor};"></span>
            <span class="nws-alert-event">Eye Watch</span>
            <div class="nws-alert-expires">Expires: ${expiresText.replace('T',' ').replace('Z',' UTC')}</div>
          `;

          // Add click handler: zoom to polygon and show summary using the same UI
          div.addEventListener('click', function() {
            const alertId = this.getAttribute('data-alert-id');
            const f = polygonsById[alertId];
            if (!f || !f.geometry) return;
            // get exterior ring coordinates in [lng,lat]
            const coords = (f.geometry.type === 'Polygon') ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
            const bounds = coords.reduce(function(b, c) {
              return b.extend(c);
            }, new maplibregl.LngLatBounds(coords[0], coords[0]));
            map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 4000 });

            // When user clicks the alert row, ensure the sheet alerts dropdown
            // matches so subsequent 'Action' clicks operate on this alert.
            try {
              const sel = document.getElementById('sheet-alerts-select');
              if (sel) {
                if (![...sel.options].some(o => o.value === alertId)) {
                  try { populateSheetAlertsDropdown(); } catch (e) { /* ignore */ }
                }
                sel.value = alertId;
              }
            } catch (e) { /* ignore */ }

            // Do not open the description for Eye Watch rows — only hide the summary panel
            hideAlertSummaryPanel();
          });

          // Insert new alert row at top
          alertContainer.insertBefore(div, alertContainer.firstChild);
        }
      });
    } catch (e) {
      console.warn('Failed to register sheet polygons as Eye Watch alerts:', e);
    }
  }

  // Ensure sheet polygon fetch runs if map already loaded (makes the cyan polygon script easier to trigger/see)
  if (map.loaded && map.loaded()) {
    try { fetchAndRenderSheetPolygon(); console.log('fetchAndRenderSheetPolygon invoked immediately (map already loaded)'); } catch(e){ console.warn(e); }
  }
  
  // --- Sheet Alerts UI: dropdown + zoom + action modal + editable polygon creation ---
  function createSheetAlertsDropdown() {
    try {
      if (document.getElementById('sheet-alerts-container')) return;
      const menuEl = document.getElementById('menu') || document.body;
      const container = document.createElement('div');
      container.id = 'sheet-alerts-container';
      container.style.padding = '8px';
      container.style.color = 'white';
      container.style.fontFamily = "'Bebas Neue',sans-serif";
      container.innerHTML = `
        <label style="display:block;margin-bottom:6px;font-weight:bold;">Sheet Alerts</label>
        <select id="sheet-alerts-select" style="width:100%;padding:6px;margin-bottom:6px;"></select>
        <div style="display:flex;gap:8px;">
          <button id="sheet-zoom-btn" style="flex:1;padding:6px;background:#00bcd4;color:#000;border-radius:6px;border:none;cursor:pointer;">Zoom to Polygon</button>
          <button id="sheet-action-btn" style="flex:1;padding:6px;background:#00ffad;color:#000;border-radius:6px;border:none;cursor:pointer;">Action</button>
        </div>
      `;
      menuEl.appendChild(container);

      document.getElementById('sheet-zoom-btn').addEventListener('click', () => {
        const sel = document.getElementById('sheet-alerts-select');
        const id = sel && sel.value;
        if (!id) return alert('No sheet alert selected');
        const f = polygonsById[id];
        if (!f || !f.geometry) return alert('No polygon found for this alert');
        let coords = [];
        if (f.geometry.type === 'Polygon') coords = f.geometry.coordinates[0];
        else if (f.geometry.type === 'MultiPolygon') coords = f.geometry.coordinates[0][0];
        if (!coords.length) return;
        const bounds = coords.reduce((b,c)=>b.extend(c), new maplibregl.LngLatBounds(coords[0],coords[0]));
        map.fitBounds(bounds,{padding:60,maxZoom:10,duration:1000});
      });

      document.getElementById('sheet-action-btn').addEventListener('click', () => {
        const sel = document.getElementById('sheet-alerts-select');
        const id = sel && sel.value;
        if (!id) return alert('No sheet alert selected');
        const f = polygonsById[id];
        if (!f) return;
        const type = (f.properties && (f.properties.type || f.properties.event || '')).toLowerCase();
        const isFlash = /flash flood|flash flood emergency|considerable flash flood/i.test(type) || /flash flood/i.test(f.properties.displayEvent || '');
        openSheetAlertConfirmation(id, isFlash);
      });

      populateSheetAlertsDropdown();
    } catch (e) { console.warn('createSheetAlertsDropdown failed', e); }
  }

  function populateSheetAlertsDropdown() {
    try {
      const sel = document.getElementById('sheet-alerts-select');
      if (!sel) return;
      // preserve current selection so periodic repopulates don't clobber it
      const previousValue = sel.value;

      // gather sheet alerts from polygonsById
      const items = [];
      Object.keys(polygonsById || {}).forEach(id => {
        if (!id.startsWith('sheet-eyewatch-')) return;
        const f = polygonsById[id];
        if (!f) return;
        const now = new Date();
        const exp = f.properties && f.properties.expires ? new Date(f.properties.expires) : null;
        let mins = exp ? Math.max(0, Math.round((exp - now) / 60000)) : '';
        const name = (f.properties && (f.properties.name || f.properties.type || f.properties.event)) || `Sheet ${id}`;
        const displayType = (f.properties && (f.properties.type || f.properties.event)) || 'Eye Watch';
        const label = `${displayType} Issued by ${name}${mins !== '' ? `, Expires in ${mins} mins` : ''}`;
        items.push({ id, label });
      });
      // clear and populate
      sel.innerHTML = '';
      items.forEach(it => {
        const opt = document.createElement('option');
        opt.value = it.id;
        opt.textContent = it.label;
        sel.appendChild(opt);
      });
      // Restore previous selection if still available, otherwise pick first
      if (previousValue && [...sel.options].some(o => o.value === previousValue)) {
        sel.value = previousValue;
      } else if (!sel.value && sel.options && sel.options.length) {
        sel.selectedIndex = 0;
      }
    } catch (e) { console.warn('populateSheetAlertsDropdown failed', e); }
  }

  function openSheetAlertConfirmation(alertId, isFlash) {
    try {
      // create modal if necessary
      if (!document.getElementById('sheet-alert-confirm-modal')) {
        const modal = document.createElement('div');
        modal.id = 'sheet-alert-confirm-modal';
        modal.style.position = 'fixed';
        modal.style.left = '0';
        modal.style.top = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.background = 'rgba(0,0,0,0.6)';
        modal.style.zIndex = '9999';

        const box = document.createElement('div');
        box.style.background = 'black';
        box.style.padding = '18px';
        box.style.border = '2px solid cyan';
        box.style.borderRadius = '8px';
        box.style.color = 'white';
        box.style.fontFamily = "'Bebas Neue',sans-serif";
        box.style.width = '420px';
        box.style.maxWidth = '90%';

        box.innerHTML = `<div id="sheet-confirm-text" style="margin-bottom:12px;font-weight:bold;font-size:16px;">Do you want to Continue or Upgrade this alert?</div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button id="sheet-confirm-continue" style="padding:8px 14px;background:#444;color:white;border-radius:6px;border:none;cursor:pointer;">Continue</button>
            <button id="sheet-confirm-upgrade" style="padding:8px 14px;background:#ff8c00;color:black;border-radius:6px;border:none;cursor:pointer;">Upgrade</button>
            <button id="sheet-confirm-extend" style="padding:8px 14px;background:#66ff66;color:black;border-radius:6px;border:none;cursor:pointer;display:none;">Extend</button>
            <button id="sheet-confirm-cancel" style="padding:8px 14px;background:#222;color:white;border-radius:6px;border:none;cursor:pointer;">Cancel</button>
          </div>`;

        modal.appendChild(box);
        document.body.appendChild(modal);

        document.getElementById('sheet-confirm-cancel').addEventListener('click', () => { modal.remove(); });
      }

      const modal = document.getElementById('sheet-alert-confirm-modal');
      const contBtn = document.getElementById('sheet-confirm-continue');
      const upgBtn = document.getElementById('sheet-confirm-upgrade');
      const extBtn = document.getElementById('sheet-confirm-extend');
      const txt = document.getElementById('sheet-confirm-text');
      txt.textContent = 'Do you want to Continue or Upgrade this alert?';
      if (isFlash) { extBtn.style.display = 'inline-block'; txt.textContent = 'Do you want to Continue, Upgrade, or Extend this alert?'; } else { extBtn.style.display = 'none'; }

      contBtn.onclick = () => { handleSheetActionChoice(alertId, 'CONTINUE'); if (modal) modal.remove(); };
      upgBtn.onclick = () => { handleSheetActionChoice(alertId, 'UPGRADE'); if (modal) modal.remove(); };
      extBtn.onclick = () => { handleSheetActionChoice(alertId, 'EXTEND'); if (modal) modal.remove(); };
    } catch (e) { console.warn('openSheetAlertConfirmation failed', e); }
  }

  function handleSheetActionChoice(alertId, choice) {
    try {
      window._lastSheetAction = choice; // remember for apply-time adjustments
      const f = polygonsById[alertId];
      if (!f || !f.geometry) return;
      let coords = [];
      if (f.geometry.type === 'Polygon') coords = f.geometry.coordinates[0];
      else if (f.geometry.type === 'MultiPolygon') coords = f.geometry.coordinates[0][0];
      if (!coords || !coords.length) return;
      // create editable polygon from coords
      createEditablePolygonFromCoords(coords);
      // If user chose Continue or Upgrade, remove the sheet alert from map/list
      if (choice === 'CONTINUE' || choice === 'UPGRADE') {
        try {
          // remove from polygonsById
          if (polygonsById && polygonsById[alertId]) delete polygonsById[alertId];

          // remove from sheet source data if present
          try {
            if (map.getSource && map.getSource('sheet-polygon')) {
              const src = map.getSource('sheet-polygon');
              const data = src._data || (src.serialize && src.serialize()) || null;
              if (data && Array.isArray(data.features)) {
                data.features = data.features.filter(ff => !(ff.properties && ff.properties.id === alertId));
                try { src.setData(data); } catch(e) { /* some map implementations use private fields */ }
              }
            }
          } catch(e) { /* ignore source update errors */ }

          // remove from UI alert list
          try {
            const list = document.getElementById('nws-alerts-list-content');
            if (list) {
              const el = list.querySelector(`[data-alert-id="${alertId}"]`);
              if (el) el.remove();
            }
          } catch(e){}

          // remove from helper arrays
          try { if (Array.isArray(window.sheetPolygonFeatures)) window.sheetPolygonFeatures = window.sheetPolygonFeatures.filter(x=>x.id !== alertId); } catch(e){}
          try { if (Array.isArray(window.nwsAlertFeatures)) window.nwsAlertFeatures = window.nwsAlertFeatures.filter(x=>x.id !== alertId); } catch(e){}

          // refresh dropdown
          try { populateSheetAlertsDropdown(); } catch(e){}
        } catch (e) { console.warn('failed to remove sheet alert after action', e); }
      }
      // show a small notification
      try { alert(`Action: ${choice} applied. Editable polygon created.`); } catch(e){}
    } catch (e) { console.warn('handleSheetActionChoice failed', e); }
  }

  function createEditablePolygonFromCoords(coords) {
    try {
      // coords expected as [[lng,lat],...]
      removeEditablePolygon();
      window.editablePolygonPoints = coords.map(c => [Number(c[0]), Number(c[1])]);
      window.editablePolygonMarkers = [];

      const id = 'editable-polygon';
      const geo = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords.concat([coords[0]])] }
      };

      if (map.getSource(id)) {
        try { map.getSource(id).setData(geo); } catch(e){}
      } else {
        map.addSource(id, { type: 'geojson', data: geo });
        let insertBefore = null;
        const layers = map.getStyle().layers || [];
        for (const layer of layers) { if (!insertBefore && (layer.type === 'line' || layer.type === 'symbol')) { insertBefore = layer.id; break; } }
        map.addLayer({ id: id, type: 'fill', source: id, paint: { 'fill-color': '#ff00ff', 'fill-opacity': 0.25, 'fill-outline-color': '#ff00ff' } }, insertBefore);
        map.addLayer({ id: `${id}-outline`, type: 'line', source: id, paint: { 'line-color': '#ff00ff', 'line-width': 3 } });
      }

      // create draggable vertex markers
      coords.forEach((pt, idx) => {
        const el = document.createElement('div');
        el.className = 'editable-vertex';
        el.style.width = '12px';
        el.style.height = '12px';
        el.style.background = 'white';
        el.style.border = '2px solid #ff00ff';
        el.style.borderRadius = '50%';
        el.style.boxSizing = 'border-box';

        const m = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat(pt)
          .addTo(map);

        m.getElement().title = 'Drag to edit vertex';
        m.on('dragend', () => {
          try {
            const lnglat = m.getLngLat();
            window.editablePolygonPoints[idx] = [lnglat.lng, lnglat.lat];
            const polyCoords = window.editablePolygonPoints.slice();
            if (polyCoords.length && (polyCoords[0][0] !== polyCoords[polyCoords.length-1][0] || polyCoords[0][1] !== polyCoords[polyCoords.length-1][1])) polyCoords.push(polyCoords[0]);
            const updated = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [polyCoords] } };
            try { if (map.getSource(id)) map.getSource(id).setData(updated); } catch(e){}
          } catch (e) { console.warn('vertex drag update failed', e); }
        });
        window.editablePolygonMarkers.push(m);
      });
      
      // Attach or reuse the existing storm tracker (prefer the tracker created
      // in the draw-polygon flow if present). If none exists, create a simple
      // fallback draggable tracker that updates a visual line and nudges the
      // polygon while dragging.
      try {
        function __computeEditableCentroid(points) {
          if (!Array.isArray(points) || points.length === 0) return null;
          let sx = 0, sy = 0;
          for (const p of points) { sx += Number(p[0]); sy += Number(p[1]); }
          return [sx / points.length, sy / points.length];
        }

        const startPt = window.editablePolygonPoints && window.editablePolygonPoints.length ? window.editablePolygonPoints[0] : null;
        const centroid = __computeEditableCentroid(window.editablePolygonPoints || []) || (startPt || [0,0]);

        let initialTrackerPos = null;
        try {
          const pts = window.editablePolygonPoints || [];
          if (window._stormTracker && window._stormTracker.pivotFromDrop && window._stormTracker.pivot) {
            if (map && typeof map.project === 'function' && typeof map.unproject === 'function') {
              const pivotPx = map.project([window._stormTracker.pivot.lng, window._stormTracker.pivot.lat]);
              const offsetX = 40, offsetY = -12;
              const targetPx = [pivotPx.x + offsetX, pivotPx.y + offsetY];
              const lnglat = map.unproject(targetPx);
              initialTrackerPos = { lng: lnglat.lng, lat: lnglat.lat };
            } else {
              initialTrackerPos = { lng: window._stormTracker.pivot.lng + 0.02, lat: window._stormTracker.pivot.lat };
            }
          } else if (Array.isArray(pts) && pts.length) {
            const centroidLat = centroid[1];
            const intersects = [];
            for (let i = 0; i < pts.length; i++) {
              const a = pts[i];
              const b = pts[(i + 1) % pts.length];
              const latA = a[1], latB = b[1];
              const lngA = a[0], lngB = b[0];
              if (Math.abs(latA - latB) < 1e-12) {
                if (Math.abs(latA - centroidLat) < 1e-12) intersects.push(lngA, lngB);
                continue;
              }
              if (centroidLat >= Math.min(latA, latB) && centroidLat <= Math.max(latA, latB)) {
                const t = (centroidLat - latA) / (latB - latA);
                const interLng = lngA + t * (lngB - lngA);
                intersects.push(interLng);
              }
            }

            if (intersects.length) {
              const interLng = Math.max.apply(null, intersects);
              if (map && typeof map.project === 'function' && typeof map.unproject === 'function') {
                const px = map.project([interLng, centroidLat]);
                px.x += 40;
                const lnglat = map.unproject([px.x, px.y]);
                initialTrackerPos = { lng: lnglat.lng, lat: lnglat.lat };
              } else {
                initialTrackerPos = { lng: interLng - 0.01, lat: centroidLat };
              }
            } else {
              let maxLng = -Infinity, eastMid = null;
              for (let i = 0; i < pts.length; i++) {
                const next = (i + 1) % pts.length;
                const mid = [(pts[i][0] + pts[next][0]) / 2, (pts[i][1] + pts[next][1]) / 2];
                if (mid[0] > maxLng) { maxLng = mid[0]; eastMid = mid; }
              }
              if (eastMid && map && typeof map.project === 'function' && typeof map.unproject === 'function') {
                const px = map.project([eastMid[0], eastMid[1]]);
                px.x += 80;
                const lnglat = map.unproject([px.x, px.y]);
                initialTrackerPos = { lng: lnglat.lng, lat: lnglat.lat };
              } else if (eastMid) {
                initialTrackerPos = { lng: eastMid[0] + 0.02, lat: eastMid[1] };
              } else {
                initialTrackerPos = { lng: centroid[0] + 0.02, lat: centroid[1] };
              }
            }
          } else {
            initialTrackerPos = { lng: centroid[0] + 0.02, lat: centroid[1] };
          }
        } catch (e) {
          initialTrackerPos = { lng: centroid[0] + 0.02, lat: centroid[1] };
        }

        try {
          const st = window._stormTracker = window._stormTracker || {};
          if (st.marker && typeof st.marker.setLngLat === 'function') {
            if (startPt) {
              st.pivot = { lng: startPt[0], lat: startPt[1] };
              st.pivotFromDrop = true;
            }
            try { st.marker.setLngLat([initialTrackerPos.lng, initialTrackerPos.lat]); } catch (e) {}
            try { if (typeof window._updateStormTrackerAfterMove === 'function') window._updateStormTrackerAfterMove(); } catch (e) {}
          } else {
            // fallback simple tracker
            const dot = document.createElement('div');
            dot.className = 'storm-tracker-dot';
            dot.style.width = '14px'; dot.style.height = '14px'; dot.style.borderRadius = '50%';
            dot.style.background = 'radial-gradient(circle at 35% 30%, #ffb84d 0%, #ff7a00 60%)';
            dot.style.border = '2px solid #fff'; dot.style.boxShadow = '0 0 8px 2px rgba(255,122,0,0.6)'; dot.style.cursor = 'grab';

            const trackerMarker = new maplibregl.Marker({ element: dot, draggable: true })
              .setLngLat([initialTrackerPos.lng, initialTrackerPos.lat])
              .addTo(map);

            const lineId = 'storm-tracker-line';
            const updateLine = (lnglat) => {
              try {
                const cg = __computeEditableCentroid(window.editablePolygonPoints || []) || [lnglat.lng, lnglat.lat];
                const coordsLine = [[cg[0], cg[1]], [lnglat.lng, lnglat.lat]];
                if (map.getSource(lineId)) {
                  try { map.getSource(lineId).setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coordsLine } }); } catch(e){}
                } else {
                  try {
                    map.addSource(lineId, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coordsLine } } });
                    map.addLayer({ id: lineId, type: 'line', source: lineId, layout: { 'line-cap': 'round','line-join': 'round' }, paint: { 'line-color': '#ff7a00', 'line-width': 3 } });
                  } catch(e){}
                }

                // Also maintain a short solid tip segment so the line visually meets the marker
                try {
                  const tipId = 'storm-tracker-line-tip';
                  const tipCoords = [[(cg[0] + lnglat.lng) / 2, (cg[1] + lnglat.lat) / 2], [lnglat.lng, lnglat.lat]];
                  if (map.getSource(tipId)) {
                    try { map.getSource(tipId).setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: tipCoords } }); } catch(e){}
                  } else {
                    try {
                      map.addSource(tipId, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: tipCoords } } });
                      map.addLayer({ id: tipId, type: 'line', source: tipId, layout: { 'line-cap': 'round','line-join': 'round' }, paint: { 'line-color': '#ff7a00', 'line-width': 4 } });
                    } catch(e){}
                  }
                } catch (e) { /* ignore tip errors */ }

              } catch (e) { console.warn('updateLine failed', e); }
            };

            function onDragUpdate() {
              try {
                const p = trackerMarker.getLngLat();
                updateLine(p);

                // Compute speed preview (do NOT move/translate the polygon)
                try {
                  const mph = (typeof window.computeStormTrackerSpeed === 'function') ? window.computeStormTrackerSpeed(p, __computeEditableCentroid(window.editablePolygonPoints || [])) : null;
                  window._stormTracker = window._stormTracker || {};
                  if (mph != null) {
                    if (!window._stormTracker.speedLocked) {
                      window._stormTracker.currentSpeed = mph;
                    }
                    try {
                      const ta = document.getElementById('editDescriptionTextarea');
                      if (ta && /\(MPH\)/.test(ta.value) && (!window._stormTracker || !window._stormTracker.speedLocked)) {
                        ta.value = ta.value.replace(/\(MPH\)/g, `${mph} MPH`);
                      }
                    } catch (e) { /* ignore UI update errors */ }
                  }

                  // Update geojson preview if present
                  try {
                    const pre = document.getElementById('geojson-pre');
                    if (pre && pre.textContent) {
                      try {
                        const obj = JSON.parse(pre.textContent);
                        if (obj && obj.description && /\(MPH\)/.test(obj.description) && (!window._stormTracker || !window._stormTracker.speedLocked)) {
                          obj.description = obj.description.replace(/\(MPH\)/g, `${mph} MPH`);
                          pre.textContent = JSON.stringify(obj, null, 2);
                        }
                      } catch (e) { /* ignore parse errors */ }
                    }
                  } catch (e) { /* ignore */ }
                } catch (e) { /* ignore speed compute errors */ }
              } catch (e) { /* ignore overall */ }
            }

            trackerMarker.on('drag', onDragUpdate);
            trackerMarker.on('dragend', onDragUpdate);
            window._stormTracker = window._stormTracker || {};
            window._stormTracker.marker = trackerMarker;
            window._stormTracker.pivot = startPt ? { lng: startPt[0], lat: startPt[1] } : null;

            // Create an '✕' pivot marker at the polygon starting point so behavior
            // matches the draw-polygon storm tracker.
            try {
              const st = window._stormTracker;
              if (!st.xMarker) {
                const xEl = document.createElement('div');
                xEl.className = 'storm-tracker-x';
                xEl.style.width = '26px';
                xEl.style.height = '26px';
                xEl.style.borderRadius = '50%';
                xEl.style.background = '#ffdd00';
                xEl.style.color = '#222';
                xEl.style.display = 'flex';
                xEl.style.alignItems = 'center';
                xEl.style.justifyContent = 'center';
                xEl.style.fontWeight = '700';
                xEl.style.fontSize = '14px';
                xEl.style.boxShadow = '0 0 4px rgba(0,0,0,0.6)';
                xEl.style.border = '2px solid rgba(0,0,0,0.15)';
                xEl.style.pointerEvents = 'none';
                xEl.style.zIndex = '9999';
                xEl.textContent = '✕';
                const xPos = st.pivot ? [st.pivot.lng, st.pivot.lat] : [initialTrackerPos.lng, initialTrackerPos.lat];
                try {
                  const xm = new maplibregl.Marker({ element: xEl, draggable: false })
                    .setLngLat(xPos)
                    .addTo(map);
                  st.xMarker = xm;
                  st.xMarkerFixed = true;
                  if (!st.pivot) {
                    try {
                      const pos = xm.getLngLat && xm.getLngLat();
                      if (pos) st.pivot = { lng: pos.lng, lat: pos.lat };
                    } catch (e) { /* ignore */ }
                  }
                } catch (e) { /* ignore marker add errors */ }
              }
            } catch (e) { console.warn('xMarker create failed', e); }

            // Attach a zoom handler so the line updates when zooming (like original)
            try {
              window._stormTracker.zoomHandler = function () {
                try {
                  const m = window._stormTracker && window._stormTracker.marker;
                  if (!m) return;
                  updateLine(m.getLngLat());
                  try {
                    // adjust tracker dot size on zoom
                    const el = m.getElement && m.getElement();
                    if (el && map && typeof map.getZoom === 'function') {
                      const z = map.getZoom();
                      let size = 14 + Math.round((z - 7) * 1.8);
                      size = Math.max(8, Math.min(40, size));
                      el.style.width = size + 'px';
                      el.style.height = size + 'px';
                    }
                  } catch (e) { /* ignore */ }
                } catch (e) { /* ignore */ }
              };
              map.on('zoom', window._stormTracker.zoomHandler);
            } catch (e) { /* ignore */ }
          }
        } catch (e) { console.warn('storm tracker attach failed', e); }
      } catch (e) { console.warn('post-markers storm tracker setup failed', e); }
    } catch (e) { console.warn('createEditablePolygonFromCoords failed', e); }
  }

  // ensure dropdown exists and is kept up-to-date
  try { createSheetAlertsDropdown(); setInterval(populateSheetAlertsDropdown, 2500); } catch(e){}
  
  function fetchAndRenderSheetPolygon() {
    fetch(feedUrl)
      .then(res => res.json())
      .then(obj => {
        const values = obj.values || [];
        const polygons = parsePolygonFromSheetValues(values);
        const now = new Date();
        // Only remove expired sheet polygons, not all
        Object.keys(polygonsById).forEach(id => {
          if (id.startsWith('sheet-eyewatch-')) {
            const polygon = polygonsById[id];
            const expires = polygon?.properties?.expires ? new Date(polygon.properties.expires) : null;
            if (expires && now > expires) {
              // delete from lookup
              delete polygonsById[id];

              // Remove from map source: rely on the feature property 'id' present in source features
              if (map.getSource('sheet-polygon')) {
                try {
                  const src = map.getSource('sheet-polygon');
                  const data = src._data || null;
                  if (data && Array.isArray(data.features)) {
                    data.features = data.features.filter(f => (f.properties && f.properties.id) !== id);
                    src.setData(data);
                  }
                } catch (e) {
                  console.warn('Error removing expired sheet feature from source', e);
                }
              }

              // Remove from alert list
              const listContent = document.getElementById('nws-alerts-list-content');
              if (listContent) {
                const element = listContent.querySelector(`[data-alert-id="${id}"]`);
                if (element) element.remove();
              }

              // Remove from window.sheetPolygonFeatures and window.nwsAlertFeatures stubs if present
              if (Array.isArray(window.sheetPolygonFeatures)) {
                window.sheetPolygonFeatures = window.sheetPolygonFeatures.filter(f => f.id !== id);
              }
              if (Array.isArray(window.nwsAlertFeatures)) {
                window.nwsAlertFeatures = window.nwsAlertFeatures.filter(f => f.id !== id);
              }
            }
          }
        });
        // Do NOT clear all sheet polygons or alerts, just update/add new ones
        if (polygons && polygons.length) {
          addSheetPolygonToMap(polygons);
        }
      })
      .catch(console.error);
  }

  function pollSheetPolygons() {
    const sheetId = '1VPJEx2QKStXg-kHyWXW_C4fzOfBJQcXuf7rp0aapE6Y';
    const apiKey = 'AIzaSyAnjraIjs-jdsZA6pK1Ab5GjgWIifhykM4';
    const range = 'Sheet1!A:A';
    const feedUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;

    fetch(feedUrl)
      .then(res => res.json())
      .then(obj => {
        const values = obj.values || [];
        const polygons = parsePolygonFromSheetValues(values);
        const now = new Date();
        
        // Build a set of valid sheet indices from current sheet data
        const currentSheetIndices = new Set();
        if (polygons && polygons.length) {
          polygons.forEach((_, idx) => {
            currentSheetIndices.add(`sheet-eyewatch-${idx}`);
          });
        }
        
        // Remove Eye Watch entries that are expired OR no longer in Google Sheets
        Object.keys(polygonsById).forEach(id => {
          if (id.startsWith('sheet-eyewatch-')) {
            const polygon = polygonsById[id];
            const expires = polygon?.properties?.expires ? new Date(polygon.properties.expires) : null;
            const isExpired = expires && now > expires;
            const isNotInSheet = !currentSheetIndices.has(id);

            // Remove if expired OR not in current sheet data
            if (isExpired || isNotInSheet) {
              // delete from lookup
              delete polygonsById[id];

              // Remove from alert list (DOM)
              try {
                const listContent = document.getElementById('nws-alerts-list-content');
                if (listContent) {
                  const element = listContent.querySelector(`[data-alert-id="${id}"]`);
                  if (element) element.remove();
                }
              } catch (e) { /* ignore DOM removal errors */ }

              // Remove from global stub arrays
              try {
                if (Array.isArray(window.sheetPolygonFeatures)) {
                  window.sheetPolygonFeatures = window.sheetPolygonFeatures.filter(f => f.id !== id);
                }
                if (Array.isArray(window.nwsAlertFeatures)) {
                  window.nwsAlertFeatures = window.nwsAlertFeatures.filter(f => f.id !== id);
                }
              } catch (e) { /* ignore */ }
            }
          }
        });

        // After pruning polygonsById, update the sheet-polygon source on all maps so visuals reflect removals
        try {
          const remainingSheetFeatures = Object.values(polygonsById)
            .filter(p => p && p.properties && String(p.properties.id).startsWith('sheet-eyewatch-'))
            .map(p => ({ type: 'Feature', geometry: p.geometry, properties: p.properties }));

          getAlertPolygonMaps().forEach(m => {
            try {
              if (!m || typeof m.getSource !== 'function') return;
              const src = m.getSource('sheet-polygon');
              if (src && typeof src.setData === 'function') {
                src.setData({ type: 'FeatureCollection', features: remainingSheetFeatures });
              }
            } catch (e) {
              console.warn('Error updating sheet-polygon source on map', e);
            }
          });
        } catch (e) {
          console.warn('Error updating sheet polygon sources after removals', e);
        }
        // Update/add new ones from sheet
        if (polygons && polygons.length) {
          addSheetPolygonToMap(polygons);
        }
      })
      .catch(console.error);
  }

  // --- Polling functions ---
  // RainViewer polling removed (no-op)

  function mergeAlertFeatures(existing, incoming) {
    if (!Array.isArray(existing) || existing.length === 0) return Array.isArray(incoming) ? incoming : [];
    if (!Array.isArray(incoming) || incoming.length === 0) return existing;
    const merged = {};
    existing.forEach(f => {
      if (f && f.id) merged[f.id] = f;
    });
    incoming.forEach(f => {
      if (f && f.id) merged[f.id] = f;
    });
    return Object.values(merged);
  }

  function pollNwsAlerts(streamSnapshot) {
    if (window.__voltadarAlertsSseHealthy === true && !streamSnapshot) {
      return;
    }

    function runPollFromData(data) {
        let features = Array.isArray(data.features) ? data.features : [];
        if (streamSnapshot && window.__voltadarAlertsSseHealthy === true) {
          features = mergeAlertFeatures(Array.isArray(window.nwsAlertFeatures) ? window.nwsAlertFeatures : [], features);
        }
        window.nwsAlertFeatures = features;

        const now = new Date();
        const activeIds = new Set(features.map(f => f.id));
        
        // Remove expired/inactive alerts from map and list
        let removedAnyAlert = false;
        Object.keys(polygonsById).forEach(id => {
          if (!id.startsWith('sheet-eyewatch-')) { // Only process NWS alerts
            const polygon = polygonsById[id];
            const expires = polygon?.properties?.expires ? new Date(polygon.properties.expires) : null;
            // When a polygon is a synthetic zone polygon, it may have a parentAlertId
            const keyToCheck = (polygon && polygon.properties && (polygon.properties.parentAlertId || polygon.properties.id)) || id;
            // Remove if expired or not in current API response
            if (!expires || now > expires || !activeIds.has(keyToCheck)) {
              delete polygonsById[id];
              removedAnyAlert = true;
              // Remove from list
              const listContent = document.getElementById('nws-alerts-list-content');
              if (listContent) {
                const element = listContent.querySelector(`[data-alert-id="${id}"]`);
                if (element) element.remove();
              }
            }
          }
        });

        // Update map layers ONCE after all removals, instead of once per removed alert.
        // (This used to run setData() inside the loop above — when several alerts expired
        // in the same poll cycle that meant several full source rebuilds back-to-back,
        // which is what was causing the map to stutter.)
        if (removedAnyAlert) {
          const updatedFeatures = Object.values(polygonsById)
            .filter(p => !p.properties.id.startsWith('sheet-eyewatch-')); // Only include NWS alerts
          getAlertPolygonMaps().forEach(m => {
            try {
              if (m && m.getSource && m.getSource('nws-alert-polygons')) {
                m.getSource('nws-alert-polygons').setData({
                  type: 'FeatureCollection',
                  features: updatedFeatures
                });
              }
            } catch (e) { /* ignore per-map errors */ }
          });
        }
        
        // Process new alerts
        let newPolygons = [];
        let newAlertHtml = '';
        let hasUpdatedAlerts = false; // true when an existing alert's geometry/color/name/etc. changed, so the map + list still need to re-render even though no *new* alert came in

        for (const feature of features) {
          const props = feature.properties;
          const id = feature.id;
          const existingPolygon = polygonsById[id];
          const isExisting = !!existingPolygon;

          const event = props.event;
          const expiresText = props.expires;
          const expires = expiresText ? new Date(expiresText) : null;
          if (!event || !feature.geometry || !expiresText || now > expires) continue;

          // Parse additional parameter values
          const parameters = props.parameters || {};
          let maxHailSize = '', maxWindGust = '';
          if (parameters.maxHailSize) maxHailSize = parameters.maxHailSize[0];
          if (parameters.maxWindGust) maxWindGust = parameters.maxWindGust[0];
          const flashThreat = parameters.flashFloodDamageThreat?.[0];
          const tornadoDetection = parameters.tornadoDetection?.[0];
          const tornadoDamageThreat = parameters.tornadoDamageThreat?.[0];
          const thunderstormDamageThreat = parameters.thunderstormDamageThreat?.[0];

          // Compute an enhanced displayEvent based on detection/damage threat values
          let displayEvent = event;
          if (event.includes('Flash Flood Warning')) {
            if (flashThreat === 'CATASTROPHIC') {
              displayEvent = '⚠ Flash Flood Emergency';
            } else if (flashThreat === 'CONSIDERABLE') {
              displayEvent = 'Considerable Flash Flood Warning';
            }
          } else if (event.includes('Tornado Warning')) {
            if (tornadoDetection === 'OBSERVED' && tornadoDamageThreat === 'CATASTROPHIC') {
              displayEvent = '⚠ Tornado Emergency';
            } else if ((tornadoDetection === 'OBSERVED' || tornadoDetection === 'RADAR INDICATED') &&
                       tornadoDamageThreat === 'CONSIDERABLE') {
              displayEvent = '⚠ PDS Tornado Warning';
            } else if (tornadoDetection === 'OBSERVED') {
              displayEvent = 'Observed Tornado Warning';
            } else if (tornadoDetection === 'RADAR INDICATED') {
              displayEvent = 'Radar Indicated Tornado Warning';
            }
          } else if (event.includes('Severe Thunderstorm Warning')) {
            if (thunderstormDamageThreat === 'DESTRUCTIVE') {
              displayEvent = '⚠ Destructive Severe Thunderstorm Warning';
            } else if (thunderstormDamageThreat === 'CONSIDERABLE') {
              displayEvent = 'Considerable Severe Thunderstorm Warning';
            }
          }

          // Existing color/priority logic
          let fillColor = 'grey'; // default
          let priority = 0;
          if (event.includes('Tornado Warning')) {
          if (tornadoDetection === 'OBSERVED' && tornadoDamageThreat === 'CATASTROPHIC') { fillColor = '#460095'; priority = 110; }
          else if ((tornadoDetection === 'OBSERVED' || tornadoDetection === 'RADAR INDICATED') &&
                   tornadoDamageThreat === 'CONSIDERABLE') { fillColor = '#DE17C9'; priority = 100; }
          else if (tornadoDetection === 'OBSERVED') { fillColor = '#8B0000'; priority = 90; }
          else if (tornadoDetection === 'RADAR INDICATED') { fillColor = 'red'; priority = 70; }
          else { fillColor = 'red'; priority = 70; }
        }
        else if (event.includes('Flash Flood Warning')) {
          if (flashThreat === 'CATASTROPHIC') { fillColor = 'green'; priority = 80; }
          else if (flashThreat === 'CONSIDERABLE') { fillColor = '#01b70e'; priority = 40; }
          else { fillColor = 'lime'; priority = 30; }
        }
        else if (event.includes('Severe Thunderstorm Warning')) {
          if (thunderstormDamageThreat === 'DESTRUCTIVE') { fillColor = '#FF8100'; priority = 65; }
          else if (thunderstormDamageThreat === 'CONSIDERABLE') { fillColor = '#B8860B'; priority = 60; }
          else { fillColor = '#FFAA00'; priority = 55; }
        }
        else if (event.includes('Snow Squal Warning')) {
          fillColor = 'rgb(149, 149, 149)'; priority = 15;
        }
        else if (event.includes('Special Weather Statement')) {
          fillColor = 'rgb(160, 106, 217)'; priority = 18;
        }
        else if (event.includes('Marine Weather Statement')) {
        fillColor = 'rgb(206, 198, 144)'; priority = 17;
      }
        else if (event.includes('Flood Advisory')) {
          fillColor = 'rgb(156, 255, 170)'; priority = 9;
        }
        else if (event.includes('Flood Warning')) {
          fillColor = 'rgb(92, 255, 114)'; priority = 8;
        }
        else if (event.includes('Flood Watch')) {
          fillColor = 'rgb(159, 255, 246)'; priority = 8;
        }
        else if (event.includes('Special Marine Warning')) {
          fillColor = 'rgb(219, 71, 255)'; priority = 17.5;
        }
        else if (event.includes('Tornado Watch')) {
        fillColor = 'rgb(255, 85, 85)'; priority = 14.9;
      }
      else if (event.includes('Severe Thunderstorm Watch')) {
        fillColor = 'rgb(253, 255, 133)'; priority = 14.8;
      }
      else if (event.includes('Flash Flood Watch')) {
        fillColor = 'rgb(159, 255, 246)'; priority = 14.7;
      }
      else if (event.includes('Blizzard Warning')) {
        fillColor = '#0000f6'; priority = 13.95;
      }
      else if (event.includes('Ice Storm Warning')) {
        fillColor = '#6C2DA5'; priority = 13.9;
      }
      else if (event.includes('Winter Storm Warning')) {
        fillColor = '#0073ff'; priority = 13.85;
      }
      else if (event.includes('Winter Weather Advisory')) {
        fillColor = '#657fff'; priority = 13.8;
      }
      else if (event.includes('Lake Effect Snow Warning')) {
        fillColor = '#008B8A'; priority = 13.75;
      }
      else if (event.includes('Avalanche Warning')) {
        fillColor = '#36C6FF'; priority = 13.7;
      }
      else if (event.includes('Extreme Cold Warning')) {
        fillColor = '#0A47FF'; priority = 13.65;
      }
      else if (event.includes('Freeze Warning')) {
        fillColor = '#5F4B7C'; priority = 13.6;
      }
      else if (event.includes('Blizzard Watch')) {
        fillColor = '#5a6bd9'; priority = 13.55;
      }
      else if (event.includes('Winter Storm Watch')) {
        fillColor = '#75B6FF'; priority = 13.5;
      }
      else if (event.includes('Avalanche Watch')) {
        fillColor = '#F4A261'; priority = 13.45;
      }
      else if (event.includes('Extreme Cold Watch')) {
        fillColor = '#4DB6AC'; priority = 13.4;
      }
      else if (event.includes('Freeze Watch')) {
        fillColor = '#00F2E6'; priority = 13.35;
      }
      else if (event.includes('Cold Weather Advisory')) {
        fillColor = '#CFF8F0'; priority = 13.3;
      }
      else if (event.includes('Frost Advisory')) {
        fillColor = '#6EA7FF'; priority = 13.25;
      }
      else if (event.includes('Dust Storm Warning')) {
        fillColor = '#ffe9d1'; priority = 12.85;
      }
      else if (event.includes('Blowing Dust Warning')) {
        fillColor = '#fff0d5'; priority = 12.8;
      }
      else if (event.includes('Dense Fog Advisory')) {
        fillColor = '#6f7b84'; priority = 12.6;
      }
      else if (event.includes('Dense Fog (marine) Advisory')) {
        fillColor = '#6d7d86'; priority = 12.55;
      }
      else if (event.includes('Dense Smoke Advisory')) {
        fillColor = '#fff2a8'; priority = 12.5;
      }
      else if (event.includes('Extreme Wind Warning')) {
        fillColor = '#ff9a1a'; priority = 12.95;
      }
      else if (event.includes('Hurricane Force Wind Warning')) {
        fillColor = '#c75b5b'; priority = 12.9;
      }
      else if (event.includes('High Wind Warning')) {
        fillColor = '#efb700'; priority = 12.75;
      }
      else if (event.includes('Hurricane Force Wind Watch')) {
        fillColor = '#8e44ff'; priority = 12.7;
      }
      else if (event.includes('High Wind Watch')) {
        fillColor = '#ffc800'; priority = 12.65;
      }
      else if (event.includes('Red Flag Warning')) {
        fillColor = '#ff956e'; priority = 13.2;
      }
        // Tropical alerts (11.x)
        else if (event.includes('Storm Surge Warning')) {
          fillColor = '#263447'; priority = 11.9;
        }
        else if (event.includes('Hurricane Warning')) {
          fillColor = '#5a0d0d'; priority = 11.85;
        }
        else if (event.includes('Typhoon Warning')) {
          fillColor = '#d63b4e'; priority = 11.8;
        }
        else if (event.includes('Tropical Storm Warning')) {
          fillColor = '#d9534f'; priority = 11.75;
        }
        else if (event.includes('Storm Surge Watch')) {
          fillColor = '#6d5ed6'; priority = 11.5;
        }
        else if (event.includes('Hurricane Watch')) {
          fillColor = '#7a2b2b'; priority = 11.45;
        }
        else if (event.includes('Typhoon Watch')) {
          fillColor = '#c97b7b'; priority = 11.4;
        }
        else if (event.includes('Tropical Storm Watch')) {
          fillColor = '#e05a4f'; priority = 11.35;
        }
        // Marine alerts (9.x)
        else if (event.includes('Heavy Freezing Spray Warning')) {
          fillColor = '#39c5ff'; priority = 9.95;
        }
        else if (event.includes('Gale Warning')) {
          fillColor = '#e8c7ff'; priority = 9.9;
        }
        else if (event.includes('Hazardous Seas Warning')) {
          fillColor = '#4b4f5a'; priority = 9.85;
        }
        else if (event.includes('Storm Warning')) {
          fillColor = '#4b5370'; priority = 9.8;
        }
        else if (event.includes('Small Craft Advisory')) {
          fillColor = '#e0c3f2'; priority = 9.6;
        }
        else if (event.includes('Freezing Spray Advisory')) {
          fillColor = '#26c8ff'; priority = 9.55;
        }
        else if (event.includes('Brisk Wind Advisory')) {
          fillColor = '#e9d3f0'; priority = 9.5;
        }
        else if (event.includes('Low Water Advisory')) {
          fillColor = '#8b2f2f'; priority = 9.45;
        }
        else if (event.includes('Storm Watch')) {
          fillColor = '#f3d9a5'; priority = 9.3;
        }
        else if (event.includes('Gale Watch')) {
          fillColor = '#f1bfc2'; priority = 9.25;
        }
        else if (event.includes('Hazardous Seas Watch')) {
          fillColor = '#4b3b6d'; priority = 9.2;
        }
        else if (event.includes('Heavy Freezing Spray Watch')) {
          fillColor = '#b57a75'; priority = 9.15;
        }
        // Heat alerts (10.x)
        else if (event.includes('Extreme Heat Warning')) {
          fillColor = '#d9006a'; priority = 10.95;
        }
        else if (event.includes('Extreme Heat Watch')) {
          fillColor = '#5a0000'; priority = 10.9;
        }
        else if (event.includes('Heat Advisory')) {
          fillColor = '#ff8a00'; priority = 10.5;
        }
        else if (event.includes('Fire Warning')) {
          fillColor = '#a24f2f'; priority = 10.85;
        }
        else if (event.includes('Fire Weather Watch')) {
          fillColor = '#ffd9a6'; priority = 10.4;
        }
        else if (event.includes('Blowing Dust Advisory')) {
        fillColor = '#d1bd6c'; priority = 7;
      }
      else if (event.includes('Dust Advisory')) {
        fillColor = '#c4b55d'; priority = 7;
      }
      else if (event.includes('Lake Wind Advisory')) {
        fillColor = '#d6b681'; priority = 7;
      }
      else if (event == 'Wind Advisory' || (event.includes('Wind Advisory') && !event.includes('Brisk Wind Advisory') && !event.includes('Lake Wind Advisory'))) {
        fillColor = '#d2b67d'; priority = 7;
      }
      else if (event.includes('Freezing Fog Advisory')) {
        fillColor = '#008B8A'; priority = 7;
      }
      else if (event.includes('Air Stagnation Advisory')) {
        fillColor = '#7d7d7d'; priority = 7;
      }
      else if (event.includes('Air Quality Alert')) {
        fillColor = '#7d7d7d'; priority = 7;
      }
      else if (event.includes('Blowing Dust Advisory')) {
        fillColor = '#d1bd6c'; priority = 7;
      }
      else if (event.includes('Dust Advisory')) {
        fillColor = '#c4b55d'; priority = 7;
      }
      else if (event.includes('Lake Wind Advisory')) {
        fillColor = '#d6b681'; priority = 7;
      }
      else if (event == 'Wind Advisory' || (event.includes('Wind Advisory') && !event.includes('Brisk Wind Advisory') && !event.includes('Lake Wind Advisory'))) {
        fillColor = '#d2b67d'; priority = 7;
      }
      else if (event.includes('Freezing Fog Advisory')) {
        fillColor = '#008B8A'; priority = 7;
      }
      else if (event.includes('Air Stagnation Advisory')) {
        fillColor = '#7d7d7d'; priority = 7;
      }
      else if (event.includes('Air Quality Alert')) {
        fillColor = '#7d7d7d'; priority = 7;
      }
      else if (event.includes('Blowing Dust Advisory')) {
        fillColor = '#d1bd6c'; priority = 7;
      }
      else if (event.includes('Dust Advisory')) {
        fillColor = '#c4b55d'; priority = 7;
      }
      else if (event.includes('Lake Wind Advisory')) {
        fillColor = '#d6b681'; priority = 7;
      }
      else if (event == 'Wind Advisory' || (event.includes('Wind Advisory') && !event.includes('Brisk Wind Advisory') && !event.includes('Lake Wind Advisory'))) {
        fillColor = '#d2b67d'; priority = 7;
      }
      else if (event.includes('Freezing Fog Advisory')) {
        fillColor = '#008B8A'; priority = 7;
      }
      else if (event.includes('Air Stagnation Advisory')) {
        fillColor = '#7d7d7d'; priority = 7;
      }
      else if (event.includes('Air Quality Alert')) {
        fillColor = '#7d7d7d'; priority = 7;
      }

          // allow user override stored in localStorage (match displayEvent first)
          const savedOverride = getSavedColorForEvent(displayEvent, event);
          if (savedOverride) fillColor = savedOverride;
          // GeoJSON polygons: coordinates[0] is [ [lng, lat], ... ]
          let geometry = null;
          if (feature.geometry.type === "Polygon") {
            geometry = {
              type: "Polygon",
              coordinates: feature.geometry.coordinates
            };
          } else if (feature.geometry.type === "MultiPolygon") {
            geometry = {
              type: "MultiPolygon",
              coordinates: feature.geometry.coordinates
            };
          } else {
            continue;
          }
          const polygonFeature = {
            type: "Feature",
            geometry: geometry,
            properties: {
              id: id,
              event: event,
              displayEvent: displayEvent,
              fillColor: fillColor,
              priority: priority,
              expires: expiresText,
              areaDesc: props.areaDesc || '',
              maxHailSize: maxHailSize,
              maxWindGust: maxWindGust,
              description: props.description || existingPolygon?.properties?.description || '',
              parameters: props.parameters || existingPolygon?.properties?.parameters || {}
            }
          };

          if (isExisting) {
            const previousExpires = existingPolygon?.properties?.expires || '';
            const previousArea = existingPolygon?.properties?.areaDesc || '';
            const previousDisplayEvent = existingPolygon?.properties?.displayEvent || existingPolygon?.properties?.event || '';
            const previousFillColor = existingPolygon?.properties?.fillColor || '';
            const previousGeometry = existingPolygon?.geometry ? JSON.stringify(existingPolygon.geometry) : '';
            const isUpdatedAlert = previousExpires !== expiresText || previousArea !== (props.areaDesc || '') ||
              previousDisplayEvent !== displayEvent || previousFillColor !== fillColor ||
              previousGeometry !== JSON.stringify(geometry);
            polygonsById[id] = polygonFeature;
            if (isUpdatedAlert) {
              // This alert's geometry/color/name/etc. changed in place (same id). It needs the same
              // map + list re-render a brand-new alert gets below — otherwise the map polygon, its
              // color, and the sidebar row all keep showing the stale version until the browser is
              // reloaded, even though polygonsById (and therefore the click popup) already has the
              // fresh data.
              hasUpdatedAlerts = true;
              maybePlayAlertSound(displayEvent, 'updated');
              maybeStartAlertFlash(displayEvent, 'updated', id, fillColor);
            }
            continue;
          }

          newPolygons.push(polygonFeature);
          polygonsById[id] = polygonFeature;
          maybePlayAlertSound(displayEvent, 'new');
          maybeStartAlertFlash(displayEvent, 'new', id, fillColor);

          // Create alert list item HTML
          newAlertHtml += `
            <div class="nws-alert-item" data-alert-id="${id}" style="cursor:pointer;">
              <span class="nws-alert-color-box" style="background:${fillColor};"></span>
              <span class="nws-alert-event">${displayEvent}</span>
              <div class="nws-alert-expires">Expires: ${expiresText.replace('T',' ').replace('Z',' UTC')}</div>
            </div>
          `;
        }

        // Update map with new OR updated polygons (main + dual — same data as Active Alerts list)
        if (newPolygons.length > 0 || hasUpdatedAlerts) {
          queueAlertPolygonRefresh();
          try {
            if (typeof window._ensureNwsAlertPolygonsLayers === 'function') {
              window._ensureNwsAlertPolygonsLayers();
            }
          } catch (e) { /* ignore */ }
        }

        // Update alerts list with new OR updated items
        if (newAlertHtml || hasUpdatedAlerts) {
          const listContent = document.getElementById('nws-alerts-list-content');
          if (listContent) {
            // Instead of just inserting new alerts, get all alerts and sort them
            // Build one representative per original alert id (use parentAlertId when present)
            const repMap2 = {};
            Object.values(polygonsById).forEach(f => {
              const key = (f.properties && f.properties.parentAlertId) || (f.properties && f.properties.id) || null;
              if (!key) return;
              if (!repMap2[key]) repMap2[key] = f;
              else {
                const existing = repMap2[key];
                const existingIsSynthetic = existing.properties && existing.properties.parentAlertId;
                const candidateIsSynthetic = f.properties && f.properties.parentAlertId;
                if (existingIsSynthetic && !candidateIsSynthetic) repMap2[key] = f;
                else if ((Number(f.properties.priority) || 0) > (Number(existing.properties.priority) || 0)) repMap2[key] = f;
              }
            });

            const allAlerts2 = Object.keys(repMap2).map(k => repMap2[k]);
            allAlerts2.sort((a, b) => (Number(b.properties.priority) || 0) - (Number(a.properties.priority) || 0));

            const sortedHtml = allAlerts2.map(feature => `
              <div class="nws-alert-item" data-alert-id="${(feature.properties && feature.properties.parentAlertId) || feature.properties.id}" style="cursor:pointer;">
                <span class="nws-alert-color-box" style="background:${feature.properties.fillColor};"></span>
                <span class="nws-alert-event">${feature.properties.displayEvent}</span>
                <div class="nws-alert-expires">Expires: ${feature.properties.expires.replace('T',' ').replace('Z',' UTC')}</div>
              </div>
            `).join('');

            // Replace entire content with sorted alerts
            listContent.innerHTML = sortedHtml || '<div>No active alerts.</div>';

            // Re-attach click handlers
            document.querySelectorAll('.nws-alert-item').forEach(element => {
              element.onclick = function() {
                const alertId = this.getAttribute('data-alert-id');
                // If this is a sheet (Eye Watch) alert, only zoom + show the marker popup and do NOT show the summary panel
                if (alertId && alertId.startsWith('sheet-eyewatch-')) {
                  const f = polygonsById[alertId];
                  if (!f || !f.geometry) return;
                  let coordinates = [];
                  if (f.geometry.type === "Polygon") coordinates = f.geometry.coordinates[0];
                  else if (f.geometry.type === "MultiPolygon") coordinates = f.geometry.coordinates[0][0];
                  if (coordinates.length) {
                    const bounds = coordinates.reduce((bounds, coord) => bounds.extend(coord), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
                    map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 4000 });
                    try { showAlertPopupForFeature(f, bounds.getCenter()); } catch(e){/*ignore*/ }
                  }
                  return; // stop here — do not run the generic NWS summary logic
                }
                const feature = polygonsById[alertId];
                if (!feature || !feature.geometry) return;
                // Zoom to polygon
                let coordinates = [];
                if (feature.geometry.type === "Polygon") {
                  coordinates = feature.geometry.coordinates[0];
                } else if (feature.geometry.type === "MultiPolygon") {
                  coordinates = feature.geometry.coordinates[0][0];
                }
                if (coordinates.length) {
                  const bounds = coordinates.reduce((bounds, coord) => {
                    return bounds.extend(coord);
                  }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
                  map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 4000 });
                }

                // Keep the alert row click focused on the map and avoid opening the summary panel.
                hideAlertSummaryPanel();
              };
            });
          }
        }
    }

    if (streamSnapshot && typeof streamSnapshot === 'object' && Array.isArray(streamSnapshot.features)) {
      window.__voltadarAlertsSseHealthy = true;
      runPollFromData(streamSnapshot);
      return;
    }

    fetchActiveAlertsHttp()
      .then(runPollFromData)
      .catch(console.error);
  }
  window.pollNwsAlerts = pollNwsAlerts;
  // --- Poll every 1 second ---
  // setInterval(pollNwsAlerts, 2000); // Removed redundant polling
  setInterval(pollSheetPolygons, 2500);
 

  // --- Initial load after map is ready ---
  map.on('load', () => {
    // Add US Counties GeoJSON
    map.addSource('us-counties', {
      type: 'geojson',
      data: 'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json'
    });

    // Add county boundary lines (thin outline)
    map.addLayer({
      id: 'county-lines',
      type: 'line',
      source: 'us-counties',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#999',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          4, 0.5,
          8, 1,
          12, 2
        ],
        'line-opacity': 0.5
      }
    }, 'nws-alert-polygons-fill'); // Insert before alert polygons
    // RainViewer immediate fetch removed
    // Removed radar data fetching logic

    // RainViewer polling removed
    pollNwsAlerts();
    pollSheetPolygons();
  });
})();