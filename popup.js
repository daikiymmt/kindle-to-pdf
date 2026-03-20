const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnDownload = document.getElementById("btn-download");
const statusBar = document.getElementById("status-bar");
const statusText = document.getElementById("status-text");
const progressContainer = document.getElementById("progress-container");
const progressFill = document.getElementById("progress-fill");
const progressTextEl = document.getElementById("progress-text");
const previewArea = document.getElementById("preview-area");
const inputTotalPages = document.getElementById("total-pages");
const inputDelay = document.getElementById("delay");

let tabId = null;

// 現在のタブIDを取得
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    tabId = tabs[0].id;
    const url = tabs[0].url || "";
    if (
      !url.includes("read.amazon.co.jp") &&
      !url.includes("read.amazon.com")
    ) {
      setStatus("error", "Kindle Cloud Readerを開いてください");
      btnStart.disabled = true;
    }
  }
});

// ポップアップ起動時に既存のキャプチャ画像があればダウンロード可能にする
dbGetImageCount()
  .then((count) => {
    console.log(`[popup] Startup image count: ${count}`);
    if (count > 0) {
      btnDownload.disabled = false;
      setStatus("done", `${count}枚のキャプチャ済み画像があります`);
    }
  })
  .catch((e) => {
    console.error("[popup] Startup dbGetImageCount failed:", e);
  });

// background からのメッセージを受け取る
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "captureProgress") {
    updateProgress(msg.current, msg.total);
    // サムネイル追加
    if (msg.dataUrl) {
      const img = document.createElement("img");
      img.src = msg.dataUrl;
      previewArea.appendChild(img);
      previewArea.scrollTop = previewArea.scrollHeight;
    }
  }

  if (msg.action === "captureDone") {
    const count = msg.count || 0;
    if (msg.errorMessage) {
      console.error("[popup] Capture ended with error:", msg.errorMessage);
      setStatus("error", `エラー: ${msg.errorMessage} (${count}枚保存済み)`);
    } else {
      setStatus("done", `キャプチャ完了! (${count}枚)`);
    }
    btnStart.disabled = false;
    btnStop.disabled = true;
    btnDownload.disabled = count === 0;
  }

  if (msg.action === "captureError") {
    console.error("[popup] captureError:", msg.message);
    setStatus("error", msg.message);
    btnStart.disabled = false;
    btnStop.disabled = true;
  }
});

btnStart.addEventListener("click", async () => {
  const totalPages = parseInt(inputTotalPages.value, 10);
  const delay = parseInt(inputDelay.value, 10);

  if (!totalPages || totalPages < 1 || !delay || delay < 2000) {
    setStatus("error", "設定値を確認してください");
    return;
  }

  // IndexedDB の画像バッファをクリア（background の内部カウンターもリセット）
  try {
    await sendToBackground({ action: "clearImages" });
  } catch (e) {
    console.error("[popup] clearImages failed:", e);
  }
  previewArea.innerHTML = "";

  // UIを更新
  setStatus("running", "キャプチャ中...");
  btnStart.disabled = true;
  btnStop.disabled = false;
  btnDownload.disabled = true;
  progressContainer.style.display = "block";
  updateProgress(0, totalPages);

  // background にキャプチャ開始を指示
  await sendToBackground({
    action: "startCapture",
    tabId,
    totalPages,
    maxWait: delay,
  });
});

btnStop.addEventListener("click", async () => {
  await sendToBackground({ action: "stopCapture" });
  setStatus("idle", "停止しました");
  btnStart.disabled = false;
  btnStop.disabled = true;

  try {
    const count = await dbGetImageCount();
    console.log(`[popup] After stop, image count: ${count}`);
    if (count > 0) {
      btnDownload.disabled = false;
      setStatus("idle", `停止しました (${count}枚保存済み)`);
    }
  } catch (e) {
    console.error("[popup] dbGetImageCount after stop failed:", e);
  }
});

btnDownload.addEventListener("click", async () => {
  setStatus("running", "PDF生成中...");
  btnDownload.disabled = true;
  btnStart.disabled = true;

  try {
    // IndexedDB から直接画像数を取得
    const imageCount = await dbGetImageCount();
    console.log(`[popup] Download: image count = ${imageCount}`);

    if (imageCount === 0) {
      setStatus("error", "画像がありません（IndexedDB に画像が見つかりません）");
      btnDownload.disabled = false;
      btnStart.disabled = false;
      return;
    }

    const chunkSize =
      parseInt(document.getElementById("chunk-size").value, 10) || 50;

    await generatePDFs(imageCount, chunkSize);
    setStatus("done", "PDFダウンロード完了!");
  } catch (e) {
    console.error("[popup] PDF generation error:", e);
    setStatus("error", "PDF生成エラー: " + e.message);
  }

  btnDownload.disabled = false;
  btnStart.disabled = false;
});

// UIスレッドを解放するための待機
function yieldToUI() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function generatePDFs(imageCount, chunkSize) {
  const totalChunks = Math.ceil(imageCount / chunkSize);
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  progressContainer.style.display = "block";

  for (let c = 0; c < totalChunks; c++) {
    const start = c * chunkSize;
    const end = Math.min(start + chunkSize, imageCount);

    setStatus("running", `PDF生成中... (${c + 1}/${totalChunks}ファイル)`);

    // 最初の画像からサイズを取得
    const firstDataUrl = await dbGetImage(start);
    if (!firstDataUrl) {
      throw new Error(
        `画像 ${start + 1} がDBに見つかりません (index=${start})`
      );
    }
    const firstImg = await loadImage(firstDataUrl);
    const width = firstImg.width;
    const height = firstImg.height;
    const orientation = width > height ? "landscape" : "portrait";

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation,
      unit: "px",
      format: [width, height],
      compress: true,
    });

    for (let i = start; i < end; i++) {
      if (i > start) {
        pdf.addPage([width, height], orientation);
      }

      // IndexedDB から1枚ずつ読み込み
      const dataUrl = await dbGetImage(i);
      if (!dataUrl) {
        throw new Error(
          `画像 ${i + 1} がDBに見つかりません (index=${i})`
        );
      }
      const img = await loadImage(dataUrl);
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const jpegUrl = canvas.toDataURL("image/jpeg", 0.8);
      pdf.addImage(jpegUrl, "JPEG", 0, 0, width, height);

      updateProgress(i + 1, imageCount);
      if ((i - start) % 5 === 4) {
        await yieldToUI();
      }
    }

    const suffix = totalChunks > 1 ? `_part${c + 1}` : "";
    pdf.save(`kindle-capture-${timestamp}${suffix}.pdf`);
    await yieldToUI();
  }

  canvas.width = 0;
  canvas.height = 0;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("画像の読み込みに失敗しました"));
    img.src = dataUrl;
  });
}

function setStatus(type, text) {
  statusBar.className = "status " + type;
  statusText.textContent = text;
}

function updateProgress(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressFill.style.width = pct + "%";
  progressTextEl.textContent = `${current} / ${total}`;
}

function sendToBackground(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, resolve);
  });
}
