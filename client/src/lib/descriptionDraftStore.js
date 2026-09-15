const DB_NAME = "nmtaskboard-description-drafts";
const STORE = "drafts";

function database() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return resolve(null);
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function descriptionDraftKey({ actorId = "anonymous", workspaceId = "workspace", taskId = "new" }) {
  return `${actorId}:${workspaceId}:${taskId}`;
}

export async function saveDescriptionDraft(key, value) {
  const db = await database();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put({ key, ...value, savedAt: new Date().toISOString() });
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
}

export async function loadDescriptionDraft(key) {
  const db = await database();
  if (!db) return null;
  const value = await new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

export async function removeDescriptionDraft(key) {
  const db = await database();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
}
