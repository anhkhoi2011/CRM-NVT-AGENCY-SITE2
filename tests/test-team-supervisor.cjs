 'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../reference-crm.js'),'utf8');
function tree(role='ADMIN',id='admin'){
 const host={innerHTML:'',contains(){return true},querySelector(){return null}};
 const members=[{id:'m',name:'Manager A',role:'MANAGER'}, {id:'l',name:'Leader A',role:'LEADER',managerId:'m',teamId:'L'},
 {id:'direct-pointer',name:'Sale manager pointer',role:'SALE',leaderId:'m',teamId:'SELF'},
 {id:'direct-manager',name:'Sale manager only',role:'SALE',managerId:'m',teamId:'SELF2'},
 {id:'under-leader',name:'Sale leader',role:'SALE',leaderId:'l',teamId:'OLD'},
 {id:'independent',name:'Sale independent',role:'SALE',teamId:'OWN'},
 {id:'other-manager',name:'Manager Other',role:'MANAGER'},
 {id:'other-sale',name:'Sale Other',role:'SALE',managerId:'other-manager'}];
 const customers=[...Array.from({length:29},(_,i)=>({id:'direct-'+i,saleId:'direct-pointer'})),
 ...Array.from({length:3},(_,i)=>({id:'manager-'+i,saleId:'direct-manager'})),
 {id:'l-sale-1',saleId:'under-leader'},{id:'l-sale-2',saleId:'under-leader'},
 ...Array.from({length:5},(_,i)=>({id:'l-own-'+i,leaderId:'l',managerId:'m'})),
 {id:'m-own',leaderId:'m'}, {id:'independent',saleId:'independent'},{id:'other',saleId:'other-sale'}];
 const ctx=vm.createContext({data:{user:{role,id},members,customers},q:()=>host,qa:()=>[],document:{activeElement:null},esc:value=>String(value??''),primaryText(){},CSS:{escape:value=>value}});
 vm.runInContext(source.slice(source.indexOf('  function teamHierarchyRelations('),source.indexOf('  const hrmUi=')),ctx);
 vm.runInContext("teamTreeState.open.set('t:m',true);teamTreeState.open.set('g:l',true);teamTreeState.open.set('o:sales',true);renderTeamHierarchyV6();",ctx);
 return {ctx,host};
}
test('Manager is the direct supervisor for both manager-only and leaderId-to-Manager Sale records',()=>{
 const {ctx}=tree();const relations=ctx.teamHierarchyRelations(vm.runInContext('data.members',ctx));
 for(const id of ['direct-pointer','direct-manager']){
  const sale=vm.runInContext(`data.members.find(m=>m.id==='${id}')`,ctx);
  assert.equal(relations.leaderOf(sale),null);assert.equal(relations.managerOf(sale).id,'m');assert.equal(relations.supervisorOf(sale).id,'m');
 }
 const sale=vm.runInContext("data.members.find(m=>m.id==='under-leader')",ctx);
 assert.equal(relations.supervisorOf(sale).id,'l');assert.equal(relations.managerOf(sale).id,'m');
});
test('Team tree counts direct Manager sales and their customers once without orphan warnings',()=>{
 const {host}=tree();const manager=host.innerHTML.slice(host.innerHTML.indexOf('data-tt-toggle="t:m"'),host.innerHTML.indexOf('data-tt-toggle="t:other-manager"'));
 assert.match(manager,/1 Leader · 3 Sale/);assert.match(manager,/40 khách/);
 assert.match(manager,/Sale manager pointer/);assert.match(manager,/29 khách/);assert.match(manager,/Sale manager only/);
 assert.match(manager,/Sale leader/);assert.match(manager,/Trực thuộc Manager A/);
 const standalone=host.innerHTML.slice(host.innerHTML.indexOf('data-tt-toggle="o:sales"'));
 assert.match(standalone,/Sale độc lập/);assert.match(standalone,/Sale independent/);assert.doesNotMatch(standalone,/Sale manager pointer|Sale manager only/);
 assert.equal((host.innerHTML.match(/Sale manager pointer/g)||[]).length,1);
});
test('Manager tree excludes other teams and independent Sale while keeping direct reporting lines',()=>{
 const {host}=tree('MANAGER','m');assert.match(host.innerHTML,/Sale manager pointer/);assert.match(host.innerHTML,/Sale manager only/);
 assert.doesNotMatch(host.innerHTML,/Manager Other|Sale Other|Sale independent/);
 const mine=tree('SALE','direct-manager').host.innerHTML;assert.match(mine,/Trực thuộc Manager A/);assert.doesNotMatch(mine,/Sale độc lập/);
 const pointer=tree('SALE','direct-pointer').host.innerHTML;assert.match(pointer,/Trực thuộc Manager A/);assert.doesNotMatch(pointer,/Team Manager A|1 Leader/);
});
test('Missing or inactive Leader falls back to Manager; an independent Sale needs no supervisor',()=>{
 const {ctx}=tree();const members=[{id:'m',role:'MANAGER'},{id:'l',role:'LEADER',managerId:'m'}],relations=ctx.teamHierarchyRelations(members);
 assert.equal(relations.supervisorOf({role:'SALE',leaderId:'missing',managerId:'m'}).id,'m');
 assert.equal(relations.supervisorOf({role:'SALE'}),null);
 const numeric=ctx.teamHierarchyRelations([{id:123,role:'MANAGER'}]);assert.equal(numeric.supervisorOf({role:'SALE',leaderId:'123'}).id,123);
});
