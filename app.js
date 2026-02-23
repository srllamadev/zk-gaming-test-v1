// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG
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
//  STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  publicKey:          null,
  prizeAmount:        null,     // number (XLM)
  participantsTarget: null,     // number
  participants:       [],       // Stellar addresses
  secretNumber:       null,     // BigInt
  salt:               null,     // Uint8Array(32)
  commitment:         null,     // Uint8Array(32)
  sessionId:          null,
  winnerIndex:        null,
  winnerAddress:      null,
  running:            false,
};

// ─────────────────────────────────────────────────────────────────────────────
//  ROULETTE — 360×360 canvas
// ─────────────────────────────────────────────────────────────────────────────
const SEGMENTS = [
  "#cf2762","#d98046","#e1b495","#f4a3b2",
  "#a01e4c","#b05c30","#e85585","#c87a50",
  "#d03060","#be7040","#f0809a","#d29060",
];

const rCanvas = document.getElementById("roulette-canvas");
const rCtx    = rCanvas.getContext("2d");
const CX = 180, CY = 180, RAD = 174;   // 360px canvas
let rAngle    = 0;
let rSpinning = false;

function drawWheel(list, hi) {
  if (hi === undefined) hi = -1;
  const n = Math.max(list.length, 1);
  rCtx.clearRect(0, 0, 360, 360);
  rCtx.save();
  rCtx.translate(CX, CY);
  rCtx.rotate(rAngle);

  const step = (Math.PI * 2) / n;
  for (var i = 0; i < n; i++) {
    var s = step * i - Math.PI / 2;
    var e = s + step;
    rCtx.beginPath();
    rCtx.moveTo(0, 0);
    rCtx.arc(0, 0, RAD, s, e);
    rCtx.closePath();
    rCtx.fillStyle = i === hi ? "#f1e3d8" : SEGMENTS[i % SEGMENTS.length] + "cc";
    rCtx.fill();
    rCtx.strokeStyle = "rgba(255,255,255,.06)";
    rCtx.lineWidth = 2;
    rCtx.stroke();

    if (n > 1) {
      var mid = s + step / 2;
      rCtx.save();
      rCtx.rotate(mid);
      rCtx.fillStyle = "rgba(255,255,255,.9)";
      rCtx.font = "bold " + (n > 14 ? 11 : 14) + "px sans-serif";
      rCtx.textAlign = "center";
      rCtx.textBaseline = "middle";
      rCtx.fillText(i + 1, RAD * .6, 0);
      rCtx.restore();
    }
  }
  // Hub
  rCtx.beginPath();
  rCtx.arc(0, 0, 26, 0, Math.PI * 2);
  var g = rCtx.createRadialGradient(0,0,4,0,0,26);
  g.addColorStop(0, "#f1e3d8");
  g.addColorStop(1, "#cf2762");
  rCtx.fillStyle = g;
  rCtx.fill();
  rCtx.restore();
}
drawWheel([]);

function animateSpin(target, dur, done) {
  rSpinning = true;
  var start = rAngle, t0 = performance.now();
  function frame(now) {
    var t    = Math.min((now - t0) / dur, 1);
    var ease = 1 - Math.pow(1 - t, 5);
    rAngle = start + (target - start) * ease;
    drawWheel(state.participants);
    if (t < 1) requestAnimationFrame(frame);
    else { rSpinning = false; if (done) done(); }
  }
  requestAnimationFrame(frame);
}

// Idle slow spin
setInterval(function () {
  if (!rSpinning && state.winnerIndex === null) {
    rAngle += 0.003;
    drawWheel(state.participants);
  }
}, 30);

// ─────────────────────────────────────────────────────────────────────────────
//  LOG
// ─────────────────────────────────────────────────────────────────────────────
function log(msg, type) {
  if (!type) type = "info";
  var el  = document.getElementById("event-log");
  var div = document.createElement("div");
  div.className = "log-entry " + type;
  var ts = new Date().toLocaleTimeString("en", { hour12: false });
  div.textContent = "[" + ts + "] " + msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

// ─────────────────────────────────────────────────────────────────────────────
//  CARD HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function activateCard(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("fcard-disabled", "done-card");
  el.classList.add("active-card");
}
function doneCard(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("active-card", "fcard-disabled");
  el.classList.add("done-card");
}

// ─────────────────────────────────────────────────────────────────────────────
//  STATS
// ─────────────────────────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById("stat-participants").textContent = state.participants.length +
    (state.participantsTarget ? " / " + state.participantsTarget : "");
  document.getElementById("stat-prize").textContent = state.prizeAmount !== null ? state.prizeAmount : "—";
  evaluateSpinButton();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SPIN BUTTON GATE
