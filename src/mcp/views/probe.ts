import { getViewRuntime } from './runtime.js';

/**
 * Probe UI MCP App view.
 * Two states: no-probe (minimal confirmation) and active probe (question + answer).
 * All DOM construction uses createElement/textContent/setAttribute — no innerHTML.
 */
export function getProbeViewHtml(): string {
  const runtime = getViewRuntime();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entendi Probe</title>
<style>
  :root {
    color-scheme: light dark;
    --color-background-primary: light-dark(#F6F4F1, #1a1917);
    --color-background-secondary: light-dark(#EDEAE6, #252320);
    --color-text-primary: light-dark(#2D2A26, #E8E5E1);
    --color-text-secondary: light-dark(#6B6560, #9B9590);
    --color-accent: light-dark(#C4704B, #D4845F);
    --color-border: light-dark(#D9D4CF, #3A3733);
    --color-green: light-dark(#4A9E6B, #5DB87E);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--color-background-primary);
    color: var(--color-text-primary);
    padding: 16px;
    line-height: 1.5;
  }
  .probe-card {
    background: var(--color-background-secondary);
    border: 1px solid var(--color-border);
    border-left: 4px solid var(--color-accent);
    border-radius: 10px; padding: 16px;
  }
  .probe-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .probe-concept {
    font-size: 12px; font-weight: 600; text-transform: uppercase;
    color: var(--color-accent); letter-spacing: 0.5px;
  }
  #probe-question { font-size: 15px; font-weight: 500; margin-bottom: 12px; }
  #probe-answer {
    width: 100%; min-height: 80px; padding: 10px; border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-background-primary);
    color: var(--color-text-primary);
    font-family: inherit; font-size: 14px;
    resize: vertical; margin-bottom: 12px;
  }
  #probe-answer:focus { outline: 2px solid var(--color-accent); outline-offset: -1px; }
  .btn-row { display: flex; gap: 8px; justify-content: flex-end; }
  .submit-btn {
    background: var(--color-accent); color: #fff;
    border: none; border-radius: 8px;
    padding: 8px 20px; font-size: 13px; font-weight: 600;
    cursor: pointer; transition: opacity 0.15s;
  }
  .submit-btn:hover { opacity: 0.85; }
  .submit-btn:disabled { opacity: 0.5; cursor: default; }
  .skip-btn {
    background: transparent; color: var(--color-text-secondary);
    border: 1px solid var(--color-border); border-radius: 8px;
    padding: 8px 16px; font-size: 13px; font-weight: 500;
    cursor: pointer; transition: opacity 0.15s;
  }
  .skip-btn:hover { opacity: 0.7; }
  .skip-btn:disabled { opacity: 0.5; cursor: default; }
  #no-probe {
    text-align: center; padding: 24px 16px;
    color: var(--color-text-secondary);
  }
  .no-probe-icon { font-size: 28px; margin-bottom: 8px; color: var(--color-green); }
  .no-probe-text { font-size: 14px; }
  .feedback-msg {
    text-align: center; padding: 16px;
    color: var(--color-green); font-weight: 500; font-size: 14px;
  }
  .hidden { display: none; }
  .loading { text-align: center; color: var(--color-text-secondary); padding: 24px; }
</style>
</head>
<body>
<div id="probe-container" class="hidden">
  <div class="probe-card">
    <div class="probe-header">
      <span id="probe-concept-label" class="probe-concept"></span>
    </div>
    <div id="probe-question"></div>
    <textarea id="probe-answer" placeholder="Type your answer..."></textarea>
    <div class="btn-row">
      <button id="skip-btn" class="skip-btn">Skip</button>
      <button id="submit-btn" class="submit-btn" disabled>Submit</button>
    </div>
  </div>
</div>
<div id="no-probe" class="hidden">
  <div class="no-probe-icon">&#10003;</div>
  <div class="no-probe-text" id="no-probe-text">Concepts observed. No probe needed right now.</div>
</div>
<div id="feedback" class="hidden">
  <div class="feedback-msg" id="feedback-msg"></div>
</div>
<div id="loading-state" class="loading">Waiting for data...</div>

<script>
${runtime}

(function() {
  'use strict';

  var probeData = null;
  var submitted = false;

  function show(id) {
    var ids = ['probe-container', 'no-probe', 'feedback', 'loading-state'];
    ids.forEach(function(elId) {
      var el = document.getElementById(elId);
      if (el) {
        if (elId === id) el.setAttribute('class', el.getAttribute('class').replace(' hidden', '').replace('hidden', ''));
        else if (el.getAttribute('class').indexOf('hidden') === -1) el.setAttribute('class', (el.getAttribute('class') || '') + ' hidden');
      }
    });
  }

  function showNoProbe(text) {
    var el = document.getElementById('no-probe-text');
    if (el && text) el.textContent = text;
    show('no-probe');
  }

  function showProbe(data) {
    probeData = data;
    var conceptLabel = document.getElementById('probe-concept-label');
    conceptLabel.textContent = data.conceptName || data.concept || '';

    var questionEl = document.getElementById('probe-question');
    questionEl.textContent = data.question || data.probeQuestion || '';

    var answerEl = document.getElementById('probe-answer');
    answerEl.value = '';
    answerEl.disabled = false;

    var submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submit';

    var skipBtn = document.getElementById('skip-btn');
    skipBtn.disabled = false;

    show('probe-container');
    answerEl.focus();
  }

  function showFeedback(msg) {
    var container = document.getElementById('feedback');
    while (container.firstChild) container.removeChild(container.firstChild);
    var msgEl = document.createElement('div');
    msgEl.setAttribute('class', 'feedback-msg');
    msgEl.textContent = msg;
    container.appendChild(msgEl);
    show('feedback');
  }

  // Enable submit when answer is not empty
  var answerInput = document.getElementById('probe-answer');
  var submitBtn = document.getElementById('submit-btn');
  answerInput.addEventListener('input', function() {
    submitBtn.disabled = answerInput.value.trim().length === 0 || submitted;
  });

  // Submit answer
  submitBtn.addEventListener('click', function() {
    if (submitted || answerInput.value.trim().length === 0) return;
    submitted = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    answerInput.disabled = true;
    document.getElementById('skip-btn').disabled = true;

    EntendiApp.sendNotification('ui/message', {
      type: 'probe-response',
      answer: answerInput.value.trim(),
      conceptId: probeData ? (probeData.conceptId || probeData.id) : null
    });

    showFeedback('Answer submitted! The AI will evaluate your response.');
  });

  // Skip / dismiss
  document.getElementById('skip-btn').addEventListener('click', function() {
    if (submitted) return;
    submitted = true;
    document.getElementById('skip-btn').disabled = true;
    submitBtn.disabled = true;
    answerInput.disabled = true;

    EntendiApp.callTool('entendi_dismiss', {
      reason: 'busy',
      note: 'Skipped via MCP App UI'
    }).then(function() {
      showFeedback('Probe skipped.');
    }).catch(function() {
      showFeedback('Probe skipped.');
    });
  });

  function handleObserveResult(data) {
    if (!data) return;
    if (data.shouldProbe && data.probeQuestion) {
      showProbe(data);
    } else {
      var count = data.conceptsObserved || 0;
      var text = count + ' concept' + (count !== 1 ? 's' : '') + ' observed. No probe needed right now.';
      showNoProbe(text);
    }
  }

  // 3-second timeout: if no tool result arrives, show no-probe state
  var dataReceived = false;
  var timeout = setTimeout(function() {
    if (!dataReceived) showNoProbe(null);
  }, 3000);

  EntendiApp.onToolResult(function(params) {
    dataReceived = true;
    clearTimeout(timeout);
    if (params && params.result) {
      try {
        var content = params.result.content;
        if (Array.isArray(content)) {
          for (var i = 0; i < content.length; i++) {
            if (content[i].type === 'text') {
              handleObserveResult(JSON.parse(content[i].text));
              return;
            }
          }
        }
      } catch (e) { /* ignore parse errors */ }
    }
  });

  EntendiApp.init('entendi-probe', function() {
    // The probe view is reactive — it waits for the observe tool result
    // which the host pushes via onToolResult. No active fetch needed.
  });
})();
</script>
</body>
</html>`;
}
