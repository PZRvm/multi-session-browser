---
description: 根产品与设计文档仍引用迁移前的需求和调研路径
status: resolved
tier: S
---

# 根产品与设计文档的历史路径未同步

收尾检查根入口时发现：PRODUCT.md:25、50、51 仍称根 PRD.md 和 docs/PRD.md 并存、计划在 notes/steps；DESIGN.md:319 仍引用 notes/think-report 的 Windows 调研。它们是行内代码路径，索引的 Markdown 链接校验无法发现；impeccable 读取根 PRODUCT 时会得到与新 AGENTS 冲突的入口。

复现：在新克隆检索 PRODUCT.md、DESIGN.md 的 docs/、notes/，对照 book/docs/migration/source-map.json；旧目录已不存在，PRD 只在书内保留一份。

建议单独 S 轮同步这些入口路径，保留产品规则和设计数值。重新检查根入口旧路径、生成索引并核对没有应用源码变化。收尾记录时不修改两个根文件。

- [x] B2：同步 PRODUCT 与 DESIGN 的迁移路径

## B2 独立 S 轮验证

只替换 PRODUCT 的三个文档入口与 DESIGN 的一个调研路径，产品行为和设计参数不变。根两文档不再含旧 docs/、notes/ 或根 PRD 的行内路径；目标 PRD/阶段/计划/调研均存在。索引零警告，应用源码与依赖锁没有变化。
