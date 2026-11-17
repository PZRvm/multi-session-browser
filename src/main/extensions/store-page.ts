import projectIcon from '../../../resources/icon.png?asset'
import {
  dialog,
  ipcMain,
  nativeImage,
  type BrowserWindow,
  type Session,
  type WebContents
} from 'electron'
import { join } from 'node:path'
import {
  STORE_PAGE_CHANNELS,
  storeDetailId,
  type StorePageTheme
} from '../../shared/extensions/storePage'
import { t } from '../i18n'
import { isUpdatePreparing } from '../updatePreparation'
import { assertExtensionSessionLive } from './runtime/lifecycle'
import { dialogIconForDarwin } from '../dialogs'

const targets = new WeakMap<
  WebContents,
  { parent: () => BrowserWindow | null; generation: number }
>()
const sessions = new WeakSet<Session>()

export function prepareStorePageSession(session: Session): void {
  if (sessions.has(session)) return
  session.registerPreloadScript({
    id: 'msb-store-page',
    type: 'frame',
    filePath: join(__dirname, '../preload/storePreload.js'),
    includeGlobs: ['https://chromewebstore.google.com/*']
  })
  sessions.add(session)
}

/** 仅manager创建的真实网页可成为目标；跨窗后parent由Tab归属现取。 */
export function attachStorePageTarget(wc: WebContents, parent: () => BrowserWindow | null): void {
  const target = { parent, generation: 0 }
  targets.set(wc, target)
  wc.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
    if (mainFrame) target.generation++
  })
  wc.once('destroyed', () => targets.delete(wc))
}

interface StorePageDeps {
  theme(): StorePageTheme
  installed(id: string): Promise<boolean>
  installing(id: string): boolean
  install(id: string, approve: () => Promise<boolean>): Promise<unknown>
}

export function registerStorePageIpc(deps: StorePageDeps): void {
  function authorize(event: Electron.IpcMainInvokeEvent, id: unknown): (() => boolean) | null {
    const wc = event.sender
    const target = targets.get(wc)
    if (!target || typeof id !== 'string') return null
    const generation = target.generation
    const frame = event.senderFrame
    const valid = (): boolean => {
      try {
        assertExtensionSessionLive(wc.session)
        return (
          !wc.isDestroyed() &&
          targets.get(wc) === target &&
          target.generation === generation &&
          frame === wc.mainFrame &&
          !frame.isDestroyed() &&
          storeDetailId(frame.url) === id &&
          storeDetailId(wc.getURL()) === id &&
          !isUpdatePreparing()
        )
      } catch {
        return false
      }
    }
    return valid() ? valid : null
  }
  ipcMain.handle(STORE_PAGE_CHANNELS.status, async (event, id: unknown) => {
    const valid = authorize(event, id)
    if (!valid || typeof id !== 'string') return null
    const installed = await deps.installed(id)
    if (!valid()) return null
    const { accent, accentStrong, accentPress, accentInk, raised, inkDim } = deps.theme()
    return {
      theme: { accent, accentStrong, accentPress, accentInk, raised, inkDim },
      installed,
      installing: deps.installing(id),
      installLabel: t('storePage.install'),
      installedLabel: t('storePage.installed'),
      installingLabel: t('storePage.installing')
    }
  })
  ipcMain.handle(STORE_PAGE_CHANNELS.install, async (event, id: unknown) => {
    const valid = authorize(event, id)
    if (!valid || typeof id !== 'string') return false
    const target = targets.get(event.sender)!
    const parent = (): BrowserWindow | null => {
      const win = target.parent()
      return win && !win.isDestroyed() ? win : null
    }
    const show = async (
      options: Electron.MessageBoxOptions
    ): Promise<Electron.MessageBoxReturnValue> => {
      const win = parent()
      return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
    }
    try {
      if (await deps.installed(id)) return true
      if (!valid()) return false
      await deps.install(id, async () => {
        if (!valid() || !parent()) return false
        const result = await show({
          type: 'question',
          icon: dialogIconForDarwin(),
          title: t('storePage.title'),
          message: t('storePage.confirm'),
          detail: t('storePage.detail', { id }),
          buttons: [t('storePage.cancel'), t('storePage.install')],
          defaultId: 0,
          cancelId: 0
        })
        return result.response === 1 && valid()
      })
      if (valid() && parent()) {
        await show({
          type: 'info',
          icon: nativeImage.createFromPath(projectIcon),
          message: t('storePage.success'),
          buttons: [t('storePage.ok')]
        })
      }
      return true
    } catch (error) {
      if (valid() && parent() && !String(error).includes('STORE_CONFIRM_DENIED')) {
        await show({ type: 'error', message: t('storePage.failed'), buttons: [t('storePage.ok')] })
      }
      return false
    }
  })
}
