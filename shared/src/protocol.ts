import type { BoardOp } from './board.ts';
// Shared constants (tile/render/network tuning).
export const TILE_SIZE = 32; // px per tile for rendering
export const MOVE_SPEED = 4; // tiles per second
export const POSITION_TICK_MS = 83; // ~12 Hz position broadcast
export const CONNECT_RADIUS = 4; // tiles
export const DISCONNECT_RADIUS = 5; // tiles
export const STUN_URLS = ['stun:stun.l.google.com:19302'];
export const DEFAULT_ROOM = 'office'; // = DEFAULT_MAP.id (shared/src/maps.ts)

export type PeerId = string;

/**
 * What an avatar is doing: walking/standing, sitting on a seat, lying on a bed, or one of the
 * dances (`dance` = the classic one, `maggots` = "Maggots for Brains").
 */
export const POSES = ['stand', 'sit', 'lie', 'dance', 'maggots'] as const;
export type Pose = (typeof POSES)[number];
export const DANCE_POSES = ['dance', 'maggots'] as const;
export type DancePose = (typeof DANCE_POSES)[number];

export function isDancePose(p: Pose): p is DancePose {
  return (DANCE_POSES as readonly Pose[]).includes(p);
}

/** Coerce an incoming pose: unknown/missing values stand (a future pose must not render lying). */
export function normalizePose(x: unknown): Pose {
  return POSES.includes(x as Pose) ? (x as Pose) : 'stand';
}
export type Facing = 'up' | 'down' | 'left' | 'right';

/** Structured, typed character descriptor (replaces the old `variant` id). */
export interface Appearance {
  body: 'male' | 'female'; // sex: keys every legs/torso/hair file
  hair: 'brown' | 'black' | 'blonde' | 'red' | 'white' | 'pink' | 'blue' | 'none'; // 'none' = omit the hair layer
  outfit:
    | 'casual' | 'business' | 'tshirt' | 'vneck' | 'polo' | 'cardigan' | 'blouse' | 'tank' | 'vest' | 'jacket'
    | 'none'; // top style (casual longsleeve/tunic, formal, modern LPC tops; some per sex); 'none' = bare (creatures only)
  torso:
    | 'teal' | 'maroon' | 'brown' | 'white' | 'pink' | 'green'
    | 'black' | 'blue' | 'red' | 'yellow' | 'purple' | 'orange' | 'grey' | 'navy' | 'burgundy'; // top color (clamped to the outfit's palette)
  legs: 'teal' | 'red' | 'white' | 'navy' | 'pink' | 'black' | 'brown' | 'grey' | 'green' | 'khaki'; // pants color
  skin: 'light' | 'olive' | 'tan' | 'brown' | 'dark' | 'orc' | 'skeleton'; // body sheet (human tones, then creatures)
  bottom: 'pants' | 'shorts' | 'skirt'; // bottom style, colored by `legs` (skirt: female only)
  hairStyle:
    | 'classic' | 'bob' | 'pixie' | 'ponytail' | 'curly' | 'afro' | 'spiked' | 'long' | 'buzzcut' | 'bun'
    | 'messy' | 'dreads' | 'parted'; // haircut, colored by `hair`
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
  /** Their mic is off (or was denied): a mic-off icon by their name. */
  muted?: boolean;
  /** A meeting room they locked with a password (see `RoomLock`). */
  lock?: RoomLock | null;
  /** What they're listening to on Spotify ("Song — Artist"), when they share it. */
  music?: string;
  /** What they hold (a drink from a machine); absent/'' = nothing. */
  item?: HeldItem;
  /** A sign they hold up (made at a whiteboard). */
  sign?: Sign | null;
  /** Signed in as the admin: shown as an [ADM] tag. Cosmetic only (RLS enforces real powers). */
  admin?: boolean;
}

/** Things an avatar can hold. */
/** Snacks from a snack seller (vending machine, pastry case): one at random each time. */
export const SNACKS = ['donut', 'cookie', 'croissant', 'apple', 'chocolate', 'chips'] as const;
export type Snack = (typeof SNACKS)[number];
export const HELD_ITEMS = ['coffee', 'water', ...SNACKS] as const;
export type HeldItem = (typeof HELD_ITEMS)[number] | '';

/** Coerce an incoming held item (unknown → nothing). */
export function normalizeItem(x: unknown): HeldItem {
  return HELD_ITEMS.includes(x as (typeof HELD_ITEMS)[number]) ? (x as HeldItem) : '';
}

export function isSnack(item: HeldItem): item is Snack {
  return (SNACKS as readonly string[]).includes(item);
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

/**
 * A meeting room closed with a password by its owner (the peer carrying it). `zone` = the room's
 * `zoneKey`; `hash` = SHA-256 hex of `zone + "
" + password` (the password stays with the owner);
 * `allow` = invitees who accepted (they may walk in without it).
 */
export interface RoomLock {
  zone: string;
  hash: string;
  allow: PeerId[];
}

export const LOCK_ALLOW_MAX = 16;

/** Coerce an incoming lock; anything malformed → null (unlocked). */
export function normalizeLock(x: unknown): RoomLock | null {
  const o = (x ?? null) as Partial<Record<keyof RoomLock, unknown>> | null;
  if (!o || typeof o !== 'object') return null;
  if (typeof o.zone !== 'string' || !o.zone || o.zone.length > 40) return null;
  if (typeof o.hash !== 'string' || !/^[0-9a-f]{64}$/.test(o.hash)) return null;
  const allow = Array.isArray(o.allow)
    ? o.allow.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64).slice(0, LOCK_ALLOW_MAX)
    : [];
  return { zone: o.zone, hash: o.hash, allow };
}

