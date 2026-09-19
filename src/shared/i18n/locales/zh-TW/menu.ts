// 原生应用菜单命名空间（zh-TW 字典）：逐键受 Dictionary['menu'] 类型约束（派生自
// zh-CN 源语言）——缺键/多键均编译失败。菜单动词按台湾惯例（結束/剪下/貼上/還原）
import type { Dictionary } from '../../index'

export const menu: Dictionary['menu'] = {
  about: '關於{name}',
  settings: '設定…',
  settingsWindow: '設定',
  sessionWindow: '會話視窗',
  services: '服務',
  hide: '隱藏{name}',
  hideOthers: '隱藏其他',
  unhide: '全部顯示',
  quit: '結束{name}',
  quitSimple: '結束',
  edit: '編輯',
  undo: '還原',
  redo: '重做',
  cut: '剪下',
  copy: '複製',
  paste: '貼上',
  selectAll: '全選',
  window: '視窗',
  minimize: '最小化',
  zoom: '縮放'
}
