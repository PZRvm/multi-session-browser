// 设置窗版面共用原语（侧栏双栏契约的行/版面度量载体）：只导出组件。
// 版面壳：标题 15/600 + 版面说明 11px 次墨（标题下 8px）；行：min-height 44px、
// 发丝线分隔（末行无）、label 13/500 + 描述副行 11px 次墨、控件右对齐——结构与
// 度量契约见 DESIGN.md「设置窗口」条目，样式全部由 app.css 的 .settings-* 体系承担

export function SettingsPane({
  id,
  title,
  desc,
  children
}: {
  id: string
  title: string
  desc?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="settings-pane" aria-labelledby={`settings-pane-${id}-title`}>
      <h2 id={`settings-pane-${id}-title`} className="settings-pane-title">
        {title}
      </h2>
      {desc ? <p className="settings-pane-desc">{desc}</p> : null}
      {children}
    </section>
  )
}

export function SettingsRow({
  label,
  desc,
  descTone = 'default',
  control
}: {
  label: string
  desc?: string
  /** 描述副行语态：default 次墨；danger 用于行内错误如实呈现（数据目录打开失败、
   * 主页地址无效等，随下一次成功操作恢复） */
  descTone?: 'default' | 'danger'
  control?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-main">
        <span className="settings-row-label">{label}</span>
        {desc ? (
          <span
            className={`settings-row-desc${descTone === 'danger' ? ' settings-row-desc-danger' : ''}`}
          >
            {desc}
          </span>
        ) : null}
      </div>
      {control ? <div className="settings-row-control">{control}</div> : null}
    </div>
  )
}
