(function () {
  'use strict';

  var BRIDGE_FLAG = '__sqliteBridgeInstalled__';
  if (window[BRIDGE_FLAG]) {
    return;
  }
  window[BRIDGE_FLAG] = true;

  var NAMESPACE = (location.pathname || '/').replace(/[^a-zA-Z0-9_-]/g, '_') || 'global';
  var API_BASE = location.origin;

  function postJson(path, payload) {
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include'
    }).catch(function () {
      return null;
    });
  }

  function bootstrapFromServer() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', API_BASE + '/api/kv/snapshot?namespace=' + encodeURIComponent(NAMESPACE), false);
      xhr.send(null);

      if (xhr.status < 200 || xhr.status >= 300) {
        return;
      }

      var body = JSON.parse(xhr.responseText || '{}');
      var items = body.items || {};
      Object.keys(items).forEach(function (key) {
        var value = items[key];
        if (typeof value === 'string') {
          localStorage.setItem(key, value);
        }
      });
    } catch (err) {
      // Ignore sync bootstrap failures and continue with browser cache.
    }
  }

  function mirrorWholeStorage() {
    try {
      for (var i = 0; i < localStorage.length; i += 1) {
        var key = localStorage.key(i);
        if (!key) {
          continue;
        }
        var value = localStorage.getItem(key);
        if (typeof value === 'string') {
          postJson('/api/kv/upsert', { namespace: NAMESPACE, key: key, value: value });
        }
      }
    } catch (err) {
      // Ignore mirror errors.
    }
  }

  var rawSetItem = localStorage.setItem.bind(localStorage);
  var rawRemoveItem = localStorage.removeItem.bind(localStorage);
  var rawClear = localStorage.clear.bind(localStorage);

  localStorage.setItem = function (key, value) {
    rawSetItem(key, value);
    postJson('/api/kv/upsert', { namespace: NAMESPACE, key: String(key), value: String(value) });
  };

  localStorage.removeItem = function (key) {
    rawRemoveItem(key);
    postJson('/api/kv/delete', { namespace: NAMESPACE, key: String(key) });
  };

  localStorage.clear = function () {
    rawClear();
    postJson('/api/kv/clear', { namespace: NAMESPACE });
  };

  bootstrapFromServer();
  mirrorWholeStorage();

  window.sqliteBridge = {
    namespace: NAMESPACE,
    apiBase: API_BASE,
    sync: mirrorWholeStorage
  };
})();
