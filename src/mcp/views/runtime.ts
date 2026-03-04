/**
 * Shared MCP Apps view runtime.
 * Returns a JS string to be embedded in a <script> tag in each view.
 * Provides window.EntendiApp with init(), callTool(), onToolResult(),
 * getHostContext(), openLink(), sendNotification().
 */
export function getViewRuntime(): string {
  return `
(function() {
  'use strict';

  var pending = {};
  var nextId = 1;
  var hostContext = {};
  var toolResultHandlers = [];
  var readyCallback = null;

  function sendRpc(method, params) {
    var id = nextId++;
    var msg = { jsonrpc: '2.0', id: id, method: method, params: params || {} };
    window.parent.postMessage(msg, '*');
    return new Promise(function(resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
    });
  }

  function sendNotification(method, params) {
    var msg = { jsonrpc: '2.0', method: method, params: params || {} };
    window.parent.postMessage(msg, '*');
  }

  function applyTheme(theme) {
    if (!theme) return;
    var root = document.documentElement.style;
    var map = {
      'background-primary': '--color-background-primary',
      'background-secondary': '--color-background-secondary',
      'text-primary': '--color-text-primary',
      'text-secondary': '--color-text-secondary',
      'accent': '--color-accent',
      'border': '--color-border'
    };
    for (var key in map) {
      if (theme[key]) {
        root.setProperty(map[key], theme[key]);
      }
    }
  }

  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data || !data.jsonrpc) return;

    // Response to our request
    if (data.id && pending[data.id]) {
      var p = pending[data.id];
      delete pending[data.id];
      if (data.error) {
        p.reject(new Error(data.error.message || 'RPC error'));
      } else {
        p.resolve(data.result);
      }
      return;
    }

    // Notifications from host
    if (data.method === 'ui/notifications/tool-result') {
      for (var i = 0; i < toolResultHandlers.length; i++) {
        toolResultHandlers[i](data.params);
      }
    } else if (data.method === 'ui/notifications/tool-input') {
      for (var j = 0; j < toolResultHandlers.length; j++) {
        toolResultHandlers[j](data.params);
      }
    } else if (data.method === 'ui/notifications/host-context-changed') {
      hostContext = data.params || {};
      applyTheme(hostContext.theme);
    }
  });

  // Auto-resize observer with 50ms debounce
  var resizeTimer = null;
  var observer = new ResizeObserver(function(entries) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      var el = document.documentElement;
      sendNotification('ui/notifications/size-changed', {
        width: el.scrollWidth,
        height: el.scrollHeight
      });
    }, 50);
  });
  observer.observe(document.documentElement);

  window.EntendiApp = {
    init: function(name, onReady) {
      readyCallback = onReady;
      sendRpc('ui/initialize', {
        protocolVersion: '2026-01-26',
        appName: name
      }).then(function(result) {
        if (result && result.hostContext) {
          hostContext = result.hostContext;
          applyTheme(hostContext.theme);
        }
        if (readyCallback) readyCallback(result);
      });
    },
    callTool: function(name, args) {
      return sendRpc('tools/call', { name: name, arguments: args || {} });
    },
    onToolResult: function(fn) {
      toolResultHandlers.push(fn);
    },
    getHostContext: function() {
      return hostContext;
    },
    openLink: function(url) {
      sendNotification('ui/notifications/open-link', { url: url });
    },
    sendNotification: sendNotification
  };
})();
`;
}
