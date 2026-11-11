/* eslint @typescript-eslint/explicit-function-return-type: off -- PiP 生命周期脚本为纯 JS 扩展代码 */
/* PiP 生命周期脚本（PiP 文档自身上下文常驻）：
   ① 工具行出现后在行首插入仿 macOS 三灯组（红=关窗功能灯，黄/绿为 PiP 无系统灯
     的形态示意）；观察器常驻 + 幂等补插，兜住工具行内 React 重渲染的节点置换。
   ② Ctrl/⌘+滚轮缩放画布（0.25–4，CSS zoom 施加于 Konva 容器），普通滚轮保持滚动；
     续编重挂后重新施加当前 zoom。
   注入链与职责契约见 editor-entry.tsx；改此文件必同步读改 editor-entry.tsx。 */
;(function () {
  'use strict'
  var zoom = 1
  function konvaHost() {
    return document.querySelector('.chrome-capture-editor-canvas')
  }

  function konvaContainer() {
    var host = konvaHost()
    return host ? host.firstElementChild : null
  }

  function applyZoom() {
    var konva = konvaContainer()
    if (konva) konva.style.zoom = String(zoom)
  }
  document.addEventListener(
    'wheel',
    function (event) {
      var host = konvaHost()
      if (!host || !host.contains(event.target)) return
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      zoom = Math.min(4, Math.max(0.25, zoom * (event.deltaY < 0 ? 1.1 : 0.9)))
    },
    { passive: false }
  )

  function insertLights() {
    if (document.querySelector('.pip-lights')) return
    var toolbar = document.querySelector('.chrome-capture-editor-toolbar')
    if (!toolbar) return
    var lights = document.createElement('span')
    lights.className = 'pip-lights'
    lights.setAttribute('aria-hidden', 'true')
    function mk(cls) {
      var light = document.createElement('span')
      light.className = 'pip-light ' + cls
      return light
    }
    var close = mk('is-close')
    close.setAttribute('role', 'button')
    close.setAttribute('aria-label', '关闭编辑器')
    close.title = '关闭编辑器'
    close.addEventListener('click', function () {
      window.close()
    })
    lights.append(close, mk('is-min'), mk('is-zoom'))
    toolbar.insertBefore(lights, toolbar.firstChild)
  }

  insertLights()
  new MutationObserver(function () {
    insertLights()
    applyZoom()
  }).observe(document.body, { childList: true, subtree: true })
})()
