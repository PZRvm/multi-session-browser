/* eslint @typescript-eslint/explicit-function-return-type: off -- 扩展页面与 Worker 共用 */
/* global chrome */
const MAX_KEPT = 10
let opening

function database() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('screenshot-images', 1)
      request.onupgradeneeded = () =>
        request.result.createObjectStore('captures', { keyPath: 'captureId' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }).catch((error) => {
      opening = undefined
      throw error
    })
  }
  return opening
}

async function transact(mode, request) {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('captures', mode)
    const result = request(transaction.objectStore('captures'))
    transaction.oncomplete = () => resolve(result?.result)
    transaction.onabort = () => reject(transaction.error)
  })
}

export function saveCapture(capture) {
  return transact('readwrite', (store) => store.put(capture))
}

export async function loadCapture(captureId) {
  if (!captureId || !/^[a-zA-Z0-9-]{1,128}$/.test(captureId)) return null
  const capture = await transact('readonly', (store) => store.get(captureId))
  if (capture) return capture
  const key = 'capture:' + captureId
  const legacy = (await chrome.storage.local.get(key))[key]
  return legacy?.dataUrl ? { ...legacy, blob: await (await fetch(legacy.dataUrl)).blob() } : null
}

export async function trimCaptures() {
  await transact('readwrite', (store) => {
    const request = store.getAll()
    request.onsuccess = () => {
      request.result
        .filter((capture) => !(capture.handoffUntil > Date.now()))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(MAX_KEPT)
        .forEach((capture) => store.delete(capture.captureId))
    }
  })
}

export async function pngDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (typeof bytes.toBase64 === 'function') return 'data:image/png;base64,' + bytes.toBase64()
  let text = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return 'data:image/png;base64,' + btoa(text)
}
