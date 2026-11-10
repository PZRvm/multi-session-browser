/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript，sandbox preload 使用 CommonJS */
import WebSocket from 'ws'
export class CDP {
  constructor(socket) {
    this.socket = socket
    this.serial = 0
    this.pending = new Map()
    socket.on('message', (raw) => {
      const message = JSON.parse(raw)
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
    })
    socket.on('close', () => {
      for (const item of this.pending.values()) {
        clearTimeout(item.timer)
        item.reject(new Error('CDP连接关闭'))
      }
      this.pending.clear()
    })
  }
  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    return new CDP(socket)
  }
  send(method, params = {}, sessionId, timeout = 20000) {
    const id = ++this.serial
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method}超时`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  async attach(targetId) {
    return (await this.send('Target.attachToTarget', { targetId, flatten: true })).sessionId
  }
  async evaluate(expression, sessionId, timeout = 20000) {
    const result = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      sessionId,
      timeout
    )
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.text + ': ' + JSON.stringify(result.exceptionDetails.exception)
      )
    return result.result.value
  }
  close() {
    this.socket.close()
  }
}
