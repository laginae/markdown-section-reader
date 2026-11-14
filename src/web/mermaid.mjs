import mermaid from 'mermaid';

// 每次绘图独立配置；不注册外部图形或加载网络资源。
let counter = 0;
export async function renderDiagram(source, target, dark) {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
    maxTextSize: 50000, maxEdges: 500, theme: dark ? 'dark' : 'default', fontFamily: 'sans-serif',
    htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: true },
    secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels', 'flowchart'] });
  const { svg } = await mermaid.render(`mdr-diagram-${++counter}`, source, target);
  return svg;
}
