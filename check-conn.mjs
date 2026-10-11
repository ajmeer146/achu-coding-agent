import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3002');
const p = 'C:\\Users\\Achu146\\achu-p18-test\\existing-react-app';

ws.on('open', () => {
  console.log('WS_OPEN path=', JSON.stringify(p));
  ws.send(JSON.stringify({ type: 'select_project', payload: { path: p } }));
});
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  console.log('MSG:', m.type, m.path || m.message || '');
  if (m.type === 'project_selected' || m.type === 'error') {
    ws.close();
    process.exit(m.type === 'project_selected' ? 0 : 1);
  }
});
ws.on('error', (e) => {
  console.error('WS_ERROR', e.message);
  process.exit(1);
});
setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 15000);
