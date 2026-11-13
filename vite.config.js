import { defineConfig } from 'vite';
import { WebSocketServer } from 'ws';

function attachWsRelay(httpServer) {
  if (!httpServer) return;
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('message', (data, isBinary) => {
      const payload = isBinary ? data : data.toString();
      for (const client of clients) {
        if (client !== ws && client.readyState === 1) {
          client.send(payload);
        }
      }
    });
    ws.on('close', () => {
      clients.delete(ws);
    });
    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = req.url ? req.url.split('?')[0] : '';
    if (pathname === '/ws-race') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });
}

function localMultiplayerRelay() {
  return {
    name: 'local-multiplayer-relay',
    configureServer(server) {
      attachWsRelay(server.httpServer);
    },
    configurePreviewServer(server) {
      attachWsRelay(server.httpServer);
    },
  };
}

export default defineConfig({
  plugins: [localMultiplayerRelay()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
