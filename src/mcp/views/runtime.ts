/**
 * Shared MCP Apps view runtime.
 * Uses the official @modelcontextprotocol/ext-apps App class,
 * pre-bundled as IIFE, with a thin EntendiApp wrapper for backward compatibility.
 */
import { APP_BRIDGE_BUNDLE } from './_app-bridge-bundle.js';

export function getViewRuntime(): string {
  return `
${APP_BRIDGE_BUNDLE}

(function() {
  'use strict';

  var toolResultHandlers = [];

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
      if (theme[key]) root.setProperty(map[key], theme[key]);
    }
  }

  var app = new McpApps.App(
    { name: 'Entendi', version: '1.0.0' },
    {}
  );

  var _log = function(msg, data) {
    try { console.log('[Entendi] ' + msg, data !== undefined ? data : ''); } catch(e) {}
  };

  // Wrap SDK notification params to match the format views expect:
  // Views read params.result.content, params.arguments
  // SDK ontoolinput gives { arguments }, ontoolresult gives { content, isError }
  app.ontoolinput = function(params) {
    _log('ontoolinput', params);
    var wrapped = { arguments: params.arguments };
    for (var i = 0; i < toolResultHandlers.length; i++) {
      try { toolResultHandlers[i](wrapped); } catch(e) {}
    }
  };

  app.ontoolresult = function(params) {
    _log('ontoolresult', params);
    var wrapped = { result: { content: params.content, isError: params.isError } };
    for (var i = 0; i < toolResultHandlers.length; i++) {
      try { toolResultHandlers[i](wrapped); } catch(e) {}
    }
  };

  app.onhostcontextchanged = function(ctx) {
    _log('hostcontextchanged', ctx);
    applyTheme(ctx.theme);
  };

  // Listen for raw postMessage events as fallback diagnostic
  window.addEventListener('message', function(event) {
    if (event.data && event.data.jsonrpc) {
      _log('raw postMessage', { method: event.data.method, id: event.data.id, hasResult: !!event.data.result });
    }
  });

  window.EntendiApp = {
    init: function(name, onReady) {
      _log('init called', name);
      var transport = new McpApps.PostMessageTransport(window.parent, window);
      app.connect(transport).then(function() {
        _log('connected', { hostCaps: app.getHostCapabilities(), hostInfo: app.getHostVersion() });
        var ctx = app.getHostContext();
        if (ctx && ctx.theme) applyTheme(ctx.theme);
        if (onReady) onReady(ctx);
      }).catch(function(err) {
        _log('connect FAILED', String(err));
        if (onReady) onReady({});
      });
    },
    callTool: function(name, args) {
      _log('callTool', { name: name, args: args });
      return app.callServerTool({ name: name, arguments: args || {} }).then(function(result) {
        _log('callTool result', result);
        return result;
      }).catch(function(err) {
        _log('callTool FAILED', String(err));
        throw err;
      });
    },
    onToolResult: function(fn) {
      toolResultHandlers.push(fn);
    },
    getHostContext: function() {
      return app.getHostContext() || {};
    },
    openLink: function(url) {
      app.openLink({ url: url }).catch(function() {});
    },
    sendMessage: function(params) {
      return app.sendMessage(params);
    },
    sendNotification: function(method, params) {
      // Forward ui/message notifications to the host via sendMessage
      if (method === 'ui/message' && params) {
        return app.sendMessage({
          role: 'user',
          content: [{ type: 'text', text: JSON.stringify(params) }]
        });
      }
    }
  };
})();
`;
}