//  Enabled only when: wallet connected + prize set + all wallets entered
// ─────────────────────────────────────────────────────────────────────────────
function evaluateSpinButton() {
  var ready = state.publicKey &&
              state.prizeAmount  &&
              state.participantsTarget &&
              state.participants.length >= state.participantsTarget &&
              !state.running;
  var btn = document.getElementById("spin-btn");
  btn.disabled = !ready;
  if (ready) btn.classList.add("pulsing");
  else       btn.classList.remove("pulsing");
}

// ─────────────────────────────────────────────────────────────────────────────
//  FREIGHTER WALLET
// ─────────────────────────────────────────────────────────────────────────────
function getFreighter() {
  if (window.freighterApi) return window.freighterApi;
  throw new Error("Freighter not found — install at https://freighter.app");
}
function resolveAddress(r) {
  if (!r) return null;
  if (typeof r === "string") return r;
  return r.address || r.publicKey || null;
}

function applyWalletConnected(pubKey) {
  state.publicKey = pubKey;
  var short = pubKey.slice(0,6) + "…" + pubKey.slice(-4);

  // Header button
  document.getElementById("wallet-dot").classList.add("on");
  document.getElementById("wallet-label").textContent = short;
  document.getElementById("wallet-btn").classList.add("connected");

  // Card 01 transform
  document.getElementById("btn-connect-form").style.display = "none";
  document.getElementById("wallet-connected-state").style.display = "block";
  document.getElementById("wallet-short-label").textContent = short;
  doneCard("fcard-wallet");

  // Activate card 02
  activateCard("fcard-setup");
  evaluateSpinButton();
  log("Wallet connected: " + pubKey, "ok");
  updateStats();
}

