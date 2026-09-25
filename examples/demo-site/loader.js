// Loads the Croquis widget with the ingest key from the URL hash (demo only —
// a real site pastes the <script> snippet from the project settings).
(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  const stored = JSON.parse(sessionStorage.getItem('croquis-demo') || '{}');
  const key = params.get('key') || stored.key;
  const api = params.get('api') || stored.api || 'http://localhost:8787';
  if (!key) {
    console.info('[demo] add #key=ing_…&api=http://localhost:8787 to the URL to load the widget');
    return;
  }
  sessionStorage.setItem('croquis-demo', JSON.stringify({ key, api }));
  const script = document.createElement('script');
  script.src = `${api}/widget.js`;
  script.dataset.croquisKey = key;
  script.defer = true;
  document.body.appendChild(script);
})();
