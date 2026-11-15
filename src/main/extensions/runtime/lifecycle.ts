import type { Session } from 'electron'

// 永久删除的 Session 不可重用；普通关窗/克隆不进入此集合。
const retired = new WeakSet<Session>()
const suspended = new WeakSet<Session>()
export function retireExtensionSession(session: Session): void {
  retired.add(session)
}
export function isExtensionSessionRetired(session: Session): boolean {
  return retired.has(session)
}
export function assertExtensionSessionLive(session: Session): void {
  if (retired.has(session)) throw new Error('EXTENSION_SESSION_RETIRED')
  if (suspended.has(session)) throw new Error('EXTENSION_SESSION_SUSPENDED')
}

export function suspendExtensionSession(session: Session): void {
  suspended.add(session)
}
export function resumeExtensionSession(session: Session): void {
  if (retired.has(session)) throw new Error('EXTENSION_SESSION_RETIRED')
  suspended.delete(session)
}
export function isExtensionSessionUnavailable(session: Session): boolean {
  return retired.has(session) || suspended.has(session)
}
