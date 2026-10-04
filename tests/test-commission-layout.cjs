const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../commission_tree_demo.html'), 'utf8');
const layout = html.slice(html.indexOf('function computeMindmapLayout('), html.indexOf('function renderMindmapTree('));
const render = html.slice(html.indexOf('function renderMindmapTree('), html.indexOf('  // Vẽ đường cong kết nối')) + '}';
const fit = html.slice(html.indexOf('  function fitMindmapToViewport('), html.indexOf('  function getPointersDistance('));
for (const count of [0, 3, 30, 100]) {
  test('mindmap contains every card and fits viewport with ' + count + ' sales', () => {
    const members = [{id:'leader', name:'Leader', roleLevel:'LV2'}, ...Array.from({length:count}, (_,i)=>({id:'sale'+i, name:'Sale '+i, roleLevel:'LV3', leaderId:'leader'}))];
    for (const [width,height] of [[1200,700],[375,500]]) {
      const svg = {setAttribute(k,v){this[k]=Number(v);}};
      const nodes = {mindmapSvg:svg, svgBranchesGroup:{}, svgNodesGroup:{}, mindmapViewport:{clientWidth:width,clientHeight:height}};
      const ctx = {APEX_DATA:members, document:{getElementById:id=>nodes[id]}, applyMindmapTransform(){}};
      vm.createContext(ctx);
      vm.runInContext(layout + render + fit + ';renderMindmapTree(); fitMindmapToViewport();', ctx);
      const positions = ctx.computeMindmapLayout(members).nodePositions;
      assert.equal(Object.keys(positions).length, members.length + 1);
      for (const p of Object.values(positions)) {
        const right = p.x + (p.isRoot ? 250 : 245);
        const bottom = p.y + (p.isRoot ? 74 : 46);
        assert.ok(right < svg.width && bottom < svg.height, 'card must fit SVG');
        assert.ok(p.x*ctx.mindmapZoom+ctx.mindmapPanX >= 0);
        assert.ok(p.y*ctx.mindmapZoom+ctx.mindmapPanY >= 0);
        assert.ok(right*ctx.mindmapZoom+ctx.mindmapPanX <= width);
        assert.ok(bottom*ctx.mindmapZoom+ctx.mindmapPanY <= height);
      }
    }
  });
}
