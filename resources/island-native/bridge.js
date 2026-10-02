(() => {
  const listeners = new Map();
  const send = (type, fields = {}) => window.webkit.messageHandlers.island.postMessage({type, ...fields});
  const on = (name, cb) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(cb); return () => listeners.get(name)?.delete(cb); };
  Object.defineProperty(window, '__islandReceive', {value: (name, data) => { for (const cb of listeners.get(name) || []) cb(data); }});
  Object.defineProperty(window, 'island', {value: Object.freeze({
    onState: cb => on('state', cb), onEnter: cb => on('enter', cb),
    onLeave: cb => on('leave', cb), onCollapse: cb => on('collapse', cb),
    ready: () => send('ready'), hold: value => send('hold', {value}),
    reportSize: (w, h) => send('resize', {w, h}), action: action => send('action', {action})
  })});
})();
