// ============================================================
// PREENCHA com os mesmos dados do config.h do firmware:
// ============================================================
const FIREBASE_HOST   = "central-de-alarme-fa4ef-default-rtdb.firebaseio.com";
const FIREBASE_SECRET = "nXGkmt4WFSckD4fPd6kCpFAXORIqF15INqQS49Qw";
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
  const candidatePin = currentPin;
  $("loginError").textContent = "Verificando...";
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    await fetch(dbUrl("commands"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "validate", pin: candidatePin, token })
    });
  } catch (e) {
    $("loginError").textContent = "Sem conexão com o Firebase.";
    currentPin = ""; updatePinDots();
    return;
  }
  setTimeout(async () => {
    try {
      const res = await fetch(dbUrl("lastResult"));
      const data = await res.json();
      if (data && data.token === token && data.ok) {
        pin = candidatePin;
        sessionStorage.setItem("alarme_pin", pin);
        $("loginError").textContent = "";
        enterMain();
      } else {
        $("loginError").textContent = "PIN incorreto.";
        currentPin = ""; updatePinDots();
      }
    } catch (e) {
      $("loginError").textContent = "ESP32 offline ou sem resposta.";
      currentPin = ""; updatePinDots();
    }
  }, 5000); // dá tempo do ESP32 buscar o comando (poll a cada ~3.5s) e responder
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

  if (!switchDragging) {
    $("armSwitch").setAttribute("aria-checked", status.state !== "disarmed" ? "true" : "false");
  }
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

// ---------------- ARM SWITCH (arrastável) ----------------
let switchDragging = false;
const armSwitchEl = $("armSwitch");
const armKnobEl = armSwitchEl.querySelector(".arm-switch-knob");
let dragStartX = 0, dragBaseX = 0, dragMax = 0;

function switchMaxTranslate() {
  return armSwitchEl.clientWidth - armKnobEl.clientWidth - 6;
}

armSwitchEl.addEventListener("pointerdown", (e) => {
  switchDragging = true;
  armSwitchEl.setPointerCapture(e.pointerId);
  dragStartX = e.clientX;
  dragMax = switchMaxTranslate();
  const isArmed = armSwitchEl.getAttribute("aria-checked") === "true";
  dragBaseX = isArmed ? dragMax : 0;
  armKnobEl.style.transition = "none";
});

armSwitchEl.addEventListener("pointermove", (e) => {
  if (!switchDragging) return;
  let x = dragBaseX + (e.clientX - dragStartX);
  x = Math.max(0, Math.min(dragMax, x));
  armKnobEl.style.transform = `translateX(${x}px)`;
});

armSwitchEl.addEventListener("pointerup", (e) => {
  if (!switchDragging) return;
  switchDragging = false;
  armKnobEl.style.transition = "";
  armKnobEl.style.transform = "";
  let x = dragBaseX + (e.clientX - dragStartX);
  x = Math.max(0, Math.min(dragMax, x));
  const shouldArm = x > dragMax / 2;
  const isArmed = armSwitchEl.getAttribute("aria-checked") === "true";
  if (shouldArm === isArmed) return;
  sendCommand(shouldArm ? "arm" : "disarm");
});

armSwitchEl.addEventListener("pointercancel", () => {
  switchDragging = false;
  armKnobEl.style.transition = "";
  armKnobEl.style.transform = "";
});

if (pin) enterMain();
