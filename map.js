(function () {
  const styleUrl = 'https://api.maptiler.com/maps/01977485-3327-711a-8309-09c8d9dcc02b/style.json?key=CmQHmGrZ2Xo39Iqx78BO';

  if (typeof maplibregl === 'undefined') {
    console.warn('MapLibre GL is not available yet.');
    return;
  }

  const map = new maplibregl.Map({
    container: 'map',
    style: styleUrl,
    center: [-98.5, 39.5],
    zoom: 3.7,
    minZoom: 2,
    maxZoom: 12,
    attributionControl: false,
    pitchWithRotate: true
  });

  window.map = map;

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

  const notifyMapReady = () => {
    if (!window.__mapReadyDispatched) {
      window.__mapReadyDispatched = true;
      window.dispatchEvent(new Event('mapready'));
    }
  };

  map.on('load', () => {
    map.resize();
    notifyMapReady();
  });

  if (map.loaded()) {
    notifyMapReady();
  }

  window.addEventListener('resize', () => map.resize());
})();
