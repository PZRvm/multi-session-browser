import type { WorkspacePickerResult } from '../shared/dialog'
import { normalizeUpdateNotes, normalizeUpdateDate } from './updateReleaseNotes'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { UPDATE_CHANNELS, type UpdateSnapshot } from '../shared/updates'
import { t } from './i18n'
import { dialogIconForDarwin } from './dialogs'
import { updatePolicy } from './updatePolicy'
import { createUpdateController } from './updateController'
import { createMacSparkle } from './updates/macSparkle'
import { beginUpdatePreparation, resumeAfterUpdate, setUpdateInstalling } from './updatePreparation'

export function registerUpdates(deps: {
  windows(): BrowserWindow[]
  busy(): boolean | Promise<boolean>
  save(): Promise<void>
  resume(): void
  prepareRelaunch?(version: string): void
  cancelRelaunch?(): void
  showDetails(owner: BrowserWindow, state: UpdateSnapshot): Promise<WorkspacePickerResult>
}): () => Promise<void> {
  let owner: BrowserWindow | null = null
  let checkingFromMenu = false
  let confirming = false
  let promptedDownloadRevision = -1
  let notifiedErrorRevision = -1
  let handoffTimer: ReturnType<typeof setTimeout> | undefined
  let mac: ReturnType<typeof createMacSparkle> | undefined
  let handoffWarned = false
  const clearHandoff = (): void => {
    clearTimeout(handoffTimer)
  }
  // 开发态不实例化更新器，也不读取 dev-app-update.yml 中的示例 URL。
  const enabled = app.isPackaged && process.platform !== 'linux'
  const policyEnabled = updatePolicy.showHeaderEntry || updatePolicy.showSettingsEntry
  // 此文件按 CJS 输出，延迟 require 避免禁用策略触发库实例化。
  const updater =
    enabled && policyEnabled && process.platform === 'win32'
      ? // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('electron-updater').autoUpdater as typeof import('electron-updater').autoUpdater)
      : null
  if (updater) {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.allowDowngrade = false
  }
  const controller = createUpdateController({
    version: app.getVersion(),
    policy: updatePolicy,
    enabled,
    engine: {
      async check() {
        if (mac) await mac.check()
        else await updater?.checkForUpdates()
      },
      async download() {
        if (mac) await mac.download()
        else await updater?.downloadUpdate()
      },
      install() {
        if (mac) mac.install()
        else updater?.quitAndInstall(false, true)
      }
    },
    publish(state) {
      for (const win of deps.windows()) {
        if (!win.isDestroyed()) win.webContents.send(UPDATE_CHANNELS.changed, state)
      }
    },
    async confirm() {
      const current = owner
      if (!current || current.isDestroyed()) return false
      const { response } = await dialog.showMessageBox(current, {
        type: 'question',
        icon: dialogIconForDarwin(),
        message: t('updates.confirm'),
        detail: t('updates.confirmDetail'),
        buttons: [t('updates.later'), t('updates.restart')],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      return response === 1 && !current.isDestroyed() && deps.windows().includes(current)
    },
    busy: deps.busy,
    async prepare() {
      await beginUpdatePreparation()
      await deps.save()
    },
    resume() {
      clearHandoff()
      deps.cancelRelaunch?.()
      deps.resume()
      resumeAfterUpdate()
    },
    beforeInstall() {
      const version = controller.getState().downloadedVersion
      if (version) deps.prepareRelaunch?.(version)
      setUpdateInstalling(true)
      handoffWarned = false
      // Mac 必须先撤销原生安装许可，收到取消完成后才恢复写入。
      handoffTimer = setTimeout(() => {
        if (mac) {
          void mac
            .cancel()
            .then(() => handoffFailure('installTimeout'))
            .catch(() => {})
        } else handoffFailure('installTimeout')
      }, 60000)
    }
  })
  if (enabled && policyEnabled && process.platform === 'darwin') {
    mac = createMacSparkle({
      available: controller.available,
      latest: controller.latest,
      downloaded: controller.downloaded,
      progress: controller.progress,
      installFailure: handoffFailure,
      cancelFailure() {
        if (controller.getState().status !== 'installing') return
        controller.handoffBlocked()
        notifyHandoffFailure()
      },
      lateCancellation() {
        if (controller.getState().status === 'installing') handoffFailure('installTimeout')
        else controller.cancelled()
      }
    })
    let quitAllowed = false
    let cancellingQuit = false
    app.prependListener('before-quit', (event) => {
      if (!mac || quitAllowed || mac.canQuitForInstall()) return
      if (controller.getState().status === 'preparing') {
        event.preventDefault()
        return
      }
      if (!mac.isActive() && !mac.isCancelling()) return
      event.preventDefault()
      if (cancellingQuit) return
      cancellingQuit = true
      void mac
        .cancel()
        .then(() => {
          if (controller.getState().status === 'installing') handoffFailure('installTimeout')
          controller.cancelled()
          quitAllowed = true
          app.quit()
        })
        .catch(() => {
          // 未确认取消前保持应用存活，避免普通退出触发原生待安装更新。
          if (controller.getState().status !== 'installing') {
            const win = deps.windows().find((candidate) => !candidate.isDestroyed())
            if (win)
              void dialog
                .showMessageBox(win, {
                  type: 'info',
                  icon: dialogIconForDarwin(),
                  message: t('updates.errors.installTimeout'),
                  buttons: [t('updates.ok')]
                })
                .catch((error: unknown) => console.warn('显示取消失败提示失败:', error))
          }
        })
        .finally(() => {
          cancellingQuit = false
        })
    })
  }
  updater?.on('update-available', (info) =>
    controller.available(
      info.version,
      normalizeUpdateNotes(info.releaseNotes, info.version),
      normalizeUpdateDate(info.releaseDate)
    )
  )
  updater?.on('update-not-available', () => controller.latest())
  updater?.on('update-downloaded', (info) => controller.downloaded(info.version))
  updater?.on('download-progress', (info) =>
    controller.progress(info.transferred, info.total, info.percent)
  )
  updater?.on('error', (error) => {
    const signature = /code signature|SQRLCodeSignatureErrorDomain|代码签名|代码要求/i.test(
      error.message
    )
    handoffFailure(signature ? 'signature' : 'install')
  })

  function handoffFailure(error: 'install' | 'signature' | 'installTimeout'): void {
    const installing = controller.getState().status === 'installing'
    controller.engineError(error)
    if (mac) controller.cancelled()
    if (installing) notifyHandoffFailure()
  }

  function notifyHandoffFailure(): void {
    if (handoffWarned) return
    handoffWarned = true
    const current =
      owner && !owner.isDestroyed() && deps.windows().includes(owner)
        ? owner
        : deps.windows().find((win) => !win.isDestroyed())
    if (current)
      void showFailure(current, controller.getState()).catch((error: unknown) =>
        console.warn('显示更新交接失败提示失败:', error)
      )
  }

  function trusted(event: IpcMainInvokeEvent, args: unknown[]): BrowserWindow {
    const win = deps.windows().find((win) => !win.isDestroyed() && win.webContents === event.sender)
    if (!win || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || args.length) {
      throw new Error(t('updates.sourceDenied'))
    }
    return win
  }

  async function downloadAndPrompt(win: BrowserWindow): Promise<UpdateSnapshot> {
    const before = controller.getState()
    // 等下载操作释放状态机锁后，再进入同一个原生安装确认流程。
    const downloaded = await controller.download()
    const current = controller.getState()
    if (
      before.downloadedVersion ||
      !before.candidateVersion ||
      downloaded.status !== 'ready' ||
      downloaded.error ||
      downloaded.downloadedVersion !== before.candidateVersion ||
      downloaded.revision !== current.revision ||
      downloaded.revision === promptedDownloadRevision ||
      confirming
    )
      return current
    promptedDownloadRevision = downloaded.revision
    const currentOwner =
      !win.isDestroyed() && deps.windows().includes(win)
        ? win
        : deps.windows().find((candidate) => !candidate.isDestroyed())
    if (!currentOwner) return current
    owner = currentOwner
    confirming = true
    try {
      const state = await controller.install()
      await showFailure(currentOwner, state)
      return state
    } finally {
      confirming = false
    }
  }

  ipcMain.handle(UPDATE_CHANNELS.state, (event, ...args) => {
    trusted(event, args)
    return controller.getState()
  })
  async function showDetails(win: BrowserWindow): Promise<UpdateSnapshot> {
    const state = controller.getState()
    const version = state.downloadedVersion ?? state.candidateVersion
    if (!version || state.status === 'disabled') return state
    const result = await deps.showDetails(win, state)
    if (result.status !== 'update-action' || win.isDestroyed() || !deps.windows().includes(win))
      return controller.getState()
    const current = controller.getState()
    if (
      result.version !== version ||
      (current.downloadedVersion ?? current.candidateVersion) !== version
    )
      return current
    if (
      current.status === 'disabled' ||
      ['checking', 'downloading', 'preparing', 'installing'].includes(current.status)
    )
      return current
    if (result.action === 'install' && !current.downloadedVersion) return current
    if (result.action === 'download' && current.downloadedVersion) return current
    if (result.action === 'install' && confirming) return current
    if (result.action === 'install') {
      owner = win
      confirming = true
    }
    let after: UpdateSnapshot
    try {
      after =
        result.action === 'download' ? await downloadAndPrompt(win) : await controller.install()
    } finally {
      if (result.action === 'install') confirming = false
    }
    await showFailure(win, after)
    return after
  }

  ipcMain.handle(UPDATE_CHANNELS.details, async (event, ...args) =>
    showDetails(trusted(event, args))
  )

  async function showFailure(win: BrowserWindow, state: UpdateSnapshot): Promise<void> {
    if (!state.error || win.isDestroyed() || notifiedErrorRevision === state.revision) return
    notifiedErrorRevision = state.revision
    await dialog.showMessageBox(win, {
      type: 'info',
      icon: dialogIconForDarwin(),
      message: t(`updates.errors.${state.error}`),
      buttons: [t('updates.ok')]
    })
  }

  for (const action of ['check', 'download', 'install'] as const) {
    ipcMain.handle(UPDATE_CHANNELS[action], async (event, ...args) => {
      const win = trusted(event, args)
      if (action === 'install' && confirming) return controller.getState()
      if (action === 'install') {
        owner = win
        confirming = true
      }
      let state: UpdateSnapshot
      try {
        state = action === 'download' ? await downloadAndPrompt(win) : await controller[action]()
      } finally {
        if (action === 'install') confirming = false
      }
      await showFailure(win, state)
      return state
    })
  }
  if (enabled && policyEnabled)
    setImmediate(() => {
      void controller.check()
    })

  return async () => {
    const current = controller.getState()
    if (
      checkingFromMenu ||
      confirming ||
      ['disabled', 'downloading', 'preparing', 'installing'].includes(current.status)
    )
      return

    const windows = deps.windows()
    const focused = BrowserWindow.getFocusedWindow()
    const win = focused && windows.includes(focused) ? focused : windows[0]
    if (!win) return

    checkingFromMenu = true
    try {
      const state = current.downloadedVersion ? current : await controller.check()
      if (win.isDestroyed()) return
      if (state.error && !state.downloadedVersion) await showFailure(win, state)
      else if (state.candidateVersion || state.downloadedVersion) await showDetails(win)
      else if (state.status === 'up-to-date') {
        await dialog.showMessageBox(win, {
          type: 'info',
          icon: dialogIconForDarwin(),
          message: t('updates.latest'),
          buttons: [t('updates.ok')]
        })
      }
    } finally {
      checkingFromMenu = false
    }
  }
}
