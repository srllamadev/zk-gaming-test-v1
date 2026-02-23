// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG — Update CONTRACT_ID after running scripts/deploy.sh
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  CONTRACT_ID:        "REPLACE_WITH_YOUR_CONTRACT_ID",
  GAME_HUB:           "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG",
  NETWORK:            "TESTNET",
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  SOROBAN_RPC:        "https://soroban-testnet.stellar.org",
  HORIZON_URL:        "https://horizon-testnet.stellar.org",
};

// ─────────────────────────────────────────────────────────────────────────────
//  GLOBAL STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  phase:             "SETUP",   // SETUP | IDLE | COMMITTED | OPEN | CLOSED | REVEALED
  publicKey:         null,
  sessionId:         null,
  secretNumber:      null,       // BigInt
  salt:              null,       // Uint8Array(32)
  commitment:        null,       // Uint8Array(32)
  participants:      [],
  participantsTarget: null,      // number — set in setup step A
  prizeAmount:       null,       // number (XLM)
  winnersCount:      null,       // number
  winners:           [],         // array of { index, address }
  noirProof:         null,
};

// ─────────────────────────────────────────────────────────────────────────────
//  ROULETTE CANVAS
// ─────────────────────────────────────────────────────────────────────────────
const SEGMENTS = [
  "#cf2762","#d98046","#e1b495","#f4a3b2",
  "#a01e4c","#b05c30","#e85585","#c87a50",
  "#d03060","#be7040","#f0809a","#d29060",
];

const rCanvas = document.getElementById("roulette-canvas");
const rCtx    = rCanvas.getContext("2d");
let rAngle    = 0;
let rSpinning = false;

function drawWheel(list, hi) {
  if (hi === undefined) hi = -1;
  const cx = 120, cy = 120, rad = 116;
  const n  = Math.max(list.length, 1);
  rCtx.clearRect(0, 0, 240, 240);
  rCtx.save();
  rCtx.translate(cx, cy);
  rCtx.rotate(rAngle);

  const step = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const s = step * i - Math.PI / 2;
    const e = s + step;
    rCtx.beginPath();
    rCtx.moveTo(0, 0);
    rCtx.arc(0, 0, rad, s, e);
    rCtx.closePath();
    rCtx.fillStyle = i === hi ? "#f1e3d8" : SEGMENTS[i % SEGMENTS.length] + "cc";
    rCtx.fill();
    rCtx.strokeStyle = "rgba(255,255,255,.06)";
    rCtx.lineWidth = 1.5;
    rCtx.stroke();
    if (n > 1) {
      const mid = s + step / 2;
      rCtx.fillStyle = "rgba(255,255,255,.9)";
      rCtx.font = "bold " + (n > 14 ? 9 : 12) + "px sans-serif";
      rCtx.textAlign = "center";
      rCtx.textBaseline = "middle";
      rCtx.fillText(i + 1, Math.cos(mid) * rad * .6, Math.sin(mid) * rad * .6);
    }
  }
  // Center hub
  rCtx.beginPath();
  rCtx.arc(0, 0, 20, 0, Math.PI * 2);
  const g = rCtx.createRadialGradient(0,0,3,0,0,20);
  g.addColorStop(0, "#f1e3d8");
  g.addColorStop(1, "#cf2762");
  rCtx.fillStyle = g;
  rCtx.fill();
  rCtx.restore();
}
drawWheel([]);

