/* BEGIN BUNDLED DISTRIBUTION ROUNDS - source: distribution-rounds.js */
'use strict';
// One source of truth for global round previews, skipped slots and allocation.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CrmDistributionRounds=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const weight=value=>Number.isFinite(Number(value))?Math.max(0,Math.min(100,Math.round(Number(value)))):1;
  function slots(round,people,mode){
    const enabled=new Set(Array.isArray(round?.enabledSaleIds)?round.enabledSaleIds:people.map(p=>p.id));
    const ids=people.filter(p=>enabled.has(p.id)&&weight(round?.weights?.[p.id])>0).sort((a,b)=>a.id.localeCompare(b.id)).flatMap(p=>Array(mode==='EQUAL'?1:weight(round?.weights?.[p.id])).fill(p.id));
    const omitted=new Set(round?.omittedSlots||[]);
    return ids.filter((id,i)=>!omitted.has(i));
  }
  const slotSignature=(round,people,mode)=>JSON.stringify(slots(round,people,mode));
  function reconcileActiveIds(round,raw,people,mode){
    const configured=slots(round,people,mode);
    if(!raw||typeof raw!=='object'||!Array.isArray(raw.ids))return configured;
    if(!Array.isArray(people)||!people.length)return raw.ids.slice();
    const allowed=new Set(configured);
    const index=Math.max(0,Math.min(raw.ids.length,Number(raw.index)||0));
    // Keep consumed positions and extra turns, remove inactive people, then
    // append missing configured positions so a changed roster cannot skip a member.
    const prefix=raw.ids.slice(0,index).filter(id=>allowed.has(id));
    const future=raw.ids.slice(index).filter(id=>allowed.has(id));
    const ids=[...prefix,...future];
    const counts=new Map();
    for(const id of ids)counts.set(id,(counts.get(id)||0)+1);
    const required=new Map();
    for(const id of configured)required.set(id,(required.get(id)||0)+1);
    for(const [id,total] of required){
      for(let count=counts.get(id)||0;count<total;count++){ids.push(id);counts.set(id,count+1);}
    }
    return ids;
  }
  function preview(config,raw,people,mode){
    const rounds=Array.isArray(config?.rounds)&&config.rounds.length?config.rounds:[config||{}];
    return rounds.map((round,i)=>{
      const initialized=i===0&&raw&&typeof raw==='object'&&Array.isArray(raw.ids)&&(raw.ids.length>0||raw.cycleId);
      const sameRound=!initialized||!raw.roundId||String(raw.roundId)===String(round.id||'ROUND-1');
      const changedSlots=initialized&&sameRound&&(!raw.slotSignature||raw.slotSignature!==slotSignature(round,people,mode));
      const ids=changedSlots?reconcileActiveIds(round,raw,people,mode):initialized&&sameRound?raw.ids.slice():slots(round,people,mode);
      const index=i===0?Math.min(ids.length,Math.max(0,Number(initialized&&sameRound?raw.index:typeof raw==='number'?raw:0)||0)):0;
      const roundId=round.id||'ROUND-1';
      const cycleId=initialized&&sameRound?raw.cycleId||'legacy':'';
      return {roundId,index,ids,cycleId,token:JSON.stringify([roundId,index,ids,cycleId,mode,round.omittedSlots||[]])};
    });
  }
  function skip(config,raw,people,mode,input){
    const views=preview(config,raw,people,mode);
    const i=views.findIndex(v=>v.roundId===input.roundId),view=views[i];
    if(!view||view.token!==input.token)throw Error('Thứ tự vòng đã thay đổi. Đóng chi tiết và mở lại để cập nhật.');
    const position=input.position;
    if(!Number.isInteger(position)||position<view.index||position>=view.ids.length||view.ids[position]!==input.memberId)throw Error('Lượt này đã được phân hoặc không còn trong hàng chờ.');
    const next=JSON.parse(JSON.stringify(config));
    if(i===0){const ids=view.ids.slice();ids.splice(position,1);return {config:next,cursor:{index:view.index,ids,cycleId:String((Number(view.cycleId)||0)+1),roundId:view.roundId,slotSignature:slotSignature(config.rounds?.[0]||config,people,mode)}};}
    let original=-1,visible=-1;while(visible<position){original++;if(!(next.rounds[i].omittedSlots||[]).includes(original))visible++;}next.rounds[i].omittedSlots=[...new Set([...(next.rounds[i].omittedSlots||[]),original])].sort((a,b)=>a-b);
    return {config:next,cursor:raw};
  }
  function take(config,raw,people,mode){
    const next=JSON.parse(JSON.stringify(config));
    let cursor=raw;let changed=false;
    // Migrate cursors created before round metadata existed. This is done only
    // once at allocation time, so new skip/extra-turn cursors remain exact.
    if(cursor&&typeof cursor==='object'&&Array.isArray(cursor.ids)&&!cursor.roundId){
      const active=next.rounds?.[0]||next;
      cursor={...cursor,ids:reconcileActiveIds(active,cursor,people,mode),roundId:active.id||'ROUND-1',slotSignature:slotSignature(active,people,mode)};
    }
    for(let attempt=0;attempt<(config?.rounds?.length||1)+2;attempt++){
      const view=preview(next,cursor,people,mode)[0];
      const eligible=new Set(people.map(p=>p.id));
      let index=view.index;
      while(index<view.ids.length&&!eligible.has(view.ids[index]))index++;
      if(index<view.ids.length)return {id:view.ids[index],config:next,changed,cursor:{index:index+1,ids:view.ids,cycleId:view.cycleId||'cycle',roundId:view.roundId,slotSignature:slotSignature(next.rounds?.[0]||next,people,mode)}};
      if(next.rounds?.length>1){next.rounds.shift();next.weights=next.rounds[0].weights;next.enabledSaleIds=next.rounds[0].enabledSaleIds;changed=true;}
      else {
        const round=next.rounds?.[0]||next;
        if(round.omittedSlots?.length){delete round.omittedSlots;changed=true;}
        if(!slots(round,people,mode).length)return {id:null,config:next,changed,cursor:{index:view.ids.length,ids:view.ids,cycleId:view.cycleId||'empty',roundId:round.id||'ROUND-1',slotSignature:slotSignature(round,people,mode)}};
      }
      const round=next.rounds?.[0]||next;
      cursor={index:0,ids:slots(round,people,mode),cycleId:String((Number(view.cycleId)||0)+1),roundId:round.id||'ROUND-1',slotSignature:slotSignature(round,people,mode)};
    }
    return {id:null,config:next,changed,cursor};
  }
  function recipients(members,leaderConfig={},saleConfigs={}){
    members=members.filter(p=>p.active!==false);
    const leaders=members.filter(p=>p.role==='LEADER'&&p.teamId&&(leaderConfig.enabledLeaderIds||[]).includes(p.id));
    const directSales=managerId=>members.filter(p=>p.role==='SALE'&&(p.leaderId===managerId||p.managerId===managerId&&!members.some(l=>l.role==='LEADER'&&l.id===p.leaderId)));
    for(const manager of members.filter(p=>p.role==='MANAGER')){
      const own=saleConfigs['manager:'+manager.id]||{};
      const configured=Array.isArray(own.enabledSaleIds)&&own.enabledSaleIds.length>0;
      if(directSales(manager.id).some(p=>!configured||own.enabledSaleIds.includes(p.id)))leaders.push({...manager,directManagerBranch:true});
    }
    leaders.sort((a,b)=>a.id.localeCompare(b.id));
 const globalRecipients=[];
 const globalWeights={};
 const globalSeen=new Set();
 const globalLeaderWeights=leaderConfig.weights||{};
 const globalWeight=raw=>{const n=Number(raw);return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):1;};
 const addGlobal=(person,raw)=>{const value=globalWeight(raw);if(!person||globalSeen.has(person.id)||(!saleConfigs.$&&value<=0))return;globalSeen.add(person.id);globalRecipients.push(person);globalWeights[person.id]=value;};
 for(const leader of leaders){
  const saleKey=leader.directManagerBranch?'manager:'+leader.id:leader.id;
  const config=saleConfigs[saleKey]||{};
  if(leader.directManagerBranch){
   const managerRecipient={...leader,role:'SALE',actualRole:'MANAGER',managerRecipient:true,leaderId:null,teamId:leader.teamId};
   if(config.leaderEnabled!==false)addGlobal(managerRecipient,config.weights?.[leader.id]);
   const configured=Array.isArray(config.enabledSaleIds)&&config.enabledSaleIds.length>0;
   directSales(leader.id).filter(p=>!configured||config.enabledSaleIds.includes(p.id)).forEach(p=>addGlobal({...p,directManagerBranch:true,managerId:leader.id,leaderId:null},config.weights?.[p.id]));
   continue;
  }
  if(config.leaderEnabled!==false)addGlobal({...leader,role:'SALE',actualRole:'LEADER',leaderId:leader.id,teamLeaderRecipient:true},config.weights?.[leader.id]??globalLeaderWeights[leader.id]);
  const configured=Array.isArray(config.enabledSaleIds)&&config.enabledSaleIds.length>0;
  members.filter(p=>p.role==='SALE'&&p.leaderId===leader.id&&(!configured||config.enabledSaleIds.includes(p.id))).forEach(p=>addGlobal(p,config.weights?.[p.id]));
  const manager=leader.managerId&&members.find(p=>p.role==='MANAGER'&&p.id===leader.managerId);
  if(manager&&(!configured||config.enabledSaleIds.includes(manager.id)))addGlobal({...manager,role:'SALE',actualRole:'MANAGER',managerRecipient:true,leaderId:leader.id,teamId:leader.teamId},config.weights?.[manager.id]);
 }

    return {people:globalRecipients.sort((a,b)=>a.id.localeCompare(b.id)),weights:globalWeights};
  }
  function cursorFrom(store={}){return store.global&&typeof store.global==='object'?store.global:store.salesByTeam?.global??store.global;}
  function removeMember(config,raw,people,mode,input){
    const views=preview(config,raw,people,mode);
    const i=views.findIndex(v=>v.roundId===input.roundId),view=views[i];
    if(!view||view.token!==input.token)throw Error('Round order changed. Reopen the detail view.');
    if(!view.ids.includes(input.memberId))throw Error('Member is no longer in this round.');
    const next=JSON.parse(JSON.stringify(config));
    const round=next.rounds?.[i]||next;
    round.enabledSaleIds=(Array.isArray(round.enabledSaleIds)?round.enabledSaleIds:people.map(p=>p.id)).filter(id=>id!==input.memberId);
    round.weights={...(round.weights||{}),[input.memberId]:0};
    if(!round.enabledSaleIds.some(id=>weight(round.weights[id])>0))throw Error('Mỗi vòng cần giữ ít nhất một thành viên có tỷ trọng lớn hơn 0.');
    if(i===0){
      next.enabledSaleIds=round.enabledSaleIds;
      next.weights=round.weights;
      const cursor=raw&&typeof raw==='object'?raw:{index:0,ids:view.ids,cycleId:'legacy'};
      const index=Math.max(0,Math.min(view.ids.length,Number(cursor.index)||0));
      const ids=[...view.ids.slice(0,index),...view.ids.slice(index).filter(id=>id!==input.memberId)];
      return {config:next,cursor:{...cursor,index,ids,roundId:view.roundId,slotSignature:slotSignature(round,people,mode)}};
    }
    return {config:next,cursor:raw};
  }
  function addExtraTurn(config,raw,people,mode,input){
    const views=preview(config,raw,people,mode);
    const i=views.findIndex(view=>view.roundId===input.roundId),view=views[i];
    if(i!==0||!view)throw Error('Chỉ có thể thêm lượt vào vòng đang chạy.');
    if(view.token!==input.token)throw Error('Thứ tự vòng đã thay đổi. Mở lại chi tiết vòng rồi thử lại.');
    const memberId=String(input.memberId||'');
    if(!memberId||!people.some(person=>person.id===memberId))throw Error('Nhân sự không còn đủ điều kiện nhận data.');
    if(view.ids.length>=1000)throw Error('Vòng đã đạt giới hạn 1.000 lượt.');
    const next=JSON.parse(JSON.stringify(config));
    const cursor=raw&&typeof raw==='object'?raw:{};
    return {config:next,cursor:{...cursor,index:view.index,ids:[...view.ids,memberId],cycleId:view.cycleId||String(Date.now()),roundId:view.roundId,slotSignature:slotSignature(config.rounds?.[0]||config,people,mode)}};
  }
  return {slots,preview,skip,removeMember,addExtraTurn,take,recipients,cursorFrom};
});
/* END BUNDLED DISTRIBUTION ROUNDS */
let orderTypeFilter = 'ALL';
'use strict';

const STORAGE_KEY = 'nvt-crm-production-v1';
const SESSION_KEY = 'nvt-crm-session-v1';
const THEME_KEY = 'nvt-crm-theme-v1';
const CACHED_SNAPSHOT_KEY = 'nvt_crm_cached_snapshot_v1';

function writeRuntimeSession(payload) {
  const serialized = JSON.stringify(payload);
  try { sessionStorage.setItem(SESSION_KEY, serialized); } catch (error) {}
  try { localStorage.setItem(SESSION_KEY, serialized); } catch (error) {}
  try {
    if (window.parent && window.parent !== window) {
      window.parent.sessionStorage.setItem(SESSION_KEY, serialized);
      window.parent.localStorage.setItem(SESSION_KEY, serialized);
    }
  } catch (error) {}
}

function removeRuntimeSession() {
  for (const storage of [sessionStorage, localStorage]) {
    try { storage.removeItem(SESSION_KEY); } catch (error) {}
    try { storage.removeItem(CACHED_SNAPSHOT_KEY); } catch (error) {}
  }
  try {
    if (window.parent && window.parent !== window) {
      window.parent.sessionStorage.removeItem(SESSION_KEY);
      window.parent.localStorage.removeItem(SESSION_KEY);
      window.parent.localStorage.removeItem(CACHED_SNAPSHOT_KEY);
    }
  } catch (error) {}
}

const ACCOUNTS = [];
const STAFF_SEED = [];
let STAFF = [];

let PRODUCTS = [];

const TRAFFIC_META = [
  { source: 'TikTok Ads', medium: 'paid_social', campaign: 'TT-TRADING-09', color: '#111827', spend: 920000 },
  { source: 'Facebook Ads', medium: 'paid_social', campaign: 'FB-DATA-09', color: '#246b9b', spend: 760000 },
  { source: 'Google Ads', medium: 'cpc', campaign: 'GG-SEARCH-09', color: '#e8572a', spend: 680000 },
  { source: 'Google Organic', medium: 'organic', campaign: 'SEO-COURSE', color: '#157a4b', spend: 0 },
  { source: 'Zalo OA', medium: 'social', campaign: 'ZALO-SEP', color: '#19a4df', spend: 120000 },
  { source: 'Direct / Referral', medium: 'referral', campaign: 'DIRECT', color: '#a3650b', spend: 0 },
  { source: 'Khách hàng cũ', medium: 'crm', campaign: 'OLD_CUSTOMER', color: '#64748b', spend: 0 },
  { source: 'Khách hàng ngoài data', medium: 'crm', campaign: 'OUTSIDE_DATA', color: '#475569', spend: 0 }
];

const STATUS_META = {
  NEW: { label: 'Data mới', color: '#246b9b' }, CONTACTED: { label: 'Đã liên hệ', color: '#7a62d3' },
  CONSULTING: { label: 'Đang tư vấn', color: '#e8572a' }, PROPOSAL: { label: 'Đã gửi báo giá', color: '#a3650b' },
  PAID: { label: 'Đã thanh toán', color: '#157a4b' }, WON: { label: 'Thành công', color: '#0c8b72' },
  NURTURING: { label: 'Đang chăm sóc', color: '#19a4df' }, LOST: { label: 'Không phản hồi', color: '#c33d42' }
};

const ORDER_STATUS = {
  PAID: ['Thanh toán đủ', 'paid'], PENDING: ['Chờ thanh toán', 'pending'],
  DEPOSIT: ['Đã đặt cọc', 'deposit'],
  COURSE_GRANTED: ['Thanh toán đủ', 'done'],
  CANCELLED: ['Đã huỷ', 'cancelled'], REFUNDED: ['Đã hoàn tiền', 'refunded']
};

const FIELD_COLORS = ['#246b9b', '#a3650b', '#157a4b', '#e8572a', '#6b46c1', '#0c8b72', '#c33d42', '#687771', '#8b5a2b', '#9b2c68'];
const CUSTOM_FIELD_SEED = [
  { id: 'customerLevel', label: 'Level khách hàng', type: 'SELECT', showInTable: true, required: false, active: true, options: [
    ['L0', 'L0: Chưa liên hệ được'], ['L1', 'L1: Đã kết nối được Zalo/Tele'], ['L1.1', 'L1.1: Đã kết bạn Zalo chờ accept'], ['L2', 'L2: Đã vào nhóm xem tín hiệu'], ['L3', 'L3: Quan tâm đến tín hiệu'], ['L4.1', 'L4.1: Hẹn nạp vốn'], ['L5', 'L5: Đã tạo tài khoản'], ['L6', 'L6: Nạp tiền'], ['L7', 'L7: Trading'], ['L8', 'L8: Rút vốn'], ['L9', 'L9: Nghỉ giao dịch'], ['L10', 'L10: Quay lại giao dịch'], ['L4.2', 'L4.2: Khách rời nhóm'], ['L4.3', 'L4.3: Khách không tương tác'], ['L12.1', 'L12.1: Khách từ chối hỗ trợ'], ['L12.2', 'L12.2: Trùng'], ['L11', 'L11: Khách muốn Coaching']
  ].map(([value, label], index) => ({ value, label, color: FIELD_COLORS[index % FIELD_COLORS.length] })) },
  { id: 'customerClass', label: 'Phân loại khách hàng', type: 'SELECT', showInTable: true, required: false, active: true, options: ['Lạnh', 'Ấm', 'Nóng', 'Premium', 'Whale', 'Resale', 'Cancel', 'Pending'].map((label, index) => ({ value: label, label, color: FIELD_COLORS[index] })) },
  { id: 'callStatus', label: 'Gọi kết nối', type: 'SELECT', showInTable: true, required: false, active: true, options: ['Chưa gọi được', 'Đã gọi được', 'Hẹn gọi lại'].map((label, index) => ({ value: label, label, color: FIELD_COLORS[index] })) },
  { id: 'documentStatus', label: 'Tình trạng nhận tài liệu', type: 'SELECT', showInTable: false, required: false, active: true, options: ['Chưa gửi', 'Đã gửi', 'Đã nhận', 'Cần gửi lại'].map((label, index) => ({ value: label, label, color: FIELD_COLORS[index] })) },
  { id: 'needs', label: 'Nhu cầu / Mong muốn', type: 'MULTI_SELECT', showInTable: false, required: false, active: true, options: ['Tín hiệu Vàng', 'Tín hiệu FX', 'Tín hiệu Crypto Future', 'Học cơ bản > Nâng cao', 'Học phương pháp Nến', 'Tham gia live tin tức', 'Vốn lớn Coaching 1:1', 'Chứng khoán Cơ sở', 'Chứng khoán phái sinh'].map((label, index) => ({ value: label, label, color: FIELD_COLORS[index % FIELD_COLORS.length] })) },
  { id: 'course', label: 'Khoá học', type: 'MULTI_SELECT', showInTable: false, required: false, active: true, options: ['BMĐTHH', 'Coaching VIP', 'Chuyên sâu', 'Cộng đồng giao dịch'].map((label, index) => ({ value: label, label, color: FIELD_COLORS[index] })) },
  { id: 'result', label: 'Kết quả chăm sóc', type: 'SELECT', showInTable: true, required: false, active: true, options: ['Nhận contact', 'Đã học BMĐTHH', 'Hẹn gọi lại', 'Xác nhận học', 'Không quan tâm', 'Không tín hiệu/thuê bao', 'Sai số/nhầm số', 'Không nghe máy', 'Chờ học khoá tiếp', 'Đã giới thiệu Chuyên gia', 'Đang chăm sóc', 'Thành thạo CQG', 'Đăng ký COACH VIP-HH', 'Đã được COACH với chuyên gia', 'HV mua chỉ báo', 'HV chuyên sâu', 'Đang giao dịch', 'Đã mở tài khoản', 'Tạm ngừng giao dịch', 'Khai thác kho số', 'Trùng sale và bàn giao', 'Bàn giao'].map((label, index) => ({ value: label, label, color: FIELD_COLORS[index % FIELD_COLORS.length] })) },
];

const SEMANTIC_OPTION_COLORS = {
  customerLevel: {
    L0: '#64748b', L1: '#3b82f6', 'L1.1': '#60a5fa', L2: '#06b6d4', L3: '#14b8a6', 'L4.1': '#f59e0b', L5: '#10b981', L6: '#059669', L7: '#0f766e', L8: '#8b5cf6', L9: '#78716c', L10: '#2563eb', 'L4.2': '#f97316', 'L4.3': '#d97706', 'L12.1': '#dc2626', 'L12.2': '#be123c', L11: '#7c3aed'
  },
  customerClass: { 'Lạnh': '#3b82f6', 'Ấm': '#f59e0b', 'Nóng': '#ef4444', Premium: '#ca8a04', Whale: '#0f766e', Resale: '#7c3aed', Cancel: '#64748b', Pending: '#d97706' },
  callStatus: { 'Chưa gọi được': '#64748b', 'Đã gọi được': '#10b981', 'Hẹn gọi lại': '#f59e0b' },
  documentStatus: { 'Chưa gửi': '#64748b', 'Đã gửi': '#3b82f6', 'Đã nhận': '#10b981', 'Cần gửi lại': '#f97316' },
  result: { 'Đã mở tài khoản': '#10b981', 'Đang giao dịch': '#0f766e', 'Đang chăm sóc': '#3b82f6', 'Hẹn gọi lại': '#f59e0b', 'Không quan tâm': '#ef4444', 'Sai số/nhầm số': '#be123c', 'Không nghe máy': '#64748b', 'Trùng sale và bàn giao': '#7c3aed', 'Bàn giao': '#8b5cf6' }
};

CUSTOM_FIELD_SEED.forEach(field => field.options.forEach(option => {
  option.color = SEMANTIC_OPTION_COLORS[field.id]?.[option.value] || option.color;
}));

const NAVIGATION = {
  HRM: [['Nhân sự', [['hrProfiles','Quản trị nhân sự','♧'],['team','Đội ngũ','♧'],['attendance','Điểm danh','✓'],['orders','Đơn hàng','▤'],['businessReport','Nhập lot','▦']]]],
  ADMIN: [
    ['Vận hành', [['dashboard', 'Tổng quan', '◫'], ['customers', 'Khách hàng tổng', '♙'], ['distribution', 'Data', '⇄'], ['websites', 'Websites', '◇']]],
    ['Kinh doanh', [['orders', 'Đơn hàng', '▤'], ['products', 'Sản phẩm', '□'], ['revenue', 'Doanh thu', '₫'], ['marketing', 'Dữ liệu', '⌁']]],
    ['T\u1ed5 ch\u1ee9c', [['hrProfiles','Quản trị nhân sự','♧'],['team', '\u0110\u1ed9i ng\u0169', '\u2667'], ['feedback', 'Kho Feedback', '\u25c9'], ['processes', 'Quy Tr\u00ecnh', '\u2637'], ['businessReport', 'B\u00e1o c\u00e1o kinh doanh', '\u25eb']]],
    ['K\u1ebf to\u00e1n', [['accounting', 'K\u1ebf to\u00e1n', '\u20ab']]],
    ['Hệ thống', [['attendance', 'Điểm danh', '✓'], ['notifications', 'Thông báo', '●'], ['audit', 'User log', '◉'], ['settings', 'Cài đặt', '⚙']]]
  ],
  MARKETING: [
    ['Phân tích', [['dashboard', 'Tổng quan', '◫'], ['marketing', 'Dữ liệu marketing', '⌁'], ['websites', 'Websites', '◇']]],
    ['Tra cứu', [['customers', 'Khách hàng', '♙'], ['orders', 'Đơn hàng', '▤'], ['products', 'Sản phẩm', '□']]],
    ['Ch\u0103m s\u00f3c', [['care', 'Ch\u0103m s\u00f3c kh\u00e1ch', 'care'], ['feedback', 'Kho Feedback', '\u25c9'], ['processes', 'Quy Tr\u00ecnh', '\u2637']]],
    ['Cá nhân', [['attendance', 'Điểm danh', '✓'], ['notifications', 'Thông báo', '●']]]
  ],
  ACCOUNTING: [
    ['Kế toán & Hoa hồng', [['accounting', 'Kế toán & Hoa hồng', '₫'], ['notifications', 'Thông báo', '●']]]
  ],
  LEADER: [
    ['Vận hành', [['dashboard', 'Tổng quan đội', '◫'], ['customers', 'Khách hàng Team', '♙'], ['pool', 'Chia data cho Sale', '↔']] ],
    ['Kinh doanh', [['orders', 'Đơn hàng', '▤'], ['revenue', 'Doanh thu', '₫']]],
    ['Đội nhóm', [['team', 'Hiệu suất Sale', '♧'], ['businessReport', 'Báo cáo kinh doanh', '◫'], ['care', 'Chăm sóc khách', '❦'], ['notifications', 'Thông báo', '●']]],
    ['Cá nhân', [['attendance', 'Điểm danh', '✓'], ['profile', 'Hồ sơ của tôi', '●']]]
  ],
  UNASSIGNED: [['Cá nhân', [['dashboard', 'Tổng quan', '◫'], ['attendance', 'Điểm danh', '✓'], ['profile', 'Hồ sơ của tôi', '●'], ['notifications', 'Thông báo', '●']]]],
  SALE: [
    ['Kh\u00e1ch h\u00e0ng c\u1ee7a t\u00f4i', [['dashboard', 'T\u1ed5ng quan', '◫'], ['customers', 'Kh\u00e1ch c\u1ee7a t\u00f4i', '♙'], ['accept', 'Data ch\u1edd nh\u1eadn', '⤓'], ['care', 'Ch\u0103m s\u00f3c kh\u00e1ch', '♡']]],
    ['Kinh doanh', [['orders', 'T\u1ea1o \u0111\u01a1n cho kh\u00e1ch', '▤'], ['revenue', 'Doanh thu c\u1ee7a t\u00f4i', '₫']]],
    ['\u0110\u1ed9i nh\u00f3m', [['team', '\u0110\u1ed9i ng\u0169', '\u2667'], ['businessReport', 'B\u00e1o c\u00e1o kinh doanh', '\u25eb']]],
    ['C\u00e1 nh\u00e2n', [['attendance', '\u0110i\u1ec3m danh', '✓'], ['notifications', 'Th\u00f4ng b\u00e1o', '●'], ['profile', 'H\u1ed3 s\u01a1 c\u1ee7a t\u00f4i', '●']]]
  ]
};

// Đồng bộ menu kế toán và loại bỏ báo cáo kinh doanh độc lập khỏi mọi vai trò.
(() => {
  Object.entries(NAVIGATION).forEach(([role,groups]) => groups.forEach(group => {
    if(role!=='HRM')group[1] = group[1].filter(item => item[0] !== 'businessReport');
  }));
  const accounting = NAVIGATION.ADMIN?.find(group => group[1]?.some(item => item[0] === 'accounting'));
  if (accounting) accounting[1] = accounting[1].map(item => item[0] === 'accounting' ? [item[0], 'Hoa Hồng nhân viên', item[2]] : item);
})();

 function dayIso(daysAgo) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type)?.value || '01';
  const today = `${value('year')}-${value('month')}-${value('day')}`;
  return shiftDate(today, -daysAgo);
}

function shiftStamp(value, minutes) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return String(value || '');
  const [, year, month, day, hour, minute] = match.map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day, hour, minute) + Number(minutes || 0) * 60 * 1000);
  return shifted.toISOString().slice(0, 16).replace('T', ' ');
}

function initialState() {
  // Production starts empty; records arrive through the Sale/LadiPage import flow.
  const customers = [];
  return {
    version: 3,
    optionPaletteVersion: 2,
    members: [],
    registrations: [],
    registeredAccounts: [],
    disabledAccountIds: [],
    customFieldDefinitions: structuredClone(CUSTOM_FIELD_SEED),
    customers,
    customerFieldHistory: [],
    assignmentHistory: [],
    resubmissions: [],
    notes: [],
    imports: [],
    products: [],
    productCategories: ['Chỉ báo', 'Khóa học', 'Quảng cáo', 'Website', 'CRM', 'Automation', 'Nội dung', 'Dịch vụ khác'],
    careGroups: [],
    attendance: [],
    brokerageMetrics: [],
    hrProfiles: [],
    dataOffers: [],
    orders: [],
    traffic: [],
    tasks: [],
    notifications: [],
    feedbacks: [],
    processes: [],
    expenses: [],
    courseConfigs: [],
    audit: [],
    websites: [
      { id: 'WEB-NVT', name: 'NVT Agency', domain: 'hoangphucacademy.vn', sourceUrl: 'https://www.hoangphucacademy.vn/', status: 'ACTIVE', provider: 'LANDING_API', endpoint: '', externalAccountId: '', campaignId: '', formId: '', webhookSlug: 'ds-1789180581447-IIM6U3AAD1R', webhookUrlOverride: '', connectionStatus: 'PENDING_BACKEND', domainVerificationStatus: 'UNVERIFIED', credentialConfigured: false, credentialLast4: '', lastVerifiedAt: '', lastError: '', lastSync: 'Chưa đồng bộ' },
      { id: 'WEB-NVT-2', name: 'web 2 - 3 buổi Vùng Phản Ứng', domain: 'dautuhanghoa.tech', sourceUrl: 'https://dautuhanghoa.tech/', status: 'ACTIVE', provider: 'LANDING_API', endpoint: '', externalAccountId: '', campaignId: '', formId: '', webhookSlug: 'ds-1789611803019-I7Q0GRUTNAS', webhookUrlOverride: '', connectionStatus: 'PENDING_BACKEND', domainVerificationStatus: 'UNVERIFIED', credentialConfigured: false, credentialLast4: '', lastVerifiedAt: '', lastError: '', lastSync: 'Chưa đồng bộ' },
    ],
    integrations: [],
    leaderDistribution: {
      enabled: true,
      enabledLeaderIds: [],
      weights: {},
      sourceRules: []
    },
    saleDistributionByLeader: {

    },
    settings: { leaderCanUpdate: true, notifyMilestones: true, leaderAttendanceRequired: true, assignmentMode: 'MANUAL', saleAssignmentModes: {}, assignmentCursor: { leaders: 0, salesByTeam: {} }, slaMinutes: 30, customAccent: '#e8572a', fontFamily: 'aptos', navigationFontSize: 12, contentFontSize: 14, dataBotToken: '', dataBotChatId: '', memberBotToken: '', memberBotChatId: '', webhookPublicBase: 'https://nvtagency.top', attendanceIp: '', attendanceDeadline: '09:00', acceptTimeoutHours: 24, notifyAccountCreated: true, notifyDataReceived: true, emailNotificationsEnabled: true, brokeragePublishedPeriods: [] },
    security: {
      twoFactorEnabled: false,
      loginHistory: []
    }
  };
}

function cleanText(value, fallback = '', maxLength = 1000) {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function dataTerminology(value) {
  return String(value || '').replace(/\bleads?\b/gi, word => word[0] === word[0].toUpperCase() ? 'Data' : 'data');
}

function cleanId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,96}$/.test(value) ? value : null;
}


function cleanTimestamp(value, fallback = '') {
  const candidate = cleanText(value, '', 16);
  const match = candidate.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/);
  if (!match || cleanDate(match[1]) !== match[1] || Number(match[2]) > 23 || Number(match[3]) > 59) return fallback;
  return candidate;
}

function cleanDate(value, fallback = '') {
  const candidate = cleanText(value, '', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return fallback;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : fallback;
}

/* Giờ dạng HH:MM thật sự hợp lệ — /^\d{2}:\d{2}$/ vẫn lọt "25:99" nên giờ chốt
   điểm danh phải qua đây, nếu không nhãn Trễ sẽ so với một mốc không tồn tại. */
function cleanClockTime(value, fallback = '') {
  const candidate = cleanText(value, '', 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(candidate)) return fallback;
  return candidate;
}


function defaultCustomFieldValue(field) {
  if (field.type === 'MULTI_SELECT') return [];
  if (field.type === 'CHECKBOX') return false;
  if (field.id === 'customerLevel') return 'L0';
  return '';
}


function sanitizeCustomFieldValue(value, field) {
  if (!field) return '';
  if (field.type === 'CHECKBOX') return value === true || value === 'true' || value === '1';
  if (field.type === 'MULTI_SELECT') {
    const allowed = new Set(field.options.map(option => option.value));
    const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    return Array.from(new Set(values.map(item => cleanText(String(item), '', 160).trim()).filter(item => allowed.has(item))));
  }
  if (field.type === 'SELECT') {
    const candidate = cleanText(String(value ?? ''), '', 160).trim();
    const option = field.options.find(item => item.value === candidate || item.label === candidate);
    return option?.value || '';
  }
  if (field.type === 'DATE') return cleanDate(value);
  if (field.type === 'NUMBER') {
    const candidate = Number(value);
    return Number.isFinite(candidate) ? Math.max(-Number.MAX_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, candidate)) : '';
  }
  const candidate = cleanText(String(value ?? ''), '', field.type === 'NOTE' ? 4000 : 1000).trim();
  if (field.type === 'URL') {
    return !candidate || /^https?:\/\/[^\s]+$/i.test(candidate) ? candidate : '';
  }
  return candidate;
}
















function cleanSourceUrl(value) {
  const raw = cleanText(value, '', 500).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return '';
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}

function normalizeWebsiteRecord(item) {
  const id = cleanId(item.id);
  if (!id) return null;
  const connectionStatus = ['UNCONFIGURED', 'PENDING_BACKEND', 'VERIFIED', 'ERROR'].includes(item.connectionStatus) ? item.connectionStatus : 'UNCONFIGURED';
  return {
    id,
    name: dataTerminology(cleanText(item.name, 'Website', 200)),
    domain: cleanText(item.domain || (() => { try { return new URL(cleanSourceUrl(item.sourceUrl)).hostname; } catch { return ''; } })(), '', 253).toLowerCase(),
    sourceUrl: cleanSourceUrl(item.sourceUrl) || (cleanText(item.domain, '', 253) ? `https://${cleanText(item.domain, '', 253).replace(/^https?:\/\//, '').replace(/\/+$/, '')}/` : ''),
    status: item.status === 'ACTIVE' && connectionStatus === 'VERIFIED' ? 'ACTIVE' : 'PAUSED',
    provider: ['LANDING_API', 'NOTIFICATION'].includes(item.provider) ? item.provider : 'LANDING_API',
    endpoint: cleanText(item.endpoint, '', 500),
    externalAccountId: cleanText(item.externalAccountId, '', 160),
    campaignId: cleanText(item.campaignId, '', 160),
    formId: cleanText(item.formId, '', 160),
    webhookSlug: cleanWebhookSlug(item.webhookSlug) || generateWebhookSlug(),
    webhookUrlOverride: cleanWebhookOverride(item.webhookUrlOverride),
    connectionStatus,
    domainVerificationStatus: item.domainVerificationStatus === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED',
    credentialConfigured: item.credentialConfigured === true,
    credentialLast4: cleanText(item.credentialLast4, '', 4).length === 4 ? cleanText(item.credentialLast4, '', 4) : '',
    lastVerifiedAt: cleanTimestamp(item.lastVerifiedAt),
    lastError: cleanText(item.lastError, '', 500),
    lastSync: cleanText(item.lastSync, 'Chưa đồng bộ', 80)
  };
}

const WEBHOOK_SLUG_PATTERN = /^ds-\d{13}-[A-Z0-9]{11}$/;
const WEBHOOK_SUFFIX_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const DEFAULT_WEBHOOK_BASE = 'https://nvtagency.top';

function randomWebhookSuffix(length) {
  const cryptoRef = typeof crypto !== 'undefined' && crypto ? crypto : null;
  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    const bytes = new Uint8Array(length);
    cryptoRef.getRandomValues(bytes);
    return Array.from(bytes, byte => WEBHOOK_SUFFIX_ALPHABET[byte % WEBHOOK_SUFFIX_ALPHABET.length]).join('');
  }
  let suffix = '';
  for (let index = 0; index < length; index += 1) suffix += WEBHOOK_SUFFIX_ALPHABET[Math.floor(Math.random() * WEBHOOK_SUFFIX_ALPHABET.length)];
  return suffix;
}

function generateWebhookSlug() {
  return `ds-${Date.now()}-${randomWebhookSuffix(11)}`;
}

function cleanWebhookSlug(value) {
  const slug = cleanText(value, '', 60).trim();
  return WEBHOOK_SLUG_PATTERN.test(slug) ? slug : '';
}

function cleanWebhookBase(value, fallback) {
  const candidate = cleanText(value, '', 200).trim().replace(/\/+$/, '');
  if (/^https:\/\/[^\s]+$/i.test(candidate)) return candidate;
  const backup = cleanText(fallback, '', 200).trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s]+$/i.test(backup) ? backup : DEFAULT_WEBHOOK_BASE;
}

function cleanWebhookOverride(value) {
  const url = cleanText(value, '', 500).trim();
  if (!/^https:\/\/[^\s]+$/i.test(url)) return '';
  return url.endsWith('/') ? url : `${url}/`;
}

function webhookPublicBase() {
  return cleanWebhookBase(state.settings.webhookPublicBase, DEFAULT_WEBHOOK_BASE);
}

function webhookUrlFor(website) {
  const slug = cleanWebhookSlug(website?.webhookSlug);
  if (!slug) return '';
  return cleanWebhookOverride(website?.webhookUrlOverride) || `${webhookPublicBase()}/api/data-sources/webhook/${slug}/`;
}


function websiteByWebhookSlug(slug) {
  const wanted = cleanText(slug, '', 60).trim().toUpperCase();
  if (!wanted) return null;
  return state.websites.find(website => String(website.webhookSlug || '').toUpperCase() === wanted) || null;
}

function webhookPanelMarkup(website) {
  const url = webhookUrlFor(website);
  const urlRow = url
    ? `<div class="webhook-url-row"><input class="mono webhook-url" id="webhookUrl-${escapeHtml(website.id)}" readonly data-copy-webhook="${escapeHtml(website.id)}" value="${escapeHtml(url)}" title="Chạm hoặc nhấn đúp để sao chép URL webhook" aria-label="Webhook URL của ${escapeHtml(website.name)}"></div>`
    : `<div class="webhook-url-row"><span class="webhook-empty">Chưa có URL webhook</span></div>`;
  return `<div class="webhook-box"><div class="webhook-box-head"><b>Webhook nhận data landing page</b><span class="webhook-tag mono">POST - application/json</span></div>${urlRow}</div>`;
}
/* ------------------------------------------------- webhook inbox consumer
   webhook-server.cjs là nơi DUY NHẤT nhận webhook từ LadiPage. Frontend
   tĩnh này không tự bịa inbox: nó chỉ ĐỌC inbox của server bằng cursor rồi
   đưa bản ghi status NEW qua đúng ingestCustomer() — cùng một ống dẫn như
   sale tạo khách thủ công, nên dedupe theo SĐT, luật chia theo nguồn và
   hàng chờ "Data → Thứ tự data mới vào" đều giữ nguyên hành vi.

   Chỉ Admin chạy consumer: ingestCustomer phân nhánh theo role đang đăng nhập
   (SALE → gắn thẳng vào sale đó, LEADER → gắn vào team đó). Chạy dưới role
   SALE/LEADER sẽ quy nhầm chủ phụ trách cho data landing page, và hai role này
   cũng không được nhìn trường nguồn (hợp đồng §9).

   Slug webhook là khóa truy cập nên KHÔNG bao giờ đi vào note của khách hay
   audit log. Dữ liệu chờ được đồng bộ vào MySQL, cùng với
   state.websites[].webhookSlug vốn đã được lưu ở đó.
-------------------------------------------------------------------------- */
const WEBHOOK_CURSOR_KEY = 'nvt-crm-webhook-cursor-v2';
const WEBHOOK_CONSUMED_KEY = 'nvt-crm-webhook-consumed-v2';
const WEBHOOK_PENDING_KEY = 'nvt-crm-webhook-pending-v2';
const WEBHOOK_CONSUMED_RING = 400;
const WEBHOOK_PENDING_CAP = 200;
// cPanel/Passenger thường cần vài giây để đánh thức Node và pool MySQL sau khi idle.
const WEBHOOK_FETCH_TIMEOUT_MS = 15000;
const WEBHOOK_POLL_LIVE_MS = 30000;
const WEBHOOK_POLL_IDLE_MS = 15000;

const WEBHOOK_TRANSPORT_META = {
  idle: ['Chưa bật đồng bộ', 'pending'],
  syncing: ['Đang đồng bộ...', 'info'],
  live: ['Đang nghe trực tiếp', 'active'],
  polling: ['Hỏi server định kỳ', 'info'],
  offline: ['Chưa thấy server webhook', 'pending'],
  error: ['Lỗi đọc inbox', 'cancelled']
};

const WEBHOOK_INTAKE_CONTEXT = { intakeType: 'API', sourceLabel: 'Landing page webhook' };

let webhookTransport = { mode: 'idle', detail: '', checkedAt: '' };
let webhookPending = loadWebhookPending();
let webhookEventSource = null;
let webhookPollTimer = null;
let webhookPulling = false;

let webhookCursor = '';
const webhookConsumed = new Set();
function loadWebhookPending(){return [];}
function saveWebhookPending(){state.webhookPending=webhookPending;saveState();}
function loadWebhookCursor(){return webhookCursor;}
function saveWebhookCursor(id){webhookCursor=String(id||'');}
function claimWebhookRecord(id){if(!id||webhookConsumed.has(id))return false;webhookConsumed.add(id);return true;}

function webhookApiBase() {
  const origin = typeof window !== 'undefined' && window && window.location ? window.location.origin : '';
  return /^https?:\/\/[^/]+$/.test(origin) ? origin : '';
}

function emailApiBase() {
  return webhookApiBase();
}

function staffEmail(id) {
  return activeStaff().find(member => member.id === id)?.email || '';
}

function queueEmailNotification(recipients, subject, text) {
  if (state.settings.emailNotificationsEnabled === false) return;
  const unique = [...new Set(
    (Array.isArray(recipients) ? recipients : [recipients])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
  )];
  const base = emailApiBase();
  if (!unique.length || !base) return;
  fetch(`${base}/api/email/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ recipients: unique, subject, text })
  }).catch(() => {});
}

async function sendTestEmail() {
  if (currentAccount?.role !== 'ADMIN') return;
  const recipient = $('#emailTestRecipient')?.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    toast('Nhập email nhận thử hợp lệ');
    return;
  }
  const base = emailApiBase();
  if (!base) {
    toast('Hãy mở CRM bằng server Node để gửi Gmail');
    return;
  }
  const response = await fetch(`${base}/api/email/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      recipients: [recipient],
      subject: 'NVT AGENCY - Email thử',
      text: `Email thử từ NVT AGENCY lúc ${stamp()}.`
    })
  }).catch(() => null);
  toast(response?.ok ? 'Đã gửi email thử' : 'Chưa gửi được email. Kiểm tra Gmail App Password trên server.');
}

/* IP của phiên chỉ được dùng cho hai luồng người dùng đã chốt: sale tạo khách
   và khách tự đăng ký từ web. Data landing page KHÔNG lấy IP (server đã bỏ).
   Frontend không tự đoán IP — nó hỏi server qua /api/session-context, vì chỉ
   reverse proxy/backend mới thấy IP thật của người gọi. Chưa hỏi được thì giữ
   nhãn cũ, tuyệt đối không bịa một IP trông như thật. */
let sessionContextIp = '';
let sessionContextLoaded = false;

async function refreshSessionContext() {
  const base = webhookApiBase();
  if (!base || sessionContextLoaded) return sessionContextIp;
  try {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), WEBHOOK_FETCH_TIMEOUT_MS) : null;
    let payload;
    try {
      const response = await fetch(`${base}/api/session-context`, { headers: { Accept: 'application/json', Authorization: `Bearer ${serverSyncToken}` }, signal: controller ? controller.signal : undefined });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = await response.json();
    } finally { if (timer) clearTimeout(timer); }
    const ip = cleanText(payload && payload.ip, '', 64).trim();
    if (ip) { sessionContextIp = ip; sessionContextLoaded = true; }
  } catch (error) { /* server chưa chạy — giữ nhãn "chờ backend" */ }
  return sessionContextIp;
}

function sessionIp(fallback) {
  return sessionContextIp || fallback;
}

function setWebhookTransport(mode, detail) {
  webhookTransport = { mode, detail: String(detail || ''), checkedAt: stamp() };
  paintWebhookTransport();
}

function paintWebhookTransport() {
  const meta = WEBHOOK_TRANSPORT_META[webhookTransport.mode] || WEBHOOK_TRANSPORT_META.idle;
  const chip = $('[data-webhook-transport]');
  if (chip) { chip.className = `status status-${meta[1]}`; chip.textContent = meta[0]; }
  const detail = $('[data-webhook-transport-detail]');
  if (detail) detail.textContent = webhookTransport.detail;
  const counter = $('[data-webhook-pending-count]');
  if (counter) counter.textContent = number(webhookPending.length);
}

function queueWebhookPending(record, customer, problem, reason) {
  if (webhookPending.some(item => item.id === record.id)) return 'pending';
  webhookPending.push({
    id: record.id,
    slug: String(record.slug || ''),
    receivedAt: String(record.receivedAt || ''),
    problem,
    reason: String(reason || ''),
    customer: {
      name: String(customer.name || ''),
      phone: String(customer.phone || ''),
      email: String(customer.email || '')
    }
  });
  webhookPending = webhookPending.slice(-WEBHOOK_PENDING_CAP);
  saveWebhookPending();
  return 'pending';
}

function webhookIngestFields(item, website) {
  // Không truyền ipAddress: theo quy tắc đã chốt, landing page chỉ lấy họ tên,
  // SĐT, email — ingestCustomer tự để 'Chưa xác định'.
  // Không truyền note: để ingestCustomer dùng mặc định "Data từ <domain>".
  // campaign chỉ lấy từ ánh xạ của chính website — adapter cố tình bỏ
  // utm_campaign của LadiPage, nên tự nhận campaign ở đây là bịa data.
  return {
    name: item.name,
    phone: item.phone,
    email: item.email,
    ipAddress: item.ipAddress || item.ip || '',
    websiteId: website.id,
    source: 'Landing Page',
    campaign: website.campaignId || 'UNATTRIBUTED',
    landingPageName: website.name,
    landingPageUrl: website.sourceUrl,
    landingPageDomain: website.domain
  };
}

function ingestWebhookRecord(record) {
  if (!record || typeof record !== 'object') return 'ignored';
  if (record.duplicate) return 'resubmission';
  if (record.persisted || record.customerId) return 'ignored'; // Khách đã được backend lưu; lấy qua API MySQL.
  if (record.status !== 'NEW') return 'ignored'; // INVALID đã bị server chặn ở 422
  if (!claimWebhookRecord(record.id)) return 'duplicate';
  const customer = record.customer && typeof record.customer === 'object' ? record.customer : {};
  const website = websiteByWebhookSlug(record.slug);
  // Không có website khớp mã → hàng UNATTRIBUTED chờ Admin quy nguồn.
  // Hợp đồng §10: "không có fallback ngầm" — tuyệt đối không tự gán WEB-1.
  if (!website) return queueWebhookPending(record, customer, 'UNATTRIBUTED', 'Chưa có website nào dùng mã webhook này');
  const result = ingestCustomer(webhookIngestFields(customer, website), WEBHOOK_INTAKE_CONTEXT);
  if (result.created) return 'created';
  if (result.duplicate) return 'resubmission';
  return queueWebhookPending(record, customer, 'REJECTED', result.error || 'Không tạo được khách hàng');
}

async function pullWebhookInbox(manual = false) {
  if (webhookPulling) return { pulled: 0, busy: true };
  if (!currentAccount || currentAccount.role !== 'ADMIN') return { pulled: 0, skipped: true };
  const base = webhookApiBase();
  if (!base) {
    setWebhookTransport('offline', 'Chỉ đồng bộ được khi mở CRM qua server Node (http://localhost:4173).');
    return { pulled: 0 };
  }
  webhookPulling = true;
  if (manual) setWebhookTransport('syncing', 'Đang đọc inbox webhook từ server...');
  try {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), WEBHOOK_FETCH_TIMEOUT_MS) : null;
    let payload;
    try {
      const response = await fetch(`${base}/api/data-sources/inbox?since=${encodeURIComponent(loadWebhookCursor())}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${serverSyncToken}` },
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = await response.json();
    } finally { if (timer) clearTimeout(timer); }

    const items = Array.isArray(payload && payload.items) ? payload.items : [];
    // SSE chỉ báo có dữ liệu; danh sách khách phải đọc từ nguồn MySQL.
    if (items.some(record => record.persisted || record.customerId)) await syncServerState();
    const tally = { created: 0, resubmission: 0, pending: 0, ignored: 0, duplicate: 0 };
    for (const record of items) {
      const outcome = ingestWebhookRecord(record);
      tally[outcome] = (tally[outcome] || 0) + 1;
    }
    if (payload && typeof payload.lastId === 'string' && payload.lastId) saveWebhookCursor(payload.lastId);

    const touched = tally.created + tally.resubmission + tally.pending;
    // render() dựng lại #content nên phải vẽ lại cả nhãn trạng thái đồng bộ.
    if (touched) { saveState(); refreshTaskStatuses(); render(); }

    const live = Boolean(webhookEventSource && webhookEventSource.readyState === 1);
    const at = stamp().slice(11);
    if (touched) {
      const parts = [];
      if (tally.created) parts.push(`${tally.created} khách mới`);
      if (tally.resubmission) parts.push(`${tally.resubmission} trùng · ghi nhận điền lại form`);
      if (tally.pending) parts.push(`${tally.pending} chờ quy nguồn`);
      setWebhookTransport(live ? 'live' : 'polling', `Vừa nhận ${touched} data landing page lúc ${at}: ${parts.join(', ')}.`);
      if (tally.resubmission) toast(`${tally.resubmission} data trùng đã được giữ Sale đang phụ trách`);
      else if (tally.created) toast(`${tally.created} khách landing page đã vào hàng chờ chia Leader`);
      else if (manual) toast(`Đã đồng bộ ${touched} data landing page`);
    } else {
      setWebhookTransport(live ? 'live' : 'polling', `Đã kiểm tra inbox lúc ${at} — chưa có data mới từ landing page.`);
      if (manual) toast('Đã kiểm tra inbox webhook — chưa có data mới');
    }
    return { pulled: touched, tally };
  } catch (error) {
    const reason = error && error.name === 'AbortError'
      ? 'server phản hồi quá chậm'
      : 'server webhook chưa chạy hoặc mở sai cổng';
    setWebhookTransport('offline', `Chưa đọc được inbox (${reason}). CRM vẫn dùng bình thường với dữ liệu cục bộ.`);
    if (manual) toast(`Chưa kết nối được server webhook — ${reason}`);
    return { pulled: 0, error: reason };
  } finally {
    webhookPulling = false;
  }
}

function scheduleWebhookPoll() {
  if (webhookPollTimer) clearTimeout(webhookPollTimer);
  const live = Boolean(webhookEventSource && webhookEventSource.readyState === 1);
  webhookPollTimer = setTimeout(() => {
    webhookPollTimer = null;
    Promise.resolve(pullWebhookInbox(false)).then(scheduleWebhookPoll, scheduleWebhookPoll);
  }, live ? WEBHOOK_POLL_LIVE_MS : WEBHOOK_POLL_IDLE_MS);
}

function startWebhookConsumer() {
  stopWebhookConsumer();
  if (!currentAccount || currentAccount.role !== 'ADMIN') return;
  const base = webhookApiBase();
  if (!base) {
    setWebhookTransport('offline', 'Chỉ đồng bộ được khi mở CRM qua server Node (http://localhost:4173).');
    return;
  }
  if (typeof EventSource === 'function') {
    try {
      webhookEventSource = new EventSource(`${base}/api/data-sources/stream`);
      webhookEventSource.onopen = () => setWebhookTransport('live', 'Đang nghe webhook landing page theo thời gian thật (SSE).');
      webhookEventSource.onmessage = () => { refreshNavigationCounts(); syncServerState(); pullWebhookInbox(false); };
      // SSE tự nối lại theo "retry: 3000" của server; vòng poll vẫn chạy nền nên
      // data tới trong lúc đứt kênh không bị mất.
      webhookEventSource.onerror = () => setWebhookTransport('polling', 'Kênh trực tiếp gián đoạn — đang hỏi server định kỳ, data không bị mất.');
    } catch (error) { webhookEventSource = null; }
  }
  scheduleWebhookPoll();
  pullWebhookInbox(false);
}

function stopWebhookConsumer() {
  if (webhookPollTimer) { clearTimeout(webhookPollTimer); webhookPollTimer = null; }
  if (webhookEventSource) { try { webhookEventSource.close(); } catch (error) {} webhookEventSource = null; }
}

function webhookPendingModal() {
  if (!currentAccount || currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được quy nguồn data'); return; }
  if (!webhookPending.length) { toast('Không còn data landing page nào chờ xử lý'); return; }
  const problemMeta = { UNATTRIBUTED: ['Chưa quy nguồn', 'pending'], REJECTED: ['Bị từ chối', 'cancelled'] };
  const options = state.websites.map(site => `<option value="${escapeHtml(site.id)}">${escapeHtml(site.name)} — ${escapeHtml(site.domain)}</option>`).join('');
  const rows = webhookPending.slice().reverse().map(item => {
    const meta = problemMeta[item.problem] || problemMeta.UNATTRIBUTED;
    return `<tr><td class="mono">${escapeHtml(item.receivedAt || '—')}</td><td><div class="cell-main">${escapeHtml(item.customer.name || 'Không có họ tên')}</div><div class="cell-sub">${escapeHtml(item.customer.phone || 'không có SĐT')}${item.customer.email ? ` · ${escapeHtml(item.customer.email)}` : ''}</div></td><td><span class="status status-${meta[1]}">${meta[0]}</span><div class="cell-sub">${escapeHtml(item.reason)}</div></td><td><select data-pending-website="${escapeHtml(item.id)}" aria-label="Chọn website để quy nguồn cho data này">${options}</select></td><td><button class="button button-small button-primary" type="button" data-resolve-pending="${escapeHtml(item.id)}">Quy nguồn</button> <button class="button button-small" type="button" data-drop-pending="${escapeHtml(item.id)}">Bỏ qua</button></td></tr>`;
  }).join('');
  openModal(`Data landing page chờ xử lý · ${webhookPending.length}`, `<div class="credential-hint">Đây là các bản ghi <b>server webhook đã nhận thật</b> nhưng CRM chưa đưa được vào tệp khách: hoặc mã webhook chưa gắn với website nào, hoặc dữ liệu không qua được bước kiểm tra tạo khách. Chọn website rồi bấm <b>Quy nguồn</b> — bản ghi đi qua đúng ống dẫn tạo khách và xuất hiện ở <b>Data → Thứ tự data mới vào</b>. Không bản ghi nào bị âm thầm gán cho một website mặc định.</div><div class="table-wrap"><table><thead><tr><th>Thời điểm nhận</th><th>Khách hàng</th><th>Vấn đề</th><th>Quy vào website</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div class="modal-actions"><button class="button" type="button" data-close-modal>Đóng</button></div>`);
  $$('[data-pending-website]').forEach(select => {
    const item = webhookPending.find(row => row.id === select.dataset.pendingWebsite);
    const suggested = item ? websiteByWebhookSlug(item.slug) : null;
    if (suggested) select.value = suggested.id;
  });
  $$('[data-resolve-pending]').forEach(button => button.onclick = () => {
    const select = $(`[data-pending-website="${button.dataset.resolvePending}"]`);
    resolveWebhookPending(button.dataset.resolvePending, select ? select.value : '');
  });
  $$('[data-drop-pending]').forEach(button => button.onclick = () => dropWebhookPending(button.dataset.dropPending));
}

function resolveWebhookPending(id, websiteId) {
  const index = webhookPending.findIndex(item => item.id === id);
  if (index === -1) { toast('Bản ghi này đã được xử lý rồi'); webhookPendingModal(); return; }
  const website = websiteById(websiteId);
  if (!website) { toast('Hãy chọn website để quy nguồn'); return; }
  const item = webhookPending[index];
  webhookPending.splice(index, 1);
  saveWebhookPending();
  const result = ingestCustomer(webhookIngestFields(item.customer, website), WEBHOOK_INTAKE_CONTEXT);
  if (result.created) {
    audit('ASSIGN_WEBSITE_SOURCE', website.id, `Quy nguồn data landing page cho khách ${result.customer.name}`);
    saveState(); refreshTaskStatuses();
    render();
    if (webhookPending.length) webhookPendingModal(); else closeModal();
    toast(`Đã quy nguồn vào ${website.name} — khách vào hàng chờ chia Leader`);
    return;
  }
  if (result.duplicate) {
    saveState();
    render();
    if (webhookPending.length) webhookPendingModal(); else closeModal();
    toast('Khách này đã có trong CRM — đã ghi nhận một lần điền lại form');
    return;
  }
  webhookPending.splice(index, 0, { ...item, problem: 'REJECTED', reason: result.error || 'Không tạo được khách hàng' });
  saveWebhookPending(); render(); webhookPendingModal();
  toast(result.error || 'Không tạo được khách hàng');
}

function dropWebhookPending(id) {
  const index = webhookPending.findIndex(item => item.id === id);
  if (index === -1) return;
  const [removed] = webhookPending.splice(index, 1);
  saveWebhookPending();
  if (!webhookPending.length) { closeModal(); render(); toast('Đã xử lý hết data chờ'); return; }
  render(); webhookPendingModal();
  toast(`Đã bỏ qua data của ${removed.customer.name || 'khách không tên'}`);
}

// Hiện ở hàng chờ "Data" để Admin thấy ngay có data landing page chưa
// vào được tệp khách, thay vì phải đi vòng qua mục Websites.
function webhookQueueNoticeMarkup() {
  if (!webhookPending.length) return '';
  return `<div class="webhook-pending" data-webhook-pending-banner><b>${number(webhookPending.length)}</b> data landing page đã về server nhưng chưa vào được hàng chờ. <button class="button button-small button-primary" type="button" data-webhook-pending="1">Xem &amp; quy nguồn</button></div>`;
}

function webhookTransportMarkup() {
  const meta = WEBHOOK_TRANSPORT_META[webhookTransport.mode] || WEBHOOK_TRANSPORT_META.idle;
  return `<section class="panel webhook-transport" style="margin-bottom:14px"><div class="panel-body"><div class="webhook-box-head"><b>Đồng bộ data từ server webhook</b><span class="status status-${meta[1]}" data-webhook-transport>${escapeHtml(meta[0])}</span></div><div class="cell-sub" data-webhook-transport-detail>${escapeHtml(webhookTransport.detail)}</div><div class="connection-actions"><button class="button button-small button-primary" type="button" data-webhook-sync="1">Đồng bộ ngay</button><button class="button button-small" type="button" data-webhook-pending="1">Data chờ quy nguồn (<b data-webhook-pending-count>${number(webhookPending.length)}</b>)</button></div></div></section>`;
}






let state = initialState();
PRODUCTS = state.products;
STAFF = state.members.filter(person => person.active !== false);
applyAppearanceSettings();
refreshTaskStatuses();
let currentAccount = null;
let currentView = 'dashboard';
let dateRange = 7;
let datePreset = '7';
let customDateStart = dayIso(6);
let customDateEnd = dayIso(0);
let orderStatusFilter = 'ALL';
let customerStatusFilter = 'ALL';
let customerOwnerFilter = 'ALL';
let customerPage = 1;
let customerPageSize = 20;
let globalQuery = '';
let selectedPoolIds = new Set();
let drawerReturnFocus = null;
let modalReturnFocus = null;
let distributionTab = 'QUEUE';
let distributionLeaderId = 'l1';
let lastImportStats = { created: 0, duplicates: 0, registeredDuplicates: 0 };

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/\s+/g, '').toLowerCase();
}

function money(value, compact = false) {
  if (compact) return new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(value) + ' đ';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
}

function number(value) { return new Intl.NumberFormat('vi-VN').format(value); }
function dateOnly(value) { return String(value).slice(0, 10); }
function dataDateParts(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return match ? { date: `${match[3]}/${match[2]}/${match[1]}`, time: `${match[4]}:${match[5]}` } : { date: '—', time: '' };
}
function stamp() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type)?.value || '00';
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
}
function staffName(id) { return state.members.find(person => person.id === id)?.name || 'Chưa phân'; }
function activeStaff() { return STAFF.filter(person => person.active !== false); }
function productById(id) { return PRODUCTS.find(product => product.id === id); }
function customerById(id) { return state.customers.find(customer => customer.id === id); }
function websiteById(id) { return state.websites.find(website => website.id === id); }
function customerLanding(customer) { return websiteById(customer?.websiteId); }
function customerSourceDetails(customer) {
  const website = customerLanding(customer);
  const snapshotName = String(customer?.landingPageName || '').trim();
  const genericSnapshot = !snapshotName || ['landing page', 'website', 'nguồn chưa được gắn'].includes(snapshotName.toLowerCase());
  return {
    name: (!genericSnapshot && snapshotName) || website?.name || customer?.landingPageDomain || website?.domain || (customer?.webhookSlug ? `Webhook ${customer.webhookSlug}` : 'Nguồn chưa được gắn'),
    url: customer?.landingPageUrl || website?.sourceUrl || '',
    domain: customer?.landingPageDomain || website?.domain || ''
  };
}
function customerLandingName(customer) {
  const source = customerSourceDetails(customer);
  return source.url ? `${source.name} · ${source.url}` : `${source.name}${source.domain ? ` · ${source.domain}` : ''}`;
}

function websiteCustomerRows(websiteId) { return state.customers.filter(customer => customer.websiteId === websiteId); }
function orderSource(source) {
  if (['Referral', 'Landing Page', 'Website Organic', 'Direct / Referral'].includes(source)) return 'Direct / Referral';
  return TRAFFIC_META.some(item => item.source === source) ? source : 'Chưa quy nguồn';
}

// Chỉ giữ dữ liệu làm việc trong RAM. Server là nguồn dữ liệu duy nhất.
const SERVER_LISTS = ['customers','orders','products','members','registrations','customFieldDefinitions','customerFieldHistory','assignmentHistory','resubmissions','notes','imports','attendance','dataOffers','traffic','tasks','notifications','audit','websites','integrations','webhookPending','brokerageMetrics','feedbacks','processes','expenses','courseConfigs','hrProfiles'];
const SERVER_OBJECTS = ['settings','leaderDistribution','saleDistributionByLeader','productCategories','careGroups'];
let serverSyncToken = '', serverSyncTimer = null, serverSaveTimer = null;
let serverAutomationStatus = null;
let serverSaveRunning = false, serverReading = false, serverStateLoaded = false;
let serverRecoveryPending = false;
let serverSourceBaseline = new Map();
let serverBaseline = new Map(), serverVersions = {}, serverPendingRequest = null;
let serverSaveError='';
let serverStorageMode='unknown';
const savedStorageLabel=()=>serverStorageMode==='mysql'?'Đã lưu MySQL':serverStorageMode==='demo'?'Đã lưu demo · chưa ghi SQL':'Máy chủ đã xác nhận lưu';
let serverConflict = false, serverMutationVersion = 0;
let serverSavePromise = null;
let liveNavigationCounts = null, navigationCountsReading = false;
function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+stableJson(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function serverRecords(source=state) {
  const result=new Map();
  for(const key of SERVER_LISTS)for(const value of source[key]||[])result.set(`${key}/${value.id}`,structuredClone(value));
  // Tài khoản chưa phân quyền cùng khóa members, không lưu mật khẩu ở frontend.
  for(const value of source.registeredAccounts||[])if(!result.has(`members/${value.id}`))result.set(`members/${value.id}`,structuredClone(value));
  for(const key of SERVER_OBJECTS)if(source[key]!==undefined)result.set(`${key}/$`,structuredClone(source[key]));
  return result;
}
function hasServerChanges() {
  const now=serverRecords();
  return now.size!==serverBaseline.size || [...now].some(([key,r])=>stableJson(r)!==stableJson(serverBaseline.get(key)));
}
function setSaveStatus(message,failed=false) {
  const node=$('#serverSaveStatus');if(node){node.textContent=message;node.style.color=failed?'#c33d42':'';}
}
function pendingChanges() {
  const now=serverRecords(), changes=[];
  for(const key of new Set([...now.keys(),...serverBaseline.keys()])) {
    if(stableJson(now.get(key))===stableJson(serverBaseline.get(key)))continue;
    const slash=key.indexOf('/');let value=now.get(key)??null,fields=null;
    // Chỉ gửi các trường thực sự được sửa; thông tin bổ sung để hiển thị không được coi là thay đổi nguồn khách.
    if(key.startsWith('customers/')&&value&&serverSourceBaseline.has(key)&&serverBaseline.has(key)){
      const displayBase=serverBaseline.get(key), edited=value;value=structuredClone(serverSourceBaseline.get(key));fields=[];
      for(const field of new Set([...Object.keys(displayBase),...Object.keys(edited)])){
        if(stableJson(displayBase[field])===stableJson(edited[field]))continue;
        if(Object.hasOwn(edited,field))value[field]=structuredClone(edited[field]);else delete value[field];
        // customFields gửi theo từng cột để máy chủ gộp với cột người khác vừa sửa cùng lúc.
        if(field==='customFields'){const a=displayBase.customFields||{},b=edited.customFields||{};for(const id of new Set([...Object.keys(a),...Object.keys(b)]))if(stableJson(a[id])!==stableJson(b[id]))fields.push('customFields.'+id);}
        else fields.push(field);
      }
    }
    const change={key:key.slice(0,slash),id:key.slice(slash+1),base:serverVersions[key]??null,value};
    if(fields)change.fields=fields;
    changes.push(change);
  }
  return changes;
}
function rebaseRecord(before, edited, latest) {
  const merged=structuredClone(latest);
  for(const field of new Set([...Object.keys(before),...Object.keys(edited)])){
    if(stableJson(before[field])===stableJson(edited[field]))continue;
    const a=before[field],b=edited[field];
    if(field==='customFields'&&a&&b&&typeof a==='object'&&typeof b==='object'){
      merged.customFields={...(merged.customFields||{})};
      for(const id of new Set([...Object.keys(a),...Object.keys(b)])){
        if(stableJson(a[id])===stableJson(b[id]))continue;
        if(Object.hasOwn(b,id))merged.customFields[id]=structuredClone(b[id]);else delete merged.customFields[id];
      }
      continue;
    }
    if(Object.hasOwn(edited,field))merged[field]=structuredClone(b);else delete merged[field];
  }
  return merged;
}
// Máy chủ báo bản ghi đã đổi ở máy khác (409): tải bản mới rồi gộp lại phần mình sửa để gửi tiếp.
async function rebaseOnServer(token) {
  const base=serverBaseline;
  const controller=typeof AbortController==='function'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),WEBHOOK_FETCH_TIMEOUT_MS):null;
  let response,payload;
  try{
    response=await fetch(webhookApiBase()+'/api/state?passive=1',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:controller?controller.signal:undefined});
    payload=await response.json();
  }finally{if(timer)clearTimeout(timer);}
  if(token!==serverSyncToken||!response.ok||!payload?.state)return false;
  applyServerSnapshot(payload,base,true);
  return true;
}
// Nút "Thử lưu lại": gỡ xung đột cũ bằng cách tải bản mới và gộp lại phần mình đã sửa.
async function resolveServerConflict() {
  if(!serverConflict)return true;
  if(!serverSyncToken||!serverStateLoaded||serverSaveRunning)return false;
  try{
    if(!await rebaseOnServer(serverSyncToken))return false;
    serverConflict=false;serverPendingRequest=null;forgetPendingWrite();
    return true;
  }catch(error){return false;}
}
function applyServerSnapshot(payload, keepEdits=null, rebase=false) {
  serverAutomationStatus = payload.automation || null;
  serverStorageMode=payload.storage?.mode||serverStorageMode;
  const defaults=initialState();
  const remote={...defaults,...payload.state,security:{twoFactorEnabled:false,loginHistory:[]}};
  const sourceRecords=new Map((remote.customers||[]).map(customer=>['customers/'+customer.id,structuredClone(customer)]));
  remote.websites=(remote.websites||[]).map(website => ({ ...website, sourceUrl: cleanSourceUrl(website.sourceUrl) || (website.domain ? `https://${String(website.domain).replace(/^https?:\/\//, '').replace(/\/+$/, '')}/` : '') }));
  const websitesBySlug=new Map(remote.websites.filter(website=>website.webhookSlug).map(website => [String(website.webhookSlug||'').toUpperCase(), website]));
  remote.customers=(remote.customers||[]).map(customer => {
    const website=remote.websites.find(item => item.id===customer.websiteId) || websitesBySlug.get(String(customer.webhookSlug||'').toUpperCase());
    if(!website)return customer;
    return {...customer,websiteId:customer.websiteId||website.id,landingPageName:customer.landingPageName||website.name,landingPageUrl:customer.landingPageUrl||website.sourceUrl,landingPageDomain:customer.landingPageDomain||website.domain};
  });
  remote.members=(remote.members||[]).map(r=>({...r,initials:r.initials||memberInitials(r.name)}));
  const remoteRecords=serverRecords(remote);
  // Trong khi lưu, thao tác mới vẫn ở RAM; chỉ thay bản ghi không có sửa tiếp.
  if(keepEdits) {
    const current=serverRecords();
    for(const key of new Set([...current.keys(),...keepEdits.keys()])) {
      if(stableJson(current.get(key))===stableJson(keepEdits.get(key)))continue;
      const slash=key.indexOf('/'), collection=key.slice(0,slash), id=key.slice(slash+1);
      let value=current.get(key);
      if(rebase){
        const before=keepEdits.get(key),latest=remoteRecords.get(key);
        // Khách đã chuyển khỏi phạm vi của mình: không thể lưu nữa, bỏ bản sửa thay vì kẹt cả hàng đợi.
        if(collection==='customers'&&before&&!latest)continue;
        // Lịch sử/ghi chú của khách vừa rời phạm vi cũng bỏ theo, tránh 403 lặp lại.
        const owner=value?.customerId&&collection!=='customers'?'customers/'+value.customerId:'';
        if(owner&&keepEdits.has(owner)&&!remoteRecords.has(owner))continue;
        // Gộp 3 chiều: chỉ áp các trường mình đã sửa lên bản mới nhất, giữ trường người khác vừa đổi.
        if(before&&latest&&value)value=rebaseRecord(before,value,latest);
      }
      // Preserve only our edits made while the request was in flight, not
      // the old row: the acknowledgement may include another user's note.
      if(!rebase&&collection==='customers'&&keepEdits.get(key)&&remoteRecords.get(key)&&value){
        value=rebaseRecord(keepEdits.get(key),value,remoteRecords.get(key));
      }
      if(SERVER_OBJECTS.includes(collection)){remote[collection]=value;continue;}
      remote[collection]=(remote[collection]||[]).filter(r=>r.id!==id);
      if(value)remote[collection].push(value);
      if(collection==='members')remote.registeredAccounts=(remote.registeredAccounts||[]).filter(r=>r.id!==id);
    }
  }
  // Giữ tham chiếu bản ghi: các form/drawer đang mở vẫn sửa đúng đối tượng trong state.
  for(const key of [...SERVER_LISTS,'registeredAccounts']){
    const existing=new Map((state[key]||[]).map(r=>[r.id,r]));
    remote[key]=(remote[key]||[]).map(value=>{
      const old=existing.get(value.id);if(!old)return value;
      for(const field of Object.keys(old))if(!Object.hasOwn(value,field))delete old[field];
      Object.assign(old,value);return old;
    });
  }
  state=remote; applyAppearanceSettings(); STAFF=state.members.filter(r=>r.active!==false);PRODUCTS=state.products;
  webhookPending=state.webhookPending||[];
  serverSourceBaseline=sourceRecords;serverBaseline=remoteRecords;serverVersions=payload.versions||{};serverStateLoaded=true;
  if(payload.user)currentAccount=hydrateSessionAccount(payload.user);
}
function scheduleServerPersistence() {
  if(!serverSyncToken||!serverStateLoaded)return;
  if(serverConflict){setSaveStatus('Xung đột: xuất bản nháp và tải lại',true);return;}
  clearTimeout(serverSaveTimer);
  serverSaveTimer=setTimeout(()=>{serverSaveTimer=null;flushServerPersistence();},250);
}
function saveState() {
  serverMutationVersion++;
  if(!currentAccount||!serverStateLoaded)return;
  setSaveStatus('Đang chờ lưu MySQL…');scheduleServerPersistence();
}
function pendingWriteStorageKey(accountId=currentAccount?.id){return 'nvt-crm-pending-write-v1:'+accountId;}
// Bản nháp lưu ở cả sessionStorage (theo tab) và localStorage (còn sau khi đóng tab/trình duyệt treo).
// Gửi lại cùng requestId là an toàn: máy chủ chỉ ghi một lần cho mỗi mã yêu cầu.
function forgetPendingWrite(accountId=currentAccount?.id){
  const key=pendingWriteStorageKey(accountId);
  try{sessionStorage.removeItem(key);}catch{}
  try{localStorage.removeItem(key);}catch{}
}
function rememberPendingWrite(request){
  const raw=JSON.stringify({actorId:currentAccount.id,requestId:request.requestId,changes:request.changes,skipAutomatic:request.skipAutomatic===true,fastNote:request.fastNote===true});
  sessionStorage.setItem(pendingWriteStorageKey(),raw);
  try{localStorage.setItem(pendingWriteStorageKey(),raw);}catch{}
}
async function recoverPendingWrite(account){
  let raw=sessionStorage.getItem(pendingWriteStorageKey(account.id));
  if(!raw)try{raw=localStorage.getItem(pendingWriteStorageKey(account.id));}catch{}
  if(!raw)return null;
  const request=JSON.parse(raw);
  if(request.actorId!==account.id)throw Error('Bản nháp thuộc tài khoản khác.');
  const controller=typeof AbortController==='function'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),15000):null;
  try{
    const response=await fetch(webhookApiBase()+'/api/state',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+serverSyncToken},body:JSON.stringify({requestId:request.requestId,changes:request.changes,skipAutomatic:request.skipAutomatic,fastNote:request.fastNote===true}),signal:controller?.signal});
    const payload=await response.json();
    if(!response.ok)throw Object.assign(Error(payload.error||'Chưa khôi phục được lần lưu trước. Bản nháp vẫn được giữ.'),{status:response.status});
    forgetPendingWrite(account.id);
    return payload;
  }finally{if(timer)clearTimeout(timer);}
}
async function flushServerPersistence(requestOptions = {}) {
  clearTimeout(serverSaveTimer);serverSaveTimer=null;
  if(serverSavePromise)return serverSavePromise;
  if(!serverSyncToken||!serverStateLoaded||serverConflict)return false;
  serverSavePromise=(async()=>{
    serverSaveRunning=true;let rebaseAttempts=0;
    try {
      do {
        if(!serverPendingRequest) {
          const changes=pendingChanges();if(!changes.length){serverSaveError='';setSaveStatus(savedStorageLabel());return true;}
          // Chọn Level/cột chỉ gồm khách + lịch sử cột: không cần quét chia data dưới khóa ghi chung.
          const backgroundOnly=changes.length>0&&changes.every(change=>['customers','notes','audit','customerFieldHistory'].includes(change.key));
          const fastNote=changes.length>0&&changes.every(change=>['customers','notes','audit'].includes(change.key));
          serverPendingRequest={requestId:makeRecordId('SAVE'),changes,snapshot:serverRecords(),skipAutomatic:Boolean(requestOptions.skipAutomatic||backgroundOnly),fastNote};
        }
        const request=serverPendingRequest,token=serverSyncToken;
        rememberPendingWrite(request);
        const controller=typeof AbortController==='function'?new AbortController():null;
        const timeout=setTimeout(()=>controller?.abort(),15000);
        let response, payload;
        try {
          const options={method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({requestId:request.requestId,changes:request.changes,skipAutomatic:request.skipAutomatic===true,fastNote:request.fastNote===true})};
          if(controller)options.signal=controller.signal;
          response=await fetch(`${webhookApiBase()}/api/state`,options);
          payload=await response.json();
        } finally {
          clearTimeout(timeout);
        }
        if(token!==serverSyncToken)return false;
        if(!response.ok){
          // 20 người cùng sửa: 409/403 thường chỉ do bản ghi vừa đổi ở máy khác (hoặc khách vừa chuyển người).
          // Tải bản mới, gộp lại các ô mình sửa rồi gửi lại thay vì khóa cả phiên lưu đến khi F5.
          if([403,409].includes(response.status)&&rebaseAttempts<3){
            rebaseAttempts++;serverPendingRequest=null;forgetPendingWrite();
            if(await rebaseOnServer(token))continue;
            throw new Error(payload.error||`HTTP ${response.status}`);
          }
          if([400,403,409,413].includes(response.status)){serverConflict=true;serverPendingRequest=null;}
          if(response.status===401){await endSession(true);setSaveStatus('Phiên hết hạn. Bản nháp vẫn được giữ theo tài khoản.',true);}
          throw new Error(payload.error||`HTTP ${response.status}`);
        }
        applyServerSnapshot(payload,request.snapshot);serverPendingRequest=null;
        forgetPendingWrite();
      }while(hasServerChanges());
      serverSaveError='';setSaveStatus('Đã lưu MySQL');return true;
    }catch(error){serverSaveError=error.message||'Lỗi kết nối máy chủ';setSaveStatus(serverSaveError+' — chưa lưu, giữ trang mở',true);return false;}
    finally{serverSaveRunning=false;}
  })();
  try{return await serverSavePromise;}finally{serverSavePromise=null;}
}
function startServerSyncPolling(){stopServerSyncPolling();serverSyncTimer=setInterval(()=>{if(!document.hidden&&currentAccount&&serverSyncToken){syncServerState();refreshNavigationCounts();}},15000);serverVersionTimer=setInterval(checkServerVersion,5000);}
function stopServerSyncPolling(){if(serverSyncTimer)clearInterval(serverSyncTimer);serverSyncTimer=null;if(serverVersionTimer)clearInterval(serverVersionTimer);serverVersionTimer=null;serverVersionSeen='';}
// Vòng 15 giây vẫn giữ làm lưới an toàn (webhook, chia tự động...). Vòng 5 giây chỉ hỏi số phiên bản:
// Sale đổi trạng thái thì Leader/Manager/Admin thấy sau vài giây thay vì 15–30 giây.
let serverVersionTimer=null,serverVersionSeen='',serverVersionReading=false;
async function checkServerVersion(){
  if(document.hidden||!currentAccount||!serverSyncToken||!serverStateLoaded||serverVersionReading)return;
  serverVersionReading=true;
  try{
    const response=await fetch(webhookApiBase()+'/api/state/version',{headers:{Authorization:'Bearer '+serverSyncToken},cache:'no-store'});
    if(!response.ok)return;
    const {version}=await response.json();
    const changed=serverVersionSeen&&version!==serverVersionSeen;serverVersionSeen=version;
    if(changed&&await syncServerState()){try{if(window.parent&&window.parent!==window)window.parent.dispatchEvent(new Event('crm:state-changed'));}catch{}}
  }catch(error){}finally{serverVersionReading=false;}
}
async function refreshNavigationCounts() {
  if(!serverSyncToken||currentAccount?.role!=='ADMIN'||navigationCountsReading)return false;
  navigationCountsReading=true;
  try{
    const response=await fetch(`${webhookApiBase()}/api/navigation-counts`,{headers:{Authorization:`Bearer ${serverSyncToken}`},cache:'no-store'});
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error||'Không đọc được số thông báo');
    const next={data:Number(payload.data||0),team:Number(payload.team||0)};
    const changed=!liveNavigationCounts||next.data!==liveNavigationCounts.data||next.team!==liveNavigationCounts.team;
    liveNavigationCounts=next;
    // Chỉ vẽ lại menu; form/modal Admin đang thao tác được giữ nguyên.
    if(changed&&$('#sideNav')&&$('#mobileNav'))renderNavigation();
    return true;
  }catch(error){return false;}finally{navigationCountsReading=false;}
}
let serverReadPromise = null;
function syncServerState() {
  if (serverReadPromise) return serverReadPromise;
  serverReadPromise = readServerState().finally(() => { serverReadPromise = null; });
  return serverReadPromise;
}
async function readServerState() {
  if(!serverSyncToken||!currentAccount||serverReading||serverSaveRunning||serverSaveTimer||serverConflict)return false;
  if(serverStateLoaded&&(serverPendingRequest||hasServerChanges()))return flushServerPersistence();
  if(serverStateLoaded&&($('#modalRoot')?.children.length||$('#drawerRoot')?.children.length||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)))return false;
  serverReading=true;const wasLoaded=serverStateLoaded,version=serverMutationVersion,token=serverSyncToken;
  try{
    const controller=typeof AbortController==='function'?new AbortController():null;
    const timeout=controller?setTimeout(()=>controller.abort(),WEBHOOK_FETCH_TIMEOUT_MS):null;
    let response,payload;
    try{response=await fetch(webhookApiBase()+'/api/state?passive=1',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:controller?controller.signal:undefined});payload=await response.json();}
    finally{if(timeout)clearTimeout(timeout);}
    if(response.status===401&&token===serverSyncToken){await endSession(true);return false;}
    if(!response.ok)throw new Error(payload.error||'Không tải được dữ liệu');
    if(version!==serverMutationVersion||token!==serverSyncToken||(serverStateLoaded&&hasServerChanges()))return false;
    const before=stableJson(state),attendanceBefore=stableJson(state.attendance);applyServerSnapshot(payload);
    // Điểm danh Telegram vừa vào SQL: cập nhật trang mẹ ngay, không chờ thêm lượt vẽ.
    if(wasLoaded&&attendanceBefore!==stableJson(state.attendance)){
      try{if(window.parent&&window.parent!==window)window.parent.dispatchEvent(new Event('crm:session-changed'));}catch{}
    }
    setSaveStatus('Đã đồng bộ MySQL');
    if(wasLoaded&&before!==stableJson(state)&&!$('#modalRoot')?.children.length&&!$('#drawerRoot')?.children.length&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))render();
    return true;
  }catch(error){setSaveStatus(error.message,true);return false;}finally{serverReading=false;}
}
// Tất cả thao tác đi qua một giao dịch, bao gồm lịch sử và phân công liên quan.
async function pushServerRecord(resource,method,id,record) {
  if(!serverStateLoaded||!serverSyncToken){setSaveStatus('Chưa kết nối MySQL',true);return false;}
  const key=resource==='users'?'members':resource;
  if(!SERVER_LISTS.includes(key))return false;
  const recordId=id||record.id;
  if(method==='DELETE')state[key]=state[key].filter(r=>r.id!==recordId);
  else {
    const old=state[key].find(r=>r.id===recordId)||state.registeredAccounts.find(r=>r.id===recordId)||{};
    const next={...old,...record,id:recordId};
    state[key]=state[key].filter(r=>r.id!==recordId);state[key].push(next);
    if(key==='members')state.registeredAccounts=state.registeredAccounts.filter(r=>r.id!==recordId);
  }
  serverMutationVersion++;return flushServerPersistence();
}
async function persistCustomer(customer){return pushServerRecord('customers','PUT',customer.id,customer);}
async function persistOrder(order){return pushServerRecord('orders','PUT',order.id,order);}
function makeRecordId(prefix){const bytes=new Uint8Array(12);crypto.getRandomValues(bytes);return `${prefix}-${Date.now()}-${Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}`;}
function legacyProductCandidates(){
  const found=[],seen=new Set();
  try{
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);if(!key||!key.startsWith('nvt'))continue;
      let raw;try{raw=JSON.parse(localStorage.getItem(key));}catch{continue;}
      const sources=[raw,raw?.state,...Object.values(raw?.data||{})];
      for(const source of sources){
        if(!source||!Array.isArray(source.products))continue;
        for(const item of source.products){
          const name=cleanText(item?.name,'',200).trim(),price=Number(item?.price);
          if(!name||!Number.isFinite(price)||price<0)continue;
          const sourceId=cleanId(item.id),sku=cleanText(item.sku,'',60).trim();
          const identity=sourceId||`sku:${normalize(sku)}`||`name:${normalize(name)}`;
          if(seen.has(identity))continue;seen.add(identity);
          found.push({id:sourceId||makeRecordId('PRD-LEGACY'),name,sku,category:cleanText(item.category,'Dịch vụ khác',100).trim()||'Dịch vụ khác',price,type:item.type==='RENTAL'?'RENTAL':'SALE',rentalMonths:item.type==='RENTAL'&&[1,3,6,12].includes(Number(item.rentalMonths))?Number(item.rentalMonths):null,active:item.active!==false,createdAt:cleanTimestamp(item.createdAt,stamp())});
        }
      }
    }
  }catch(error){return [];}
  const existingIds=new Set(state.products.map(item=>item.id));
  const existingSku=new Set(state.products.map(item=>normalize(item.sku)).filter(Boolean));
  const existingNames=new Set(state.products.map(item=>normalize(item.name)));
  return found.filter(item=>!existingIds.has(item.id)&&!(item.sku&&existingSku.has(normalize(item.sku)))&&!existingNames.has(normalize(item.name)));
}
async function restoreLegacyProducts(){
  if(currentAccount?.role!=='ADMIN')return;
  const products=legacyProductCandidates();
  if(!products.length){toast('Không tìm thấy sản phẩm cũ chưa có trên MySQL trong trình duyệt này');return;}
  if(!confirm(`Tìm thấy ${products.length} sản phẩm cũ. Thêm các sản phẩm này vào MySQL? Dữ liệu cũ trong trình duyệt vẫn được giữ nguyên.`))return;
  for(const product of products){
    state.products.push(product);
    if(!state.productCategories.includes(product.category))state.productCategories.push(product.category);
  }
  PRODUCTS=state.products;audit('RESTORE_LEGACY_PRODUCTS','PRODUCTS',`${products.length} sản phẩm từ trình duyệt cũ`);saveState();render();
  if(await flushServerPersistence()){toast(`Đã khôi phục ${products.length} sản phẩm vào MySQL`);return;}
  // Giữ cùng requestId và bản nháp để có thể retry an toàn khi mất phản hồi sau lúc MySQL đã commit.
  toast('Chưa xác nhận được MySQL. Giữ trang mở và bấm Đồng bộ máy chủ để thử lại');
}
function refreshTaskStatuses() {
  state.tasks.forEach(task => {
    if (task.slaBased && task.createdAt) task.dueAt = shiftStamp(task.createdAt, state.settings.slaMinutes);
    if (task.status !== 'DONE') task.status = String(task.dueAt) < stamp() ? 'OVERDUE' : 'OPEN';
  });
}

function scopeSaleIds() {
  if (!currentAccount) return [];
  if (effectivePermissionRole() === 'MANAGER') {
    const scope = managerScope();
    return scope.sales.map(person => person.id);
  }
  if (currentAccount.scope === 'ALL') return activeStaff().filter(person => person.role === 'SALE').map(person => person.id);
  if (currentAccount.scope === 'TEAM') return activeStaff().filter(person => person.role === 'SALE' && person.teamId === currentAccount.teamId && person.leaderId === currentAccount.leaderId).map(person => person.id);
  return [currentAccount.saleId];
}

function effectivePermissionRole() {
  if (!currentAccount) return '';
  if (currentAccount.role === 'ADMIN' || currentAccount.actualRole === 'ADMIN') return 'ADMIN';
  if (currentAccount.actualRole === 'MANAGER') return 'MANAGER';
  if (currentAccount.role === 'HRM' || currentAccount.actualRole === 'HRM') return 'HRM';
  // Manager được hydrate thành role Leader để dùng giao diện Team. Nếu một
  // snapshot cũ thiếu actualRole, nhận diện lại từ bản ghi nhân sự thật.
  const manager = STAFF.find(person => person.role === 'MANAGER' && (
    person.id === currentAccount.id ||
    (currentAccount.accountId && person.accountId === currentAccount.accountId)
  ));
  return manager ? 'MANAGER' : currentAccount.role;
}

/* Manager có thể đăng nhập bằng bản ghi tài khoản đã hydrate lại role hiển thị
   thành LEADER. Luôn tìm lại bản ghi Manager thật trước khi dựng phạm vi quyền. */
function managerScope() {
  if (!currentAccount || effectivePermissionRole() !== 'MANAGER') {
    return { manager: null, leaders: [], sales: [], leaderIds: new Set(), saleIds: new Set() };
  }
  const manager = activeStaff().find(person => person.role === 'MANAGER' && (
    person.id === currentAccount.id ||
    (currentAccount.accountId && person.accountId === currentAccount.accountId)
  )) || (currentAccount.id ? { ...currentAccount, role: 'MANAGER' } : null);
  const managerId = manager?.id || currentAccount.id;
  const leaders = activeStaff().filter(person => person.role === 'LEADER' && person.managerId === managerId);
  const leaderIds = new Set(leaders.map(person => person.id));
  const sales = activeStaff().filter(person => person.role === 'SALE' && (
    person.managerId === managerId || person.leaderId === managerId || leaderIds.has(person.leaderId)
  ));
  return { manager, leaders, sales, leaderIds, saleIds: new Set(sales.map(person => person.id)) };
}

function managerAssignmentRecipients() {
  const scope = managerScope();
  if (!scope.manager) return [];
  return [
    { ...scope.manager, role: 'MANAGER', actualRole: 'MANAGER', managerRecipient: true },
    ...scope.leaders,
    ...scope.sales
  ];
}

function managerCanAccessCustomer(customer) {
  if (!customer || effectivePermissionRole() !== 'MANAGER') return false;
  const scope = managerScope();
  const managerId = scope.manager?.id || currentAccount.id;
  const leader = activeStaff().find(person => person.role === 'LEADER' && person.id === customer.leaderId);
  const sale = activeStaff().find(person => person.role === 'SALE' && person.id === customer.saleId);
  return customer.managerId === managerId
    || customer.ownerId === managerId
    || scope.leaderIds.has(customer.leaderId)
    || scope.saleIds.has(customer.saleId)
    || leader?.managerId === managerId
    || sale?.managerId === managerId
    || scope.leaderIds.has(sale?.leaderId);
}

function scopedCustomers() {
  const saleIds = scopeSaleIds();
  if (effectivePermissionRole() === 'MANAGER') {
    return state.customers.filter(managerCanAccessCustomer);
  }
  if (currentAccount.scope === 'ALL') return state.customers;
  if (currentAccount.scope === 'TEAM') return state.customers.filter(customer => customer.teamId === currentAccount.teamId && customer.leaderId === currentAccount.leaderId);
  // Sale ownership is authoritative. Older imports and direct-manager assignments
  // may not have a matching team/leader path, but must remain visible to the owner.
  if (currentAccount.scope === 'OWN') return state.customers.filter(customer => {
    if (saleIds.includes(customer.saleId)) return true;
    return currentAccount.saleId && state.dataOffers.some(o => o.customerId === customer.id && o.saleId === currentAccount.saleId && o.status === 'PENDING');
  });
  return state.customers.filter(customer => {
    if (customer.teamId !== currentAccount.teamId || customer.leaderId !== currentAccount.leaderId) return false;
    if (saleIds.includes(customer.saleId)) return true;
    return currentAccount.saleId && state.dataOffers.some(o => o.customerId === customer.id && o.saleId === currentAccount.saleId && o.status === 'PENDING');
  });
}

/* Luật hết hạn nhận data đã chuyển sang offer: quá 24 giờ thì
   khách GIỮ leader/team và saleId null (trả về leader đã chia), không đẩy lên phễu
   Admin. Hàm cũ được giữ làm alias để không còn hai luật song song. */


function scopedOrders() {
  const ids = scopeSaleIds();
  if (currentAccount?.actualRole === 'MANAGER') {
    const leaderIds = new Set(activeStaff().filter(person => person.role === 'LEADER' && person.managerId === currentAccount.id).map(person => person.id));
    return state.orders.filter(order => leaderIds.has(order.leaderId) || ids.includes(order.saleId) || order.managerId === currentAccount.id);
  }
  if (currentAccount.scope === 'ALL') return state.orders;
  if (currentAccount.scope === 'TEAM') return state.orders.filter(order => order.teamId === currentAccount.teamId && order.leaderId === currentAccount.leaderId);
  return state.orders.filter(order => ids.includes(order.saleId) && order.teamId === currentAccount.teamId && order.leaderId === currentAccount.leaderId);
}
function scopedTasks() {
  const ids = scopeSaleIds();
  if (currentAccount?.actualRole === 'MANAGER') {
    const leaderIds = new Set(activeStaff().filter(person => person.role === 'LEADER' && person.managerId === currentAccount.id).map(person => person.id));
    return state.tasks.filter(task => leaderIds.has(task.leaderId) || ids.includes(task.ownerId) || task.managerId === currentAccount.id);
  }
  if (currentAccount.scope === 'ALL') return state.tasks;
  if (currentAccount.scope === 'TEAM') return state.tasks.filter(task => task.teamId === currentAccount.teamId && task.leaderId === currentAccount.leaderId);
  return state.tasks.filter(task => ids.includes(task.ownerId) && task.teamId === currentAccount.teamId && task.leaderId === currentAccount.leaderId);
}
function scopedTraffic() {
  const ids = scopeSaleIds();
  if (currentAccount?.actualRole === 'MANAGER') {
    const leaderIds = new Set(activeStaff().filter(person => person.role === 'LEADER' && person.managerId === currentAccount.id).map(person => person.id));
    return state.traffic.filter(event => leaderIds.has(event.leaderId) || ids.includes(event.saleId) || event.managerId === currentAccount.id);
  }
  if (currentAccount.scope === 'ALL') return state.traffic;
  if (currentAccount.scope === 'TEAM') return state.traffic.filter(event => event.teamId === currentAccount.teamId && event.leaderId === currentAccount.leaderId);
  return [];
}
function canViewCustomer(customer) { return !!customer && scopedCustomers().includes(customer); }
function isPoolCustomer(customer) {
  if (!customer || !currentAccount) return false;
  if (isManualCustomer(customer)) return false;
  if (currentAccount.role === 'ADMIN') return customer.saleId === null && customer.leaderId === null && customer.teamId === null;
  return currentAccount.role === 'LEADER' && !state.dataOffers.some(o=>o.customerId===customer.id&&o.status==='PENDING') && customer.saleId === null && customer.leaderId === currentAccount.leaderId && customer.teamId === currentAccount.teamId;
}
function isManualCustomer(customer) {
  const source = normalize(customer?.source);
  return customer?.manualEntry === true || source === 'khachhangcu' || source === 'khachhangngoaidata';
}
function isWebhookIntakeCustomer(customer) { return !!customer && !isManualCustomer(customer); }
function slaBreachedCustomers() {
  const overdueCustomerIds = new Set(scopedTasks().filter(task => task.slaBased && task.status === 'OVERDUE').map(task => task.customerId));
  return scopedCustomers().filter(customer => overdueCustomerIds.has(customer.id));
}

function shiftDate(date, days) {
  const [year, month, day] = String(date).split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function inclusiveDays(start, end) {
  const startTime = new Date(`${start}T00:00:00Z`).getTime();
  const endTime = new Date(`${end}T00:00:00Z`).getTime();
  return Math.floor((endTime - startTime) / 86400000) + 1;
}

function currentPeriodBounds() {
  if (datePreset === 'CUSTOM') return { start: customDateStart, end: customDateEnd, days: inclusiveDays(customDateStart, customDateEnd) };
  return { start: dayIso(dateRange - 1), end: dayIso(0), days: dateRange };
}

function previousPeriodBounds() {
  const current = currentPeriodBounds();
  const end = shiftDate(current.start, -1);
  return { start: shiftDate(end, -(current.days - 1)), end, days: current.days };
}

function formatPeriodDate(value) { return value.split('-').reverse().join('/'); }
function periodLabel() {
  const bounds = currentPeriodBounds();
  return bounds.days === 1 ? `Hôm nay · ${formatPeriodDate(bounds.end)}` : `${formatPeriodDate(bounds.start)} - ${formatPeriodDate(bounds.end)}`;
}
function periodFileToken() { const bounds = currentPeriodBounds(); return `${bounds.start}_${bounds.end}`; }

function inCurrentPeriod(value) {
  const { start, end } = currentPeriodBounds();
  return dateOnly(value) >= start && dateOnly(value) <= end;
}

function inPreviousPeriod(value) {
  const { start, end } = previousPeriodBounds();
  return dateOnly(value) >= start && dateOnly(value) <= end;
}

function isPaymentInPeriod(order, periodCheck) { return !!order.paidAt && (!periodCheck || periodCheck(order.paidAt)); }
function isRefundInPeriod(order, periodCheck) { return !!order.refundedAt && (!periodCheck || periodCheck(order.refundedAt)); }
// Thực thu đã bao gồm VAT trong `total`; không cộng VAT lần nữa cho đơn mới.
// Với dữ liệu cũ chỉ lưu amountPaid trước VAT, total là giới hạn an toàn.
function orderGrossCollected(order) {
  if(order?.receiptsVersion===1)return OrderPayments.paid(order);
  const total = Math.max(0, Number(order?.total || 0));
  const paid = Number(order?.amountPaid);
  if (order?.status === 'DEPOSIT') return Math.min(total, Math.max(0, Number(order.depositAmount || 0)));
  if (Number.isFinite(paid) && paid > 0) {
    const subtotal = Math.max(0, Number(order?.subtotal || 0));
    const vat = Math.max(0, Number(order?.vatAmount || 0));
    const legacyNetPayment = ['PAID', 'COURSE_GRANTED', 'REFUNDED'].includes(order?.status) && !order?.depositAt && subtotal > 0 && paid < subtotal;
    return Math.min(total, paid + (legacyNetPayment ? vat : 0));
  }
  if (['PAID', 'COURSE_GRANTED', 'REFUNDED'].includes(order?.status)) {
    const refund = Math.max(0, Number(order?.refund || 0));
    return Math.min(total, refund || total);
  }
  return 0;
}
function orderNetCollected(order) {
  return Math.max(0, orderGrossCollected(order) - Math.max(0, Number(order?.refund || 0)));
}
function orderFinancialEvents(order) {
  return OrderPayments.events(order);
}
function netRevenue(orders, periodCheck = null) {
  return orders.flatMap(orderFinancialEvents).filter(event => !periodCheck || periodCheck(event.occurredAt)).reduce((sum, event) => sum + event.amount, 0);
}
function paidOrders(orders, periodCheck = null) { return orders.filter(order => isPaymentInPeriod(order, periodCheck)); }
function financialEvents(orders, periodCheck = null) {
  return orders.flatMap(orderFinancialEvents).filter(event => !periodCheck || periodCheck(event.occurredAt));
}
function orderEditState(order) {
  if (['MARKETING', 'ACCOUNTING', 'HRM'].includes(currentAccount.role)) return { allowed: false, label: 'Chỉ có quyền xem' };
  if (currentAccount.role === 'ADMIN') return { allowed: true, label: 'Admin toàn quyền' };
  const raw = String(order.createdAt || '').trim();
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const created = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}+07:00`);
  const remaining = 3 * 24 * 60 * 60 * 1000 - (Date.now() - created);
  if (!Number.isFinite(created) || remaining <= 0) return { allowed: false, label: 'Đã khóa chỉnh sửa' };
  const days = Math.floor(remaining / 86400000), hours = Math.floor((remaining % 86400000) / 3600000);
  return { allowed: true, label: `Còn ${days} ngày ${hours} giờ` };
}
function delta(current, previous) { return previous ? ((current - previous) / previous) * 100 : current ? 100 : 0; }
function deltaBadge(value) { const cls = value >= 0 ? 'up' : 'down'; return `<span class="delta ${cls}">${value >= 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}%</span>`; }

function statusBadge(status, type = 'customer') {
  if (type === 'order') { const meta = ORDER_STATUS[status] || [status, 'info']; return `<span class="status status-${meta[1]}">${escapeHtml(meta[0])}</span>`; }
  if (type === 'task') { const labels = { OPEN: ['Đang mở', 'open'], OVERDUE: ['Quá hạn', 'cancelled'], DONE: ['Hoàn tất', 'done'] }; const meta = labels[status] || [status, 'info']; return `<span class="status status-${escapeHtml(meta[1])}">${escapeHtml(meta[0])}</span>`; }
  const meta = STATUS_META[status] || { label: status, color: '#687771' };
  return `<span class="status" style="background:${meta.color}18;color:${meta.color}">${escapeHtml(meta.label)}</span>`;
}

function audit(action, entity, detail) {
  state.audit.unshift({ id: makeRecordId('AUD'), actorId: currentAccount.id, actor: currentAccount.name, role: currentAccount.actualRole||currentAccount.role, action, entity, detail, ip: currentAccount.ip || sessionIp('127.0.0.1'), at: stamp() });
}

function toast(message) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.textContent = serverStateLoaded && (hasServerChanges() || serverSaveRunning) ? `Đang lưu: ${message}` : message;
  $('#toastRoot').append(element);
  setTimeout(() => element.remove(), 3200);
}

function pageHead(title, description, actions = '') {
  return `<div class="page-head headline-row"><div><h1>${escapeHtml(title)}</h1></div><div class="head-actions">${actions}</div></div>`;
}

function dateFilter() {
  const presets = [[1, 'Hôm nay'], [7, '7 ngày'], [15, '15 ngày'], [30, '30 ngày']];
  return `<div class="filter-bar"><span class="filter-label">Thời gian</span><div class="segmented">${presets.map(([days, label]) => `<button class="segment ${datePreset !== 'CUSTOM' && dateRange === days ? 'active' : ''}" data-range="${days}" type="button">${label}</button>`).join('')}</div><div class="custom-date-range ${datePreset === 'CUSTOM' ? 'active' : ''}"><label style="cursor:pointer;" onclick="this.querySelector('input')?.showPicker && this.querySelector('input')?.showPicker()">Từ ngày <input id="customDateStart" class="native-date-picker" type="date" value="${escapeHtml(customDateStart)}" max="${escapeHtml(dayIso(0))}" onclick="event.stopPropagation(); this.showPicker && this.showPicker();"> 📅</label><span>→</span><label style="cursor:pointer;" onclick="this.querySelector('input')?.showPicker && this.querySelector('input')?.showPicker()">Đến ngày <input id="customDateEnd" class="native-date-picker" type="date" value="${escapeHtml(customDateEnd)}" max="${escapeHtml(dayIso(0))}" onclick="event.stopPropagation(); this.showPicker && this.showPicker();"> 📅</label><button class="button button-small" id="applyCustomDate" type="button">Áp dụng</button></div><span class="scope-chip period-chip" style="color:var(--ink);background:var(--panel-2)">${escapeHtml(periodLabel())}</span></div>`;
}

function applyCustomDateRange() {
  const start = $('#customDateStart')?.value;
  const end = $('#customDateEnd')?.value;
  const validDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!validDate(start) || !validDate(end) || start > end || end > dayIso(0)) { toast('Khoảng ngày không hợp lệ hoặc vượt quá hôm nay'); return false; }
  const days = inclusiveDays(start, end);
  if (days < 1 || days > 366) { toast('Khoảng tùy chọn tối đa 366 ngày'); return false; }
  customDateStart = start;
  customDateEnd = end;
  dateRange = days;
  datePreset = 'CUSTOM';
  render();
  return true;
}

function periodSnapshot(previous = false) {
  const periodCheck = previous ? inPreviousPeriod : inCurrentPeriod;
  const allOrders = scopedOrders();
  const orders = allOrders.filter(order => periodCheck(order.createdAt));
  const transactions = financialEvents(allOrders, periodCheck);
  const traffic = scopedTraffic().filter(event => periodCheck(event.date));
  const customers = scopedCustomers().filter(customer => periodCheck(customer.createdAt));
  const paid = paidOrders(allOrders, periodCheck);
  const refunds = allOrders.filter(order => isRefundInPeriod(order, periodCheck));
  const revenue = netRevenue(allOrders, periodCheck);
  const sessions = traffic.reduce((sum, event) => sum + event.sessions, 0);
  const trackedLeads = traffic.reduce((sum, event) => sum + event.leads, 0);
  const leads = customers.length;
  const units = paid.reduce((sum, order) => sum + order.qty, 0);
  const periodCustomerIds = new Set(customers.map(customer => customer.id));
  const paidCustomerIds = new Set(paid.filter(order => periodCustomerIds.has(order.customerId)).map(order => order.customerId));
  return { orders, transactions, traffic, customers, paid, refunds, revenue, sessions, trackedLeads, leads, units, convertedCustomers: paidCustomerIds.size, aov: paid.length ? Math.round(revenue / paid.length) : 0, conversion: leads ? (paidCustomerIds.size / leads) * 100 : 0 };
}

function kpiCard(icon, label, value, sub, change) {
  return `<article class="kpi"><div class="kpi-top"><span>${escapeHtml(label)}</span><span class="kpi-icon">${icon}</span></div><strong class="num">${escapeHtml(value)}</strong><small>${escapeHtml(sub)}</small>${typeof change === 'number' ? `<div style="margin-top:8px">${deltaBadge(change)}</div>` : ''}</article>`;
}

function dailySeries() {
  const orders = scopedOrders();
  const bounds = currentPeriodBounds();
  return Array.from({ length: bounds.days }, (_, index) => {
    const date = shiftDate(bounds.start, index);
    const dayCheck = value => dateOnly(value) === date;
    const paid = paidOrders(orders, dayCheck);
    const refunds = orders.filter(order => isRefundInPeriod(order, dayCheck));
    return {
      date,
      revenue: netRevenue(orders, dayCheck),
      gross: paid.reduce((sum, order) => sum + order.subtotal, 0),
      discount: paid.reduce((sum, order) => sum + order.discount, 0),
      refunds: refunds.reduce((sum, order) => sum + order.refund, 0),
      orders: paid.length,
      units: paid.reduce((sum, order) => sum + order.qty, 0)
    };
  });
}

function revenueChart(series, height = 280) {
  if (!series.length || series.every(item => item.revenue === 0 && item.gross === 0 && item.refunds === 0 && item.orders === 0)) return `<div class="empty"><b>Chưa có dữ liệu</b><span>Không có giao dịch trong khoảng đã chọn.</span></div>`;
  const width = 820, padLeft = 52, padRight = 20, padTop = 24, padBottom = 42;
  const innerWidth = width - padLeft - padRight, innerHeight = height - padTop - padBottom;
  let max = Math.max(...series.map(item => item.revenue), 0);
  let min = Math.min(...series.map(item => item.revenue), 0);
  if (max === 0 && min === 0) max = Math.max(...series.map(item => Math.max(item.gross - item.discount, item.refunds)), 1);
  const span = Math.max(max - min, 1);
  const yFor = value => padTop + ((max - value) / span) * innerHeight;
  const baseline = yFor(0);
  const points = series.map((item, index) => ({ ...item, x: padLeft + (series.length === 1 ? innerWidth / 2 : (index / (series.length - 1)) * innerWidth), y: yFor(item.revenue) }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${baseline.toFixed(1)} L${points[0].x.toFixed(1)},${baseline.toFixed(1)} Z`;
  const labelsEvery = Math.max(1, Math.ceil(series.length / 7));
  return `<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Biểu đồ doanh thu từng ngày">
    <defs><linearGradient id="revenueArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e8572a" stop-opacity=".28"></stop><stop offset="100%" stop-color="#e8572a" stop-opacity="0"></stop></linearGradient></defs>
    ${[0, .25, .5, .75, 1].map(step => { const y = padTop + innerHeight * step; const value = max - span * step; return `<line class="chart-grid" x1="${padLeft}" x2="${width - padRight}" y1="${y}" y2="${y}"></line><text class="chart-value" x="${padLeft - 8}" y="${y + 3}" text-anchor="end">${escapeHtml(money(value, true))}</text>`; }).join('')}
    <path class="chart-area" d="${area}"></path><path class="chart-line" d="${line}"></path>
    ${points.map((point, index) => `<g><circle class="chart-point" cx="${point.x}" cy="${point.y}" r="4"><title>${point.date}: ${money(point.revenue)} · ${point.orders} đơn</title></circle>${index % labelsEvery === 0 || index === points.length - 1 ? `<text class="chart-label" x="${point.x}" y="${height - 14}" text-anchor="middle">${point.date.slice(5).split('-').reverse().join('/')}</text>` : ''}</g>`).join('')}
  </svg></div>`;
}

function productPerformance(orders) {
  const map = new Map(PRODUCTS.map(product => [product.id, { ...product, units: 0, paidOrders: 0, revenue: 0, refunds: 0, previousRevenue: 0 }]));
  orders.forEach(order => {
    const item = map.get(order.productId);
    if (!item) return;
    if (isPaymentInPeriod(order, inCurrentPeriod)) { item.units += order.qty; item.paidOrders += 1; item.revenue += order.total; }
    if (isRefundInPeriod(order, inCurrentPeriod)) { item.refunds += 1; item.revenue -= order.refund; }
    if (isPaymentInPeriod(order, inPreviousPeriod)) item.previousRevenue += order.total;
    if (isRefundInPeriod(order, inPreviousPeriod)) item.previousRevenue -= order.refund;
  });
  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

function sourcePerformance() {
  const traffic = scopedTraffic();
  const orders = scopedOrders();
  const customers = scopedCustomers();
  const catalog = new Map();
  const register = (source, campaign, medium = '', color = '') => {
    const canonicalSource = orderSource(source);
    const canonicalCampaign = cleanText(campaign, 'UNATTRIBUTED', 160) || 'UNATTRIBUTED';
    const meta = TRAFFIC_META.find(item => item.source === canonicalSource);
    const key = `${canonicalSource}\u0000${canonicalCampaign}`;
    if (!catalog.has(key)) catalog.set(key, { source: canonicalSource, campaign: canonicalCampaign, medium: medium || meta?.medium || 'unattributed', color: color || meta?.color || '#687771', spend: 0 });
  };
  traffic.filter(event => inCurrentPeriod(event.date)).forEach(event => register(event.source, event.campaign, event.medium, event.color));
  customers.filter(customer => inCurrentPeriod(customer.createdAt)).forEach(customer => register(customer.source, customer.campaign));
  orders.filter(order => isPaymentInPeriod(order, inCurrentPeriod) || isRefundInPeriod(order, inCurrentPeriod)).forEach(order => register(order.source, order.campaign));
  return Array.from(catalog.values()).map(meta => {
    const events = traffic.filter(event => event.source === meta.source && event.campaign === meta.campaign && inCurrentPeriod(event.date));
    const sourceOrders = orders.filter(order => order.source === meta.source && (order.campaign || 'UNATTRIBUTED') === meta.campaign);
    const paid = paidOrders(sourceOrders, inCurrentPeriod);
    const sessions = currentAccount.role === 'ADMIN' ? events.reduce((sum, event) => sum + event.sessions, 0) : 0;
    const trackedLeads = currentAccount.role === 'ADMIN' ? events.reduce((sum, event) => sum + event.leads, 0) : 0;
    const matchingCustomers = customers.filter(customer => inCurrentPeriod(customer.createdAt) && orderSource(customer.source) === meta.source && (customer.campaign || 'UNATTRIBUTED') === meta.campaign);
    const leads = matchingCustomers.length;
    const spend = currentAccount.role === 'ADMIN' ? events.reduce((sum, event) => sum + event.spend, 0) : 0;
    const revenue = netRevenue(sourceOrders, inCurrentPeriod);
    const periodCustomerIds = new Set(matchingCustomers.map(customer => customer.id));
    const convertedCustomers = new Set(paid.filter(order => periodCustomerIds.has(order.customerId)).map(order => order.customerId)).size;
    return { ...meta, sessions, trackedLeads, leads, paidOrders: paid.length, convertedCustomers, revenue, spend, leadRate: sessions ? trackedLeads / sessions * 100 : 0, crmCaptureRate: trackedLeads ? leads / trackedLeads * 100 : 0, orderRate: leads ? convertedCustomers / leads * 100 : 0, roas: spend ? revenue / spend : null };
  }).sort((a, b) => b.revenue - a.revenue);
}

function websiteRevenuePerformance() {
  const customers = scopedCustomers();
  const rows = new Map(state.websites.map(website => [website.id, { id: website.id, name: website.name, domain: website.domain, data: 0, paidOrders: 0, gross: 0, refunds: 0, net: 0 }]));
  const unattributed = { id: 'UNATTRIBUTED', name: 'Chưa quy nguồn', domain: 'Thiếu website/landing snapshot', data: 0, paidOrders: 0, gross: 0, refunds: 0, net: 0 };
  const resolveRow = websiteId => rows.get(websiteId) || unattributed;
  customers.filter(customer => inCurrentPeriod(customer.createdAt)).forEach(customer => { resolveRow(customer.websiteId).data += 1; });
  scopedOrders().forEach(order => {
    const row = resolveRow(order.websiteId);
    if (isPaymentInPeriod(order, inCurrentPeriod)) { row.paidOrders += 1; row.gross += order.total; row.net += order.total; }
    if (isRefundInPeriod(order, inCurrentPeriod)) { row.refunds += order.refund; row.net -= order.refund; }
  });
  const result = Array.from(rows.values()).filter(row => row.data || row.paidOrders || row.refunds || row.net);
  if (unattributed.data || unattributed.paidOrders || unattributed.refunds || unattributed.net) result.push(unattributed);
  return result.sort((a, b) => b.net - a.net || b.data - a.data);
}


function distributionDonut(rows, metric, label) {
  const rawTotal = rows.reduce((sum, row) => sum + row[metric], 0);
  const total = rawTotal || 1;
  let cursor = 0;
  const stops = rows.map(row => { const start = cursor; cursor += row[metric] / total * 100; return `${row.color} ${start.toFixed(1)}% ${cursor.toFixed(1)}%`; }).join(',');
  const background = rawTotal ? `conic-gradient(${stops})` : 'var(--panel-2)';
  return `<div class="donut-layout"><div class="donut" style="background:${background}"><div class="donut-center"><b>${number(rawTotal)}</b><small>${escapeHtml(label)}</small></div></div><div class="legend">${rows.slice(0, 8).map(row => `<div class="legend-row"><i style="background:${row.color}"></i><span>${escapeHtml(row.name || row.source)}</span><b>${rawTotal ? ((row[metric] / rawTotal) * 100).toFixed(1).replace('.', ',') : '0,0'}%</b></div>`).join('')}</div></div>`;
}

function trafficDonut(rows) {
  return distributionDonut(rows, currentAccount.role === 'ADMIN' ? 'sessions' : 'leads', currentAccount.role === 'ADMIN' ? 'phiên truy cập' : 'data mới');
}

function saleDashboardView(current, previous) {
  const customers = scopedCustomers();
  return pageHead(`Tổng quan · ${currentAccount.name}`, 'Sale xem doanh thu và tổng khách hàng trong đúng phạm vi được giao.') + dateFilter() +
    `<div class="kpi-grid sale-summary-grid">
      ${kpiCard('₫', 'Doanh thu của tôi', money(current.revenue, true), `${current.paid.length} lượt thanh toán · ${periodLabel()}`, delta(current.revenue, previous.revenue))}
      ${kpiCard('♙', 'Khách hàng của tôi', number(customers.length), 'Toàn bộ khách đang phụ trách')}
    </div>`;
}

function leaderDashboardView(current, previous) {
  const customers = scopedCustomers();
  const rows = salePerformanceRows();
  const newCustomers = customers.filter(isPoolCustomer).length;
  const series = dailySeries();
  return pageHead(`Tổng quan · Team ${currentAccount.teamId}`, `Leader ${currentAccount.name} xem tổng khách hàng, doanh thu và nhân sự trực thuộc.`) + dateFilter() +
    `<div class="kpi-grid leader-summary-grid">
      ${kpiCard('♙', 'Tổng khách hàng Team', number(customers.length), `Leader ${currentAccount.name}`)}
      ${kpiCard('₫', 'Doanh thu Team', money(current.revenue, true), `${current.paid.length} lượt thanh toán`, delta(current.revenue, previous.revenue))}
      ${kpiCard('↯', 'Khách mới chờ phân', number(newCustomers), 'Đang nằm trong Khách mới')}
      ${kpiCard('♧', 'Nhân sự trực thuộc', number(rows.length), `Team ${currentAccount.teamId}`)}
    </div>
    <div class="grid grid-2">
      <section class="panel"><div class="panel-head"><div><div class="panel-title">Doanh thu của Team từng ngày</div><div class="panel-sub">Toàn bộ Sale dưới quyền Leader ${escapeHtml(currentAccount.name)}</div></div></div><div class="panel-body">${revenueChart(series)}</div></section>
      <section class="panel"><div class="panel-head"><div><div class="panel-title">Leader & nhân sự trực thuộc</div><div class="panel-sub">Khách hàng và doanh thu · ${escapeHtml(periodLabel())}</div></div><button class="button button-small" data-view-jump="team">Quản lý Team</button></div><div class="panel-body"><div class="leader-card"><span class="avatar">${escapeHtml(currentAccount.initials)}</span><div><b>${escapeHtml(currentAccount.name)}</b><small>LEADER · ${escapeHtml(currentAccount.teamId)} · phụ trách ${customers.length} khách</small></div></div>${rows.map(row => `<div class="rank-row"><span class="rank">${escapeHtml(row.initials)}</span><div><b>${escapeHtml(row.name)}</b><small>${row.customers} khách · ${row.paid} lượt thanh toán</small></div><div class="rank-value"><b>${money(row.revenue, true)}</b><small>${row.conversion.toFixed(1)}% chuyển đổi</small></div></div>`).join('') || '<div class="empty"><b>Chưa có nhân sự</b><span>Team chưa có Sale trực thuộc.</span></div>'}</div></section>
    </div>`;
}

function executiveDateLabel(value) {
  const parts = String(value || '').slice(0, 10).split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : '—';
}

function executiveCustomerSeries(days = 7) {
  const customers = scopedCustomers();
  return Array.from({ length: days }, (_, index) => {
    const date = shiftDate(dayIso(0), -(days - index - 1));
    return { date, value: customers.filter(customer => dateOnly(customer.createdAt) === date).length };
  });
}

function executiveRevenueSeries(weeks = 8) {
  const orders = scopedOrders();
  const today = dayIso(0);
  return Array.from({ length: weeks }, (_, index) => {
    const start = shiftDate(today, -((weeks - index) * 7 - 1));
    const end = shiftDate(today, -((weeks - index - 1) * 7));
    const inWeek = value => dateOnly(value) >= start && dateOnly(value) <= end;
    return { label: index === weeks - 1 ? 'Tuần này' : `T${index + 1}`, value: netRevenue(orders, inWeek) };
  });
}

function executiveLineChart(series) {
  const width = 680, height = 245, left = 24, right = 22, top = 18, bottom = 34;
  const innerWidth = width - left - right, innerHeight = height - top - bottom;
  const max = Math.max(...series.map(item => item.value), 1);
  const points = series.map((item, index) => ({
    ...item,
    x: left + (series.length === 1 ? innerWidth / 2 : index / (series.length - 1) * innerWidth),
    y: top + (1 - item.value / max) * innerHeight
  }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L${points.at(-1).x.toFixed(1)},${height - bottom} L${points[0].x.toFixed(1)},${height - bottom} Z`;
  return `<div class="exec-chart-wrap"><svg class="exec-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Tăng trưởng khách hàng mới theo ngày">
    ${[.2, .5, .8].map(step => `<line x1="${left}" x2="${width - right}" y1="${top + innerHeight * step}" y2="${top + innerHeight * step}" class="exec-chart-grid"></line>`).join('')}
    <path d="${area}" class="exec-line-area"></path><path d="${line}" class="exec-line-path"></path>
    ${points.map((point, index) => `<g><circle cx="${point.x}" cy="${point.y}" r="${point.value ? 4 : 3}" class="exec-line-point"><title>${escapeHtml(executiveDateLabel(point.date))}: ${number(point.value)} khách</title></circle>${index === 0 || index === points.length - 1 || point.value ? `<text x="${point.x}" y="${height - 11}" text-anchor="middle" class="exec-chart-label">${escapeHtml(executiveDateLabel(point.date))}</text>` : ''}</g>`).join('')}
  </svg></div>`;
}

function executiveBarChart(series) {
  const max = Math.max(...series.map(item => item.value), 1);
  return `<div class="exec-bar-chart">${series.map(item => {
    const height = Math.max(4, Math.round(item.value / max * 100));
    return `<div class="exec-bar-item"><span class="exec-bar-value">${item.value ? escapeHtml(money(item.value, true)) : ''}</span><i style="height:${height}%"></i><small>${escapeHtml(item.label)}</small></div>`;
  }).join('')}</div>`;
}

function executiveSparkline(values, tone = 'blue') {
  const width = 100, height = 38, max = Math.max(...values, 1);
  const points = values.map((value, index) => `${index / Math.max(values.length - 1, 1) * width},${height - 4 - value / max * (height - 10)}`).join(' ');
  return `<svg class="exec-sparkline ${tone}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline points="${points}"></polyline><circle cx="${width}" cy="${height - 4 - values.at(-1) / max * (height - 10)}" r="3"></circle></svg>`;
}

function executiveDashboardView() {
  if (currentAccount.role === 'SALE' || currentAccount.role === 'LEADER') return dashboardView();
  const current = periodSnapshot(false), previous = periodSnapshot(true);
  const allCustomers = scopedCustomers();
  const today = dayIso(0);
  const monthKey = today.slice(0, 7);
  const monthCheck = value => dateOnly(value).startsWith(monthKey);
  const monthlyRevenue = netRevenue(scopedOrders(), monthCheck);
  const monthPaidOrders = paidOrders(scopedOrders(), monthCheck);
  const monthTarget = activeStaff().filter(member => member.role === 'SALE').reduce((sum, member) => sum + Number(member.target || 0), 0);
  const targetPercent = monthTarget ? Math.min(100, monthlyRevenue / monthTarget * 100) : 0;
  const remainingTarget = Math.max(0, monthTarget - monthlyRevenue);
  const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0));
  const daysRemaining = Math.max(0, Math.round((monthEnd.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86400000) + 1);
  const newToday = allCustomers.filter(customer => dateOnly(customer.createdAt) === today).length;
  const connected = allCustomers.filter(customer => customer.status !== 'NEW').length;
  const activeRentals = scopedOrders().filter(order => order.status === 'PAID' && order.rentalMonths && order.rentalEndsAt && Date.parse(order.rentalEndsAt) >= Date.now());
  const rentalAlerts = activeRentals.map(order => ({ ...order, daysLeft: Math.ceil((Date.parse(order.rentalEndsAt) - Date.now()) / 86400000) })).filter(order => order.daysLeft <= 7).sort((a, b) => a.daysLeft - b.daysLeft);
  const products = productPerformance(scopedOrders()).filter(product => product.paidOrders || product.refunds).slice(0, 4);
  const customerSeries = executiveCustomerSeries(7);
  const revenueSeries = executiveRevenueSeries(8);
  const targetMessage = monthTarget ? `${money(monthlyRevenue, true)} / ${money(monthTarget, true)}` : 'Chưa đặt chỉ tiêu cho Sale';
  const newWeek = customerSeries.reduce((sum, item) => sum + item.value, 0);
  const rentalCount = activeRentals.length;
  const taxThisMonth = monthPaidOrders.reduce((sum, order) => sum + Number(order.vatAmount || 0), 0);
  const actions = currentAccount.role === 'ADMIN'
    ? '<button class="button button-secondary" id="btnAdminBroadcastTelegram" type="button">📢 Phát thông báo Bot</button> <button class="button button-primary btn-primary" id="newOrderButton" type="button">+ Tạo đơn hàng mới</button>'
    : '<button class="button button-primary btn-primary" id="newOrderButton" type="button">+ Tạo đơn hàng mới</button>';
  const currentRangeOrders = scopedOrders();
  const execPaidOrders = currentRangeOrders.filter(o => o.status === 'PAID');
  const execSellOrders = execPaidOrders.filter(o => !/thuê|rent|thue|chỉ báo|indicator|bot|tool|vip/i.test(o.productName || o.product || ''));
  const execRentOrders = execPaidOrders.filter(o => /thuê|rent|thue|chỉ báo|indicator|bot|tool|vip/i.test(o.productName || o.product || ''));
  const execSellRev = execSellOrders.reduce((sum, o) => sum + Number(o.paidAmount || o.total || 0), 0);
  const execRentRev = execRentOrders.reduce((sum, o) => sum + Number(o.paidAmount || o.total || 0), 0);
  const execTotRev = execSellRev + execRentRev || (monthlyRevenue || 0);
  const execSellPct = execTotRev > 0 ? Math.round((execSellRev / execTotRev) * 100) : 50;
  const execRentPct = 100 - execSellPct;
  const execCircum = 2 * Math.PI * 40;
  const execSellDash = (execSellPct / 100) * execCircum;
  const execRentDash = execCircum - execSellDash;

  const percent = value => Math.max(0, Math.min(100, Number(value) || 0));
  const metricCard = (theme, icon, title, sub, value, unit, trend, sparkline, firstLabel, firstValue, secondLabel, secondValue) => `<article class="kpi-bento-card ${theme}">
    <div class="kpi-bento-head"><div class="kpi-head-left"><span class="kpi-icon-badge">${icon}</span><div class="kpi-head-text"><span class="kpi-label-title">${title}</span><span class="kpi-label-sub">${sub}</span></div></div><span class="kpi-trend-pill">${trend}</span></div>
    <div class="kpi-bento-mid"><div class="kpi-num-wrap"><strong class="kpi-hero-num">${value}</strong><span class="kpi-hero-unit">${unit}</span></div><div class="kpi-sparkline-wrap">${sparkline}</div></div>
    <div class="kpi-bento-meter"><i class="kpi-meter-fill" style="width:${percent(allCustomers.length ? connected / allCustomers.length * 100 : 0)}%"></i></div>
    <div class="kpi-bento-foot two-cols"><span class="kpi-foot-stat"><span class="label">${firstLabel}</span><span class="value">${firstValue}</span></span><span class="kpi-foot-stat"><span class="label">${secondLabel}</span><span class="value">${secondValue}</span></span></div>
  </article>`;
  const revenueAnalysis = `<section class="revenue-analysis-card">
    <div class="revenue-analysis-head"><div><h2>Phân Tích Doanh Thu</h2><p>Cơ cấu doanh thu Bên Bán và Bên Thuê theo kỳ đang chọn.</p></div><div class="segmented">${[[1, '1 ngày'], [7, '7 ngày'], [15, '15 ngày'], [30, '30 ngày']].map(([days, label]) => `<button class="segment ${dateRange === days ? 'active' : ''}" data-range="${days}" type="button">${label}</button>`).join('')}</div></div>
    <div class="revenue-analysis-body"><div class="revenue-donut"><svg viewBox="0 0 100 100" aria-label="Tỷ trọng doanh thu"><circle cx="50" cy="50" r="40"></circle><circle class="sell" cx="50" cy="50" r="40" stroke-dasharray="${execSellDash} ${execCircum}"></circle><circle class="rent" cx="50" cy="50" r="40" stroke-dasharray="${execRentDash} ${execCircum}" stroke-dashoffset="-${execSellDash}"></circle></svg><div><small>Tổng</small><b>${money(execTotRev, true)}</b></div></div><div class="revenue-analysis-legend"><div class="sale"><b>Bên Bán</b><strong>${execSellPct}%</strong><span>${money(execSellRev, true)} · ${number(execSellOrders.length)} đơn</span></div><div class="rental"><b>Bên Thuê</b><strong>${execRentPct}%</strong><span>${money(execRentRev, true)} · ${number(execRentOrders.length)} gói</span></div></div></div>
  </section>`;

  return `<div class="executive-dashboard modern-dashboard">${pageHead('Tổng quan · Toàn hệ thống', '', actions)}${dateFilter()}
    <section class="kpi-bento-grid">
      ${metricCard('theme-purple', '◎', 'Tổng khách hàng', 'Toàn bộ Agency', number(allCustomers.length), 'khách', `+${number(newWeek)} tuần này`, executiveSparkline(customerSeries.map(item => item.value)), 'Đã kết nối', number(connected), 'Chưa kết nối', number(allCustomers.length - connected))}
      ${metricCard('theme-cyan', '↗', 'Khách mới hôm nay', 'Landing page & webhook', number(newToday), 'khách', `+${number(newToday)} hôm nay`, executiveSparkline(customerSeries.map(item => item.value)), 'Tuần này', number(newWeek), 'Chờ xử lý', number(allCustomers.filter(isPoolCustomer).length))}
      ${metricCard('theme-blue', '₫', 'Doanh thu Agency', 'Đã thu thực tế', money(monthlyRevenue, true), '', `${number(monthPaidOrders.length)} đơn`, executiveSparkline(revenueSeries.map(item => item.value)), 'Đơn đã chốt', number(monthPaidOrders.length), 'VAT', money(taxThisMonth, true))}
      ${metricCard('theme-orange', '◈', 'Gói thuê hoạt động', 'Đơn đã thanh toán còn hạn', number(rentalCount), 'gói', `${number(rentalAlerts.length)} sắp hết hạn`, executiveSparkline(rentalAlerts.map(order => Math.max(0, order.daysLeft)).slice(-7).concat([0]), 'warm'), 'Đang thuê', number(rentalCount), 'Hạn ≤ 7 ngày', number(rentalAlerts.length))}
    </section>
    <section class="goal-progress-box"><div class="goal-head"><span>Mục tiêu doanh số Agency tháng này</span><strong>${monthTarget ? `${targetPercent.toFixed(1).replace('.', ',')}%` : 'Chưa đặt chỉ tiêu'}</strong></div><div class="progress-track"><i class="progress-fill-orange" style="width:${targetPercent}%">${monthTarget ? `${targetPercent.toFixed(1).replace('.', ',')}%` : ''}</i></div><div class="goal-foot"><span>Thực hiện: <b>${money(monthlyRevenue, true)}</b></span><span>${monthTarget ? `Còn thiếu: ${money(remainingTarget, true)}` : targetMessage}</span></div><div class="goal-stat-pills"><span class="goal-stat-pill"><span class="p-lbl">Thực hiện tháng</span><span class="p-val">${money(monthlyRevenue, true)}</span></span><span class="goal-stat-pill"><span class="p-lbl">Còn thiếu</span><span class="p-val">${money(remainingTarget, true)}</span></span><span class="goal-stat-pill"><span class="p-lbl">Thời gian</span><span class="p-val">${daysRemaining} ngày</span></span><span class="goal-stat-pill"><span class="p-lbl">Cần mỗi ngày</span><span class="p-val">${money(daysRemaining ? Math.ceil(remainingTarget / daysRemaining) : 0, true)}</span></span></div></section>
    ${revenueAnalysis}
    <section class="analytics-grid"><article class="chart-panel"><div class="chart-panel-header"><div><div class="chart-metric-title">Tăng trưởng khách hàng mới</div><div class="chart-metric-num">${number(newWeek)} ${deltaBadge(delta(newWeek, previous.leads))}</div></div><button class="button button-small" data-view-jump="customers">Chi tiết</button></div><div class="chart-svg-container">${executiveLineChart(customerSeries)}</div></article><article class="chart-panel"><div class="chart-panel-header"><div><div class="chart-metric-title">Doanh thu theo tuần</div><div class="chart-metric-num">${money(monthlyRevenue, true)} ${deltaBadge(delta(monthlyRevenue, netRevenue(scopedOrders(), inPreviousPeriod)))}</div></div><button class="button button-small" data-view-jump="revenue">Chi tiết</button></div><div class="chart-svg-container">${executiveBarChart(revenueSeries)}</div></article><aside class="side-widgets-column"><section class="widget-box"><div class="widget-box-head"><span>Sản phẩm bán chạy</span><button class="button button-small" data-view-jump="products">Xem</button></div><div class="product-list">${products.map(product => `<div class="product-item">${/^data:image\/(?:png|jpeg|webp);base64,/i.test(String(product.imageData || '')) ? `<img class="product-thumb product-thumb-image" src="${escapeHtml(product.imageData)}" alt="" loading="lazy">` : ''}<div class="product-meta"><span class="product-name">${escapeHtml(product.name)}</span><span class="product-sku">${money(product.revenue, true)} · ${number(product.paidOrders)} đơn</span></div></div>`).join('') || '<div class="empty"><b>Chưa có sản phẩm bán ra</b></div>'}</div></section><section class="widget-box rental-widget"><div class="widget-box-head"><span>Gói thuê cần gia hạn</span><button class="button button-small" data-view-jump="orders">Xem</button></div>${rentalAlerts.slice(0, 3).map(order => `<div class="rental-item"><div><b>${escapeHtml(order.customerName)}</b><small>${escapeHtml(order.productName)}</small></div><span class="status ${order.daysLeft <= 2 ? 'status-cancelled' : 'status-pending'}">${order.daysLeft <= 0 ? 'Đã hết hạn' : `Còn ${order.daysLeft} ngày`}</span></div>`).join('') || '<div class="empty"><b>Không có gói cần gia hạn</b></div>'}</section></aside></section>
  </div>`;
}

function dashboardView() {
  const current = periodSnapshot(false), previous = periodSnapshot(true);
  if (currentAccount.role === 'SALE') return saleDashboardView(current, previous);
  if (currentAccount.role === 'LEADER') return leaderDashboardView(current, previous);
  const products = productPerformance(scopedOrders()).filter(product => product.paidOrders || product.refunds);
  const sources = sourcePerformance();
  const series = dailySeries();
  const allCustomers = scopedCustomers().filter(customer => inCurrentPeriod(customer.createdAt));
  const statuses = Object.keys(STATUS_META).map(key => ({ key, count: allCustomers.filter(customer => customer.status === key).length })).filter(item => item.count);
  const maxStatus = Math.max(...statuses.map(item => item.count), 1);
  const overdue = scopedTasks().filter(task => task.status === 'OVERDUE').length;
  const dueToday = scopedTasks().filter(task => task.status === 'OPEN' && dateOnly(task.dueAt) === dayIso(0)).length;
  const slaBreaches = slaBreachedCustomers().length;
  const unassigned = scopedCustomers().filter(isPoolCustomer).length;
  const scopeTitle = currentAccount.role === 'ADMIN' ? 'Toàn hệ thống' : currentAccount.role === 'LEADER' ? `Team ${currentAccount.teamId}` : `Cá nhân ${currentAccount.name}`;
  return pageHead(`Tổng quan · ${scopeTitle}`, 'Doanh thu, sản phẩm và acquisition dùng cùng kỳ; cảnh báo công việc là trạng thái vận hành hiện tại.') + dateFilter() +
    `<div class="kpi-grid">
      ${kpiCard('₫', 'Doanh thu thuần', money(current.revenue, true), `${current.paid.length} đơn đã thanh toán`, delta(current.revenue, previous.revenue))}
      ${kpiCard('▤', 'Đơn thanh toán', number(current.paid.length), `${current.orders.filter(order => order.status === 'PENDING').length} đơn đang chờ`, delta(current.paid.length, previous.paid.length))}
      ${kpiCard('◎', 'Giá trị đơn TB', money(current.aov, true), 'Doanh thu thuần / lượt thanh toán', delta(current.aov, previous.aov))}
      ${kpiCard('□', 'Sản phẩm bán ra', number(current.units), 'Tổng số lượng sản phẩm', delta(current.units, previous.units))}
      ${kpiCard('↗', 'Data CRM mới', number(current.leads), currentAccount.role === 'ADMIN' ? `${number(current.trackedLeads)} form gửi · ${number(current.sessions)} sessions` : 'Khách mới trong phạm vi', delta(current.leads, previous.leads))}
      ${kpiCard('%', 'Paid / data trong kỳ', `${current.conversion.toFixed(1).replace('.', ',')}%`, 'Tỷ lệ chuyển đổi trong kỳ', delta(current.conversion, previous.conversion))}
    </div>
    <div class="grid grid-2">
      <section class="panel"><div class="panel-head"><div><div class="panel-title">Doanh thu từng ngày</div><div class="panel-sub">Doanh thu thuần từ đơn PAID · hover điểm để xem chi tiết</div></div><span class="scope-chip" style="color:var(--ink);background:var(--panel-2)">${currentPeriodBounds().days}D</span></div><div class="panel-body">${revenueChart(series)}</div><div class="chart-summary"><div><small>Cao nhất</small><b>${money(Math.max(...series.map(item => item.revenue)), true)}</b></div><div><small>Trung bình/ngày</small><b>${money(Math.round(current.revenue / currentPeriodBounds().days), true)}</b></div><div><small>Chiết khấu</small><b>${money(series.reduce((sum, item) => sum + item.discount, 0), true)}</b></div><div><small>Hoàn tiền</small><b>${money(series.reduce((sum, item) => sum + item.refunds, 0), true)}</b></div></div></section>
      <section class="panel"><div class="panel-head"><div><div class="panel-title">${currentAccount.role === 'ADMIN' ? 'Nguồn traffic / data' : 'Nguồn khách mới'}</div><div class="panel-sub">${currentAccount.role === 'ADMIN' ? 'Phiên truy cập từ hệ thống tracking' : 'Không hiển thị sessions và ad spend ngoài quyền'}</div></div><button class="button button-small" data-view-jump="${currentAccount.role === 'SALE' ? 'customers' : 'marketing'}">Chi tiết</button></div><div class="panel-body">${trafficDonut(sources)}</div></section>
    </div>
    <div class="grid grid-2" style="margin-top:14px">
      <section class="panel"><div class="panel-head"><div><div class="panel-title">Sản phẩm bán ra</div><div class="panel-sub">Xếp hạng theo doanh thu thuần · ${escapeHtml(periodLabel())}</div></div><button class="button button-small" data-view-jump="revenue">Xem báo cáo</button></div><div class="panel-body">${products.slice(0, 6).map((product, index) => { const share = current.revenue > 0 ? product.revenue / current.revenue * 100 : 0; return `<div class="rank-row"><span class="rank">#${index + 1}</span><div><b>${escapeHtml(product.name)}</b><small>${product.units} sản phẩm · ${product.paidOrders} đơn · ${share.toFixed(1).replace('.', ',')}% doanh thu</small><div class="progress"><i style="width:${Math.max(share, 0)}%"></i></div></div><div class="rank-value"><b>${money(product.revenue, true)}</b><small>${deltaBadge(delta(product.revenue, product.previousRevenue))}</small></div></div>`; }).join('') || '<div class="empty"><b>Chưa bán sản phẩm</b><span>Không có lượt thanh toán trong kỳ.</span></div>'}</div></section>
      <div class="grid">
        <section class="panel"><div class="panel-head"><div><div class="panel-title">Pipeline khách hàng</div><div class="panel-sub">${allCustomers.length} khách · ${escapeHtml(periodLabel())}</div></div></div><div class="panel-body">${statuses.length ? `<div class="pipeline">${statuses.map(item => `<div class="pipeline-row"><span>${escapeHtml(STATUS_META[item.key].label)}</span><div class="progress"><i style="width:${item.count / maxStatus * 100}%;background:${STATUS_META[item.key].color}"></i></div><b>${item.count}</b></div>`).join('')}</div>` : '<div class="empty"><b>Chưa có data mới</b><span>Không có khách được tạo trong kỳ.</span></div>'}</div></section>
        <section class="panel"><div class="panel-head"><div><div class="panel-title">Việc cần xử lý</div><div class="panel-sub">Lịch chăm sóc đã được gộp vào hồ sơ khách hàng</div></div></div><div class="alert-list"><button class="alert-row" data-view-jump="customers"><span class="alert-icon">!</span><span><b>${overdue} lịch chăm sóc quá hạn</b><p>Mở khách hàng để xử lý follow-up.</p></span><strong>${overdue}</strong></button><button class="alert-row" data-view-jump="customers"><span class="alert-icon">S</span><span><b>${slaBreaches} data vượt SLA ${state.settings.slaMinutes} phút</b><p>Data mới chưa được chăm sóc đúng hạn.</p></span><strong>${slaBreaches}</strong></button><button class="alert-row" data-view-jump="customers"><span class="alert-icon">⌚</span><span><b>${dueToday} lịch đến hạn hôm nay</b><p>Cuộc gọi và proposal cần hoàn tất.</p></span><strong>${dueToday}</strong></button><button class="alert-row" data-view-jump="distribution"><span class="alert-icon">↯</span><span><b>${unassigned} data chưa phân Leader</b><p>Xử lý theo thứ tự trong mục Data.</p></span><strong>${unassigned}</strong></button></div></section>
      </div>
    </div>
    <section class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Đơn hàng gần nhất</div><div class="panel-sub">Tổng đơn, sản phẩm và thanh toán đối chiếu cùng nguồn dữ liệu</div></div><button class="button button-small" data-view-jump="orders">Tất cả đơn</button></div>${ordersTable(current.orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 7))}</section>`;
}

function ordersTable(orders, showActions = false) {
  if (!orders.length) return `<div class="empty"><b>Không có đơn hàng</b><span>Thử đổi bộ lọc hoặc khoảng thời gian.</span></div>`;
  const showLeader = currentAccount.role === 'ADMIN';
  return `<div class="table-wrap"><table class="orders-data-table"><thead><tr><th class="col-order">Mã đơn</th><th class="col-type">Phân loại</th><th class="col-customer">Khách hàng</th><th class="col-product">Sản phẩm</th><th class="col-staff">Sale</th>${showLeader ? '<th class="col-staff">Leader</th>' : ''}<th class="col-money">Giá trị</th><th class="col-pay">Thanh toán</th>${showActions ? '<th class="col-act"></th>' : ''}</tr></thead><tbody>${orders.map(order => `<tr><td class="col-order"><div class="cell-main mono">${escapeHtml(order.code)}</div><div class="cell-sub">${escapeHtml(order.createdAt)}</div></td>
      <td class="col-type">
        ${/thuê|rent|thue|chỉ báo|indicator|bot|tool|vip/i.test((order.productName || order.product || ''))
          ? '<span class="status-badge" style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;font-size:11px;padding:2px 6px;border-radius:4px;font-weight:600;">⚡ Bên Thuê</span>'
          : '<span class="status-badge" style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;font-size:11px;padding:2px 6px;border-radius:4px;font-weight:600;">🛒 Bên Bán</span>'}
      </td><td class="col-customer"><div class="cell-main">${escapeHtml(order.customerName)}</div><div class="cell-sub">${currentAccount.role === 'ADMIN' ? escapeHtml(order.source) : 'Khách thuộc phạm vi phân công'}</div></td><td class="col-product"><div class="cell-main">${escapeHtml(order.productName)}</div><div class="cell-sub">${escapeHtml(order.sku)} · SL ${escapeHtml(order.qty)}</div></td><td class="col-staff"><div class="cell-main">${escapeHtml(staffName(order.saleId))}</div></td>${showLeader ? `<td class="col-staff"><div class="cell-main">${escapeHtml(staffName(order.leaderId))}</div></td>` : ''}<td class="col-money num"><b>${money(order.total)}</b>${order.discount ? `<div class="cell-sub">CK ${money(order.discount)}</div>` : ''}</td><td class="col-pay">${statusBadge(order.status, 'order')}</td>${showActions ? `<td class="col-act"><span class="order-lock-chip">${orderEditState(order).label}</span> <button class="button button-small" data-open-order="${escapeHtml(order.id)}">Mở</button>${orderEditState(order).allowed ? `<button class="button button-small" data-edit-order="${escapeHtml(order.id)}">Sửa</button><button class="button button-small button-danger" data-delete-order="${escapeHtml(order.id)}">Xóa</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}

function transactionsTable(events, showReconciliation = false) {
  if (!events.length) return `<div class="empty"><b>Không có giao dịch</b><span>Chưa phát sinh thanh toán hoặc hoàn tiền trong phạm vi này.</span></div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Loại</th><th>Mã đơn</th><th>Khách hàng</th><th>Giá trị</th>${showReconciliation ? '<th>Đối soát</th>' : ''}<th></th></tr></thead><tbody>${events.map(event => `<tr><td class="mono">${escapeHtml(event.occurredAt)}</td><td>${event.type === 'PAYMENT' ? '<span class="status status-paid">Thu tiền</span>' : '<span class="status status-refunded">Hoàn tiền</span>'}</td><td class="mono">${escapeHtml(event.code)}</td><td>${escapeHtml(event.customerName)}</td><td><b>${money(event.amount)}</b></td>${showReconciliation ? `<td>${event.reconciled ? '<span class="status status-paid">Đã khớp</span>' : '<span class="status status-pending">Chờ khớp</span>'}</td>` : ''}<td><button class="button button-small" data-open-order="${escapeHtml(event.orderId)}">Mở đơn</button></td></tr>`).join('')}</tbody></table></div>`;
}

function canUpdateCustomer(customer) {
  if (!customer) return false;
  const permissionRole = effectivePermissionRole();
  const inScope = () => scopedCustomers().some(item => String(item.id) === String(customer.id));
  if (permissionRole === 'ADMIN') return true;
  if (permissionRole === 'MANAGER') return inScope();
  if (permissionRole === 'LEADER') {
    return Boolean(
      (currentAccount.teamId && customer.teamId === currentAccount.teamId) ||
      customer.leaderId === currentAccount.id ||
      customer.leaderId === currentAccount.leaderId ||
      inScope()
    );
  }
  if (permissionRole === 'SALE') {
    return Boolean(
      customer.saleId === currentAccount.id ||
      customer.saleId === currentAccount.saleId ||
      customer.ownerId === currentAccount.id ||
      inScope()
    );
  }
  return false;
}

function canEditCustomerName(customer) {
  const permissionRole = effectivePermissionRole();
  return !!customer && ['ADMIN', 'MANAGER', 'LEADER'].includes(permissionRole) && canViewCustomer(customer);
}

function activeCustomFields(tableOnly = false) {
  return state.customFieldDefinitions.filter(field => field.active !== false && (!tableOnly || field.showInTable));
}

function customFieldOption(field, value) {
  return field?.options?.find(option => option.value === value) || null;
}

function customFieldColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : '#64748B';
}

function customFieldTextColor(value) {
  const hex=customFieldColor(value).slice(1),red=parseInt(hex.slice(0,2),16),green=parseInt(hex.slice(2,4),16),blue=parseInt(hex.slice(4,6),16);
  return (red*299+green*587+blue*114)>=150000?'#0F172A':'#FFFFFF';
}

function customFieldValueLabel(field, value) {
  if (Array.isArray(value)) return value.map(item => customFieldOption(field, item)?.label || item).join(', ');
  if (field?.type === 'CHECKBOX') return value ? 'Có' : 'Không';
  return customFieldOption(field, value)?.label || String(value ?? '');
}

function customFieldCell(field, value) {
  if (field.type === 'MULTI_SELECT') {
    return `<span class="field-pill-list">${(Array.isArray(value) ? value : []).map(item => { const option = customFieldOption(field, item); return `<span class="field-pill" style="--pill:${escapeHtml(option?.color || '#687771')}">${escapeHtml(option?.label || item)}</span>`; }).join('') || '<span class="cell-sub">—</span>'}</span>`;
  }
  if (field.type === 'SELECT') {
    const option = customFieldOption(field, value);
    if (!option) return '<span class="cell-sub">—</span>';
    const color=customFieldColor(option.color);
    return `<span class="field-pill field-pill-solid" style="--pill:${color};background:${color};border-color:${color};color:${customFieldTextColor(color)}">${escapeHtml(option.label)}</span>`;
  }
  if (field.type === 'CHECKBOX') return value ? '<span class="status status-paid">Có</span>' : '<span class="cell-sub">Không</span>';
  if (field.type === 'URL') return value ? `<a class="field-link" href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">Mở tài liệu ↗</a>` : '<span class="cell-sub">—</span>';
  const label = customFieldValueLabel(field, value);
  return label ? `<span class="custom-field-text">${escapeHtml(label)}</span>` : '<span class="cell-sub">—</span>';
}

function customFieldTableControl(field, customer) {
  const value = customer.customFields?.[field.id];
  if (!canUpdateCustomer(customer)) return customFieldCell(field, value);
  if (field.type === 'SELECT') {
    const selectedOption = customFieldOption(field, value);
    const selectedColor=customFieldColor(selectedOption?.color),selectedText=customFieldTextColor(selectedColor);
    const selectedStyle=selectedOption?`background-color:${selectedColor};border-color:${selectedColor};color:${selectedText}`:'--field-color:#64748B';
    return `<select class="quick-custom-field" style="--field-color:${selectedColor};${selectedStyle}" data-quick-custom-field="${escapeHtml(customer.id)}" data-field-id="${escapeHtml(field.id)}" aria-label="${escapeHtml(field.label)} của ${escapeHtml(customer.name)}"><option value="">— Chưa chọn —</option>${field.options.map(option => { const color=customFieldColor(option.color); return `<option value="${escapeHtml(option.value)}" style="color:${customFieldTextColor(color)};background-color:${color}" ${value === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`; }).join('')}</select>`;
  }
  if (field.type === 'CHECKBOX') {
    return `<label class="quick-checkbox"><input type="checkbox" data-quick-custom-checkbox="${escapeHtml(customer.id)}" data-field-id="${escapeHtml(field.id)}" ${value ? 'checked' : ''}><span>${value ? 'Có' : 'Không'}</span></label>`;
  }
  if (field.type === 'MULTI_SELECT') {
    const count = Array.isArray(value) ? value.length : 0;
    return `<button class="button button-small quick-multi-button" type="button" data-quick-multi-field="${escapeHtml(customer.id)}" data-field-id="${escapeHtml(field.id)}">${count ? `${count} lựa chọn` : 'Chọn option'}</button><div class="field-pill-list">${customFieldCell(field, value)}</div>`;
  }
  return customFieldCell(field, value);
}

function quickStatusControl(customer) {
  if (!canUpdateCustomer(customer)) return statusBadge(customer.status);
  const currentMeta = STATUS_META[customer.status] || STATUS_META.NEW;
  return `<select class="quick-status quick-custom-field" style="--field-color:${escapeHtml(currentMeta.color)}" data-quick-status="${escapeHtml(customer.id)}" aria-label="Trạng thái của ${escapeHtml(customer.name)}">${Object.entries(STATUS_META).map(([key, meta]) => `<option value="${key}" style="color:${escapeHtml(meta.color)}" ${customer.status === key ? 'selected' : ''}>${escapeHtml(meta.label)}</option>`).join('')}</select>`;
}

// Chọn Sale trong bảng, giữ hiển thị lời mời đang chờ nhận.
function quickSaleControl(customer) {
  const pending = state.dataOffers.find(o => o.customerId === customer.id && o.status === 'PENDING');
  const selectedId = pending?.saleId || customer.saleId || customer.leaderId || customer.managerId || '';
  const permissionRole = effectivePermissionRole();
  const managerCanAssign = permissionRole === 'MANAGER'
    && scopedCustomers().some(item => item.id === customer.id);
  const canAssign = permissionRole === 'ADMIN'
    || (permissionRole === 'LEADER' && customer.leaderId === currentAccount.leaderId && customer.teamId === currentAccount.teamId)
    || managerCanAssign;
  if (!canAssign) return customer.saleId ? `<b>${escapeHtml(staffName(customer.saleId))}</b>` : '<span class="status status-pending">Chưa phân Sale</span>';
  const recipients = permissionRole === 'ADMIN'
    ? activeStaff().filter(person => person.active !== false && ['MANAGER', 'LEADER', 'SALE'].includes(person.role))
    : permissionRole === 'MANAGER'
      ? managerAssignmentRecipients()
      : customer.leaderId
        ? teamRecipients(customer.leaderId, customer.teamId)
        : activeStaff().filter(p=>p.role==='SALE');
  const recipientLabel = recipient => recipient.managerRecipient || recipient.actualRole === 'MANAGER' || recipient.role === 'MANAGER'
    ? ' (Manager)'
    : recipient.teamLeaderRecipient || recipient.role === 'LEADER'
      ? ' (Leader)'
      : '';
  return `<select class="quick-sale-select" data-quick-sale="${escapeHtml(customer.id)}" aria-label="Người phụ trách của ${escapeHtml(customer.name)}" ${recipients.length ? '' : 'disabled'}><option value="" ${selectedId ? '' : 'selected'}>${recipients.length ? '— Chưa chọn người phụ trách —' : 'Chưa có người trong tuyến'}</option>${selectedId && !recipients.some(recipient => recipient.id === selectedId) ? `<option value="${escapeHtml(selectedId)}" selected disabled>${escapeHtml(staffName(selectedId))}</option>` : ''}${recipients.map(recipient => `<option value="${escapeHtml(recipient.id)}" ${selectedId === recipient.id ? 'selected' : ''}>${escapeHtml(recipient.name)}${recipientLabel(recipient)}</option>`).join('')}</select>${pending && !customer.saleId ? '<div class="cell-sub">Chờ Sale nhận data</div>' : ''}`;
}

async function quickAssignSale(customerId, saleId) {
  const permissionRole = effectivePermissionRole();
  if (!['ADMIN', 'MANAGER', 'LEADER'].includes(permissionRole)) return false;
  const customer = customerById(customerId);
  if (!saleId) return clearManualRecipient(customer);
  const managerScopeData = permissionRole === 'MANAGER' ? managerScope() : null;
  const managerLeaders = managerScopeData?.leaders || [];
  const managerSaleIds = managerScopeData?.saleIds || new Set();
  const managerId = managerScopeData?.manager?.id || currentAccount.id;
  const managerTarget = permissionRole === 'MANAGER' && saleId === managerId && customer
    ? { ...(managerScopeData?.manager || currentAccount), role: 'MANAGER', actualRole: 'MANAGER', managerRecipient: true, leaderId: customer.leaderId || null, teamId: customer.teamId || null }
    : null;
  const leaderTarget = permissionRole === 'LEADER' && saleId === currentAccount.leaderId
    ? (() => { const person = activeStaff().find(item => item.id === currentAccount.leaderId && item.role === 'LEADER' && item.active !== false); return person ? { ...person, role: 'SALE', leaderId: person.id, teamId: person.teamId, teamLeaderRecipient: true } : null; })()
    : null;
  const adminTarget = permissionRole === 'ADMIN'
    ? (() => {
        const person = activeStaff().find(item => item.id === saleId && item.active !== false && ['MANAGER', 'LEADER', 'SALE'].includes(item.role));
        if (!person) return null;
        if (person.role !== 'MANAGER') return person;
        const leader = customer?.leaderId
          ? activeStaff().find(item => item.id === customer.leaderId && item.role === 'LEADER' && item.managerId === person.id && item.active !== false)
          : null;
        return { ...person, role: 'SALE', actualRole: 'MANAGER', managerRecipient: true, leaderId: leader?.id || null, teamId: leader?.teamId || person.teamId || null };
      })()
    : null;
  const managerLeaderTarget = permissionRole === 'MANAGER'
    ? managerLeaders.find(person => person.id === saleId)
      || (customer?.leaderId === saleId && managerCanAccessCustomer(customer)
        ? activeStaff().find(person => person.id === saleId && person.role === 'LEADER' && person.active !== false)
        : null)
    : null;
  const managerSaleTarget = permissionRole === 'MANAGER'
    ? activeStaff().find(person => person.id === saleId && person.role === 'SALE' && managerSaleIds.has(person.id))
      || (customer?.saleId === saleId && managerCanAccessCustomer(customer)
        ? activeStaff().find(person => person.id === saleId && person.role === 'SALE' && person.active !== false)
        : null)
    : null;
  const sale = adminTarget || managerTarget || leaderTarget || (permissionRole === 'MANAGER'
    ? (managerLeaderTarget || managerSaleTarget)
    : (customer?.leaderId
      ? teamRecipients(customer.leaderId, customer.teamId).find(p=>p.id===saleId)
      : activeStaff().find(p=>p.id===saleId&&p.role==='SALE')));
  const inManagerScope = permissionRole === 'MANAGER'
    && managerCanAccessCustomer(customer)
    && !!sale;
  const outsideScope = permissionRole === 'LEADER'
    ? (customer?.leaderId !== currentAccount.leaderId || customer?.teamId !== currentAccount.teamId || (sale?.id !== currentAccount.leaderId && (sale?.leaderId !== currentAccount.leaderId || sale?.teamId !== currentAccount.teamId)))
    : permissionRole === 'MANAGER' && !inManagerScope;
  if (!customer || !sale || outsideScope) { toast('Sale hoac khach hang nam ngoai pham vi duoc giao'); render(); return false; }
  const pending = state.dataOffers.find(o => o.customerId === customer.id && o.status === 'PENDING');
  if (customer.saleId === sale.id || (pending?.saleId === sale.id && Date.parse(String(pending.offeredAt).replace(' ', 'T') + '+07:00') + offerDeadlineMs() > Date.now())) return true;
  applyCustomerAssignment(customer, sale, `Giao thủ công cho ${sale.name}`);
  saveState(); renderPreservingCustomerScroll();
  const saved = await flushServerPersistence();
  toast(saved ? `Đã lưu phân công cho ${sale.name}` : 'Chưa lưu được phân công. Giữ trang mở để thử lại.');
  return saved;
}

async function clearManualRecipient(customer) {
  const permissionRole = effectivePermissionRole();
  const managerCanClear = permissionRole === 'MANAGER'
    && scopedCustomers().some(item=>item.id===customer?.id);
  if (!customer || !['ADMIN','LEADER','MANAGER'].includes(permissionRole) || (permissionRole==='LEADER' && (customer.leaderId!==currentAccount.leaderId || customer.teamId!==currentAccount.teamId)) || (permissionRole==='MANAGER' && !managerCanClear)) return false;
  const before=assignmentSnapshot(customer);
  closeOpenCustomerTasks(customer,'UNASSIGNED');
  state.dataOffers.forEach(o=>{if(o.customerId===customer.id&&o.status==='PENDING'){o.status='EXPIRED';o.resolvedAt=stamp();}});
  customer.saleId=null;customer.saleAcceptedAt=null;customer.updatedAt=stamp();
  recordAssignmentChange(customer,before,'Leader chọn lại người phụ trách','MANUAL',true);
  saveState();renderPreservingCustomerScroll();return flushServerPersistence();
}

function customFieldInput(field, value) {
  const id = `customerField-${field.id}`;
  if (field.type === 'SELECT') return `<label class="form-field">${escapeHtml(field.label)}<select id="${escapeHtml(id)}"><option value="">— Chưa chọn —</option>${field.options.map(option => `<option value="${escapeHtml(option.value)}" ${value === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>`;
  if (field.type === 'MULTI_SELECT') return `<fieldset class="form-field custom-field-multi"><legend>${escapeHtml(field.label)}</legend><div>${field.options.map(option => `<label><input type="checkbox" data-customer-field-multi="${escapeHtml(field.id)}" value="${escapeHtml(option.value)}" ${(Array.isArray(value) ? value : []).includes(option.value) ? 'checked' : ''}><span class="field-pill" style="--pill:${escapeHtml(option.color)}">${escapeHtml(option.label)}</span></label>`).join('')}</div></fieldset>`;
  if (field.type === 'CHECKBOX') return `<label class="form-field custom-field-check"><span>${escapeHtml(field.label)}</span><input id="${escapeHtml(id)}" type="checkbox" ${value ? 'checked' : ''}></label>`;
  if (field.type === 'NOTE') return `<label class="form-field full">${escapeHtml(field.label)}<textarea id="${escapeHtml(id)}" rows="3" maxlength="4000">${escapeHtml(value || '')}</textarea></label>`;
  const inputType = field.type === 'DATE' ? 'date' : field.type === 'NUMBER' ? 'number' : field.type === 'URL' ? 'url' : 'text';
  return `<label class="form-field ${field.type === 'URL' ? 'full' : ''}">${escapeHtml(field.label)}<input id="${escapeHtml(id)}" type="${inputType}" value="${escapeHtml(value ?? '')}" ${field.required ? 'required' : ''}></label>`;
}

function recordFieldChange(customer, field, from, to, source = 'MANUAL') {
  state.customerFieldHistory.unshift({
    // Mã ngẫu nhiên: nhiều máy cùng ghi trong một mili-giây không bị trùng khóa (409 giả).
    id: makeRecordId('FLD'),
    customerId: customer.id,
    fieldId: field.id,
    fieldLabel: field.label,
    from: structuredClone(from),
    to: structuredClone(to),
    actorId: currentAccount?.id || 'SYSTEM',
    actor: currentAccount?.name || 'Hệ thống',
    role: currentAccount?.role || 'SYSTEM',
    at: stamp(),
    source
  });
}

function setCustomerCustomFields(customerId, values, source = 'MANUAL') {
  const customer = customerById(customerId);
  if (!canViewCustomer(customer) || !canUpdateCustomer(customer) || !values || typeof values !== 'object') return { updated: false, changes: 0, error: 'FORBIDDEN' };
  const nextValues = {};
  for (const field of activeCustomFields()) {
    if (!Object.hasOwn(values, field.id)) continue;
    const next = sanitizeCustomFieldValue(values[field.id], field);
    const empty = next === '' || (Array.isArray(next) && !next.length);
    if (field.required && empty) return { updated: false, changes: 0, error: `${field.label} là bắt buộc` };
    nextValues[field.id] = next;
  }
  let changes = 0;
  customer.customFields ||= {};
  Object.entries(nextValues).forEach(([fieldId, next]) => {
    const field = state.customFieldDefinitions.find(item => item.id === fieldId);
    // Ô chưa từng lưu giá trị (bảng hiện "— Chưa chọn —") thì luôn ghi lại.
    // Trước đây so với giá trị mặc định (Level = L0) nên chọn L0 bị coi là
    // "không đổi", không gửi lên máy chủ và F5 lại mất lựa chọn.
    const stored = Object.hasOwn(customer.customFields, fieldId) && customer.customFields[fieldId] != null;
    const previous = stored ? customer.customFields[fieldId] : defaultCustomFieldValue(field);
    if (stored && JSON.stringify(previous) === JSON.stringify(next)) return;
    if (!stored && (next === '' || (Array.isArray(next) && !next.length))) return;
    recordFieldChange(customer, field, previous, next, source);
    customer.customFields[fieldId] = next;
    changes += 1;
  });
  if (changes) {
    customer.updatedAt = stamp();
    audit('UPDATE_CUSTOMER_FIELDS', customer.id, `${changes} trường nghiệp vụ · ${source}`);
  }
  return { updated: changes > 0, changes, error: '' };
}

async function updateCustomerCustomFields(customerId) {
  const values = {};
  const form = $('#customerCustomFieldsForm');
  activeCustomFields().forEach(field => {
    // Chỉ đọc cột có ô nhập trong form; cột vắng mặt (vd. Level) giữ nguyên giá trị cũ.
    const present = field.type === 'MULTI_SELECT' ? form?.querySelector(`[data-customer-field-multi="${CSS.escape(field.id)}"]`) : form?.querySelector(`#${CSS.escape(`customerField-${field.id}`)}`);
    if (!present) return;
    if (field.type === 'MULTI_SELECT') values[field.id] = $$(`[data-customer-field-multi="${field.id}"]:checked`).map(input => input.value);
    else if (field.type === 'CHECKBOX') values[field.id] = $(`#customerField-${field.id}`)?.checked === true;
    else values[field.id] = $(`#customerField-${field.id}`)?.value ?? '';
  });
  const result = setCustomerCustomFields(customerId, values);
  if (result.error) { toast(result.error === 'FORBIDDEN' ? 'FORBIDDEN · không có quyền cập nhật dữ liệu nghiệp vụ' : result.error); return; }
  if (!result.updated) { toast('Dữ liệu nghiệp vụ chưa thay đổi'); return; }
  saveState();
  const saved=await flushServerPersistence();
  render(); openCustomerDrawer(customerId);
  toast(saved
    ? `Đã lưu ${result.changes} thay đổi vào MySQL; lịch sử Level được giữ nguyên`
    : `Chưa xác nhận lưu ${result.changes} thay đổi. Bản nháp vẫn được giữ lại để tự thử lại.`);
}

function uniqueCustomerRows(customers) {
  const groups = new Map();
  const activeSaleIds = new Set(activeStaff().filter(member => member.role === 'SALE').map(member => member.id));
  const score = customer => {
    const pending = state.dataOffers.some(offer => offer.customerId === customer.id && offer.status === 'PENDING');
    const activeSale = activeSaleIds.has(customer.saleId);
    return (customer.status === 'ARCHIVED' ? 0 : 1000000000000)
      + (pending ? 100000000 : 0)
      + (activeSale ? 10000000 : 0)
      + (customer.saleAcceptedAt ? 1000000 : 0)
      + (customer.saleId ? 100000 : 0)
      + (Date.parse(String(customer.updatedAt || customer.createdAt || '').replace(' ', 'T')) || 0);
  };
  for (const customer of customers || []) {
    const phone = normalizeCustomerPhone(customer.phone);
    const key = phone ? `phone:${phone}` : `id:${customer.id}`;
    const previous = groups.get(key);
    if (!previous || score(customer) > score(previous)) groups.set(key, customer);
  }
  return [...groups.values()];
}

function customerSearchText(customer) {
  const sourceText = currentAccount.role === 'ADMIN' ? `${customer.source}${customer.campaign}${customerLandingName(customer)}` : '';
  return `${customer.name}${customer.phone}${customer.email}${customer.id}${sourceText}${customer.note}${Object.values(customer.customFields || {}).flat().join('')}`;
}

function customerOwnerOptions() {
  if (effectivePermissionRole() === 'MANAGER') {
    const scope = managerScope();
    const teams = Array.from(new Set(scope.leaders.map(person => person.teamId))).sort();
    const members = [...scope.leaders, ...scope.sales];
    const teamOptions = teams.map(teamId => `<option value="team:${escapeHtml(teamId)}" ${customerOwnerFilter === `team:${teamId}` ? 'selected' : ''}>Team ${escapeHtml(teamId)}</option>`).join('');
    const memberOptions = members.map(person => `<option value="${person.role.toLowerCase()}:${escapeHtml(person.id)}" ${customerOwnerFilter === `${person.role.toLowerCase()}:${person.id}` ? 'selected' : ''}>${person.role === 'LEADER' ? 'Leader' : 'Sale'} · ${escapeHtml(person.name)}</option>`).join('');
    return `<select id="customerOwnerFilter"><option value="ALL">Tất cả phân công</option><option value="UNASSIGNED" ${customerOwnerFilter === 'UNASSIGNED' ? 'selected' : ''}>Chưa phân Sale</option>${teamOptions}${memberOptions}</select>`;
  }
  if (currentAccount.role === 'SALE') return '';
  const members = currentAccount.role === 'ADMIN' ? activeStaff() : activeStaff().filter(person => person.teamId === currentAccount.teamId && (person.role === 'SALE' || person.id === currentAccount.leaderId));
  const teamOptions = currentAccount.role === 'ADMIN' ? Array.from(new Set(STAFF.map(person => person.teamId))).sort().map(teamId => `<option value="team:${escapeHtml(teamId)}" ${customerOwnerFilter === `team:${teamId}` ? 'selected' : ''}>Team ${escapeHtml(teamId)}</option>`).join('') : '';
  const memberOptions = members.map(person => `<option value="${person.role.toLowerCase()}:${escapeHtml(person.id)}" ${customerOwnerFilter === `${person.role.toLowerCase()}:${person.id}` ? 'selected' : ''}>${person.role === 'LEADER' ? 'Leader' : 'Sale'} · ${escapeHtml(person.name)}</option>`).join('');
  return `<select id="customerOwnerFilter"><option value="ALL">Tất cả phân công</option><option value="UNASSIGNED" ${customerOwnerFilter === 'UNASSIGNED' ? 'selected' : ''}>Chưa phân Sale</option>${teamOptions}${memberOptions}</select>`;
}

function matchesCustomerOwnerFilter(customer) {
  if (customerOwnerFilter === 'ALL') return true;
  if (customerOwnerFilter === 'UNASSIGNED') return !customer.saleId;
  const [type, id] = customerOwnerFilter.split(':');
  if (type === 'team') return customer.teamId === id;
  if (type === 'leader') return customer.leaderId === id;
  if (type === 'sale') return customer.saleId === id;
  return true;
}

function customersView() {
  const query = normalize(globalQuery);
  const customers = uniqueCustomerRows(scopedCustomers()).filter(customer => customerStatusFilter === 'ALL' || customer.status === customerStatusFilter).filter(matchesCustomerOwnerFilter).filter(customer => !query || normalize(customerSearchText(customer)).includes(query)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const customerPages = Math.max(1, Math.ceil(customers.length / customerPageSize));
  customerPage = Math.min(Math.max(customerPage, 1), customerPages);
  const customerStart = (customerPage - 1) * customerPageSize;
  const visibleCustomers = customers.slice(customerStart, customerStart + customerPageSize);
  const customerFrom = customers.length ? customerStart + 1 : 0;
  const customerTo = Math.min(customerStart + customerPageSize, customers.length);
  const customerPagination = `<div class="customer-pagination" style="display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;padding:12px 14px;border-top:1px solid var(--border-light);color:var(--text-muted);font-size:11px"><span class="customer-pagination-summary" style="margin-right:auto">Hiển thị ${customerFrom}–${customerTo} / ${customers.length} khách</span><label style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap">Số dòng <select id="customerPageSize" aria-label="Số khách hàng mỗi trang" style="min-height:30px;padding:5px 8px;border:1px solid var(--border);border-radius:7px;background:var(--bg-surface);color:var(--text-main);font:inherit"><option value="10" ${customerPageSize === 10 ? 'selected' : ''}>10</option><option value="20" ${customerPageSize === 20 ? 'selected' : ''}>20</option></select></label><button type="button" class="button button-small" data-customer-page="prev" ${customerPage <= 1 ? 'disabled' : ''} aria-label="Trang trước">‹</button><span class="customer-pagination-current" style="min-width:72px;text-align:center;font-weight:700;color:var(--text-main)">Trang ${customerPage} / ${customerPages}</span><button type="button" class="button button-small" data-customer-page="next" ${customerPage >= customerPages ? 'disabled' : ''} aria-label="Trang sau">›</button></div>`;
  const importButton = currentAccount.role === 'ADMIN' ? '<button class="button" id="importCustomersButton" type="button">Kết nối / nhập data</button>' : '';
  const fieldButton = currentAccount.role === 'ADMIN' ? '<button class="button" id="manageCustomerFieldsButton" type="button">Quản lý cột</button>' : '';
  const createButton = `${currentAccount.role !== 'SALE' ? '<button class="button" id="exportCustomersButton" type="button">Xuất CSV</button>' : ''}${fieldButton}${importButton}<button class="button button-primary" id="newCustomerButton" type="button">+ Thêm khách hàng</button>`;
  const title = currentAccount.role === 'ADMIN' ? 'Khách hàng tổng' : currentAccount.role === 'LEADER' ? `Khách hàng Team ${currentAccount.teamId}` : 'Khách hàng của tôi';
  const tableFields = activeCustomFields().filter(field => field.type !== 'MULTI_SELECT' && field.type !== 'NOTE');
  const sourceHeader = currentAccount.role === 'ADMIN' ? '<th>Nguồn / Landing page</th>' : '';
  const sourceCell = customer => currentAccount.role === 'ADMIN' ? (() => { const source = customerSourceDetails(customer); const meta = [customer.source, customer.campaign].filter(Boolean).join(' · '); return `<td><div class="cell-main">${escapeHtml(source.name)}</div><div class="cell-sub mono">${source.url ? escapeHtml(source.url) : escapeHtml(source.domain || 'Nguồn chưa được gắn')}</div><div class="cell-sub">${escapeHtml(meta)}</div></td>`; })() : '';
  const columnCount = 7 + tableFields.length + (currentAccount.role === 'ADMIN' ? 1 : 0);
  return pageHead(title, 'Quản lý trạng thái, Sale phụ trách, ghi chú, lịch chăm sóc và sản phẩm đã mua trên cùng hồ sơ.', createButton) +
    `<section class="panel customer-table-panel"><div class="toolbar"><input id="customerSearch" type="search" placeholder="Ten, SDT, email, Level, ghi chu..." value="${escapeHtml(globalQuery)}"><select id="customerStatusFilter"><option value="ALL">Tất cả trạng thái</option>${Object.entries(STATUS_META).map(([key, meta]) => `<option value="${key}" ${customerStatusFilter === key ? 'selected' : ''}>${escapeHtml(meta.label)}</option>`).join('')}</select>${customerOwnerOptions()}<span class="spacer"></span></div><div class="table-wrap"><table class="customer-data-table"><thead><tr><th>Ngày data</th><th>Khách hàng</th>${sourceHeader}<th>Team / Leader</th><th>Sale phụ trách</th>${tableFields.map(field => `<th>${escapeHtml(field.label)}</th>`).join('')}<th>Trạng thái</th><th>Ghi chú mới nhất</th><th></th></tr></thead><tbody>${visibleCustomers.map(customer => { const leader = STAFF.find(person => person.id === customer.leaderId); const dataDate = dataDateParts(customer.createdAt); return `<tr><td class="data-date-cell"><b>${escapeHtml(dataDate.date)}</b><small>${escapeHtml(dataDate.time)}</small></td><td><div class="cell-main">${escapeHtml(customer.name)}</div><div class="cell-sub">${currentAccount.role === 'SALE' && !customer.saleAcceptedAt ? (() => { const offer = state.dataOffers.find(o => o.customerId === customer.id && o.saleId === currentAccount.saleId && o.status === 'PENDING'); return offer ? `<span class="status status-pending">⏱ còn ${Math.floor(offerMinutesLeft(offer) / 60)}h${offerMinutesLeft(offer) % 60}p</span>` : '<span class="status status-pending">Chờ nhận data</span>'; })() : escapeHtml(customer.phone)}</div></td>${sourceCell(customer)}<td><div class="cell-main">${escapeHtml(leader?.name || 'Chưa phân Leader')}</div>${leader ? `<div class="cell-sub">Team ${escapeHtml(customer.teamId)}</div>` : ''}</td><td class="col-staff">${quickSaleControl(customer)}</td>${tableFields.map(field => `<td>${customFieldTableControl(field, customer)}</td>`).join('')}<td>${quickStatusControl(customer)}</td><td><div class="cell-main mono">${escapeHtml(customer.updatedAt.slice(5))}</div><div class="cell-sub note-preview">${escapeHtml(customer.note)}</div></td><td>${currentAccount.role === 'SALE' && !customer.saleAcceptedAt ? `<button class="button button-small button-primary" data-accept-data="${escapeHtml(customer.id)}">Nhận data</button>` : ''}<button class="button button-small" data-open-customer="${escapeHtml(customer.id)}">Chi tiết</button></td></tr>`; }).join('') || `<tr><td colspan="${columnCount}"><div class="empty"><b>Không tìm thấy khách hàng</b><span>Hãy thử từ khóa hoặc bộ lọc khác.</span></div></td></tr>`}</tbody></table></div>${customerPagination}</section>${currentAccount.role === 'ADMIN' ? `<section class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Lịch sử kết nối & cập nhật data</div></div><button class="button button-small" id="importCustomersSecondaryButton">+ Nguồn data</button></div><div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Nguồn</th><th>File / Endpoint</th><th>Số bản ghi</th><th>Người thực hiện</th><th>Trạng thái</th></tr></thead><tbody>${state.imports.slice(0, 8).map(item => `<tr><td class="mono">${escapeHtml(item.importedAt)}</td><td><b>${escapeHtml(item.source)}</b></td><td>${escapeHtml(item.filename)}</td><td>${number(item.records)}</td><td>${escapeHtml(item.actor)}</td><td>${item.status === 'SUCCESS' ? '<span class="status status-paid">Thành công</span>' : '<span class="status status-cancelled">Thất bại</span>'}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
}

// Ty trong rieng trong Team, khong thay doi ty trong Admin chia xuong Leader.
function updateTeamRecipient(id, field, value) {
  if(currentAccount.role!=='LEADER')return;
  const people=teamRecipients(currentAccount.leaderId,currentAccount.teamId),person=people.find(p=>p.id===id);if(!person)return;
  const config=state.saleDistributionByLeader[currentAccount.leaderId] ||= {enabledSaleIds:people.filter(p=>!p.teamLeaderRecipient).map(p=>p.id),weights:{},leaderEnabled:true};
  config.weights ||= {};
  if(field==='weight'){const rawWeight=Number(value);config.weights[id]=Number.isFinite(rawWeight)?Math.max(0,Math.min(100,Math.round(rawWeight))):1;}
  else if(person.teamLeaderRecipient)config.leaderEnabled=value;
  else {const ids=new Set(config.enabledSaleIds||people.filter(p=>!p.teamLeaderRecipient).map(p=>p.id));value?ids.add(id):ids.delete(id);config.enabledSaleIds=[...ids];}
  saveState();render();
}
function scopedRoleDataView() {
  const role=currentAccount.actualRole||currentAccount.role;
  const rows=scopedCustomers().filter(customer=>isWebhookIntakeCustomer(customer)&&!['ARCHIVED','LOST','PAID'].includes(customer.status)).sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
  const visibleRows=rows.map((customer,index)=>{const offer=state.dataOffers.filter(item=>item.customerId===customer.id).sort((a,b)=>String(b.offeredAt||'').localeCompare(String(a.offeredAt||'')))[0];const type=offer?.status==='EXPIRED'&&!customer.saleId?'DATA TR\u1ea2 V\u1ec0':customer.updatedAt!==customer.createdAt?'DATA \u0110I\u1ec0N L\u1ea0I FORM':'DATA M\u1edaI';const status=offer?.status==='PENDING'?'Ch\u1edd Sale nh\u1eadn':offer?.status==='EXPIRED'&&!customer.saleId?'Data Sale kh\u00f4ng nh\u1eadn':customer.saleId?'Sale \u0111\u00e3 nh\u1eadn':'Ch\u01b0a ch\u1ecdn Sale';const typeClass=type==='DATA TR\u1ea2 V\u1ec0'?'status-cancelled':type==='DATA \u0110I\u1ec0N L\u1ea0I FORM'?'status-info':'status-pending';return '<tr><td><b>#'+(index+1)+'</b></td><td><b>'+escapeHtml(dataDateParts(customer.createdAt).date)+'</b><small>'+escapeHtml(dataDateParts(customer.createdAt).time)+'</small></td><td><b>'+escapeHtml(customer.name)+'</b><small>'+escapeHtml(customer.phone||'')+'</small></td><td><span class="status '+typeClass+'">'+type+'</span></td><td>'+quickSaleControl(customer)+'</td><td><span class="status '+(status==='Sale \u0111\u00e3 nh\u1eadn'?'status-paid':status==='Data Sale kh\u00f4ng nh\u1eadn'?'status-cancelled':'status-pending')+'">'+escapeHtml(status)+'</span></td></tr>';}).join('')||'<tr><td colspan="6"><div class="empty"><b>Kh\u00f4ng c\u00f3 data ch\u01b0a x\u1eed l\u00fd</b></div></td></tr>';
  return pageHead('Data','Data trong ph\u1ea1m vi '+(role==='MANAGER'?'tuy\u1ebfn Manager':'Team Leader'),'')+'<section class="panel customer-table-panel"><div class="panel-head"><div><div class="panel-title">Data ch\u01b0a x\u1eed l\u00fd</div></div></div><div class="table-wrap"><table class="intake-order-table"><thead><tr><th>TH\u1ee8 T\u1ef0</th><th>NG\u00c0Y DATA</th><th>KH\u00c1CH H\u00c0NG</th><th>LO\u1ea0I DATA</th><th>SALE NH\u1eacN</th><th>TR\u1ea0NG TH\u00c1I</th></tr></thead><tbody>${visibleRows}</tbody></table></div></section>';
}

function poolView() {
  if (currentAccount.role === 'SALE') return accessDeniedView('Khách mới chỉ dành cho Admin và Leader.');
  if(['MANAGER','LEADER'].includes(currentAccount.actualRole||currentAccount.role)) return scopedRoleDataView();
  const pool = scopedCustomers().filter(isPoolCustomer).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const targets = currentAccount.role === 'ADMIN'
    ? assignmentCandidates({ leaderId: null })
    : assignmentCandidates({ leaderId: currentAccount.leaderId, teamId: currentAccount.teamId });
  const targetLabel = currentAccount.role === 'ADMIN' ? 'Leader' : 'Sale';
  const automaticMode = currentAccount.role === 'ADMIN' ? state.settings.assignmentMode : state.settings.saleAssignmentModes[currentAccount.leaderId] || 'MANUAL';
  return pageHead(`Khách mới · ${pool.length}`, 'Data chưa phân được hiển thị bằng số trên menu; sau khi giao sẽ chuyển sang Khách hàng tổng.', '') +
    `<div class="grid grid-2"><section class="panel"><div class="panel-head"><div><div class="panel-title">Khách mới đang chờ phân</div><div class="panel-sub">${pool.length} bản ghi phù hợp phạm vi tài khoản</div></div>${pool.length ? '<button class="button button-small" id="selectPoolButton" type="button">Chọn tất cả</button>' : ''}</div><div class="panel-body">${pool.map(customer => `<label class="rank-row" style="grid-template-columns:24px minmax(0,1fr) auto"><input style="width:auto" type="checkbox" data-pool-id="${escapeHtml(customer.id)}" ${selectedPoolIds.has(customer.id) ? 'checked' : ''}><div><b>${escapeHtml(customer.name)}</b><small>${currentAccount.role === 'ADMIN' ? escapeHtml(customerLandingName(customer)) : escapeHtml(customer.phone || '')}</small><div class="cell-sub">${currentAccount.role === 'ADMIN' ? `${escapeHtml(customer.source)} · ` : ''}${escapeHtml(customer.createdAt)} · ${escapeHtml(customer.note)}</div></div>${statusBadge(customer.status)}</label>`).join('') || `<div class="empty"><b>Không còn khách mới</b><span>Tất cả data trong phạm vi đã được phân.</span></div>`}</div></section>
    <aside class="panel"><div class="panel-head"><div><div class="panel-title">Phân data cho ${targetLabel}</div><div class="panel-sub">${currentAccount.role === 'LEADER' ? `Chỉ nhân sự thuộc Team ${escapeHtml(currentAccount.teamId)}` : 'Admin phân theo đúng tuyến quản lý'}</div></div></div><div class="panel-body">
      <div class="section-label">Tự động cho data mới</div><label class="form-field">Chế độ<select id="assignmentModeSelect"><option value="MANUAL" ${automaticMode === 'MANUAL' ? 'selected' : ''}>Thủ công</option><option value="EQUAL" ${automaticMode === 'EQUAL' || automaticMode === 'ROUND_ROBIN' ? 'selected' : ''}>Chia đều</option><option value="BALANCED" ${automaticMode === 'BALANCED' ? 'selected' : ''}>Chia theo tỷ trọng</option></select></label><div class="connection-actions" style="margin:12px 0 18px"><button class="button button-small" data-bulk-distribute="EQUAL" ${!pool.length || !targets.length ? 'disabled' : ''}>Chia đều</button><button class="button button-small button-primary" data-bulk-distribute="BALANCED" ${!pool.length || !targets.length ? 'disabled' : ''}>Chia theo tỷ trọng</button></div>
      <div class="section-label">Phân thủ công bản ghi đã chọn</div><label class="form-field">${targetLabel} nhận khách<select id="poolTarget">${targets.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)} · ${escapeHtml(person.teamId)}</option>`).join('')}</select></label><label class="form-field" style="margin-top:12px">Lý do<textarea id="poolReason" rows="4" placeholder="Ví dụ: Data từ chiến dịch tháng 9"></textarea></label><button id="assignPoolButton" class="button button-primary button-block" style="margin-top:13px" type="button" ${!targets.length ? 'disabled' : ''}>Phân cho ${targetLabel}</button><div class="credential-hint">Sau khi phân, data chuyển sang Khách hàng tổng; nguồn, campaign và landing page vẫn được giữ nguyên.</div></div></aside></div>`;
}

function distributionView() {
  if (currentAccount.role !== 'ADMIN') return accessDeniedView('Chỉ Admin được cấu hình chia Leader và tỷ trọng nhận data.');
  const leaders = activeStaff().filter(member => member.role === 'LEADER').sort((a, b) => a.id.localeCompare(b.id));
  if (!leaders.some(leader => leader.id === distributionLeaderId)) distributionLeaderId = leaders[0]?.id || '';
  const selectedLeader = leaders.find(leader => leader.id === distributionLeaderId);
  const sales = selectedLeader ? teamRecipients(selectedLeader.id, selectedLeader.teamId) : [];
  const enabledLeaders = new Set(state.leaderDistribution.enabledLeaderIds);
  const saleConfig = state.saleDistributionByLeader[distributionLeaderId] || { enabledSaleIds: [], weights: {} };
  const enabledSales = new Set(saleConfig.enabledSaleIds);
  const pool = state.customers.filter(customer => !customer.saleId && !customer.leaderId && !customer.teamId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const intakeRows = [
    ...state.customers.filter(isWebhookIntakeCustomer).map(customer => ({ id: `NEW:${customer.id}`, at: customer.createdAt, customer, kind: 'NEW', source: customer.source, campaign: customer.campaign })),
    ...state.resubmissions.map(item => ({ id: `RETURN:${item.id}`, at: item.at, customer: customerById(item.customerId), kind: 'RETURN', source: item.source, campaign: item.campaign, registeredAccount: item.registeredAccount }))
  ].filter(item => item.customer).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).slice(0, 60);
  const tabs = [[`QUEUE`, `Thứ tự data mới vào (${pool.length})`], [`AUTO`, `Tự động`], [`LEADERS`, `Danh sách Leader`], [`SALES`, `Sale theo Leader`]];
  let body = '';
  if (distributionTab === 'QUEUE') {
    body = `<div class="grid grid-2 distribution-queue-layout"><section class="panel"><div class="panel-head"><div><div class="panel-title">Thứ tự data mới vào</div><div class="panel-sub">Mới nhất ở trên · gồm data mới và khách điền lại form</div></div>${pool.length ? '<button class="button button-small" id="selectPoolButton" type="button">Chọn tất cả đang chờ</button>' : ''}</div><div class="table-wrap"><table class="intake-order-table"><thead><tr><th>Thứ tự</th><th>Ngày data</th><th>Khách hàng</th><th>Loại data</th><th>Nguồn</th><th>Đang phụ trách</th></tr></thead><tbody>${intakeRows.map((item, index) => { const customer = item.customer; const dataDate = dataDateParts(item.at); const waiting = item.kind === 'NEW' && !customer.saleId && !customer.leaderId; return `<tr class="${waiting ? 'queue-waiting' : ''}"><td><div class="queue-sequence">#${index + 1}</div>${waiting ? `<input type="checkbox" data-pool-id="${escapeHtml(customer.id)}" ${selectedPoolIds.has(customer.id) ? 'checked' : ''} aria-label="Chọn ${escapeHtml(customer.name)}">` : ''}</td><td class="data-date-cell"><b>${escapeHtml(dataDate.date)}</b><small>${escapeHtml(dataDate.time)}</small></td><td><div class="cell-main">${escapeHtml(customer.name)}</div><div class="cell-sub">${escapeHtml(customer.phone)}</div></td><td>${item.kind === 'RETURN' ? `<span class="status ${item.registeredAccount ? 'status-cancelled' : 'status-info'}">${item.registeredAccount ? 'Trùng · Đã đăng ký TK' : 'Điền lại form'}</span>` : waiting ? '<span class="status status-pending">Chờ chia Leader</span>' : '<span class="status status-paid">Data mới</span>'}</td><td>${(() => { const source = customerSourceDetails(customer); const campaign = item.campaign && item.campaign !== 'UNATTRIBUTED' ? item.campaign : ''; return `<div class="cell-main">${escapeHtml(source.name)}</div><div class="cell-sub mono">${escapeHtml(source.url || source.domain || (customer.webhookSlug ? `Webhook ${customer.webhookSlug}` : 'Chưa gắn URL nguồn'))}</div><div class="cell-sub">${escapeHtml([item.source, campaign].filter(Boolean).join(' · '))}</div>`; })()}</td><td>${quickSaleControl(customer)}</td></tr>`; }).join('') || '<tr><td colspan="6"><div class="empty"><b>Chưa có data</b><span>Data mới từ form/API sẽ xuất hiện theo thời gian tại đây.</span></div></td></tr>'}</tbody></table></div></section><aside class="panel queue-assignment-panel"><div class="panel-head"><div><div class="panel-title">Xử lý hàng chờ</div><div class="panel-sub">${pool.length} data chưa có Leader · ưu tiên cũ nhất trước</div></div></div><div class="panel-body">${webhookQueueNoticeMarkup()}<div class="connection-actions" style="margin:0 0 18px"><button class="button button-small" data-bulk-distribute="EQUAL" ${!pool.length || !enabledLeaders.size ? 'disabled' : ''}>Chia đều</button><button class="button button-small button-primary" data-bulk-distribute="BALANCED" ${!pool.length || !enabledLeaders.size ? 'disabled' : ''}>Chia theo tỷ trọng</button></div><label class="form-field">Leader nhận data<select id="poolTarget">${leaders.filter(leader => enabledLeaders.has(leader.id)).map(leader => `<option value="${escapeHtml(leader.id)}">${escapeHtml(leader.name)} · ${escapeHtml(leader.teamId)}</option>`).join('')}</select></label><label class="form-field" style="margin-top:12px">Lý do<textarea id="poolReason" rows="3" placeholder="Phân theo thứ tự data vào">Phân theo thứ tự data vào</textarea></label><button id="assignPoolButton" class="button button-primary button-block" style="margin-top:13px" type="button" ${!pool.length || !enabledLeaders.size ? 'disabled' : ''}>Phân data đã chọn</button></div></aside></div>`;
  } else if (distributionTab === 'AUTO') {
    body = `<div class="grid grid-2"><section class="panel"><div class="panel-head"><div><div class="panel-title">Cơ chế chia data mới</div></div><button class="toggle ${state.leaderDistribution.enabled ? 'on' : ''}" id="toggleLeaderDistribution" aria-pressed="${state.leaderDistribution.enabled}" aria-label="Bật tắt chia Leader"></button></div><div class="panel-body"><label class="form-field">Chế độ mặc định<select id="assignmentModeSelect"><option value="MANUAL" ${state.settings.assignmentMode === 'MANUAL' ? 'selected' : ''}>Thủ công</option><option value="EQUAL" ${state.settings.assignmentMode === 'EQUAL' || state.settings.assignmentMode === 'ROUND_ROBIN' ? 'selected' : ''}>Chia đều</option><option value="BALANCED" ${state.settings.assignmentMode === 'BALANCED' ? 'selected' : ''}>Chia theo tỷ trọng</option></select></label></div></section><section class="panel"><div class="panel-head"><div><div class="panel-title">Tình trạng phân phối</div></div></div><div class="panel-body"><div class="stat-row"><div><small>Leader hoạt động</small><b>${enabledLeaders.size}/${leaders.length}</b></div><div><small>Chế độ hiện tại</small><b>${state.settings.assignmentMode === 'MANUAL' ? 'Thủ công' : state.settings.assignmentMode === 'BALANCED' ? 'Theo tỷ trọng' : 'Chia đều'}</b></div><div><small>Khách đang chờ</small><b>${state.customers.filter(customer => !customer.leaderId && !customer.saleId).length}</b></div></div></div></section></div>`;  } else if (distributionTab === 'LEADERS') {
    body = `<section class="panel"><div class="panel-head"><div><div class="panel-title">Leader nhận data</div><div class="panel-sub">Bật/tắt và đặt tỷ trọng riêng cho từng Leader</div></div></div><div class="field-manager">${leaders.map(leader => { const saleCount = activeStaff().filter(member => member.role === 'SALE' && member.leaderId === leader.id).length; return `<div class="field-manager-row"><div class="avatar">${escapeHtml(leader.initials)}</div><div><b>${escapeHtml(leader.name)}</b><small>${escapeHtml(leader.teamId)} · ${saleCount} Sale · đang phụ trách ${assignmentLoad(leader)} khách</small></div><label class="weight-control">Tỷ trọng<input class="weight-input" type="number" min="0" max="100" value="${state.leaderDistribution.weights[leader.id] ?? 1}" data-distribution-weight="LEADER:${escapeHtml(leader.id)}"></label><label class="member-switch"><input type="checkbox" data-distribution-member="LEADER:${escapeHtml(leader.id)}" ${enabledLeaders.has(leader.id) ? 'checked' : ''}><span>${enabledLeaders.has(leader.id) ? 'Đang nhận' : 'Tạm tắt'}</span></label></div>`; }).join('') || '<div class="empty"><b>Chưa có Leader</b><span>Thêm Leader tại mục Đội ngũ trước.</span></div>'}</div></section>`;
  } else {
    body = `<section class="panel"><div class="panel-head"><div><div class="panel-title">Sale nhận data trong từng Team</div><div class="panel-sub">Manager, Leader và Sale trong tuyến đều có thể được bật để nhận data</div></div><select id="distributionLeaderSelect">${leaders.map(leader => `<option value="${escapeHtml(leader.id)}" ${leader.id === distributionLeaderId ? 'selected' : ''}>${escapeHtml(leader.name)} · ${escapeHtml(leader.teamId)}</option>`).join('')}</select></div><div class="field-manager">${sales.map(sale => { const isManager = sale.managerRecipient; const isLeader = sale.teamLeaderRecipient; const enabled = isLeader ? saleConfig.leaderEnabled !== false : (saleConfig.managerDistributionInitialized !== true || enabledSales.has(sale.id)); return `<div class="field-manager-row"><div class="avatar">${escapeHtml(sale.initials)}</div><div><b>${escapeHtml(sale.name)}</b><small>${isManager ? 'MANAGER' : isLeader ? 'LEADER' : 'SALE'} · ${escapeHtml(sale.teamId || '')} · đang phụ trách ${assignmentLoad(sale)} khách</small></div><label class="weight-control">Tỷ trọng<input class="weight-input" type="number" min="0" max="100" value="${saleConfig.weights[sale.id] ?? 1}" data-distribution-weight="${isManager ? 'MANAGER' : 'SALE'}:${escapeHtml(sale.id)}"></label><label class="member-switch"><input type="checkbox" data-distribution-member="${isManager ? 'MANAGER' : 'SALE'}:${escapeHtml(sale.id)}" ${enabled ? 'checked' : ''}><span>${enabled ? 'Đang nhận' : 'Tạm tắt'}</span></label></div>`; }).join('') || '<div class="empty"><b>Chưa có nhân sự trong tuyến</b><span>Thêm Manager, Leader hoặc Sale tại mục Đội ngũ.</span></div>'}</div></section>`;
  }
  return pageHead('Data', 'Phân data cho Leader và Sale; lịch sử phụ trách cũ luôn được giữ.') + `<div class="distribution-tabs">${tabs.map(([id, label]) => `<button class="distribution-tab ${distributionTab === id ? 'active' : ''}" data-distribution-tab="${id}">${label}</button>`).join('')}</div>${body}`;
}

async function toggleLeaderDistribution() {
  if (currentAccount.role !== 'ADMIN') return;
  state.leaderDistribution.enabled = !state.leaderDistribution.enabled;
  if (state.leaderDistribution.enabled && state.settings.assignmentMode === 'MANUAL') state.settings.assignmentMode = 'EQUAL';
  saveState();
  if (await flushServerPersistence()) { render(); toast('Đã lưu chế độ chia data trên máy chủ'); }
}

function updateDistributionMember(kind, id, enabled) {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được cấu hình chia data'); return; }
  if (kind === 'LEADER') {
    const ids = new Set(state.leaderDistribution.enabledLeaderIds);
    enabled ? ids.add(id) : ids.delete(id);
    state.leaderDistribution.enabledLeaderIds = Array.from(ids);
  } else {
    const raw = activeStaff().find(member => member.id === id);
    const sale = raw?.role === 'LEADER'
      ? {...raw,leaderId:raw.id,teamLeaderRecipient:true}
      : raw?.role === 'MANAGER'
        ? teamRecipients(distributionLeaderId, activeStaff().find(member => member.id === distributionLeaderId)?.teamId).find(member => member.id === id)
        : raw;
    if (!sale) return;
    const config = state.saleDistributionByLeader[sale.leaderId] || (state.saleDistributionByLeader[sale.leaderId] = { enabledSaleIds: [], weights: {} });
    config.managerDistributionInitialized = true;
    if (sale.teamLeaderRecipient) config.leaderEnabled = enabled;
    const ids = new Set(config.enabledSaleIds);
    enabled ? ids.add(id) : ids.delete(id);
    config.enabledSaleIds = Array.from(ids);
  }
  audit('UPDATE_DISTRIBUTION_MEMBER', id, `${kind} · ${enabled ? 'bật nhận data' : 'tắt nhận data'}`);
  saveState(); render();
}

function updateDistributionWeight(kind, id, value) {
  if (currentAccount.role !== 'ADMIN') return;
  const rawWeight = Number(value); const weight = Number.isFinite(rawWeight) ? Math.max(0, Math.min(100, Math.round(rawWeight))) : 1;
  if (kind === 'LEADER') state.leaderDistribution.weights[id] = weight;
  else {
    const raw = activeStaff().find(member => member.id === id);
    const sale = raw?.role === 'LEADER'
      ? {...raw,leaderId:raw.id,teamLeaderRecipient:true}
      : raw?.role === 'MANAGER'
        ? teamRecipients(distributionLeaderId, activeStaff().find(member => member.id === distributionLeaderId)?.teamId).find(member => member.id === id)
        : raw;
    if (!sale) return;
    const config = state.saleDistributionByLeader[sale.leaderId] || (state.saleDistributionByLeader[sale.leaderId] = { enabledSaleIds: [], weights: {} });
    config.managerDistributionInitialized = true;
    config.weights[id] = weight;
  }
  audit('UPDATE_DISTRIBUTION_WEIGHT', id, `${kind} · tỷ trọng ${weight}`);
  saveState(); render(); toast('Đã cập nhật tỷ trọng');
}

function addDistributionSourceRule() {
  if (currentAccount.role !== 'ADMIN') return;
  const matchType = $('#distributionRuleType')?.value, matchValue = $('#distributionRuleValue')?.value.trim(), targetLeaderId = $('#distributionRuleLeader')?.value;
  if (!['WEBSITE', 'SOURCE', 'CAMPAIGN'].includes(matchType) || !matchValue || !state.leaderDistribution.enabledLeaderIds.includes(targetLeaderId)) { toast('Điều kiện hoặc Leader nhận chưa hợp lệ'); return; }
  const duplicate = state.leaderDistribution.sourceRules.some(rule => rule.matchType === matchType && normalize(rule.matchValue) === normalize(matchValue));
  if (duplicate) { toast('Điều kiện này đã có luật phân phối'); return; }
  state.leaderDistribution.sourceRules.push({ id: `RULE-${Date.now()}`, matchType, matchValue: matchValue.slice(0, 200), targetLeaderId, active: true });
  audit('CREATE_DISTRIBUTION_RULE', targetLeaderId, `${matchType}:${matchValue}`);
  saveState(); render(); toast('Đã thêm luật chia theo nguồn');
}

function toggleDistributionSourceRule(id) {
  if (currentAccount.role !== 'ADMIN') return;
  const rule = state.leaderDistribution.sourceRules.find(item => item.id === id);
  if (!rule) return;
  rule.active = !rule.active;
  audit('TOGGLE_DISTRIBUTION_RULE', id, rule.active ? 'Bật' : 'Tắt');
  saveState(); render();
}

function deleteDistributionSourceRule(id) {
  if (currentAccount.role !== 'ADMIN') return;
  const rule = state.leaderDistribution.sourceRules.find(item => item.id === id);
  if (!rule || !window.confirm('Xóa luật chia theo nguồn này? Lịch sử khách đã phân không bị thay đổi.')) return;
  state.leaderDistribution.sourceRules = state.leaderDistribution.sourceRules.filter(item => item.id !== id);
  audit('DELETE_DISTRIBUTION_RULE', id, `${rule.matchType}:${rule.matchValue}`);
  saveState(); render(); toast('Đã xóa luật; lịch sử phân công vẫn còn');
}

function ordersView() {
  const query = normalize(globalQuery);
  const allOrders = scopedOrders().filter(order => orderStatusFilter === 'ALL' || order.status === orderStatusFilter).filter(order => !query || normalize(`${order.code}${order.customerName}${order.productName}${currentAccount.role === 'ADMIN' ? order.source : ''}`).includes(query)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const orders = allOrders.filter(order => {
    if (orderTypeFilter === 'ALL') return true;
    const isRent = /thuê|rent|thue|chỉ báo|indicator|bot|tool|vip/i.test(order.productName || order.product || '');
    return orderTypeFilter === 'RENT' ? isRent : !isRent;
  });
  const orderTypeTabs = `<div class="subnav-tabs" style="display:flex;gap:8px;margin-bottom:14px;border-bottom:1px solid var(--line,#e2e8f0);padding-bottom:10px;">
    <button type="button" class="tab-item ${orderTypeFilter === 'ALL' ? 'active' : ''}" onclick="orderTypeFilter='ALL';render();" style="border:none;background:${orderTypeFilter==='ALL'?'var(--primary,#2563eb)':'var(--bg-subtle,#f1f5f9)'};font-weight:${orderTypeFilter==='ALL'?'700':'500'};color:${orderTypeFilter==='ALL'?'#fff':'var(--text-muted,#64748b)'};padding:6px 14px;border-radius:6px;cursor:pointer;">
      📦 Tất cả đơn (${allOrders.length})
    </button>
    <button type="button" class="tab-item ${orderTypeFilter === 'SELL' ? 'active' : ''}" onclick="orderTypeFilter='SELL';render();" style="border:none;background:${orderTypeFilter==='SELL'?'#16a34a':'var(--bg-subtle,#f1f5f9)'};font-weight:${orderTypeFilter==='SELL'?'700':'500'};color:${orderTypeFilter==='SELL'?'#fff':'var(--text-muted,#64748b)'};padding:6px 14px;border-radius:6px;cursor:pointer;">
      Bên Bán (Khóa học & SP)
    </button>
    <button type="button" class="tab-item ${orderTypeFilter === 'RENT' ? 'active' : ''}" onclick="orderTypeFilter='RENT';render();" style="border:none;background:${orderTypeFilter==='RENT'?'#0284c7':'var(--bg-subtle,#f1f5f9)'};font-weight:${orderTypeFilter==='RENT'?'700':'500'};color:${orderTypeFilter==='RENT'?'#fff':'var(--text-muted,#64748b)'};padding:6px 14px;border-radius:6px;cursor:pointer;">
      Cho thuê chỉ báo
    </button>
  </div>`;

  return pageHead(currentAccount.role === 'SALE' ? 'Tạo đơn cho khách' : 'Quản lý đơn hàng', '', `${currentAccount.role !== 'SALE' ? '<button class="button" id="exportOrdersButton" type="button">Xuất CSV</button>' : ''}<button class="button button-primary" id="newOrderButton" type="button">+ Tạo đơn cho khách</button>`) +
    orderTypeTabs +
    `<section class="panel"><div class="toolbar"><input id="orderSearch" type="search" placeholder="Mã đơn, khách, sản phẩm..." value="${escapeHtml(globalQuery)}"><select id="orderStatusFilter"><option value="ALL">Tất cả thanh toán</option>${Object.entries(ORDER_STATUS).map(([key, meta]) => `<option value="${key}" ${orderStatusFilter === key ? 'selected' : ''}>${meta[0]}</option>`).join('')}</select><span class="spacer"></span><span class="data-note">${orders.length} đơn hiển thị</span></div>${ordersTable(orders, true)}</section>`;
}

function productAvailabilityMeta(product) {
  const rental = product.type === 'RENTAL';
  if (product.active !== false) return { status: rental ? 'Đang cho thuê' : 'Đang bán', action: rental ? 'Ngừng cho thuê' : 'Ngừng bán' };
  return { status: rental ? 'Ngừng cho thuê' : 'Ngừng bán', action: rental ? 'Cho thuê lại' : 'Bán lại' };
}

function productsView() {
  if (currentAccount.role !== 'ADMIN') return accessDeniedView('Chỉ Admin được quản lý danh mục và sản phẩm.');
  const rows = PRODUCTS;
  const legacyCount=legacyProductCandidates().length;
  const actions = `${legacyCount?`<button class="button" id="restoreLegacyProductsButton">Khôi phục ${legacyCount} sản phẩm cũ</button>`:''}<button class="button" id="manageProductCategoriesButton">Danh mục</button><button class="button button-primary" id="newProductButton">+ Thêm sản phẩm</button>`;
  const body = rows.map(product => {
    const availability = productAvailabilityMeta(product);
    return `<tr><td><div class="cell-main">${escapeHtml(product.name)}</div></td><td class="mono">${escapeHtml(product.sku || '—')}</td><td><span class="status ${product.type === 'RENTAL' ? 'status-pending' : 'status-info'}">${product.type === 'RENTAL' ? 'Thuê' : 'Bán'}</span></td><td>${product.type === 'RENTAL' ? (product.rentalMonths || '—') + ' tháng' : '—'}</td><td>${escapeHtml(product.category)}</td><td><b>${money(product.price)}</b></td><td><span class="status ${product.active !== false ? 'status-active' : 'status-pending'}">${availability.status}</span></td><td><button class="button button-small" data-edit-product="${escapeHtml(product.id)}">Sửa</button><button class="button button-small" data-toggle-product="${escapeHtml(product.id)}">${availability.action}</button><button class="button button-small button-danger" data-delete-product="${escapeHtml(product.id)}">Xóa</button></td></tr>`;
  }).join('');
  return pageHead('Sản phẩm', 'Quản lý sản phẩm bán và sản phẩm cho thuê.', actions) +
    `<section class="panel"><div class="table-wrap"><table><thead><tr><th>Sản phẩm</th><th>Mã SKU</th><th>Loại</th><th>Gói thuê</th><th>Danh mục</th><th>Đơn giá</th><th>Trạng thái</th><th></th></tr></thead><tbody>${body || '<tr><td colspan="8"><div class="empty"><b>Chưa có sản phẩm</b><span>Admin cần tạo sản phẩm trước khi lập đơn.</span></div></td></tr>'}</tbody></table></div></section>`;
}

function productModal(id = null) {
  if (currentAccount.role !== 'ADMIN') return;
  const existing = id ? productById(id) : null;
  const item = existing || { name: '', sku: '', category: '', price: 0, type: 'SALE', rentalMonths: null, vatRate: 0.1 };
  const categories = [...state.productCategories];
  if (item.category && !categories.includes(item.category)) categories.push(item.category);
  openModal(existing ? 'Sửa sản phẩm' : 'Thêm sản phẩm', `<form id="productForm"><div class="form-grid"><label class="form-field">Tên sản phẩm *<input id="productName" required maxlength="200" value="${escapeHtml(item.name)}"></label><label class="form-field">Mã SKU<input id="productSku" maxlength="60" value="${escapeHtml(item.sku)}"></label><label class="form-field">Loại sản phẩm *<select id="productType"><option value="SALE" ${item.type !== 'RENTAL' ? 'selected' : ''}>Bán</option><option value="RENTAL" ${item.type === 'RENTAL' ? 'selected' : ''}>Thuê</option></select></label><label class="form-field">Gói thuê<select id="productRentalMonths"><option value="">Không áp dụng</option><option value="1" ${item.rentalMonths === 1 ? 'selected' : ''}>1 tháng</option><option value="3" ${item.rentalMonths === 3 ? 'selected' : ''}>3 tháng</option><option value="6" ${item.rentalMonths === 6 ? 'selected' : ''}>6 tháng</option><option value="12" ${item.rentalMonths === 12 ? 'selected' : ''}>12 tháng</option></select></label><label class="form-field">Danh mục *<select id="productCategory" required><option value="">Chọn danh mục</option>${categories.map(category => `<option value="${escapeHtml(category)}" ${category === item.category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select></label><label class="form-field">Đơn giá *<input id="productPrice" type="number" required min="0" step="1000" value="${item.price}"></label><label class="form-field">VAT (%)<input id="productVat" type="number" required min="0" max="100" step="0.01" value="${Number(item.vatRate ?? 0.1) * 100}"></label></div><div class="modal-actions"><button class="button" type="button" data-close-modal>Hủy</button><button class="button button-primary" type="submit">Lưu sản phẩm</button></div></form>`);
  const syncRental = () => { $('#productRentalMonths').disabled = $('#productType').value !== 'RENTAL'; if ($('#productType').value !== 'RENTAL') $('#productRentalMonths').value = ''; };
  $('#productType').addEventListener('change', syncRental); syncRental();
  $('#productForm').onsubmit = async event => {
    event.preventDefault();
    const type = $('#productType').value === 'RENTAL' ? 'RENTAL' : 'SALE';
    const rentalMonths = type === 'RENTAL' ? Number($('#productRentalMonths').value) : null;
    const vatPercent = Number($('#productVat').value); const values = { name: $('#productName').value.trim(), sku: $('#productSku').value.trim(), category: $('#productCategory').value.trim(), price: Number($('#productPrice').value), type, rentalMonths: [1,3,6,12].includes(rentalMonths) ? rentalMonths : null, vatRate: vatPercent / 100 };
    if (!values.name || !values.category || !Number.isFinite(values.price) || values.price < 0 || !Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 100) { toast('Kiểm tra tên, danh mục, đơn giá và VAT từ 0 đến 100%.'); return; }
    if (values.type === 'RENTAL' && !values.rentalMonths) { toast('Sản phẩm thuê phải chọn gói 1, 3, 6 hoặc 12 tháng'); return; }
    if (values.sku && PRODUCTS.some(product => product.id !== id && product.sku && normalize(product.sku) === normalize(values.sku))) { toast('Mã SKU đã tồn tại'); return; }
    const product = existing || { id: `PRD-${Date.now()}`, ...values, active: true };
    if (existing) Object.assign(existing, values); else PRODUCTS.unshift(product);
    state.products = PRODUCTS;
    if (!await pushServerRecord('products', 'POST', null, product)) { toast('Không thể lưu sản phẩm lên MySQL'); return; }
    audit(existing ? 'EDIT_PRODUCT' : 'CREATE_PRODUCT', product.id, values.name); saveState(); closeModal(); render();
  };
}
async function toggleProduct(id) {
  if (currentAccount.role !== 'ADMIN') return;
  const product = productById(id); if (!product) return;
  product.active = product.active === false;
  state.products = PRODUCTS;
  audit('TOGGLE_PRODUCT', id, productAvailabilityMeta(product).status);
  saveState(); render();
}

async function deleteProduct(id) {
  if (currentAccount.role !== 'ADMIN') return;
  const product = productById(id);
  if (!product || !window.confirm(`Xóa sản phẩm "${product.name}"? Các đơn hàng cũ vẫn giữ nguyên thông tin đã ghi nhận.`)) return;
  PRODUCTS = PRODUCTS.filter(item => item.id !== id);
  state.products = PRODUCTS;
  audit('DELETE_PRODUCT', id, product.name);
  if (!await pushServerRecord('products', 'POST', null, { ...product, active: false })) { toast('Không thể lưu trạng thái sản phẩm trên MySQL'); return; }
  saveState(); render();
}

function productCategoriesModal() {
  if (currentAccount.role !== 'ADMIN') return;
  openModal('Quản lý danh mục', `<form id="newProductCategoryForm" class="inline-form"><input id="newProductCategory" required maxlength="100" placeholder="Tên danh mục mới"><button class="button button-primary" type="submit">+ Thêm</button></form><div class="field-manager" style="padding:14px 0 0">${state.productCategories.map((category, index) => `<div class="field-manager-row"><input data-category-name="${index}" maxlength="100" value="${escapeHtml(category)}"><button class="button button-small" type="button" data-save-category="${index}">Lưu</button><button class="button button-small button-danger" type="button" data-delete-category="${index}">Xóa</button></div>`).join('')}</div>`);
  $('#newProductCategoryForm').onsubmit = event => { event.preventDefault(); const name = $('#newProductCategory').value.trim(); if (!name || state.productCategories.some(item => normalize(item) === normalize(name))) return; state.productCategories.push(name); saveState(); productCategoriesModal(); };
  $$('[data-save-category]').forEach(button => button.onclick = () => { const index = Number(button.dataset.saveCategory), oldName = state.productCategories[index], name = $(`[data-category-name="${index}"]`).value.trim(); if (!name) return; state.productCategories[index] = name; PRODUCTS.forEach(product => { if (product.category === oldName) product.category = name; }); state.products = PRODUCTS; saveState(); productCategoriesModal(); });
  $$('[data-delete-category]').forEach(button => button.onclick = () => { const index = Number(button.dataset.deleteCategory), name = state.productCategories[index]; if (PRODUCTS.some(product => product.category === name)) { toast('Danh mục đang có sản phẩm, hãy đổi danh mục sản phẩm trước'); return; } state.productCategories.splice(index, 1); saveState(); productCategoriesModal(); });
}

function revenueView() {
  const current = periodSnapshot(), series = dailySeries(), products = productPerformance(scopedOrders()).filter(product => product.paidOrders || product.refunds), sources = sourcePerformance();

  // Tính toán cơ cấu doanh thu Bên Bán / Bên Thuê thật
  const paidOrders = (current.paid || []);
  const sellOrders = paidOrders.filter(order => !/thuê|rent|thue|chỉ báo|indicator|bot|tool|vip/i.test(order.productName || order.product || ''));
  const rentOrders = paidOrders.filter(order => /thuê|rent|thue|chỉ báo|indicator|bot|tool|vip/i.test(order.productName || order.product || ''));
  const sellRev = sellOrders.reduce((sum, order) => sum + Number(order.paidAmount || order.total || 0), 0);
  const rentRev = rentOrders.reduce((sum, order) => sum + Number(order.paidAmount || order.total || 0), 0);
  const totRev = sellRev + rentRev || (current.revenue || 0);
  const sellPct = totRev > 0 ? Math.round((sellRev / totRev) * 100) : 50;
  const rentPct = 100 - sellPct;
  const circum = 2 * Math.PI * 40;
  const sellDash = (sellPct / 100) * circum;
  const rentDash = circum - sellDash;

  const revenueAnalysisCard = `<section class="panel" style="margin-bottom:20px;border-radius:12px;border:1px solid var(--line,#e2e8f0);box-shadow:0 1px 3px rgba(0,0,0,0.03);background:var(--panel,#ffffff);padding:18px 22px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div>
        <h3 style="margin:0;font-size:15px;font-weight:700;color:var(--text-main,#0f172a);display:flex;align-items:center;gap:8px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#2563eb;"></span>
          Phân Tích Doanh Thu
        </h3>
        <p style="margin:2px 0 0;font-size:12px;color:var(--text-muted,#64748b);">Thống kê cơ cấu doanh thu Bên Bán và Bên Thuê theo kỳ lọc</p>
      </div>
      <div class="segmented" style="display:inline-flex;">
        <button class="segment ${dateRange === 1 ? 'active' : ''}" data-range="1" type="button" style="font-size:11.5px;padding:4px 10px;">1 ngày</button>
        <button class="segment ${dateRange === 7 ? 'active' : ''}" data-range="7" type="button" style="font-size:11.5px;padding:4px 10px;">7 ngày</button>
        <button class="segment ${dateRange === 15 ? 'active' : ''}" data-range="15" type="button" style="font-size:11.5px;padding:4px 10px;">15 ngày</button>
        <button class="segment ${dateRange === 30 ? 'active' : ''}" data-range="30" type="button" style="font-size:11.5px;padding:4px 10px;">30 ngày</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:center;">
      <div style="position:relative;width:110px;height:110px;display:flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 100 100" width="110" height="110" style="transform:rotate(-90deg);">
          <circle cx="50" cy="50" r="40" fill="transparent" stroke="#f1f5f9" stroke-width="14" />
          <circle cx="50" cy="50" r="40" fill="transparent" stroke="#16a34a" stroke-width="14"
            stroke-dasharray="${sellDash} ${circum}" stroke-dashoffset="0" stroke-linecap="round" />
          <circle cx="50" cy="50" r="40" fill="transparent" stroke="#0284c7" stroke-width="14"
            stroke-dasharray="${rentDash} ${circum}" stroke-dashoffset="-${sellDash}" stroke-linecap="round" />
        </svg>
        <div style="position:absolute;text-align:center;">
          <div style="font-size:10px;color:var(--text-muted,#64748b);text-transform:uppercase;font-weight:700;">TỔNG</div>
          <div style="font-size:11px;font-weight:800;color:var(--text-main,#0f172a);font-family:var(--font-mono, monospace);">${money(totRev)}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="background:var(--bg-subtle,#f8fafc);padding:10px 14px;border-radius:8px;border-left:4px solid #16a34a;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <b style="font-size:12.5px;color:var(--text-main,#0f172a);">🛒 Bên Bán (Sản phẩm & Khóa học)</b>
            <span style="font-family:var(--font-mono, monospace);font-weight:800;color:#16a34a;font-size:13px;">${sellPct}%</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted,#64748b);margin-top:2px;">${money(sellRev)} · ${sellOrders.length} đơn hoàn tất</div>
        </div>
        <div style="background:var(--bg-subtle,#f8fafc);padding:10px 14px;border-radius:8px;border-left:4px solid #0284c7;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <b style="font-size:12.5px;color:var(--text-main,#0f172a);">⚡ Bên Thuê (Chỉ báo & Tool)</b>
            <span style="font-family:var(--font-mono, monospace);font-weight:800;color:#0284c7;font-size:13px;">${rentPct}%</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted,#64748b);margin-top:2px;">${money(rentRev)} · ${rentOrders.length} gói thuê đang chạy</div>
        </div>
      </div>
    </div>
  </section>`;
  const websites = websiteRevenuePerformance();
  const activeSources = sources.filter(source => source.paidOrders || source.revenue !== 0);
  const gross = current.paid.reduce((sum, order) => sum + order.subtotal, 0);
  const discounts = current.paid.reduce((sum, order) => sum + order.discount, 0);
  const refunds = current.refunds.reduce((sum, order) => sum + order.refund, 0);
  const sourceRevenueHtml = currentAccount.role === 'ADMIN' ? `<section class="panel"><div class="panel-head"><div><div class="panel-title">Doanh thu theo nguồn</div><div class="panel-sub">Attribution last-touch của đơn hàng</div></div></div><div class="panel-body">${activeSources.map((source, index) => { const share = current.revenue > 0 ? source.revenue / current.revenue * 100 : 0; return `<div class="rank-row"><span class="rank">${index + 1}</span><div><b>${escapeHtml(source.source)}</b><small>${source.paidOrders} đơn · ${share.toFixed(1).replace('.', ',')}% doanh thu</small><div class="progress"><i style="width:${Math.max(share, 0)}%;background:${source.color}"></i></div></div><div class="rank-value"><b>${money(source.revenue, true)}</b><small>${source.roas ? `${source.roas.toFixed(1)}x ROAS` : 'Organic'}</small></div></div>`; }).join('') || '<div class="empty"><b>Chưa có doanh thu theo nguồn</b><span>Không phát sinh thanh toán hoặc hoàn tiền trong kỳ.</span></div>'}</div></section>` : '';
  const websiteRevenueHtml = currentAccount.role === 'ADMIN' ? `<section class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Doanh thu theo website / landing page</div><div class="panel-sub">Quy nguồn bằng snapshot website trên đơn; dòng thiếu dữ liệu được tách riêng</div></div></div><div class="table-wrap"><table><thead><tr><th>Website / Landing</th><th>Data mới</th><th>Lượt thanh toán</th><th>Thu tiền</th><th>Hoàn tiền</th><th>Doanh thu thuần</th><th>Tỷ trọng</th></tr></thead><tbody>${websites.map(row => { const share = current.revenue > 0 ? row.net / current.revenue * 100 : 0; return `<tr><td><div class="cell-main">${escapeHtml(row.name)}</div><div class="cell-sub">${escapeHtml(row.domain)}</div></td><td>${number(row.data)}</td><td>${number(row.paidOrders)}</td><td>${money(row.gross)}</td><td>${money(row.refunds)}</td><td><b>${money(row.net)}</b></td><td>${share.toFixed(1).replace('.', ',')}%</td></tr>`; }).join('') || '<tr><td colspan="7"><div class="empty"><b>Chưa có doanh thu theo website</b><span>Chưa phát sinh data hoặc giao dịch trong kỳ.</span></div></td></tr>'}</tbody></table></div></section>` : '';
  const actualRole=currentAccount.actualRole||currentAccount.role;
  const revenueScopeDescription=actualRole==='MANAGER'?`Chỉ hiển thị doanh thu Team ${currentAccount.teamId||'được chọn'} thuộc tuyến Manager`:actualRole==='LEADER'?`Chỉ hiển thị doanh thu Team ${currentAccount.teamId||''} do bạn quản lý`:actualRole==='SALE'?'Chỉ hiển thị doanh thu từ khách hàng bạn phụ trách':'Đối chiếu doanh thu toàn hệ thống theo ngày thanh toán và hoàn tiền.';
  return pageHead(currentAccount.role === 'SALE' ? 'Doanh thu của tôi' : 'Doanh thu & thanh toán', revenueScopeDescription, currentAccount.role !== 'SALE' ? '<button class="button" id="exportRevenueButton" type="button">Xuất CSV</button>' : '') + dateFilter() + revenueAnalysisCard +
    `<div class="kpi-grid" style="grid-template-columns:repeat(4,minmax(150px,1fr))">${kpiCard('Σ', 'Doanh số gộp', money(gross, true), `${current.units} sản phẩm`)}${kpiCard('-', 'Chiết khấu', money(discounts, true), 'Đã trừ khỏi đơn')}${kpiCard('↩', 'Hoàn tiền', money(refunds, true), `${current.refunds.length} giao dịch`)}${kpiCard('₫', 'Doanh thu thuần', money(current.revenue, true), `${current.paid.length} lượt thanh toán`)}</div>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Dòng doanh thu theo ngày</div><div class="panel-sub">Ghi theo paidAt và trừ hoàn tiền đúng ngày refundedAt</div></div></div><div class="panel-body">${revenueChart(series, 300)}</div></section>
    <div class="grid ${currentAccount.role === 'ADMIN' ? 'grid-2' : ''}" style="margin-top:14px"><section class="panel"><div class="panel-head"><div><div class="panel-title">Chi tiết theo sản phẩm</div><div class="panel-sub">Đơn, số lượng, doanh thu và tỷ lệ hoàn</div></div></div><div class="table-wrap"><table><thead><tr><th>Sản phẩm / SKU</th><th>SL bán</th><th>Đơn</th><th>Doanh thu</th><th>Hoàn</th><th>So kỳ trước</th></tr></thead><tbody>${products.map(product => `<tr><td><div class="cell-main">${escapeHtml(product.name)}</div><div class="cell-sub">${escapeHtml(product.sku)} · ${escapeHtml(product.category)}</div></td><td>${product.units}</td><td>${product.paidOrders}</td><td><b>${money(product.revenue)}</b></td><td>${product.refunds}</td><td>${deltaBadge(delta(product.revenue, product.previousRevenue))}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty"><b>Chưa có sản phẩm bán ra</b><span>Không có thanh toán hoặc hoàn tiền trong kỳ.</span></div></td></tr>'}</tbody></table></div></section>${sourceRevenueHtml}</div>
    ${websiteRevenueHtml}
    <section class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Sổ giao dịch</div><div class="panel-sub">Mỗi lần thu và hoàn tiền là một dòng tài chính riêng</div></div></div>${transactionsTable(current.transactions.slice().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)))}</section>`;
}

function marketingView() {
  const customers = scopedCustomers().filter(customer => inCurrentPeriod(customer.createdAt));
  const productSales = productPerformance(scopedOrders()).filter(item => item.paidOrders || item.refunds);
  const makeDistribution = (key, fallback) => {
    const grouped = new Map();
    customers.forEach(customer => {
      const name = customer[key] || fallback;
      const item = grouped.get(name) || { name, data: 0, color: FIELD_COLORS[grouped.size % FIELD_COLORS.length] };
      item.data += 1;
      grouped.set(name, item);
    });
    return Array.from(grouped.values()).sort((a, b) => b.data - a.data);
  };
  return pageHead('\u0110\u1eef li\u1ec7u', 'Th\u1ed1ng k\u00ea data th\u1ef1c t\u1ebf theo landing page v\u00e0 s\u1ea3n ph\u1ea9m.') + dateFilter() +
    `<div class="grid grid-2"><section class="panel"><div class="panel-head"><div><div class="panel-title">Data theo landing page</div><div class="panel-sub">D\u1eef li\u1ec7u \u0111\u00e3 nh\u1eadp trong k\u1ef3</div></div></div><div class="panel-body">${distributionDonut(makeDistribution('landingPageName', 'Ch\u01b0a x\u00e1c \u0111\u1ecbnh landing page'), 'data', 'data')}</div></section><section class="panel"><div class="panel-head"><div><div class="panel-title">Doanh thu theo s\u1ea3n ph\u1ea9m</div><div class="panel-sub">S\u1ea3n ph\u1ea9m \u0111\u00e3 b\u00e1n trong k\u1ef3 \u00b7 x\u1ebfp theo doanh thu v\u00e0 s\u1ed1 l\u01b0\u1ee3ng</div></div></div><div class="table-wrap"><table><thead><tr><th>S\u1ea3n ph\u1ea9m</th><th>SL b\u00e1n</th><th>\u0110\u01a1n \u0111\u00e3 thanh to\u00e1n</th><th>Doanh thu</th><th>Ho\u00e0n</th></tr></thead><tbody>${productSales.map(item => '<tr><td><div class="cell-main">' + escapeHtml(item.name) + '</div><div class="cell-sub">' + escapeHtml(item.sku || '') + '</div></td><td>' + number(item.units) + '</td><td>' + number(item.paidOrders) + '</td><td><b>' + money(item.revenue) + '</b></td><td>' + number(item.refunds) + '</td></tr>').join('') || '<tr><td colspan="5"><div class="empty"><b>Ch\u01b0a c\u00f3 s\u1ea3n ph\u1ea9m b\u00e1n ra</b><span>Doanh thu s\u1ebd xu\u1ea5t hi\u1ec7n sau khi c\u00f3 \u0111\u01a1n thanh to\u00e1n.</span></div></td></tr>'}</tbody></table></div></section></div>`;
  const sources = sourcePerformance();
  const totals = sources.reduce((acc, source) => ({ sessions: acc.sessions + source.sessions, trackedLeads: acc.trackedLeads + source.trackedLeads, leads: acc.leads + source.leads, paidOrders: acc.paidOrders + source.paidOrders, convertedCustomers: acc.convertedCustomers + source.convertedCustomers, revenue: acc.revenue + source.revenue, spend: acc.spend + source.spend }), { sessions: 0, trackedLeads: 0, leads: 0, paidOrders: 0, convertedCustomers: 0, revenue: 0, spend: 0 });
  const funnel = canViewTraffic
    ? [['Sessions', totals.sessions], ['Form gửi có tracking', totals.trackedLeads], ['Data ghi vào CRM', totals.leads], ['Khách đã trả trong cohort', totals.convertedCustomers]]
    : [[currentAccount.role === 'SALE' ? 'Data CRM mới của tôi' : 'Data CRM mới của team', totals.leads], ['Khách đã trả trong cohort', totals.convertedCustomers]];
  const scopeName = currentAccount.role === 'SALE' ? 'của tôi' : `Team ${currentAccount.teamId}`;
  return pageHead(canViewTraffic ? 'Nguồn & chiến dịch' : `Nguồn khách ${scopeName}`, canViewTraffic ? 'Sessions, chi phí, data, đơn và doanh thu nối theo last-touch attribution.' : `Hiển thị nguồn, landing page và doanh thu của khách trong phạm vi ${scopeName}; sessions và chi phí quảng cáo chỉ dành cho Admin.`) + dateFilter() +
    `<div class="kpi-grid" style="grid-template-columns:repeat(${canViewTraffic ? 6 : 3},minmax(140px,1fr))">${canViewTraffic ? kpiCard('⌁', 'Sessions', number(totals.sessions), 'Phiên có tracking') + kpiCard('↗', 'Form gửi', number(totals.trackedLeads), `${totals.sessions ? (totals.trackedLeads / totals.sessions * 100).toFixed(1) : 0}% / session`) : ''}${kpiCard('♙', 'Data CRM mới', number(totals.leads), canViewTraffic ? `${totals.trackedLeads ? (totals.leads / totals.trackedLeads * 100).toFixed(1) : 0}% form vào CRM` : scopeName)}${kpiCard('▤', 'Lượt thanh toán', number(totals.paidOrders), `${totals.leads ? (totals.convertedCustomers / totals.leads * 100).toFixed(1) : 0}% khách trong cohort`)}${kpiCard('₫', 'Doanh thu', money(totals.revenue, true), 'Last-touch')}${canViewTraffic ? kpiCard('x', 'ROAS tổng', totals.spend ? `${(totals.revenue / totals.spend).toFixed(2)}x` : 'Organic', `Chi ${money(totals.spend, true)}`) : ''}</div>
    <div class="grid grid-2"><section class="panel"><div class="panel-head"><div><div class="panel-title">${canViewTraffic ? 'Phân bổ traffic' : 'Phân bổ data'}</div><div class="panel-sub">Theo nguồn · ${escapeHtml(periodLabel())}</div></div></div><div class="panel-body">${trafficDonut(sources)}</div></section><section class="panel"><div class="panel-head"><div><div class="panel-title">Funnel chuyển đổi</div><div class="panel-sub">Tất cả tầng dùng đúng scope hiện tại</div></div></div><div class="panel-body"><div class="pipeline">${funnel.map(([label, value], index, values) => `<div class="pipeline-row"><span>${label}</span><div class="progress"><i style="width:${Number(values[0][1]) ? Number(value) / Number(values[0][1]) * 100 : 0}%"></i></div><b>${number(value)}</b></div>`).join('')}</div></div></section></div>
    <section class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Hiệu suất nguồn / chiến dịch</div><div class="panel-sub">${canViewTraffic ? 'Tách form tracking khỏi data CRM · CAC = chi phí / lượt thanh toán' : 'Không hiển thị sessions, chi phí và ROAS ngoài quyền Admin'}</div></div>${currentAccount.role !== 'SALE' ? '<button class="button button-small" id="exportMarketingButton">Xuất CSV</button>' : ''}</div><div class="table-wrap"><table><thead><tr><th>Source / Campaign</th>${canViewTraffic ? '<th>Sessions</th><th>Form gửi</th><th>Form CVR</th>' : ''}<th>Data CRM</th>${canViewTraffic ? '<th>Vào CRM</th>' : ''}<th>Lượt thanh toán</th><th>Paid cohort</th><th>Doanh thu</th>${canViewTraffic ? '<th>Chi phí</th><th>CAC</th><th>ROAS</th>' : ''}</tr></thead><tbody>${sources.map(source => `<tr><td><div class="cell-main">${escapeHtml(source.source)}</div><div class="cell-sub">${escapeHtml(source.medium)} · ${escapeHtml(source.campaign)}</div></td>${canViewTraffic ? `<td>${number(source.sessions)}</td><td>${number(source.trackedLeads)}</td><td>${source.leadRate.toFixed(1)}%</td>` : ''}<td>${number(source.leads)}</td>${canViewTraffic ? `<td>${source.crmCaptureRate.toFixed(1)}%</td>` : ''}<td>${source.paidOrders}</td><td>${source.orderRate.toFixed(1)}%</td><td><b>${money(source.revenue)}</b></td>${canViewTraffic ? `<td>${money(source.spend)}</td><td>${source.paidOrders && source.spend ? money(source.spend / source.paidOrders) : '—'}</td><td>${source.roas ? `${source.roas.toFixed(2)}x` : 'Organic'}</td>` : ''}</tr>`).join('')}</tbody></table></div></section>`;
}

function salePerformanceRows() {
  const allowedIds = scopeSaleIds();
  return activeStaff().filter(person => person.role === 'SALE' && allowedIds.includes(person.id)).map(person => {
    const orders = state.orders.filter(order => order.saleId === person.id && order.teamId === person.teamId && order.leaderId === person.leaderId);
    const customers = state.customers.filter(customer => customer.saleId === person.id && customer.teamId === person.teamId && customer.leaderId === person.leaderId && inCurrentPeriod(customer.createdAt));
    const tasks = state.tasks.filter(task => task.ownerId === person.id && task.teamId === person.teamId && task.leaderId === person.leaderId);
    const revenue = netRevenue(orders, inCurrentPeriod);
    const payments = paidOrders(orders, inCurrentPeriod);
    const paid = payments.length;
    const periodCustomerIds = new Set(customers.map(customer => customer.id));
    const won = new Set(payments.filter(order => periodCustomerIds.has(order.customerId)).map(order => order.customerId)).size;
    return { ...person, customers: customers.length, paid, revenue, conversion: customers.length ? won / customers.length * 100 : 0, overdue: tasks.filter(task => task.status === 'OVERDUE').length };
  }).sort((a, b) => b.revenue - a.revenue);
}

function teamView() {
  if (currentAccount.role === 'SALE') return accessDeniedView('Sale không được xem bảng xếp hạng đội nhóm.');
  const rows = salePerformanceRows();
  const teamRevenue = netRevenue(scopedOrders(), inCurrentPeriod);
  const members = currentAccount.role === 'ADMIN' ? activeStaff() : activeStaff().filter(person => person.teamId === currentAccount.teamId && (person.id === currentAccount.leaderId || person.leaderId === currentAccount.leaderId));
  members.sort((a, b) => (a.role === 'LEADER' ? 0 : 1) - (b.role === 'LEADER' ? 0 : 1) || a.name.localeCompare(b.name, 'vi'));
  // Team được tạo và phân công từ dữ liệu thành viên; không hiển thị nút tạo đội riêng.
  const actions = currentAccount.role === 'ADMIN' ? '' : '<button class="button" id="exportTeamButton">Xuất CSV</button>';
  const unassignedAccounts = currentAccount.role === 'ADMIN' ? (state.registeredAccounts || []).filter(account => account.role === 'UNASSIGNED' && account.active !== false) : [];
  const teamCards = Array.from(new Set(members.map(member => member.teamId))).sort().map(teamId => { const leaders = members.filter(member => member.teamId === teamId && member.role === 'LEADER'); return `<section class="panel team-overview-card"><div class="panel-head"><div><div class="panel-title">Team ${escapeHtml(teamId)}</div><div class="panel-sub">${leaders.length} Leader · ${members.filter(member => member.teamId === teamId && member.role === 'SALE').length} Sale</div></div></div><div class="panel-body">${leaders.map(leader => { const sales = members.filter(member => member.role === 'SALE' && member.leaderId === leader.id); return `<details class="team-leader"><summary><span class="avatar">${escapeHtml(leader.initials)}</span><span><b>${escapeHtml(leader.name)}</b><small>Leader · ${sales.length} Sale · ${state.customers.filter(customer => customer.leaderId === leader.id).length} khách</small></span></summary><div class="team-sales">${sales.map(sale => `<button class="team-sale-row" type="button" data-team-member="${escapeHtml(sale.id)}"><span><b>${escapeHtml(sale.name)}</b><small>${number(state.customers.filter(customer => customer.saleId === sale.id).length)} khách phụ trách</small></span><strong>${money(netRevenue(state.orders.filter(order => order.saleId === sale.id), inCurrentPeriod), true)}</strong></button>`).join('') || '<div class="cell-sub">Chưa có Sale trực thuộc.</div>'}</div></details>`; }).join('') || '<div class="empty compact"><b>Chưa có Leader</b></div>'}</div></section>`; }).join('');
  const unassignedHtml = unassignedAccounts.length ? `<section class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Tài khoản chưa phân chức vụ</div><div class="panel-sub">Đăng ký thành công được dùng ngay; Admin có thể đưa vào đội sau.</div></div></div><div class="table-wrap"><table><thead><tr><th>Tài khoản</th><th>Số điện thoại</th><th>Email</th><th>Trạng thái</th><th></th></tr></thead><tbody>${unassignedAccounts.map(account => `<tr><td><b>${escapeHtml(account.name)}</b></td><td>${escapeHtml(account.phone)}</td><td>${escapeHtml(account.email)}</td><td><span class="status status-pending">Chưa phân chức vụ</span></td><td><button class="button button-small button-primary" data-assign-account="${escapeHtml(account.id)}">Phân chức vụ</button></td></tr>`).join('')}</tbody></table></div></section>` : '';
  return pageHead(currentAccount.role === 'ADMIN' ? 'Đội ngũ' : `Nhân sự Team ${currentAccount.teamId}`, 'Quản lý thành viên, tuyến quản lý và hiệu suất hiện tại.', actions) + dateFilter() + `<div class="team-overview-grid">${teamCards}</div>` + unassignedHtml +
    `<div class="kpi-grid" style="grid-template-columns:repeat(4,minmax(150px,1fr))">${kpiCard('♧', 'Thành viên', number(members.length), currentAccount.role === 'ADMIN' ? 'Toàn hệ thống' : `Team ${currentAccount.teamId}`)}${kpiCard('₫', 'Doanh thu đội', money(teamRevenue, true), periodLabel())}${kpiCard('♙', 'Khách đang phụ trách', number(rows.reduce((sum, row) => sum + row.customers, 0)), 'Tổng theo Sale')}${kpiCard('!', 'Lịch quá hạn', number(rows.reduce((sum, row) => sum + row.overdue, 0)), 'Trong hồ sơ khách')}</div>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">Danh sách nhân sự</div><div class="panel-sub">Chức vụ, tuyến quản lý và hiệu suất hiện tại</div></div>${currentAccount.role === 'ADMIN' ? '<button class="button button-small" id="exportTeamButton">Xuất CSV</button>' : ''}</div><div class="table-wrap"><table><thead><tr><th>Nhân sự</th><th>Chức vụ</th><th>Team</th><th>Quản lý trực tiếp</th><th>Khách hàng</th><th>Doanh thu kỳ</th>${currentAccount.role === 'ADMIN' ? '<th>Thao tác</th>' : ''}</tr></thead><tbody>${members.map(member => { const performance = rows.find(row => row.id === member.id); const directSales = member.role === 'LEADER' ? STAFF.filter(person => person.role === 'SALE' && person.leaderId === member.id).length : 0; return `<tr><td><div class="cell-main">${escapeHtml(member.name)}${['l1', 's1'].includes(member.id) ? ' <span class="account-link">Tài khoản hệ thống</span>' : ''}</div><div class="cell-sub">${escapeHtml(member.phone || member.email || member.id)}</div></td><td><span class="status ${member.role === 'LEADER' ? 'status-info' : 'status-paid'}">${member.role}</span></td><td>${escapeHtml(member.teamId)}</td><td>${member.role === 'SALE' ? escapeHtml(staffName(member.leaderId)) : `${directSales} Sale trực thuộc`}</td><td>${member.role === 'SALE' ? number(performance?.customers || 0) : number(state.customers.filter(customer => customer.leaderId === member.id).length)}</td><td>${member.role === 'SALE' ? money(performance?.revenue || 0) : money(netRevenue(state.orders.filter(order => order.leaderId === member.id), inCurrentPeriod))}</td>${currentAccount.role === 'ADMIN' ? `<td><div class="panel-actions"><button class="button button-small" data-edit-member="${escapeHtml(member.id)}">Chỉnh sửa</button><button class="button button-small" data-reset-member-password="${escapeHtml(member.id)}">Mật khẩu</button><button class="button button-small button-danger" data-delete-member="${escapeHtml(member.id)}">Xoá</button></div></td>` : ''}</tr>`; }).join('')}</tbody></table></div></section>`;
}

function memberInitials(name) {
  return String(name || 'NV').trim().split(/\s+/).slice(-2).map(part => part[0] || '').join('').toUpperCase().slice(0, 3) || 'NV';
}

function createTeamModal() {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN'); return; }
  const leaders = activeStaff().filter(person => person.role === 'LEADER');
  const sales = activeStaff().filter(person => person.role === 'SALE');
  openModal('T\u1ea1o \u0111\u1ed9i', '<form id="teamCreateForm"><div class="form-grid"><label class="form-field">M\u00e3 \u0111\u1ed9i<input id="teamCreateId" required maxlength="20" pattern="[A-Za-z0-9_-]+" placeholder="T3"></label><label class="form-field">T\u00ean \u0111\u1ed9i<input id="teamCreateName" maxlength="80" placeholder="Team kinh doanh"></label><label class="form-field full">Ch\u1ecdn Leader<select id="teamCreateLeader" required><option value="">-- Ch\u1ecdn Leader --</option>' + leaders.map(leader => '<option value="' + escapeHtml(leader.id) + '">' + escapeHtml(leader.name) + ' \u00b7 ' + escapeHtml(leader.teamId) + '</option>').join('') + '</select></label><fieldset class="form-field full"><legend>Ch\u1ecdn Sale tr\u1ef1c thu\u1ed9c</legend><div class="quick-option-list">' + sales.map(sale => '<label><input type="checkbox" name="teamSales" value="' + escapeHtml(sale.id) + '"><span>' + escapeHtml(sale.name) + ' \u00b7 ' + escapeHtml(sale.teamId) + '</span></label>').join('') + '</div></fieldset></div><div class="credential-hint">M\u1ed7i Sale ch\u1ec9 thu\u1ed9c m\u1ed9t Leader. T\u1ea1o \u0111\u1ed9i s\u1ebd c\u1eadp nh\u1eadt Team v\u00e0 tuy\u1ebfn qu\u1ea3n l\u00fd cho c\u00e1c th\u00e0nh vi\u00ean \u0111\u00e3 ch\u1ecdn.</div><div class="modal-actions"><button class="button" type="button" data-close-modal>Hu\u1ef7</button><button class="button button-primary" type="submit">T\u1ea1o \u0111\u1ed9i</button></div></form>');
  $('[data-close-modal]')?.addEventListener('click', closeModal);
  $('#teamCreateForm').onsubmit = event => {
    event.preventDefault();
    const teamId = $('#teamCreateId').value.trim().toUpperCase();
    const leaderId = $('#teamCreateLeader').value;
    const selectedSales = $$('input[name="teamSales"]:checked').map(input => input.value);
    const leader = activeStaff().find(person => person.id === leaderId && person.role === 'LEADER');
    if (!/^[A-Z0-9_-]{1,20}$/.test(teamId) || activeStaff().some(person => person.teamId === teamId) || !leader) { toast('Mã đội hoặc Leader không hợp lệ'); return; }
    leader.teamId = teamId;
    leader.leaderId = null;
    activeStaff().filter(person => person.role === 'SALE' && (person.leaderId === leader.id || selectedSales.includes(person.id))).forEach(sale => { sale.teamId = selectedSales.includes(sale.id) ? teamId : ''; sale.leaderId = selectedSales.includes(sale.id) ? leader.id : null; });
    audit('CREATE_TEAM', teamId, leader.name + ' ? ' + selectedSales.length + ' Sale');
    saveState(); closeModal(); render(); toast('Đã tạo đội ' + teamId);
  };
}

function assignRegisteredAccountModal(accountId) {
  if (currentAccount.role !== 'ADMIN') return;
  const account = (state.registeredAccounts || []).find(item => item.id === accountId && item.role === 'UNASSIGNED');
  if (!account) return;
  const leaders = activeStaff().filter(person => ['LEADER', 'MANAGER'].includes(person.role));
  const leaderOptions = leaders.map(leader => '<option value="' + escapeHtml(leader.id) + '">' + escapeHtml(leader.name) + ' · ' + escapeHtml(leader.role === 'MANAGER' ? 'MANAGER' : leader.teamId) + '</option>').join('');
  openModal('Phân chức vụ cho tài khoản', '<form id="assignAccountForm"><div class="form-grid"><label class="form-field full">Họ tên<input id="assignAccountName" value="' + escapeHtml(account.name) + '" required maxlength="160"></label><label class="form-field">Chức vụ<select id="assignAccountRole"><option value="SALE">SALE</option><option value="LEADER">LEADER</option></select></label><label class="form-field">Team<input id="assignAccountTeam" value="T2" required maxlength="20"></label><label class="form-field">Leader trực tiếp<select id="assignAccountLeader"><option value="">Không áp dụng</option>' + leaderOptions + '</select></label></div><div class="modal-actions"><button class="button" type="button" data-close-modal>Huỷ</button><button class="button button-primary" type="submit">Lưu phân chức vụ</button></div></form>');
  $('[data-close-modal]')?.addEventListener('click', closeModal);
  $('#assignAccountForm').onsubmit = async event => {
    event.preventDefault();
    const role = $('#assignAccountRole').value;
    const teamId = $('#assignAccountTeam').value.trim().toUpperCase();
    const leaderId = $('#assignAccountLeader').value || null;
    const leader = leaderId && activeStaff().find(person => person.id === leaderId && ['LEADER', 'MANAGER'].includes(person.role));
    const name = $('#assignAccountName').value.trim();
    if (!name || !/^[A-Z0-9_-]{1,20}$/.test(teamId)) { toast('Thông tin không hợp lệ'); return; }
    if (role === 'SALE' && (!leader || (leader.role === 'LEADER' && leader.teamId !== teamId))) { toast('Sale phải thuộc đúng Team của Leader hoặc Manager'); return; }
    const assignment = { role, teamId, leaderId: role === 'SALE' ? leaderId : null, managerId: role === 'SALE' && leader?.role === 'MANAGER' ? leader.id : null, name, active: true, initials: memberInitials(name) };
    audit('ASSIGN_REGISTERED_ACCOUNT', account.id, name + ' · ' + role + ' · ' + teamId);
    if (!await pushServerRecord('users', 'PUT', account.id, assignment)) { toast('Chưa lưu được phân quyền; xem trạng thái lưu'); return; }
    closeModal(); await syncServerState(); render(); toast('Đã lưu phân quyền vào MySQL');
  };
}

function teamMemberModal(id = null, registrationId = null) {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được quản lý nhân sự'); return; }
  const registration = state.registrations.find(item => item.id === registrationId);
  const member = STAFF.find(person => person.id === id);
  const source = member || registration || { name: '', email: '', requestedRole: 'SALE', teamId: 'T2' };
  const role = member?.role || source.requestedRole || 'SALE';
  const leaders = activeStaff().filter(person => ['LEADER', 'MANAGER'].includes(person.role) && person.id !== id);
  const leaderOptions = leaders.map(leader => '<option value="' + escapeHtml(leader.id) + '" ' + ((member?.leaderId || '') === leader.id ? 'selected' : '') + '>' + escapeHtml(leader.name) + ' · ' + escapeHtml(leader.role === 'MANAGER' ? 'MANAGER' : leader.teamId) + '</option>').join('');
  openModal(member ? 'Chỉnh sửa thành viên' : 'Thêm thành viên', '<form id="teamMemberForm"><div class="form-grid"><label class="form-field full">Họ tên<input id="memberName" required maxlength="160" value="' + escapeHtml(source.name) + '"></label><label class="form-field full">Gmail nhận thông báo<input id="memberEmail" type="email" maxlength="254" value="' + escapeHtml(source.email || '') + '" placeholder="sale@gmail.com"></label><label class="form-field">Chức vụ<select id="memberRole"><option value="SALE" ' + (role === 'SALE' ? 'selected' : '') + '>SALE</option><option value="LEADER" ' + (role === 'LEADER' ? 'selected' : '') + '>LEADER</option></select></label><label class="form-field">Team<input id="memberTeam" required maxlength="20" value="' + escapeHtml(source.teamId || 'T2') + '"></label><label class="form-field">Leader trực tiếp<select id="memberLeader"><option value="">Không áp dụng</option>' + leaderOptions + '</select></label></div><div class="modal-actions"><button class="button" type="button" data-close-modal>Huỷ</button><button class="button button-primary" type="submit">Lưu thành viên</button></div></form>');
  $('[data-close-modal]')?.addEventListener('click', closeModal);
  $('#teamMemberForm').onsubmit = event => { event.preventDefault(); saveTeamMember(id, registrationId); };
}

async function saveAccountPassword(body){
  if(!await flushServerPersistence())return false;
  try{
    const response=await fetch(`${webhookApiBase()}/api/auth/password`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${serverSyncToken}`},body:JSON.stringify(body)});
    const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Không đổi được mật khẩu');return true;
  }catch(error){toast(error.message);return false;}
}
function resetMemberPasswordModal(id) {
  if(currentAccount.role!=='ADMIN')return;
  const member=state.members.find(r=>r.id===id);
  if(!member?.loginEnabled){toast('Nhân sự này chưa có tài khoản đăng nhập. Cần đăng ký tài khoản trước.');return;}
  openModal('Đặt lại mật khẩu', `<form id="resetMemberPasswordForm"><label class="form-field">Mật khẩu mới<input id="resetMemberPassword" type="password" minlength="8" required autocomplete="new-password"></label><label class="form-field">Nhập lại<input id="resetMemberPasswordConfirm" type="password" required></label><button class="button button-primary" type="submit">Lưu mật khẩu</button></form>`);
  $('#resetMemberPasswordForm').onsubmit=async event=>{
    event.preventDefault();const password=$('#resetMemberPassword').value;
    if(password!==$('#resetMemberPasswordConfirm').value){toast('Mật khẩu xác nhận chưa khớp');return;}
    if(await saveAccountPassword({userId:id,password})){closeModal();toast('Đã đổi mật khẩu và kết thúc các phiên đăng nhập cũ');}
  };
}

function saveTeamMember(id = null, registrationId = null) {
  if (currentAccount.role !== 'ADMIN') return;
  const existing = STAFF.find(person => person.id === id), name = $('#memberName').value.trim(), email = $('#memberEmail')?.value.trim().toLowerCase() || '', role = $('#memberRole').value, teamId = $('#memberTeam').value.trim().toUpperCase(), leaderId = $('#memberLeader').value || null;
  if (!name || !['LEADER', 'SALE'].includes(role) || !/^[A-Z0-9_-]{1,20}$/.test(teamId)) { toast('Thông tin nhân sự không hợp lệ'); return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Gmail nhân sự không hợp lệ'); return; }
  if (existing?.role === 'LEADER' && role === 'SALE' && STAFF.some(person => person.role === 'SALE' && person.leaderId === existing.id)) { toast('Hãy chuyển các Sale trực thuộc sang Leader khác trước khi đổi chức vụ'); return; }
  const leader = role === 'SALE' ? STAFF.find(person => person.id === leaderId && ['LEADER', 'MANAGER'].includes(person.role) && person.active !== false) : null;
  if (role === 'SALE' && (!leader || (leader.role === 'LEADER' && leader.teamId !== teamId))) { toast('Sale phải thuộc đúng Team của Leader hoặc Manager trực tiếp'); return; }
  if (existing) {
    const previous = { ...existing };
    if (previous.role === 'SALE' && role !== 'SALE') {
      state.customers.filter(customer => customer.saleId === previous.id).forEach(customer => { const before = assignmentSnapshot(customer); closeOpenCustomerTasks(customer, 'ROLE_CHANGED'); customer.saleId = null; customer.leaderId = existing.id; customer.teamId = teamId; recordAssignmentChange(customer, before, `${name} đổi chức vụ Sale -> Leader`, 'SYSTEM'); });
    } else if (previous.role === 'LEADER' && role === 'SALE') {
      state.customers.filter(customer => customer.leaderId === previous.id && !customer.saleId).forEach(customer => { const before = assignmentSnapshot(customer); customer.saleId = existing.id; customer.leaderId = leader.id; customer.teamId = teamId; createInitialTask(customer); recordAssignmentChange(customer, before, `${name} đổi chức vụ Leader -> Sale`, 'SYSTEM'); });
    } else if (previous.role === 'SALE') {
      state.customers.filter(customer => customer.saleId === previous.id).forEach(customer => { const before = assignmentSnapshot(customer); customer.leaderId = leader.id; customer.teamId = teamId; recordAssignmentChange(customer, before, `${name} chuyển tuyến quản lý`, 'SYSTEM'); });
      state.tasks.filter(task => task.ownerId === previous.id && task.status !== 'DONE').forEach(task => { task.leaderId = leader.id; task.teamId = teamId; });
    }
    if (previous.role === 'LEADER' && role === 'LEADER' && previous.teamId !== teamId) {
      STAFF.filter(person => person.role === 'SALE' && person.leaderId === previous.id).forEach(sale => { sale.teamId = teamId; state.customers.filter(customer => customer.saleId === sale.id).forEach(customer => { const before = assignmentSnapshot(customer); customer.teamId = teamId; recordAssignmentChange(customer, before, `Team của Leader ${name} thay đổi`, 'SYSTEM'); }); state.tasks.filter(task => task.ownerId === sale.id && task.status !== 'DONE').forEach(task => { task.teamId = teamId; }); });
      state.customers.filter(customer => customer.leaderId === previous.id).forEach(customer => { const before = assignmentSnapshot(customer); customer.teamId = teamId; recordAssignmentChange(customer, before, `Team của Leader ${name} thay đổi`, 'SYSTEM'); });
    }
    Object.assign(existing, { name, email, role, teamId, leaderId: role === 'SALE' ? leader.id : null, managerId: role === 'SALE' && leader.role === 'MANAGER' ? leader.id : null, initials: memberInitials(name), active: true });
  } else {
    const memberId = `${role === 'LEADER' ? 'l' : 's'}-${Date.now()}`;
    state.members.push({ id: memberId, name, email, role, teamId, leaderId: role === 'SALE' ? leader.id : null, managerId: role === 'SALE' && leader.role === 'MANAGER' ? leader.id : null, initials: memberInitials(name), createdBy: currentAccount.name, active: true });
  }
  const registration = state.registrations.find(item => item.id === registrationId);
  if (registration) registration.status = 'APPROVED';
  STAFF = state.members.filter(person => person.active !== false);
  audit(existing ? 'UPDATE_MEMBER' : 'CREATE_MEMBER', existing?.id || name, `${name} · ${role} · ${teamId}`);
  saveState(); closeModal(); render(); toast(existing ? 'Đã cập nhật thành viên' : 'Đã thêm thành viên vào đội ngũ');
}

function deleteTeamMember(id) {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được xoá thành viên'); return; }
  const member = STAFF.find(person => person.id === id);
  if (!member) return;
  if (member.role === 'LEADER' && STAFF.some(person => person.role === 'SALE' && person.leaderId === member.id)) { toast('Hãy chuyển các Sale sang Leader khác trước khi xoá'); return; }
  if (!window.confirm(`Xoá ${member.name} khỏi đội ngũ?`)) return;
  state.customers.filter(customer => customer.saleId === member.id || customer.leaderId === member.id).forEach(customer => {
    const previous = assignmentSnapshot(customer);
    closeOpenCustomerTasks(customer, 'MEMBER_REMOVED');
    if (member.role === 'SALE') customer.saleId = null;
    else { customer.saleId = null; customer.leaderId = null; customer.teamId = null; }
    customer.updatedAt = stamp();
    customer.note = `${member.name} đã rời đội ngũ; khách được thu hồi về Khách mới`;
    state.notes.unshift({ id: makeRecordId('NOTE'), customerId: customer.id, authorId: currentAccount.id, author: currentAccount.name, role: currentAccount.role, text: customer.note, at: stamp() });
    recordAssignmentChange(customer, previous, customer.note, 'SYSTEM');
  });
  member.active = false;
  const linkedAccount = member.id === 'l1' ? ACCOUNTS.find(item => item.id === 'u-leader-1') : member.id === 's1' ? ACCOUNTS.find(item => item.id === 'u-sale-1') : state.registeredAccounts.find(item => item.memberId === member.id);
  if (linkedAccount) state.disabledAccountIds = Array.from(new Set([...(state.disabledAccountIds || []), linkedAccount.id]));
  STAFF = state.members.filter(person => person.active !== false);
  audit('DELETE_MEMBER', id, `${member.name} · ${member.role}`);
  saveState(); render(); toast('Đã xoá thành viên khỏi đội ngũ và thu hồi khách liên quan');
}

function reportsView() {
  const current = periodSnapshot(), products = productPerformance(scopedOrders()).filter(product => product.paidOrders || product.refunds), sources = sourcePerformance(), sales = salePerformanceRows();
  const periodTasks = scopedTasks().filter(task => inCurrentPeriod(task.dueAt));
  return pageHead('Báo cáo tổng hợp', 'Một bộ lọc dùng xuyên suốt doanh thu, sản phẩm, nguồn và nhân sự.', currentAccount.role !== 'SALE' ? `<button class="button button-primary" id="exportReportButton">Xuất báo cáo CSV</button>` : '') + dateFilter() +
    `<div class="grid grid-3"><article class="info-card"><div class="info-card-top"><h3>Kinh doanh</h3><span class="scope-chip" style="color:var(--ink);background:var(--panel-2)">${dateRange}D</span></div><p>Doanh thu và chất lượng đơn</p><div class="stat-row"><div><small>Doanh thu</small><b>${money(current.revenue, true)}</b></div><div><small>Đơn PAID</small><b>${current.paid.length}</b></div><div><small>AOV</small><b>${money(current.aov, true)}</b></div></div></article>
    <article class="info-card"><div class="info-card-top"><h3>Acquisition</h3><span class="scope-chip" style="color:var(--ink);background:var(--panel-2)">${currentAccount.scope}</span></div><p>${currentAccount.role === 'ADMIN' ? 'Traffic và chuyển đổi data' : 'Data và chuyển đổi trong phạm vi'}</p><div class="stat-row"><div><small>${currentAccount.role === 'ADMIN' ? 'Sessions' : 'Phạm vi'}</small><b>${currentAccount.role === 'ADMIN' ? number(current.sessions) : currentAccount.scope}</b></div><div><small>Data</small><b>${number(current.leads)}</b></div><div><small>Paid / data</small><b>${current.conversion.toFixed(1)}%</b></div></div></article>
    <article class="info-card"><div class="info-card-top"><h3>Vận hành</h3><span class="scope-chip" style="color:var(--ink);background:var(--panel-2)">${dateRange}D</span></div><p>Lịch chăm sóc nằm trong từng hồ sơ khách</p><div class="stat-row"><div><small>Khách mới</small><b>${current.customers.length}</b></div><div><small>Lịch đến hạn</small><b>${periodTasks.length}</b></div><div><small>Quá hạn</small><b>${periodTasks.filter(task => task.status === 'OVERDUE').length}</b></div></div></article></div>
    <div class="grid grid-2" style="margin-top:14px"><section class="panel"><div class="panel-head"><div><div class="panel-title">Top sản phẩm</div><div class="panel-sub">Theo doanh thu trong kỳ</div></div></div><div class="panel-body">${products.slice(0, 5).map((product, index) => `<div class="rank-row"><span class="rank">#${index + 1}</span><div><b>${escapeHtml(product.name)}</b><small>${product.units} sản phẩm · ${product.paidOrders} lượt thanh toán</small></div><div class="rank-value"><b>${money(product.revenue, true)}</b></div></div>`).join('') || '<div class="empty"><b>Chưa có sản phẩm bán ra</b><span>Không phát sinh thanh toán trong kỳ.</span></div>'}</div></section><section class="panel"><div class="panel-head"><div><div class="panel-title">Top nguồn doanh thu</div><div class="panel-sub">Last-touch attribution</div></div></div><div class="panel-body">${sources.filter(source => source.paidOrders || source.revenue !== 0).slice(0, 5).map((source, index) => `<div class="rank-row"><span class="rank">#${index + 1}</span><div><b>${escapeHtml(source.source)}</b><small>${source.leads} data CRM · ${source.paidOrders} lượt thanh toán</small></div><div class="rank-value"><b>${money(source.revenue, true)}</b></div></div>`).join('') || '<div class="empty"><b>Chưa có doanh thu theo nguồn</b><span>Không phát sinh thanh toán hoặc hoàn tiền trong kỳ.</span></div>'}</div></section></div>
     ${currentAccount.role !== 'SALE' ? `<section class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Đóng góp theo Sale</div><div class="panel-sub">Chỉ hiển thị nhân sự trong phạm vi hiện tại</div></div></div><div class="panel-body">${sales.map(row => `<div class="rank-row"><span class="rank">${row.initials}</span><div><b>${escapeHtml(row.name)}</b><small>${row.customers} khách · ${row.paid} đơn · ${row.conversion.toFixed(1)}% chuyển đổi</small></div><div class="rank-value"><b>${money(row.revenue, true)}</b></div></div>`).join('')}</div></section>` : ''}`;
}

function websitesView() {
  if (currentAccount.role !== 'ADMIN') return accessDeniedView('Chỉ Admin được quản lý website và landing page.');
  const newData = state.customers.filter(customer => !customer.saleId && !customer.leaderId && !customer.teamId).length;
  const statusLabel = {
    UNCONFIGURED: ['Chưa cấu hình', 'pending'],
    PENDING_BACKEND: ['Chờ backend', 'info'],
    VERIFIED: ['Đã xác minh', 'paid'],
    ERROR: ['Lỗi kết nối', 'cancelled']
  };
  const providerLabel = { LANDING_API: 'Landing API', NOTIFICATION: 'Thông Báo' };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const cards = state.websites.map(website => {
    const customers = websiteCustomerRows(website.id);
    const todayCount = customers.filter(customer => String(customer.createdAt || '').slice(0, 10) === today).length;
    const fresh = customers.filter(customer => !customer.saleId && !customer.leaderId && !customer.teamId).length;
    const connection = statusLabel[website.connectionStatus] || statusLabel.UNCONFIGURED;
    return `<article class="info-card integration-card">
      <div class="info-card-top"><div><h3>${escapeHtml(website.name)}</h3><div class="cell-sub">${escapeHtml(website.domain)} · ${escapeHtml(providerLabel[website.provider] || website.provider)}</div><div class="cell-sub mono">URL nguồn: ${website.sourceUrl ? `<a href="${escapeHtml(website.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(website.sourceUrl)}</a>` : 'Chưa cấu hình'}</div></div><span class="status status-${connection[1]}">${connection[0]}</span></div>
      <p>${number(fresh)} data mới · ${number(customers.length - fresh)} đã phân công</p>
      <div class="stat-row"><div><small>Data hôm nay</small><b>${number(todayCount)}</b></div><div><small>Data tổng</small><b>${number(customers.length)}</b></div></div>
      <div class="connection-actions"><button class="button button-small" type="button" data-edit-source="${escapeHtml(website.id)}">Sửa URL nguồn</button><button class="button button-small button-danger" type="button" data-delete-website="${escapeHtml(website.id)}">Xóa website</button></div>
      ${webhookPanelMarkup(website)}
    </article>`;
  }).join('');
  return pageHead('Websites & Landing Pages', 'Quản lý nguồn nhận data và URL webhook.', '<button class="button button-primary" id="newWebsiteButton">+ Thêm website</button>') +
    `<section class="panel" style="margin-bottom:14px"><div class="panel-body"><div class="stat-row"><div><small>Khách hàng tổng</small><b>${number(state.customers.length)}</b></div><div><small>Data mới</small><b>${number(newData)}</b></div><div><small>Đã phân phụ trách</small><b>${number(state.customers.length - newData)}</b></div></div></div></section>` +
    webhookTransportMarkup() + `<div class="card-list">${cards || '<div class="empty"><b>Chưa có website</b><span>Thêm website để tạo URL nhận data từ landing page.</span></div>'}</div>`;
}
function integrationsView() {
  return accessDeniedView('Muc Tich hop dang tam an de nang cap.');
}

function visibleNotifications() {
  return state.notifications.filter(item => !(item.deletedBy || []).includes(currentAccount.id));
}

function notificationsView() {
  const items = visibleNotifications();
  const action = currentAccount.role === 'ADMIN' ? '<button class="button button-primary" id="newAnnouncementButton">Tạo thông báo</button>' : '<button class="button" id="readAllButton">Đánh dấu đã đọc</button>';
  return pageHead('Thông báo', currentAccount.role === 'ADMIN' ? 'Admin tạo và quản lý thông báo chung cho toàn bộ đội ngũ.' : 'Thông báo chung từ Admin.', action) +
    `<section class="panel"><div class="alert-list">${items.map(item => { const read = item.readBy.includes(currentAccount.id); return `<button class="alert-row" data-read-notification="${escapeHtml(item.id)}" style="text-align:left;opacity:${read ? '.65' : '1'}"><span class="alert-icon">${read ? '✓' : '●'}</span><span><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.text)}</p><div class="cell-sub">${escapeHtml(item.at)}</div></span><strong>${read ? 'Đã đọc' : 'Mới'}</strong></button>`; }).join('') || `<div class="empty"><b>Không có thông báo</b><span>Tài khoản của bạn chưa có thông báo mới.</span></div>`}</div></section>`;
}

function newAnnouncementModal() {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được tạo thông báo'); return; }
  openModal('Tạo thông báo', `<form id="announcementForm"><div class="form-grid"><label class="form-field full">Tiêu đề<input id="announcementTitle" required maxlength="200"></label><label class="form-field full">Nội dung<textarea id="announcementText" required rows="5" maxlength="1000"></textarea></label></div><div class="modal-actions"><button class="button" type="button" data-close-modal>Hủy</button><button class="button button-primary" type="submit">Gửi thông báo</button></div></form>`);
  $('#announcementForm').onsubmit = event => {
    event.preventDefault();
    const title = cleanText($('#announcementTitle').value.trim(), '', 200);
    const text = cleanText($('#announcementText').value.trim(), '', 1000);
    if (!title || !text) { toast('Nhập đủ tiêu đề và nội dung'); return; }
    state.notifications.unshift({ id: `NT-${Date.now()}`, role: 'ALL', title, text, at: new Date().toISOString(), readBy: [] });
    audit('CREATE_ANNOUNCEMENT', 'NOTIFICATIONS', title);
    saveState(); closeModal(); render(); toast('Đã gửi thông báo tới Leader và Sale');
  };
}

function auditView() {
  if (currentAccount.role !== 'ADMIN') return accessDeniedView('User log chỉ dành cho Admin.');
  return pageHead('User log', 'Theo dõi ai đã thực hiện thao tác nào và từ địa chỉ IP nào.') +
    `<section class="panel"><div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Vai trò</th><th>IP</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead><tbody>${state.audit.map(item => `<tr><td class="mono">${escapeHtml(item.at)}</td><td>${escapeHtml(item.actor)}</td><td><span class="scope-chip" style="color:var(--ink);background:var(--panel-2)">${escapeHtml(item.role)}</span></td><td class="mono">${escapeHtml(item.ip || '127.0.0.1')}</td><td><b>${escapeHtml(item.action)}</b></td><td class="mono">${escapeHtml(item.entity)}</td><td>${escapeHtml(item.detail)}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function accountingView() {
  if (currentAccount.role !== 'ADMIN') return accessDeniedView('Đối soát thanh toán chỉ dành cho Admin.');
  const transactions = financialEvents(state.orders, inCurrentPeriod).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const unmatched = transactions.filter(event => !event.reconciled).length;
  const collected = transactions.reduce((sum, event) => sum + event.amount, 0);
  const REMOVED_PAYMENT = state.integrations.find(item => item.provider === 'REMOVED_PAYMENT' && !item.archived);
  return pageHead('Đối soát thanh toán', 'REMOVED_PAYMENT phải gửi webhook đã xác minh vào backend; CRM đối chiếu mã đơn, số tiền và mã giao dịch theo cơ chế idempotency.', `<button class="button button-primary" id="reconcileAllButton">${REMOVED_PAYMENT?.status === 'VERIFIED' ? `Yêu cầu đối soát ${unmatched} giao dịch` : 'Cấu hình REMOVED_PAYMENT'}</button>`) + dateFilter() +
    `<div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(150px,1fr))">${kpiCard('✓', 'Đã khớp', number(transactions.length - unmatched), 'Giao dịch')}${kpiCard('!', 'Chưa khớp', number(unmatched), 'Cần kiểm tra')}${kpiCard('₫', 'Thu ròng', money(collected, true), 'Đã trừ các dòng hoàn tiền')}</div>
    <section class="panel">${transactionsTable(transactions, true)}</section>`;
}

function applyAppearanceSettings() {
  const base = state.settings.customAccent || '#e8572a';
  const palette = [base, base, `${base}18`];
  document.documentElement.style.setProperty('--accent', palette[0]);
  document.documentElement.style.setProperty('--accent-dark', palette[1]);
  document.documentElement.style.setProperty('--accent-soft', palette[2]);
  const fonts = Object.fromEntries([['aptos','Aptos'],['arial','Arial'],['arialBlack','Arial Black'],['bahnschrift','Bahnschrift'],['calibri','Calibri'],['cambria','Cambria'],['candara','Candara'],['century','Century Gothic'],['comic','Comic Sans MS'],['consolas','Consolas'],['constantia','Constantia'],['corbel','Corbel'],['courier','Courier New'],['franklin','Franklin Gothic Medium'],['georgia','Georgia'],['impact','Impact'],['segoe','Segoe UI'],['tahoma','Tahoma'],['times','Times New Roman'],['trebuchet','Trebuchet MS'],['verdana','Verdana'],['beVietnam','Be Vietnam Pro'],['inter','Inter'],['roboto','Roboto'],['openSans','Open Sans'],['montserrat','Montserrat'],['poppins','Poppins'],['lato','Lato'],['nunito','Nunito'],['raleway','Raleway'],['oswald','Oswald'],['ubuntu','Ubuntu'],['rubik','Rubik'],['manrope','Manrope'],['dmSans','DM Sans'],['workSans','Work Sans'],['quicksand','Quicksand'],['notoSans','Noto Sans'],['notoSerif','Noto Serif'],['plex','IBM Plex Sans'],['merriweather','Merriweather'],['playfair','Playfair Display'],['sourceSans','Source Sans 3'],['fira','Fira Sans'],['firaCode','Fira Code'],['barlow','Barlow'],['outfit','Outfit'],['spaceGrotesk','Space Grotesk'],['sora','Sora'],['plusJakarta','Plus Jakarta Sans'],['libreBaskerville','Libre Baskerville']].map(([k,v]) => [k, `${v}, sans-serif`]));
  document.documentElement.style.setProperty('--sans', fonts[state.settings.fontFamily || 'aptos'] || 'Aptos, sans-serif');
  document.documentElement.style.setProperty('--font-sans', fonts[state.settings.fontFamily || 'aptos'] || 'Aptos, sans-serif');
  document.documentElement.style.setProperty('--base-font-size', `${state.settings.fontSize || 14}px`);
  document.documentElement.style.setProperty('--base-font-weight', state.settings.fontBold ? '700' : '400');
  document.documentElement.style.setProperty('--base-font-style', state.settings.fontItalic ? 'italic' : 'normal');
  document.documentElement.style.setProperty('--navigation-font-size', `${state.settings.navigationFontSize || 12}px`);
  document.documentElement.style.setProperty('--content-font-size', `${state.settings.contentFontSize || 14}px`);
}

function settingsView() {
  if (currentAccount.role !== 'ADMIN') return accessDeniedView('Chỉ Admin được thay đổi cài đặt hệ thống.');
  const settingsViewState = state.settings;
  const settingsFontOptions = [['aptos','Aptos'],['arial','Arial'],['arialBlack','Arial Black'],['bahnschrift','Bahnschrift'],['calibri','Calibri'],['cambria','Cambria'],['candara','Candara'],['century','Century Gothic'],['comic','Comic Sans MS'],['consolas','Consolas'],['constantia','Constantia'],['corbel','Corbel'],['courier','Courier New'],['franklin','Franklin Gothic Medium'],['georgia','Georgia'],['impact','Impact'],['segoe','Segoe UI'],['tahoma','Tahoma'],['times','Times New Roman'],['trebuchet','Trebuchet MS'],['verdana','Verdana'],['beVietnam','Be Vietnam Pro'],['inter','Inter'],['roboto','Roboto'],['openSans','Open Sans'],['montserrat','Montserrat'],['poppins','Poppins'],['lato','Lato'],['nunito','Nunito'],['raleway','Raleway'],['oswald','Oswald'],['ubuntu','Ubuntu'],['rubik','Rubik'],['manrope','Manrope'],['dmSans','DM Sans'],['workSans','Work Sans'],['quicksand','Quicksand'],['notoSans','Noto Sans'],['notoSerif','Noto Serif'],['plex','IBM Plex Sans'],['merriweather','Merriweather'],['playfair','Playfair Display'],['sourceSans','Source Sans 3'],['fira','Fira Sans'],['firaCode','Fira Code'],['barlow','Barlow'],['outfit','Outfit'],['spaceGrotesk','Space Grotesk'],['sora','Sora'],['plusJakarta','Plus Jakarta Sans'],['libreBaskerville','Libre Baskerville']];
  const settingsColorOptions = ['#e8572a','#157a4b','#246b9b','#7c3aed','#c026d3','#db2777','#dc2626','#ea580c','#ca8a04','#65a30d','#0891b2','#0f172a','#475569','#000000','#ffffff'];
  const settingsOption = (value, label) => `<option value="${value}" ${settingsViewState.fontFamily === value ? 'selected' : ''}>${label}</option>`;
  const settingsAccountEvents = state.audit.filter(item => ['CREATE_MEMBER', 'APPROVE_REGISTRATION'].includes(item.action)).slice(0, 10);
  const settingsDataEvents = state.imports.slice(0, 10);
  return pageHead('Cài đặt CRM', 'Điều chỉnh giao diện và kênh nhận thông báo nội bộ.') +
    `<section class="panel settings-panel"><div class="panel-head settings-panel-head"><div><div class="panel-title">Cài đặt hệ thống</div><div class="panel-sub">Các thay đổi chỉ áp dụng sau khi bạn bấm Lưu cấu hình.</div></div><span class="settings-admin-badge">ADMIN</span></div><div class="panel-body settings-body">
      <div class="settings-section"><div class="settings-section-head"><div class="settings-section-icon">Aa</div><div><h2>Hiển thị</h2><p>Màu sắc, font chữ và kích thước nội dung trong CRM.</p></div></div><div class="settings-grid settings-display-grid">
        <label class="form-field">Màu chủ đạo<div class="settings-color-row"><select id="themeColorSelect">${settingsColorOptions.map(color => `<option value="${color}" ${(settingsViewState.customAccent || '#e8572a') === color ? 'selected' : ''}>${color}</option>`).join('')}</select><input id="customAccentColor" type="color" value="${settingsViewState.customAccent || '#e8572a'}" aria-label="Chọn màu chủ đạo"></div></label>
        <label class="form-field">Font chữ<select id="fontFamilySelect">${settingsFontOptions.map(([value, label]) => settingsOption(value, label)).join('')}</select></label>
        <label class="form-field font-size-control">Cỡ chữ danh mục<div class="settings-range-row"><input id="navigationFontSize" type="range" min="10" max="16" step="1" value="${settingsViewState.navigationFontSize || 12}"><output id="navigationFontSizeValue">${settingsViewState.navigationFontSize || 12}px</output></div></label>
        <label class="form-field font-size-control">Cỡ chữ nội dung<div class="settings-range-row"><input id="contentFontSize" type="range" min="12" max="20" step="1" value="${settingsViewState.contentFontSize || 14}"><output id="contentFontSizeValue">${settingsViewState.contentFontSize || 14}px</output></div></label>
      </div></div>
      <div class="settings-section"><div class="settings-section-head"><div class="settings-section-icon">@</div><div><h2>Email nội bộ</h2><p>Gửi thông báo khi có tài khoản mới hoặc data mới.</p></div></div><div class="settings-grid settings-email-grid">
        <label class="settings-toggle"><input id="emailNotificationsEnabled" type="checkbox" ${settingsViewState.emailNotificationsEnabled !== false ? 'checked' : ''}><span><b>Bật gửi email cho Sale và Leader</b><small>Nhân sự sẽ nhận thông báo theo email đã cài trong mục Đội ngũ.</small></span></label>
        <label class="form-field settings-test-field">Gửi email thử<div class="settings-test-row"><input id="emailTestRecipient" type="email" maxlength="254" placeholder="email@example.com"><button class="button button-small" id="emailTestButton" type="button">Gửi thử</button></div></label>
      </div></div>
      <label class="settings-toggle settings-attendance-toggle"><input id="leaderAttendanceRequired" type="checkbox" ${settingsViewState.leaderAttendanceRequired !== false ? 'checked' : ''}><span><b>Leader bắt buộc điểm danh</b><small>Áp dụng quy định điểm danh cho tài khoản Leader.</small></span></label><div class="settings-actions"><button class="button button-primary" id="saveAppearanceButton">Lưu cấu hình</button></div>
    </div></section><div class="grid grid-2 settings-activity-grid" style="margin-top:14px"><section class="panel"><div class="panel-head"><div><div class="panel-title">Tài khoản mới</div><div class="panel-sub">Hoạt động đăng ký gần đây</div></div></div><div class="panel-body">${settingsAccountEvents.map(item => `<div class="rank-row"><div><b>${escapeHtml(item.actor)}</b><small>${escapeHtml(item.detail)} · ${escapeHtml(item.at)}</small></div></div>`).join('') || '<div class="empty"><b>Chưa có tài khoản mới</b></div>'}</div></section><section class="panel"><div class="panel-head"><div><div class="panel-title">Data mới về</div><div class="panel-sub">Các lượt nhập data gần đây</div></div></div><div class="panel-body">${settingsDataEvents.map(item => `<div class="rank-row"><div><b>${escapeHtml(item.source)}</b><small>${escapeHtml(item.filename)} · ${number(item.records)} data · ${escapeHtml(item.importedAt)}</small></div></div>`).join('') || '<div class="empty"><b>Chưa có lượt nhập data</b></div>'}</div></section></div>`;
  /* Legacy markup below is intentionally kept for a small rollback surface. */
  const settings = state.settings;
  const option = (value, label, selected) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`;
  const fontOptions = [['arial','Arial'],['arialBlack','Arial Black'],['bahnschrift','Bahnschrift'],['calibri','Calibri'],['cambria','Cambria'],['candara','Candara'],['century','Century Gothic'],['comic','Comic Sans MS'],['consolas','Consolas'],['constantia','Constantia'],['corbel','Corbel'],['courier','Courier New'],['franklin','Franklin Gothic Medium'],['georgia','Georgia'],['impact','Impact'],['segoe','Segoe UI'],['tahoma','Tahoma'],['times','Times New Roman'],['trebuchet','Trebuchet MS'],['verdana','Verdana'],['beVietnam','Be Vietnam Pro'],['inter','Inter'],['roboto','Roboto'],['openSans','Open Sans'],['montserrat','Montserrat'],['poppins','Poppins'],['lato','Lato'],['nunito','Nunito'],['raleway','Raleway'],['oswald','Oswald'],['ubuntu','Ubuntu'],['rubik','Rubik'],['manrope','Manrope'],['dmSans','DM Sans'],['workSans','Work Sans'],['quicksand','Quicksand'],['notoSans','Noto Sans'],['notoSerif','Noto Serif'],['plex','IBM Plex Sans'],['merriweather','Merriweather'],['playfair','Playfair Display'],['sourceSans','Source Sans 3'],['fira','Fira Sans'],['firaCode','Fira Code']];
  const colorOptions = ['#e8572a','#157a4b','#246b9b','#7c3aed','#c026d3','#db2777','#dc2626','#ea580c','#ca8a04','#65a30d','#0891b2','#0f172a','#475569','#000000','#ffffff'];
  const accountEvents = state.audit.filter(item => ['CREATE_MEMBER', 'APPROVE_REGISTRATION'].includes(item.action)).slice(0, 10);
  const dataEvents = state.imports.slice(0, 10);
  return pageHead('Cài đặt CRM', '') +
     `<section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Giao diện & thông báo</div><div class="panel-sub">Cấu hình giao diện và email nội bộ</div></div></div><div class="panel-body"><div class="form-grid"><label class="form-field">Màu chủ đạo<select id="themeColorSelect">${colorOptions.map(color => `<option value="${color}" ${(settings.customAccent || '#e8572a') === color ? 'selected' : ''}>${color}</option>`).join('')}</select><input id="customAccentColor" type="color" value="${settings.customAccent || '#e8572a'}" style="height:38px;padding:3px;margin-top:6px"></label><label class="form-field">Font chữ<select id="fontFamilySelect">${fontOptions.map(([value,label]) => option(value,label,settings.fontFamily || 'aptos')).join('')}</select></label></div><label class="setting-toggle settings-toggle" style="display:flex;align-items:center;gap:8px;margin-top:16px"><input id="leaderAttendanceRequired" type="checkbox" ${settings.leaderAttendanceRequired !== false ? 'checked' : ''}><span>Leader bắt buộc điểm danh</span></label><button class="button button-primary" id="saveAppearanceButton" style="margin-top:14px">Lưu cấu hình</button></div></section><div class="grid grid-2" style="margin-top:14px"><section class="panel"><div class="panel-head"><div class="panel-title">Tài khoản mới</div></div><div class="panel-body">${accountEvents.map(item => `<div class="rank-row"><div><b>${escapeHtml(item.actor)}</b><small>${escapeHtml(item.detail)} · ${escapeHtml(item.at)}</small></div></div>`).join('') || '<div class="empty"><b>Chưa có tài khoản mới</b></div>'}</div></section><section class="panel"><div class="panel-head"><div class="panel-title">Data mới về</div></div><div class="panel-body">${dataEvents.map(item => `<div class="rank-row"><div><b>${escapeHtml(item.source)}</b><small>${escapeHtml(item.filename)} · ${number(item.records)} data · ${escapeHtml(item.importedAt)}</small></div></div>`).join('') || '<div class="empty"><b>Chưa có lượt nhập data</b></div>'}</div></section></div>`;
}

function timeToMinutes(time) {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function attendanceWifiIps() {
  return String(state.settings.attendanceIp || '').split(',').map(item => item.trim()).filter(Boolean);
}

function attendanceIsWifiIp(ip) {
  const list = attendanceWifiIps();
  return !list.length || list.includes(ip);
}

/* Lịch điểm danh 3 tháng cho Sale: mỗi tháng một lưới 7 cột (T2…CN),
   ô màu theo trạng thái (đúng giờ / muộn / nghỉ), cuối tháng có tổng kết. */
function attendanceCalendarHtml(accountId) {
  const today = dayIso(0);
  const [ty, tm] = today.split('-').map(Number);
  const dowLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const monthLabels = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
  const recordsByDate = {};
  state.attendance.filter(item => item.accountId === accountId).forEach(item => { recordsByDate[item.date] = item; });

  let html = '<div class="att-calendar">';
  for (let m = 0; m < 3; m++) {
    const monthIdx = tm - 1 - m;
    const year = monthIdx < 0 ? ty - 1 + Math.floor((monthIdx + 12) / 12) : ty;
    const realMonth = ((monthIdx % 12) + 12) % 12;
    const monthNum = realMonth + 1;
    const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    const firstDow = new Date(Date.UTC(year, realMonth, 1)).getUTCDay();
    const offset = (firstDow + 6) % 7;
    const isCurrentMonth = (year === ty && monthNum === tm);
    const lastDay = isCurrentMonth ? Number(today.split('-')[2]) : daysInMonth;

    let onTime = 0, late = 0, off = 0, total = 0;
    let cells = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const rec = recordsByDate[dateStr];
      const isWeekend = ((offset + d - 1) % 7) >= 5;
      const isFuture = d > lastDay;
      let cls = 'att-day';
      let statusHtml = '';
      let timeHtml = '';
      if (isFuture) {
        cls += ' is-future';
      } else if (rec) {
        total++;
        if (rec.late) { late++; cls += ' is-late'; statusHtml = `<span class="att-day-status">Muộn ${rec.lateMinutes || 0}p</span>`; }
        else { onTime++; cls += ' is-ontime'; statusHtml = '<span class="att-day-status">Đúng giờ</span>'; }
        timeHtml = `<span class="att-day-time">${escapeHtml(rec.at.slice(11))}</span>`;
      } else if (!isWeekend) {
        off++; cls += ' is-off'; statusHtml = '<span class="att-day-status">Nghỉ</span>';
      } else {
        cls += ' is-weekend';
      }
      cells += `<div class="${cls}"><span class="att-day-num">${d}</span>${statusHtml}${timeHtml}</div>`;
    }
    const emptyCells = offset;
    let gridCells = '';
    for (let e = 0; e < emptyCells; e++) gridCells += '<div class="att-day"></div>';
    gridCells += cells;

    html += `<div class="att-calendar-month"><div class="att-calendar-head"><b>${monthLabels[realMonth]} ${year}</b><div class="att-calendar-stats"><span class="att-stat-total">Tổng ${total + off} ngày</span><span class="att-stat-on">${onTime} đúng giờ</span><span class="att-stat-late">${late} muộn</span><span class="att-stat-off">${off} nghỉ</span></div></div><div class="att-grid">${dowLabels.map(d => `<div class="att-dow">${d}</div>`).join('')}${gridCells}</div></div>`;
  }
  html += '</div>';
  return html;
}

function attendanceView() {
  const today = dayIso(0);
  const attendanceRoles = new Set(['SALE', 'LEADER', 'MANAGER', 'MARKETING', 'ACCOUNTING', 'UNASSIGNED']);
  const rows = state.attendance.filter(item => item.date === today && activeStaff().some(person => person.id === item.accountId && attendanceRoles.has(person.role)) && (currentAccount.role === 'ADMIN' || item.teamId === currentAccount.teamId)).sort((a, b) => a.at.localeCompare(b.at));
  if (currentAccount.role !== 'ADMIN') {
    const myAccountId = attendanceAccountId();
    const mine = state.attendance.find(item => item.accountId === myAccountId && item.date === today);
    return pageHead('Điểm danh', '', mine ? '' : '<button class="button button-primary" id="checkInButton">Điểm danh hôm nay</button>') +
      `<section class="panel"><div class="panel-body">${mine ? `<div class="kpi"><strong>${escapeHtml(mine.at.slice(11))}</strong><small>${mine.late ? `Đi muộn ${mine.lateMinutes || 0} phút` : 'Đúng giờ'} · ${mine.ipValid ? 'Đúng wifi' : 'Ngoài wifi'} · IP ${escapeHtml(mine.ip)}</small></div>` : '<div class="empty"><b>Chưa điểm danh</b><span>Bấm nút Điểm danh hôm nay ở góc phải trên.</span></div>'}</div></section>` +
      `<section class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Lịch điểm danh 3 tháng</div><div class="panel-sub">Sau ${escapeHtml(state.settings.attendanceDeadline || '09:00')} sẽ bị gắn nhãn Đi muộn · Cuối tuần tô xám</div></div></div><div class="panel-body" style="padding:0">${attendanceCalendarHtml(myAccountId)}</div></section>`;
  }
  const config = currentAccount.role === 'ADMIN' ? `<section class="panel" style="margin-bottom:14px"><div class="panel-body"><div class="form-grid"><label class="form-field">Giờ vào làm · quá giờ báo trễ<input id="attendanceDeadline" type="time" value="${escapeHtml(state.settings.attendanceDeadline || '09:00')}"></label><label class="form-field">Số giờ chờ Sale nhận data<input id="acceptTimeoutHours" type="number" value="24" readonly></label></div><button class="button button-primary" id="saveAttendanceSettings" style="margin-top:12px">Lưu quy định</button></div></section>` : '';
  const checkedIds = new Set(rows.map(item => item.accountId));
  const missing = activeStaff().filter(person => attendanceRoles.has(person.role) && (currentAccount.role === 'ADMIN' || (person.teamId === currentAccount.teamId && (person.leaderId === currentAccount.leaderId || person.id === currentAccount.leaderId))) && !checkedIds.has(person.id));
  const actionCell = person => currentAccount.role === 'ADMIN' ? `<td><button class="button button-small" type="button" data-attendance-detail="${escapeHtml(person.id)}">Chi ti&#7871;t</button></td>` : '';
  const body = rows.map(item => `<tr><td><b>${escapeHtml(item.name)}</b></td><td>${escapeHtml(item.teamId)}</td><td class="mono">${escapeHtml(item.at)}</td><td class="mono">${escapeHtml(item.ip)}</td><td>${item.ipValid ? '<span class="status status-paid">&#272;&#250;ng wifi</span>' : '<span class="status status-cancelled">Ngo&#224;i wifi</span>'}</td><td>${item.late ? `<span class="status status-cancelled">&#272;i mu&#7897;n ${item.lateMinutes || 0}p</span>` : '<span class="status status-paid">&#272;&#250;ng gi&#7901;</span>'}</td>${currentAccount.role === 'ADMIN' ? `<td><button class="button button-small" type="button" data-attendance-detail="${escapeHtml(item.accountId)}">Chi ti&#7871;t</button> <button class="button button-small" type="button" data-edit-attendance="${escapeHtml(item.id)}">S&#7917;a</button> <button class="button button-small button-danger" type="button" data-delete-attendance="${escapeHtml(item.id)}">X&#243;a</button></td>` : ''}</tr>`).join('') +
    missing.map(person => `<tr><td><b>${escapeHtml(person.name)}</b></td><td>${escapeHtml(person.teamId)}</td><td colspan="3"><span class="status status-pending">Chưa điểm danh</span></td><td></td>${actionCell(person)}</tr>`).join('');
  const cols = currentAccount.role === 'ADMIN' ? 7 : 6;
  return pageHead('Điểm danh', '') + config + `<section class="panel"><div class="table-wrap"><table><thead><tr><th>Nhân viên</th><th>Team</th><th>Thời gian</th><th>IP</th><th>Wi-Fi</th><th>Kết quả</th>${currentAccount.role === 'ADMIN' ? '<th></th>' : ''}</tr></thead><tbody>${body || `<tr><td colspan="${cols}"><div class="empty"><b>Chưa có điểm danh hôm nay</b></div></td></tr>`}</tbody></table></div></section>`;
}


/* Bản ghi điểm danh trỏ vào NHÂN SỰ trong state.members (s1, l1…), không phải tài
   khoản đăng nhập (u-sale-1) — nhờ vậy loadState() giữ được bản ghi, bảng của Leader
   so đúng người đã chấm, và nút Ghi bù của Admin dùng chung một loại id. */
function attendanceAccountId() {
  if (!currentAccount) return '';
  return currentAccount.actualRole==='MANAGER'?currentAccount.id:(currentAccount.saleId || currentAccount.leaderId || currentAccount.id);
}

function checkInToday(options = {}) {
  const date = dayIso(0);
  const accountId = attendanceAccountId();
  if (state.attendance.some(item => item.date === date && item.accountId === accountId)) { toast('Hôm nay bạn đã điểm danh rồi'); return false; }
  const at = stamp(), time = at.slice(11, 16), deadline = state.settings.attendanceDeadline || '09:00', ip = currentAccount.ip || '127.0.0.1';
    const deadlineMinutes = timeToMinutes(deadline);
  const checkInMinutes = timeToMinutes(time);
  const late = checkInMinutes > deadlineMinutes;
  const lateMinutes = late ? checkInMinutes - timeToMinutes(deadline) : 0;
  state.attendance.unshift({ id: `ATT-${Date.now()}`, date, accountId, name: currentAccount.name, teamId: currentAccount.teamId || '', at, ip, late, lateMinutes, ipValid: attendanceIsWifiIp(ip), note: '', editedBy: '' });
  audit('CHECK_IN', date, `${time} · ${ip}${late ? ` · ĐI MUỘN ${lateMinutes}p` : ''}`);
  if (late && currentAccount.leaderId) state.notifications.unshift({ id: `NT-LATE-${date}-${currentAccount.id}`, role: 'LEADER', leaderId: currentAccount.leaderId, teamId: currentAccount.teamId, title: 'Sale điểm danh muộn', text: `${currentAccount.name} điểm danh lúc ${time} · trễ ${lateMinutes} phút · quá giờ chốt ${deadline}`, at, readBy: [] });
  if (options.save !== false) saveState();
  if (options.render !== false) render();
  toast(late ? `Đã điểm danh · ĐI MUỘN ${lateMinutes} phút (quá giờ chốt ${deadline})` : 'Đã điểm danh đúng giờ');
  return true;
}

async function handleCheckInClick(event) {
  const button = event.currentTarget;
  if (!button || button.disabled) return;
  const originalText = button.innerHTML;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.innerHTML = '<span class="login-spinner" aria-hidden="true"></span>Đang lưu điểm danh...';
  try {
    if (window.crmApi?.checkIn) {
      await window.crmApi.checkIn();
      render();
    } else {
      checkInToday();
    }
  } catch (error) {
    toast(error?.message || 'Không lưu được điểm danh. Vui lòng thử lại.');
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.setAttribute('aria-busy', 'false');
      button.innerHTML = originalText;
    }
  }
}

function saveAttendanceSettings() {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được đổi quy định điểm danh'); return; }
  const deadline = cleanClockTime($('#attendanceDeadline')?.value, '');
  const hours = 24;
  if (!deadline) { toast('Giờ vào làm không hợp lệ'); return; }
  state.settings.attendanceDeadline = deadline;
  state.settings.acceptTimeoutHours = hours;
  audit('UPDATE_SETTING', 'ATTENDANCE', `giờ chốt ${deadline} · wifi "${state.settings.attendanceIp || 'bỏ trống'}" · chờ nhận ${hours}h`);
  saveState(); render(); toast('Đã lưu quy định điểm danh và nhận data');
}

function attendanceMemberDetailModal(memberId) {
  if (currentAccount.role !== 'ADMIN') return;
  const member = activeStaff().find(person => person.id === memberId);
  if (!member) { toast('Khong tim thay thanh vien'); return; }
  const from = dayIso(29), to = dayIso(0);
  const records = state.attendance.filter(item => item.accountId === memberId && item.date >= from && item.date <= to).sort((a, b) => b.date.localeCompare(a.date));
  const late = records.filter(item => item.late);
  const outside = records.filter(item => item.ipValid === false);
  const detailRows = records.map(item => '<tr><td class="mono">' + escapeHtml(item.date) + '</td><td class="mono">' + escapeHtml(item.at.slice(11)) + '</td><td>' + (item.late ? '<span class="status status-cancelled">Di muon ' + (item.lateMinutes || 0) + ' phut</span>' : '<span class="status status-paid">Dung gio</span>') + '</td><td>' + (item.ipValid ? '<span class="status status-paid">Dung wifi</span>' : '<span class="status status-cancelled">Ngoai wifi</span>') + '</td><td>' + escapeHtml(item.note || '') + '</td></tr>').join('');
  openModal('Chi tiet diem danh - ' + member.name, '<div class="kpi-grid" style="grid-template-columns:repeat(4,minmax(120px,1fr))"><article class="kpi"><strong>' + number(records.length) + '</strong><small>Ngay da cham</small></article><article class="kpi"><strong>' + number(late.length) + '</strong><small>Lan di muon</small></article><article class="kpi"><strong>' + number(late.reduce((sum, item) => sum + (item.lateMinutes || 0), 0)) + 'p</strong><small>Tong phut tre</small></article><article class="kpi"><strong>' + number(outside.length) + '</strong><small>Ngoai wifi</small></article></div><section class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Lich 3 thang cua ' + escapeHtml(member.name) + '</div><div class="panel-sub">Xem tung ngay dung gio, di muon hoac nghi</div></div></div><div class="panel-body" style="padding:0">' + attendanceCalendarHtml(memberId) + '</div></section><section class="panel" style="margin-top:14px"><div class="table-wrap"><table><thead><tr><th>Ngay</th><th>Gio</th><th>Ket qua</th><th>Wi-Fi</th><th>Ghi chu</th></tr></thead><tbody>' + (detailRows || '<tr><td colspan="5"><div class="empty"><b>Chua co du lieu</b></div></td></tr>') + '</tbody></table></div></section><div class="modal-actions"><button class="button" type="button" data-close-modal>Dong</button></div>');
  $('[data-close-modal]')?.addEventListener('click', closeModal);
}

function attendanceEditModal(recordId = null, makeupSaleId = null) {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được sửa điểm danh'); return; }
  const record = recordId ? state.attendance.find(item => item.id === recordId) : null;
  if (recordId && !record) { toast('Bản ghi điểm danh không tồn tại'); return; }
  const sale = makeupSaleId ? activeStaff().find(person => person.id === makeupSaleId && person.role === 'SALE') : null;
  if (makeupSaleId && !sale) { toast('Sale không hợp lệ để ghi bù'); return; }
  openModal(record ? 'Sửa điểm danh' : 'Ghi bù điểm danh', `<form id="attendanceEditForm"><div class="form-grid">
    <label class="form-field">Ngày<input id="attDate" type="date" value="${escapeHtml(record ? record.date : dayIso(0))}"></label>
    <label class="form-field">Giờ<input id="attTime" type="time" value="${escapeHtml(record ? record.at.slice(11, 16) : '')}"></label>
    <label class="form-field">Kết quả<select id="attLate"><option value="AUTO">Tự suy từ giờ chốt</option><option value="ONTIME" ${record && !record.late ? 'selected' : ''}>Đúng giờ</option><option value="LATE" ${record && record.late ? 'selected' : ''}>Đi muộn</option></select></label>
    <label class="form-field">Wi-Fi<select id="attWifi"><option value="AUTO">Tự suy từ IP</option><option value="OK" ${record && record.ipValid ? 'selected' : ''}>Đúng wifi</option><option value="OUT" ${record && record.ipValid === false ? 'selected' : ''}>Ngoài wifi</option></select></label>
    <label class="form-field full">IP<input id="attIp" class="mono" maxlength="64" value="${escapeHtml(record ? record.ip : '')}" placeholder="Để trống: giữ IP gốc, ghi bù thì lấy IP hiện tại"></label>
    <label class="form-field full">Ghi chú lý do<textarea id="attNote" rows="2" maxlength="300" placeholder="Ví dụ: sale quên bấm, admin ghi bù theo chấm công">${escapeHtml(record ? record.note : '')}</textarea></label>
  </div><div class="modal-actions"><button class="button" type="button" data-close-modal>Huỷ</button><button class="button button-primary" type="submit">${record ? 'Lưu sửa đổi' : 'Ghi bù'}</button></div></form>`);
  $('[data-close-modal]')?.addEventListener('click', closeModal);
  $('#attendanceEditForm').onsubmit = event => {
    event.preventDefault();
    const date = cleanDate($('#attDate').value);
    const time = cleanClockTime($('#attTime').value, '');
    if (!date) { toast('Ngày không hợp lệ'); return; }
    if (date > dayIso(0)) { toast('Không thể điểm danh cho ngày chưa tới'); return; }
    const deadline = state.settings.attendanceDeadline || '09:00';
    const lateChoice = $('#attLate').value, wifiChoice = $('#attWifi').value;
    const ip = $('#attIp').value.trim() || (record ? record.ip : sessionIp('127.0.0.1'));
    const at = `${date} ${time || '00:00'}`;
    const deadlineMinutes = timeToMinutes(deadline);
    const checkInMinutes = time ? timeToMinutes(time) : 0;
    const late = lateChoice === 'AUTO' ? (time ? checkInMinutes > deadlineMinutes : false) : lateChoice === 'LATE';
    const lateMinutes = late ? Math.max(0, checkInMinutes - timeToMinutes(deadline)) : 0;
    const ipValid = wifiChoice === 'AUTO' ? attendanceIsWifiIp(ip) : wifiChoice === 'OK';
    const note = $('#attNote').value.trim();
    if (record) {
      record.date = date; record.at = at; record.ip = ip; record.late = late; record.lateMinutes = lateMinutes; record.ipValid = ipValid; record.note = note; record.editedBy = currentAccount.name;
      audit('UPDATE_ATTENDANCE', record.id, `${record.name} · ${at} · ${late ? `muộn ${lateMinutes}p` : 'đúng giờ'} · ${ipValid ? 'đúng wifi' : 'ngoài wifi'}`);
      saveState(); closeModal(); render(); toast('Đã lưu sửa điểm danh');
      return;
    }
    if (state.attendance.some(item => item.date === date && item.accountId === sale.id)) { toast('Ngày đó đã có điểm danh của sale này'); return; }
    state.attendance.unshift({ id: `ATT-${Date.now()}`, date, accountId: sale.id, name: sale.name, teamId: sale.teamId || '', at, ip, late, lateMinutes, ipValid, note: note || 'Admin ghi bù', editedBy: currentAccount.name });
    audit('MAKEUP_ATTENDANCE', sale.id, `${at} · ${ip}`);
    saveState(); closeModal(); render(); toast('Đã ghi bù điểm danh');
  };
}

function deleteAttendanceRecord(id) {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được xóa điểm danh'); return; }
  const record = state.attendance.find(item => item.id === id);
  if (!record) { toast('Bản ghi điểm danh không tồn tại'); return; }
  if (!window.confirm(`Xóa điểm danh ngày ${record.date} của ${record.name}?`)) return;
  state.attendance = state.attendance.filter(item => item.id !== id);
  audit('DELETE_ATTENDANCE', id, `${record.name} · ${record.date}`);
  saveState(); render(); toast('Đã xóa bản ghi điểm danh');
}
function profileView() {
  const role=currentAccount.actualRole||currentAccount.role;
  if (!['ADMIN','MARKETING','ACCOUNTING','SALE','LEADER','MANAGER','UNASSIGNED'].includes(role)) return accessDeniedView('Trang hồ sơ dành cho tài khoản hiện tại.');
  const memberId=role==='MANAGER'||role==='ADMIN'||role==='MARKETING'||role==='ACCOUNTING'
    ? currentAccount.id
    : (currentAccount.saleId||currentAccount.leaderId||currentAccount.id);
  const member=activeStaff().find(person=>person.id===memberId);
  if(!member&&role!=='UNASSIGNED')return accessDeniedView('Không tìm thấy hồ sơ nhân sự.');
  const profileName=member?.name||currentAccount.name;
  const profileInitials=member?.initials||currentAccount.initials||'NVT';
  const profileRole=member?.role||role;
  const avatar=member?.avatar
    ? '<img class="profile-avatar-large profile-avatar-image" src="'+escapeHtml(member.avatar)+'" alt="Avatar của '+escapeHtml(member.name||profileName)+'">'
    : '<span class="profile-avatar-large profile-avatar-placeholder">'+escapeHtml(profileInitials)+'</span>';
  return pageHead('Hồ sơ cá nhân','Cập nhật thông tin hiển thị trong toàn bộ hệ thống.','')+'<section class="panel profile-panel"><div class="panel-body profile-panel-body"><form id="profileForm"><div class="profile-hero"><div class="profile-avatar-wrap"><div class="profile-avatar-stage">'+avatar+'</div></div><div class="profile-hero-actions"><label class="button button-small profile-upload-button" for="profileAvatarInput">&#272;&#7893;i avatar</label><input id="profileAvatarInput" type="file" accept="image/png,image/jpeg,image/webp" class="is-hidden"></div></div><div class="profile-fields"><label class="form-field"><span>👤 Họ và tên <em>*</em></span><div class="profile-input-wrap"><span aria-hidden="true">👤</span><input id="profileDisplayName" maxlength="160" value="'+escapeHtml(profileName)+'" autocomplete="name" required></div></label><label class="form-field"><span>🔗 ID tài khoản <em>*</em></span><div class="profile-input-wrap"><span aria-hidden="true">🔗</span><input id="profileAccountId" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,63}" value="'+escapeHtml(currentAccount.accountId||member?.accountId||'')+'" placeholder="Nhập ID tài khoản" autocomplete="off" required></div></label><label class="form-field"><span>✉ Email</span><div class="profile-input-wrap"><span aria-hidden="true">✉</span><input id="profileEmail" type="email" maxlength="254" value="'+escapeHtml(member?.email||currentAccount.email||'')+'" placeholder="Nhập email" autocomplete="email"></div></label><label class="form-field"><span>☎ Số điện thoại</span><div class="profile-input-wrap"><span aria-hidden="true">☎</span><input id="profilePhone" type="tel" inputmode="numeric" maxlength="15" value="'+escapeHtml(member?.phone||currentAccount.phone||'')+'" placeholder="Nhập số điện thoại" autocomplete="tel"></div></label></div><div class="profile-security-note"><span aria-hidden="true">🔒</span><div><strong>Bảo mật tài khoản</strong><small>Đổi mật khẩu được thực hiện ở mục riêng trong hồ sơ.</small></div></div><div class="modal-actions profile-actions"><button class="button button-primary" type="submit">Lưu hồ sơ</button></div></form></div></section>';
}

// Admin sees the compact daily table first and a complete 30-day history below it.
function attendanceThirtyDayHistoryHtml() {
  const today = dayIso(0);
  const from = dayIso(29);
  const staff = activeStaff().filter(person => ['SALE', 'LEADER', 'MANAGER'].includes(person.role));
  const history = state.attendance
    .filter(item => item.date >= from && item.date <= today && staff.some(person => person.id === item.accountId))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.at).localeCompare(String(a.at)));
  const rows = history.map(item => {
    const person = staff.find(member => member.id === item.accountId);
    return `<tr><td><b>${escapeHtml(item.name || person?.name || item.accountId)}</b><div class="cell-sub">${escapeHtml(person?.role || '')}</div></td><td>${escapeHtml(item.teamId || person?.teamId || '')}</td><td class="mono">${escapeHtml(item.date)}</td><td class="mono">${escapeHtml(String(item.at || '').slice(11))}</td><td>${item.late ? `<span class="status status-cancelled">Muộn ${item.lateMinutes || 0}p</span>` : '<span class="status status-paid">Đúng giờ</span>'}</td><td>${item.ipValid === false ? '<span class="status status-cancelled">Ngoài wifi</span>' : '<span class="status status-paid">Đúng wifi</span>'}</td><td class="note-preview">${escapeHtml(item.note || '')}</td></tr>`;
  }).join('');
  return `<section class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Chi tiết điểm danh 30 ngày</div><div class="panel-sub">${history.length} bản ghi từ ${escapeHtml(from)} đến ${escapeHtml(today)} · đồng bộ cả điểm danh trên Telegram</div></div></div><div class="table-wrap"><table><thead><tr><th>Nhân sự</th><th>Team</th><th>Ngày</th><th>Giờ</th><th>Kết quả</th><th>Wi-Fi</th><th>Ghi chú</th></tr></thead><tbody>${rows || '<tr><td colspan="7"><div class="empty"><b>Chưa có dữ liệu điểm danh trong 30 ngày</b></div></td></tr>'}</tbody></table></div></section>`;
}

function accessDeniedView(message) {
  return pageHead('Không có quyền truy cập', 'Backend production phải trả 403 cho thao tác này.') + `<section class="panel"><div class="empty"><b>403 · FORBIDDEN</b><span>${escapeHtml(message)}</span></div></section>`;
}

const VIEW_RENDERERS = {
  dashboard: executiveDashboardView, customers: customersView, pool: poolView, distribution: distributionView,
  orders: ordersView, products: productsView, revenue: revenueView, businessReport: reportsView, accounting: accountingView, marketing: marketingView, team: teamView,
  websites: websitesView, integrations: integrationsView,
  attendance: () => currentAccount?.role === 'ADMIN' ? attendanceView() + attendanceThirtyDayHistoryHtml() : attendanceView(), accept: acceptQueueView, notifications: notificationsView, audit: auditView, settings: settingsView, profile: profileView
};

function visibleNavigation() {
  const role = currentAccount?.actualRole || currentAccount?.role;
  const groups = NAVIGATION[role === 'MANAGER' ? 'LEADER' : role] || [];
  const allowed = role === 'SALE'
    ? new Set(['dashboard','customers','accept','orders','revenue','businessReport','care','team','attendance','notifications','profile'])
    : role === 'LEADER' || role === 'MANAGER'
      ? new Set(['dashboard','customers','pool','orders','attendance','revenue','businessReport','team','care','notifications','profile'])
      : null;
  return groups.map(([name, items]) => [name, items.filter(item => !allowed || allowed.has(item[0]))]).filter(([, items]) => items.length);
}
function allowedViews() { if(effectivePermissionRole()==='HRM')return ['hrProfiles','team','attendance','orders','businessReport','profile']; if(effectivePermissionRole()==='ACCOUNTING')return ['accounting','notifications','profile'];return Array.from(new Set([...visibleNavigation().flatMap(([, items]) => items.map(item => item[0])), 'profile', 'feedback', 'processes'])); }
function viewLabel(view) { return visibleNavigation().flatMap(([, items]) => items).find(item => item[0] === view)?.[1] || view; }

function newCustomerCount() {
  if (currentAccount?.role === 'ADMIN' && liveNavigationCounts) return liveNavigationCounts.data;
  return currentAccount && currentAccount.role !== 'SALE' ? scopedCustomers().filter(isPoolCustomer).length : 0;
}
function pendingAccountCount() {
  if (currentAccount?.role !== 'ADMIN') return 0;
  if (liveNavigationCounts) return liveNavigationCounts.team;
  return (state.registeredAccounts || []).filter(account => account.role === 'UNASSIGNED' && account.active !== false).length;
}
function navigationBadgeCount(view) {
  if (view === 'notifications') return unreadCount();
  if (view === 'pool') return newCustomerCount();
  if (view === 'distribution') return newCustomerCount() + (webhookPending || []).length;
  if (view === 'team') return pendingAccountCount();
  if (view === 'accept') return pendingOfferCount();
  return 0;
}

function renderNavigation() {
  const groups = visibleNavigation();
  $('#sideNav').innerHTML = groups.map(([group, items]) => `<div class="nav-group"><div class="nav-title nav-group-title">${escapeHtml(group)}</div><div class="nav-list">${items.map(([view, label, icon]) => { const badge = navigationBadgeCount(view); const showBadge = ['pool', 'accept'].includes(view) || badge > 0; return `<button type="button" class="nav-link ${currentView === view ? 'active' : ''}" data-view-link="${view}" ${currentView === view ? 'aria-current="page"' : ''}><span class="nav-icon">${icon}</span><span>${escapeHtml(label)}</span>${showBadge ? `<span class="nav-badge">${number(badge)}</span>` : ''}</button>`; }).join('')}</div></div>`).join('');
  $('#mobileNav').innerHTML = groups.flatMap(([, items]) => items).map(([view, label]) => { const badge = navigationBadgeCount(view); return `<option value="${view}" ${currentView === view ? 'selected' : ''}>${escapeHtml(label)}${badge > 0 ? ` (${number(badge)})` : ''}</option>`; }).join('');
  $$('[data-view-link]').forEach(button => button.onclick = event => { event.preventDefault(); navigate(button.dataset.viewLink); });
  $('#mobileNav').onchange = event => navigate(event.target.value);
}

function unreadCount() { return currentAccount ? visibleNotifications().filter(item => !item.readBy.includes(currentAccount.id)).length : 0; }

function updateSessionChrome() {
  const sessionMember = activeStaff().find(person => person.id === (currentAccount.actualRole==='MANAGER'?currentAccount.id:(currentAccount.saleId || currentAccount.leaderId)));
  $('#profileName').textContent = currentAccount.name;
  const avatar = $('#profileAvatar');
  avatar.textContent = sessionMember?.avatar ? '' : currentAccount.initials;
  avatar.style.backgroundImage = sessionMember?.avatar ? `url("${sessionMember.avatar}")` : '';
  avatar.classList.toggle('avatar-edit', ['SALE', 'LEADER'].includes(currentAccount.role));
  $('#profileRole').textContent = `${currentAccount.role} · ${currentAccount.scope}`;
  $('#sidebarRole').textContent = currentAccount.role;
  $('#sidebarScope').textContent = currentAccount.scope;
  $('#notificationCount').textContent = unreadCount();
  $('#notificationCount').classList.toggle('is-hidden', unreadCount() === 0);
}

function navigate(view) {
  if (!allowedViews().includes(view)) view = 'dashboard';
  currentView = view;
  globalQuery = '';
  $('#globalSearch').value = '';
  $('#sidebar').classList.remove('open');
  closeDrawer();
  closeModal();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (currentAccount && serverSyncToken) syncServerState();
}

function departmentView() {
  const role=currentAccount.role;
  const titles={dashboard:'Tổng quan',customers:'Tra cứu khách hàng',orders:'Tra cứu đơn hàng',products:'Tra cứu sản phẩm',revenue:'Đối chiếu doanh thu',marketing:'Dữ liệu marketing',websites:'Nguồn website',notifications:'Thông báo'};
  const table=(headers,rows)=>`<section class="panel"><div class="table-wrap"><table><thead><tr>${headers.map(v=>`<th>${escapeHtml(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${escapeHtml(String(v??''))}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${headers.length}">Chưa có dữ liệu</td></tr>`}</tbody></table></div></section>`;
  let body='';
  if(currentView==='customers')body=table(['Tên','Điện thoại','Email','Nguồn','Trạng thái'],state.customers.map(r=>[r.name,r.phone,r.email,r.source,r.status]));
  else if(currentView==='orders')body=table(['Mã đơn','Khách hàng','Sản phẩm','Thành tiền','Trạng thái','Thanh toán lúc'],state.orders.map(r=>[r.code,r.customerName||customerById(r.customerId)?.name,r.productName,money(r.total),r.status,r.paidAt]));
  else if(currentView==='products')body=table(['Tên sản phẩm','SKU','Danh mục','Giá','Hoạt động'],state.products.map(r=>[r.name,r.sku,r.category,money(r.price),productAvailabilityMeta(r).status]));
  else if(currentView==='websites')body=table(['Tên','Tên miền','Trạng thái'],state.websites.map(r=>[r.name,r.domain,r.status]));
  else if(currentView==='marketing')body=table(['Nguồn','Khách hàng','Đơn hàng'],[...new Set(state.customers.map(r=>r.source||'Chưa xác định'))].map(source=>[source,state.customers.filter(r=>(r.source||'Chưa xác định')===source).length,state.orders.filter(r=>r.source===source).length]));
  else if(currentView==='revenue')body=table(['Mã đơn','Khách hàng','Loại','Thời điểm','Số tiền','Đối soát'],financialEvents(state.orders).map(r=>[r.code,r.customerName,r.label,r.occurredAt,money(r.amount),r.reconciled?'Đã đối soát':'Chưa đối soát']));
  else if(currentView==='notifications')body=table(['Tiêu đề','Nội dung','Thời điểm'],state.notifications.map(r=>[r.title,r.text,r.at]));
  else body=table(['Chỉ tiêu','Giá trị'],[['Khách hàng',state.customers.length],['Đơn hàng',state.orders.length],['Sản phẩm',state.products.length],['Doanh thu thuần',money(netRevenue(state.orders))]]);
  return pageHead(titles[currentView]||'Tổng quan',`${role==='MARKETING'?'Marketing':'Kế toán'} · quyền tra cứu, không sửa dữ liệu`, '<button class="button" id="departmentPasswordButton">Đổi mật khẩu của tôi</button>')+body;
}

function render() {
  if (!currentAccount) return;
  const renderer = ['MARKETING','ACCOUNTING'].includes(currentAccount.role) ? departmentView : VIEW_RENDERERS[currentView] || dashboardView;
  $('#content').innerHTML = renderer();
  $('#breadcrumb').textContent = viewLabel(currentView);
  renderNavigation();
  updateSessionChrome();
  if(['MARKETING','ACCOUNTING'].includes(currentAccount.role))$('#departmentPasswordButton')?.addEventListener('click',changePasswordModal);
  else bindViewActions();
}

function renderPreservingCustomerScroll() {
  const root = document.scrollingElement || document.documentElement;
  const pageTop = root.scrollTop;
  const wraps = $$('.table-wrap').map(element => ({ top: element.scrollTop, left: element.scrollLeft }));
  render();
  root.scrollTop = pageTop;
  window.scrollTo(0, pageTop);
  $$('.table-wrap').forEach((element, index) => { if (wraps[index]) { element.scrollTop = wraps[index].top; element.scrollLeft = wraps[index].left; } });
  window.getSelection?.()?.removeAllRanges();
}

function openDrawer(content) {
  drawerReturnFocus = document.activeElement;
  $('#drawerRoot').innerHTML = `<div class="drawer-backdrop" data-close-drawer></div><aside class="drawer" role="dialog" aria-modal="true"><div class="drawer-head"><div>${content.head}</div><button class="close-button" type="button" data-close-drawer aria-label="Đóng">×</button></div><div class="drawer-body">${content.body}</div></aside>`;
  if (content.body.includes('customerUpdateForm')) $('.drawer')?.classList.add('customer-detail-drawer');
  $$('[data-close-drawer]').forEach(item => item.onclick = closeDrawer);
  $('.drawer .close-button')?.focus();
}

function closeDrawer() {
  $('#drawerRoot').innerHTML = '';
  if (drawerReturnFocus?.isConnected) drawerReturnFocus.focus();
  drawerReturnFocus = null;
}

function openModal(title, body) {
  modalReturnFocus = document.activeElement;
  $('#modalRoot').innerHTML = `<div class="modal-backdrop" data-close-modal></div><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><h2 id="modalTitle">${escapeHtml(title)}</h2><button class="close-button" type="button" data-close-modal aria-label="Đóng">×</button></div><div class="modal-body">${body}</div></section>`;
  $$('[data-close-modal]').forEach(item => item.onclick = closeModal);
  $('.modal .close-button')?.focus();
}

function closeModal() {
  $('#modalRoot').innerHTML = '';
  if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
  modalReturnFocus = null;
}

function customFieldsModal() {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được quản lý cột khách hàng'); return; }
  const typeLabels = { TEXT: 'Nhập nội dung', NOTE: 'Ghi chú', SELECT: 'Chọn một', MULTI_SELECT: 'Chọn nhiều', CHECKBOX: 'Tích chọn', NOTIFICATION: 'Nhận thông báo' };
  openModal('Quản lý cột khách hàng', `<div class="field-manager"><div class="credential-hint"><b>Cột Level khách hàng có lịch sử bất biến.</b> Các cột mới tự xuất hiện trong bảng theo đúng kiểu dữ liệu.</div><button class="button button-primary" id="newCustomFieldButton" type="button">+ Thêm cột mới</button>${state.customFieldDefinitions.map(field => `<div class="field-manager-row ${field.active ? '' : 'is-archived'}"><div><b>${escapeHtml(field.label)}</b><small>${escapeHtml(typeLabels[field.type] || field.type)} · ${field.type === 'MULTI_SELECT' || field.type === 'NOTE' ? 'Hiện trong chi tiết' : 'Hiện trong bảng'}${field.active ? '' : ' · Đã lưu trữ'}</small></div><span class="field-pill" style="--pill:${escapeHtml(field.options?.[0]?.color || '#687771')}">${field.options?.length || 0} lựa chọn</span><button class="button button-small" data-edit-custom-field="${escapeHtml(field.id)}">Sửa</button><button class="button button-small ${field.active ? 'button-danger' : ''}" data-toggle-custom-field="${escapeHtml(field.id)}">${field.active ? 'Lưu trữ' : 'Khôi phục'}</button>${field.id !== 'customerLevel' ? `<button class="button button-small button-danger" data-delete-custom-field="${escapeHtml(field.id)}">Xóa</button>` : ''}</div>`).join('')}</div>`);
  $('#newCustomFieldButton').onclick = () => customFieldEditorModal();
  $$('[data-edit-custom-field]').forEach(button => button.onclick = () => customFieldEditorModal(button.dataset.editCustomField));
  $$('[data-toggle-custom-field]').forEach(button => button.onclick = () => toggleCustomField(button.dataset.toggleCustomField));
  $$('[data-delete-custom-field]').forEach(button => button.onclick = () => deleteCustomField(button.dataset.deleteCustomField));
}

function deleteCustomField(id) {
  if (currentAccount.role !== 'ADMIN' || id === 'customerLevel') { toast('Không thể xóa cột Level khách hàng'); return; }
  const field = state.customFieldDefinitions.find(item => item.id === id); if (!field) return;
  if (!window.confirm(`Xóa cột ${field.label}? Dữ liệu cột sẽ bị xóa khỏi hồ sơ.`)) return;
  state.customFieldDefinitions = state.customFieldDefinitions.filter(item => item.id !== id);
  state.customers.forEach(customer => { if (customer.customFields) delete customer.customFields[id]; });
  state.customerFieldHistory = state.customerFieldHistory.filter(item => item.fieldId !== id);
  audit('DELETE_CUSTOM_FIELD', id, field.label); saveState(); render(); toast('Đã xóa cột khách hàng');
}

function customFieldEditorModal(id = null) {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được quản lý cột'); return; }
  const existing = id ? state.customFieldDefinitions.find(field => field.id === id) : null;
  if (id && !existing) return;
  const field = existing || { label: '', type: 'TEXT', showInTable: false, required: false, options: [], notificationWebhookId: '' };
  const fieldType = field.notificationWebhookId ? 'NOTIFICATION' : field.type;
  const notificationWebhooks = state.websites.filter(website => website.provider === 'NOTIFICATION');
  const optionRows = (field.options || []).map(option => `<div class="field-option-row"><input data-option-label data-option-value="${escapeHtml(option.value)}" value="${escapeHtml(option.label)}" placeholder="Nội dung lựa chọn"><input data-option-color type="color" value="${escapeHtml(/^#[0-9a-f]{6}$/i.test(option.color) ? option.color : '#64748b')}" title="Màu lựa chọn"><button class="button button-small button-danger" type="button" data-remove-option>Xóa</button></div>`).join('');
  openModal(existing ? `Sửa cột · ${existing.label}` : 'Thêm cột khách hàng', `<form id="customFieldForm"><div class="form-grid"><label class="form-field">Tên cột<input id="customFieldLabel" maxlength="160" required value="${escapeHtml(field.label)}" placeholder="Ví dụ: Gọi kết nối"></label><label class="form-field">Kiểu dữ liệu<select id="customFieldType"><option value="TEXT" ${fieldType === 'TEXT' ? 'selected' : ''}>Nhập nội dung</option><option value="SELECT" ${fieldType === 'SELECT' ? 'selected' : ''}>Chọn một</option><option value="MULTI_SELECT" ${fieldType === 'MULTI_SELECT' ? 'selected' : ''}>Chọn nhiều</option><option value="CHECKBOX" ${fieldType === 'CHECKBOX' ? 'selected' : ''}>Tích chọn</option><option value="NOTE" ${fieldType === 'NOTE' ? 'selected' : ''}>Ghi chú</option><option value="NOTIFICATION" ${fieldType === 'NOTIFICATION' ? 'selected' : ''}>Nhận thông báo</option></select></label><label class="form-field full" id="customFieldNotificationWebhookWrap">Webhook nhận thông báo<select id="customFieldNotificationWebhook">${notificationWebhooks.length ? `<option value="">— Chọn webhook —</option>${notificationWebhooks.map(website => `<option value="${escapeHtml(website.id)}" ${field.notificationWebhookId === website.id ? 'selected' : ''}>${escapeHtml(website.name)}</option>`).join('')}` : '<option value="">Chưa có webhook Thông Báo</option>'}</select></label><div class="form-field full option-editor"><span>Nội dung lựa chọn <small>(chỉ dùng cho Chọn một / Chọn nhiều)</small></span><div id="customFieldOptions">${optionRows}</div><textarea id="customFieldOptionsLegacy" class="is-hidden">${escapeHtml((field.options || []).map(option => `${option.value}|${option.label}|${option.color}`).join('\n'))}</textarea><input id="customFieldShowTable" class="is-hidden" type="checkbox" checked><input id="customFieldRequired" class="is-hidden" type="checkbox"><button class="button button-small" type="button" id="addCustomFieldOption">+ Thêm nội dung</button></div></div><div class="modal-actions"><button class="button" type="button" id="backToFieldManager">Quay lại</button><button class="button button-primary" type="submit">Tạo cột</button></div></form>`);
  $('#backToFieldManager').onclick = customFieldsModal;
  $('#addCustomFieldOption').onclick = () => { $('#customFieldOptions').insertAdjacentHTML('beforeend', '<div class="field-option-row"><input data-option-label placeholder="Nội dung lựa chọn"><input data-option-color type="color" value="#64748b"><button class="button button-small button-danger" type="button" data-remove-option>Xóa</button></div>'); bindFieldOptionRows(); };
  bindFieldOptionRows();
  const syncFieldEditor = () => { const notification = $('#customFieldType').value === 'NOTIFICATION'; $('#customFieldNotificationWebhookWrap').hidden = !notification; $('#customFieldNotificationWebhook').required = notification; $('.option-editor').hidden = notification; };
  $('#customFieldType').onchange = syncFieldEditor;
  syncFieldEditor();
  $('#customFieldForm').onsubmit = event => { event.preventDefault(); saveCustomFieldDefinition(id); };
}

function bindFieldOptionRows() { $$('[data-remove-option]').forEach(button => button.onclick = () => button.closest('.field-option-row')?.remove()); }

function parseCustomFieldOptions(raw, type) {
  if (!['SELECT', 'MULTI_SELECT'].includes(type)) return [];
  const seen = new Set();
  return String(raw || '').split(/\r?\n/).map((line, index) => {
    const [rawValue, rawLabel, rawColor] = line.split('|').map(part => part?.trim() || '');
    const value = rawValue.slice(0, 160);
    if (!value || seen.has(value)) return null;
    seen.add(value);
    return { value, label: (rawLabel || value).slice(0, 200), color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : FIELD_COLORS[index % FIELD_COLORS.length] };
  }).filter(Boolean);
}

function saveCustomFieldDefinition(id = null) {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được quản lý cột'); return; }
  const existing = id ? state.customFieldDefinitions.find(field => field.id === id) : null;
  const label = $('#customFieldLabel')?.value.trim(), requestedType = $('#customFieldType')?.value;
  const type = id === 'customerLevel' ? 'SELECT' : requestedType;
  const rowInputs = $$('[data-option-label]');
  const optionRaw = rowInputs.length ? rowInputs.map((input, index) => `${input.dataset.optionValue || input.value.trim()}|${input.value.trim()}|${$$('[data-option-color]')[index]?.value || '#64748b'}`).join('\n') : ($('#customFieldOptions')?.value || $('#customFieldOptionsLegacy')?.value || '');
  const options = parseCustomFieldOptions(optionRaw, type);
  if (!label || !['TEXT', 'NOTE', 'SELECT', 'MULTI_SELECT', 'CHECKBOX', 'NOTIFICATION'].includes(type)) { toast('Tên hoặc kiểu cột không hợp lệ'); return; }
  if (['SELECT', 'MULTI_SELECT'].includes(type) && !options.length) { toast('Cột lựa chọn cần ít nhất một phương án'); return; }
  if (state.customFieldDefinitions.some(field => field.id !== id && normalize(field.label) === normalize(label))) { toast('Tên cột đã tồn tại'); return; }
  const notificationWebhookId = type === 'NOTIFICATION' ? String($('#customFieldNotificationWebhook')?.value || '') : '';
  if (type === 'NOTIFICATION' && !notificationWebhookId) { toast('Hãy chọn webhook nhận thông báo'); return; }
  const next = { id: existing?.id || `field-${Date.now()}`, label, type, showInTable: true, required: false, active: existing?.active !== false, options, notificationWebhookId };
  if (existing) {
    const previousDefinition = structuredClone(existing);
    Object.assign(existing, next);
    state.customers.forEach(customer => {
      const previous = customer.customFields?.[id] ?? defaultCustomFieldValue(previousDefinition);
      const sanitized = sanitizeCustomFieldValue(previous, existing);
      if (JSON.stringify(previous) !== JSON.stringify(sanitized)) recordFieldChange(customer, previousDefinition, previous, sanitized, 'SYSTEM');
      customer.customFields[id] = sanitized;
    });
    audit('UPDATE_CUSTOM_FIELD', id, `${previousDefinition.label} -> ${label} · ${type}`);
  } else {
    state.customFieldDefinitions.push(next);
    state.customers.forEach(customer => { customer.customFields[next.id] = defaultCustomFieldValue(next); });
    audit('CREATE_CUSTOM_FIELD', next.id, `${label} · ${type}`);
  }
  saveState(); render(); customFieldsModal(); toast(existing ? 'Đã cập nhật cột; lịch sử cũ không thay đổi' : 'Đã thêm cột khách hàng');
}

function toggleCustomField(id) {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được quản lý cột'); return; }
  if (id === 'customerLevel') { toast('Level khách hàng là cột nghiệp vụ bắt buộc, không thể lưu trữ'); return; }
  const field = state.customFieldDefinitions.find(item => item.id === id);
  if (!field) return;
  field.active = !field.active;
  audit(field.active ? 'RESTORE_CUSTOM_FIELD' : 'ARCHIVE_CUSTOM_FIELD', field.id, field.label);
  saveState(); render(); customFieldsModal(); toast(field.active ? 'Đã khôi phục cột' : 'Đã lưu trữ cột; toàn bộ lịch sử vẫn được giữ');
}

function openCustomerDrawer(id) {
  const customer = customerById(id);
  if (!canViewCustomer(customer)) { toast('NOT_FOUND · khách hàng nằm ngoài phạm vi tài khoản'); return; }
  const canUpdate = canUpdateCustomer(customer);
  const canEditName = canEditCustomerName(customer);
  const canEditCustomerForm = canUpdate || canEditName;
  const orders = scopedOrders().filter(order => order.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const notes = state.notes.filter(note => note.customerId === id).sort((a, b) => b.at.localeCompare(a.at));
  const followUps = scopedTasks().filter(task => task.customerId === id).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const fieldHistory = state.customerFieldHistory.filter(item => item.customerId === id).sort((a, b) => b.at.localeCompare(a.at));
  const levelHistory = fieldHistory.filter(item => item.fieldId === 'customerLevel');
  const otherFieldHistory = fieldHistory.filter(item => item.fieldId !== 'customerLevel').slice(0, 12);
  const resubmissions = state.resubmissions.filter(item => item.customerId === id).sort((a, b) => b.at.localeCompare(a.at));
  const assignmentHistory = state.assignmentHistory.filter(item => item.customerId === id).sort((a, b) => b.at.localeCompare(a.at));
  const assignmentTargets = currentAccount.role === 'ADMIN'
    ? assignmentCandidates({ leaderId: null })
    : effectivePermissionRole() === 'MANAGER'
      ? managerAssignmentRecipients()
    : currentAccount.role === 'LEADER'
      ? assignmentCandidates({ leaderId: currentAccount.leaderId, teamId: currentAccount.teamId })
      : [];
  const assignmentHtml = assignmentTargets.length ? `<section class="customer-drawer-section customer-assignment-section"><div class="customer-section-heading"><div><h3>Phân công phụ trách</h3><p>${currentAccount.role === 'ADMIN' ? 'Chọn Leader hoặc Team xử lý khách hàng' : 'Chọn Sale trong phạm vi được phân quyền'}</p></div></div><div class="form-grid"><label class="form-field">${currentAccount.role === 'ADMIN' ? 'Leader / Team' : 'Sale trong Team'}<select id="customerAssignee">${assignmentTargets.map(person => `<option value="${escapeHtml(person.id)}" ${(currentAccount.role === 'ADMIN' ? customer.leaderId : customer.saleId) === person.id ? 'selected' : ''}>${escapeHtml(person.name)} · ${escapeHtml(person.teamId)}</option>`).join('')}</select></label><div class="form-field"><span>Thao tác</span><div class="panel-actions"><button class="button button-primary" type="button" data-reassign-customer="${escapeHtml(customer.id)}">${currentAccount.role === 'ADMIN' ? 'Chuyển Leader' : 'Giao Sale'}</button>${(currentAccount.role === 'ADMIN' ? customer.leaderId : customer.saleId) ? `<button class="button button-danger" type="button" data-revoke-customer="${escapeHtml(customer.id)}">Thu hồi về Khách mới</button>` : ''}</div></div></div></section>` : '';
  const sourceDetails = currentAccount.role === 'ADMIN' ? (() => { const source=customerSourceDetails(customer); return `<dt>Landing page nguồn</dt><dd>${escapeHtml(source.name)}</dd><dt>URL nguồn</dt><dd class="mono">${escapeHtml(source.url || source.domain || 'Nguồn chưa được gắn')}</dd><dt>Nguồn / Campaign</dt><dd>${escapeHtml([customer.source,customer.campaign].filter(Boolean).join(' · '))}</dd>`; })() : '';
  const levelField = state.customFieldDefinitions.find(field => field.id === 'customerLevel') || CUSTOM_FIELD_SEED[0];
  const levelTimeline = levelHistory.map(item => `<div class="timeline-item history-change"><b>${escapeHtml(customFieldValueLabel(levelField, item.to) || 'Chưa đặt Level')}</b><p>${item.from === '' ? 'Khởi tạo Level' : `${escapeHtml(customFieldValueLabel(levelField, item.from) || 'Trống')} → ${escapeHtml(customFieldValueLabel(levelField, item.to) || 'Trống')}`}</p><small>${escapeHtml(item.at)} · ${escapeHtml(item.actor)} · ${escapeHtml(item.source)}</small></div>`).join('');
  const followUpDefault = new Date(Date.now() + 24 * 60 * 60 * 1000);
  followUpDefault.setHours(9, 0, 0, 0);
  const followUpDefaultDueAt = `${followUpDefault.getFullYear()}-${String(followUpDefault.getMonth() + 1).padStart(2, '0')}-${String(followUpDefault.getDate()).padStart(2, '0')}T09:00`;
  const businessFields = activeCustomFields().filter(field => field.type === 'MULTI_SELECT' || field.type === 'NOTE');
  const businessHtml = businessFields.length ? `<section class="customer-drawer-section customer-business-section"><div class="customer-section-heading"><div><h3>Thông tin tư vấn</h3><p>Chọn nhu cầu và ghi chú của khách hàng</p></div><span class="customer-section-kicker">Nghiệp vụ</span></div>${canUpdate ? `<form id="customerCustomFieldsForm"><div class="form-grid custom-field-grid">${businessFields.map(field => customFieldInput(field, customer.customFields?.[field.id])).join('')}</div><div class="modal-actions"><button class="button button-primary" type="submit">Lưu thông tin tư vấn</button></div></form>` : `<div class="custom-field-readonly">${businessFields.map(field => `<div><small>${escapeHtml(field.label)}</small>${customFieldCell(field, customer.customFields?.[field.id])}</div>`).join('')}</div>`}</section>` : '';
  const updateHtml = `<section class="customer-drawer-section customer-edit-section"><div class="customer-section-heading"><div><h3>Thông tin cần cập nhật</h3><p>Đổi tên khách hàng hoặc cập nhật trạng thái hiện tại</p></div></div>${canEditCustomerForm ? `<form id="customerUpdateForm"><div class="form-grid"><label class="form-field">Tên khách hàng<input id="customerName" type="text" maxlength="160" value="${escapeHtml(customer.name || '')}" ${canEditName ? '' : 'readonly'}></label><label class="form-field">Trạng thái<select id="customerStatus" ${canUpdate ? '' : 'disabled'}>${Object.entries(STATUS_META).map(([key, meta]) => `<option value="${key}" ${customer.status === key ? 'selected' : ''}>${escapeHtml(meta.label)}</option>`).join('')}</select></label></div><div class="modal-actions"><button class="button button-primary" type="submit">${canEditName && canUpdate ? 'Lưu thông tin khách hàng' : canEditName ? 'Lưu tên khách hàng' : 'Cập nhật trạng thái'}</button></div></form>` : `<div class="form-hint">Tài khoản hiện tại chỉ được xem thông tin khách hàng.</div>`}</section>`;
  const productHtml = orders.length || canUpdate ? `<section class="customer-drawer-section"><div class="customer-section-heading section-label-with-action"><div><h3>Sản phẩm & đơn hàng</h3><p>${orders.length ? `${orders.length} đơn hàng đã ghi nhận` : 'Chưa có đơn hàng nào'}</p></div>${canUpdate ? `<button class="button button-small" type="button" data-new-customer-product="${escapeHtml(customer.id)}">+ Thêm</button>` : ''}</div><div class="purchase-list">${orders.map(order => `<button class="purchase-row" type="button" data-customer-order="${escapeHtml(order.id)}"><span><b>${escapeHtml(order.productName)}</b><small>${escapeHtml(order.code)} · SL ${order.qty} · ${escapeHtml(order.createdAt)}</small></span><span class="right"><b>${money(order.total)}</b>${statusBadge(order.status, 'order')}</span></button>`).join('') || '<div class="empty compact"><b>Chưa có sản phẩm</b><span>Đơn hàng mới của khách sẽ hiển thị tại đây.</span></div>'}</div></section>` : '';
  const notesHtml = notes.length || canUpdate ? `<section class="customer-drawer-section"><div class="customer-section-heading"><div><h3>Ghi chú chăm sóc</h3><p>${notes.length ? `${notes.length} ghi chú gần nhất` : 'Lưu lại nhu cầu và nội dung trao đổi'}</p></div></div>${canUpdate ? `<form id="customerNoteForm"><label class="form-field">Ghi chú mới<textarea id="customerNote" rows="3" maxlength="2000" placeholder="Nhập nhu cầu, trao đổi hoặc thông tin cần theo dõi..."></textarea></label><div class="modal-actions"><button class="button button-primary" type="submit">Thêm ghi chú</button></div></form>` : ''}${notes.length ? `<div class="timeline note-timeline">${notes.map(note => `<div class="timeline-item"><b>${escapeHtml(note.author)} · ${escapeHtml(note.role)}</b><p>${escapeHtml(note.text)}</p><small>${escapeHtml(note.at)}</small><div class="note-actions"><button class="button button-small" type="button" data-edit-note="${escapeHtml(note.id)}">Sửa</button><button class="button button-small button-danger" type="button" data-delete-note="${escapeHtml(note.id)}">Xóa</button></div></div>`).join('')}</div>` : ''}</section>` : '';
   const followUpHtml = followUps.length || (canUpdate && customer.saleId) ? `<section class="customer-drawer-section"><div class="customer-section-heading"><div><h3>Lịch chăm sóc</h3><p>${followUps.length ? `${followUps.length} lịch đang theo dõi` : 'Tạo lịch gọi lại hoặc gửi báo giá'}</p></div></div>${canUpdate && customer.saleId ? `<form id="customerFollowUpForm"><div class="form-grid"><label class="form-field">Nội dung<input id="followUpType" maxlength="160" required placeholder="Gọi lại / gửi báo giá..."></label><label class="form-field">Hạn xử lý<input id="followUpDueAt" type="datetime-local" required value="${followUpDefaultDueAt}"></label><label class="form-field">Ưu tiên<select id="followUpPriority"><option value="NORMAL">Thường</option><option value="HIGH">Cao</option></select></label></div><div class="modal-actions"><button class="button" type="submit">+ Thêm lịch</button></div></form>` : ''}<div class="follow-up-list">${followUps.map(task => `<div class="follow-up-row"><span><b>${escapeHtml(task.type)}</b><small>${escapeHtml(task.dueAt)} · ${escapeHtml(staffName(task.ownerId))}</small></span><span>${statusBadge(task.status, 'task')}${task.status !== 'DONE' && canUpdate ? `<button class="button button-small" type="button" data-complete-task="${escapeHtml(task.id)}">Hoàn tất</button>` : ''}</span></div>`).join('') || '<div class="empty compact"><b>Chưa có lịch chăm sóc</b><span>Tạo lịch mới ngay trong hồ sơ khách.</span></div>'}</div></section>` : '';
  const historyHtml = [
    levelHistory.length ? `<section class="customer-drawer-section customer-history-section"><div class="customer-section-heading"><div><h3>Lịch sử Level</h3><p>Các lần thay đổi được giữ nguyên, không ghi đè</p></div></div><div class="timeline level-history">${levelTimeline}</div></section>` : '',
    currentAccount.role === 'ADMIN' && resubmissions.length ? `<section class="customer-drawer-section customer-history-section"><div class="customer-section-heading"><div><h3>Lịch sử điền lại form</h3><p>${resubmissions.length} lần gửi lại của khách</p></div></div><div class="timeline">${resubmissions.map(item => `<div class="timeline-item"><b>${item.registeredAccount ? 'DATA TRÙNG - DATA đã đăng ký TK' : 'DATA TRÙNG'}</b><p>${escapeHtml(item.source)} · ${escapeHtml(item.campaign || 'Không có campaign')} · giữ Sale ${escapeHtml(staffName(item.assignedSaleId))}</p><small>${escapeHtml(item.at)} · ${escapeHtml(item.intakeType)}</small></div>`).join('')}</div></section>` : '',
    currentAccount.role === 'ADMIN' && assignmentHistory.length ? `<section class="customer-drawer-section customer-history-section"><div class="customer-section-heading"><div><h3>Lịch sử phân công</h3><p>${assignmentHistory.length} lần thay đổi phụ trách</p></div></div><div class="timeline">${assignmentHistory.map(item => `<div class="timeline-item"><b>${escapeHtml(item.toSaleName || item.toLeaderName || 'Thu hồi về Khách mới')}</b><p>${escapeHtml(item.reason)} · từ ${escapeHtml(item.fromSaleName || item.fromLeaderName || 'Khách mới')}</p><small>${escapeHtml(item.at)} · ${escapeHtml(item.actor)}</small></div>`).join('')}</div></section>` : '',
    otherFieldHistory.length ? `<section class="customer-drawer-section customer-history-section"><div class="customer-section-heading"><div><h3>Thay đổi nghiệp vụ</h3><p>${otherFieldHistory.length} cập nhật gần đây</p></div></div><div class="timeline">${otherFieldHistory.map(item => `<div class="timeline-item"><b>${escapeHtml(item.fieldLabel)}</b><p>${escapeHtml(String(customFieldValueLabel(state.customFieldDefinitions.find(field => field.id === item.fieldId), item.from) || 'Trống'))} → ${escapeHtml(String(customFieldValueLabel(state.customFieldDefinitions.find(field => field.id === item.fieldId), item.to) || 'Trống'))}</p><small>${escapeHtml(item.at)} · ${escapeHtml(item.actor)}</small></div>`).join('')}</div></section>` : ''
  ].join('');
  openDrawer({
    head: `<h2>${escapeHtml(customer.name)}</h2><p>${currentAccount.role === 'SALE' && !customer.saleAcceptedAt ? '•••••' : escapeHtml(customer.phone)}</p>`,
    body: `<div class="customer-drawer-layout">${resubmissions.length ? `<div class="duplicate-alert"><b>DATA TRÙNG · ${resubmissions.length} lần gửi lại</b><span>${resubmissions[0].registeredAccount ? 'DATA đã đăng ký TK' : 'Đã giữ đúng người phụ trách trước đó'} · gần nhất ${escapeHtml(resubmissions[0].at)}</span></div>` : ''}<section class="customer-drawer-section customer-overview-section"><div class="customer-section-heading"><div><h3>Thông tin chính</h3><p>Thông tin nhận diện và phân loại khách hàng</p></div><span class="customer-section-kicker">Hồ sơ khách</span></div><dl class="detail-grid"><dt>Email</dt><dd>${escapeHtml(customer.email || 'Chưa cập nhật')}</dd>${sourceDetails}<dt>IP truy cập</dt><dd class="mono">${escapeHtml(customer.ipAddress || 'Chưa xác định')}</dd><dt>Trạng thái</dt><dd>${statusBadge(customer.status)}</dd><dt>Team / Leader</dt><dd>${escapeHtml(customer.teamId || 'Khách mới')} · ${escapeHtml(staffName(customer.leaderId))}</dd><dt>Sale phụ trách</dt><dd>${escapeHtml(staffName(customer.saleId))}</dd><dt>Ngày tạo</dt><dd>${escapeHtml(customer.createdAt)}</dd><dt>Doanh thu thuần</dt><dd>${money(netRevenue(orders))}</dd></dl></section>${updateHtml}${assignmentHtml}${businessHtml}<section id="customerCareSection" class="customer-drawer-section customer-care-section"><div class="customer-section-heading"><div><h3>Chăm sóc khách hàng</h3><p>Ghi chú, lịch xử lý và lịch hẹn được quản lý tại đây</p></div></div>${notesHtml}${followUpHtml}<div class="customer-drawer-subsection"><div class="customer-section-heading section-label-with-action"><div><h3>Lịch hẹn</h3><p>Bot Telegram sẽ nhắc trước giờ hẹn</p></div>${canUpdate ? `<button class="button button-small button-primary" type="button" id="btnNewCustAppointment">+ Đặt lịch</button>` : ''}</div><div id="customerAppointmentsList" class="follow-up-list"><div class="empty compact"><b>Đang tải lịch hẹn...</b></div></div></div></section>${productHtml}${historyHtml}</div>`
  });
  if (currentAccount.role !== 'ADMIN') {
    const drawerDetails = $('#drawerRoot .detail-grid');
    drawerDetails?.querySelectorAll('dt').forEach(dt => {
      if (dt.textContent.trim() === 'IP truy cập') { dt.hidden = true; dt.nextElementSibling?.setAttribute('hidden', ''); }
    });
  }
  const form = $('#customerUpdateForm');
  if (form) form.onsubmit = event => { event.preventDefault(); updateCustomer(id); };
  const noteForm = $('#customerNoteForm');
  if (noteForm) noteForm.onsubmit = event => { event.preventDefault(); addCustomerNote(id); };
  const customFieldsForm = $('#customerCustomFieldsForm');
  if (customFieldsForm) customFieldsForm.onsubmit = event => { event.preventDefault(); updateCustomerCustomFields(id); };
  const followUpForm = $('#customerFollowUpForm');
  if (followUpForm) followUpForm.onsubmit = event => { event.preventDefault(); addCustomerFollowUp(id); };
  $$('[data-customer-order]').forEach(button => button.onclick = () => openOrderDrawer(button.dataset.customerOrder));
  $$('[data-complete-task]').forEach(button => button.onclick = () => completeTask(button.dataset.completeTask));
  $('[data-reassign-customer]')?.addEventListener('click', () => reassignCustomer(id, $('#customerAssignee').value));
  $('[data-revoke-customer]')?.addEventListener('click', () => revokeCustomer(id));
  renderCustomerAppointments(id);
  $('#btnNewCustAppointment')?.addEventListener('click', () => openNewAppointmentModal(id));
}

async function updateCustomer(id) {
  const customer = customerById(id);
  if (!canViewCustomer(customer)) { closeDrawer(); toast('FORBIDDEN · không thể cập nhật khách ngoài scope'); return; }
  const canUpdate = canUpdateCustomer(customer);
  const canEditName = canEditCustomerName(customer);
  if (!canUpdate && !canEditName) { toast('FORBIDDEN · tài khoản không có quyền cập nhật'); return; }
  const nameInput = $('#customerName');
  const nextName = nameInput && canEditName ? nameInput.value.trim() : customer.name;
  if (!nextName || nextName.length > 160) { toast('Tên khách hàng phải có từ 1 đến 160 ký tự'); return; }
  const nextStatus = canUpdate ? $('#customerStatus').value : customer.status;
  if (!Object.hasOwn(STATUS_META, nextStatus)) { toast('Trạng thái khách hàng không hợp lệ'); return; }
  if (nextName === customer.name && nextStatus === customer.status) { toast('Thông tin khách hàng chưa thay đổi'); return; }
  const oldName = customer.name;
  const oldStatus = customer.status;
  customer.name = nextName;
  customer.status = nextStatus;
  customer.updatedAt = stamp();
  if (oldName !== nextName) audit('UPDATE_CUSTOMER_NAME', customer.id, `${oldName} -> ${nextName}`);
  if (oldStatus !== nextStatus) audit('UPDATE_CUSTOMER_STATUS', customer.id, `${STATUS_META[oldStatus]?.label || oldStatus} -> ${STATUS_META[nextStatus]?.label || nextStatus}`);
  if (state.settings.notifyMilestones && ['PAID', 'WON'].includes(nextStatus)) state.notifications.unshift({ id: `NT-${Date.now()}`, role: 'ADMIN', title: 'Khách đạt milestone', text: `${customer.name} chuyển sang ${STATUS_META[nextStatus].label}.`, at: new Date().toISOString(), readBy: [] });
  if (!await persistCustomer(customer)) { toast('Không thể lưu khách hàng lên MySQL'); return; }
  saveState(); render(); openCustomerDrawer(id); toast(oldName !== nextName && oldStatus !== nextStatus ? 'Đã cập nhật tên và trạng thái khách hàng' : oldName !== nextName ? 'Đã cập nhật tên khách hàng' : 'Đã cập nhật trạng thái khách hàng');
}

async function quickUpdateCustomerStatus(id, nextStatus) {
  const customer = customerById(id);
  if (!canViewCustomer(customer) || !canUpdateCustomer(customer) || !Object.hasOwn(STATUS_META, nextStatus)) { toast('Không thể cập nhật trạng thái'); return; }
  const oldStatus = customer.status;
  if (oldStatus === nextStatus) return;
  customer.status = nextStatus;
  customer.updatedAt = stamp();
  audit('UPDATE_CUSTOMER_STATUS', customer.id, `${STATUS_META[oldStatus]?.label || oldStatus} -> ${STATUS_META[nextStatus].label}`);
  if (!await persistCustomer(customer)) { toast('Không thể lưu khách hàng lên MySQL'); return; }
  saveState(); renderPreservingCustomerScroll();
}

async function quickUpdateCustomerField(customerId, fieldId, value) {
  const field = state.customFieldDefinitions.find(item => item.id === fieldId && item.active !== false);
  if (!field || !['SELECT', 'CHECKBOX'].includes(field.type)) { toast('Cột option không hợp lệ'); render(); return false; }
  const result = setCustomerCustomFields(customerId, { [fieldId]: value });
  if (result.error) { toast(result.error === 'FORBIDDEN' ? 'FORBIDDEN · không có quyền cập nhật cột này' : result.error); render(); return false; }
  if (!result.updated) return false;
  if (!await persistCustomer(customerById(customerId))) { toast('Không thể lưu khách hàng lên MySQL'); return false; }
  saveState(); renderPreservingCustomerScroll();
  return true;
}

function quickMultiSelectModal(customerId, fieldId) {
  const customer = customerById(customerId);
  const field = state.customFieldDefinitions.find(item => item.id === fieldId && item.active !== false && item.type === 'MULTI_SELECT');
  if (!field || !canViewCustomer(customer) || !canUpdateCustomer(customer)) { toast('FORBIDDEN · không có quyền chọn option'); return; }
  const selected = Array.isArray(customer.customFields?.[field.id]) ? customer.customFields[field.id] : [];
  openModal(`Chọn option · ${field.label}`, `<form id="quickMultiSelectForm"><div class="quick-option-list">${field.options.map(option => `<label><input type="checkbox" data-quick-multi-option value="${escapeHtml(option.value)}" ${selected.includes(option.value) ? 'checked' : ''}><span class="field-pill" style="--pill:${escapeHtml(option.color)}">${escapeHtml(option.label)}</span></label>`).join('')}</div><div class="modal-actions"><button class="button" type="button" data-close-modal>Hủy</button><button class="button button-primary" type="submit">Lưu lựa chọn</button></div></form>`);
  $('[data-close-modal]')?.addEventListener('click', closeModal);
  $('#quickMultiSelectForm').onsubmit = async event => {
    event.preventDefault();
    const values = $$('[data-quick-multi-option]:checked').map(input => input.value);
    const result = setCustomerCustomFields(customerId, { [fieldId]: values });
    if (result.error) { toast(result.error); return; }
    if (!await persistCustomer(customerById(customerId))) {
      toast('Chưa lưu được lựa chọn lên MySQL. Giữ form mở và thử lại.');
      return;
    }
    saveState(); closeModal(); renderPreservingCustomerScroll();
  };
}

async function addCustomerNote(id) {
  const customer = customerById(id), text = $('#customerNote')?.value.trim();
  if (!canViewCustomer(customer) || !canUpdateCustomer(customer) || !text) { toast('Vui lòng nhập ghi chú hợp lệ'); return; }
  state.notes.unshift({ id: makeRecordId('NOTE'), customerId: customer.id, authorId: currentAccount.id, author: currentAccount.name, role: currentAccount.role, text: text.slice(0, 2000), at: stamp() });
  customer.note = text.slice(0, 2000);
  customer.updatedAt = stamp();
  audit('ADD_CUSTOMER_NOTE', customer.id, customer.note);
  saveState();
  const saved = await flushServerPersistence();
  render(); openCustomerDrawer(id);
  toast(saved ? 'Đã lưu ghi chú vào MySQL.' : 'Chưa lưu được ghi chú. Bản nháp đang được giữ lại để thử lưu lại.');
}

function editCustomerNote(noteId) {
  const note = state.notes.find(item => item.id === noteId); const customer = note && customerById(note.customerId);
  if (!note || !customer || !canUpdateCustomer(customer)) { toast('Không có quyền sửa ghi chú'); return; }
  openModal('Sửa ghi chú', `<form id="editNoteForm"><label class="form-field">Nội dung<textarea id="editNoteText" rows="5" required>${escapeHtml(note.text)}</textarea></label><div class="modal-actions"><button class="button" type="button" data-close-modal>Huỷ</button><button class="button button-primary" type="submit">Lưu thay đổi</button></div></form>`);
  $('[data-close-modal]')?.addEventListener('click', closeModal);
  $('#editNoteForm').onsubmit = event => { event.preventDefault(); const text = $('#editNoteText').value.trim(); if (!text) return; note.text = text.slice(0, 2000); note.editedAt = stamp(); customer.note = note.text; customer.updatedAt = stamp(); audit('EDIT_CUSTOMER_NOTE', customer.id, note.id);
    saveState();
    void flushServerPersistence().then(saved => { if (!saved) toast('Ghi chú đang được giữ lại, hệ thống sẽ thử lưu lại khi kết nối ổn định.'); });
    closeModal(); render(); openCustomerDrawer(customer.id); };
}

function deleteCustomerNote(noteId) {
  const note = state.notes.find(item => item.id === noteId); const customer = note && customerById(note.customerId);
  if (!note || !customer || !canUpdateCustomer(customer)) { toast('Không có quyền xóa ghi chú'); return; }
  if (!window.confirm('Xóa ghi chú này?')) return;
  state.notes = state.notes.filter(item => item.id !== noteId); customer.note = state.notes.find(item => item.customerId === customer.id)?.text || ''; customer.updatedAt = stamp(); audit('DELETE_CUSTOMER_NOTE', customer.id, noteId);
  saveState();
  void flushServerPersistence().then(saved => { if (!saved) toast('Thay đổi ghi chú đang được giữ lại để thử lưu lại.'); });
  render(); openCustomerDrawer(customer.id);
}

function addCustomerFollowUp(id) {
  const customer = customerById(id);
  if (!canViewCustomer(customer) || !canUpdateCustomer(customer) || !customer.saleId) { toast('Khách cần được phân Sale trước khi tạo lịch'); return; }
  const type = $('#followUpType')?.value.trim(), rawDueAt = $('#followUpDueAt')?.value, dueAt = String(rawDueAt || '').replace('T', ' ').slice(0, 16);
  if (!type || !cleanTimestamp(dueAt)) { toast('Nội dung hoặc hạn xử lý không hợp lệ'); return; }
  state.tasks.unshift({ id: `TSK-${Date.now()}-${customer.id}`, customerId: customer.id, customerName: customer.name, ownerId: customer.saleId, leaderId: customer.leaderId, teamId: customer.teamId, type: type.slice(0, 160), createdAt: stamp(), dueAt, slaBased: false, status: dueAt < stamp() ? 'OVERDUE' : 'OPEN', priority: $('#followUpPriority')?.value === 'HIGH' ? 'HIGH' : 'NORMAL' });
  audit('ADD_FOLLOW_UP', customer.id, `${type} · ${dueAt}`);
  saveState(); render(); openCustomerDrawer(id); toast('Đã thêm lịch chăm sóc');
}

const APPOINTMENT_TYPE_LABELS = {
  DEPOSIT: '🎯 Chốt cọc / Deposit',
  CONSULTING: '🗣️ Tư vấn chuyên sâu 1-1',
  PAYMENT: '💵 Hẹn thanh toán',
  COURSE: '🎓 Tư vấn Khóa học & Chỉ báo',
  OTHER: '📌 Cuộc hẹn quan trọng'
};

async function renderCustomerAppointments(customerId) {
  const container = $('#customerAppointmentsList');
  if (!container) return;
  try {
    const res = await fetch(`${webhookApiBase()}/api/appointments?customerId=${encodeURIComponent(customerId)}`, {
      headers: { Authorization: `Bearer ${serverSyncToken}` }
    });
    const data = await res.json();
    const list = data.appointments || [];
    const appointmentSection = container.closest('.customer-drawer-subsection');
    if (!list.length) {
      container.innerHTML = '<div class="empty compact"><b>Chưa có lịch hẹn nào</b><span>Bấm "+ Đặt lịch hẹn" để tạo, Bot Telegram sẽ tự động nhắc trước 15-30 phút.</span></div>';
      if (appointmentSection && !$('#btnNewCustAppointment')) {
        appointmentSection.hidden = true;
        if (!$('#customerCareSection > .customer-drawer-section')) $('#customerCareSection').hidden = true;
      }
      return;
    }
    if (appointmentSection) appointmentSection.hidden = false;
    container.innerHTML = list.map(app => {
      const typeLabel = APPOINTMENT_TYPE_LABELS[app.type] || app.type || 'Lịch hẹn';
      const isScheduled = app.status === 'SCHEDULED';
      const statusBadge = isScheduled ? '<span class="status status-pending">Đang chờ</span>' : app.status === 'COMPLETED' ? '<span class="status status-paid">Hoàn thành</span>' : '<span class="status status-cancelled">Đã hủy</span>';
      const dt = app.appointment_time ? new Date(app.appointment_time).toLocaleString('vi-VN', { hour12: false }) : '';
      return `<div class="follow-up-row" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:var(--bg-card,#fff)">
        <div>
          <b>${escapeHtml(typeLabel)}</b> <span style="margin-left:6px;font-size:12px;color:var(--text-muted)">⏰ ${escapeHtml(dt)}</span>
          ${app.note ? `<p style="margin:4px 0 2px;font-size:12.5px;color:var(--text-main)"><i>${escapeHtml(app.note)}</i></p>` : ''}
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Sale: <b>${escapeHtml(app.sale_name || 'Chưa gán')}</b> ${app.reminded_at ? '· <span style="color:#10b981">✓ Bot đã gửi nhắc nhở</span>' : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          ${statusBadge}
          ${isScheduled ? `
            <button class="button button-small" type="button" data-app-action="COMPLETE" data-app-id="${escapeHtml(app.id)}">✓ Xong</button>
            <button class="button button-small button-danger" type="button" data-app-action="CANCEL" data-app-id="${escapeHtml(app.id)}">✕ Hủy</button>
          ` : ''}
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('[data-app-action]').forEach(btn => {
      btn.onclick = async () => {
        const appId = btn.dataset.appId;
        const action = btn.dataset.appAction;
        const nextStatus = action === 'COMPLETE' ? 'COMPLETED' : 'CANCELLED';
        btn.disabled = true;
        try {
          await fetch(`${webhookApiBase()}/api/appointments/${encodeURIComponent(appId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serverSyncToken}` },
            body: JSON.stringify({ status: nextStatus })
          });
          toast(action === 'COMPLETE' ? 'Đã hoàn thành lịch hẹn' : 'Đã hủy lịch hẹn');
          renderCustomerAppointments(customerId);
        } catch (err) {
          toast('Lỗi cập nhật lịch hẹn');
        }
      };
    });
  } catch (err) {
    container.innerHTML = '<div class="empty compact"><b>Không tải được lịch hẹn</b></div>';
    if (!$('#btnNewCustAppointment')) container.closest('.customer-drawer-subsection')?.setAttribute('hidden', '');
  }
}

function openNewAppointmentModal(customerId) {
  const customer = customerById(customerId);
  if (!customer) return;
  const bodyHtml = `<form id="newAppointmentForm">
    <div class="form-grid">
      <label class="form-field">Khách hàng<input value="${escapeHtml(customer.name)} · ${escapeHtml(customer.phone)}" readonly style="background:var(--bg-subtle,#f1f5f9);font-weight:600"></label>
      <label class="form-field">Mục đích cuộc hẹn
        <select id="appTypeSelect" required>
          <option value="CONSULTING">🗣️ Tư vấn chuyên sâu 1-1</option>
          <option value="DEPOSIT">🎯 Chốt cọc / Deposit</option>
          <option value="PAYMENT">💵 Hẹn thanh toán</option>
          <option value="COURSE">🎓 Tư vấn Khóa học &amp; Chỉ báo</option>
          <option value="OTHER">📌 Cuộc hẹn quan trọng khác</option>
        </select>
      </label>
      <label class="form-field">Thời gian hẹn (Ngày &amp; Giờ)
        <input type="datetime-local" id="appDateTime" required>
      </label>
      <label class="form-field">Ghi chú chuẩn bị
        <textarea id="appNote" rows="3" placeholder="Nội dung cần trao đổi, tài liệu cần chuẩn bị..."></textarea>
      </label>
    </div>
    <div class="credential-hint" style="margin-top:10px">🤖 <b>Bot Telegram</b> sẽ tự động gửi tin nhắn kèm đầy đủ thông tin nhắc nhở Sale trước giờ hẹn 15-30 phút.</div>
    <div class="modal-actions" style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
      <button type="button" class="button button-secondary" data-close-modal>Hủy</button>
      <button type="submit" class="button button-primary">✅ Lưu &amp; Bật nhắc Bot Telegram</button>
    </div>
  </form>`;

  openModal('📅 Đặt lịch hẹn khách hàng · Bot nhắc tự động', bodyHtml);
  $('[data-close-modal]')?.addEventListener('click', closeModal);

  // Mặc định hẹn ngày mai lúc 09:00
  const tmr = new Date(Date.now() + 24 * 3600000);
  tmr.setHours(9, 0, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  const defaultDt = `${tmr.getFullYear()}-${pad(tmr.getMonth() + 1)}-${pad(tmr.getDate())}T${pad(tmr.getHours())}:${pad(tmr.getMinutes())}`;
  const dtInput = $('#appDateTime');
  if (dtInput) dtInput.value = defaultDt;

  $('#newAppointmentForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = $('#appTypeSelect').value;
    const appointmentTime = $('#appDateTime').value;
    const note = $('#appNote').value.trim();
    if (!appointmentTime) { toast('Vui lòng chọn thời gian hẹn'); return; }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch(`${webhookApiBase()}/api/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serverSyncToken}` },
        body: JSON.stringify({ customerId, appointmentTime, type, note, saleId: customer.saleId || currentAccount.id })
      });
      const data = await res.json();
      if (data.ok) {
        closeModal();
        toast('🎉 Đã đặt lịch hẹn! Bot Telegram sẽ tự động nhắc Sale trước 15-30 phút.');
        renderCustomerAppointments(customerId);
      } else {
        toast('Lỗi: ' + (data.error || 'Không thể lưu lịch hẹn'));
      }
    } catch (err) {
      toast('Lỗi kết nối máy chủ');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

function openAdminBroadcastModal() {
  if (currentAccount.role !== 'ADMIN') { toast('Chỉ Admin được phát thông báo'); return; }

  const templates = {
    meeting_weekly: {
      type: 'MEETING',
      target: 'ALL',
      title: 'Họp tổng kết tuần & Đánh giá hiệu suất KPI',
      host: 'Ban Giám Đốc NVT Agency',
      meeting_link: 'Phòng họp Tầng 2 & Google Meet: meet.google.com/nvt-agency',
      content: '1. Đánh giá doanh số tuần qua.\n2. Tuyên dương cá nhân bứt phá.\n3. Tháo gỡ khó khăn về data nóng và chốt cọc hợp đồng.\n4. Đề ra mục tiêu tuần mới.'
    },
    reward_fast: {
      type: 'REWARD',
      target: 'SALE',
      title: 'Chính sách thưởng nóng: Chốt cọc trong 2h kể từ lúc nhận data',
      host: 'Ban Giám Đốc NVT Agency',
      content: '🔥 Thưởng nóng ngay 500.000 VNĐ tiền mặt cho mỗi hợp đồng cọc thành công trong vòng 2 giờ kể từ khi bấm nhận data!\n⚡ Áp dụng cho toàn bộ Sales chốt cọc trong ngày hôm nay. Anh em tăng tốc bám sát khách hàng!'
    },
    honor_bestseller: {
      type: 'REWARD',
      target: 'ALL',
      title: 'Vinh danh Best Seller tuần - Bứt phá doanh số ấn tượng',
      host: 'Ban Giám Đốc NVT Agency',
      content: '🎉 Xin chúc mừng bạn Nguyễn Văn A (Team Bão Đơn) đã xuất sắc cán mốc doanh thu 150 triệu trong tuần này!\n👏 Toàn Agency cùng gửi lời chúc mừng và lấy đó làm động lực thi đua bứt phá mục tiêu tháng!'
    },
    stale_warning: {
      type: 'WARNING',
      target: 'SALE',
      title: 'Cảnh báo nghiêm khắc: Xử lý data nóng tồn đọng quá hạn',
      host: 'Trưởng Phòng Kinh Doanh',
      content: '⚠️ Hiện tại hệ thống ghi nhận một số data nóng đã nhận quá 12h nhưng chưa có cập nhật ghi chú hoặc lịch hẹn chăm sóc.\n👉 Yêu cầu các bạn Sales khẩn trương gọi điện liên hệ hoặc phân phối lại. Sau 24h hệ thống sẽ tự động thu hồi về kho chung!'
    },
    morning_motivation: {
      type: 'MOTIVATION',
      target: 'ALL',
      title: 'Chào ngày mới - Tốc độ bám khách tạo ra bão đơn',
      host: 'Ban Quản Trị NVT Agency',
      content: '☀️ Chào buổi sáng toàn thể anh em NVT Agency! Hôm nay dự kiến có hơn 50+ data khách hàng nóng đổ về từ các chiến dịch.\n🎯 Mục tiêu hôm nay: 100% data được tiếp cận trong 5 phút đầu tiên. Chúc cả nhà ngày mới bão đơn!'
    },
    emergency_meet: {
      type: 'MEETING',
      target: 'MANAGERS',
      title: 'Họp khẩn cấp Cấp Quản Lý: Điều phối nguồn data & Tối ưu chuyển đổi',
      host: 'Ban Giám Đốc NVT Agency',
      meeting_link: 'Phòng họp VIP Tầng 3',
      content: 'Họp khẩn các Leader/Manager để rà soát tỷ lệ phản hồi data nóng của từng team và điều chỉnh tỷ trọng phân phối tự động.'
    },
    policy_sla: {
      type: 'POLICY',
      target: 'SALE',
      title: 'Quy định chuẩn thời gian tiếp cận khách hàng (SLA 5 phút)',
      host: 'Ban Quản Trị NVT Agency',
      content: 'Quy định mới bắt buộc: Tất cả data khách hàng phân phối về Telegram cá nhân phải được gọi điện lần 1 trong vòng 5-15 phút. Nếu quá hạn không liên hệ, hệ thống sẽ hạ điểm uy tín nhận data của Sale.'
    }
  };

  const bodyHtml = `<form id="adminBroadcastForm">
    <!-- 6 Mẫu thông báo gợi ý sẵn với màu sắc và viền riêng biệt -->
    <div style="margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-weight:700;font-size:12px;color:#334155;text-transform:uppercase">
          💡 Chọn mẫu gợi ý để tự động điền form:
        </span>
        <button type="button" id="btnBcCustom" style="background:none;border:none;color:#7c3aed;font-size:12px;font-weight:600;cursor:pointer">
          ✏️ Tự soạn tự do
        </button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:8px">
        <button type="button" class="bc-tpl-btn" data-tpl="meeting_weekly" style="padding:8px 10px;text-align:left;border-radius:10px;border:2px solid #bfdbfe;background:#eff6ff;cursor:pointer;transition:all 0.2s">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span>📅</span><span style="font-size:10px;background:#dbeafe;color:#1d4ed8;padding:2px 5px;border-radius:4px;font-weight:700">Lịch họp</span>
          </div>
          <div style="font-weight:700;font-size:12px;color:#1e3a8a;margin-top:4px">Họp tổng tuần</div>
          <div style="font-size:10px;color:#3b82f6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Tổng kết & KPI</div>
        </button>

        <button type="button" class="bc-tpl-btn" data-tpl="reward_fast" style="padding:8px 10px;text-align:left;border-radius:10px;border:2px solid #a7f3d0;background:#ecfdf5;cursor:pointer;transition:all 0.2s">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span>⚡</span><span style="font-size:10px;background:#d1fae5;color:#047857;padding:2px 5px;border-radius:4px;font-weight:700">Thưởng nóng</span>
          </div>
          <div style="font-weight:700;font-size:12px;color:#064e3b;margin-top:4px">Thưởng cọc 2h</div>
          <div style="font-size:10px;color:#059669;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">+500k tiền mặt</div>
        </button>

        <button type="button" class="bc-tpl-btn" data-tpl="honor_bestseller" style="padding:8px 10px;text-align:left;border-radius:10px;border:2px solid #fde68a;background:#fffbeb;cursor:pointer;transition:all 0.2s">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span>🏆</span><span style="font-size:10px;background:#fef3c7;color:#b45309;padding:2px 5px;border-radius:4px;font-weight:700">Vinh danh</span>
          </div>
          <div style="font-weight:700;font-size:12px;color:#78350f;margin-top:4px">Best Seller</div>
          <div style="font-size:10px;color:#d97706;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Bão đơn tuần</div>
        </button>

        <button type="button" class="bc-tpl-btn" data-tpl="stale_warning" style="padding:8px 10px;text-align:left;border-radius:10px;border:2px solid #fca5a5;background:#fef2f2;cursor:pointer;transition:all 0.2s">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span>⚠️</span><span style="font-size:10px;background:#dc2626;color:#ffffff;padding:2px 6px;border-radius:4px;font-weight:700">Cảnh báo</span>
          </div>
          <div style="font-weight:800;font-size:12px;color:#7f1d1d;margin-top:4px">Data tồn 12h</div>
          <div style="font-size:10px;color:#b91c1c;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Yêu cầu xử lý ngay</div>
        </button>

        <button type="button" class="bc-tpl-btn" data-tpl="morning_motivation" style="padding:8px 10px;text-align:left;border-radius:10px;border:2px solid #e9d5ff;background:#faf5ff;cursor:pointer;transition:all 0.2s">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span>🚀</span><span style="font-size:10px;background:#f3e8ff;color:#7e22ce;padding:2px 5px;border-radius:4px;font-weight:700">Động viên</span>
          </div>
          <div style="font-weight:700;font-size:12px;color:#581c87;margin-top:4px">Chào ngày mới</div>
          <div style="font-size:10px;color:#9333ea;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Mục tiêu 5p</div>
        </button>

        <button type="button" class="bc-tpl-btn" data-tpl="emergency_meet" style="padding:8px 10px;text-align:left;border-radius:10px;border:2px solid #ef4444;background:#fef2f2;cursor:pointer;transition:all 0.2s">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span>🚨</span><span style="font-size:10px;background:#dc2626;color:#ffffff;padding:2px 6px;border-radius:4px;font-weight:700">Khẩn cấp</span>
          </div>
          <div style="font-weight:800;font-size:12px;color:#7f1d1d;margin-top:4px">Họp khẩn cấp</div>
          <div style="font-size:10px;color:#b91c1c;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Leader & Sale gấp</div>
        </button>
      </div>
    </div>

    <!-- Hộp form cấu hình (Đã loại bỏ dropdown Loại thông báo dư thừa) -->
    <div id="bcFormBox" style="border:2px solid #93c5fd;border-radius:12px;padding:14px;background:#ffffff;margin-bottom:12px;transition:border-color 0.2s">
      <input type="hidden" id="bcTypeSelect" value="MEETING">

      <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;border-bottom:1px solid #f1f5f9;margin-bottom:12px;gap:10px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:11px;color:#64748b;font-weight:600">Đang chọn:</span>
          <span id="bcActiveBadge" style="padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe">
            📅 Họp tổng tuần
          </span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:12px;font-weight:700;color:#334155;white-space:nowrap">Gửi tới:</label>
          <select id="bcTargetSelect" style="padding:5px 10px;border-radius:6px;border:1.5px solid #cbd5e1;font-weight:700;font-size:12px;color:#1e293b;background:#f8fafc">
            <option value="ALL">🌐 Toàn thể Agency (Sale + Leader + Manager)</option>
            <option value="SALE">💼 Chỉ Đội ngũ Sales / Tư vấn</option>
            <option value="MANAGERS">🎖️ Chỉ Cấp Quản Lý (Leader & Manager)</option>
          </select>
        </div>
      </div>

      <div class="form-grid">
        <label class="form-field" style="grid-column:1/-1">Tiêu đề thông báo
          <input id="bcTitle" required placeholder="VD: Họp tổng kết tuần và công bố thưởng KPI mới" maxlength="200">
        </label>
        <div id="bcMeetingFields" style="grid-column:1/-1">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px">
            <label class="form-field" style="margin:0">Thời gian họp
              <input type="datetime-local" id="bcMeetingTime">
            </label>
            <label class="form-field" style="margin:0">Địa điểm / Link họp
              <input id="bcMeetingLink" placeholder="VD: Google Meet / Zoom hoặc Phòng họp tầng 2">
            </label>
            <label class="form-field" style="grid-column:1/-1;margin-top:6px">Chọn giờ nhắc lại 1 lần nữa trước giờ họp:
              <select id="bcRemindMinutes" style="width:100%;padding:6px 8px;border-radius:6px;border:1.5px solid #bfdbfe;font-weight:700;font-size:12px;color:#1e3a8a;background:#ffffff">
                <option value="15" selected>⏰ Nhắc trước 15 phút (Khuyên dùng)</option>
                <option value="30">⏰ Nhắc trước 30 phút</option>
                <option value="45">⏰ Nhắc trước 45 phút</option>
                <option value="60">⏰ Nhắc trước 1 tiếng</option>
                <option value="120">⏰ Nhắc trước 2 tiếng</option>
                <option value="0">❌ Không nhắc lại</option>
              </select>
            </label>
          </div>
        </div>
        <label class="form-field" style="grid-column:1/-1">Người chủ trì / Ban hành
          <input id="bcHost" value="${escapeHtml(currentAccount.name)}" placeholder="VD: Ban Giám Đốc NVT Agency">
        </label>
        <label class="form-field" style="grid-column:1/-1">Nội dung chi tiết
          <textarea id="bcContent" rows="4" required placeholder="Nhập nội dung chi tiết thông báo..."></textarea>
        </label>
      </div>
    </div>

    <div class="credential-hint" style="margin-top:10px">⚡ Thông báo sẽ được <b>Bot Telegram NVT Agency</b> phát tức thì tới từng nhân viên theo nhóm đối tượng đã chọn.</div>
    <div class="modal-actions" style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
      <button type="button" class="button button-secondary" data-close-modal>Hủy</button>
      <button type="submit" class="button button-primary" style="background:#7c3aed;color:#fff">🚀 Bắn thông báo Telegram ngay</button>
    </div>
  </form>`;

  openModal('📢 Phát thông báo Telegram toàn Agency', bodyHtml);
  $('[data-close-modal]')?.addEventListener('click', closeModal);

  const typeInput = $('#bcTypeSelect');
  const targetSelect = $('#bcTargetSelect');
  const titleInput = $('#bcTitle');
  const hostInput = $('#bcHost');
  const contentInput = $('#bcContent');
  const meetingFields = $('#bcMeetingFields');
  const meetingLink = $('#bcMeetingLink');
  const formBox = $('#bcFormBox');
  const activeBadge = $('#bcActiveBadge');

  const tplStyles = {
    meeting_weekly: { border: '#93c5fd', badgeBg: '#dbeafe', badgeColor: '#1e40af', badgeBorder: '#bfdbfe', label: '📅 Họp tổng tuần' },
    reward_fast: { border: '#86efac', badgeBg: '#dcfce7', badgeColor: '#166534', badgeBorder: '#bbf7d0', label: '⚡ Thưởng cọc 2h' },
    honor_bestseller: { border: '#fde047', badgeBg: '#fef9c3', badgeColor: '#854d0e', badgeBorder: '#fef08a', label: '🏆 Best Seller' },
    stale_warning: { border: '#ef4444', badgeBg: '#dc2626', badgeColor: '#ffffff', badgeBorder: '#b91c1c', label: '⚠️ Data tồn 12h' },
    morning_motivation: { border: '#d8b4fe', badgeBg: '#f3e8ff', badgeColor: '#6b21a8', badgeBorder: '#e9d5ff', label: '🚀 Chào ngày mới' },
    emergency_meet: { border: '#ef4444', badgeBg: '#dc2626', badgeColor: '#ffffff', badgeBorder: '#b91c1c', label: '🚨 Họp khẩn cấp' }
  };

  const applyTemplate = (key) => {
    const tpl = templates[key];
    if (!tpl) return;
    if (typeInput) typeInput.value = tpl.type;
    if (targetSelect) targetSelect.value = tpl.target;
    if (titleInput) titleInput.value = tpl.title;
    if (hostInput) hostInput.value = tpl.host || currentAccount.name;
    if (contentInput) contentInput.value = tpl.content;
    if (tpl.meeting_link && meetingLink) meetingLink.value = tpl.meeting_link;

    if (meetingFields) meetingFields.style.display = (tpl.type === 'MEETING') ? 'block' : 'none';

    const st = tplStyles[key];
    if (st && formBox) formBox.style.borderColor = st.border;
    if (st && activeBadge) {
      activeBadge.textContent = st.label;
      activeBadge.style.background = st.badgeBg;
      activeBadge.style.color = st.badgeColor;
      activeBadge.style.borderColor = st.badgeBorder;
    }

    document.querySelectorAll('.bc-tpl-btn').forEach(btn => {
      btn.style.boxShadow = btn.dataset.tpl === key ? '0 0 0 2px #7c3aed' : 'none';
    });
  };

  document.querySelectorAll('.bc-tpl-btn').forEach(btn => {
    btn.addEventListener('click', () => applyTemplate(btn.dataset.tpl));
  });

  $('#btnBcCustom')?.addEventListener('click', () => {
    if (titleInput) titleInput.value = '';
    if (contentInput) contentInput.value = '';
    if (meetingFields) meetingFields.style.display = 'none';
    if (formBox) formBox.style.borderColor = '#cbd5e1';
    if (activeBadge) {
      activeBadge.textContent = '✏️ Tự soạn tự do';
      activeBadge.style.background = '#f1f5f9';
      activeBadge.style.color = '#475569';
      activeBadge.style.borderColor = '#cbd5e1';
    }
    document.querySelectorAll('.bc-tpl-btn').forEach(btn => btn.style.boxShadow = 'none');
    titleInput?.focus();
  });

  // Chọn mẫu đầu tiên mặc định
  applyTemplate('meeting_weekly');

  $('#adminBroadcastForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = typeInput?.value || 'MEETING';
    const target = targetSelect?.value || 'ALL';
    const title = titleInput?.value.trim() || '';
    const content = contentInput?.value.trim() || '';
    const host = hostInput?.value.trim() || '';
    const meeting_time = $('#bcMeetingTime')?.value || null;
    const meeting_link = $('#bcMeetingLink')?.value || null;
    const remind_minutes = Number($('#bcRemindMinutes')?.value ?? 15);
    const effective_date = $('#bcEffectiveDate')?.value || null;

    if (!title || !content) { toast('Vui lòng nhập tiêu đề và nội dung'); return; }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Đang bắn thông báo Telegram...';
    }

    try {
      const res = await fetch(`${webhookApiBase()}/api/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serverSyncToken}` },
        body: JSON.stringify({ type, target, title, content, host, meeting_time, meeting_link, remind_minutes, effective_date })
      });
      const data = await res.json();
      if (data.ok) {
        closeModal();
        toast(`📢 Đã gửi thông báo thành công tới ${data.sent || 0} nhân sự qua Bot Telegram!`);
      } else {
        toast('Lỗi: ' + (data.error || 'Không thể gửi thông báo'));
      }
    } catch (err) {
      toast('Lỗi kết nối máy chủ');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '🚀 Bắn thông báo Telegram ngay';
      }
    }
  });
}

function orderRentalEndsAt(createdAt, months) {
  if (![1, 3, 6, 12].includes(Number(months))) return null;
  const date = new Date(`${String(createdAt).replace(' ', 'T')}+07:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setMonth(date.getMonth() + Number(months));
  return date.toISOString();
}

function orderDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '\u2014' : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

function openOrderDrawer(id) {
  const order = scopedOrders().find(item => item.id === id);
  if (!order) { toast('NOT_FOUND \u00b7 \u0111\u01a1n h\u00e0ng n\u1eb1m ngo\u00e0i ph\u1ea1m vi'); return; }
  const product = productById(order.productId), website = websiteById(order.websiteId), billing = order.billing || {};
  const subtotal = Number.isFinite(Number(order.subtotal)) ? Number(order.subtotal) : Number(order.total || 0), vatAmount = Number(order.vatAmount || 0), amountPaid = orderGrossCollected(order), netCollected = orderNetCollected(order), balanceDue = Number.isFinite(Number(order.balanceDue)) ? Number(order.balanceDue) : Math.max(0, Number(order.total || 0) - amountPaid);
  const attribution = currentAccount.role === 'ADMIN' ? `<dt>Ngu\u1ed3n / Campaign</dt><dd>${escapeHtml(order.source)} \u00b7 ${escapeHtml(order.campaign || 'UNATTRIBUTED')}</dd><dt>Website / Landing</dt><dd>${escapeHtml(website ? `${website.name} \u00b7 ${website.domain}` : 'Ch\u01b0a quy ngu\u1ed3n')}</dd>` : '';
  const payment = `<div class="section-label">Thanh to\u00e1n & h\u00f3a \u0111\u01a1n</div><dl class="detail-grid"><dt>H\u00ecnh th\u1ee9c</dt><dd>${order.paymentMode === 'DEPOSIT' ? `\u0110\u1eb7t c\u1ecdc ${money(order.depositAmount || 0)}` : 'Thanh to\u00e1n \u0111\u1ee7'}</dd><dt>K\u00eanh thanh to\u00e1n</dt><dd>${escapeHtml(order.paymentMethod || 'Ch\u01b0a ch\u1ecdn')}</dd><dt>T\u1ea1m t\u00ednh</dt><dd>${money(subtotal)}</dd><dt>VAT ${Math.round(Number(order.vatRate || 0) * 100)}%</dt><dd>${money(vatAmount)}</dd><dt>T\u1ed5ng thanh to\u00e1n</dt><dd><b>${money(order.total)}</b></dd><dt>\u0110\u00e3 thu / C\u00f2n l\u1ea1i</dt><dd>${money(amountPaid)} / ${money(balanceDue)}</dd>${order.rentalMonths ? `<dt>K\u1ef3 thu\u00ea</dt><dd>${order.rentalMonths} th\u00e1ng \u00b7 h\u1ebft h\u1ea1n ${orderDate(order.rentalEndsAt)}</dd>` : ''}<dt>Ng\u01b0\u1eddi mua</dt><dd>${escapeHtml(billing.name || order.customerName || '')}</dd><dt>CCCD</dt><dd class="mono">${escapeHtml(billing.cccd || '\u2014')}</dd><dt>S\u0110T / Email</dt><dd>${escapeHtml(billing.phone || '\u2014')} \u00b7 ${escapeHtml(billing.email || '\u2014')}</dd><dt>\u0110\u1ecba ch\u1ec9</dt><dd>${escapeHtml(billing.address || '\u2014')}</dd><dt>MST</dt><dd class="mono">${escapeHtml(billing.taxId || 'Kh\u00e1ch c\u00e1 nh\u00e2n')}</dd></dl>`;
  let paymentActions = '';
  if (currentAccount.role === 'ADMIN') {
    if (order.status === 'PENDING' && order.paymentMode === 'DEPOSIT') paymentActions += `<button class="button" data-mark-deposit="${escapeHtml(order.id)}">X\u00e1c nh\u1eadn \u0111\u00e3 nh\u1eadn c\u1ecdc</button>`;
    if (['PENDING', 'DEPOSIT'].includes(order.status)) paymentActions += `<button class="button button-primary" data-mark-paid="${escapeHtml(order.id)}">X\u00e1c nh\u1eadn thanh to\u00e1n \u0111\u1ee7</button>`;
    if (['DEPOSIT', 'PAID', 'COURSE_GRANTED'].includes(order.status) && amountPaid > Number(order.refund || 0)) paymentActions += `<button class="button button-danger" data-refund-order="${escapeHtml(order.id)}">T\u1ea1o phi\u1ebfu ho\u00e0n ti\u1ec1n</button>`;
    if (order.status === 'PAID' && !order.rentalMonths) paymentActions += `<button class="button" data-grant-course="${escapeHtml(order.id)}">Đã cấp khóa học</button>`;
    if (paymentActions) paymentActions = `<div class="modal-actions">${paymentActions}</div>`;
  }
  openDrawer({ head: `<h2>${escapeHtml(order.code)}</h2><p>${escapeHtml(order.createdAt)}${currentAccount.role === 'ADMIN' ? ` \u00b7 ${escapeHtml(order.source)} \u00b7 ${escapeHtml(order.campaign || 'UNATTRIBUTED')}` : ''}</p>`, body: `<div class="section-label">Chi ti\u1ebft \u0111\u01a1n h\u00e0ng</div><dl class="detail-grid"><dt>Kh\u00e1ch h\u00e0ng</dt><dd>${escapeHtml(order.customerName)}</dd>${attribution}<dt>S\u1ea3n ph\u1ea9m</dt><dd>${escapeHtml(order.productName)}</dd><dt>SKU / S\u1ed1 l\u01b0\u1ee3ng</dt><dd>${escapeHtml(product?.sku || order.sku)} \u00b7 ${escapeHtml(order.qty)}</dd><dt>\u0110\u01a1n gi\u00e1</dt><dd>${money(order.unitPrice)}</dd><dt>Chi\u1ebft kh\u1ea5u</dt><dd>${money(order.discount)}</dd><dt>Tr\u1ea1ng th\u00e1i</dt><dd>${statusBadge(order.status, 'order')}</dd><dt>Sale</dt><dd>${escapeHtml(staffName(order.saleId))}</dd></dl>${payment}${paymentActions}<div class="section-label">D\u00f2ng th\u1eddi gian</div><div class="timeline"><div class="timeline-item"><b>\u0110\u01a1n \u0111\u01b0\u1ee3c t\u1ea1o</b><p>${escapeHtml(order.productName)} \u00b7 SL ${escapeHtml(order.qty)}</p><small>${escapeHtml(order.createdAt)}</small></div>${order.depositAt ? `<div class="timeline-item"><b>\u0110\u00e3 nh\u1eadn c\u1ecdc</b><p>${money(order.depositAmount)}</p><small>${escapeHtml(order.depositAt)}</small></div>` : ''}${order.paidAt ? `<div class="timeline-item"><b>Thanh to\u00e1n \u0111\u1ee7</b><p>${money(order.total)}</p><small>${escapeHtml(order.paidAt)}</small></div>` : ''}${order.refundedAt ? `<div class="timeline-item"><b>\u0110\u00e3 ho\u00e0n ti\u1ec1n</b><p>${money(order.refund)}</p><small>${escapeHtml(order.refundedAt)}</small></div>` : ''}</div>` });
  $('[data-mark-deposit]')?.addEventListener('click', () => changeOrderStatus(id, 'DEPOSIT'));
  $('[data-mark-paid]')?.addEventListener('click', () => changeOrderStatus(id, 'PAID'));
  $('[data-refund-order]')?.addEventListener('click', () => refundOrderModal(id));
  $('[data-grant-course]')?.addEventListener('click', () => changeOrderStatus(id, 'COURSE_GRANTED'));
}

function refundOrderModal(id) {
  if (currentAccount?.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được tạo phiếu hoàn tiền'); return; }
  const order = state.orders.find(item => item.id === id);
  if (!order) { toast('Không tìm thấy đơn hàng'); return; }
  const collected = orderGrossCollected(order);
  const alreadyRefunded = Math.max(0, Number(order.refund || 0));
  const remaining = Math.max(0, collected - alreadyRefunded);
  if (!remaining) { toast('Đơn hàng không còn số tiền có thể hoàn'); return; }
  openModal('Tạo phiếu hoàn tiền', `<form id="refundOrderForm"><div class="form-hint"><b>${escapeHtml(order.code)}</b> · ${escapeHtml(order.customerName)} · Thực thu ${money(orderNetCollected(order))}</div><label class="form-field">Số tiền hoàn<input id="refundAmount" type="number" min="1" max="${remaining}" step="1000" required value="${remaining}"></label><label class="form-field">Lý do hoàn tiền<textarea id="refundReason" rows="4" maxlength="500" required placeholder="Nhập lý do hoàn tiền"></textarea></label><div class="form-hint">Có thể hoàn tối đa ${money(remaining)}. Phiếu được lưu cùng lịch sử đơn hàng.</div><div class="modal-actions"><button class="button" type="button" data-close-modal>Hủy</button><button class="button button-danger" type="submit">Lưu phiếu hoàn tiền</button></div></form>`);
  $('[data-close-modal]')?.addEventListener('click', closeModal);
  $('#refundOrderForm').onsubmit = async event => {
    event.preventDefault();
    const amount = Math.round(Number($('#refundAmount').value));
    const reason = $('#refundReason').value.trim();
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) { toast(`Số tiền hoàn phải từ 1 đến ${money(remaining)}`); return; }
    if (reason.length < 3) { toast('Vui lòng nhập lý do hoàn tiền'); return; }
    const now = stamp();
    const voucher = { id: `RF-${Date.now()}-${order.id}`, amount, reason, createdAt: now, createdBy: currentAccount.id, createdByName: currentAccount.name };
    order.refundVouchers = [...(Array.isArray(order.refundVouchers) ? order.refundVouchers : []), voucher];
    order.refund = alreadyRefunded + amount;
    order.refundReason = reason;
    order.refundedAt = now;
    order.refundReconciled = false;
    if (order.refund >= collected) {
      order.status = 'REFUNDED';
      order.amountPaid = 0;
      order.balanceDue = 0;
    }
    audit('ORDER_REFUNDED', order.id, `${order.code} · ${money(amount)} · ${reason}`);
    if (!await persistOrder(order)) { toast('Không thể lưu phiếu hoàn tiền lên MySQL'); return; }
    saveState(); closeModal(); closeDrawer(); render(); toast(`Đã lưu phiếu hoàn tiền ${money(amount)}`);
  };
}

async function changeOrderStatus(id, status) {
  const order = state.orders.find(item => item.id === id); if (!order) return; const edit = orderEditState(order); if (!edit.allowed) { toast('\u0110\u01a1n \u0111\u00e3 kh\u00f3a ch\u1ec9nh s\u1eeda sau 3 ng\u00e0y'); return; } if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN \u00b7 ch\u1ec9 Admin \u0111\u01b0\u1ee3c x\u00e1c nh\u1eadn thanh to\u00e1n'); return; }
  const validTransition = (status === 'DEPOSIT' && order.status === 'PENDING' && order.paymentMode === 'DEPOSIT') || (status === 'PAID' && ['PENDING', 'DEPOSIT'].includes(order.status)) || (status === 'REFUNDED' && ['DEPOSIT', 'PAID'].includes(order.status)) || (status === 'COURSE_GRANTED' && order.status === 'PAID' && !order.rentalMonths);
  if (!validTransition) { toast('Tr\u1ea1ng th\u00e1i \u0111\u01a1n h\u00e0ng kh\u00f4ng th\u1ec3 chuy\u1ec3n theo thao t\u00e1c n\u00e0y'); return; }
  order.status = status;
  if (status === 'DEPOSIT') { order.depositAt = stamp(); order.amountPaid = Number(order.depositAmount); order.balanceDue = Math.max(0, Number(order.total) - order.amountPaid); order.paymentReconciled = false; }
  if (status === 'PAID') { order.paidAt = stamp(); order.amountPaid = Number(order.total); order.balanceDue = 0; if (order.rentalMonths) order.rentalEndsAt = orderRentalEndsAt(order.paidAt, order.rentalMonths); order.refundedAt = null; order.refund = 0; order.paymentReconciled = false; order.refundReconciled = null; }
  if (status === 'REFUNDED') { order.refundedAt = stamp(); order.refund = Number(order.amountPaid || order.total); order.amountPaid = 0; order.balanceDue = 0; order.refundReconciled = false; }
  if (status === 'PAID') { const customer = customerById(order.customerId); if (customer) { customer.status = 'PAID'; customer.updatedAt = stamp(); customer.note = `\u0110\u00e3 thanh to\u00e1n \u0111\u01a1n ${order.code}`; state.notes.unshift({ id: makeRecordId('NOTE'), customerId: customer.id, authorId: currentAccount.id, author: currentAccount.name, role: currentAccount.role, text: customer.note, at: stamp() }); } }
  audit(status === 'DEPOSIT' ? 'DEPOSIT_CONFIRMED' : status === 'PAID' ? 'PAYMENT_CONFIRMED' : 'ORDER_REFUNDED', order.id, `${order.code} \u00b7 ${money(status === 'DEPOSIT' ? order.depositAmount : status === 'REFUNDED' ? order.refund : order.total)}`);
  if (!await persistOrder(order)) { toast('Kh\u00f4ng th\u1ec3 c\u1eadp nh\u1eadt \u0111\u01a1n h\u00e0ng l\u00ean MySQL'); return; }
  saveState(); closeDrawer(); render(); toast(status === 'DEPOSIT' ? '\u0110\u00e3 ghi nh\u1eadn ti\u1ec1n c\u1ecdc' : status === 'PAID' ? '\u0110\u00e3 ghi nh\u1eadn thanh to\u00e1n' : '\u0110\u00e3 ghi nh\u1eadn ho\u00e0n ti\u1ec1n');
}

function normalizeCustomerPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length >= 11) digits = `0${digits.slice(2)}`;
  return digits;
}

function findDuplicateCustomer(record) {
  const phone = normalizeCustomerPhone(record?.phone || record?.mobile);
  if (phone) {
    const byPhone = state.customers.find(customer => normalizeCustomerPhone(customer.phone) === phone);
    if (byPhone) return byPhone;
  }
  const email = cleanText(record?.email, '', 254).trim().toLowerCase();
  return email ? state.customers.find(customer => customer.email && customer.email.trim().toLowerCase() === email) || null : null;
}

function customerHasRegisteredAccount(customer) {
  const registeredLevels = new Set(['L5', 'L6', 'L7', 'L8', 'L9', 'L10']);
  return registeredLevels.has(customer?.customFields?.customerLevel) || normalize(customer?.customFields?.result).includes(normalize('Đã mở tài khoản'));
}

function assignmentSnapshot(customer) {
  return {
    saleId: customer.saleId || null,
    saleName: state.members.find(member => member.id === customer.saleId)?.name || '',
    leaderId: customer.leaderId || null,
    leaderName: state.members.find(member => member.id === customer.leaderId)?.name || '',
    teamId: customer.teamId || null
  };
}

function recordAssignmentChange(customer, previous, reason, source = 'MANUAL', force = false) {
  const next = assignmentSnapshot(customer);
  // force = true cho đường offer: leader/team/saleId không đổi nhưng vẫn phải để lại vết
  // "đã mời sale nào nhận data" trong lịch sử phân data.
  if (!force && previous.saleId === next.saleId && previous.leaderId === next.leaderId && previous.teamId === next.teamId) return false;
  state.assignmentHistory.unshift({
    id: `ASN-${Date.now()}-${state.assignmentHistory.length}`,
    customerId: customer.id,
    fromSaleId: previous.saleId,
    fromSaleName: previous.saleName,
    toSaleId: next.saleId,
    toSaleName: next.saleName,
    fromLeaderId: previous.leaderId,
    fromLeaderName: previous.leaderName,
    toLeaderId: next.leaderId,
    toLeaderName: next.leaderName,
    teamId: next.teamId,
    actorId: currentAccount?.id || 'SYSTEM',
    actor: currentAccount?.name || 'Hệ thống',
    role: currentAccount?.role || 'SYSTEM',
    at: stamp(),
    reason,
    source
  });
  return true;
}

function previousSaleForCustomer(customerId) {
  const activeIds = new Set(activeStaff().filter(member => member.role === 'SALE').map(member => member.id));
  const event = state.assignmentHistory.filter(item => item.customerId === customerId && item.toSaleId && activeIds.has(item.toSaleId)).sort((a, b) => b.at.localeCompare(a.at))[0];
  return event ? activeStaff().find(member => member.id === event.toSaleId) || null : null;
}

function handleDuplicateSubmission(existing, incoming, context = {}) {
  const previousOwner = existing.saleId;
  const currentSale = activeStaff().find(member => member.role === 'SALE' && member.id === existing.saleId);
  const oldSale = currentSale || previousSaleForCustomer(existing.id);
  const source = dataTerminology(cleanText(incoming.source, context.sourceLabel || 'Form gửi lại', 120));
  const campaign = dataTerminology(cleanText(incoming.campaign, '', 160));
  const websiteId = websiteById(incoming.websiteId)?.id || null;
  const registeredAccount = customerHasRegisteredAccount(existing);
  if (oldSale && existing.saleId !== oldSale.id) {
    // Trả khách về đúng sale đã phụ trách trước đó — gán thẳng, không bắt sale nhận lại.
    applyCustomerAssignment(existing, oldSale, 'Khách điền lại form · trả về Sale đã phụ trách trước đó', context.intakeType || 'FORM', true);
  } else {
    existing.updatedAt = stamp();
    existing.note = oldSale ? `DATA TRÙNG · giữ Sale cũ ${oldSale.name}` : 'DATA TRÙNG · chưa có Sale cũ còn hoạt động';
    state.notes.unshift({ id: `NOTE-DUP-${Date.now()}-${existing.id}`, customerId: existing.id, authorId: currentAccount?.id || 'SYSTEM', author: currentAccount?.name || 'Hệ thống nhận data', role: currentAccount?.role || 'SYSTEM', text: existing.note, at: stamp() });
  }
  const event = {
    id: `RESUB-${Date.now()}-${state.resubmissions.length}`,
    customerId: existing.id,
    phone: normalizeCustomerPhone(incoming.phone),
    source,
    campaign,
    websiteId,
    previousSaleId: previousOwner || null,
    assignedSaleId: existing.saleId || null,
    registeredAccount,
    at: stamp(),
    intakeType: ['MANUAL', 'FORM', 'IMPORT', 'API'].includes(context.intakeType) ? context.intakeType : 'FORM'
  };
  existing.lastIntakeAt = event.at;
  existing.lastIntakeType = 'RESUBMISSION';
  state.resubmissions.unshift(event);
  if (oldSale) state.notifications.unshift({ id: `NT-DUP-${Date.now()}-${existing.id}`, role: 'OWN', saleId: oldSale.id, title: registeredAccount ? 'DATA TRÙNG - DATA đã đăng ký TK' : 'Khách cũ điền lại form', text: `${existing.name} · ${existing.phone} · tiếp tục do bạn phụ trách`, at: new Date().toISOString(), readBy: [] });
  audit('DUPLICATE_SUBMISSION', existing.id, `${registeredAccount ? 'DATA đã đăng ký TK' : 'Khách điền lại'} · ${oldSale ? `giữ ${oldSale.name}` : 'chưa có Sale cũ'}`);
  const ownerCopy = oldSale ? ` · giữ Sale ${oldSale.name}` : ' · chưa có Sale cũ còn hoạt động';
  return { duplicate: true, customer: existing, message: `${registeredAccount ? 'DATA TRÙNG - DATA đã đăng ký TK' : 'DATA TRÙNG'}${ownerCopy}` };
}

function ingestCustomer(record, context = {}) {
  if (!record || typeof record !== 'object') return { created: false, error: 'Dữ liệu khách hàng không hợp lệ' };
  const phone = normalizeCustomerPhone(record.phone || record.mobile);
  const duplicate = findDuplicateCustomer({ ...record, phone });
  if (duplicate) return handleDuplicateSubmission(duplicate, { ...record, phone }, context);
  const name = cleanText(record.name || record.fullName || record.customer, '', 160).trim();
  const website = websiteById(cleanId(record.websiteId));
  if (!name || phone.length < 9 || phone.length > 11) return { created: false, error: 'Tên hoặc số điện thoại không hợp lệ' };
  const sourceLabel = dataTerminology(cleanText(record.source, context.sourceLabel || 'Nhập thủ công', 120));
  const isDefaultManualSource = context.intakeType === 'MANUAL' && ['Khách hàng cũ', 'Khách hàng ngoài data'].includes(sourceLabel);
  if (!website && !isDefaultManualSource) return { created: false, error: 'Landing page nguồn không hợp lệ' };
  const customFields = Object.fromEntries(state.customFieldDefinitions.map(field => [field.id, sanitizeCustomFieldValue(record.customFields?.[field.id] ?? defaultCustomFieldValue(field), field)]));
  const createdAt = stamp();
  const customer = {
    id: cleanId(record.id) && !state.customers.some(item => item.id === record.id) ? record.id : makeRecordId('CUS'),
    name,
    phone,
    email: cleanText(record.email, '', 254).trim(),
    ipAddress: cleanText(record.ipAddress || record.ip, 'Chưa xác định', 64),
    source: sourceLabel,
    campaign: dataTerminology(cleanText(record.campaign, 'MANUAL-CRM', 160)),
    landingPageName: cleanText(record.landingPageName || record.landingPage || website?.name || website?.domain || sourceLabel, website?.name || website?.domain || sourceLabel, 200),
    landingPageUrl: cleanSourceUrl(record.landingPageUrl || website?.sourceUrl),
    landingPageDomain: cleanText(record.landingPageDomain || website?.domain || '', website?.domain || '', 253),
    productName: cleanText(record.productName || record.product || record.sanpham, 'Chưa xác định sản phẩm', 200),
    websiteId: website?.id || null,
    manualEntry: context.intakeType === 'MANUAL',
    status: Object.hasOwn(STATUS_META, record.status) ? record.status : 'NEW',
    saleId: null,
    leaderId: null,
    teamId: null,
    createdAt,
    updatedAt: createdAt,
    lastIntakeAt: createdAt,
    lastIntakeType: ['MANUAL', 'FORM', 'IMPORT', 'API'].includes(context.intakeType) ? context.intakeType : 'FORM',
    note: dataTerminology(cleanText(record.note, `Tạo thủ công từ ${sourceLabel}`, 2000)),
    customFields
  };
  state.customers.unshift(customer);
  state.notes.unshift({ id: makeRecordId('NOTE'), customerId: customer.id, authorId: currentAccount?.id || 'SYSTEM', author: currentAccount?.name || 'Hệ thống nhận data', role: currentAccount?.role || 'SYSTEM', text: customer.note, at: stamp() });
  state.customFieldDefinitions.forEach(field => {
    const value = customer.customFields[field.id];
    const empty = value === '' || value === false || (Array.isArray(value) && !value.length);
    if (!empty || field.id === 'customerLevel') recordFieldChange(customer, field, '', value, context.intakeType === 'API' ? 'API' : context.intakeType === 'FORM' ? 'FORM' : context.intakeType === 'IMPORT' ? 'IMPORT' : 'MANUAL');
  });
  if (currentAccount?.role === 'SALE') applyCustomerAssignment(customer, activeStaff().find(member => member.id === currentAccount.saleId), 'Sale tạo khách trực tiếp', 'MANUAL');
  else if (currentAccount?.role === 'LEADER') applyCustomerAssignment(customer, activeStaff().find(member => member.id === currentAccount.leaderId), 'Leader tạo khách trong Team', 'MANUAL');
  else if (context.intakeType !== 'MANUAL') autoAssignCustomer(customer);
  createInitialTask(customer);
  audit('CREATE_CUSTOMER', customer.id, `Tạo khách ${name} · ${website?.domain || sourceLabel}`);
  return { created: true, duplicate: false, customer, message: 'Đã tạo khách hàng mới' };
}

function newCustomerModal() {
  const availableWebsites = state.websites;
  if (!availableWebsites.length) { toast('Hãy tạo website/landing page nguồn trước khi thêm khách'); return; }
  openModal('Thêm khách hàng', `<form id="newCustomerForm"><div class="form-grid"><label class="form-field">Họ tên<input id="newCustomerName" required></label><label class="form-field">Số điện thoại<input id="newCustomerPhone" type="tel" required></label><label class="form-field">Email<input id="newCustomerEmail" type="email"></label><label class="form-field">Landing page nguồn<select id="newCustomerWebsite">${availableWebsites.map(website => `<option value="${escapeHtml(website.id)}">${escapeHtml(website.name)} · ${escapeHtml(website.domain)}</option>`).join('')}</select></label><label class="form-field">Kênh data<select id="newCustomerSource">${TRAFFIC_META.map(source => `<option>${escapeHtml(source.source)}</option>`).join('')}</select></label><label class="form-field full">Nhu cầu / ghi chú<textarea id="newCustomerNote" rows="3"></textarea></label></div><div class="credential-hint">Đây là nhập thủ công; trạng thái bật/tắt API của landing page không ảnh hưởng thao tác này.</div><div class="modal-actions"><button class="button" type="button" data-close-modal>Huỷ</button><button class="button button-primary" type="submit">Tạo khách hàng</button></div></form>`);
  $('[data-close-modal]')?.addEventListener('click', closeModal);
  $('#newCustomerForm').onsubmit = async event => {
    event.preventDefault();
    // Sale tự tạo khách là luồng ĐƯỢC ghi IP (khác landing page: không lấy IP).
    await refreshSessionContext();
    const result = ingestCustomer({ name: $('#newCustomerName').value.trim(), phone: $('#newCustomerPhone').value, email: $('#newCustomerEmail').value.trim(), ipAddress: sessionContextIp, source: $('#newCustomerSource').value, campaign: 'MANUAL-CRM', websiteId: $('#newCustomerWebsite').value, note: $('#newCustomerNote').value.trim() }, { intakeType: 'MANUAL', sourceLabel: 'Nhập thủ công' });
    if (!result.created && !result.duplicate) { toast(result.error); return; }
    if (result.created) {
      const saved = await persistCustomer(result.customer);
      if (!saved) { toast('Không thể lưu khách hàng lên MySQL'); return; }
      await syncServerState();
    }
    saveState(); closeModal(); render(); toast(result.message);
  };
}

function addImportedCustomers(records, sourceLabel) {
  if (currentAccount.role !== 'ADMIN' || !Array.isArray(records)) return 0;
  let imported = 0;
  let duplicates = 0;
  let registeredDuplicates = 0;
  records.slice(0, 250).forEach((record, index) => {
    const requestedWebsite = record.websiteId
      ? websiteById(cleanId(record.websiteId))
      : state.websites.find(website => normalize(website.domain) === normalize(record.websiteDomain || record.landingPage || ''));
    const website = requestedWebsite;
    if (!website) return;
    const result = ingestCustomer({ ...record, id: `CUS-IMP-${Date.now()}-${index}`, websiteId: website.id, source: cleanText(record.source, sourceLabel, 120), campaign: cleanText(record.campaign, 'IMPORTED-DATA', 160), note: `Nhập từ ${sourceLabel} · ${website.domain}` }, { intakeType: 'IMPORT', sourceLabel });
    if (result.created) imported += 1;
    if (result.duplicate) { duplicates += 1; if (result.customer && customerHasRegisteredAccount(result.customer)) registeredDuplicates += 1; }
  });
  lastImportStats = { created: imported, duplicates, registeredDuplicates };
  return imported;
}

function recordCustomerImport(source, filename, records, status = 'SUCCESS') {
  state.imports.unshift({ id: `IMP-${Date.now()}-${state.imports.length}`, source, filename, records, importedAt: stamp(), actor: currentAccount.name, status });

  audit('IMPORT_CUSTOMERS', 'CUSTOMERS', `${source} · ${filename} · ${records} khách`);
}

function customerImportModal() {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được nhập data'); return; }
  const websites = state.websites.filter(website => website.status === 'ACTIVE');
  if (!websites.length) { toast('Hãy tạo hoặc bật ít nhất một website trước khi nhập data'); return; }
  const websiteOptions = websites.map(website => `<option value="${escapeHtml(website.id)}">${escapeHtml(website.name)} · ${escapeHtml(website.domain)}</option>`).join('');
  openModal('Nhập data từ file', `<div class="import-grid"><section class="import-card"><span class="eyebrow">FILE IMPORT</span><h3>Tải CSV hoặc JSON</h3><p>File bắt buộc có họ tên và số điện thoại.</p><form id="customerFileImportForm"><label class="form-field">Nguồn website<select id="customerImportWebsite">${websiteOptions}</select></label><label class="file-drop">Chọn file dữ liệu<input id="customerImportFile" type="file" accept=".csv,.json,text/csv,application/json" required><span>Định dạng cột: name, phone</span></label><button class="button button-primary button-block" type="submit">Nhập data</button></form></section></div>`);
  $('#customerFileImportForm').onsubmit = event => {
    event.preventDefault();
    const file = $('#customerImportFile')?.files?.[0];
    const websiteId = $('#customerImportWebsite')?.value;
    if (!file || !websiteId) { toast('Hãy chọn nguồn website và file dữ liệu'); return; }
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'json'].includes(extension)) { toast('Chỉ hỗ trợ file CSV hoặc JSON'); return; }
    const finish = records => {
      const validRecords = records.filter(record => {
        const name = record.name || record.fullname || record.hoten || record.tenkhachhang;
        const phone = record.phone || record.mobile || record.sodienthoai || record.sdt;
        return String(name || '').trim() && String(phone || '').replace(/\D/g, '').length >= 8;
      }).map(record => ({ ...record, websiteId: record.websiteId || websiteId }));
      const invalid = records.length - validRecords.length;
      if (!validRecords.length) { toast('File phải có ít nhất một bản ghi gồm họ tên và số điện thoại hợp lệ'); return; }
      const imported = addImportedCustomers(validRecords, `File ${extension.toUpperCase()}`);
      recordCustomerImport(extension.toUpperCase(), file.name, imported);
      saveState(); closeModal(); currentView = 'distribution'; distributionTab = 'QUEUE'; render();
      toast(`Đã thêm ${imported} khách${invalid ? ` · bỏ qua ${invalid} dòng thiếu họ tên hoặc SĐT` : ''}${lastImportStats.duplicates ? ` · ${lastImportStats.duplicates} data trùng` : ''}`);
    };
    const reader = new FileReader();
    reader.onerror = () => toast('Không thể đọc file đã chọn');
    reader.onload = () => {
      try {
        if (extension === 'json') { const data = JSON.parse(String(reader.result)); finish(Array.isArray(data) ? data : data.customers || []); return; }
        const lines = String(reader.result).split(/\r?\n/).filter(Boolean);
        const headers = lines.shift().split(',').map(value => normalize(value));
        finish(lines.map(line => {
          const values = line.split(',').map(value => value.trim().replace(/^"|"$/g, ''));
          const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
          return { name: row.name || row.fullname || row.hoten || row.tenkhachhang, phone: row.phone || row.mobile || row.sodienthoai || row.sdt, email: row.email, source: row.source || row.nguon, campaign: row.campaign || row.chiendich, websiteId: row.websiteid };
        }));
      } catch (error) { toast('File không đúng cấu trúc dữ liệu'); }
    };
    reader.readAsText(file, 'utf-8');
  };
}

function editOrderModal(id) {
  const order = state.orders.find(item => item.id === id); const access = order && orderEditState(order);
  if (!order || !access?.allowed || !canViewCustomer(customerById(order.customerId))) { toast('\u0110\u01a1n h\u00e0ng \u0111\u00e3 kh\u00f3a ho\u1eb7c n\u1eb1m ngo\u00e0i ph\u1ea1m vi'); return; }
  const availableProducts = state.products.filter(product => product.active !== false || product.id === order.productId);
  openModal('S\u1eeda \u0111\u01a1n h\u00e0ng', `<form id="editOrderForm"><label class="form-field">S\u1ea3n ph\u1ea9m<select id="editOrderProduct">${availableProducts.map(product => `<option value="${escapeHtml(product.id)}" ${product.id === order.productId ? 'selected' : ''}>${escapeHtml(product.name)} \u00b7 ${money(product.price)}</option>`).join('')}</select></label><label class="form-field">VAT (%)<select id="editOrderVatRate"><option value="0.08" ${Number(order.vatRate)===0.08?'selected':''}>8%</option><option value="0.10" ${Number(order.vatRate||0.1)===0.10?'selected':''}>10%</option><option value="0.12" ${Number(order.vatRate)===0.12?'selected':''}>12%</option><option value="0.15" ${Number(order.vatRate)===0.15?'selected':''}>15%</option></select></label><label class="form-field" style="margin-top:12px">S\u1ed1 l\u01b0\u1ee3ng<input id="editOrderQty" type="number" min="1" max="10" value="${order.qty}"></label><div class="modal-actions"><button class="button" type="button" data-close-modal>H\u1ee7y</button><button class="button button-primary" type="submit">L\u01b0u thay \u0111\u1ed5i</button></div></form>`);
  $('[data-close-modal]')?.addEventListener('click', closeModal);
  $('#editOrderForm').onsubmit = async event => { event.preventDefault(); const product = productById($('#editOrderProduct').value), qty = Number($('#editOrderQty').value); if (!product || !Number.isInteger(qty) || qty < 1 || qty > 10) { toast('S\u1ea3n ph\u1ea9m ho\u1eb7c s\u1ed1 l\u01b0\u1ee3ng kh\u00f4ng h\u1ee3p l\u1ec7'); return; } const previous = { productId: order.productId, qty: order.qty, total: order.total }; order.productId = product.id; order.productName = product.name; order.sku = product.sku; order.qty = qty; order.unitPrice = Number(product.price); order.subtotal = order.unitPrice * qty; order.vatRate = Math.min(1, Math.max(0, Number($('#editOrderVatRate')?.value ?? order.vatRate ?? product.vatRate ?? 0.1))); order.vatAmount = Math.round(order.subtotal * order.vatRate); order.total = Math.max(0, order.subtotal - Number(order.discount || 0) + order.vatAmount); order.depositAmount = order.paymentMode === 'DEPOSIT' ? Math.min(Number(order.depositAmount || 0), Math.max(0, order.total - 1)) : 0; order.balanceDue = Math.max(0, order.total - Number(order.amountPaid || 0)); order.rentalMonths = product.type === 'RENTAL' ? Number(product.rentalMonths) || null : null; order.rentalEndsAt = orderRentalEndsAt(order.createdAt, order.rentalMonths); audit('EDIT_ORDER', order.id, `${previous.productId} \u00b7 ${previous.qty} \u2192 ${product.id} \u00b7 ${qty}`); if (!await persistOrder(order)) { toast('Kh\u00f4ng th\u1ec3 l\u01b0u \u0111\u01a1n h\u00e0ng l\u00ean MySQL'); return; } saveState(); closeModal(); render(); };
}

async function deleteCustomer(id) {
  if (currentAccount?.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được xóa data'); return; }
  const customer = state.customers.find(item => item.id === id);
  if (!customer) { toast('Data không còn tồn tại trên máy chủ'); await syncServerState(); return; }
  if (!window.confirm(`Xóa data của ${customer.name}? Dữ liệu sẽ được lưu lịch sử và không hiển thị lại.`)) return;
  if (!await pushServerRecord('customers', 'DELETE', id, customer)) {
    toast('Không thể xóa data trên MySQL');
    return;
  }
  state.customers = state.customers.filter(item => item.id !== id);
  state.dataOffers = state.dataOffers.filter(item => item.customerId !== id);
  state.tasks = state.tasks.filter(item => item.customerId !== id);
  state.resubmissions = state.resubmissions.filter(item => item.customerId !== id);
  audit('DELETE_CUSTOMER', id, customer.name);
  saveState();
  render();
  toast('Đã xóa data và đồng bộ MySQL');
}

async function deleteOrder(id) {
  const order = state.orders.find(item => item.id === id);
  if (!order || !canViewCustomer(customerById(order.customerId))) { toast('\u0110\u01a1n h\u00e0ng kh\u00f4ng c\u00f2n t\u1ed3n t\u1ea1i ho\u1eb7c n\u1eb1m ngo\u00e0i ph\u1ea1m vi'); return; }
  const access = orderEditState(order);
  if (!access.allowed) { toast('\u0110\u01a1n h\u00e0ng ch\u1ec9 \u0111\u01b0\u1ee3c x\u00f3a trong 3 ng\u00e0y \u0111\u1ea7u'); return; }
  if (!window.confirm(`X\u00f3a ${order.code}? \u0110\u01a1n s\u1ebd kh\u00f4ng c\u00f2n \u0111\u01b0\u1ee3c t\u00ednh trong th\u1ed1ng k\u00ea v\u00e0 doanh thu.`)) return;
  if (!await pushServerRecord('orders', 'DELETE', id, order)) { toast('Kh\u00f4ng th\u1ec3 x\u00f3a \u0111\u01a1n h\u00e0ng tr\u00ean MySQL'); return; }
  audit('DELETE_ORDER', id, order.code); saveState(); render(); toast('\u0110\u00e3 x\u00f3a \u0111\u01a1n h\u00e0ng v\u00e0 c\u1eadp nh\u1eadt th\u1ed1ng k\u00ea');
}

function newOrderModal(customerId = '') {
  const customers = scopedCustomers().filter(customer => customer.saleId);
  const availableProducts = state.products.filter(product => product.active !== false);
  if (!customers.length) { toast('Ch\u01b0a c\u00f3 kh\u00e1ch \u0111\u01b0\u1ee3c ph\u00e2n Sale \u0111\u1ec3 t\u1ea1o \u0111\u01a1n h\u00e0ng'); return; }
  if (!availableProducts.length) { toast('Ch\u01b0a c\u00f3 s\u1ea3n ph\u1ea9m \u0111ang b\u00e1n. Admin h\u00e3y ki\u1ec3m tra seed MySQL.'); return; }
  const selectedCustomer = customerById(customerId) || customers[0];
  openModal('T\u1ea1o \u0111\u01a1n thanh to\u00e1n', `<form id="newOrderForm"><div class="form-grid"><label class="form-field">Kh\u00e1ch h\u00e0ng<select id="newOrderCustomer">${customers.map(customer => `<option value="${escapeHtml(customer.id)}" ${customer.id === selectedCustomer?.id ? 'selected' : ''}>${escapeHtml(customer.name)} \u00b7 ${escapeHtml(customer.phone)}</option>`).join('')}</select></label><label class="form-field">S\u1ea3n ph\u1ea9m<select id="newOrderProduct">${availableProducts.map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} \u00b7 ${money(product.price)}</option>`).join('')}</select></label><label class="form-field">VAT (%)<select id="newOrderVatRate"><option value="0.08">8%</option><option value="0.10" selected>10%</option><option value="0.12">12%</option><option value="0.15">15%</option></select></label><label class="form-field">S\u1ed1 l\u01b0\u1ee3ng<input id="newOrderQty" type="number" min="1" max="10" value="1"></label><label class="form-field">K\u00eanh thanh to\u00e1n<select id="newOrderPaymentMethod"><option value="VietQR">VietQR</option><option value="BANK_TRANSFER">Chuy\u1ec3n kho\u1ea3n</option><option value="CASH">Ti\u1ec1n m\u1eb7t</option></select></label><label class="form-field">H\u00ecnh th\u1ee9c<select id="newOrderPaymentMode"><option value="FULL">Thanh to\u00e1n \u0111\u1ee7</option><option value="DEPOSIT">\u0110\u1eb7t c\u1ecdc</option></select></label><label class="form-field" id="newOrderDepositWrap" style="display:none">Ti\u1ec1n c\u1ecdc d\u1ef1 ki\u1ebfn<input id="newOrderDeposit" type="number" min="0" step="10000" value="0"></label></div><div class="section-label">Th\u00f4ng tin xu\u1ea5t h\u00f3a \u0111\u01a1n</div><div class="form-grid"><label class="form-field">H\u1ecd t\u00ean *<input id="newOrderBillingName" maxlength="160" required value="${escapeHtml(selectedCustomer?.name || '')}"></label><label class="form-field">CCCD<input id="newOrderBillingCccd" inputmode="numeric" maxlength="12"></label><label class="form-field">S\u0110T *<input id="newOrderBillingPhone" inputmode="numeric" maxlength="15" required value="${escapeHtml(selectedCustomer?.phone || '')}"></label><label class="form-field">Email<input id="newOrderBillingEmail" type="email" maxlength="254" value="${escapeHtml(selectedCustomer?.email || '')}"></label><label class="form-field">\u0110\u1ecba ch\u1ec9<input id="newOrderBillingAddress" maxlength="240"></label><label class="form-field">MST doanh nghi\u1ec7p<input id="newOrderBillingTaxId" inputmode="numeric" maxlength="13"></label></div><div class="form-hint" id="newOrderSummary"></div><div class="modal-actions"><button class="button" type="button" data-close-modal>Hu\u1ef7</button><button class="button button-primary" type="submit">T\u1ea1o \u0111\u01a1n ch\u1edd thanh to\u00e1n</button></div></form>`);
  $('[data-close-modal]')?.addEventListener('click', closeModal);
  const readAmounts = () => { const product = productById($('#newOrderProduct').value); const qty = Math.floor(Number($('#newOrderQty').value) || 0); const subtotal = Number(product?.price || 0) * qty; const vatRate = Math.min(1, Math.max(0, Number($('#newOrderVatRate')?.value || product?.vatRate || 0.1))); const vatAmount = Math.round(subtotal * vatRate); const total = subtotal + vatAmount; const paymentMode = $('#newOrderPaymentMode').value === 'DEPOSIT' ? 'DEPOSIT' : 'FULL'; const depositAmount = paymentMode === 'DEPOSIT' ? Math.floor(Number($('#newOrderDeposit').value) || 0) : 0; return { product, qty, subtotal, vatRate, vatAmount, total, paymentMode, depositAmount }; };
  const refreshSummary = () => { const amounts = readAmounts(); $('#newOrderDepositWrap').style.display = amounts.paymentMode === 'DEPOSIT' ? '' : 'none'; $('#newOrderSummary').innerHTML = `T\u1ea1m t\u00ednh ${money(amounts.subtotal)} \u00b7 VAT ${Math.round(amounts.vatRate*100)}% ${money(amounts.vatAmount)} \u00b7 <b>T\u1ed5ng ${money(amounts.total)}</b>${amounts.paymentMode === 'DEPOSIT' ? ` \u00b7 c\u1ecdc d\u1ef1 ki\u1ebfn ${money(amounts.depositAmount)}` : ''}. \u0110\u01a1n ch\u1ec9 ghi nh\u1eadn doanh thu sau khi Admin x\u00e1c nh\u1eadn.`; };
  const fillCustomer = () => { const customer = customerById($('#newOrderCustomer').value); if (!customer) return; $('#newOrderBillingName').value = customer.name || ''; $('#newOrderBillingPhone').value = customer.phone || ''; $('#newOrderBillingEmail').value = customer.email || ''; };
  ['newOrderProduct', 'newOrderVatRate', 'newOrderQty', 'newOrderPaymentMode', 'newOrderDeposit'].forEach(id => { $(`#${id}`).addEventListener('input', refreshSummary); $(`#${id}`).addEventListener('change', refreshSummary); });
  $('#newOrderCustomer').addEventListener('change', fillCustomer); refreshSummary();
  $('#newOrderForm').onsubmit = async event => {
    event.preventDefault(); const customer = customerById($('#newOrderCustomer').value), amounts = readAmounts();
    const billing = { name: $('#newOrderBillingName').value.trim(), cccd: $('#newOrderBillingCccd').value.replace(/\D/g, ''), phone: $('#newOrderBillingPhone').value.replace(/\D/g, ''), email: $('#newOrderBillingEmail').value.trim(), address: $('#newOrderBillingAddress').value.trim(), taxId: $('#newOrderBillingTaxId').value.replace(/\D/g, '') };
    if (!customer || !canViewCustomer(customer) || !customer.saleId || !amounts.product || !Number.isInteger(amounts.qty) || amounts.qty < 1 || amounts.qty > 10) { toast('D\u1eef li\u1ec7u \u0111\u01a1n h\u00e0ng kh\u00f4ng h\u1ee3p l\u1ec7'); return; }
    if (!billing.name || billing.phone.length < 9 || billing.phone.length > 13) { toast('H\u1ecd t\u00ean ho\u1eb7c s\u1ed1 \u0111i\u1ec7n tho\u1ea1i xu\u1ea5t h\u00f3a \u0111\u01a1n kh\u00f4ng h\u1ee3p l\u1ec7'); return; }
    if (billing.cccd && billing.cccd.length !== 12) { toast('CCCD ph\u1ea3i \u0111\u1ee7 12 ch\u1eef s\u1ed1 ho\u1eb7c \u0111\u1ec3 tr\u1ed1ng'); return; }
    if (billing.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing.email)) { toast('Email xu\u1ea5t h\u00f3a \u0111\u01a1n kh\u00f4ng h\u1ee3p l\u1ec7'); return; }
    if (billing.taxId && !/^\d{10,13}$/.test(billing.taxId)) { toast('MST ph\u1ea3i c\u00f3 10 \u0111\u1ebfn 13 ch\u1eef s\u1ed1'); return; }
    if (amounts.paymentMode === 'DEPOSIT' && (amounts.depositAmount <= 0 || amounts.depositAmount >= amounts.total)) { toast('Ti\u1ec1n c\u1ecdc ph\u1ea3i l\u1edbn h\u01a1n 0 v\u00e0 nh\u1ecf h\u01a1n t\u1ed5ng thanh to\u00e1n'); return; }
    const id = makeRecordId('ORD'), createdAt = stamp(); const rentalMonths = amounts.product.type === 'RENTAL' ? Number(amounts.product.rentalMonths) || null : null;
    const order = { id, code: `NVT-${id.slice(4)}`, customerId: customer.id, customerName: customer.name, saleId: customer.saleId, leaderId: customer.leaderId, teamId: customer.teamId, source: orderSource(customer.source), campaign: customer.campaign || 'UNATTRIBUTED', websiteId: customer.websiteId || null, productId: amounts.product.id, productName: amounts.product.name, sku: amounts.product.sku, qty: amounts.qty, unitPrice: Number(amounts.product.price), subtotal: amounts.subtotal, vatRate: amounts.vatRate, vatAmount: amounts.vatAmount, discount: 0, total: amounts.total, paymentMode: amounts.paymentMode, depositAmount: amounts.depositAmount, amountPaid: 0, balanceDue: amounts.total, paymentMethod: $('#newOrderPaymentMethod').value, billing, rentalMonths, rentalEndsAt: orderRentalEndsAt(createdAt, rentalMonths), refund: 0, status: 'PENDING', createdAt, depositAt: null, paidAt: null, refundedAt: null, paymentReconciled: false, refundReconciled: null };
    state.orders.unshift(order); audit('CREATE_ORDER', id, `${order.code} \u00b7 ${order.productName}`); saveState();
    if (!await flushServerPersistence()) { toast('Kh\u00f4ng th\u1ec3 l\u01b0u \u0111\u01a1n h\u00e0ng l\u00ean MySQL; b\u1ea3n nh\u00e1p v\u1eabn \u0111ang m\u1edf \u0111\u1ec3 th\u1eed l\u1ea1i'); return; }
    closeModal(); render(); toast('\u0110\u00e3 t\u1ea1o \u0111\u01a1n ch\u1edd Admin x\u00e1c nh\u1eadn thanh to\u00e1n');
  };
}

// Form đơn hàng kế toán dùng chung cho mọi giao diện tham chiếu.
// Định nghĩa lại tại đây để giữ một luồng nghiệp vụ duy nhất và bổ sung mã khóa học,
// tham chiếu ngân hàng cùng số tiền thực thu đợt đầu.
function newOrderModal(customerId = '') {
  const customers = scopedCustomers().filter(customer => customer.saleId);
  const products = state.products.filter(product => product.active !== false);
  if (!customers.length) { toast('Chưa có khách đã phân Sale để tạo đơn hàng.'); return; }
  if (!products.length) { toast('Chưa có sản phẩm đang bán.'); return; }
  const courseValues = customer => {
    const fields = state.customFieldDefinitions.filter(field => {
      const key = normalize(`${field.id} ${field.label}`);
      return key.includes('khoa') || key.includes('course');
    });
    return [...new Set(fields.flatMap(field => {
      const value = customer?.customFields?.[field.id];
      return Array.isArray(value) ? value : String(value || '').split(',');
    }).map(value => String(value || '').trim()).filter(Boolean))];
  };
  const selectedCustomer = customerById(customerId) || customers[0];
  const courses = [...new Set(customers.flatMap(courseValues))];
  const options = values => values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  openModal('Tạo đơn hàng và đối soát kế toán', `<form id="newOrderForm"><div class="form-grid"><label class="form-field">Khách hàng<select id="newOrderCustomer">${customers.map(customer => `<option value="${escapeHtml(customer.id)}" ${customer.id === selectedCustomer.id ? 'selected' : ''}>${escapeHtml(customer.name)} · ${escapeHtml(customer.phone)}</option>`).join('')}</select></label><label class="form-field">Khóa học<select id="newOrderCourse"><option value="">— Chưa ghi nhận —</option>${options(courseValues(selectedCustomer).length ? courseValues(selectedCustomer) : courses)}</select><small class="form-hint">Lấy từ cột Khóa học trong hồ sơ khách.</small></label><label class="form-field">Sản phẩm / dịch vụ<select id="newOrderProduct">${products.map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${money(product.price)}</option>`).join('')}</select></label><label class="form-field">VAT (%)<select id="newOrderVatRate"><option value="0">Không VAT</option><option value="0.08">8%</option><option value="0.10" selected>10%</option><option value="0.12">12%</option></select></label><label class="form-field">Số lượng<input id="newOrderQty" type="number" min="1" max="10" value="1"></label><label class="form-field">Kênh thanh toán<select id="newOrderPaymentMethod"><option value="VietQR">VietQR</option><option value="BANK_TRANSFER">Chuyển khoản</option><option value="CASH">Tiền mặt</option></select></label><label class="form-field">Hình thức<select id="newOrderPaymentMode"><option value="FULL">Thanh toán đủ</option><option value="DEPOSIT">Đặt cọc / đợt 1</option></select></label><label class="form-field" id="newOrderDepositWrap" style="display:none">Thực thu đợt 1<input id="newOrderDeposit" type="number" min="0" step="10000" value="0"></label><label class="form-field">Mã UNC / tham chiếu ngân hàng<input id="newOrderBankReference" maxlength="160"></label></div><div class="section-label">Thông tin xuất hóa đơn</div><div class="form-grid"><label class="form-field">Họ tên *<input id="newOrderBillingName" maxlength="160" required value="${escapeHtml(selectedCustomer.name || '')}"></label><label class="form-field">CCCD<input id="newOrderBillingCccd" inputmode="numeric" maxlength="12"></label><label class="form-field">SĐT *<input id="newOrderBillingPhone" inputmode="numeric" maxlength="15" required value="${escapeHtml(selectedCustomer.phone || '')}"></label><label class="form-field">Email<input id="newOrderBillingEmail" type="email" maxlength="254" value="${escapeHtml(selectedCustomer.email || '')}"></label><label class="form-field">Địa chỉ<input id="newOrderBillingAddress" maxlength="240"></label><label class="form-field">MST doanh nghiệp<input id="newOrderBillingTaxId" inputmode="numeric" maxlength="13"></label></div><div class="form-hint" id="newOrderSummary"></div><div class="modal-actions"><button class="button" type="button" data-close-modal>Hủy</button><button class="button button-primary" type="submit">Tạo đơn chờ thanh toán</button></div></form>`);
  $('#newOrderVatRate').value='0.10';
  $('[data-close-modal]')?.addEventListener('click', closeModal);
  const readAmounts = () => { const product = state.products.find(item=>item.id===$('#newOrderProduct').value); const qty = Math.floor(Number($('#newOrderQty').value) || 0); const subtotal = Number(product?.price || 0) * qty; const vatRate = Math.min(1, Math.max(0, Number($('#newOrderVatRate').value || 0))); const vatAmount = Math.round(subtotal * vatRate); const total = subtotal + vatAmount; const paymentMode = $('#newOrderPaymentMode').value === 'DEPOSIT' ? 'DEPOSIT' : 'FULL'; const depositAmount = paymentMode === 'DEPOSIT' ? Math.floor(Number($('#newOrderDeposit').value) || 0) : 0; return {product,qty,subtotal,vatRate,vatAmount,total,paymentMode,depositAmount}; };
  const refreshSummary = () => { const a=readAmounts(); $('#newOrderDepositWrap').style.display=a.paymentMode==='DEPOSIT'?'':'none'; $('#newOrderSummary').innerHTML=`Trước VAT <b>${money(a.subtotal)}</b> · VAT ${Math.round(a.vatRate*100)}% <b>${money(a.vatAmount)}</b> · Tổng <b>${money(a.total)}</b>${a.paymentMode==='DEPOSIT'?` · Đợt 1 ${money(a.depositAmount)} · Còn lại ${money(Math.max(0,a.total-a.depositAmount))}`:''}`; };
  const fillCustomer = () => { const customer=customerById($('#newOrderCustomer').value);if(!customer)return;$('#newOrderBillingName').value=customer.name||'';$('#newOrderBillingPhone').value=customer.phone||'';$('#newOrderBillingEmail').value=customer.email||'';const values=courseValues(customer);$('#newOrderCourse').innerHTML='<option value="">— Chưa ghi nhận —</option>'+options(values); };
  ['newOrderProduct','newOrderVatRate','newOrderQty','newOrderPaymentMode','newOrderDeposit'].forEach(id=>{$('#'+id).addEventListener('input',refreshSummary);$('#'+id).addEventListener('change',refreshSummary);});
  $('#newOrderCustomer').addEventListener('change',fillCustomer); refreshSummary();
  $('#newOrderForm').onsubmit = async event => {
    event.preventDefault(); const customer=customerById($('#newOrderCustomer').value),a=readAmounts();
    const billing={name:$('#newOrderBillingName').value.trim(),cccd:$('#newOrderBillingCccd').value.replace(/\D/g,''),phone:$('#newOrderBillingPhone').value.replace(/\D/g,''),email:$('#newOrderBillingEmail').value.trim(),address:$('#newOrderBillingAddress').value.trim(),taxId:$('#newOrderBillingTaxId').value.replace(/\D/g,'')};
    if(!customer||!a.product||!Number.isInteger(a.qty)||a.qty<1||a.qty>10||!customer.saleId){toast('Thông tin đơn hàng không hợp lệ.');return;}
    if(!billing.name||billing.phone.length<9||billing.phone.length>13){toast('Họ tên hoặc số điện thoại không hợp lệ.');return;}
    if(billing.cccd&&billing.cccd.length!==12){toast('CCCD phải đủ 12 chữ số hoặc để trống.');return;}
    if(billing.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing.email)){toast('Email xuất hóa đơn không hợp lệ.');return;}
    if(billing.taxId&&!/^\d{10,13}$/.test(billing.taxId)){toast('MST phải có 10 đến 13 chữ số.');return;}
    if(a.paymentMode==='DEPOSIT'&&(a.depositAmount<=0||a.depositAmount>=a.total)){toast('Tiền đợt 1 phải lớn hơn 0 và nhỏ hơn tổng đơn.');return;}
    const id=makeRecordId('ORD'),createdAt=stamp(),rentalMonths=a.product.type==='RENTAL'?Number(a.product.rentalMonths)||null:null;
    const order={id,code:`NVT-${id.slice(4)}`,customerId:customer.id,customerName:customer.name,saleId:customer.saleId,leaderId:customer.leaderId,teamId:customer.teamId,source:orderSource(customer.source),campaign:customer.campaign||'UNATTRIBUTED',websiteId:customer.websiteId||null,productId:a.product.id,productName:a.product.name,courseCode:$('#newOrderCourse').value.trim(),sku:a.product.sku,qty:a.qty,unitPrice:Number(a.product.price),subtotal:a.subtotal,vatRate:a.vatRate,vatAmount:a.vatAmount,discount:0,total:a.total,paymentMode:a.paymentMode,depositAmount:a.depositAmount,amountPaid:0,balanceDue:a.total,paymentMethod:$('#newOrderPaymentMethod').value,bankReference:$('#newOrderBankReference').value.trim(),billing,rentalMonths,rentalEndsAt:orderRentalEndsAt(createdAt,rentalMonths),refund:0,status:'PENDING',createdAt,depositAt:null,paidAt:null,refundedAt:null,paymentReconciled:false,refundReconciled:null};
    state.orders.unshift(order);audit('CREATE_ORDER',id,`${order.code} · ${order.productName}`);saveState();if(!await flushServerPersistence()){toast('Chưa lưu được đơn hàng lên máy chủ.');return;}closeModal();render();toast('Đã tạo đơn và chuyển sang sổ kế toán.');
  };
}

// Leader tham gia chia data trong Team nhu mot nguoi phu trach.
function teamRecipients(leaderId, teamId) {
  const leader = activeStaff().find(p => p.id === leaderId && p.role === 'LEADER');
  const sales = activeStaff().filter(p => p.teamId === teamId && p.role === 'SALE' && p.leaderId === leaderId);
  const manager = leader?.managerId
    ? activeStaff().find(p => p.id === leader.managerId && p.role === 'MANAGER')
    : null;
  const managerRecipient = manager
    ? { ...manager, role: 'SALE', actualRole: 'MANAGER', leaderId, teamId, managerRecipient: true }
    : null;
  return [
    ...(leader ? [{ ...leader, role: 'SALE', leaderId: leader.id, teamId, teamLeaderRecipient: true }] : []),
    ...sales,
    ...(managerRecipient ? [managerRecipient] : [])
  ];
}
function globalDistributionRound() {
  const config = state.saleDistributionByLeader['$'];
  return config?.rounds?.[0] || config || null;
}

function promoteGlobalDistributionRound() {
  const config = state.saleDistributionByLeader['$'];
  if (!config || !Array.isArray(config.rounds) || config.rounds.length < 2) return false;
  config.rounds.shift();
  const next = config.rounds[0];
  config.weights = next.weights || {};
  config.enabledSaleIds = next.enabledSaleIds || [];
  state.settings.assignmentCursor.global = { index: 0, ids: [] };
  audit('ACTIVATE_DISTRIBUTION_ROUND', next.id, 'Vong cho tro thanh vong dang chay');
  saveState();
  return true;
}

function assignmentCandidates(customer, roundConfig = null) {
  if (customer.leaderId) {
    const config = state.saleDistributionByLeader[customer.leaderId];
    const configured = config?.managerDistributionInitialized === true && Array.isArray(config?.enabledSaleIds) && config.enabledSaleIds.length > 0;
    return teamRecipients(customer.leaderId, customer.teamId).filter(p => assignmentWeight(p) > 0 && (p.teamLeaderRecipient ? config?.leaderEnabled !== false : !configured || config.enabledSaleIds.includes(p.id))).sort((a,b)=>a.id.localeCompare(b.id));
  }
  const enabledLeaders = new Set(state.leaderDistribution.enabledLeaderIds);
  const members = activeStaff();
  const leaders = members.filter(p=>p.role==='LEADER'&&enabledLeaders.has(p.id));
  const recipients = [];
  const seen = new Set();
  const enabledGlobal = new Set(Array.isArray(roundConfig?.enabledSaleIds) ? roundConfig.enabledSaleIds : []);
  const add = person => { if(person && (!roundConfig || !enabledGlobal.size || enabledGlobal.has(person.id)) && !seen.has(person.id) && assignmentWeight(person, roundConfig)>0){seen.add(person.id);recipients.push(person);} };
  leaders.forEach(leader=>{
    const config=state.saleDistributionByLeader[leader.id]||{};
    if(config.leaderEnabled!==false)add({...leader,role:'SALE',leaderId:leader.id,teamId:leader.teamId,teamLeaderRecipient:true});
    const configured=config.managerDistributionInitialized===true&&Array.isArray(config.enabledSaleIds)&&config.enabledSaleIds.length>0;
    members.filter(p=>p.role==='SALE'&&p.leaderId===leader.id&&(!configured||config.enabledSaleIds.includes(p.id))).forEach(add);
    const manager=leader.managerId&&members.find(p=>p.role==='MANAGER'&&p.id===leader.managerId);
    if(manager){const managerRecipient={...manager,role:'SALE',actualRole:'MANAGER',leaderId:leader.id,teamId:leader.teamId,managerRecipient:true};if(!configured||config.enabledSaleIds.includes(manager.id))add(managerRecipient);}
  });
  members.filter(p=>p.role==='SALE'&&p.managerId&&!p.leaderId).forEach(sale=>{
    const config=state.saleDistributionByLeader['manager:'+sale.managerId]||{};
    const configured=config.managerDistributionInitialized===true&&Array.isArray(config.enabledSaleIds)&&config.enabledSaleIds.length>0;
    if(!configured||config.enabledSaleIds.includes(sale.id))add(sale);
  });
  return recipients.sort((a,b)=>a.id.localeCompare(b.id));
}

function assignmentModeFor(customer) {
  return customer.leaderId ? state.settings.saleAssignmentModes[customer.leaderId] || 'MANUAL' : state.settings.assignmentMode;
}

function assignmentLoad(person) {
  if (person.managerRecipient || person.actualRole === 'MANAGER' || person.role === 'MANAGER') {
    return state.customers.filter(customer => customer.managerId === person.id).length;
  }
  if (person.role === 'LEADER') return state.customers.filter(customer => customer.leaderId === person.id).length;
  return state.customers.filter(customer => customer.saleId === person.id && customer.leaderId === person.leaderId && customer.teamId === person.teamId).length + state.dataOffers.filter(o=>o.saleId===person.id&&o.status==='PENDING').length;
}

function assignmentWeight(person, roundConfig = null) {
  const value = roundConfig?.weights?.[person.id] ?? (person.role === 'LEADER' ? state.leaderDistribution.weights[person.id] : state.saleDistributionByLeader[person.leaderId]?.weights?.[person.id]);
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 1;
}



function chooseAssignmentTarget(customer, mode) {
  if(!customer.leaderId&&['EQUAL','ROUND_ROBIN','BALANCED'].includes(mode)){
    const roster=CrmDistributionRounds.recipients(activeStaff(),state.leaderDistribution,state.saleDistributionByLeader);
    const config=state.saleDistributionByLeader.$||{id:'ROUND-1',enabledSaleIds:roster.people.map(p=>p.id),weights:roster.weights};
    const store=state.settings.assignmentCursor;
    const step=CrmDistributionRounds.take(config,CrmDistributionRounds.cursorFrom(store),roster.people,mode);
    store.global=step.cursor;
    if(store.salesByTeam)delete store.salesByTeam.global;
    if(step.changed)state.saleDistributionByLeader.$=step.config;
    return roster.people.find(p=>p.id===step.id)||null;
  }
  let globalRound = customer.leaderId ? null : globalDistributionRound();
  let candidates = assignmentCandidates(customer, globalRound);
  if (!candidates.length) return null;
  if (!['EQUAL', 'ROUND_ROBIN', 'BALANCED'].includes(mode)) return null;
  const key = customer.leaderId || 'global';
  let weighted = mode === 'ROUND_ROBIN' || mode === 'BALANCED' ? candidates.flatMap(candidate => Array.from({ length: assignmentWeight(candidate, globalRound) }, () => candidate)) : candidates;
  const cursorStore = customer.leaderId ? state.settings.assignmentCursor.salesByTeam : state.settings.assignmentCursor;
  const raw = customer.leaderId ? cursorStore[key] : cursorStore.global;
  let currentIds = weighted.map(person => person.id);
  let cursor = typeof raw === 'object' && raw ? { index: Number.isInteger(raw.index) ? raw.index : 0, ids: Array.isArray(raw.ids) ? raw.ids.map(String) : [] } : { index: Number.isInteger(raw) ? raw : 0, ids: [] };
  if (!customer.leaderId && cursor.index >= (cursor.ids.length || currentIds.length) && promoteGlobalDistributionRound()) {
    globalRound = globalDistributionRound();
    candidates = assignmentCandidates(customer, globalRound);
    weighted = mode === 'ROUND_ROBIN' || mode === 'BALANCED' ? candidates.flatMap(candidate => Array.from({ length: assignmentWeight(candidate, globalRound) }, () => candidate)) : candidates;
    currentIds = weighted.map(person => person.id);
    cursor = { index: 0, ids: [] };
  }
  let roundIds = cursor.ids.filter(id => currentIds.includes(id));
  if (!roundIds.length || cursor.index >= roundIds.length) { roundIds = currentIds; cursor.index = 0; }
  const targetId = roundIds[cursor.index];
  const target = weighted.find(person => person.id === targetId) || candidates.find(person => person.id === targetId);
  cursor.index += 1; cursor.ids = roundIds;
  if (customer.leaderId) cursorStore[key] = cursor; else cursorStore.global = cursor;
  return target || null;
}

/* Nhận data hai bước: mọi đường gán SALE đều đi qua đây. Sale đang giữ khách,
   resubmission trả về sale cũ (direct = true) hoặc sale tự tạo khách thì gán thẳng;
   còn lại khách vào team của leader ngay nhưng saleId để null kèm một offer PENDING —
   sale phải bấm "Nhận data" trong mục Data chờ nhận thì khách mới thật sự đổ về. */
function offerOrAssignSale(customer, target, reason, source, previous, direct = false) {
  if (direct || customer.saleId === target.id || target.id === currentAccount?.saleId) {
    customer.saleId = target.id;
    customer.leaderId = target.leaderId;
    customer.teamId = target.teamId;
    // Sale tự tạo khách thì coi như đã nhận ngay; đường gán thẳng khác vẫn để sale bấm "Nhận data" trong bảng.
    if (target.teamLeaderRecipient || target.id === currentAccount?.saleId) customer.saleAcceptedAt = stamp();
    createInitialTask(customer);
    state.notifications.unshift({ id: `NT-${Date.now()}-${customer.id}`, role: 'OWN', saleId: target.id, title: 'Bạn vừa nhận data mới', text: `${customer.name} · ${customer.phone}`, at: new Date().toISOString(), readBy: [] });
    queueEmailNotification(
      [target.email, staffEmail(target.leaderId)],
      `Data mới được giao - ${customer.name}`,
      `Xin chào ${target.name},\n\nBạn có data mới được giao trong CRM.\nKhách hàng: ${customer.name}\nSố điện thoại: ${customer.phone}\nNguồn: ${customerLandingName(customer)}\nThời gian: ${stamp()}\n\nVui lòng mở CRM để xử lý.`
    );
    customer.updatedAt = stamp();
    customer.note = reason;
    state.notes.unshift({ id: `NOTE-${Date.now()}-${customer.id}-${target.id}`, customerId: customer.id, authorId: currentAccount?.id || 'SYSTEM', author: currentAccount?.name || 'Hệ thống phân data', role: currentAccount?.role || 'SYSTEM', text: `${reason} · ${target.name}`, at: stamp() });
    recordAssignmentChange(customer, previous, reason, source);
    return true;
  }
  const hours = 24;
  // Khách chỉ được có một lời mời đang chờ: leader chia lại cho sale khác thì huỷ lời mời cũ.
  state.dataOffers.forEach(offer => {
    if (offer.status === 'PENDING' && offer.customerId === customer.id) { offer.status = 'EXPIRED'; offer.resolvedAt = stamp(); }
  });
  customer.saleId = null;
  // Giao lai phai cho Sale moi nhan, khong giu moc da nhan cua Sale cu.
  customer.saleAcceptedAt = null;
  customer.leaderId = target.leaderId;
  customer.teamId = target.teamId;
  customer.managerId = target.managerId || null;
  state.dataOffers.unshift({ id: `OFR-${Date.now()}-${customer.id}`, customerId: customer.id, saleId: target.id, leaderId: target.leaderId, teamId: target.teamId, offeredAt: stamp(), status: 'PENDING', resolvedAt: '', source });
  state.notifications.unshift({ id: `NT-OFFER-${Date.now()}-${customer.id}`, role: 'OWN', saleId: target.id, title: 'Có data chờ bạn nhận', text: `${customer.name} · nhận trong ${hours} giờ`, at: new Date().toISOString(), readBy: [] });
  queueEmailNotification(
    [target.email, staffEmail(target.leaderId)],
    `Data mới chờ Sale nhận - ${customer.name}`,
    `Xin chào ${target.name},\n\nBạn có data mới đang chờ nhận trong ${hours} giờ.\nKhách hàng: ${customer.name}\nSố điện thoại: ${customer.phone}\nNguồn: ${customerLandingName(customer)}\nThời gian: ${stamp()}\n\nVui lòng đăng nhập CRM và bấm Nhận data.`
  );
  customer.updatedAt = stamp();
  customer.note = reason;
  state.notes.unshift({ id: `NOTE-${Date.now()}-${customer.id}-${target.id}`, customerId: customer.id, authorId: currentAccount?.id || 'SYSTEM', author: currentAccount?.name || 'Hệ thống phân data', role: currentAccount?.role || 'SYSTEM', text: `${reason} · chờ ${target.name} nhận`, at: stamp() });
  recordAssignmentChange(customer, previous, `${reason} · chờ ${target.name} nhận`, 'OFFER', true);
  const offerHistory=state.assignmentHistory[0];
  if(offerHistory&&offerHistory.customerId===customer.id)offerHistory.offeredSaleId=target.id;
  audit('OFFER_DATA', customer.id, `${target.name} · chờ nhận ${hours}h`);
  return true;
}

function currentSaleIdentity() {
  return String(currentAccount?.saleId || currentAccount?.id || '').trim();
}

function pendingOffersForMe() {
  const saleId = currentSaleIdentity();
  if (!saleId) return [];
  return state.dataOffers.filter(item => item.status === 'PENDING' && String(item.saleId || '') === saleId && customerById(item.customerId) && Date.parse(String(item.offeredAt).replace(' ', 'T') + '+07:00') + offerDeadlineMs() > Date.now()).sort((a, b) => a.offeredAt.localeCompare(b.offeredAt) || a.id.localeCompare(b.id));
}

// Thong ke data da duoc giao theo ngay giao, doc lap voi hang cho nhan.
// Mot khach duoc giao lai nhieu lan trong cung ky chi dem mot lan.
function assignedDataStatsForMe() {
  const saleId = currentAccount?.saleId || currentAccount?.id;
  const today = dayIso(0);
  const offers = state.dataOffers.filter(offer => offer.saleId === saleId
    && offer.customerId && ['PENDING', 'ACCEPTED', 'EXPIRED'].includes(offer.status));
  const count = days => new Set(offers.filter(offer => {
    const date = String(offer.offeredAt || '').slice(0, 10);
    return date >= dayIso(days - 1) && date <= today;
  }).map(offer => offer.customerId)).size;
  return { today: count(1), threeDays: count(3), sevenDays: count(7) };
}

function pendingOfferCount() {
  return currentAccount && currentAccount.role === 'SALE' ? pendingOffersForMe().length : 0;
}

function offerDeadlineMs() {
  return (24) * 3600000;
}

function offerMinutesLeft(offer) {
  const offeredMs = Date.parse(`${String(offer.offeredAt).replace(' ', 'T')}+07:00`);
  if (!Number.isFinite(offeredMs)) return 0;
  return Math.max(0, Math.round((offerDeadlineMs() - (Date.now() - offeredMs)) / 60000));
}

function acceptQueueView() {
  if (currentAccount.role !== 'SALE') return accessDeniedView('Hàng chờ nhận data chỉ dành cho Sale.');
  const offers = pendingOffersForMe();
  const hours = 24;
  return pageHead('Data chờ nhận', '', '') +
    `<section class="panel"><div class="panel-head"><div><div class="panel-title">Data chờ bạn nhận</div><div class="panel-sub">Quá ${hours} giờ không nhận, khách tự trả về leader để chia sale khác</div></div></div><div class="panel-body">${offers.map(offer => { const customer = customerById(offer.customerId); if (!customer) return ''; const left = offerMinutesLeft(offer); return `<div class="rank-row" style="grid-template-columns:minmax(0,1fr) auto auto"><div><b>${escapeHtml(customer.name)}</b><small>•••••</small><div class="cell-sub">Gửi lúc ${escapeHtml(offer.offeredAt)} · còn ${Math.floor(left / 60)} giờ ${left % 60} phút</div></div>${statusBadge(customer.status)}<button class="button button-small button-primary" type="button" data-accept-offer="${escapeHtml(offer.id)}">Nhận data</button></div>`; }).join('') || '<div class="empty"><b>Không có data chờ nhận</b><span>Leader chia data mới sẽ hiện ở đây kèm đồng hồ đếm ngược.</span></div>'}</div></section>`;
}

function acceptDataOffer(offerId) {
  if (currentAccount.role !== 'SALE') { toast('FORBIDDEN · chỉ Sale được nhận data'); return false; }
  const offer = state.dataOffers.find(item => item.id === offerId);
  if (!offer || offer.status !== 'PENDING') { toast('Data này không còn chờ nhận'); render(); return false; }
  if (offer.saleId !== currentAccount.saleId) { toast('FORBIDDEN · data không dành cho bạn'); return false; }
  if (!pendingOffersForMe().some(item => item.id === offer.id)) { toast('Data da het han nhan. Vui long tai lai danh sach.'); return false; }
  const customer = customerById(offer.customerId);
  if (!customer) { toast('Khách không tồn tại'); return false; }
  customer.saleId = offer.saleId;
  customer.leaderId = offer.leaderId;
  customer.teamId = offer.teamId;
  customer.saleAcceptedAt = stamp();
  customer.updatedAt = stamp();
  createInitialTask(customer);
  offer.status = 'ACCEPTED';
  offer.resolvedAt = stamp();
  // Sale nhận data chỉ cập nhật quyền phụ trách và trạng thái khách hàng.
  // Không tạo thông báo/email cho Leader ở bước này; lịch sử vẫn được giữ để đối soát.
  audit('ACCEPT_DATA', customer.id, `${currentAccount.name} nhận từ hàng chờ`);
  saveState(); render(); toast(`Đã nhận data ${customer.name}`);
  return true;
}

/* Quét định kỳ: offer quá hạn thì khách GIỮ leader/team và saleId null — tức trả về
   đúng leader đã chia để leader chọn sale khác, không đẩy lên phễu Admin. */
// Hết hạn offer do máy chủ xử lý; trình duyệt không tự sửa các bản ghi này.
function expireStaleOffers() { return false; }

function applyCustomerAssignment(customer, target, reason, source = 'MANUAL', direct = false) {
  if (!customer || !target) return false;
  if (target.teamLeaderRecipient) {
    direct = true;
    closeOpenCustomerTasks(customer, 'REASSIGNED');
    state.dataOffers.forEach(o => { if (o.customerId === customer.id && o.status === 'PENDING') { o.status = 'EXPIRED'; o.resolvedAt = stamp(); } });
  }
  const previous = assignmentSnapshot(customer);
  if (target.managerRecipient) {
    closeOpenCustomerTasks(customer, 'REASSIGNED');
    state.dataOffers.forEach(o => { if (o.customerId === customer.id && o.status === 'PENDING') { o.status = 'EXPIRED'; o.resolvedAt = stamp(); } });
    customer.saleId = target.id;
    customer.leaderId = target.leaderId || null;
    customer.teamId = target.teamId || null;
    customer.managerId = target.id;
    customer.saleAcceptedAt = stamp();
    customer.updatedAt = stamp();
    customer.note = reason;
    state.notifications.unshift({ id: `NT-${Date.now()}-${customer.id}`, role: 'OWN', saleId: target.id, managerId: target.id, leaderId: target.leaderId, teamId: target.teamId, title: 'Khách mới trong tuyến', text: `${customer.name} · ${customerLandingName(customer)}`, at: new Date().toISOString(), readBy: [] });
    state.notes.unshift({ id: `NOTE-${Date.now()}-${customer.id}-${target.id}`, customerId: customer.id, authorId: currentAccount?.id || 'SYSTEM', author: currentAccount?.name || 'Hệ thống phân data', role: currentAccount?.role || 'SYSTEM', text: `${reason} · ${target.name}`, at: stamp() });
    recordAssignmentChange(customer, previous, reason, source);
    return true;
  }
  if (target.role === 'LEADER' || target.teamLeaderRecipient) {
    customer.saleId = target.id;
    customer.leaderId = target.id;
    customer.teamId = target.teamId;
    customer.managerId = target.managerId || null;
    customer.saleAcceptedAt = stamp();
    createInitialTask(customer);
    state.notifications.unshift({ id: `NT-${Date.now()}-${customer.id}`, role: 'OWN', saleId: target.id, leaderId: target.id, teamId: target.teamId, title: 'Khách mới trong Team', text: `${customer.name} · ${customerLandingName(customer)}`, at: new Date().toISOString(), readBy: [] });
    queueEmailNotification(
      [target.email],
      `Data mới được giao cho Leader - ${customer.name}`,
      `Xin chào ${target.name},\n\nBạn có data mới trong Team ${target.teamId}.\nKhách hàng: ${customer.name}\nSố điện thoại: ${customer.phone}\nNguồn: ${customerLandingName(customer)}\nThời gian: ${stamp()}\n\nVui lòng mở CRM để xử lý.`
    );
    customer.updatedAt = stamp();
    customer.note = reason;
    state.notes.unshift({ id: `NOTE-${Date.now()}-${customer.id}-${target.id}`, customerId: customer.id, authorId: currentAccount?.id || 'SYSTEM', author: currentAccount?.name || 'Hệ thống phân data', role: currentAccount?.role || 'SYSTEM', text: `${reason} · ${target.name}`, at: stamp() });
    recordAssignmentChange(customer, previous, reason, source);
    return true;
  }
  return offerOrAssignSale(customer, target, reason, source, previous, direct);
}

function autoAssignCustomer(customer) {
  if (!customer || customer.saleId || state.dataOffers.some(o => o.customerId === customer.id && o.status === 'PENDING')) return false;
  if (!customer.leaderId && !state.leaderDistribution.enabled) return false;
  const mode = assignmentModeFor(customer);
  const target = chooseAssignmentTarget(customer, mode);
  if (!target) return false;
  const assigned = applyCustomerAssignment(customer, target, `${mode === 'BALANCED' ? 'Phân theo tỷ trọng' : 'Phân đều'} tự động`);
  if (assigned && target.role === 'LEADER') {
    const recipient = chooseAssignmentTarget(customer, mode);
    if (recipient) applyCustomerAssignment(customer, recipient, 'Chia theo tỷ trọng trong Team', 'AUTO');
  }
  return assigned;
}

async function setAssignmentMode(mode) {
  if (currentAccount.role !== 'ADMIN' || !['MANUAL','EQUAL','ROUND_ROBIN','BALANCED'].includes(mode)) return;
  state.settings.assignmentMode = mode;
  state.leaderDistribution.enabled = mode !== 'MANUAL';
  // Server luu cau hinh va chia hang cho trong cung giao dich.
  saveState();
  if (await flushServerPersistence()) { render(); toast('Đã lưu chế độ chia data trên máy chủ'); }
}

function bulkAssignWaitingSales(mode = 'BALANCED') {
  if (currentAccount?.role !== 'ADMIN') { toast('Khong co quyen chia data cho Sale'); return 0; }
  const selectedMode = ['EQUAL', 'ROUND_ROBIN', 'BALANCED', 'SALE_EMPTY', 'LEADER_EQUAL'].includes(mode) ? mode : 'BALANCED';
  const waiting = scopedCustomers().filter(customer => !customer.saleId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  const enabledLeaders = activeStaff().filter(person => person.role === 'LEADER' && person.active !== false && state.leaderDistribution.enabledLeaderIds.includes(person.id)).sort((a, b) => a.id.localeCompare(b.id));
  const allSales = activeStaff().filter(person => person.role === 'SALE' && person.active !== false).sort((a, b) => a.id.localeCompare(b.id));
  let distributed = 0;
  let specialCursor = 0;
  waiting.forEach(customer => {
    let target = null;
    if (selectedMode === 'LEADER_EQUAL') {
      target = enabledLeaders.length ? enabledLeaders[specialCursor % enabledLeaders.length] : null;
      specialCursor += 1;
    } else if (selectedMode === 'SALE_EMPTY') {
      const emptySales = allSales.filter(person => assignmentLoad(person) === 0);
      const candidates = emptySales.length ? emptySales : allSales;
      target = candidates.slice().sort((a, b) => assignmentLoad(a) - assignmentLoad(b) || a.id.localeCompare(b.id))[0] || null;
    } else {
      target = chooseAssignmentTarget(customer, selectedMode);
    }
    if (!target) return;
    const reason = selectedMode === 'SALE_EMPTY' ? 'Chia đều cho Sale chưa có khách' : selectedMode === 'LEADER_EQUAL' ? 'Chia đều cho Leader' : (selectedMode === 'BALANCED' ? 'Phân theo tỷ trọng cho Sale' : 'Phân đều cho Sale');
    // Sale vẫn phải bấm "Nhận data" trong 24 giờ; không gán thẳng để bỏ qua SLA.
    const assigned = applyCustomerAssignment(customer, target, reason, 'AUTO');
    if (!assigned) return;
    if (selectedMode !== 'LEADER_EQUAL' && target.role === 'LEADER') {
      const recipient = chooseAssignmentTarget(customer, selectedMode);
      if (recipient) applyCustomerAssignment(customer, recipient, 'Chia tiep cho Sale theo ty trong', 'AUTO');
    }
    audit('AUTO_ASSIGN_WAITING_SALE', customer.id, target.name+' · '+selectedMode);
    distributed += 1;
  });
  saveState();
  render();
  toast(distributed ? `Đã chia ${distributed} data chưa có Sale` : 'Không có Sale hoặc data phù hợp để chia');
  return distributed;
}

function bulkDistributePool(mode, fromAuto = false) {
  if (!['ADMIN', 'LEADER'].includes(currentAccount.role) || !['EQUAL', 'ROUND_ROBIN', 'BALANCED'].includes(mode)) { toast('Không có quyền chia data'); return; }
  const pool = scopedCustomers().filter(isPoolCustomer).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  let distributed = 0;
  pool.forEach(customer => {
    const target = chooseAssignmentTarget(customer, mode);
    if (target && applyCustomerAssignment(customer, target, mode === 'ROUND_ROBIN' ? 'Chia lần lượt toàn bộ' : 'Chia đều toàn bộ')) {
      audit(target.role === 'LEADER' ? 'ALLOCATE_TO_LEADER' : 'ASSIGN_TO_SALE', customer.id, `${target.name} · ${mode}`);
      // Admin chia xuống Team rồi chia tiếp cho Leader/Sale theo tỷ trọng.
      if (target.role === 'LEADER') {
        const recipient = chooseAssignmentTarget(customer, mode);
        if (recipient) applyCustomerAssignment(customer, recipient, 'Chia theo tỷ trọng trong Team', 'AUTO');
      }
      distributed += 1;
    }
  });
  selectedPoolIds.clear();
  saveState();
  render();
  toast(distributed
    ? `${fromAuto ? 'Đã tự động phân' : 'Đã phân'} ${distributed} data theo chế độ ${mode === 'BALANCED' ? 'tỷ trọng' : 'chia đều'}`
    : (fromAuto ? 'Chưa có Leader được bật hoặc chưa có data phù hợp để tự động phân' : 'Không có data hoặc nhân sự phù hợp để phân'));
}

function createInitialTask(customer) {
  if (!customer.saleId || state.tasks.some(task => task.status !== 'DONE' && taskMatchesCustomerAssignment(task, customer))) return;
  const createdAt = stamp();
  state.tasks.unshift({ id: `TSK-${Date.now()}-${customer.id}`, customerId: customer.id, customerName: customer.name, ownerId: customer.saleId, leaderId: customer.leaderId, teamId: customer.teamId, type: 'Liên hệ data mới', createdAt, dueAt: shiftStamp(createdAt, state.settings.slaMinutes), slaBased: true, status: 'OPEN', priority: 'HIGH' });
}

function completeTask(id) {
  const task = scopedTasks().find(item => item.id === id);
  if (!task || task.status === 'DONE') { toast('Lịch chăm sóc không tồn tại hoặc đã hoàn tất'); return; }
  task.status = 'DONE';
  task.completedAt = stamp();
  const customer = customerById(task.customerId);
  if (customer && canViewCustomer(customer)) {
    customer.updatedAt = stamp();
    customer.note = `Đã hoàn tất: ${task.type}`;
    state.notes.unshift({ id: makeRecordId('NOTE'), customerId: customer.id, authorId: currentAccount.id, author: currentAccount.name, role: currentAccount.role, text: customer.note, at: stamp() });
  }
  audit('COMPLETE_TASK', task.id, `${task.type} · ${task.customerName}`);
  saveState();
  render();
  if (customer && currentView === 'customers') openCustomerDrawer(customer.id);
  toast('Đã hoàn tất công việc và cập nhật timeline');
}

function assignSelectedPool() {
  if (!['ADMIN', 'LEADER'].includes(currentAccount.role)) { toast('FORBIDDEN · không có quyền phân data'); return; }
  const stayInDistribution = currentView === 'distribution';
  const visiblePool = new Map(scopedCustomers().filter(isPoolCustomer).map(customer => [customer.id, customer]));
  const customers = Array.from(selectedPoolIds).map(id => visiblePool.get(id)).filter(Boolean);
  if (!customers.length) { toast('Hãy chọn ít nhất một data trong phạm vi'); return; }
  const targetId = $('#poolTarget')?.value;
  const target = currentAccount.role === 'ADMIN'
    ? assignmentCandidates({ leaderId: null }).find(person => person.id === targetId)
    : assignmentCandidates({ leaderId: currentAccount.leaderId, teamId: currentAccount.teamId }).find(person => person.id === targetId);
  if (!target) { toast('Người nhận không hợp lệ hoặc nằm ngoài phạm vi'); return; }
  const reason = $('#poolReason')?.value.trim() || 'Phân bổ từ Khách mới';
  customers.forEach(customer => {
    applyCustomerAssignment(customer, target, reason);
    audit(currentAccount.role === 'ADMIN' ? 'ALLOCATE_TO_LEADER' : 'ASSIGN_TO_SALE', customer.id, `${target.name} · ${reason}`);
  });
  selectedPoolIds.clear();
  saveState();
  currentView = stayInDistribution ? 'distribution' : 'customers';
  if (stayInDistribution) distributionTab = 'QUEUE';
  render();
  toast(`Đã phân ${customers.length} data cho ${target.name}${stayInDistribution ? ' theo đúng thứ tự hàng chờ' : ' và chuyển sang Khách hàng tổng'}`);
}

function taskMatchesCustomerAssignment(task, customer) {
  return task.customerId === customer.id && task.ownerId === customer.saleId && task.leaderId === customer.leaderId && task.teamId === customer.teamId;
}

function closeOpenCustomerTasks(customer, resolution) {
  state.tasks.filter(task => task.status !== 'DONE' && taskMatchesCustomerAssignment(task, customer)).forEach(task => {
    task.status = 'DONE';
    task.completedAt = stamp();
    task.resolution = resolution;
  });
}

function reassignCustomer(id, targetId) {
  if (effectivePermissionRole() === 'MANAGER') { quickAssignSale(id, targetId); return; }
  if (!['ADMIN', 'LEADER'].includes(currentAccount.role)) { toast('FORBIDDEN · không có quyền phân khách'); return; }
  const customer = customerById(id);
  if (!canViewCustomer(customer)) { toast('NOT_FOUND · khách hàng nằm ngoài phạm vi'); return; }
  const target = currentAccount.role === 'ADMIN'
    ? assignmentCandidates({ leaderId: null }).find(person => person.id === targetId)
    : assignmentCandidates({ leaderId: currentAccount.leaderId, teamId: currentAccount.teamId }).find(person => person.id === targetId);
  if (!target) { toast('Người nhận không hợp lệ hoặc nằm ngoài phạm vi'); return; }
  const previous = assignmentSnapshot(customer);
  if (currentAccount.role === 'ADMIN') {
    if (customer.saleId && !window.confirm('Khách đang có Sale phụ trách. Chuyển Leader sẽ thu hồi khách khỏi Sale hiện tại. Tiếp tục?')) return;
    closeOpenCustomerTasks(customer, 'TRANSFERRED_TO_LEADER');
    customer.saleId = null;
    customer.leaderId = target.id;
    customer.teamId = target.teamId;
    state.notifications.unshift({ id: `NT-${Date.now()}-${customer.id}`, role: 'LEADER', leaderId: target.id, teamId: target.teamId, title: 'Khách được chuyển vào Team', text: `${customer.name} vừa được giao cho ${target.name}.`, at: new Date().toISOString(), readBy: [] });
  } else {
    closeOpenCustomerTasks(customer, 'TRANSFERRED_PENDING_ACCEPT');
    offerOrAssignSale(customer, target, `Chuyển phụ trách cho ${target.name}`, 'MANUAL', previous);
    audit('REASSIGN_CUSTOMER', customer.id, `${target.name} · ${target.teamId} · chờ sale nhận`);
    saveState(); closeDrawer(); render(); toast(`Đã gửi khách cho ${target.name} chờ nhận`);
    return;
  }
  customer.updatedAt = stamp();
  customer.note = `Chuyển phụ trách cho ${target.name}`;
  state.notes.unshift({ id: makeRecordId('NOTE'), customerId: customer.id, authorId: currentAccount.id, author: currentAccount.name, role: currentAccount.role, text: customer.note, at: stamp() });
  recordAssignmentChange(customer, previous, customer.note);
  audit('REASSIGN_CUSTOMER', customer.id, `${target.name} · ${target.teamId}`);
  saveState(); closeDrawer(); render(); toast(`Đã chuyển khách cho ${target.name}`);
}

function revokeCustomer(id) {
  if (effectivePermissionRole() === 'MANAGER') { quickAssignSale(id, ''); return; }
  if (!['ADMIN', 'LEADER'].includes(currentAccount.role)) { toast('FORBIDDEN · không có quyền thu hồi khách'); return; }
  const customer = customerById(id);
  if (!canViewCustomer(customer)) { toast('NOT_FOUND · khách hàng nằm ngoài phạm vi'); return; }
  if (!window.confirm('Thu hồi khách về Khách mới? Các lịch chăm sóc đang mở sẽ được đóng để tránh giao sai người.')) return;
  const previous = assignmentSnapshot(customer);
  closeOpenCustomerTasks(customer, 'REVOKED_TO_POOL');
  state.dataOffers.forEach(offer => { if (offer.status === 'PENDING' && offer.customerId === customer.id) { offer.status = 'EXPIRED'; offer.resolvedAt = stamp(); } });
  if (currentAccount.role === 'ADMIN') {
    customer.saleId = null;
    customer.leaderId = null;
    customer.teamId = null;
  } else {
    customer.saleId = null;
    customer.leaderId = currentAccount.leaderId;
    customer.teamId = currentAccount.teamId;
  }
  customer.updatedAt = stamp();
  customer.note = currentAccount.role === 'ADMIN' ? 'Admin thu hồi về Khách mới chung' : `Leader thu hồi về Khách mới Team ${currentAccount.teamId}`;
  state.notes.unshift({ id: makeRecordId('NOTE'), customerId: customer.id, authorId: currentAccount.id, author: currentAccount.name, role: currentAccount.role, text: customer.note, at: stamp() });
  recordAssignmentChange(customer, previous, customer.note);
  audit('REVOKE_CUSTOMER', customer.id, customer.note);
  saveState(); closeDrawer(); render(); toast('Đã thu hồi khách về Khách mới');
}

function newWebsiteModal() {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được thêm website'); return; }
  openModal('Thêm website / landing page', `<form id="newWebsiteForm"><div class="form-grid"><label class="form-field">Tên tài sản<input id="websiteName" required maxlength="200" placeholder="Landing chiến dịch"></label><label class="form-field full">URL nguồn / Landing page<input id="websiteSourceUrl" type="url" required maxlength="500" placeholder="https://www.hoangphucacademy.vn/"></label><label class="form-field full">Nguồn nhận data<select id="websiteProvider"><option value="LANDING_API">Landing API</option><option value="NOTIFICATION">Thông Báo</option></select></label></div><div class="credential-hint">Thông Báo dùng để nhận thông báo từ website khác và hiển thị trong CRM. Website mới mặc định tắt nhận data cho đến khi backend xác minh kết nối.</div><div class="modal-actions"><button class="button" type="button" data-close-modal>Huỷ</button><button class="button button-primary" type="submit">Thêm website</button></div></form>`);
  $('#newWebsiteForm').onsubmit = event => {
    event.preventDefault();
    const name = $('#websiteName').value.trim();
    const sourceUrl = cleanSourceUrl($('#websiteSourceUrl').value);
    let domain = ''; try { domain = new URL(sourceUrl).hostname.toLowerCase(); } catch {}
    if (!name || !sourceUrl || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) { toast('Tên hoặc URL nguồn chưa hợp lệ'); return; }
    if (state.websites.some(item => item.sourceUrl === sourceUrl)) { toast('URL nguồn đã tồn tại'); return; }
    const website = { id: `WEB-${Date.now()}`, name, domain, sourceUrl, status: 'PAUSED', provider: $('#websiteProvider').value, endpoint: '', externalAccountId: '', campaignId: '', formId: '', webhookSlug: generateWebhookSlug(), webhookUrlOverride: '', connectionStatus: 'UNCONFIGURED', domainVerificationStatus: 'UNVERIFIED', credentialConfigured: false, credentialLast4: '', lastVerifiedAt: '', lastError: '', lastSync: 'Chưa đồng bộ' };
    state.websites.unshift(website);
    audit('CREATE_WEBSITE', website.id, `${name} · ${sourceUrl}`);
    saveState(); closeModal(); render(); toast('Đã thêm website mới');
  };
}

function editWebsiteSourceModal(id) {
  if (currentAccount.role !== 'ADMIN') { toast('Chỉ Admin được sửa URL nguồn'); return; }
  const website = websiteById(id);
  if (!website) return;
  openModal(`URL nguồn · ${website.name}`, `<form id="websiteSourceForm"><label class="form-field full">URL nguồn / Landing page<input id="websiteSourceUrlEdit" type="url" required maxlength="500" value="${escapeHtml(website.sourceUrl || '')}" placeholder="https://www.hoangphucacademy.vn/"></label><p class="credential-hint">URL này dùng để xác định nguồn khách. URL webhook bên dưới vẫn là địa chỉ nhận dữ liệu, không thay thế URL nguồn.</p><div class="modal-actions"><button class="button" type="button" data-close-modal>Huỷ</button><button class="button button-primary" type="submit">Lưu URL nguồn</button></div></form>`);
  $('#websiteSourceForm').onsubmit = event => {
    event.preventDefault();
    const sourceUrl = cleanSourceUrl($('#websiteSourceUrlEdit').value);
    let domain = ''; try { domain = new URL(sourceUrl).hostname.toLowerCase(); } catch {}
    if (!sourceUrl || !domain) { toast('URL nguồn không hợp lệ'); return; }
    if (state.websites.some(item => item.id !== website.id && item.sourceUrl === sourceUrl)) { toast('URL nguồn đã thuộc website khác'); return; }
    website.sourceUrl = sourceUrl;
    website.domain = domain;
    audit('UPDATE_SOURCE_URL', website.id, sourceUrl);
    saveState(); closeModal(); render(); toast('Đã lưu URL nguồn');
  };
}

function copyWebhookUrl(id) {
  const website = websiteById(id);
  if (!website) return;
  const url = webhookUrlFor(website);
  if (!url) { toast('Chưa có URL webhook để sao chép'); return; }
  const done = () => toast('Đã sao chép URL webhook');
  const manual = () => {
    const field = $(`#webhookUrl-${website.id}`);
    if (!field) { toast('Không sao chép được — hãy bôi đen URL và copy thủ công'); return; }
    field.focus();
    field.select();
    field.setSelectionRange(0, url.length);
    try { document.execCommand('copy'); done(); } catch { toast('Không sao chép được — hãy bôi đen URL và copy thủ công'); }
  };
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, manual);
  else manual();
}

function generateWebhookFor(id) {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được tạo mã webhook'); return; }
  const website = websiteById(id);
  if (!website) return;
  website.webhookSlug = generateWebhookSlug();
  website.webhookUrlOverride = '';
  audit('CREATE_WEBHOOK', website.id, `Tạo mã webhook cho ${website.domain}`);
  saveState(); render(); toast('Đã tạo mã webhook mới');
}


function configureIntegrationModal(id = null) {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được cấu hình tích hợp'); return; }
  const existing = id ? state.integrations.find(item => item.id === id && !item.archived) : null;
  const item = existing || { name: '', provider: 'SUBDATA', endpoint: '', externalAccountId: '', credentialConfigured: false, credentialLast4: '' };
  const option = (value, label) => `<option value="${value}" ${item.provider === value ? 'selected' : ''}>${label}</option>`;
  openModal(existing ? `Cấu hình · ${existing.name}` : 'Thêm kết nối API', `<form id="integrationApiForm"><div class="api-config-grid"><label class="form-field">Tên kết nối<input id="integrationName" required maxlength="200" value="${escapeHtml(item.name)}" placeholder="Ví dụ: REMOVED_PAYMENT tài khoản chính"></label><label class="form-field">Provider<select id="integrationProvider">${option('SUBDATA', 'Subdata')}${option('FACEBOOK', 'Facebook Forms')}${option('CUSTOM', 'Custom API')}</select></label><label class="form-field full">API endpoint<input id="integrationEndpoint" type="url" required maxlength="500" value="${escapeHtml(item.endpoint)}" placeholder="https://api.provider.com/v1"></label><label class="form-field">Workspace / Page / Account ID<input id="integrationExternalAccount" maxlength="160" value="${escapeHtml(item.externalAccountId || '')}"></label><label class="form-field">API key / access token / webhook secret<input id="integrationCredential" type="password" autocomplete="new-password" minlength="8" placeholder="${item.credentialConfigured ? `Đã có ••••${escapeHtml(item.credentialLast4)} · để trống nếu giữ nguyên` : 'Secret do provider cấp'}"></label></div><div class="credential-hint">Secret là trường write-only. Bản frontend này chỉ giữ 4 ký tự cuối; backend production phải mã hóa bằng KMS, chống SSRF khi gọi endpoint và giới hạn quyền theo provider.</div><div class="modal-actions"><button class="button" type="button" data-close-modal>Huỷ</button><button class="button button-primary" type="submit">Lưu cấu hình</button></div></form>`);
  $('#integrationApiForm').onsubmit = event => {
    event.preventDefault();
    const name = $('#integrationName').value.trim();
    const endpoint = $('#integrationEndpoint').value.trim();
    const credential = $('#integrationCredential').value.trim();
    if (!name || !/^https:\/\/[^\s]+$/i.test(endpoint)) { toast('Tên và endpoint HTTPS là bắt buộc'); return; }
    if (!item.credentialConfigured && credential.length < 8) { toast('Credential phải có ít nhất 8 ký tự'); return; }
    const provider = $('#integrationProvider').value;
    const type = { SUBDATA: 'CUSTOMER_DATA', REMOVED_PAYMENT: 'PAYMENT', FACEBOOK: 'DATA_INTAKE', CUSTOM: 'CONNECTOR' }[provider];
    const target = existing || { id: `INT-${Date.now()}`, archived: false };
    Object.assign(target, { name, provider, type, endpoint, externalAccountId: $('#integrationExternalAccount').value.trim(), status: 'PENDING_BACKEND', lastVerifiedAt: '', lastError: 'Đã lưu metadata và 4 ký tự cuối; secret chưa được lưu vì workspace chưa có backend vault.' });
    if (credential) { target.credentialConfigured = true; target.credentialLast4 = credential.slice(-4); }
    if (!existing) state.integrations.unshift(target);
    audit('CONFIGURE_INTEGRATION', target.id, `${provider} · credential ${target.credentialConfigured ? `••••${target.credentialLast4}` : 'chưa có'}`);
    saveState(); closeModal(); render(); toast('Đã lưu metadata; cần nhập lại secret khi backend vault được triển khai');
  };
}

function pauseIntegration(id) {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được tạm dừng tích hợp'); return; }
  const item = state.integrations.find(integration => integration.id === id && !integration.archived);
  if (!item) return;
  if (item.status === 'PAUSED') { item.status = 'PENDING_BACKEND'; item.lastError = 'Yêu cầu bật lại đang chờ backend xác minh.'; }
  else { item.status = 'PAUSED'; item.lastError = 'Đã tạm dừng nhận và gửi dữ liệu.'; }
  audit('PAUSE_INTEGRATION', item.id, item.status);
  saveState(); render();
}

function archiveIntegration(id) {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được lưu trữ tích hợp'); return; }
  const item = state.integrations.find(integration => integration.id === id && !integration.archived);
  if (!item || !window.confirm(`Lưu trữ kết nối ${item.name}? Kết nối sẽ ngừng tham gia vận hành.`)) return;
  item.archived = true;
  item.status = 'PAUSED';
  audit('ARCHIVE_INTEGRATION', item.id, item.name);
  saveState(); render(); toast('Đã lưu trữ kết nối');
}

function restoreIntegration(id) {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được khôi phục tích hợp'); return; }
  const item = state.integrations.find(integration => integration.id === id && integration.archived);
  if (!item) return;
  item.archived = false;
  item.status = 'PAUSED';
  item.lastError = 'Đã khôi phục cấu hình; cần backend xác minh trước khi bật lại.';
  audit('RESTORE_INTEGRATION', item.id, item.name);
  saveState(); render(); toast('Đã khôi phục kết nối ở trạng thái tạm dừng');
}

function markNotificationRead(id = null) {
  const items = visibleNotifications().filter(item => !id || item.id === id);
  items.forEach(item => { if (!item.readBy.includes(currentAccount.id)) item.readBy.push(currentAccount.id); });
  saveState(); render();
  toast(id ? 'Đã đánh dấu thông báo là đã đọc' : 'Đã đọc tất cả thông báo');
}

function reconcileAll() {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được đối soát'); return; }
  // Đối soát gắn với cấu hình REMOVED_PAYMENT nên tạm ẩn cùng mục Tích hợp; không còn nhảy sang trang đó.
  toast('Đối soát tạm ẩn cùng mục Tích hợp.');
  return;
  // Giữ nguyên luồng cũ bên dưới để khôi phục nhanh khi mục Tích hợp mở lại.
  const REMOVED_PAYMENT = state.integrations.find(item => item.provider === 'REMOVED_PAYMENT' && !item.archived);
  if (!REMOVED_PAYMENT || REMOVED_PAYMENT.status !== 'VERIFIED') { toast('Cần cấu hình và xác minh REMOVED_PAYMENT ở backend trước khi đối soát'); if (REMOVED_PAYMENT) configureIntegrationModal(REMOVED_PAYMENT.id); return; }
  audit('REQUEST_RECONCILIATION', 'PAYMENTS', 'Chờ backend nhận job đối soát REMOVED_PAYMENT');
  saveState();
  toast('Yêu cầu đối soát cần được gửi tới backend; không tự đánh dấu giao dịch đã khớp');
}

function toggleSetting(key) {
  if (currentAccount.role !== 'ADMIN' || !['leaderCanUpdate', 'notifyMilestones', 'leaderAttendanceRequired'].includes(key)) { toast('FORBIDDEN · cài đặt không hợp lệ'); return; }
  state.settings[key] = !state.settings[key];
  audit('UPDATE_SETTING', key, state.settings[key] ? 'Bật' : 'Tắt');
  saveState(); render(); toast('Đã cập nhật cài đặt');
}

function saveSettings() {
  if (currentAccount.role !== 'ADMIN') { toast('FORBIDDEN · chỉ Admin được đổi cài đặt'); return; }
  const sla = Number($('#slaInput')?.value);
  if (!Number.isInteger(sla) || sla < 5 || sla > 1440) { toast('SLA không hợp lệ'); return; }
  state.settings.slaMinutes = sla;
  refreshTaskStatuses();
  audit('UPDATE_SETTING', 'SLA', `${sla} phút`);
  saveState(); render(); toast('Đã lưu SLA');
}

function toggleTwoFactor() { toast('Chưa cấu hình xác thực hai lớp trên máy chủ. Tính năng này hiện chưa bật.'); }
function changePasswordModal() {
  openModal('Đổi mật khẩu', `<form id="changePasswordForm"><label class="form-field">Mật khẩu hiện tại<input id="currentAdminPassword" type="password" required autocomplete="current-password"></label><label class="form-field">Mật khẩu mới<input id="newAdminPassword" type="password" minlength="8" required autocomplete="new-password"></label><label class="form-field">Nhập lại<input id="confirmAdminPassword" type="password" required></label><button class="button button-primary" type="submit">Cập nhật mật khẩu</button></form>`);
  $('#changePasswordForm').onsubmit=async event=>{
    event.preventDefault();const password=$('#newAdminPassword').value;
    if(password!==$('#confirmAdminPassword').value){toast('Mật khẩu xác nhận chưa khớp');return;}
    if(await saveAccountPassword({password,currentPassword:$('#currentAdminPassword').value})){closeModal();endSession(true);toast('Đã đổi mật khẩu. Hãy đăng nhập lại.');}
  };
}


function csvCell(value) {
  const raw = String(value ?? '');
  const safe = /^[\u0000-\u0020]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, headers, rows) {
  const lines = [headers, ...rows].map(row => row.map(csvCell).join(','));
  const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  toast(`Đã xuất ${rows.length} dòng dữ liệu`);
}

function assertCanExport() {
  if (currentAccount.role === 'SALE') { toast('FORBIDDEN · tài khoản Sale không có quyền xuất dữ liệu'); return false; }
  return true;
}

function exportCustomers() {
  if (!assertCanExport()) return;
  const query = normalize(globalQuery);
  const rows = uniqueCustomerRows(scopedCustomers()).filter(customer => customerStatusFilter === 'ALL' || customer.status === customerStatusFilter).filter(matchesCustomerOwnerFilter).filter(customer => !query || normalize(customerSearchText(customer)).includes(query));
  const fields = activeCustomFields();
  const sourceHeaders = currentAccount.role === 'ADMIN' ? ['Nguồn', 'Campaign', 'Landing page', 'Tên miền'] : [];
  const headers = ['Mã CRM', 'Họ tên', 'SĐT', 'Email', ...sourceHeaders, 'Trạng thái', 'Team', 'Leader', 'Sale', ...fields.map(field => field.label), 'Ghi chú mới nhất', 'Ngày tạo'];
  downloadCsv(`nvt-khach-hang-${currentAccount.scope.toLowerCase()}.csv`, headers, rows.map(item => {
    const website = customerLanding(item);
    const source = customerSourceDetails(item);
    const sourceValues = currentAccount.role === 'ADMIN' ? [item.source, item.campaign, source.name, source.url, source.domain] : [];
    return [item.id, item.name, item.phone, item.email, ...sourceValues, STATUS_META[item.status]?.label || item.status, item.teamId, staffName(item.leaderId), staffName(item.saleId), ...fields.map(field => customFieldValueLabel(field, item.customFields?.[field.id])), item.note, item.createdAt];
  }));
}

function exportOrders() {
  if (!assertCanExport()) return;
  const query = normalize(globalQuery);
  const rows = scopedOrders().filter(order => orderStatusFilter === 'ALL' || order.status === orderStatusFilter).filter(order => !query || normalize(`${order.code}${order.customerName}${order.productName}${order.source}`).includes(query));
  const sourceHeaders = currentAccount.role === 'ADMIN' ? ['Nguồn', 'Campaign', 'Website / Landing'] : [];
  downloadCsv(`nvt-don-hang-${currentAccount.scope.toLowerCase()}.csv`, ['Mã đơn', 'Khách hàng', 'Sản phẩm', 'SKU', 'SL', 'Giá trị', 'Trạng thái', 'Sale', ...sourceHeaders, 'Thanh toán lúc', 'Hoàn lúc'], rows.map(item => { const website = websiteById(item.websiteId); const sourceValues = currentAccount.role === 'ADMIN' ? [item.source, item.campaign, website ? `${website.name} · ${website.domain}` : 'Chưa quy nguồn'] : []; return [item.code, item.customerName, item.productName, item.sku, item.qty, item.total, ORDER_STATUS[item.status]?.[0] || item.status, staffName(item.saleId), ...sourceValues, item.paidAt, item.refundedAt]; }));
}

function exportRevenue() {
  if (!assertCanExport()) return;
  downloadCsv(`nvt-doanh-thu-${periodFileToken()}.csv`, ['Ngày', 'Doanh thu thuần', 'Doanh số gộp', 'Chiết khấu', 'Hoàn tiền', 'Lượt thanh toán', 'Sản phẩm'], dailySeries().map(item => [item.date, item.revenue, item.gross, item.discount, item.refunds, item.orders, item.units]));
}

function exportMarketing() {
  if (currentAccount.role === 'SALE') { toast('FORBIDDEN · không có quyền xuất marketing'); return; }
  const isAdmin = currentAccount.role === 'ADMIN';
  const headers = isAdmin ? ['Nguồn', 'Medium', 'Campaign', 'Sessions', 'Form gửi', 'Data CRM', 'Khách paid cohort', 'Lượt thanh toán', 'Doanh thu', 'Chi phí', 'ROAS'] : ['Nguồn', 'Medium', 'Campaign', 'Data CRM Team', 'Khách paid cohort', 'Lượt thanh toán Team', 'Doanh thu Team'];
  const rows = sourcePerformance().map(item => isAdmin ? [item.source, item.medium, item.campaign, item.sessions, item.trackedLeads, item.leads, item.convertedCustomers, item.paidOrders, item.revenue, item.spend, item.roas?.toFixed(2) || 'Organic'] : [item.source, item.medium, item.campaign, item.leads, item.convertedCustomers, item.paidOrders, item.revenue]);
  downloadCsv(`nvt-attribution-${periodFileToken()}-${currentAccount.scope.toLowerCase()}.csv`, headers, rows);
}

function exportTeam() {
  if (!assertCanExport()) return;
  downloadCsv(`nvt-hieu-suat-sale-${periodFileToken()}.csv`, ['Sale', 'Team', 'Data mới', 'Đơn thanh toán', 'Doanh thu', 'Chuyển đổi %', 'Lịch quá hạn'], salePerformanceRows().map(item => [item.name, item.teamId, item.customers, item.paid, item.revenue, item.conversion.toFixed(1), item.overdue]));
}

function exportFullReport() {
  if (!assertCanExport()) return;
  const snapshot = periodSnapshot();
  const rows = [
    ['Kinh doanh', 'Doanh thu thuần', snapshot.revenue, '', '', ''],
    ['Kinh doanh', 'Lượt thanh toán', snapshot.paid.length, '', '', ''],
    ['Kinh doanh', 'AOV', snapshot.aov, '', '', ''],
    ...productPerformance(scopedOrders()).map(item => ['Sản phẩm', item.name, item.units, item.paidOrders, item.revenue, item.refunds]),
    ...(currentAccount.role === 'ADMIN' ? sourcePerformance().map(item => ['Nguồn', item.source, item.sessions, item.leads, item.revenue, item.spend]) : []),
    ...salePerformanceRows().map(item => ['Sale', item.name, item.customers, item.paid, item.revenue, `${item.conversion.toFixed(1)}%`])
  ];
  downloadCsv(`nvt-bao-cao-${dateRange}-ngay-${currentAccount.scope.toLowerCase()}.csv`, ['Nhóm', 'Đối tượng / chỉ số', 'Sessions / SL', 'Data / Đơn', 'Doanh thu', 'Chi phí / Hoàn / Mục tiêu'], rows);
}

function openSearchDrawer(value) {
  const raw = String(value || '').trim(), query = normalize(raw);
  if (!query) { toast('Nhập từ khoá cần tìm'); return; }
  const customers = scopedCustomers().filter(item => normalize(customerSearchText(item)).includes(query)).slice(0, 6);
  const orders = scopedOrders().filter(item => normalize(`${item.code}${item.customerName}${item.productName}${item.sku}${currentAccount.role === 'ADMIN' ? item.source : ''}`).includes(query)).slice(0, 6);
  const products = currentAccount.role === 'ADMIN' ? PRODUCTS.filter(item => normalize(`${item.name}${item.sku}${item.category}`).includes(query)).slice(0, 4) : [];
  const section = (title, body) => `<div class="section-label">${title}</div>${body}`;
  openDrawer({
    head: `<h2>Kết quả tìm kiếm</h2><p>${escapeHtml(raw)} · scope ${currentAccount.scope}</p>`,
    body: `${section('Khách hàng', customers.map(item => `<button class="alert-row" style="width:100%;text-align:left" data-search-customer="${escapeHtml(item.id)}"><span class="alert-icon">♙</span><span><b>${escapeHtml(item.name)}</b><p>${escapeHtml(item.phone)}${currentAccount.role === 'ADMIN' ? ` · ${escapeHtml(item.source)}` : ''}</p></span></button>`).join('') || '<div class="cell-sub">Không có kết quả</div>')}${section('Đơn hàng', orders.map(item => `<button class="alert-row" style="width:100%;text-align:left" data-search-order="${escapeHtml(item.id)}"><span class="alert-icon">▤</span><span><b>${escapeHtml(item.code)}</b><p>${escapeHtml(item.customerName)} · ${escapeHtml(item.productName)}</p></span><strong>${money(item.total, true)}</strong></button>`).join('') || '<div class="cell-sub">Không có kết quả</div>')}${section('Sản phẩm', products.map(item => `<button class="alert-row" style="width:100%;text-align:left" data-search-product="${escapeHtml(item.id)}"><span class="alert-icon">□</span><span><b>${escapeHtml(item.name)}</b><p>${escapeHtml(item.sku)} · ${escapeHtml(item.category)}</p></span><strong>${money(item.price, true)}</strong></button>`).join('') || '<div class="cell-sub">Không có kết quả</div>')}`
  });
  $$('[data-search-customer]').forEach(button => button.onclick = () => openCustomerDrawer(button.dataset.searchCustomer));
  $$('[data-search-order]').forEach(button => button.onclick = () => openOrderDrawer(button.dataset.searchOrder));
  $$('[data-search-product]').forEach(button => button.onclick = () => { closeDrawer(); currentView = 'orders'; globalQuery = productById(button.dataset.searchProduct)?.name || ''; render(); });
}

function bindQueryInput(selector) {
  const input = $(selector);
  if (!input) return;
  input.oninput = () => { globalQuery = input.value; if (selector === '#customerSearch') customerPage = 1; };
  input.onkeydown = event => { if (event.key === 'Enter') render(); };
}

function bindViewActions() {
  $$('[data-range]').forEach(button => button.onclick = () => { const days = Number(button.dataset.range); if ([1, 7, 15, 30].includes(days)) { dateRange = days; datePreset = String(days); render(); } });
  $('#applyCustomDate')?.addEventListener('click', applyCustomDateRange);
  $$('[data-view-jump]').forEach(button => button.onclick = () => navigate(button.dataset.viewJump));
  $$('[data-team-member]').forEach(button => button.onclick = () => { customerOwnerFilter = `sale:${button.dataset.teamMember}`; navigate('customers'); });
  $$('[data-open-customer]').forEach(button => button.onclick = () => openCustomerDrawer(button.dataset.openCustomer));
  $$('[data-open-order]').forEach(button => button.onclick = () => openOrderDrawer(button.dataset.openOrder));
  $$('[data-edit-order]').forEach(button => button.onclick = () => editOrderModal(button.dataset.editOrder));
  $$('[data-delete-order]').forEach(button => button.onclick = () => deleteOrder(button.dataset.deleteOrder));
  $$('[data-delete-customer]').forEach(button => button.onclick = () => deleteCustomer(button.dataset.deleteCustomer));
  $$('[data-new-customer-product]').forEach(button => button.onclick = () => newOrderModal(button.dataset.newCustomerProduct));
  $$('[data-edit-note]').forEach(button => button.onclick = () => editCustomerNote(button.dataset.editNote));
  $$('[data-delete-note]').forEach(button => button.onclick = () => deleteCustomerNote(button.dataset.deleteNote));
  $$('[data-quick-status]').forEach(select => select.onchange = () => quickUpdateCustomerStatus(select.dataset.quickStatus, select.value));
  $$('[data-team-weight]').forEach(el=>el.onchange=()=>updateTeamRecipient(el.dataset.teamWeight,'weight',el.value));
  $$('[data-team-enabled]').forEach(el=>el.onchange=()=>updateTeamRecipient(el.dataset.teamEnabled,'enabled',el.checked));
  $$('[data-quick-sale]').forEach(select => select.onchange = () => { quickAssignSale(select.dataset.quickSale, select.value); });
  $$('[data-quick-custom-field]').forEach(select => select.onchange = () => quickUpdateCustomerField(select.dataset.quickCustomField, select.dataset.fieldId, select.value));
  $$('[data-quick-custom-checkbox]').forEach(input => input.onchange = () => quickUpdateCustomerField(input.dataset.quickCustomCheckbox, input.dataset.fieldId, input.checked));
  $$('[data-quick-multi-field]').forEach(button => button.onclick = () => quickMultiSelectModal(button.dataset.quickMultiField, button.dataset.fieldId));
  $$('[data-complete-task]').forEach(button => button.onclick = () => completeTask(button.dataset.completeTask));
  $$('[data-pool-id]').forEach(input => input.onchange = () => { input.checked ? selectedPoolIds.add(input.dataset.poolId) : selectedPoolIds.delete(input.dataset.poolId); });
  $('#selectPoolButton')?.addEventListener('click', () => { const ids = scopedCustomers().filter(isPoolCustomer).map(customer => customer.id); const allSelected = ids.every(id => selectedPoolIds.has(id)); ids.forEach(id => allSelected ? selectedPoolIds.delete(id) : selectedPoolIds.add(id)); render(); });
  $('#assignPoolButton')?.addEventListener('click', assignSelectedPool);
  $('#assignmentModeSelect')?.addEventListener('change', event => setAssignmentMode(event.target.value));
  $$('[data-bulk-distribute]').forEach(button => button.onclick = () => bulkDistributePool(button.dataset.bulkDistribute));
  $('#newCustomerButton')?.addEventListener('click', newCustomerModal);
  $('#manageCustomerFieldsButton')?.addEventListener('click', customFieldsModal);
  $('#importCustomersButton')?.addEventListener('click', customerImportModal);
  $('#importCustomersSecondaryButton')?.addEventListener('click', customerImportModal);
  $('#newOrderButton')?.addEventListener('click', newOrderModal);
  $('#btnAdminBroadcastTelegram')?.addEventListener('click', openAdminBroadcastModal);
  $('#profileAvatar')?.addEventListener('click', () => { if (currentAccount) navigate('profile'); });
  $('#profileForm')?.addEventListener('submit', event => { event.preventDefault(); const role=currentAccount.actualRole||currentAccount.role; const memberId=['ADMIN','MANAGER','MARKETING','ACCOUNTING'].includes(role)?currentAccount.id:(currentAccount.saleId||currentAccount.leaderId||currentAccount.id); const member = activeStaff().find(person => person.id === memberId); if (!member) { toast('Không tìm thấy hồ sơ để cập nhật'); return; } const name = $('#profileDisplayName').value.trim(), accountId = $('#profileAccountId')?.value.trim().toUpperCase() || '', email = $('#profileEmail')?.value.trim().toLowerCase() || '', phone = $('#profilePhone')?.value.replace(/\D/g, '') || ''; if (!name || !/^[A-Z0-9][A-Z0-9._-]{2,63}$/.test(accountId) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || (phone && !/^\d{9,15}$/.test(phone))) { toast('Họ tên, ID, email hoặc số điện thoại không hợp lệ'); return; } member.name = name; member.accountId = accountId; member.email = email; member.phone = phone; currentAccount.name = name; currentAccount.accountId = accountId; currentAccount.email = email; currentAccount.phone = phone; currentAccount.initials = name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(); member.initials = currentAccount.initials; saveState(); render(); toast('Đã lưu hồ sơ'); });
  $('#profileAvatarInput')?.addEventListener('change', event => {
    const file = event.target.files?.[0];
    const member = activeStaff().find(person => person.id === (currentAccount.actualRole === 'MANAGER' ? currentAccount.id : (currentAccount.saleId || currentAccount.leaderId)));
    if (!file || !member) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) { toast('Chỉ nhận ảnh PNG, JPG hoặc WebP'); event.target.value = ''; return; }
    if (file.size > 30 * 1024 * 1024) { toast('Ảnh avatar không được vượt quá 30 MB'); event.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSide = 640, scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        member.avatar = canvas.toDataURL('image/jpeg', 0.86);
        saveState(); render(); toast('Đã cập nhật avatar');
      };
      image.onerror = () => toast('Không đọc được ảnh avatar');
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
  $('#restoreLegacyProductsButton')?.addEventListener('click', restoreLegacyProducts);
  $('#newProductButton')?.addEventListener('click', () => productModal());
  $('#manageProductCategoriesButton')?.addEventListener('click', productCategoriesModal);
  $$('[data-edit-product]').forEach(button => button.onclick = () => productModal(button.dataset.editProduct));
  $$('[data-toggle-product]').forEach(button => button.onclick = () => toggleProduct(button.dataset.toggleProduct));
  $$('[data-delete-product]').forEach(button => button.onclick = () => deleteProduct(button.dataset.deleteProduct));
  $('#newWebsiteButton')?.addEventListener('click', newWebsiteModal);
  $$('[data-edit-source]').forEach(button => button.onclick = () => editWebsiteSourceModal(button.dataset.editSource));
  $$('[data-generate-webhook]').forEach(button => button.onclick = () => generateWebhookFor(button.dataset.generateWebhook));
  $$('[data-copy-webhook]').forEach(field => field.addEventListener('click', event => { event.preventDefault(); copyWebhookUrl(field.dataset.copyWebhook); }));
  $('[data-webhook-sync]')?.addEventListener('click', () => pullWebhookInbox(true));
  $$('[data-webhook-pending]').forEach(button => { button.onclick = () => webhookPendingModal(); });
  $('#newIntegrationButton')?.addEventListener('click', () => configureIntegrationModal());
  $$('[data-configure-integration]').forEach(button => button.onclick = () => configureIntegrationModal(button.dataset.configureIntegration));
  $$('[data-pause-integration]').forEach(button => button.onclick = () => pauseIntegration(button.dataset.pauseIntegration));
  $$('[data-archive-integration]').forEach(button => button.onclick = () => archiveIntegration(button.dataset.archiveIntegration));
  $$('[data-restore-integration]').forEach(button => button.onclick = () => restoreIntegration(button.dataset.restoreIntegration));
  $$('[data-read-notification]').forEach(button => button.onclick = () => markNotificationRead(button.dataset.readNotification));
  $('#newAnnouncementButton')?.addEventListener('click', newAnnouncementModal);
  $('#readAllButton')?.addEventListener('click', () => markNotificationRead());
  $('#reconcileAllButton')?.addEventListener('click', reconcileAll);
  $$('[data-toggle-setting]').forEach(button => button.onclick = () => toggleSetting(button.dataset.toggleSetting));
  $('#saveSettingsButton')?.addEventListener('click', saveSettings);
  $('#checkInButton')?.addEventListener('click', handleCheckInClick);
  $('#saveAttendanceSettings')?.addEventListener('click', saveAttendanceSettings);
  $$('[data-accept-offer]').forEach(button => button.onclick = () => acceptDataOffer(button.dataset.acceptOffer));
  $$('[data-attendance-detail]').forEach(button => button.onclick = () => attendanceMemberDetailModal(button.dataset.attendanceDetail));
  $$('[data-edit-attendance]').forEach(button => button.onclick = () => attendanceEditModal(button.dataset.editAttendance));
  $$('[data-delete-attendance]').forEach(button => button.onclick = () => deleteAttendanceRecord(button.dataset.deleteAttendance));
  $('#saveAppearanceButton')?.addEventListener('click', async () => { state.settings.leaderAttendanceRequired = $('#leaderAttendanceRequired')?.checked !== false; state.settings.emailNotificationsEnabled = $('#emailNotificationsEnabled')?.checked !== false; state.settings.customAccent = $('#customAccentColor').value; state.settings.fontFamily = $('#fontFamilySelect').value; applyAppearanceSettings(); saveState(); if (await flushServerPersistence()) { render(); toast('Đã lưu cấu hình'); } else toast('Chưa xác nhận lưu cấu hình. Giữ trang mở để thử lại.'); });
  $('#emailTestButton')?.addEventListener('click', sendTestEmail);
  $('#toggleTwoFactorButton')?.addEventListener('click', toggleTwoFactor);
  $('#changePasswordButton')?.addEventListener('click', changePasswordModal);
  $$('[data-edit-member]').forEach(button => button.onclick = () => teamMemberModal(button.dataset.editMember));
  $$('[data-reset-member-password]').forEach(button => button.onclick = () => resetMemberPasswordModal(button.dataset.resetMemberPassword));
  $$('[data-delete-member]').forEach(button => button.onclick = () => deleteTeamMember(button.dataset.deleteMember));
  $$('[data-promote-registration]').forEach(button => button.onclick = () => teamMemberModal(null, button.dataset.promoteRegistration));
  $$('[data-assign-account]').forEach(button => button.onclick = () => assignRegisteredAccountModal(button.dataset.assignAccount));
  $('#exportCustomersButton')?.addEventListener('click', exportCustomers);
  $('#exportOrdersButton')?.addEventListener('click', exportOrders);
  $('#exportRevenueButton')?.addEventListener('click', exportRevenue);
  $('#exportMarketingButton')?.addEventListener('click', exportMarketing);
  $('#exportTeamButton')?.addEventListener('click', exportTeam);
  $('#exportReportButton')?.addEventListener('click', exportFullReport);
  bindQueryInput('#customerSearch');
  bindQueryInput('#orderSearch');
  $('#customerStatusFilter')?.addEventListener('change', event => { customerStatusFilter = event.target.value; customerPage = 1; render(); });
  $('#customerOwnerFilter')?.addEventListener('change', event => { customerOwnerFilter = event.target.value; customerPage = 1; render(); });
  $('#customerPageSize')?.addEventListener('change', event => { customerPageSize = [10, 20].includes(Number(event.target.value)) ? Number(event.target.value) : 20; customerPage = 1; render(); });
  $$('[data-customer-page]').forEach(button => button.onclick = () => { const direction = button.dataset.customerPage === 'next' ? 1 : -1; customerPage += direction; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('#orderStatusFilter')?.addEventListener('change', event => { orderStatusFilter = event.target.value; render(); });
  $$('[data-distribution-tab]').forEach(button => button.onclick = () => { distributionTab = button.dataset.distributionTab; render(); });
  $('#toggleLeaderDistribution')?.addEventListener('click', toggleLeaderDistribution);
  $$('[data-distribution-member]').forEach(input => input.onchange = () => { const [kind, id] = input.dataset.distributionMember.split(':'); updateDistributionMember(kind, id, input.checked); });
  $$('[data-distribution-weight]').forEach(input => input.onchange = () => { const [kind, id] = input.dataset.distributionWeight.split(':'); updateDistributionWeight(kind, id, input.value); });
  $('#distributionLeaderSelect')?.addEventListener('change', event => { distributionLeaderId = event.target.value; render(); });
  $('#distributionSourceRuleForm')?.addEventListener('submit', event => { event.preventDefault(); addDistributionSourceRule(); });
  $$('[data-toggle-source-rule]').forEach(button => button.onclick = () => toggleDistributionSourceRule(button.dataset.toggleSourceRule));
  $$('[data-delete-source-rule]').forEach(button => button.onclick = () => deleteDistributionSourceRule(button.dataset.deleteSourceRule));
}

function updateLoginTwoFactorField() {
  $('#loginOtpField')?.classList.add('is-hidden');
  if($('#loginOtp'))$('#loginOtp').value='';
}

function renderAccountCards(selectedId = null) {
  const cards = $('#accountCards');
  if (cards) cards.innerHTML = '';
}

function switchAuthMode(mode) {
  const registering = mode === 'register';
  const loginForm = $('#loginForm');
  const registerForm = $('#registerForm');
  // Đồng bộ class, thuộc tính hidden và inline style để tránh
  // stylesheet cũ hiển thị đồng thời hai form sau khi F5.
  if (loginForm) {
    loginForm.classList.toggle('is-hidden', registering);
    loginForm.hidden = registering;
    loginForm.style.display = registering ? 'none' : 'flex';
    loginForm.setAttribute('aria-hidden', String(registering));
  }
  if (registerForm) {
    registerForm.classList.toggle('is-hidden', !registering);
    registerForm.hidden = !registering;
    registerForm.style.display = registering ? 'flex' : 'none';
    registerForm.setAttribute('aria-hidden', String(!registering));
  }
  $('#loginTab')?.classList.toggle('active', !registering);
  $('#registerTab')?.classList.toggle('active', registering);
  $('#loginTab')?.setAttribute('aria-selected', String(!registering));
  $('#registerTab')?.setAttribute('aria-selected', String(registering));
  const heading = $('.login-card h2');
  const description = $('#authDescription');
  if (heading) heading.textContent = registering ? 'ĐĂNG KÝ TÀI KHOẢN' : 'ĐĂNG NHẬP NVT AGENCY';
  if (description) description.textContent = registering ? 'TẠO TÀI KHOẢN NVT AGENCY ĐỂ TRUY CẬP HỆ THỐNG NỘI BỘ.' : 'ĐĂNG NHẬP ĐỂ TRUY CẬP HỆ THỐNG NỘI BỘ.';
  if (registering) $('#registerPhone')?.focus(); else $('#loginPhone')?.focus();
}

async function submitRegistration() {
  const name = ($('#registerName')?.value || '').trim();
  const accountId = ($('#registerAccountId')?.value || '').trim().toUpperCase();
  const phone = $('#registerPhone')?.value.replace(/\D/g, '') || '';
  const email = ($('#registerEmail')?.value || '').trim().toLowerCase();
  const password = $('#registerPassword')?.value || '';
  const confirm = $('#registerPasswordConfirm')?.value || '';
  const message = $('#registerMessage');
  if (!name || !/^[A-Z0-9][A-Z0-9._-]{2,63}$/.test(accountId) || !/^\d{9,15}$/.test(phone) || !/^[^\s@]+@gmail\.com$/i.test(email) || password.length < 8 || password !== confirm) {
    if (message) { message.className = 'nvt-auth-error-msg form-message error full'; message.textContent = 'Vui lòng nhập họ tên, ID tài khoản hợp lệ, số điện thoại, Gmail và mật khẩu tối thiểu 8 ký tự.'; }
    return;
  }
  let id = `u-reg-${Date.now()}`;
  const base = webhookApiBase();
  if (!base) {
    if (message) { message.className = 'form-message error full'; message.textContent = 'CRM chưa kết nối server. Hãy mở bằng node webhook-server.cjs, không dùng python -m http.server.'; }
    return;
  }
  try {
    const response = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ phone, email, password, name, accountId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (message) { message.className = 'form-message error full'; message.textContent = payload.error || `Server đăng ký lỗi HTTP ${response.status}`; }
      return;
    }
    if (payload.id) id = payload.id;
  } catch (error) {
    if (message) { message.className = 'form-message error full'; message.textContent = 'Không kết nối được server. Hãy chạy node webhook-server.cjs rồi tải lại trang.'; }
    return;
  }


  $('#registerForm')?.reset();
  switchAuthMode('login');
  $('#loginPhone').value = phone;
  $('#loginPassword').value = password;
  const loginMessage = $('#loginError');
  if (loginMessage) {
    loginMessage.className = 'form-error form-message success';
    loginMessage.textContent = 'Đăng ký thành công. Vui lòng đăng nhập để sử dụng hệ thống.';
  }
}

async function startSession(account, restored = false, token = serverSyncToken, initialSnapshot = null) {
  serverSyncToken=token;serverStateLoaded=false;serverConflict=false;serverPendingRequest=null;liveNavigationCounts=null;
  state=initialState();
  currentAccount = hydrateSessionAccount(account);
  currentView = 'dashboard';
  dateRange = 7;
  datePreset = '7';
  customDateStart = dayIso(6);
  customDateEnd = dayIso(0);
  orderStatusFilter = 'ALL';
  customerStatusFilter = 'ALL';
  customerPage = 1;
  globalQuery = '';
  selectedPoolIds.clear();
  customerOwnerFilter = 'ALL';
  writeRuntimeSession({ token: serverSyncToken, accountId: currentAccount.id, role: currentAccount.actualRole || currentAccount.role });
  // Dựng dữ liệu đã xác thực trước; việc gửi lại bản nháp không được giữ màn hình tải.
  serverRecoveryPending=true;
  if(initialSnapshot?.state){
    applyServerSnapshot(initialSnapshot);
    try{if(window.parent&&window.parent!==window)window.parent.dispatchEvent(new Event('crm:session-changed'));}catch{}
  }
  try {
    const recovered=await recoverPendingWrite(account);
    if(recovered)initialSnapshot=recovered;
  } catch(error) {
    // Keep the draft, but do not block authenticated read access or overwrite conflicts.
    serverConflict=true;
    setSaveStatus(error.message,true);
  } finally { serverRecoveryPending=false; }
  if(initialSnapshot&&initialSnapshot.state){applyServerSnapshot(initialSnapshot);} else if(!await syncServerState()){
    // Không xóa token khi MySQL hoặc mạng lỗi tạm thời; initialize() sẽ thử khôi phục lại.
    $('#appShell').classList.add('is-hidden');
    $('#loginScreen').classList.remove('is-hidden');
    $('#loginError').textContent='Chưa tải được dữ liệu máy chủ. Đang giữ phiên để thử lại.';
    currentAccount=null;
    return false;
  }
  // Tài khoản cũ chưa có ID hiển thị được đưa thẳng đến Hồ sơ để bổ sung, không đổi users.id nội bộ.
  if((['SALE','LEADER'].includes(currentAccount.role)||currentAccount.actualRole==='MANAGER')&&!currentAccount.accountId)currentView='profile';
  $('#loginScreen').classList.add('is-hidden');$('#appShell').classList.remove('is-hidden');
  try { if (window.parent && window.parent !== window) window.parent.dispatchEvent(new Event('crm:session-changed')); } catch (error) {}
  // Giao diện ngoài tự dựng snapshot; không dựng thêm dashboard trong iframe ẩn.
  if (!(window.parent && window.parent !== window && window.crmApi)) render();
  startWebhookConsumer();
  startServerSyncPolling();
  refreshNavigationCounts();
  return true;
}

async function endSession(skipFlush=false) {
  if(!skipFlush&&serverStateLoaded&&(hasServerChanges()||serverPendingRequest)&&!await flushServerPersistence()){toast('Chưa lưu xong. Hãy xuất bản nháp trước khi đăng xuất.');return;}
  stopWebhookConsumer();
  stopServerSyncPolling();
  const logoutToken=serverSyncToken;
  if(logoutToken)fetch(`${webhookApiBase()}/api/auth/logout`,{method:'POST',headers:{Authorization:`Bearer ${logoutToken}`}}).catch(()=>{});
  serverSyncToken = '';
  window.crmRuntimeAuthState = 'unauthenticated';
  liveNavigationCounts = null;
  serverStateLoaded = false; clearTimeout(serverSaveTimer); serverSaveTimer = null;

  currentAccount = null;
  currentView = 'dashboard';
  selectedPoolIds.clear();
  customerOwnerFilter = 'ALL';
  removeRuntimeSession();
  try { if (window.parent && window.parent !== window) window.parent.dispatchEvent(new Event('crm:session-changed')); } catch (error) {}
  closeDrawer(); closeModal();
  $('#appShell').classList.add('is-hidden');
  $('#loginScreen').classList.remove('is-hidden');
  $('#loginPassword').value = '';
  $('#loginOtp').value = '';
  $('#loginError').textContent = '';
  renderAccountCards();
  updateLoginTwoFactorField();
  $('#loginPhone').focus();
}

function trapFocus(container, event) {
  const focusable = Array.from(container.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]'));
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function bindGlobalActions() {
  // Luôn mở form đăng nhập trước khi xác thực phiên.
  switchAuthMode('login');
  $('#loginTab')?.addEventListener('click', () => switchAuthMode('login'));
  $('#registerTab')?.addEventListener('click', () => switchAuthMode('register'));
  $$('[data-switch-auth]').forEach(button => button.addEventListener('click', () => switchAuthMode(button.dataset.switchAuth)));
  $$('[data-toggle-password]').forEach(button => button.addEventListener('click', () => {
    const input = $(`#${button.dataset.togglePassword}`);
    if (!input) return;
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    button.innerHTML = visible ? '<svg class="password-eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>' : '<svg class="password-eye password-eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"></path><path d="M10.6 6.9A10.8 10.8 0 0 1 12 6.8c6 0 9.5 5.2 9.5 5.2a17 17 0 0 1-3.2 3.5M6.2 6.5C3.8 8.1 2.5 12 2.5 12s3.5 5.2 9.5 5.2c1.2 0 2.3-.2 3.3-.6"></path><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path></svg>';
    button.setAttribute('aria-label', visible ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
    button.setAttribute('title', visible ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
  }));
  $('#forgotPasswordButton')?.addEventListener('click', () => { $('#loginError').textContent = 'Vui lòng liên hệ Admin để cấp lại mật khẩu.'; });
  $('#loginForm').onsubmit = async event => {
    event.preventDefault();
    const submitButton = $('#loginForm button[type="submit"]');
    if (submitButton?.disabled) return;
    const identifier = $('#loginPhone').value.trim(), phone = identifier.replace(/\D/g, ''), email = identifier.toLowerCase(), password = $('#loginPassword').value;
    const base = webhookApiBase();
    const originalButtonText = submitButton?.innerHTML || '';
    const setLoginError = (text, success = false) => {
      const node = $('#loginError');
      if (!node) return;
      node.className = success ? 'nvt-auth-success-msg form-error form-message success' : 'nvt-auth-error-msg form-error';
      node.textContent = text;
    };
    const restoreSubmitButton = () => {
      if (!submitButton) return;
      submitButton.disabled = false;
      submitButton.setAttribute('aria-busy', 'false');
      submitButton.innerHTML = originalButtonText;
    };
    if (!( /^\d{9,15}$/.test(phone) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ) || !password) {
      setLoginError('Vui lòng nhập số điện thoại hợp lệ và mật khẩu.');
      (!identifier ? $('#loginPhone') : $('#loginPassword'))?.focus();
      return;
    }
    setLoginError('');
    if (submitButton) { submitButton.disabled = true; submitButton.setAttribute('aria-busy', 'true'); submitButton.innerHTML = '<span class="login-spinner" aria-hidden="true"></span>Đang đăng nhập...'; }
    if (base) {
      try {
        let response, payload;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const controller = typeof AbortController === 'function' ? new AbortController() : null;
          const timer = controller ? setTimeout(() => controller.abort(), WEBHOOK_FETCH_TIMEOUT_MS) : null;
          try {
            response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ identifier: /^\d{9,15}$/.test(phone) ? phone : email, password }), signal: controller ? controller.signal : undefined });
            payload = await response.json().catch(error => { if (error?.name === 'AbortError') throw error; return {}; });
          } catch (error) {
            if (attempt === 0 && (error?.name === 'AbortError' || error instanceof TypeError)) {
              setLoginError('Máy chủ vừa khởi động lại, đang kết nối lần nữa...');
              continue;
            }
            throw error;
          } finally { if (timer) clearTimeout(timer); }
          if (response.status === 503 && attempt === 0) {
            setLoginError('Máy chủ đang khởi tạo kết nối, đang thử lại...');
            continue;
          }
          break;
        }
        if (response.ok && payload.user) {
          await startSession(payload.user, false, payload.token);
          restoreSubmitButton();
          return;
        }
        setLoginError(payload.error || `Đăng nhập thất bại (HTTP ${response.status}). Kiểm tra ứng dụng Node và MySQL.`);
        restoreSubmitButton();
        return;
      } catch (error) {
        console.error('[CRM login]', error);
        setLoginError(error?.name === 'AbortError'
          ? 'Máy chủ phản hồi quá lâu. Node hoặc MySQL có thể đang khởi động, hãy bấm Đăng nhập lại.'
          : 'Không kết nối được máy chủ Node. Hãy kiểm tra Node.js App và đường dẫn /api trên cPanel.');
        restoreSubmitButton();
        return;
      }

    }
    setLoginError('Cần kết nối server để đăng nhập và lưu dữ liệu.');
    restoreSubmitButton();
  };
  $('#registerForm')?.addEventListener('submit', event => { event.preventDefault(); submitRegistration(); });
  $('#loginPhone').oninput = updateLoginTwoFactorField;
  $('#logoutButton').onclick = async () => { if (serverStateLoaded && hasServerChanges() && !await flushServerPersistence()) return; endSession(); };
  window.addEventListener('beforeunload', event => { if (serverSaveRunning || (serverStateLoaded && hasServerChanges())) { event.preventDefault(); event.returnValue = ''; } });
  // Có mạng lại: lưu ngay phần còn chờ thay vì đợi vòng đồng bộ 15 giây.
  window.addEventListener('online', () => { if (serverStateLoaded && !serverSaveRunning && (serverPendingRequest || hasServerChanges())) scheduleServerPersistence(); });
  $('#notificationButton').onclick = () => navigate('notifications');
  $('#menuButton').onclick = () => $('#sidebar').classList.toggle('open');
  $('#themeButton').onclick = () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch (error) {}
  };
  $('#globalSearch').onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); openSearchDrawer(event.target.value); }
  };
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && currentAccount) { event.preventDefault(); $('#globalSearch').focus(); }
    if (event.key === 'Escape') { if ($('#modalRoot').children.length) closeModal(); else if ($('#drawerRoot').children.length) closeDrawer(); else $('#sidebar').classList.remove('open'); }
    if (event.key === 'Tab') { const modal = $('.modal'); const drawer = $('.drawer'); if (modal) trapFocus(modal, event); else if (drawer) trapFocus(drawer, event); }
  });

}

/* Keep credential records and personnel profiles aligned. The member profile is
   the durable source of display identity for Sale and Leader sessions. */
function linkedAccountForMember(member) {
  if (!member) return null;
  return [...ACCOUNTS, ...(state.registeredAccounts || [])].find(account =>
    account.memberId === member.id || account.saleId === member.id || account.leaderId === member.id
  ) || null;
}

function synchronizeAccountIdentity(member) {
  const account = linkedAccountForMember(member);
  if (!account) return;
  account.name = member.name;
  account.accountId = member.accountId || account.accountId || '';
    account.email = member.email || account.email || '';
    account.phone = member.phone || account.phone || '';
  account.initials = member.initials;
  account.teamId = member.teamId;
  account.memberId = member.id;
  if (member.role === 'SALE') {
    account.role = 'SALE';
    account.scope = 'OWN';
    account.saleId = member.id;
    account.leaderId = member.leaderId;
  } else {
    account.role = 'LEADER';
    account.scope = 'TEAM';
    account.leaderId = member.id;
    account.saleId = null;
  }
  if (currentAccount?.id === account.id) Object.assign(currentAccount, account);
}

let managerTeamSelection=null;
function hydrateSessionAccount(account) {
  // Manager dùng bộ thao tác Leader, nhưng giữ nguyên ID/role thật cho API và nhật ký.
  if(account.role==='MANAGER'||account.actualRole==='MANAGER'){
    const leaders=state.members.filter(m=>m.role==='LEADER'&&m.active!==false&&m.managerId===account.id);
    const leader=leaders.find(m=>m.id===managerTeamSelection)||leaders[0];managerTeamSelection=leader?.id||null;
    const manager=state.members.find(m=>m.id===account.id);
    return {...account,role:'LEADER',actualRole:'MANAGER',scope:'TEAM',saleId:null,leaderId:leader?.id||null,teamId:leader?.teamId||'',name:manager?.name||account.name,accountId:manager?.accountId||account.accountId||'',email:manager?.email||account.email||'',phone:manager?.phone||account.phone||'',initials:memberInitials(manager?.name||account.name)};
  }
  const session = { ...account, initials: memberInitials(account.name), scope: ['ADMIN', 'MARKETING', 'ACCOUNTING', 'HRM'].includes(account.role) ? 'ALL' : account.role === 'LEADER' ? 'TEAM' : account.role === 'SALE' ? 'OWN' : 'NONE', saleId: account.role === 'SALE' ? account.id : null, leaderId: account.role === 'LEADER' ? account.id : account.leaderId };
  const member = state.members.find(r=>r.id===account.id);
  if (member) {
    session.name = member.name;
    session.accountId = member.accountId || account.accountId || '';
    session.email = member.email || account.email || '';
    session.phone = member.phone || account.phone || '';
    session.initials = member.initials;
    session.teamId = member.teamId;
    session.memberId = member.id;
    if (member.role === 'SALE') {
      session.role = 'SALE';
      session.scope = 'OWN';
      session.saleId = member.id;
      session.leaderId = member.leaderId;
    } else if (member.role === 'LEADER') {
      session.role = 'LEADER';
      session.scope = 'TEAM';
      session.leaderId = member.id;
      session.saleId = null;
    } else if (member.role === 'ADMIN') {
      session.role = 'ADMIN';
      session.scope = 'ALL';
      session.saleId = null;
      session.leaderId = null;
    }
  }
  $$('#drawerRoot .section-label').forEach(label => {
    if (label.textContent.trim() === 'Audit') { label.hidden = true; label.nextElementSibling?.setAttribute('hidden', ''); }
  });
  return session;
}

const baseSettingsView = settingsView;
// Giao diện hồ sơ dùng chung cho mọi vai trò.
VIEW_RENDERERS.profile = function profileViewModern() {
  const role = currentAccount.actualRole || currentAccount.role;
  const memberId = ['ADMIN', 'MANAGER', 'MARKETING', 'ACCOUNTING'].includes(role)
    ? currentAccount.id
    : (currentAccount.saleId || currentAccount.leaderId || currentAccount.id);
  const member = activeStaff().find(person => person.id === memberId);
  const name = member?.name || currentAccount.name || '';
  const initials = member?.initials || currentAccount.initials || 'NVT';
  const avatar = member?.avatar
    ? `<img class="profile-avatar-large profile-avatar-image" src="${escapeHtml(member.avatar)}" alt="Avatar của ${escapeHtml(name)}">`
    : `<span class="profile-avatar-large profile-avatar-placeholder">${escapeHtml(initials)}</span>`;
  const roleLabel = role || 'UNASSIGNED';
  return pageHead('Hồ sơ cá nhân', 'Cập nhật thông tin hiển thị trong toàn bộ hệ thống CRM.', '') + `
    <section class="panel profile-panel">
      <div class="panel-body profile-panel-body">
        <form id="profileForm">
          <div class="profile-hero">
            <div class="profile-avatar-wrap"><div class="profile-avatar-stage">${avatar}</div></div>
            <div class="profile-hero-actions"><label class="button button-primary button-small profile-upload-button" for="profileAvatarInput">&#272;&#7893;i avatar</label><input id="profileAvatarInput" type="file" accept="image/png,image/jpeg,image/webp" class="is-hidden"></div>
          </div>
          <div class="profile-fields">
            <label class="form-field"><span>👤 Họ và tên <em>*</em></span><div class="profile-input-wrap"><span aria-hidden="true">👤</span><input id="profileDisplayName" maxlength="160" value="${escapeHtml(name)}" autocomplete="name" required></div></label>
            <label class="form-field"><span>🔗 ID tài khoản <em>*</em></span><div class="profile-input-wrap"><span aria-hidden="true">🔗</span><input id="profileAccountId" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,63}" value="${escapeHtml(currentAccount.accountId || member?.accountId || '')}" placeholder="Nhập ID tài khoản" autocomplete="off" required></div></label>
            <label class="form-field"><span>✉ Email</span><div class="profile-input-wrap"><span aria-hidden="true">✉</span><input id="profileEmail" type="email" maxlength="254" value="${escapeHtml(member?.email || currentAccount.email || '')}" placeholder="Nhập email" autocomplete="email"></div></label>
            <label class="form-field"><span>☎ Số điện thoại</span><div class="profile-input-wrap"><span aria-hidden="true">☎</span><input id="profilePhone" type="tel" inputmode="numeric" maxlength="15" value="${escapeHtml(member?.phone || currentAccount.phone || '')}" placeholder="Nhập số điện thoại" autocomplete="tel"></div></label>
          </div>
          <div class="profile-security-note"><span aria-hidden="true">🔒</span><div><strong>Bảo mật tài khoản</strong><small>Đổi mật khẩu được thực hiện ở mục riêng trong hồ sơ.</small></div></div>
          <div class="modal-actions profile-actions"><button class="button button-primary" type="submit">Lưu hồ sơ</button></div>
          <section class="profile-security-note" aria-labelledby="telegramLinkTitle"><span aria-hidden="true">LINK</span><div><strong id="telegramLinkTitle">Liên kết Telegram</strong><small data-telegram-link-status>Đang kiểm tra trạng thái liên kết...</small><div class="modal-actions" style="margin-top:10px"><button class="button button-small button-primary" type="button" data-telegram-link>Tạo mã liên kết</button><button class="button button-small button-danger is-hidden" type="button" data-telegram-unlink>Hủy liên kết</button><a class="button button-small is-hidden" data-telegram-open target="_blank" rel="noopener noreferrer">Mở bot Telegram</a></div><small data-telegram-link-expiry></small></div></section>
        </form>
      </div>
    </section>`;
};
VIEW_RENDERERS.settings = function settingsViewWithTypographyControls() {
  return baseSettingsView();
};

const baseTeamView = teamView;
VIEW_RENDERERS.team = function teamViewWithRegisteredAccounts() {
  return baseTeamView().replace('Tài khoản chưa phân chức vụ', 'Tài khoản đăng ký chờ phân chức vụ');
};

const baseBindViewActions = bindViewActions;
function bindCustomerDeleteButtons() {
  if (currentAccount?.role !== 'ADMIN') return;
  $$('#content tr').forEach(row => {
    if (row.querySelector('[data-delete-customer]')) return;
    const source = row.querySelector('[data-open-customer], [data-quick-sale], [data-pool-id]');
    const id = source?.dataset.openCustomer || source?.dataset.quickSale || source?.dataset.poolId;
    if (!id) return;
    const cell = row.lastElementChild;
    if (!cell) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'button button-small button-danger';
    button.dataset.deleteCustomer = id; button.textContent = 'Xóa data';
    button.onclick = () => deleteCustomer(id);
    cell.append(' ', button);
  });
}
bindViewActions = function bindViewActionsWithProfileAndTypography() {
  baseBindViewActions();
  bindCustomerDeleteButtons();
  const bindFontSize = (inputId, outputId, settingKey) => {
    const input = $(`#${inputId}`);
    const output = $(`#${outputId}`);
    if (!input) return;
    const update = persist => {
      state.settings[settingKey] = Number(input.value);
      if (output) output.textContent = `${input.value}px`;
      applyAppearanceSettings();
      if (persist) saveState();
    };
    input.addEventListener('input', () => update(false));
    input.addEventListener('change', () => update(true));
  };
  // Đồng bộ ô màu và xem trước ngay; nút Lưu cấu hình gửi lên server.
  const accentPicker = $('#customAccentColor');
  const accentSelect = $('#themeColorSelect');
  if (accentSelect) accentSelect.onchange = () => { accentPicker.value = accentSelect.value; state.settings.customAccent = accentSelect.value; applyAppearanceSettings(); };
  if (accentPicker) accentPicker.oninput = () => { state.settings.customAccent = accentPicker.value; if (accentSelect) accentSelect.value = accentPicker.value; applyAppearanceSettings(); };
  $('#fontFamilySelect')?.addEventListener('change', event => { state.settings.fontFamily = event.target.value; applyAppearanceSettings(); });
  bindFontSize('navigationFontSize', 'navigationFontSizeValue', 'navigationFontSize');
  bindFontSize('contentFontSize', 'contentFontSizeValue', 'contentFontSize');
  $('#profileForm')?.addEventListener('submit', () => {
    const member = activeStaff().find(person => person.id === (currentAccount.actualRole==='MANAGER'?currentAccount.id:(currentAccount.saleId || currentAccount.leaderId)));
    if (member) { synchronizeAccountIdentity(member); saveState(); }
  });
  const linkStatus=$('[data-telegram-link-status]'),linkButton=$('[data-telegram-link]'),unlinkButton=$('[data-telegram-unlink]'),openBot=$('[data-telegram-open]'),expiry=$('[data-telegram-link-expiry]');
  const telegramRequest=async(path,method='GET')=>{
    const response=await fetch(webhookApiBase()+path,{method,headers:{Authorization:'Bearer '+serverSyncToken,'Content-Type':'application/json'},cache:'no-store'});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'Không thực hiện được thao tác Telegram.');
    return result;
  };
  if(linkStatus&&serverSyncToken){
    telegramRequest('/api/telegram/link-status').then(result=>{
      linkStatus.textContent=result.linked?'Telegram đang được liên kết với hồ sơ này.':'Chưa liên kết Telegram.';
      linkButton.classList.toggle('is-hidden',result.linked);unlinkButton.classList.toggle('is-hidden',!result.linked);
    }).catch(error=>{linkStatus.textContent=error.message;});
    linkButton.onclick=async()=>{linkButton.disabled=true;try{const result=await telegramRequest('/api/telegram/link-code','POST');openBot.href=result.url;openBot.classList.remove('is-hidden');expiry.textContent='Mã dùng một lần, hết hạn sau 5 phút. Mở bot để hoàn tất liên kết.';linkStatus.textContent='Đang chờ bạn xác nhận trên Telegram.';}catch(error){toast(error.message);}finally{linkButton.disabled=false;}};
    unlinkButton.onclick=async()=>{if(!confirm('Hủy liên kết Telegram của tài khoản này?'))return;unlinkButton.disabled=true;try{await telegramRequest('/api/telegram/unlink','POST');linkStatus.textContent='Đã hủy liên kết Telegram.';unlinkButton.classList.add('is-hidden');linkButton.classList.remove('is-hidden');openBot.classList.add('is-hidden');expiry.textContent='';}catch(error){toast(error.message);}finally{unlinkButton.disabled=false;}};
  }
};

const baseSaveTeamMember = saveTeamMember;
saveTeamMember = function saveTeamMemberWithIdentitySync(id = null, registrationId = null) {
  const result = baseSaveTeamMember(id, registrationId);
  const member = id ? state.members.find(item => item.id === id) : null;
  if (member) { synchronizeAccountIdentity(member); saveState(); }
  return result;
};

let offerSweepTimer = null;
// The outer index page waits for this before choosing login or the CRM shell.
window.crmRuntimeBooted = false;
window.crmRuntimeAuthState = 'restoring';

let runtimeRestorePromise=null, runtimeRestoreTimer=null, runtimeRestoreAttempts=0;
function notifyRuntimeReady(){
  window.crmRuntimeBooted=true;
  try{if(window.parent&&window.parent!==window)window.parent.dispatchEvent(new Event('crm:session-changed'));}catch{}
}
function restoreRuntimeSession(){
  if(runtimeRestorePromise)return runtimeRestorePromise;
  clearTimeout(runtimeRestoreTimer);runtimeRestoreTimer=null;
  runtimeRestorePromise=(async()=>{
    let session=null;
    for(const storage of [sessionStorage,localStorage]){
      if(session?.token)break;
      try{session=JSON.parse(storage.getItem(SESSION_KEY)||'null');}catch{}
    }
    window.crmRuntimeRestoreError='';
    if(!session?.token){
      window.crmRuntimeAuthState='unauthenticated';
      $('#loginScreen').classList.remove('is-hidden');$('#appShell').classList.add('is-hidden');
      return false;
    }
    const token=session.token;serverSyncToken=token;window.crmRuntimeAuthState='restoring';
    const controller=typeof AbortController==='function'?new AbortController():null;
    const timer=controller?setTimeout(()=>controller.abort(),25000):null;
    try{
      // Mỗi lượt chỉ có một request; lỗi tạm thời được thử lại nền, không khóa màn hình 3 lần liên tiếp.
      const response=await fetch(webhookApiBase()+'/api/state?passive=1',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:controller?.signal});
      const snapshot=response.ok?await response.json():null;
      if(serverSyncToken!==token)return false;
      if(response.status===401){
        serverSyncToken='';removeRuntimeSession();window.crmRuntimeAuthState='unauthenticated';
        $('#loginScreen').classList.remove('is-hidden');$('#appShell').classList.add('is-hidden');return false;
      }
      if(!response.ok||!snapshot?.user||!snapshot?.state)throw Error('Không tải được dữ liệu máy chủ');
      clearTimeout(timer);
      if(!await startSession(snapshot.user,true,token,snapshot))throw Error('Chưa khôi phục được phiên đăng nhập');
      window.crmRuntimeAuthState='authenticated';runtimeRestoreAttempts=0;return true;
    }catch(error){
      if(serverSyncToken!==token)return false;
      window.crmRuntimeAuthState='restoring';
      window.crmRuntimeRestoreError='Chưa kết nối được máy chủ. Phiên đăng nhập và bản nháp vẫn được giữ. Hệ thống sẽ tự thử lại.';
      $('#loginError').textContent=window.crmRuntimeRestoreError;
      const delay=Math.min(30000,3000*Math.pow(2,Math.min(runtimeRestoreAttempts++,3)));
      runtimeRestoreTimer=setTimeout(()=>{void restoreRuntimeSession();},delay);
      return false;
    }finally{if(timer)clearTimeout(timer);}
  })();
  runtimeRestorePromise=runtimeRestorePromise.finally(()=>{runtimeRestorePromise=null;notifyRuntimeReady();});
  return runtimeRestorePromise;
}
window.crmRetrySessionRestore=()=>restoreRuntimeSession();
async function initialize() {
  try {
    let theme='light';
    try{theme=localStorage.getItem(THEME_KEY)||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch{}
    document.documentElement.dataset.theme=theme;
    renderAccountCards();bindGlobalActions();updateLoginTwoFactorField();
    expireStaleOffers();
    if(!offerSweepTimer)offerSweepTimer=setInterval(()=>expireStaleOffers(),60000);
    void refreshSessionContext();
    await restoreRuntimeSession();
  }finally{notifyRuntimeReady();}
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
else initialize();
