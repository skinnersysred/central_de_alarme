// ============================================================
// PREENCHA com os mesmos dados do config.h do firmware:
// ============================================================
const FIREBASE_HOST   = "SEU-PROJETO-default-rtdb.firebaseio.com";
const FIREBASE_SECRET = "SEU_DATABASE_SECRET_AQUI";
// ============================================================

const STATE_LABELS = {
  disarmed:    "Desarmado",
  exit_delay:  "Saindo…",
  armed:       "Armado",
  entry_delay: "Entrando…",
  triggered:   "ALARME DISPARADO"
};

let pin = sessionStorage.getItem("alarme_pin") || null;
let currentPin = "";
let lastStatus = null;
let pollTimer = null;

const $ = (id) => document.getElementById(id);
const dbUrl = (path) => `https://${FIREBASE_HOST}/${path}.json?auth=${FIREBASE_SECRET}`;

// ---------------- LOGIN ----------------
function updatePinDots() {
  document.querySelectorAll("#pinDots span").forEach((d, i) => d.classList.toggle("filled", i < currentPin.length));
}

document.querySelectorAll(".key").forEach(btn => {
  btn.addEventListener("click", () => {
    const k = btn.dataset.k;
    if (k === "clear") currentPin = "";
    else if (k === "back") currentPin = currentPin.slice(0, -1);
    else if (currentPin.length < 4) currentPin += k;
    updatePinDots();
    if (currentPin.length === 4) doLogin();
  });
});

async function doLogin() {
  // Não há como validar o PIN sem contato direto com o ESP32 (ele está
  // atrás do CG-NAT). Guardamos o PIN localmente e o ESP32 confere ele
  // a cada comando enviado — se estiver errado, o comando é ignorado.
  pin = currentPin;
  sessionStorage.setItem("alarme_pin", pin);
  enterMain();
}

$("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("alarme_pin");
  pin = null;
  if (pollTimer) clearInterval(pollTimer);
  $("mainScreen").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  currentPin = "";
  updatePinDots();
});

// ---------------- MAIN ----------------
function enterMain() {
  $("loginScreen").classList.add("hidden");
  $("mainScreen").classList.remove("hidden");
  fetchStatus();
  pollTimer = setInterval(fetchStatus, 3000);
}

async function fetchStatus() {
  try {
    const res = await fetch(dbUrl("status"));
    const data = await res.json();
    if (data) render(data);
  } catch (e) { /* rede instável, tenta de novo no próximo ciclo */ }
}

function render(status) {
  lastStatus = status;
  $("statusText").textContent = STATE_LABELS[status.state] || status.state;

  const banner = $("statusBanner");
  banner.classList.remove("armed", "triggered");
  const dot = $("statusDot");
  dot.classList.remove("alert");

  if (status.state === "triggered") { banner.classList.add("triggered"); dot.classList.add("alert"); }
  else if (["armed", "exit_delay", "entry_delay"].includes(status.state)) banner.classList.add("armed");

  if (status.state === "exit_delay" || status.state === "entry_delay") {
    const total = status.state === "exit_delay" ? status.exitDelay : status.entryDelay;
    $("statusTimer").textContent = Math.max(0, total - status.elapsed) + "s";
  } else if (status.state === "triggered") {
    $("statusTimer").textContent = status.triggeredZone || "";
  } else {
    $("statusTimer").textContent = "";
  }

  $("armSwitch").setAttribute("aria-checked", status.state !== "disarmed" ? "true" : "false");
  renderZones(status.zones || []);
}

function renderZones(zones) {
  const grid = $("zonesGrid");
  grid.innerHTML = "";
  const systemDisarmed = lastStatus && lastStatus.state === "disarmed";

  zones.forEach(z => {
    let stateClass = "state-green", stateLabel = "Normal";
    if (z.tripped) { stateClass = "state-red"; stateLabel = "Aberto"; }
    else if (z.armed && !systemDisarmed) { stateClass = "state-blue"; stateLabel = "Armado"; }
    else { stateClass = "state-green"; stateLabel = z.armed ? "Armado" : "Liberado"; }

    const card = document.createElement("div");
    card.className = "zone-card " + stateClass;
    card.innerHTML = `
      <div class="zone-name">${z.name}</div>
      <div class="zone-meta">
        <span class="zone-state">${stateLabel}</span>
        <span class="zone-armed-pill ${z.armed ? "on" : ""}"></span>
      </div>`;
    card.addEventListener("click", () => sendCommand("zone_toggle", { key: z.key }));
    grid.appendChild(card);
  });
}

// ---------------- COMANDOS ----------------
async function sendCommand(action, extra = {}) {
  const body = Object.assign({ action, pin, ts: Date.now() }, extra);
  await fetch(dbUrl("commands"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  // dá um tempinho pro ESP32 processar e então atualiza a tela
  setTimeout(fetchStatus, 3500);
}

$("armSwitch").addEventListener("click", () => {
  const isArmed = $("armSwitch").getAttribute("aria-checked") === "true";
  sendCommand(isArmed ? "disarm" : "arm");
});

if (pin) enterMain();
