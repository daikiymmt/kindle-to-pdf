// db.js - IndexedDB を使った画像永続化ストレージ
const DB_NAME = "kindle-to-pdf";
const DB_VERSION = 1;
const STORE_NAME = "images";

let _dbInstance = null;

function openImageDB() {
  if (_dbInstance) {
    try {
      // 接続がまだ有効か確認（無効なら例外が発生する）
      _dbInstance.transaction(STORE_NAME, "readonly");
      return Promise.resolve(_dbInstance);
    } catch (e) {
      console.warn("[db] Cached connection is stale, reopening:", e.message);
      _dbInstance = null;
    }
  }

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "index" });
      }
    };
    req.onsuccess = () => {
      _dbInstance = req.result;
      _dbInstance.onclose = () => {
        console.warn("[db] Connection closed unexpectedly");
        _dbInstance = null;
      };
      _dbInstance.onversionchange = () => {
        console.warn("[db] Version change detected, closing connection");
        _dbInstance.close();
        _dbInstance = null;
      };
      console.log("[db] Connection opened successfully");
      resolve(_dbInstance);
    };
    req.onerror = () => {
      console.error("[db] Failed to open database:", req.error);
      reject(req.error);
    };
    req.onblocked = () => {
      console.warn("[db] Open request blocked by another connection");
    };
  });
}

// 失敗時に接続をリセットして1回リトライする
async function withRetry(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[db] ${label} failed, retrying with fresh connection:`, e.message);
    _dbInstance = null;
    return await fn();
  }
}

async function dbSaveImage(index, dataUrl) {
  return withRetry(`saveImage(${index})`, async () => {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ index, dataUrl });
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.error(`[db] saveImage(${index}) tx error:`, tx.error);
        reject(tx.error);
      };
      tx.onabort = () => {
        console.error(`[db] saveImage(${index}) tx aborted:`, tx.error);
        reject(tx.error || new Error("Transaction aborted"));
      };
    });
  });
}

async function dbGetImage(index) {
  return withRetry(`getImage(${index})`, async () => {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(index);
      req.onsuccess = () => resolve(req.result?.dataUrl || null);
      req.onerror = () => {
        console.error(`[db] getImage(${index}) error:`, req.error);
        reject(req.error);
      };
      tx.onabort = () => {
        console.error(`[db] getImage(${index}) tx aborted:`, tx.error);
        reject(tx.error || new Error("Transaction aborted"));
      };
    });
  });
}

async function dbGetImageCount() {
  return withRetry("getImageCount", async () => {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => {
        console.log(`[db] getImageCount: ${req.result}`);
        resolve(req.result);
      };
      req.onerror = () => {
        console.error("[db] getImageCount error:", req.error);
        reject(req.error);
      };
      tx.onabort = () => {
        console.error("[db] getImageCount tx aborted:", tx.error);
        reject(tx.error || new Error("Transaction aborted"));
      };
    });
  });
}

async function dbClearImages() {
  return withRetry("clearImages", async () => {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => {
        console.log("[db] All images cleared");
        resolve();
      };
      tx.onerror = () => {
        console.error("[db] clearImages error:", tx.error);
        reject(tx.error);
      };
      tx.onabort = () => {
        console.error("[db] clearImages tx aborted:", tx.error);
        reject(tx.error || new Error("Transaction aborted"));
      };
    });
  });
}
