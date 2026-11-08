// Keeps the last EPUB a reader opened on their own device (IndexedDB), so a
// reload brings the book back. Every call is best-effort: storage can be
// missing or blocked (private windows, sandboxed frames).
const DB = 'typestory-demo'
const STORE = 'books'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveLastBook(file: File): Promise<void> {
  try {
    const db = await open()
    const data = await file.arrayBuffer()
    db.transaction(STORE, 'readwrite').objectStore(STORE).put({ name: file.name, data }, 'last')
  } catch { /* storage unavailable */ }
}

export async function loadLastBook(): Promise<File | null> {
  try {
    const db = await open()
    const rec = await new Promise<{ name: string; data: ArrayBuffer } | undefined>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get('last')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return rec ? new File([rec.data], rec.name, { type: 'application/epub+zip' }) : null
  } catch {
    return null
  }
}

export async function forgetLastBook(): Promise<void> {
  try {
    const db = await open()
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete('last')
  } catch { /* storage unavailable */ }
}
