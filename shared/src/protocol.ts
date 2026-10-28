// Shared constants (tile/render/network tuning).
export const TILE_SIZE = 32; // px per tile for rendering
export const MOVE_SPEED = 4; // tiles per second
export const POSITION_TICK_MS = 83; // ~12 Hz position broadcast
export const CONNECT_RADIUS = 4; // tiles
export const DISCONNECT_RADIUS = 5; // tiles
export const STUN_URLS = ['stun:stun.l.google.com:19302'];
export const DEFAULT_ROOM = 'office';

export type PeerId = string;

/** Structured, typed character descriptor (replaces the old `variant` id). */
export interface Appearance {
  body: 'male' | 'female'; // sex; light skin only (asset limit)
  hair: 'brown' | 'black' | 'blonde' | 'none'; // 'none' = omit the hair layer
  torso: 'teal' | 'maroon' | 'brown'; // shirt color (style auto by body)
  legs: 'teal' | 'red' | 'white'; // pants color
}

export interface PeerState {
  id: PeerId;
  name: string;
  color: string; // hex, e.g. "#4fa"
  appearance: Appearance; // structured character descriptor
  x: number; // tile-space float
  y: number;
}

export interface Position {
  x: number;
  y: number;
}

// --- Client -> Server ---
export interface JoinMsg {
  type: 'join';
  name: string;
  color: string;
  appearance: Appearance;
  room?: string; // map id; each map is its own room
  /** Start position (e.g. the player's saved spot); the map spawn when absent. */
  x?: number;
  y?: number;
}
export interface PositionMsg {
  type: 'position';
  x: number;
  y: number;
}
export interface OfferMsg {
  type: 'offer';
  to: PeerId;
  sdp: RTCSessionDescriptionInit;
}
export interface AnswerMsg {
  type: 'answer';
  to: PeerId;
  sdp: RTCSessionDescriptionInit;
}
export interface IceMsg {
  type: 'ice-candidate';
  to: PeerId;
  candidate: RTCIceCandidateInit;
}

// --- Server -> Client ---
export interface WelcomeMsg {
  type: 'welcome';
  selfId: PeerId;
  room: string;
}
export interface PresenceSnapshotMsg {
  type: 'presence-snapshot';
  peers: PeerState[]; // excludes self
}
export interface PeerJoinedMsg {
  type: 'peer-joined';
  peer: PeerState;
}
export interface PeerLeftMsg {
  type: 'peer-left';
  id: PeerId;
}
export interface PeerMovedMsg {
  type: 'peer-moved';
  id: PeerId;
  x: number;
  y: number;
}
// relayed signaling (server stamps `from`)
export interface RelayOfferMsg {
  type: 'offer';
  from: PeerId;
  sdp: RTCSessionDescriptionInit;
}
export interface RelayAnswerMsg {
  type: 'answer';
  from: PeerId;
  sdp: RTCSessionDescriptionInit;
}
export interface RelayIceMsg {
  type: 'ice-candidate';
  from: PeerId;
  candidate: RTCIceCandidateInit;
}

export type ClientToServer = JoinMsg | PositionMsg | OfferMsg | AnswerMsg | IceMsg;
export type ServerToClient =
  | WelcomeMsg
  | PresenceSnapshotMsg
  | PeerJoinedMsg
  | PeerLeftMsg
  | PeerMovedMsg
  | RelayOfferMsg
  | RelayAnswerMsg
  | RelayIceMsg;
