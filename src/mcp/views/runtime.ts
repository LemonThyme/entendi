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

  // Wrap SDK notification params to match the format views expect:
  // Views read params.result.content, params.arguments
  // SDK ontoolinput gives { arguments }, ontoolresult gives { content, isError }
  app.ontoolinput = function(params) {
    var wrapped = { arguments: params.arguments };
    for (var i = 0; i < toolResultHandlers.length; i++) {
      try { toolResultHandlers[i](wrapped); } catch(e) {}
    }
  };

  app.ontoolresult = function(params) {
    var wrapped = { result: { content: params.content, isError: params.isError } };
    for (var i = 0; i < toolResultHandlers.length; i++) {
      try { toolResultHandlers[i](wrapped); } catch(e) {}
    }
  };

  app.onhostcontextchanged = function(ctx) {
    applyTheme(ctx.theme);
  };

  window.EntendiApp = {
    init: function(name, onReady) {
      // Use (window.parent, window.parent) as per SDK docs for views
      var transport = new McpApps.PostMessageTransport(window.parent, window.parent);
      app.connect(transport).then(function() {
        var ctx = app.getHostContext();
        if (ctx && ctx.theme) applyTheme(ctx.theme);
        if (onReady) onReady(ctx);
      }).catch(function(err) {
        console.error('[Entendi] connect failed:', err);
        if (onReady) onReady({});
      });
    },
    callTool: function(name, args) {
      return app.callServerTool({ name: name, arguments: args || {} });
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