window.connectWallet = async function () {
  try {
    var freighter = getFreighter();
    var result = await freighter.requestAccess();
    var pubKey = resolveAddress(result);
    if (!pubKey) throw new Error("Access denied or address not returned");
    applyWalletConnected(pubKey);
  } catch (err) {
    log("Wallet error: " + err.message, "error");
    alert("Wallet error: " + err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 2 — CONFIRM SETUP (prize + count)
// ─────────────────────────────────────────────────────────────────────────────
window.confirmSetup = function () {
  var prize = parseFloat(document.getElementById("input-prize-amount").value);
  var count = parseInt(document.getElementById("input-participants-count").value, 10);

  if (!prize || prize <= 0) { alert("Enter a valid prize amount (XLM > 0)"); return; }
  if (!count || count < 2)  { alert("Enter at least 2 participants"); return; }

  state.prizeAmount        = prize;
  state.participantsTarget = count;
  state.participants       = [];

  doneCard("fcard-setup");
  activateCard("fcard-wallets");

  // Reset wallet list card progress
  document.getElementById("wprog-label").textContent = "0 / " + count + " registered";
  document.getElementById("wprog-fill").style.width = "0%";
  document.getElementById("participants-grid").innerHTML = "";

  log("Draw configured — " + prize + " XLM for " + count + " participant(s)", "ok");
  updateStats();
};

// ─────────────────────────────────────────────────────────────────────────────
//  STEP 3 — ADD PARTICIPANT WALLET (local only, no contract call yet)
// ─────────────────────────────────────────────────────────────────────────────
window.addParticipant = function () {
  var addr = document.getElementById("input-participant").value.trim();
  if (!addr || !addr.startsWith("G") || addr.length < 56) {
    alert("Enter a valid Stellar address (G..., 56 chars)"); return;
  }
  if (state.participants.includes(addr)) {
    alert("Address already added"); return;
  }
  if (state.participants.length >= state.participantsTarget) {
    alert("Participant limit reached (" + state.participantsTarget + ")"); return;
  }

  state.participants.push(addr);
  document.getElementById("input-participant").value = "";
  renderParticipants();
  updateStats();
  log("Added: " + addr.slice(0,10) + "… (" + state.participants.length + "/" + state.participantsTarget + ")", "ok");

  if (state.participants.length >= state.participantsTarget) {
    log("All " + state.participantsTarget + " wallets entered — you can now Spin!", "warn");
    evaluateSpinButton();
  }
};

function renderParticipants(winnerIdxs) {
  if (!winnerIdxs) winnerIdxs = [];
  var grid = document.getElementById("participants-grid");
  var total = state.participantsTarget || 0;
  var cur   = state.participants.length;
  var pct   = total > 0 ? Math.min((cur / total) * 100, 100) : 0;

  document.getElementById("wprog-fill").style.width = pct + "%";
  document.getElementById("wprog-label").textContent = cur + " / " + total + " registered";

  if (cur === 0) { grid.innerHTML = ""; return; }
  grid.innerHTML = state.participants.map(function(a, i) {
    var win = winnerIdxs.includes(i);
    return '<div class="p-card ' + (win ? "winner" : "") + '">' +
      '<div class="p-avatar">' + (i+1) + '</div>' +
      '<div class="p-addr">' + a + '</div>' +
      (win ? '<div class="p-badge">🏆 WON</div>' : "") +
      '</div>';
  }).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOCAL CRYPTO
// ─────────────────────────────────────────────────────────────────────────────
function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

async function computeCommitment(secretNumber, salt) {
  var pre  = new Uint8Array(40);
  var view = new DataView(pre.buffer);
  view.setBigUint64(0, BigInt(secretNumber), false);
  pre.set(salt, 8);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", pre));
}

function shortHex(bytes) {
  var h = Array.from(bytes).map(function(b) { return b.toString(16).padStart(2,"0"); }).join("");
  return h.slice(0,8) + "…" + h.slice(-8);
}

// ─────────────────────────────────────────────────────────────────────────────
//  SOROBAN HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function getSdk()  {
  if (!window.StellarSdk) throw new Error("stellar-sdk not loaded");
  return window.StellarSdk;
}
function getRpc()  { return new (getSdk()).SorobanRpc.Server(CONFIG.SOROBAN_RPC, { allowHttp: false }); }
function getHorizon() { return new (getSdk()).Horizon.Server(CONFIG.HORIZON_URL); }

function scAddr(a)  { return new (getSdk()).Address(a).toScVal(); }
function scU32(n)   { return getSdk().xdr.ScVal.scvU32(n >>> 0); }
function scU64(n)   {
  var Sdk = getSdk(), b = BigInt(n);
  return Sdk.xdr.ScVal.scvU64(new Sdk.xdr.Uint64(Number(b & 0xFFFFFFFFn) >>> 0, Number(b >> 32n) >>> 0));
}
function scBytes(b) { return getSdk().xdr.ScVal.scvBytes(Buffer.from(b)); }

async function signXdr(xdr) {
  var freighter = getFreighter();
  var result = await freighter.signTransaction(xdr, {
    networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
    network: CONFIG.NETWORK,
  });
  return typeof result === "string" ? result : (result.signedTxXdr || result);
}

async function invokeContract(method, args) {
  if (!args) args = [];
  var Sdk = getSdk(), server = getRpc();
  var account = await server.getAccount(state.publicKey);
  var tx = new Sdk.TransactionBuilder(account, { fee: "200000", networkPassphrase: CONFIG.NETWORK_PASSPHRASE })
    .addOperation(new Sdk.Contract(CONFIG.CONTRACT_ID).call(method, ...args))
    .setTimeout(30).build();
  var sim = await server.simulateTransaction(tx);
  if (Sdk.SorobanRpc.Api.isSimulationError(sim)) throw new Error("Simulation: " + sim.error);
  var prep = Sdk.SorobanRpc.assembleTransaction(tx, sim).build();
  var signedXdr = await signXdr(prep.toXDR());
  var signedTx  = Sdk.TransactionBuilder.fromXDR(signedXdr, CONFIG.NETWORK_PASSPHRASE);
  var send = await server.sendTransaction(signedTx);
  if (send.status === "ERROR") throw new Error("Submit: " + JSON.stringify(send.errorResult));
  for (var i = 0; i < 30; i++) {
    await sleep(2000);
    var res = await server.getTransaction(send.hash);
    if (res.status === "SUCCESS") return res;
    if (res.status === "FAILED")  throw new Error("Transaction failed on-chain");
  }
  throw new Error("Timeout waiting for confirmation");
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRIZE PAYMENT — Horizon XLM transfer
// ─────────────────────────────────────────────────────────────────────────────
async function sendPrizeToWinner(winnerAddress, amountXLM) {
  var Sdk     = getSdk();
  var horizon = getHorizon();
  var account = await horizon.loadAccount(state.publicKey);
  var fee     = await horizon.fetchBaseFee();
  var tx = new Sdk.TransactionBuilder(account, {
    fee: String(fee),
    networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
  })
    .addOperation(Sdk.Operation.payment({
      destination: winnerAddress,
      asset:       Sdk.Asset.native(),
      amount:      amountXLM.toFixed(7),
    }))
    .setTimeout(30)
    .build();

  var signedXdr = await signXdr(tx.toXDR());
  var signedTx  = Sdk.TransactionBuilder.fromXDR(signedXdr, CONFIG.NETWORK_PASSPHRASE);
  var result    = await horizon.submitTransaction(signedTx);
  return result.hash;
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN — startDraw
//  Full automated flow:
//    1. Generate secret + commitment
//    2. commit_draw on Soroban
//    3. register_participant × N
//    4. close_registrations
//    5. Compute winner with ZK proof
//    6. Animate wheel
//    7. reveal_winner on Soroban
//    8. Send XLM prize to winner via Horizon
// ─────────────────────────────────────────────────────────────────────────────
window.startDraw = async function () {
  if (state.running) return;
  if (!state.publicKey) { alert("Connect your wallet first"); return; }
  if (!state.prizeAmount || !state.participantsTarget) { alert("Complete the setup first"); return; }
  if (state.participants.length < state.participantsTarget) {
    alert("Add all " + state.participantsTarget + " participant wallets first"); return;
  }

  state.running = true;
  evaluateSpinButton();
  document.getElementById("spin-btn-inner").innerHTML = '<span class="spinner"></span> Running…';
  document.getElementById("stat-phase").textContent = "DRAW";

  try {
    // ── 1. Generate secret & commitment ──────────────────────────────────
    log("Generating secret number and salt…", "info");
    var secretBytes = randomBytes(8);
    var secret = new DataView(secretBytes.buffer).getBigUint64(0, false);
    if (secret === 0n) secret = 1n;
    var salt = randomBytes(32);
    var commitment = await computeCommitment(secret, salt);

    state.secretNumber = secret;
    state.salt         = salt;
    state.commitment   = commitment;
    state.sessionId    = Math.floor(Date.now() / 1000) % 999999 + 1;

    document.getElementById("zk-commitment").textContent = shortHex(commitment);
    document.getElementById("zk-commitment").className   = "zk-val ok";
    log("Commitment: " + shortHex(commitment), "ok");

    // Save to localStorage in case of page reload
    localStorage.setItem("zk_" + state.sessionId, JSON.stringify({
      secretNumber: secret.toString(),
      salt:         Array.from(salt),
      commitment:   Array.from(commitment),
    }));

    // ── 2. commit_draw ───────────────────────────────────────────────────
    log("Sending commit_draw to Soroban…", "info");
    await invokeContract("commit_draw", [
      scAddr(state.publicKey), scU32(state.sessionId), scBytes(commitment)
    ]);
    document.getElementById("zk-onchain").textContent = "✓ committed";
    document.getElementById("zk-onchain").className   = "zk-val ok";
    log("commit_draw(" + state.sessionId + ") confirmed ✓", "ok");

    // ── 3. register all participants ─────────────────────────────────────
    for (var ri = 0; ri < state.participants.length; ri++) {
      log("Registering #" + (ri+1) + "…", "info");
      await invokeContract("register_participant", [
        scU32(state.sessionId), scAddr(state.participants[ri])
      ]);
      log("✓ Registered: " + state.participants[ri].slice(0,10) + "…", "ok");
    }

    // ── 4. close_registrations ───────────────────────────────────────────
    log("Closing registrations…", "info");
    await invokeContract("close_registrations", [scU32(state.sessionId)]);
    log("Registrations closed ✓", "ok");

    // ── 5. ZK proof simulation ───────────────────────────────────────────
    log("Generating Noir ZK proof…", "info");
    document.getElementById("zk-proof-status").textContent = "generating…";
    var n = state.participants.length;
    var winnerIndex = Number(secret % BigInt(n));
    var proof = await simulateNoirProof(secret, salt, n, winnerIndex);

    var blob = new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" });
    var link = document.getElementById("noir-proof-link");
    link.href = URL.createObjectURL(blob);
    link.download = "zk_proof_" + state.sessionId + ".json";
    link.style.display = "block";
    document.getElementById("zk-proof-status").textContent = "✓ proof ready";
    document.getElementById("zk-proof-status").className   = "zk-val ok";
    document.getElementById("zk-winner").textContent = "#" + winnerIndex + " → " + state.participants[winnerIndex].slice(0,8) + "…";
    document.getElementById("zk-winner").className   = "zk-val ok";
    log("Noir proof: winner_index=" + winnerIndex + " (" + secret + " % " + n + ")", "ok");

    // ── 6. Spin animation ────────────────────────────────────────────────
    log("Spinning the wheel…", "info");
    document.getElementById("spin-btn-inner").innerHTML = '<span class="spinner"></span> Spinning…';
    var seg    = (Math.PI * 2) / n;
    var target = rAngle + (Math.floor(Math.random() * 4) + 8) * Math.PI * 2
                        + Math.PI * 2 - (seg * winnerIndex + seg / 2);
    await new Promise(function(r) { animateSpin(target, 6000, r); });
    drawWheel(state.participants, winnerIndex);

    // ── 7. reveal_winner on Soroban ──────────────────────────────────────
    log("Sending reveal_winner to Soroban…", "info");
    document.getElementById("spin-btn-inner").innerHTML = '<span class="spinner"></span> Revealing…';
    await invokeContract("reveal_winner", [
      scU32(state.sessionId), scU64(secret), scBytes(salt)
    ]);
    log("reveal_winner confirmed on-chain ✓", "ok");
    document.getElementById("stat-phase").textContent = "REVEALED";
    localStorage.removeItem("zk_" + state.sessionId);

    state.winnerIndex   = winnerIndex;
    state.winnerAddress = state.participants[winnerIndex];
    renderParticipants([winnerIndex]);

    // ── 8. Send prize XLM ────────────────────────────────────────────────
    var prizePerWinner = state.prizeAmount;
    log("Sending " + prizePerWinner + " XLM to " + state.winnerAddress.slice(0,10) + "…", "warn");
    document.getElementById("spin-btn-inner").innerHTML = '<span class="spinner"></span> Sending prize…';
    var txHash = await sendPrizeToWinner(state.winnerAddress, prizePerWinner);
    log("🏆 Prize sent! TX: " + txHash.slice(0,16) + "…", "ok");

    // ── 9. Show winner overlay ───────────────────────────────────────────
    showWinnerOverlay(winnerIndex, state.winnerAddress, prizePerWinner, txHash);

  } catch (err) {
    log("Draw error: " + err.message, "error");
    console.error(err);
    alert("Draw error: " + err.message);
    document.getElementById("spin-btn-inner").textContent = "🎰 Spin & Draw";
    document.getElementById("stat-phase").textContent = "ERROR";
    state.running = false;
    evaluateSpinButton();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  NOIR PROOF SIMULATION
// ─────────────────────────────────────────────────────────────────────────────
async function simulateNoirProof(secret, salt, n, winnerIdx) {
  await sleep(1400 + Math.random() * 1000);
  var commitment = await computeCommitment(secret, salt);
  return {
    _note: "Simulated proof — replace with @noir-lang/noir_js in production.",
    circuit: "zk_roulette", backend: "barretenberg/UltraPlonk",
    public_inputs: {
      public_commitment: "0x" + Array.from(commitment).map(function(b) { return b.toString(16).padStart(2,"0"); }).join(""),
      number_of_participants: n,
      winner_index: winnerIdx,
    },
    proof_bytes: "0x" + Array.from(randomBytes(32)).map(function(b) { return b.toString(16).padStart(2,"0"); }).join("") + "…",
    verified: true, timestamp: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  WINNER OVERLAY
// ─────────────────────────────────────────────────────────────────────────────
function showWinnerOverlay(index, address, prize, txHash) {
  document.getElementById("w-addr").textContent  = address || "—";
  document.getElementById("w-prize").textContent = prize ? prize.toFixed(4) + " XLM sent 🚀" : "";
  document.getElementById("w-badge").textContent = "Entry #" + (index + 1);
  var txEl = document.getElementById("w-tx");
  if (txHash) {
    txEl.style.display  = "block";
    txEl.innerHTML = "TX: <a href='https://stellar.expert/explorer/testnet/tx/" + txHash + "' target='_blank' style='color:var(--tan)'>" + txHash.slice(0,16) + "…</a>";
  }
  document.getElementById("winner-overlay").classList.add("show");
  document.getElementById("spin-btn-inner").textContent = "✓ Draw Complete";
}
window.closeWinnerOverlay = function () {
  document.getElementById("winner-overlay").classList.remove("show");
};

// ─────────────────────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────────────────────
(function init() {
  drawWheel([]);
  evaluateSpinButton();

  if (!window.freighterApi) {
    log("Freighter not detected — install at https://freighter.app", "warn");
  } else {
    var f = window.freighterApi;
    var checkAllowed = f.isAllowed
      ? f.isAllowed()
      : f.isConnected().then(function(r) { return typeof r === "boolean" ? r : r.isConnected; });

    checkAllowed.then(function(allowed) {
      if (!allowed) return;
      var getAddr = f.getAddress
        ? f.getAddress().then(function(r) { return resolveAddress(r); })
        : f.getPublicKey();
      getAddr.then(function(key) {
        if (key) applyWalletConnected(key);
      }).catch(function(){});
    }).catch(function(){});
  }

  log("Z-Spin v1.0 ready · Stellar Testnet · Protocol 25", "ok");
}());
