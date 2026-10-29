// Chrome 导入主进程内部引擎契约（2026-10-28 站点数据导入专项步骤 2 冻结，计划
// notes/plans/20261028112040 第 3 节第 9 条）：四类型引擎（history / localStorage /
// cookies / indexedDB）统一 prepare → apply → dispose 三段生命周期，供编排层
// （chromeImport/index.ts）与源快照层（sourceSnapshot.ts，步骤 6）组合。
// 本文件只在主进程使用——源数据结构（Cookie 原值、密钥、IndexedDB 文件清单）不进
// shared，renderer 只见 shared/chromeImport.ts 的计数与原因码。
//
// 生命周期责任划分：
// - prepare（源侧，只读）：消费 sourceSnapshot 固定的源副本，产出该类型的探测摘要
//   （ChromeImportScopePlan）与主进程持有的执行工件（如 Cookie 明文记录表、站点快照
//   清单）。不得向目标分区写入或建立句柄；允许只读查询目标现状（session.cookies
//   只读 get、目标目录 lstat）——shared 的 plan 语义要求 added/merged/conflicts 按
//   目标现状归并口径计算（波次 C 检查点裁决：原「不触碰」表述对齐为「不写入」）。
// - apply（目标侧，写入）：在 registry 静默窗口内执行——比较目标现状、按 policy 写入、
//   失败时类型内精确还原（还原结果必须如实回报，rollbackFailed 独立上浮）。
// - dispose（清理）：释放暂存资源（内存工件/临时目录）；取消、TTL 过期、失败与退出
//   清理统一走此口。
// 硬约束（步骤 1 技术验证定案，notes/accept/20261028112040-地址栏交互与Chrome站点数据导入开发计划/
// 20261028123936-步骤1技术验证记录.md）：
// - Cookie：源值一律 v10 等受支持格式解密后方可入库，密文不得当原值写入；明文结构 =
//   SHA-256(host_key) 32B + 值（域名哈希不符即拒，2026-10-28 定案）；钥匙串口令按原始
//   字节直传 KDF（不按文本解码）；Keychain helper 异步、参数固定、无 shell 拼接，密钥
//   与 Cookie 值只留主进程内存。
// - IndexedDB：快照单位 = <origin>.indexeddb.leveldb + .indexeddb.blob 成对目录；
//   apply 前必须手读 WAL 校验源 schema version ≤ 目标引擎支持版本（classic-level 因
//   idb_cmp1 比较器不可用于校验）；不兼容整站点拒绝（source-version-newer），绝不可
//   未校验直接拷入（Chromium 会静默重置目标库）。
import type { Session } from 'electron'
import type {
  ChromeImportPolicy,
  ChromeImportReason,
  ChromeImportScopePlan,
  ChromeImportScopeResult
} from '../../../shared/chromeImport'

/** 引擎执行上下文（编排层组装；目标分区路径与 Session 只经 registry 注入，引擎不旁路拼装） */
export interface ImportEngineContext {
  /** 目标会话 id（分区与历史等事实源的键） */
  sessionId: string
  /** 所选 Chrome profile 目录名（探测白名单成员） */
  profileDir: string
  /** 固定源副本根目录（sourceSnapshot 产物；引擎只读，不得回访用户 Chrome 原目录） */
  snapshotRoot: string
  /** 目标会话分区（cookies 引擎经 Session.cookies 写入） */
  session: Session
  /** 目标分区磁盘路径（registry 单源） */
  partitionDir: string
}

/** prepare 产物：摘要（renderer 可见部分 = ChromeImportScopePlan）+ 主进程执行工件 */
export interface ImportEnginePrepare<TArtifacts> {
  plan: ChromeImportScopePlan
  /** 类型内执行工件；apply/dispose 消费，不跨类型混用 */
  artifacts: TArtifacts
}

/**
 * 单类型引擎接口（history / localStorage / cookies / indexedDB 各一实现）。
 * TArtifacts 为该类型的执行工件形态，由各引擎自定义（不出本目录）。
 */
export interface ImportEngine<TArtifacts> {
  /** 源侧只读探测（固定副本上运行）：产出摘要与工件；源不可靠时抛带原因码的错误 */
  prepare(context: ImportEngineContext): Promise<ImportEnginePrepare<TArtifacts>>
  /** 目标侧写入（静默窗口内）：按 policy 处置冲突；结果如实（部分成功/还原状态/原因码） */
  apply(
    context: ImportEngineContext,
    artifacts: TArtifacts,
    policy: ChromeImportPolicy
  ): Promise<ChromeImportScopeResult>
  /** 释放工件与临时资源（幂等；取消/过期/失败/退出共用） */
  dispose(artifacts: TArtifacts): Promise<void>
}

/** 引擎层错误：原因码 + 是否可重试（编排层转结果行或整单拒绝文案） */
export class ImportEngineError extends Error {
  constructor(
    public readonly reason: ChromeImportReason,
    message: string,
    /** true = 用户可修正后重试（如 source-busy 关闭 Chrome 后）；false = 需重新探测 */
    public readonly retryable: boolean = false
  ) {
    super(message)
    this.name = 'ImportEngineError'
  }
}
