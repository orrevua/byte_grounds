# Spec: mute + speaking indicators, clearer mic

## Goal
Everyone can see who is muted and who is talking: in the map view and in the meeting view. The
mic sounds cleaner.

## Design
- **Muted is shared state.** `StatusFields` (and `PeerState` / `JoinMsg`) gain `muted: boolean`,
  coerced by `normalizeStatusFields`, so it rides the existing `status` / `peer-status` path on
  both transports (ws server, Supabase presence) with no server change. We are muted when the mic
  is toggled off or the mic was denied. `MediaManager.muted` + `onChange` drive `Game.syncMuted()`.
- **Speaking is measured locally, never sent.** `client/src/voice.ts`: `VoiceMeter` runs a Web Audio
  `AnalyserNode` on our mic stream and on each peer's incoming stream (not connected to the
  speakers, so nothing plays twice). Per animation frame: RMS of the time-domain samples → a level
  (fast attack, slow release) and a speaking flag with hysteresis + a short hold, so it doesn't
  flicker between words. Pure helpers (`rmsLevel`, `levelFromRms`, `smoothLevel`, `nextSpeaking`)
  are unit tested. A muted track carries silence, so a muted person never shows as speaking.
- **Map view:** the green ring around nearby people grows and thickens with their voice level, with
  a soft outer pulse while speaking; our own ring appears while we speak. A red mic-off icon sits
  after the name of anyone muted (us included).
- **Meeting view:** a tile whose person is speaking gets a green ring around the face circle (a
  green border when the camera is on); a mic-off badge in the tile's top-right when muted. Speaking
  classes refresh every 100 ms (the full re-sync stays at 400 ms).
- **Clearer mic:** `getUserMedia` asks for `echoCancellation`, `noiseSuppression`,
  `autoGainControl`, mono, and `voiceIsolation` (Chrome's stronger voice filter; ignored where
  unsupported).

## Units
1. Protocol `muted` + normalize + tests.
2. `voice.ts` + tests.
3. Media: constraints, `muted`, `onChange` on denial.
4. Game: meter wiring (self + peers), `syncMuted`, ring pulse, mic-off tag.
5. Meeting: `muted` / `speaking` on participants, CSS ring + badge, fast speaking refresh.
6. i18n for the badge title.
