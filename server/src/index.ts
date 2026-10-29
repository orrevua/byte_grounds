import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { DEFAULT_ROOM } from '@byte_grounds/shared/protocol';
import type {
  ClientToServer,
  PeerId,
  PeerState,
  ServerToClient,
} from '@byte_grounds/shared/protocol';
import { OFFICE_MAP } from '@byte_grounds/shared/maps';
import { Room } from './room.ts';

const PORT = Number(process.env.PORT ?? 8080);

/** One Room per map id; a socket joins exactly one. */
const rooms = new Map<string, Room>();
const sockets = new Map<PeerId, WebSocket>();
const roomOf = new Map<PeerId, string>();

function send(ws: WebSocket, msg: ServerToClient): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(exceptId: PeerId, msg: ServerToClient): void {
  const room = rooms.get(roomOf.get(exceptId) ?? '');
  if (!room) return;
  for (const peer of room.list(exceptId)) {
    const ws = sockets.get(peer.id);
    if (ws) send(ws, msg);
  }
}

/** Signaling only reaches peers in the sender's room. */
function sameRoom(a: PeerId, b: PeerId): boolean {
  return roomOf.has(a) && roomOf.get(a) === roomOf.get(b);
}

// Plain HTTP answers health checks from hosting platforms (e.g. Render); WebSocket upgrades go to `wss`.
const http = createServer((req, res) => {
  const ok = req.url === '/' || req.url === '/healthz';
  res.writeHead(ok ? 200 : 404, { 'content-type': 'text/plain' });
  res.end(ok ? 'ok' : 'not found');
});
const wss = new WebSocketServer({ server: http });
http.listen(PORT);

wss.on('connection', (ws) => {
  const selfId = randomUUID();
  sockets.set(selfId, ws);
  let joined = false;

  ws.on('message', (raw) => {
    let msg: ClientToServer;
    try {
      msg = JSON.parse(raw.toString()) as ClientToServer;
    } catch {
      return; // ignore malformed frames
    }

    switch (msg.type) {
      case 'join': {
        if (joined) return;
        joined = true;
        const roomId = msg.room ?? DEFAULT_ROOM;
        let room = rooms.get(roomId);
        if (!room) rooms.set(roomId, (room = new Room()));
        roomOf.set(selfId, roomId);
        const peer: PeerState = {
          id: selfId,
          name: msg.name,
          color: msg.color,
          appearance: msg.appearance,
          x: Number.isFinite(msg.x) ? msg.x! : OFFICE_MAP.spawn.x,
          y: Number.isFinite(msg.y) ? msg.y! : OFFICE_MAP.spawn.y,
        };
        room.add(peer);
        send(ws, { type: 'welcome', selfId, room: roomId });
        send(ws, { type: 'presence-snapshot', peers: room.list(selfId) });
        broadcast(selfId, { type: 'peer-joined', peer });
        break;
      }
      case 'position': {
        if (rooms.get(roomOf.get(selfId) ?? '')?.updatePosition(selfId, msg.x, msg.y, msg.pose, msg.dir)) {
          broadcast(selfId, {
            type: 'peer-moved',
            id: selfId,
            x: msg.x,
            y: msg.y,
            pose: msg.pose,
            dir: msg.dir,
          });
        }
        break;
      }
      case 'offer': {
        const target = sameRoom(selfId, msg.to) ? sockets.get(msg.to) : undefined;
        if (target) send(target, { type: 'offer', from: selfId, sdp: msg.sdp, sid: msg.sid });
        break;
      }
      case 'answer': {
        const target = sameRoom(selfId, msg.to) ? sockets.get(msg.to) : undefined;
        if (target) send(target, { type: 'answer', from: selfId, sdp: msg.sdp, sid: msg.sid });
        break;
      }
      case 'ice-candidate': {
        const target = sameRoom(selfId, msg.to) ? sockets.get(msg.to) : undefined;
        if (target) {
          send(target, { type: 'ice-candidate', from: selfId, candidate: msg.candidate, sid: msg.sid });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const roomId = roomOf.get(selfId);
    const room = rooms.get(roomId ?? '');
    if (room?.has(selfId)) {
      broadcast(selfId, { type: 'peer-left', id: selfId });
      room.remove(selfId);
      if (room.list().length === 0) rooms.delete(roomId!);
    }
    roomOf.delete(selfId);
    sockets.delete(selfId);
  });
});

console.log(`[ByteGrounds] ws server listening on ws://localhost:${PORT}`);
