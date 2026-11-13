# 已采纳提案的历史参考

用户于2026-11-10授权两项处理。根Electron现锁定42.11.7，preload守卫已实现在electron-main.cjs；独立React修复版由react-fork.mjs从验签原包进行AST变换生成。

两份patch保留为当时的源码思路，不能直接当作可执行产物：electron42-devtools-preload.patch对应顶层/service-worker守卫；react-devtools-ButtonIcon.patch对应React元素直接渲染。实际构建带固定哈希/匹配数检查、独立名称/ID、8.0.0.1版本和MIT许可；不修改商店原样本。

两端真实组件属性/Profiler和零SVG目标错误已验证，原应用录屏UI已跑通，但39/42产物均有严格解码错误，另列既有问题；Windows等仍待回归。入口和复现命令见[工具README](../README.md)。
