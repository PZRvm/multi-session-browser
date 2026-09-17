// Native app menu namespace (en-US): also carries the settings window title (native
// window chrome managed by the main process, step 2 of stage 6)
import type { Dictionary } from '../../index'

export const menu: Dictionary['menu'] = {
  about: 'About {name}',
  settings: 'Settings…',
  settingsWindow: 'Settings',
  sessionWindow: 'Session Window',
  services: 'Services',
  hide: 'Hide {name}',
  hideOthers: 'Hide Others',
  unhide: 'Show All',
  quit: 'Quit {name}',
  quitSimple: 'Quit',
  edit: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select All',
  window: 'Window',
  minimize: 'Minimize',
  zoom: 'Zoom'
}
