importScripts("db.js");

let isCapturing = false;
let stopRequested = false;
let capturedCount = 0;

// ネットワーク監視用
let pendingRequests = new Set();
let monitoringTabId = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "startCapture") {
    stopRequested = false;
    runCapture(msg.tabId, msg.totalPages, msg.maxWait);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "stopCapture") {
    stopRequested = true;
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "getImageCount") {
    dbGetImageCount()
      .then((count) => {
        console.log(`[background] getImageCount responded: ${count}`);
        sendResponse({ count });
      })
      .catch((e) => {
        console.error("[background] getImageCount failed:", e);
        sendResponse({ count: 0, error: e.message });
      });
    return true;
  }

  if (msg.action === "clearImages") {
    dbClearImages()
      .then(() => {
        capturedCount = 0;
        sendResponse({ ok: true });
      })
      .catch((e) => {
        console.error("[background] clearImages failed:", e);
        sendResponse({ ok: false, error: e.message });
      });
    return true;
  }

  if (msg.action === "getState") {
    sendResponse({ isCapturing, count: capturedCount });
    return true;
  }
});

// --- Debugger ネットワークイベント監視 ---
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== monitoringTabId) return;

  if (method === "Network.requestWillBeSent") {
    pendingRequests.add(params.requestId);
  }
  if (
    method === "Network.loadingFinished" ||
    method === "Network.loadingFailed"
  ) {
    pendingRequests.delete(params.requestId);
  }
});

// --- ユーティリティ ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function debuggerCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

function debuggerAttach(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function debuggerDetach(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => resolve());
  });
}

function captureTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(dataUrl);
      }
    });
  });
}

async function sendKey(tabId, key, code, keyCode) {
  await debuggerCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  });
  await debuggerCommand(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  });
}

// --- ネットワークアイドル検知 ---
// pending が 0 になり、idleMs の間新しいリクエストが来なければ完了
async function waitForNetworkIdle(idleMs, maxWait) {
  const deadline = Date.now() + maxWait;

  while (Date.now() < deadline) {
    // pending が 0 になるまで待つ
    if (pendingRequests.size > 0) {
      await sleep(100);
      continue;
    }

    // 0 になった。idleMs の間 0 のままか監視
    const idleStart = Date.now();
    let stayedIdle = true;

    while (Date.now() - idleStart < idleMs) {
      await sleep(50);
      if (pendingRequests.size > 0) {
        stayedIdle = false;
        break;
      }
    }

    if (stayedIdle) return;
  }
}

// --- メインのキャプチャループ ---
async function runCapture(tabId, totalPages, maxWait) {
  isCapturing = true;
  monitoringTabId = tabId;
  pendingRequests.clear();
  capturedCount = 0;

  try {
    await debuggerAttach(tabId);
    await debuggerCommand(tabId, "Network.enable");
  } catch (e) {
    console.error("[capture] Debugger attach failed:", e);
    broadcastMessage({
      action: "captureError",
      message: "Debugger接続失敗: " + e.message,
    });
    isCapturing = false;
    return;
  }

  // ネットワークアイドル後に描画を待つ余裕時間
  const RENDER_DELAY = 300;
  // ネットワーク通信がこの期間なければアイドルとみなす
  const NETWORK_IDLE_MS = 500;

  let errorMessage = null;
  let prevDataUrl = null;

  try {
    for (let i = 0; i < totalPages; i++) {
      if (stopRequested) {
        console.log(`[capture] Stop requested at page ${i + 1}`);
        break;
      }

      if (i > 0) {
        // ページ送り
        await sendKey(tabId, "ArrowRight", "ArrowRight", 39);
      }

      // ネットワークが落ち着くまで待機
      await waitForNetworkIdle(NETWORK_IDLE_MS, maxWait);

      // 描画完了を待つ余裕
      await sleep(RENDER_DELAY);

      // スクリーンショット
      const dataUrl = await captureTab();

      // 前ページと同一ならこれ以上進めない（末尾到達）
      if (prevDataUrl && dataUrl === prevDataUrl) {
        console.log(
          `[capture] Page ${i + 1}: identical to previous — end of book (${capturedCount} pages captured)`
        );
        break;
      }
      prevDataUrl = dataUrl;

      // IndexedDB に永続化
      try {
        await dbSaveImage(i, dataUrl);
      } catch (e) {
        console.error(`[capture] Failed to save image ${i} to IndexedDB:`, e);
        errorMessage = `画像 ${i + 1} のDB保存に失敗: ${e.message}`;
        break;
      }

      capturedCount = i + 1;

      // 進捗を通知
      broadcastMessage({
        action: "captureProgress",
        current: i + 1,
        total: totalPages,
        dataUrl,
      });
    }
  } catch (e) {
    console.error("[capture] Capture loop error:", e);
    errorMessage = e.message;
  }

  try {
    await debuggerCommand(tabId, "Network.disable");
    await debuggerDetach(tabId);
  } catch (_) {
    // ignore
  }

  monitoringTabId = null;
  isCapturing = false;

  // DB に実際に保存された枚数を確認
  let verifiedCount = capturedCount;
  try {
    verifiedCount = await dbGetImageCount();
    console.log(
      `[capture] Done. capturedCount=${capturedCount}, verifiedCount=${verifiedCount}`
    );
    if (verifiedCount !== capturedCount) {
      console.warn(
        `[capture] Count mismatch! capturedCount=${capturedCount}, DB count=${verifiedCount}`
      );
    }
  } catch (e) {
    console.error("[capture] Failed to verify image count:", e);
  }

  broadcastMessage({
    action: "captureDone",
    count: verifiedCount,
    errorMessage,
  });
}

// popup にメッセージを送る
function broadcastMessage(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}
