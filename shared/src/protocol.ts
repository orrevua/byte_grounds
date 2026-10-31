// Shared constants (tile/render/network tuning).
export const TILE_SIZE = 32; // px per tile for rendering
export const MOVE_SPEED = 4; // tiles per second
export const POSITION_TICK_MS = 83; // ~12 Hz position broadcast
export const CONNECT_RADIUS = 4; // tiles
export const DISCONNECT_RADIUS = 5; // tiles
export const STUN_URLS = ['stun:stun.l.google.com:19302'];
export const DEFAULT_ROOM = 'lounge'; // = DEFAULT_MAP.id (shared/src/maps.ts)

export type PeerId = string;

/** What an avatar is doing: walking/standing, sitting on a seat, lying on a bed, or dancing. */
export const POSES = ['stand', 'sit', 'lie', 'dance'] as const;
export type Pose = (typeof POSES)[number];

/** Coerce an incoming pose: unknown/missing values stand (a future pose must not render lying). */
export function normalizePose(x: unknown): Pose {
  return POSES.includes(x as Pose) ? (x as Pose) : 'stand';
}
export type Facing = 'up' | 'down' | 'left' | 'right';

/** Structured, typed character descriptor (replaces the old `variant` id). */
export interface Appearance {
  body: 'male' | 'female'; // sex: keys every legs/torso/hair file
  hair: 'brown' | 'black' | 'blonde' | 'none'; // 'none' = omit the hair layer
  outfit: 'casual' | 'business' | 'none'; // garment family (casual longsleeve/tunic vs formal); 'none' = bare (creatures only)
  torso: 'teal' | 'maroon' | 'brown' | 'white' | 'pink' | 'green'; // top color (clamped to the outfit's palette)
  legs: 'teal' | 'red' | 'white' | 'navy' | 'pink'; // pants color
  skin: 'light' | 'olive' | 'tan' | 'brown' | 'dark' | 'orc' | 'skeleton'; // body sheet (human tones, then creatures)
}

export interface PeerState {
  id: PeerId;
  name: string;
  color: string; // hex, e.g. "#4fa"
  appearance: Appearance; // structured character descriptor
  x: number; // tile-space float
  y: number;
  /** Absent = standing; facing then comes from movement. */
  pose?: Pose;
  dir?: Facing;
  /** Supabase auth uid: a claim, not proof (RLS checks the real session). Absent in ws dev mode. */
  uid?: string;
  /** Today's status line (see `normalizeStatus`); absent/empty = none. */
  status?: string;
  /** Busy / away: drawn with a zzZ over the avatar. */
  busy?: boolean;
  /** Sharing their screen (the outgoing video is the screen, shown big to nearby peers). */
  sharing?: boolean;
}

/** Longest status line / chat message kept (longer input is clipped). */
export const STATUS_MAX = 80;
export const CHAT_MAX = 300;

function clipText(x: unknown, max: number): string {
  return typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Coerce an incoming status line: a trimmed one-line string of at most STATUS_MAX chars, else ''. */
export function normalizeStatus(x: unknown): string {
  return clipText(x, STATUS_MAX);
}

/** Coerce an incoming chat message: a trimmed one-line string of at most CHAT_MAX chars, else ''. */
export function normalizeChat(x: unknown): string {
  return clipText(x, CHAT_MAX);
}

/** The status fields every peer carries, as sent in a `status` message. */
export interface StatusFields {
  status: string;
  busy: boolean;
  sharing: boolean;
}

/** Coerce incoming status fields (missing/invalid → empty / false). */
export function normalizeStatusFields(x: unknown): StatusFields {
  const o = (x ?? {}) as Partial<Record<keyof StatusFields, unknown>>;
  return { status: normalizeStatus(o.status), busy: o.busy === true, sharing: o.sharing === true };
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
  /** Supabase auth uid (see `PeerState.uid`); absent in ws dev mode. */
  uid?: string;
  status?: string;
  busy?: boolean;
  sharing?: boolean;
}
/** Replace our status fields (status line, busy, sharing). */
export interface StatusMsg extends StatusFields {
  type: 'status';
}
/** A room-wide chat line. */
export interface ChatMsg {
  type: 'chat';
  text: string;
}
export interface PositionMsg {
  type: 'position';
  x: number;
  y: number;
  pose?: Pose;
  dir?: Facing;
}
export interface OfferMsg {
  type: 'offer';
  to: PeerId;
  sdp: RTCSessionDescriptionInit;
  /** Sender's call id: changes when it starts a fresh RTCPeerConnection. */
  sid?: string;
}
export interface AnswerMsg {
  type: 'answer';
  to: PeerId;
  sdp: RTCSessionDescriptionInit;
  /** Sender's call id: changes when it starts a fresh RTCPeerConnection. */
  sid?: string;
}
export interface IceMsg {
  type: 'ice-candidate';
  to: PeerId;
  candidate: RTCIceCandidateInit;
  /** Sender's call id: changes when it starts a fresh RTCPeerConnection. */
  sid?: string;
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
  pose?: Pose;
  dir?: Facing;
}
export interface PeerStatusMsg extends StatusFields {
  type: 'peer-status';
  id: PeerId;
}
/** A chat line from another peer (server stamps `from`, `name` and `at`). */
export interface ChatRelayMsg {
  type: 'chat';
  from: PeerId;
  name: string;
  text: string;
  at: number;
}
// relayed signaling (server stamps `from`)
export interface RelayOfferMsg {
  type: 'offer';
  from: PeerId;
  sdp: RTCSessionDescriptionInit;
  /** Sender's call id: changes when it starts a fresh RTCPeerConnection. */
  sid?: string;
}
export interface RelayAnswerMsg {
  type: 'answer';
  from: PeerId;
  sdp: RTCSessionDescriptionInit;
  /** Sender's call id: changes when it starts a fresh RTCPeerConnection. */
  sid?: string;
}
export interface RelayIceMsg {
  type: 'ice-candidate';
  from: PeerId;
  candidate: RTCIceCandidateInit;
  /** Sender's call id: changes when it starts a fresh RTCPeerConnection. */
  sid?: string;
}

export type ClientToServer = JoinMsg | PositionMsg | OfferMsg | AnswerMsg | IceMsg | StatusMsg | ChatMsg;
export type ServerToClient =
  | WelcomeMsg
  | PresenceSnapshotMsg
  | PeerJoinedMsg
  | PeerLeftMsg
  | PeerMovedMsg
  | PeerStatusMsg
  | ChatRelayMsg
  | RelayOfferMsg
  | RelayAnswerMsg
  | RelayIceMsg;