/** The status fields every peer carries, as sent in a `status` message. */
export interface StatusFields {
  status: string;
  busy: boolean;
  sharing: boolean;
  muted: boolean;
  item: HeldItem;
  lock: RoomLock | null;
  music: string;
  sign: Sign | null;
}

export const MUSIC_MAX = 100;

/** A sign someone made at a whiteboard and holds up: its text, card colour, and when it goes away. */
export interface Sign {
  text: string;
  color: string;
  /** Epoch ms when it is put down by itself; 0 = held until its owner puts it down. */
  until: number;
}
export const SIGN_MAX = 40;
export const SIGN_COLORS = ['#ffffff', '#ffe066', '#ffc9de', '#b2f2bb', '#a5d8ff'] as const;
/** How long a sign can be held (minutes; 0 = until put down). */
export const SIGN_DURATIONS = [5, 15, 30, 60, 0] as const;

/** Coerce a sign: text like a status line (≤ `SIGN_MAX`), a known colour, a sane end time. */
export function normalizeSign(x: unknown): Sign | null {
  const o = (x ?? {}) as { text?: unknown; color?: unknown; until?: unknown };
  if (typeof o.text !== 'string') return null;
  const text = o.text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SIGN_MAX);
  if (!text) return null;
  const color = SIGN_COLORS.includes(o.color as (typeof SIGN_COLORS)[number]) ? (o.color as string) : SIGN_COLORS[0];
  const until = typeof o.until === 'number' && Number.isFinite(o.until) && o.until > 0 ? Math.round(o.until) : 0;
  return { text, color, until };
}

/** Whether a sign is still up at `nowMs`. */
export function signUp(sign: Sign | null | undefined, nowMs: number): sign is Sign {
  return !!sign && (sign.until === 0 || nowMs < sign.until);
}

/** Coerce a "now playing" line: a string, control characters out, trimmed, at most `MUSIC_MAX`. */
export function normalizeMusic(x: unknown): string {
  if (typeof x !== 'string') return '';
  return x.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MUSIC_MAX);
}

/** Coerce incoming status fields (missing/invalid → empty / false). */
export function normalizeStatusFields(x: unknown): StatusFields {
  const o = (x ?? {}) as Partial<Record<keyof StatusFields, unknown>>;
  const item = HELD_ITEMS.includes(o.item as (typeof HELD_ITEMS)[number]) ? (o.item as HeldItem) : '';
  return {
    status: normalizeStatus(o.status),
    busy: o.busy === true,
    sharing: o.sharing === true,
    muted: o.muted === true,
    item,
    lock: normalizeLock(o.lock),
    music: normalizeMusic(o.music),
    sign: normalizeSign(o.sign),
  };
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
  muted?: boolean;
  item?: HeldItem;
  lock?: RoomLock | null;
  music?: string;
  admin?: boolean;
}
/** Replace our status fields (status line, busy, sharing, muted, held item). */
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

/** Invite a peer into a meeting room (`zone` = its zoneKey; `locked` = a password will close it). */
export interface InviteMsg {
  type: 'invite';
  to: PeerId;
  zone: string;
  locked: boolean;
}
/** An edit on a whiteboard (`board` = its id, `<map>:<x>,<y>`), relayed to the room. */
/** Whiteboard ids are short: `<map id>:<x>,<y>`. */
export const BOARD_ID_MAX = 80;

export interface BoardMsg {
  type: 'board';
  board: string;
  op: BoardOp;
}
/** Accept / decline an invite. */
export interface InviteReplyMsg {
  type: 'invite-reply';
  to: PeerId;
  zone: string;
  accept: boolean;
}

// --- Server -> Client ---
export interface WelcomeMsg {
  type: 'welcome';
  selfId: PeerId;
  room: string;
}
/** The join was refused: the name is already online (someone else's). */
export interface RefusedMsg {
  type: 'refused';
  reason: 'name';
}
/** The same account joined somewhere else (newest wins): this instance must stop. */
export interface KickedMsg {
  type: 'kicked';
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

export interface RelayBoardMsg {
  type: 'board';
  from: PeerId;
  board: string;
  op: BoardOp;
}
export interface RelayInviteMsg {
  type: 'invite';
  from: PeerId;
  zone: string;
  locked: boolean;
}
export interface RelayInviteReplyMsg {
  type: 'invite-reply';
  from: PeerId;
  zone: string;
  accept: boolean;
}

export type ClientToServer =
  | JoinMsg
  | PositionMsg
  | OfferMsg
  | AnswerMsg
  | IceMsg
  | StatusMsg
  | ChatMsg
  | InviteMsg
  | InviteReplyMsg
  | BoardMsg;
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
  | RelayIceMsg
  | RelayInviteMsg
  | RelayInviteReplyMsg
  | RelayBoardMsg
  | RefusedMsg
  | KickedMsg;
