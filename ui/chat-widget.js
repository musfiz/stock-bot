/* Embeddable shop chat widget (dependency-free).
   Usage: <script src="https://your-api/chat-widget.js" data-api="https://your-api"></script> */
(function () {
  var API = (document.currentScript && document.currentScript.dataset.api) || window.CHATBOT_URL || 'http://localhost:3000';
  var sessionId = 'web-' + Math.random().toString(36).slice(2);

  var btn = document.createElement('button');
  btn.textContent = '💬';
  btn.setAttribute('aria-label', 'Chat');
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;width:52px;height:52px;border-radius:50%;border:none;background:#2563eb;color:#fff;font-size:24px;cursor:pointer;z-index:9999;';

  var panel = document.createElement('div');
  panel.style.cssText = 'display:none;position:fixed;bottom:84px;right:20px;width:320px;height:420px;background:#111827;color:#f3f4f6;border:1px solid #374151;border-radius:12px;flex-direction:column;overflow:hidden;z-index:9999;font-family:system-ui,sans-serif;';

  var log = document.createElement('div');
  log.style.cssText = 'flex:1;overflow-y:auto;padding:12px;font-size:14px;';
  var form = document.createElement('form');
  form.style.cssText = 'display:flex;border-top:1px solid #374151;padding:8px;gap:8px;';
  var input = document.createElement('input');
  input.placeholder = 'লিখুন...';
  input.maxLength = 300;
  input.style.cssText = 'flex:1;background:#1f2937;border:1px solid #374151;color:#fff;border-radius:8px;padding:8px;outline:none;';
  var send = document.createElement('button');
  send.textContent = '➤';
  send.style.cssText = 'background:#2563eb;color:#fff;border:none;border-radius:8px;padding:0 12px;cursor:pointer;';
  form.appendChild(input);
  form.appendChild(send);
  panel.appendChild(log);
  panel.appendChild(form);

  function bubble(text, mine) {
    var d = document.createElement('div');
    d.textContent = text;
    d.style.cssText = 'margin:0 0 8px;padding:8px 10px;border-radius:10px;line-height:1.5;' + (mine
      ? 'background:#2563eb;color:#fff;margin-left:auto;max-width:85%;'
      : 'background:#1f2937;color:#f3f4f6;border:1px solid #374151;max-width:90%;');
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  btn.onclick = function () {
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  };

  form.onsubmit = function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    input.value = '';
    bubble(q, true);
    var b = bubble('…', false);
    fetch(API + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q, sessionId: sessionId, stream: false }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { b.textContent = d.reply || 'দুঃখিত, সমস্যা হয়েছে।'; })
      .catch(function () { b.textContent = 'দুঃখিত, সংযোগে সমস্যা হয়েছে।'; });
  };

  document.body.appendChild(btn);
  document.body.appendChild(panel);
  bubble('আসসালামু আলাইকুম! কোন পণ্যের দাম বা stock জানতে চান?', false);
})();
