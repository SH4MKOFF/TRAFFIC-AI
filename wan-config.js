/* GHOST WAN configuration. Keep empty to use public STUN fallback.
   TURN can be added later as short-lived credentials. */
window.GHOST_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];
