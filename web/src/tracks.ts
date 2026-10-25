/**
 * Imported tracks live in IndexedDB, not on the server: the vault is read-only
 * and an mp4 can be far bigger than anything a note store should carry. Two
 * stores keep listing cheap — metadata is read on its own, blobs only when a
 * track is actually played.
 */

export type TrackKind = "audio" | "video";

export interface TrackMeta {
  id: string;
  name: string;
  kind: TrackKind;
  bytes: number;
  type: string;
  addedAt: number;
}

export interface TrackFileLike {
  name: string;
  size: number;
  type: string;
  lastModified?: number;
}

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov)$/i;

/** Audio of any kind plus the video containers whose audio track we can play. */
export function acceptsTrack(file: TrackFileLike): boolean {
  const type = file.type.toLowerCase();
  if (type.startsWith("audio/")) return true;
  if (type.startsWith("video/")) return true;
  return AUDIO_EXT.test(file.name) || VIDEO_EXT.test(file.name);
}

export function trackKind(file: TrackFileLike): TrackKind {
  const type = file.type.toLowerCase();
  if (type.startsWith("video/") || (!type.startsWith("audio/") && VIDEO_EXT.test(file.name))) {
    return "video";
  }
  return "audio";
}

/** Stable, readable id: re-importing the same file replaces its own entry. */
export function trackId(file: TrackFileLike): string {
  const base =
    file.name
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "track";
  return `${base}-${file.size}-${file.lastModified ?? 0}`;
}

export function describeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DB_NAME = "braindash-sound";
const DB_VERSION = 1;
const META_STORE = "meta";
const BLOB_STORE = "blobs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
  });
}

export async function listTracks(): Promise<TrackMeta[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(META_STORE, "readonly");
    const request = tx.objectStore(META_STORE).getAll();
    const rows = await new Promise<TrackMeta[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as TrackMeta[]);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
    });
    return rows.sort((a, b) => b.addedAt - a.addedAt);
  } finally {
    db.close();
  }
}

export async function saveTrack(file: File): Promise<TrackMeta> {
  const meta: TrackMeta = {
    id: trackId(file),
    name: file.name,
    kind: trackKind(file),
    bytes: file.size,
    type: file.type,
    addedAt: Date.now(),
  };
  const db = await openDb();
  try {
    const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
    tx.objectStore(META_STORE).put(meta);
    tx.objectStore(BLOB_STORE).put(file, meta.id);
    await done(tx);
    return meta;
  } finally {
    db.close();
  }
}

export async function loadTrackBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(BLOB_STORE, "readonly");
    const request = tx.objectStore(BLOB_STORE).get(id);
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
    });
    return blob;
  } finally {
    db.close();
  }
}

export async function removeTrack(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(BLOB_STORE).delete(id);
    await done(tx);
  } finally {
    db.close();
  }
}
