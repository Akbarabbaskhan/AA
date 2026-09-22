/**
 * The offline store.
 *
 * "The register must load from cache and accept marks with no connectivity, queue them in
 * IndexedDB, and sync automatically when the connection returns. Labs and sports grounds
 * have no signal."
 *
 * IndexedDB rather than localStorage because the queue holds structured records and must
 * survive a tab close, and because localStorage is synchronous and blocks the main thread
 * on a mid-range Android exactly when the teacher is tapping.
 */
export const DB_NAME = 'volt-offline';
export const DB_VERSION = 1;

export const STORE_QUEUE = 'attendance-queue';
export const STORE_REGISTERS = 'registers';
export const STORE_META = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

export function isOfflineStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function openOfflineDb(): Promise<IDBDatabase> {
  if (!isOfflineStorageAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available'));
  }

  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
        store.createIndex('byQueuedAt', 'queuedAt');
      }
      if (!db.objectStoreNames.contains(STORE_REGISTERS)) {
        db.createObjectStore(STORE_REGISTERS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });

  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export async function put<T>(storeName: string, value: T): Promise<void> {
  const db = await openOfflineDb();
  const transaction = db.transaction(storeName, 'readwrite');
  await promisify(transaction.objectStore(storeName).put(value));
}

export async function get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openOfflineDb();
  const transaction = db.transaction(storeName, 'readonly');
  return promisify<T | undefined>(transaction.objectStore(storeName).get(key) as IDBRequest<T | undefined>);
}

export async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openOfflineDb();
  const transaction = db.transaction(storeName, 'readonly');
  return promisify<T[]>(transaction.objectStore(storeName).getAll() as IDBRequest<T[]>);
}

export async function remove(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openOfflineDb();
  const transaction = db.transaction(storeName, 'readwrite');
  await promisify(transaction.objectStore(storeName).delete(key));
}

export async function count(storeName: string): Promise<number> {
  const db = await openOfflineDb();
  const transaction = db.transaction(storeName, 'readonly');
  return promisify(transaction.objectStore(storeName).count());
}