function animateSpin(target, dur, done) {
  rSpinning = true;
  const start = rAngle, t0 = performance.now();
  function frame(now) {
    const t    = Math.min((now - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - t, 5);
    rAngle = start + (target - start) * ease;
    drawWheel(state.participants);
    if (t < 1) requestAnimationFrame(frame);
    else { rSpinning = false; done && done(); }
  }
  requestAnimationFrame(frame);
}

// Idle slow spin
setInterval(function() {
  if (!rSpinning && state.phase !== "REVEALED") {
    rAngle += 0.003;
    drawWheel(state.participants, state.winners[0] ? state.winners[0].index : -1);
  }
}, 30);

// ─────────────────────────────────────────────────────────────────────────────
//  ACTIVITY LOG
// ─────────────────────────────────────────────────────────────────────────────
function log(msg, type) {
  if (!type) type = "info";
  const el  = document.getElementById("event-log");
  const div = document.createElement("div");
  div.className = "log-entry " + type;
  const ts = new Date().toLocaleTimeString("en", { hour12: false });
  div.textContent = "[" + ts + "] " + msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI UPDATE
// ─────────────────────────────────────────────────────────────────────────────
function updatePhaseUI() {
  const map = { SETUP:0, IDLE:1, COMMITTED:1, OPEN:2, CLOSED:3, REVEALED:4 };
  const idx = map[state.phase] !== undefined ? map[state.phase] : 0;
  for (let i = 0; i < 5; i++) {
    const el = document.getElementById("phase-" + i);
    el.className = "phase-step" + (i === idx ? " active" : i < idx ? " done" : "");
  }
  document.getElementById("stat-phase").textContent        = state.phase;
  document.getElementById("stat-participants").textContent = state.participants.length;
  document.getElementById("stat-winners").textContent      = state.winnersCount !== null ? state.winnersCount : "—";
  document.getElementById("stat-prize").textContent        = state.prizeAmount !== null ? state.prizeAmount : "—";
  document.getElementById("zk-participants").textContent   = state.participants.length;

  document.getElementById("spin-btn").disabled = state.phase !== "CLOSED";

  // Show/hide main sections
  const setupCard   = document.getElementById("bcard-setup");
  const walletCard  = document.getElementById("bcard-wallets");

  if (state.phase === "SETUP") {
    setupCard.style.display  = "";
    walletCard.style.display = "none";
  } else {
    setupCard.style.display  = "none";
    walletCard.style.display = "";
  }

  // Commit / Close buttons
  const btnCommit = document.getElementById("btn-commit-main");
  const btnClose  = document.getElementById("btn-close-main");
  if (btnCommit) {
    btnCommit.disabled = !(state.phase === "IDLE" || state.phase === "OPEN");
    if (state.phase === "COMMITTED" || state.phase === "OPEN") {
      btnCommit.disabled = true;
    }
  }
  if (btnClose) {
    btnClose.disabled = state.phase !== "OPEN" || state.participants.length < 2;
  }

  // Wallet input: hide once closed
  const walletInputSection = document.getElementById("wallet-inputs-section");
  if (walletInputSection) {
    walletInputSection.style.display = (state.phase === "CLOSED" || state.phase === "REVEALED") ? "none" : "";
  }

  // Wallet progress bar
  updateWalletProgress();

  renderParticipants();
}

function updateWalletProgress() {
  const total   = state.participantsTarget || 0;
  const current = state.participants.length;
  const pct     = total > 0 ? Math.min((current / total) * 100, 100) : 0;
  const fill  = document.getElementById("wallet-progress-fill");
  const label = document.getElementById("wallet-progress-label");
  const tot   = document.getElementById("wallet-total-label");
  if (fill)  fill.style.width = pct + "%";
  if (label) label.innerHTML  = current + " / <span id=\"wallet-total-label\">" + total + "</span> registered";
  if (tot)   tot.textContent  = total;
}

function renderParticipants(winnerIndexes) {
  if (!winnerIndexes) winnerIndexes = [];
  const grid = document.getElementById("participants-grid");
  if (state.participants.length === 0) {
    grid.innerHTML = '<p class="text-muted" style="text-align:center;padding:14px 0">No participants yet.</p>';
    return;
  }
  grid.innerHTML = state.participants.map(function(addr, i) {
    const isWinner = winnerIndexes.includes(i);
    return '<div class="p-card ' + (isWinner ? "winner" : "") + '">' +
      '<div class="p-avatar">' + (i + 1) + '</div>' +
      '<div class="p-addr">' + addr + '</div>' +
      (isWinner ? '<div class="p-badge">🏆 WINNER</div>' : "") +
      '</div>';
  }).join("");
}

function setZk(id, val, cls) {
  if (!cls) cls = "";
  const el = document.getElementById(id);
  el.textContent = val;
  el.className   = ("zk-val " + cls).trim();
}

function shortHex(bytes) {
  const h = Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
  return h.slice(0,8) + "…" + h.slice(-8);
}

// ─────────────────────────────────────────────────────────────────────────────
//  SETUP STEPS
// ─────────────────────────────────────────────────────────────────────────────
window.confirmParticipantsCount = function () {
  const val = parseInt(document.getElementById("input-participants-count").value, 10);
  if (!val || val < 2) { alert("Enter at least 2 participants"); return; }
  state.participantsTarget = val;

  document.getElementById("step-a").className = "step-card done-step";
  const stepB = document.getElementById("step-b");
  stepB.style.opacity      = "1";
  stepB.style.pointerEvents = "auto";
  stepB.className           = "step-card active-step";
  log("Participants set: " + val, "ok");
};

window.confirmPrize = function () {
  const val = parseFloat(document.getElementById("input-prize-amount").value);
  if (!val || val <= 0) { alert("Enter a valid prize amount (XLM > 0)"); return; }
  state.prizeAmount = val;

  document.getElementById("step-b").className = "step-card done-step";
  const stepC = document.getElementById("step-c");
  stepC.style.opacity       = "1";
  stepC.style.pointerEvents = "auto";
  stepC.className            = "step-card active-step";
  log("Prize set: " + val + " XLM", "ok");
};

window.confirmWinners = function () {
  const val = parseInt(document.getElementById("input-winners-count").value, 10);
  if (!val || val < 1) { alert("Enter at least 1 winner"); return; }
  if (val >= state.participantsTarget) { alert("Winners must be less than total participants"); return; }
  state.winnersCount = val;

  document.getElementById("step-c").className = "step-card done-step";
  log("Winners set: " + val, "ok");
  log("Setup complete! Now enter participant wallets.", "ok");

  state.phase = "IDLE";
  updatePhaseUI();
};

// ─────────────────────────────────────────────────────────────────────────────
//  FREIGHTER WALLET
//  Compatible with both @stellar/freighter-api v1 and v2:
//    v1: requestAccess() → { publicKey }  |  getPublicKey()  |  isConnected()
//    v2: requestAccess() → { address }    |  getAddress()    |  isAllowed()
// ─────────────────────────────────────────────────────────────────────────────
function getFreighter() {
  if (window.freighterApi) return window.freighterApi;
  throw new Error("Freighter not found. Install the extension at: https://freighter.app");
}

/** Resolve a public key from any Freighter API version response. */
function resolveAddress(result) {
  if (!result) return null;
  // v2 returns { address } or may throw; v1 returns { publicKey }
  if (typeof result === "string") return result;
  return result.address || result.publicKey || null;
}

window.connectWallet = async function () {
  try {
    const freighter = getFreighter();
    const result = await freighter.requestAccess();
    const pubKey = resolveAddress(result);
    if (!pubKey) throw new Error("Access denied or address not returned by Freighter");
    applyWalletConnected(pubKey);
    log("Wallet connected: " + pubKey, "ok");
  } catch (err) {
    log("Wallet error: " + err.message, "error");
    alert("Error: " + err.message);
  }
};

function applyWalletConnected(pubKey) {
  state.publicKey = pubKey;
  const short = pubKey.slice(0,6) + "…" + pubKey.slice(-4);
  document.getElementById("wallet-dot").classList.add("on");
  document.getElementById("wallet-label").textContent = short;
  document.getElementById("wallet-btn").classList.add("connected");
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOCAL CRYPTO (Web Crypto API)
// ─────────────────────────────────────────────────────────────────────────────
function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

async function computeCommitment(secretNumber, salt) {
  const pre  = new Uint8Array(40);
  const view = new DataView(pre.buffer);
  view.setBigUint64(0, BigInt(secretNumber), false);
  pre.set(salt, 8);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", pre));
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOROBAN RPC
// ─────────────────────────────────────────────────────────────────────────────
function getSdk() {
  if (!window.StellarSdk) throw new Error("stellar-sdk not loaded");
  return window.StellarSdk;
}
function getRpc() { return new (getSdk()).SorobanRpc.Server(CONFIG.SOROBAN_RPC, { allowHttp: false }); }

async function invokeContract(method, args) {
  if (!args) args = [];
  if (!state.publicKey) throw new Error("Wallet not connected");
  const Sdk = getSdk(), server = getRpc(), freighter = getFreighter();
  const account = await server.getAccount(state.publicKey);
  const tx = new Sdk.TransactionBuilder(account, { fee: "200000", networkPassphrase: CONFIG.NETWORK_PASSPHRASE })
    .addOperation(new Sdk.Contract(CONFIG.CONTRACT_ID).call(method, ...args))
    .setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (Sdk.SorobanRpc.Api.isSimulationError(sim)) throw new Error("Simulation failed: " + sim.error);
  const prep = Sdk.SorobanRpc.assembleTransaction(tx, sim).build();

  // signTransaction: support both v1 ({ networkPassphrase }) and v2 ({ network })
  let signedXdr;
  try {
    const signResult = await freighter.signTransaction(prep.toXDR(), {
      networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
      network: CONFIG.NETWORK,
    });
    // v1 returns string; v2 may return { signedTxXdr } or string
    signedXdr = (typeof signResult === "string") ? signResult : (signResult.signedTxXdr || signResult);
  } catch (e) {
    throw new Error("Sign failed: " + e.message);
  }

  const signedTx = Sdk.TransactionBuilder.fromXDR(signedXdr, CONFIG.NETWORK_PASSPHRASE);
  const send = await server.sendTransaction(signedTx);
  if (send.status === "ERROR") throw new Error("Submit failed: " + JSON.stringify(send.errorResult));
  for (let i = 0; i < 30; i++) {
    await new Promise(function(r) { setTimeout(r, 2000); });
    const res = await server.getTransaction(send.hash);
    if (res.status === "SUCCESS") return res;
    if (res.status === "FAILED")  throw new Error("Transaction failed on-chain");
  }
  throw new Error("Timeout waiting for confirmation");
}

// ScVal helpers
function scAddr(a)  { return new (getSdk()).Address(a).toScVal(); }
function scU32(n)   { return getSdk().xdr.ScVal.scvU32(n >>> 0); }
function scU64(n)   {
  const Sdk = getSdk(), b = BigInt(n);
  return Sdk.xdr.ScVal.scvU64(new Sdk.xdr.Uint64(Number(b & 0xFFFFFFFFn) >>> 0, Number(b >> 32n) >>> 0));
}
function scBytes(b) { return getSdk().xdr.ScVal.scvBytes(Buffer.from(b)); }

// Spinner helpers
function showSpin(id) { const e = document.getElementById(id); if (e) e.innerHTML = '<span class="spinner"></span>&nbsp;'; }
function hideSpin(id) { const e = document.getElementById(id); if (e) e.innerHTML = ""; }

// ─────────────────────────────────────────────────────────────────────────────
//  ACTION 1 — COMMIT
// ─────────────────────────────────────────────────────────────────────────────
window.doCommit = async function () {
  if (!state.publicKey) { alert("Connect your wallet first"); return; }
  const sid = parseInt(document.getElementById("input-session-id").value.trim(), 10);
  if (!sid || isNaN(sid)) { alert("Enter a valid Session ID in the wheel panel"); return; }

  try {
    showSpin("btn-commit-spinner");
    log("Generating secret number and salt locally...", "info");

    const secretBytes = randomBytes(8);
    let secret = new DataView(secretBytes.buffer).getBigUint64(0, false);
    if (secret === 0n) secret = 1n;
    const salt = randomBytes(32);
    const commitment = await computeCommitment(secret, salt);

    state.secretNumber = secret;
    state.salt         = salt;
    state.commitment   = commitment;
    state.sessionId    = sid;

    setZk("zk-secret",     "****" + secret.toString().slice(-4) + " (hidden)", "warn");
    setZk("zk-salt",       shortHex(salt) + " (local)", "warn");
    setZk("zk-commitment", shortHex(commitment), "ok");

    log("Commitment computed: " + shortHex(commitment), "ok");
    log("Sending commitment to Soroban...", "info");

    await invokeContract("commit_draw", [scAddr(state.publicKey), scU32(sid), scBytes(commitment)]);

    setZk("zk-onchain", "✓ confirmed on Testnet", "ok");
    log("commit_draw(" + sid + ") confirmed ✓", "ok");

    localStorage.setItem("zk_" + sid, JSON.stringify({
      sessionId: sid,
      secretNumber: secret.toString(),
      salt: Array.from(salt),
      commitment: Array.from(commitment),
    }));

    state.phase = "OPEN";
    updatePhaseUI();

  } catch (err) {
    log("Commit error: " + err.message, "error");
    alert("Error: " + err.message);
  } finally {
    hideSpin("btn-commit-spinner");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  ACTION 2 — REGISTER PARTICIPANT
// ─────────────────────────────────────────────────────────────────────────────
window.doRegister = async function () {
  if (!state.publicKey) { alert("Connect your wallet first"); return; }
  if (state.phase === "IDLE") { alert("Publish commitment first (🔒 button)"); return; }

  const addr = document.getElementById("input-participant").value.trim();
  if (!addr || !addr.startsWith("G") || addr.length < 56) {
    alert("Enter a valid Stellar address (G..., 56 chars)"); return;
  }
  if (state.participants.includes(addr)) {
    alert("That participant is already registered"); return;
  }
  if (state.participantsTarget && state.participants.length >= state.participantsTarget) {
    alert("Maximum participants reached (" + state.participantsTarget + ")"); return;
  }

  try {
    showSpin("btn-register-spinner");
    log("Registering " + addr.slice(0,10) + "…", "info");

    await invokeContract("register_participant", [scU32(state.sessionId), scAddr(addr)]);

    state.participants.push(addr);
    document.getElementById("input-participant").value = "";
    drawWheel(state.participants);
    updatePhaseUI();
    log("✓ " + addr.slice(0,10) + "… registered (#" + state.participants.length + ")", "ok");

    if (state.participantsTarget && state.participants.length >= state.participantsTarget) {
      log("All " + state.participantsTarget + " participants registered! Close registrations.", "warn");
    }
  } catch (err) {
    log("Register error: " + err.message, "error");
    alert("Error: " + err.message);
  } finally {
    hideSpin("btn-register-spinner");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  ACTION 3 — CLOSE REGISTRATIONS
// ─────────────────────────────────────────────────────────────────────────────
window.doCloseRegistrations = async function () {
  if (state.participants.length < 2) { alert("Need at least 2 participants"); return; }
  try {
    showSpin("btn-close-spinner");
    log("Closing registrations…", "info");
    await invokeContract("close_registrations", [scU32(state.sessionId)]);
    state.phase = "CLOSED";
    updatePhaseUI();
    log("Registrations closed. Participant list is frozen on-chain ✓", "ok");
    log("Winner formula: secret % " + state.participants.length, "info");
  } catch (err) {
    log("Close error: " + err.message, "error");
    alert("Error: " + err.message);
  } finally {
    hideSpin("btn-close-spinner");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  SPIN BUTTON
// ─────────────────────────────────────────────────────────────────────────────
window.spinRoulette = function () { if (!rSpinning) doReveal(); };

// ─────────────────────────────────────────────────────────────────────────────
//  ACTION 4 — REVEAL WINNER
// ─────────────────────────────────────────────────────────────────────────────
window.doReveal = async function () {
  if (!state.secretNumber || !state.salt) {
    const stored = localStorage.getItem("zk_" + state.sessionId);
    if (stored) {
      const d = JSON.parse(stored);
      state.secretNumber = BigInt(d.secretNumber);
      state.salt         = new Uint8Array(d.salt);
      state.commitment   = new Uint8Array(d.commitment);
      log("Secret recovered from local storage", "warn");
    } else {
      alert("Local secret not found. Did you reload without saving?");
      return;
    }
  }
  const n = state.participants.length;
  if (n < 2) { alert("Not enough participants"); return; }

  try {
    showSpin("btn-reveal-spinner");
    document.getElementById("spin-btn").disabled = true;

    log("Generating ZK proof with Noir circuit…", "info");
    setZk("zk-proof-status", "generating…", "warn");
    drawWheel(state.participants);

    const winnerIndex = Number(state.secretNumber % BigInt(n));

    const noirProof = await simulateNoirProof(state.secretNumber, state.salt, n, winnerIndex);
    state.noirProof = noirProof;
    setZk("zk-proof-status", "✓ proof generated (JSON)", "ok");

    const blob = new Blob([JSON.stringify(noirProof, null, 2)], { type: "application/json" });
    const link = document.getElementById("noir-proof-link");
    link.href = URL.createObjectURL(blob);
    link.download = "zk_proof_" + state.sessionId + ".json";
    link.style.display = "block";

    log("Noir proof: winner_index=" + winnerIndex + " (" + state.secretNumber + " % " + n + ")", "ok");

    // Spin animation
    log("Spinning the wheel…", "info");
    const seg    = (Math.PI * 2) / n;
    const target = rAngle + (Math.floor(Math.random() * 4) + 6) * Math.PI * 2
                           + Math.PI * 2 - (seg * winnerIndex + seg / 2);
    await new Promise(function(r) { animateSpin(target, 5500, r); });
    drawWheel(state.participants, winnerIndex);

    // On-chain reveal
    log("Sending reveal_winner to Soroban…", "info");
    await invokeContract("reveal_winner", [scU32(state.sessionId), scU64(state.secretNumber), scBytes(state.salt)]);

    state.winnerIndex   = winnerIndex;
    state.winnerAddress = state.participants[winnerIndex];
    state.winners       = [{ index: winnerIndex, address: state.winnerAddress }];
    state.phase         = "REVEALED";

    setZk("zk-winner", "#" + winnerIndex + " (" + (state.winnerAddress ? state.winnerAddress.slice(0,10) : "?") + "…)", "ok");
    setZk("zk-secret", state.secretNumber.toString(), "ok");
    setZk("zk-salt",   shortHex(state.salt), "ok");

    log("reveal_winner confirmed on-chain ✓", "ok");
    log("🏆 Winner: #" + (winnerIndex + 1) + " — " + state.winnerAddress, "ok");

    localStorage.removeItem("zk_" + state.sessionId);
    renderParticipants([winnerIndex]);
    updatePhaseUI();
    showWinnerOverlay(winnerIndex, state.winnerAddress);

  } catch (err) {
    log("Reveal error: " + err.message, "error");
    alert("Error: " + err.message);
    document.getElementById("spin-btn").disabled = false;
  } finally {
    hideSpin("btn-reveal-spinner");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  NOIR PROOF SIMULATION
//  In production replace with real @noir-lang/noir_js call
// ─────────────────────────────────────────────────────────────────────────────
async function simulateNoirProof(secret, salt, n, winnerIdx) {
  await new Promise(function(r) { setTimeout(r, 1600 + Math.random() * 1200); });
  const commitment = await computeCommitment(secret, salt);
  return {
    _note: "Simulated proof for demo. Replace with noir_js in production.",
    circuit: "zk_roulette", backend: "barretenberg/UltraPlonk",
    public_inputs: {
      public_commitment: "0x" + Array.from(commitment).map(function(b) { return b.toString(16).padStart(2,"0"); }).join(""),
      number_of_participants: n, winner_index: winnerIdx,
    },
    proof_bytes: "0x" + Array.from(randomBytes(32)).map(function(b) { return b.toString(16).padStart(2,"0"); }).join("") + "…",
    verified: true, timestamp: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  WINNER OVERLAY
// ─────────────────────────────────────────────────────────────────────────────
function showWinnerOverlay(index, address) {
  const perWinner = state.prizeAmount && state.winnersCount
    ? (state.prizeAmount / state.winnersCount).toFixed(7)
    : null;
  document.getElementById("w-addr").textContent  = address || "—";
  document.getElementById("w-prize").textContent = perWinner ? "Prize: " + perWinner + " XLM" : "";
  document.getElementById("w-badge").textContent = "Entry #" + (index + 1);
  document.getElementById("winner-overlay").classList.add("show");
}
window.closeWinnerOverlay = function() { document.getElementById("winner-overlay").classList.remove("show"); };

// ─────────────────────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────────────────────
(function init() {
  updatePhaseUI();
  drawWheel([]);

  if (!window.freighterApi) {
    log("Freighter not detected. Install at: https://freighter.app", "warn");
  } else {
    // Auto-connect if already allowed — handle both v1 and v2 APIs
    var freighter = window.freighterApi;

    // Try v2 isAllowed() first, fall back to v1 isConnected()
    var checkAllowed = freighter.isAllowed
      ? freighter.isAllowed()
      : freighter.isConnected().then(function(r) { return typeof r === "boolean" ? r : r.isConnected; });

    checkAllowed.then(function(allowed) {
      if (!allowed) return;
      // Try v2 getAddress() first, fall back to v1 getPublicKey()
      var getAddr = freighter.getAddress
        ? freighter.getAddress().then(function(r) { return resolveAddress(r); })
        : freighter.getPublicKey().then(function(k) { return k; });

      getAddr.then(function(key) {
        if (!key) return;
        applyWalletConnected(key);
        log("Wallet auto-connected: " + key, "ok");
      }).catch(function() {});
    }).catch(function() {});
  }

  log("ZK Roulette v1.0 ready · Stellar Testnet · Protocol 25", "ok");
}());
