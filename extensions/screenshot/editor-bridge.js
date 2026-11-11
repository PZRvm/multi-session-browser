/* PiP 桥：Document PiP 文档不被注册为扩展上下文（chrome.* 不可用），自举编辑器
   需经 opener 同源借用 chrome 命名空间（函数对象属 opener 上下文，调用仍走扩展
   进程绑定本扩展）。须在编辑器 bundle 之前注入。改此文件必同步读改 editor-entry.tsx。 */
;(function () {
  'use strict'
  var op = window.opener
  if (!op || !op.chrome || !op.chrome.runtime) return
  try {
    Object.defineProperty(window, 'chrome', { value: op.chrome, configurable: true })
  } catch {
    window.chrome = op.chrome
  }
})()
