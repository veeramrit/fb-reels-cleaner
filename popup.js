// popup.js — FB Reels Cleaner

let isRunning = false;
let deletedTotal = 0;
let skippedTotal = 0;

const statusBox = document.getElementById("status-box");
const cntDeleted = document.getElementById("cnt-deleted");
const cntSkipped = document.getElementById("cnt-skipped");
const cntTotal = document.getElementById("cnt-total");
const indicatorDot = document.getElementById("indicator-dot");
const indicatorText = document.getElementById("indicator-text");

function addLog(msg, type = "info") {
  const line = document.createElement("div");
  line.className = "log-line";
  line.innerHTML = `<div class="log-dot ${type}"></div><div class="log-text ${type}">${msg}</div>`;
  statusBox.appendChild(line);
  statusBox.scrollTop = statusBox.scrollHeight;

  // Keep max 40 lines
  while (statusBox.children.length > 40) {
    statusBox.removeChild(statusBox.firstChild);
  }
}

function updateCounters(deleted, skipped) {
  cntDeleted.textContent = deleted;
  cntSkipped.textContent = skipped;
  cntTotal.textContent = deleted + skipped;
}

function setRunning(val) {
  isRunning = val;
  document.body.classList.toggle("running", val);
  indicatorDot.classList.toggle("active", val);
  indicatorText.textContent = val ? "running" : "idle";
}

// Listen to status messages from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "status") {
    addLog(msg.msg, msg.type || "info");
    if (msg.deletedCount !== undefined) updateCounters(msg.deletedCount, msg.skippedCount || 0);
    if (msg.type === "success" && msg.msg.toLowerCase().includes("finish")) {
      setRunning(false);
    }
  }
});

// Helper to get active Facebook tab
async function getFBTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.url?.includes("facebook.com")) {
    addLog("❌ Please open a Facebook tab first!", "error");
    return null;
  }
  return tab;
}

async function sendToContent(action) {
  const tab = await getFBTab();
  if (!tab) return;

  try {
    // Ensure content script is injected
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    }).catch(() => {}); // ignore if already injected

    const resp = await chrome.tabs.sendMessage(tab.id, { action });
    if (resp && !resp.ok) {
      addLog(resp.msg || "Error sending command.", "error");
    }
  } catch (e) {
    addLog("Cannot connect to page. Reload the Facebook tab.", "error");
  }
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

document.getElementById("btn-delete-all").addEventListener("click", async () => {
  if (isRunning) return;
  setRunning(true);
  deletedTotal = 0;
  skippedTotal = 0;
  updateCounters(0, 0);
  addLog("Starting bulk delete via Activity Log...", "info");
  await sendToContent("deleteAllActivityLog");
});

document.getElementById("btn-delete-one").addEventListener("click", async () => {
  if (isRunning) return;
  addLog("Deleting current reel and going to next...", "info");
  await sendToContent("deleteOne");
});

document.getElementById("btn-auto-viewing").addEventListener("click", async () => {
  if (isRunning) return;
  setRunning(true);
  addLog("Starting auto-delete in Reel Viewer...", "info");
  await sendToContent("autoDeleteViewing");
});

document.getElementById("btn-stop").addEventListener("click", async () => {
  if (!isRunning) return;
  addLog("Stop requested...", "warn");
  await sendToContent("stop");
  setRunning(false);
});

document.getElementById("btn-debug").addEventListener("click", async () => {
  addLog("Scanning page DOM...", "info");
  await sendToContent("debug");
});

// Initial ping to check if content script is active
(async () => {
  const tab = await chrome.tabs.query({ active: true, currentWindow: true }).then(t => t[0]);
  if (tab?.url?.includes("facebook.com")) {
    addLog("✓ Facebook tab detected. Ready.", "success");
  } else {
    addLog("⚠ Open facebook.com to use this extension.", "warn");
  }
})();
