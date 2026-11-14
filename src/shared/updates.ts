export const UPDATE_NOTES_MAX = 12000
export interface UpdatePolicy {
  showHeaderEntry: boolean
  showSettingsEntry: boolean
}
export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'preparing'
  | 'installing'
  | 'error'
export type UpdateError =
  | 'check'
  | 'download'
  | 'save'
  | 'install'
  | 'signature'
  | 'installTimeout'
  | 'recording'
  | 'development'
export interface UpdateSnapshot {
  revision: number
  currentVersion: string
  policy: UpdatePolicy
  status: UpdateStatus
  releaseNotes: string
  releaseDate: string | null
  candidateVersion: string | null
  downloadedVersion: string | null
  progress: { transferred: number; total: number; percent: number | null } | null
  error: UpdateError | null
}
export const UPDATE_CHANNELS = {
  state: 'updates:get-state',
  details: 'updates:show-details',
  check: 'updates:check',
  download: 'updates:download',
  install: 'updates:install',
  changed: 'updates:changed'
} as const
export interface UpdatesApi {
  getState(): Promise<UpdateSnapshot>
  showDetails(): Promise<UpdateSnapshot>
  check(): Promise<UpdateSnapshot>
  download(): Promise<UpdateSnapshot>
  install(): Promise<UpdateSnapshot>
  onChanged(cb: (state: UpdateSnapshot) => void): () => void
}
