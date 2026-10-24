import type { Song } from './model';
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('music-sections-library', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('songs', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('The song library could not be opened.'));
});
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('songs', mode); const request = action(tx.objectStore('songs'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(new Error('Could not save the library. Check available disk space, then export a backup.'));
    tx.onabort = () => reject(new Error('The library change was not saved. Check available disk space.'));
  });
}
export const listSongs = () => transaction('readonly', store => store.getAll()) as Promise<Song[]>;
export const saveSong = (song: Song) => transaction('readwrite', store => store.put(song));
export const deleteSong = (id: string) => transaction('readwrite', store => store.delete(id));
