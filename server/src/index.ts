import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { DEFAULT_ROOM } from '@byte_grounds/shared/protocol';
import type {
  ClientToServer,
  PeerId,
  PeerState,
  ServerToClient,
} from '@byte_grounds/shared/protocol';
import { OFFICE_MAP } from '@byte_grounds/shared/map';
import { Room } from './room.ts';

const PORT = Number(process.env.PORT ?? 8080);

const room = new Room();
const sockets = new Map<PeerId, WebSocket>();

function send(ws: WebSocket, msg: ServerToClient): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(exceptId: PeerId, msg: ServerToClient): void {
  for (const [id, ws] of sockets) {
    if (id !== exceptId) send(ws, msg);
  }
}

const wss = new WebSocketServer({ port: PORT });

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
        const peer: PeerState = {
          id: selfId,
          name: msg.name,
          color: msg.color,
          appearance: msg.appearance,
          x: OFFICE_MAP.spawn.x,
          y: OFFICE_MAP.spawn.y,
        };
        room.add(peer);
        send(ws, { type: 'welcome', selfId, room: msg.room ?? DEFAULT_ROOM });
        send(ws, { type: 'presence-snapshot', peers: room.list(selfId) });
        broadcast(selfId, { type: 'peer-joined', peer });
        break;
      }
      case 'position': {
        if (room.updatePosition(selfId, msg.x, msg.y)) {
          broadcast(selfId, { type: 'peer-moved', id: selfId, x: msg.x, y: msg.y });
        }
        break;
      }
      case 'offer': {
        const target = sockets.get(msg.to);
        if (target) send(target, { type: 'offer', from: selfId, sdp: msg.sdp });
        break;
      }
      case 'answer': {
        const target = sockets.get(msg.to);
        if (target) send(target, { type: 'answer', from: selfId, sdp: msg.sdp });
        break;
      }
      case 'ice-candidate': {
        const target = sockets.get(msg.to);
        if (target) {
          send(target, { type: 'ice-candidate', from: selfId, candidate: msg.candidate });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    sockets.delete(selfId);
    if (room.remove(selfId)) broadcast(selfId, { type: 'peer-left', id: selfId });
  });
});

console.log(`[ByteGrounds] ws server listening on ws://localhost:${PORT}`);
