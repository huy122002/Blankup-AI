/* ============================================================
   ORDER REALTIME STREAM (shared by the account and admin pages)

   Server-Sent Events delivered over fetch() + ReadableStream rather than
   EventSource, because EventSource cannot send an Authorization header and
   putting a JWT in the query string would leak it into access logs.

   The stream is the fast path; callers keep their own polling as a safety net,
   so a blocked proxy or a sleeping laptop can only make updates slower — never
   stale forever.
   ============================================================ */
(function () {
  'use strict';

  function apiBase() {
    return window.location.origin + '/api';
  }

  function hasAuth() {
    return window.auth && typeof window.auth.getAuthHeaders === 'function' && typeof window.auth.token === 'string' && window.auth.token;
  }

  /**
   * Watch the order stream.
   * @param {{onEvent?: Function, onOpen?: Function, onError?: Function}} options
   * @returns {{stop: Function}} handle
   */
  function watchOrderStream(options) {
    const opts = options || {};
    const controller = { stopped: false, abort: null, retries: 0 };

    async function connect() {
      if (controller.stopped) return;
      if (typeof fetch !== 'function' || typeof TextDecoder === 'undefined') return;

      // Only signed-in users consume this stream (admin gets every order, a user
      // gets their own). The guest checkout modal uses its per-order token flow.
      if (!hasAuth()) return;

      const ac = new AbortController();
      controller.abort = () => ac.abort();

      try {
        const resp = await fetch(apiBase() + '/orders/stream', {
          method: 'GET',
          headers: window.auth.getAuthHeaders(),
          signal: ac.signal,
          cache: 'no-store',
        });
        if (!resp.ok || !resp.body) throw new Error('order stream unavailable (' + resp.status + ')');

        controller.retries = 0;
        if (typeof opts.onOpen === 'function') opts.onOpen();

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });

          let sep;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const payload = frame
              .split('\n')
              .filter(function (line) { return line.indexOf('data:') === 0; })
              .map(function (line) { return line.slice(5).trim(); })
              .join('\n');
            if (!payload) continue; // heartbeat / comment frame
            try {
              const event = JSON.parse(payload);
              if (event && event.type === 'order.updated' && typeof opts.onEvent === 'function') {
                opts.onEvent(event);
              }
            } catch (err) { /* ignore a malformed frame, keep the stream */ }
          }
        }
        throw new Error('order stream ended');
      } catch (err) {
        if (controller.stopped) return;
        if (typeof opts.onError === 'function') opts.onError(err);
        controller.retries += 1;
        // Back off (capped) so a server that is down is not hammered.
        const wait = Math.min(30000, 2000 * Math.pow(1.7, Math.min(controller.retries, 6)));
        setTimeout(connect, Math.round(wait + Math.random() * 1000));
      }
    }

    connect();

    return {
      stop: function () {
        controller.stopped = true;
        if (controller.abort) { try { controller.abort(); } catch (e) { /* already closed */ } }
      },
    };
  }

  window.watchOrderStream = watchOrderStream;
})();
