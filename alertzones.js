// alertzones.js
// Helpers to fetch zone geometry from api.weather.gov
(function(){
  const MAX_CONCURRENT_REQUESTS = 10;
  let activeRequests = 0;
  const requestQueue = [];
  const zoneGeometryCache = {}; // Add this line for caching
  const zoneGeometryInFlight = {}; // Tracks in-progress fetches so concurrent callers share one request

  function simplifyGeometry(geometry) {
    if (!geometry || typeof geometry !== 'object') return geometry;

    const simplifyRing = (ring) => {
      if (!Array.isArray(ring) || ring.length < 12) return ring;
      const maxPoints = 140;
      const step = Math.max(1, Math.floor(ring.length / maxPoints));
      const simplified = [];
      for (let i = 0; i < ring.length; i += step) {
        simplified.push(ring[i]);
      }
      const lastPoint = ring[ring.length - 1];
      const lastSaved = simplified[simplified.length - 1];
      if (!lastSaved || JSON.stringify(lastSaved) !== JSON.stringify(lastPoint)) {
        simplified.push(lastPoint);
      }
      return simplified;
    };

    if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((ring) => simplifyRing(ring))
      };
    }

    if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon) => {
          if (!Array.isArray(polygon)) return polygon;
          return polygon.map((ring) => simplifyRing(ring));
        })
      };
    }

    return geometry;
  }

  async function rateLimitedFetch(url, fetcher) {
    return new Promise((resolve, reject) => {
      const task = async () => {
        try {
          const result = await fetcher();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          activeRequests--;
          processQueue();
        }
      };

      requestQueue.push(task);
      processQueue();
    });
  }

  function processQueue() {
    if (activeRequests < MAX_CONCURRENT_REQUESTS && requestQueue.length > 0) {
      const task = requestQueue.shift();
      activeRequests++;
      task();
    }
  }

  async function fetchZoneGeometryUncached(ugc) {
    // Decide endpoint order based on the UGC type character.
    // UGC format is typically: <STATE><TYPE><NUMBER> e.g. VAZ123 or VAC045
    // TYPE 'Z' => forecast zones, TYPE 'C' => county zones
    const urlsFor = {
      forecast: `https://api.weather.gov/zones/forecast/${ugc}`,
      county: `https://api.weather.gov/zones/county/${ugc}`,
      fire: `https://api.weather.gov/zones/fire/${ugc}`
    };

    const typeChar = (ugc && ugc.length >= 3) ? ugc.charAt(2) : '';
    let tryOrder;
    if (typeChar === 'Z') {
      // Z is forecast; if forecast fails, try fire then county
      tryOrder = ['forecast', 'fire', 'county'];
    } else if (typeChar === 'C') {
      // C is county — try county first, then fallbacks
      tryOrder = ['county', 'forecast', 'fire'];
    } else {
      // Unknown type: try forecast, county, then fire (previous default)
      tryOrder = ['forecast', 'county', 'fire'];
    }

    const tryUrls = tryOrder.map(k => urlsFor[k]);

    for (const url of tryUrls) {
      try {
        const res = await rateLimitedFetch(url, () => fetch(url));

        if (!res.ok) {
          console.warn(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
          continue; // Try next URL
        }

        let json;
        try {
          json = await res.json();
        } catch (jsonError) {
          console.warn(`Failed to parse JSON from ${url}:`, jsonError);
          continue; // Try next URL
        }

        // Response can be a Feature or FeatureCollection
        let geometry = null;
        if (json && json.geometry) geometry = json.geometry;
        if (json && Array.isArray(json.features) && json.features[0] && json.features[0].geometry) {
          geometry = json.features[0].geometry;
        }

        if (geometry) {
          const simplifiedGeometry = simplifyGeometry(geometry);
          zoneGeometryCache[ugc] = simplifiedGeometry; // Cache the fetched geometry
          return simplifiedGeometry;
        }
      } catch (networkError) {
        console.warn(`Network error fetching ${url}:`, networkError);
        // try next
      }
    }
    return null;
  }

  window.fetchZoneGeometry = async function(ugc) {
    if (!ugc) return null;
    // Ensure UGC is uppercase and trimmed
    ugc = String(ugc).trim().toUpperCase();

    // Check cache first
    if (zoneGeometryCache[ugc]) {
      return zoneGeometryCache[ugc];
    }

    // If a fetch for this UGC is already running, reuse it instead of firing
    // a duplicate request. Multiple alerts frequently share the same zone,
    // and previously each one raced in before the first fetch finished and
    // populated the cache, so every caller kicked off its own network
    // request and ate one of the 10 concurrent request slots — starving
    // everything else waiting in the queue.
    if (zoneGeometryInFlight[ugc]) {
      return zoneGeometryInFlight[ugc];
    }

    const promise = fetchZoneGeometryUncached(ugc).finally(() => {
      delete zoneGeometryInFlight[ugc];
    });
    zoneGeometryInFlight[ugc] = promise;
    return promise;
  };

  window.extractAlertUGCs = function(props) {
    if (!props) return [];
    const ugcs = new Set();

    const addCodes = (item) => {
      if (!item) return;
      if (Array.isArray(item)) {
        for (const v of item) addCodes(v);
        return;
      }
      // item may be a single string that contains multiple codes separated by
      // spaces, commas, or semicolons. Split and normalize each token.
      const parts = String(item).split(/[\s,;]+/);
      for (const p of parts) {
        const code = String(p || '').trim().toUpperCase();
        if (code) ugcs.add(code);
      }
    };

    // affectedZones: array of resource URLs — last path segment is the zone id
    if (Array.isArray(props.affectedZones)) {
      for (const url of props.affectedZones) {
        try {
          const parts = String(url).split('/');
          const id = parts.pop() || parts.pop();
          if (id) ugcs.add(id.toUpperCase());
        } catch (e) { /* ignore */ }
      }
    }

    // parameters.UGC sometimes contains codes (array or joined string)
    try {
      const p = props.parameters || {};
      if (p.UGC) addCodes(p.UGC);
    } catch (e) { /* ignore */ }

    // geocode.UGC is commonly used in NWS alert payloads
    try {
      const g = props.geocode || {};
      if (g && g.UGC) addCodes(g.UGC);
    } catch (e) { /* ignore */ }

    // fallback top-level properties
    try {
      if (props.UGC) addCodes(props.UGC);
      if (props.ugc) addCodes(props.ugc);
    } catch (e) { /* ignore */ }

    return Array.from(ugcs);
  };
})();
