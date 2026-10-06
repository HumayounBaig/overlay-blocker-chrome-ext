const DEFAULTS = { enabled: true, reduction: 100, hiddenSelectors: [] };

const enabled = document.querySelector("#enabled");
const reduction = document.querySelector("#reduction");
const reductionValue = document.querySelector("#reductionValue");
const site = document.querySelector("#site");
const status = document.querySelector("#status");
const statusDot = document.querySelector("#statusDot");
const scan = document.querySelector("#scan");
const picker = document.querySelector("#picker");
const reset = document.querySelector("#reset");

let tab;
let host;
let settings;

async function activeTab() {
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  return current;
}

async function send(type, extra = {}) {
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
  } catch {
    showStatus("Unavailable on this page", false);
    return null;
  }
}

function showStatus(message, ok = true) {
  status.textContent = message;
  statusDot.style.background = ok ? "#6bd49b" : "#f1ad5b";
}

async function save(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ [`site:${host}`]: settings });
  const result = await send("apply-settings", { settings });
  showStatus(
    result ? `${result.detected} overlay${result.detected === 1 ? "" : "s"} adjusted` : "Settings saved",
  );
}

async function init() {
  tab = await activeTab();

  try {
    const url = new URL(tab.url);
    host = url.hostname;
    site.textContent = host || "Current page";
  } catch {
    host = "unsupported";
    site.textContent = "Restricted page";
  }

  const stored = await chrome.storage.local.get(`site:${host}`);
  settings = { ...DEFAULTS, ...(stored[`site:${host}`] || {}) };
  enabled.checked = settings.enabled;
  reduction.value = settings.reduction;
  reductionValue.value = `${settings.reduction}%`;

  const result = await send("get-status");
  if (result) showStatus(`${result.detected} overlay${result.detected === 1 ? "" : "s"} adjusted`);
}

enabled.addEventListener("change", () => save({ enabled: enabled.checked }));

reduction.addEventListener("input", () => {
  reductionValue.value = `${reduction.value}%`;
  send("preview-reduction", { reduction: Number(reduction.value) });
});

reduction.addEventListener("change", () => save({ reduction: Number(reduction.value) }));

scan.addEventListener("click", async () => {
  const result = await send("rescan");
  if (result) showStatus(`${result.detected} overlay${result.detected === 1 ? "" : "s"} adjusted`);
});

picker.addEventListener("click", async () => {
  const result = await send("start-picker");
  if (result) window.close();
});

reset.addEventListener("click", async () => {
  await save({ hiddenSelectors: [] });
  await send("reset-hidden");
  showStatus("Hidden elements restored");
});

init();
