/* marketing-hub.js - NVT Agency CRM Marketing Intelligence & Customer Persona Hub
 * Cung cấp bộ máy phân tích dữ liệu chuyên sâu và giao diện dành riêng cho tài khoản MARKETING
 * Chuẩn hóa 5 tiêu chí:
 * 1. Phân loại Kết nối / Không kết nối / Chưa gọi
 * 2. Chân dung khách hàng (Customer Persona) với chỉ số so sánh ▲▼ so với trung bình
 * 3. Content & Quảng cáo hiệu quả (CPL kết nối, ROI)
 * 4. Facebook Nhân khẩu học
 * 5. Sinh insight thống kê từ dữ liệu CRM
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarketingHub = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Danh mục 34 tỉnh/thành phố mới (sau sáp nhập 2025 theo đặc tả)
  const PROVINCES_34 = [
    'Hà Nội', 'Hải Phòng', 'Huế', 'Đà Nẵng', 'TP. Hồ Chí Minh', 'Cần Thơ',
    'An Giang', 'Bắc Ninh', 'Cà Mau', 'Cao Bằng', 'Đắk Lắk', 'Điện Biên',
    'Đồng Nai', 'Đồng Tháp', 'Gia Lai', 'Hà Tĩnh', 'Hưng Yên', 'Khánh Hòa',
    'Lai Châu', 'Lâm Đồng', 'Lạng Sơn', 'Lào Cai', 'Nghệ An', 'Ninh Bình',
    'Phú Thọ', 'Quảng Ninh', 'Quảng Ngãi', 'Quảng Trị', 'Sơn La', 'Tây Ninh',
    'Thái Nguyên', 'Thanh Hóa', 'Tuyên Quang', 'Vĩnh Long'
  ];

  const PROVINCE_ALIASES = [
    ['bắc kạn', 'Thái Nguyên'], ['bắc giang', 'Bắc Ninh'], ['bình dương', 'TP. Hồ Chí Minh'], ['bình phước', 'Đồng Nai'],
    ['bình thuận', 'Lâm Đồng'], ['bà rịa - vũng tàu', 'TP. Hồ Chí Minh'], ['bà rịa vũng tàu', 'TP. Hồ Chí Minh'],
    ['hà nam', 'Ninh Bình'], ['hải dương', 'Hải Phòng'], ['hậu giang', 'Cần Thơ'], ['kiên giang', 'An Giang'],
    ['kon tum', 'Quảng Ngãi'], ['long an', 'Tây Ninh'], ['nam định', 'Ninh Bình'], ['ninh thuận', 'Khánh Hòa'],
    ['phú yên', 'Đắk Lắk'], ['sóc trăng', 'Cần Thơ'], ['thái bình', 'Hưng Yên'], ['tiền giang', 'Đồng Tháp'],
    ['bến tre', 'Vĩnh Long'], ['bạc liêu', 'Cà Mau'], ['trà vinh', 'Vĩnh Long'], ['vĩnh phúc', 'Phú Thọ'], ['yên bái', 'Lào Cai'], ['quảng nam', 'Đà Nẵng'],
    ['quảng bình', 'Quảng Trị'], ['thừa thiên huế', 'Huế'], ['đắk nông', 'Lâm Đồng'], ['hòa bình', 'Phú Thọ'],
    ['hà giang', 'Tuyên Quang'], ['cao lãnh', 'Đồng Tháp'], ['bình định', 'Gia Lai']
  ];

  // Nhận diện nhà mạng qua đầu số điện thoại Việt Nam
  function detectCarrier(phone) {
    const raw = String(phone || '').replace(/\D/g, '');
    let clean = raw;
    if (clean.startsWith('84')) clean = '0' + clean.slice(2);
    if (!clean.startsWith('0') && clean.length === 9) clean = '0' + clean;
    if (clean.length < 10) return 'Chưa rõ';
    const prefix3 = clean.slice(0, 3);
    const prefix4 = clean.slice(0, 4);

    if (['086', '096', '097', '098', '032', '033', '034', '035', '036', '037', '038', '039'].includes(prefix3)) return 'Viettel';
    if (['088', '091', '094', '081', '082', '083', '084', '085'].includes(prefix3)) return 'VinaPhone (VNPT)';
    if (['089', '090', '093', '070', '079', '077', '076', '078'].includes(prefix3)) return 'MobiFone';
    if (['092', '056', '058'].includes(prefix3)) return 'Vietnamobile';
    if (['055'].includes(prefix3)) return 'Wintel';
    if (['087'].includes(prefix3)) return 'Itelecom';
    if (['099', '059'].includes(prefix3)) return 'Gmobile';
    return 'Khác / Chưa rõ';
  }

  // Nhận diện thiết bị & hệ điều hành từ User-Agent hoặc metadata
  function detectDeviceAndOs(customer) {
    const ua = String(customer.userAgent || customer.user_agent || customer.device || customer.customFields?.device || '').toLowerCase();
    const metaDevice = String(customer.device_info || customer.device || customer.customFields?.device_info || '');
    if (metaDevice) {
      const isIphone = /iphone/i.test(metaDevice);
      return {
        os: isIphone ? 'iOS' : /android/i.test(metaDevice) ? 'Android' : 'Khác',
        brand: isIphone ? 'Apple' : /samsung/i.test(metaDevice) ? 'Samsung' : /xiaomi/i.test(metaDevice) ? 'Xiaomi' : /oppo/i.test(metaDevice) ? 'Oppo' : 'Khác',
        model: metaDevice
      };
    }
    let os = 'Chưa rõ';
    let brand = 'Chưa rõ';
    let model = 'Chưa rõ';

    if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) {
      os = 'iOS';
      brand = 'Apple';
      if (ua.includes('iphone16') || ua.includes('iphone 16')) model = 'iPhone 16 Series';
      else if (ua.includes('iphone15') || ua.includes('iphone 15')) model = 'iPhone 15 Series';
      else if (ua.includes('iphone14') || ua.includes('iphone 14')) model = 'iPhone 14 Series';
      else if (ua.includes('iphone13') || ua.includes('iphone 13')) model = 'iPhone 13 Series';
      else if (ua.includes('iphone12') || ua.includes('iphone 12')) model = 'iPhone 12 Series';
      else if (ua.includes('iphone11') || ua.includes('iphone 11')) model = 'iPhone 11 Series';
      else model = 'iPhone (Dòng khác)';
    } else if (ua.includes('android')) {
      os = 'Android';
      if (ua.includes('samsung') || ua.includes('sm-')) { brand = 'Samsung'; model = 'Samsung Galaxy'; }
      else if (ua.includes('xiaomi') || ua.includes('redmi')) { brand = 'Xiaomi'; model = 'Xiaomi / Redmi'; }
      else if (ua.includes('oppo')) { brand = 'Oppo'; model = 'Oppo Reno/A'; }
      else { brand = 'Android khác'; model = 'Thiết bị Android'; }
    } else if (ua.includes('windows')) {
      os = 'Windows';
      brand = 'PC / Laptop';
      model = 'Máy tính Windows';
    } else if (ua.includes('macintosh') || ua.includes('mac os')) {
      os = 'macOS';
      brand = 'Apple';
      model = 'MacBook / Mac';
    }
    return { os, brand, model };
  }

  // Chuẩn hóa Tỉnh/TP theo 34 đơn vị sau sáp nhập 2025.
  function normalizeProvince(raw, isCellularIp = false) {
    const suffix = isCellularIp || /IP\s*4G/i.test(String(raw || '')) ? ' (IP 4G)' : '';
    if (!raw) return isCellularIp ? 'Chưa rõ (IP 4G)' : 'Chưa nhập CRM';
    const text = String(raw).replace(/\s*\(IP\s*4G\)/ig, '').trim();
    const lower = text.toLowerCase().replace(/[.,\-_\/]/g, ' ').replace(/\s+/g, ' ').trim();
    const aliases = [
      ['hồ chí minh', 'TP. Hồ Chí Minh'], ['hcm', 'TP. Hồ Chí Minh'], ['tphcm', 'TP. Hồ Chí Minh'], ['tp hcm', 'TP. Hồ Chí Minh'], ['sài gòn', 'TP. Hồ Chí Minh'],
      ['hà nội', 'Hà Nội'], ['ha noi', 'Hà Nội'], ['hn', 'Hà Nội'], ['đà nẵng', 'Đà Nẵng'], ['da nang', 'Đà Nẵng'], ['dn', 'Đà Nẵng'],
      ['hải phòng', 'Hải Phòng'], ['hai phong', 'Hải Phòng'], ['hp', 'Hải Phòng'], ['huế', 'Huế'], ['hue', 'Huế'],
      ['cần thơ', 'Cần Thơ'], ['can tho', 'Cần Thơ'], ['ct', 'Cần Thơ'], ...PROVINCE_ALIASES
    ];
    const found = aliases.find(([needle]) => lower === needle || lower.includes(needle));
    if (found) return found[1] + suffix;
    const matched = PROVINCES_34.find(province => lower.includes(province.toLowerCase()));
    return (matched || text) + suffix;
  }

  // Tiêu chí 1: Phân loại 3 nhóm: "Chưa gọi" / "Kết nối được" / "Không kết nối được"
  const CONNECTED_LEVELS = new Set(['L1','L1.1','L1.3','L2','L3','L4.1','L4.2','L4.3','L5','L6','L7','L8','L9','L10','L11','L12.1','L13']);
  const DEPOSITED_LEVELS = new Set(['L6','L7','L8','L9','L10','L13']);
  const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  function fieldValue(customer, ...names) {
    for (const name of names) {
      const value = customer.customFields?.[name] ?? customer[name];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  }
  const levelOf = customer => String(fieldValue(customer, 'customerLevel','level_khach_hang','level') || '').toUpperCase().match(/^L\d+(?:\.\d+)?(?=$|[^\d.])/)?.[0] || '';
  function timestampMs(value) {
    if (value instanceof Date) return value.getTime();
    const raw = String(value || '').trim();
    if (!raw) return NaN;
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw + 'T00:00:00' : raw.replace(' ', 'T');
    return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : iso + '+07:00');
  }
  function prepareData(input = {}) {
    const notesById = new Map(), members = new Map((input.members || []).map(member => [String(member.id), member.name]));
    for (const note of input.notes || []) {
      const id = String(note.customerId || note.customer_id || '');
      if (!notesById.has(id)) notesById.set(id, []);
      notesById.get(id).push({content:String(note.content ?? note.text ?? ''),created_at:note.created_at || note.createdAt || note.at || null});
    }
    const firstCalls = new Map(),levelChosen=new Set(),everDeposited=new Set(),latestUpdates=new Map();
    for(const item of [...(input.notes||[]),...(input.orders||[]),...(input.customerFieldHistory||[])]){const id=String(item.customerId || item.customer_id || '');const at=item.updatedAt || item.updated_at || item.createdAt || item.created_at || item.at;const previous=latestUpdates.get(id);if(Number.isFinite(timestampMs(at))&&(!previous||timestampMs(at)>timestampMs(previous)))latestUpdates.set(id,at);}
    for (const change of input.customerFieldHistory || []) {
      if(change.fieldId==='customerLevel' && !['API','FORM','IMPORT','SYSTEM'].includes(change.source)){levelChosen.add(String(change.customerId));if(DEPOSITED_LEVELS.has(String(change.to||'').toUpperCase().match(/^L\d+(?:\.\d+)?/)?.[0]))everDeposited.add(String(change.customerId));}
      if (['API','FORM','IMPORT','SYSTEM'].includes(change.source) || !['callStatus','goi_ket_noi','call_status'].includes(change.fieldId) || !change.to || /^chưa gọi$/i.test(String(change.to))) continue;
      const at = change.at || change.createdAt, previous = firstCalls.get(String(change.customerId));
      if (Number.isFinite(timestampMs(at)) && (!previous || timestampMs(at) < timestampMs(previous))) firstCalls.set(String(change.customerId), at);
    }
    return {...input, customers:(input.customers || []).map(customer => ({
      ...customer, notes:[...(notesById.get(String(customer.id)) || []),...(Array.isArray(customer.notes)?customer.notes:[])],
      levelChosen:customer.levelChosen || levelChosen.has(String(customer.id)),everDeposited:customer.everDeposited || everDeposited.has(String(customer.id)),
      updatedAt:timestampMs(latestUpdates.get(String(customer.id)))>timestampMs(customer.updatedAt || customer.updated_at || customer.createdAt || customer.created_at)?latestUpdates.get(String(customer.id)):(customer.updatedAt || customer.updated_at || customer.createdAt || customer.created_at),
      saleName:members.get(String(customer.saleId || customer.sale_id)) || customer.saleName || customer.sale,
      first_call_at:fieldValue(customer,'first_call_at','firstCallAt') || firstCalls.get(String(customer.id)) || null
    }))};
  }
  function evaluateConnectionStatus(customer) {
    const level = levelOf(customer);
    const result = (status,detail,evidence) => ({status,detail,evidence,label:{CONNECTED:'Kết nối được',NOT_CONNECTED:'Không kết nối được',UNCONNECTED_YET:'Chưa gọi',UNKNOWN:'Chưa rõ',EXCLUDED:'Trùng · Loại thống kê'}[status],isConnected:status==='CONNECTED',isUncalled:status==='UNCONNECTED_YET',isUnknown:status==='UNKNOWN',isExcluded:status==='EXCLUDED'});
    if (level === 'L12.2') return result('EXCLUDED','Level L12.2: Trùng','Level');
    const classify = text => {
      const value = String(text || '').toLowerCase().trim();
      if (!value) return null;
      if (/^(chưa gọi|chưa ai gọi|chưa liên hệ|new|not called)$/.test(value)) return 'UNCONNECTED_YET';
      if (/không nghe|không gọi được|chưa gọi được|chưa kết nối|không kết nối|thuê bao|sai số|nhầm số|không tín hiệu|no answer|unreachable|wrong number/.test(value)) return 'NOT_CONNECTED';
      if (/đã nghe|đã gọi được|đã trao đổi|đã liên hệ|đã kết nối|nghe máy|contacted|connected|hẹn gọi lại|nhận contact|quan tâm cao|chờ học|đã nhắn tin|vào nhóm|muốn học|hẹn nạp|không quan tâm|không đăng ký|từ chối/.test(value)) return 'CONNECTED';
      return null;
    };
    // Kết quả mới nhất của cuộc gọi ưu tiên hơn note và Level lịch sử.
    for (const [value,evidence] of [[fieldValue(customer,'goi_ket_noi','callStatus','call_status'),'Trạng thái gọi'],[fieldValue(customer,'ket_qua_cham_soc','result'),'Kết quả chăm sóc']]) {
      const status = classify(value); if (status) return result(status,String(value),evidence);
    }
    const notes = (Array.isArray(customer.notes) ? customer.notes : []).slice().sort((a,b)=>(timestampMs(b.created_at || b.at)||0)-(timestampMs(a.created_at || a.at)||0));
    for (const note of [...notes,{content:customer.note || ''}]) {
      const text = typeof note === 'string' ? note : note.content || note.text;
      const status = classify(text); if (status) return result(status,String(text),'Ghi chú Sale');
    }
    const classification = fieldValue(customer,'customerClass','phan_loai_khach_hang');
    const classStatus = classify(classification); if (classStatus) return result(classStatus,String(classification),'Phân loại');
    if (CONNECTED_LEVELS.has(level)) return result('CONNECTED',level,'Level');
    if (level==='L0' && (customer.first_call_at || customer.levelChosen)) return result('NOT_CONNECTED','L0: Chưa liên hệ được','Level');
    if (['CONTACTED','PAID'].includes(customer.status)) return result('CONNECTED',customer.status,'Trạng thái CRM');
    if (customer.first_call_at || fieldValue(customer,'callStatus','call_status','goi_ket_noi','result','ket_qua_cham_soc')) return result('UNKNOWN','Có cuộc gọi nhưng chưa nhận diện kết quả','CRM');
    return result('UNCONNECTED_YET','Chưa có bằng chứng gọi','CRM');
  }
  function isInterestedCustomer(customer) {
    return ['L2','L3','L4.1','L11'].includes(levelOf(customer)) || ['Nóng','Ấm','Whale','Premium'].includes(fieldValue(customer,'customerClass','phan_loai_khach_hang'));
  }
  function orderCollected(order) {
    if (!['PAID','DEPOSIT','COURSE_GRANTED'].includes(order.status)) return 0;
    const paid = order.amountPaid ?? order.amount_paid ?? (order.status==='DEPOSIT' ? order.depositAmount : order.total ?? order.total_amount);
    return Math.max(0,numeric(paid)-numeric(order.refund));
  }
  function isConvertedCustomer(customer, ordersMap = new Map()) {
    return customer.everDeposited===true || DEPOSITED_LEVELS.has(levelOf(customer)) || numeric(fieldValue(customer,'deposit_amount'))>0 || (ordersMap.get(String(customer.id))||[]).some(order=>orderCollected(order)>0);
  }
  function ageRangeForCustomer(customer) {
    const range = fieldValue(customer,'age_range'); if (range) return String(range);
    const birth = numeric(fieldValue(customer,'birth_year','birthYear'));
    const age = numeric(fieldValue(customer,'age')) || (birth>1900 ? new Date().getFullYear()-birth : 0);
    if (age<18 || age>120) return 'Chưa nhập';
    return age<25?'18–24':age<35?'25–34':age<45?'35–44':age<55?'45–54':'55+';
  }
  function analyzeData(input = {}) {
    const {customers=[],orders=[],websites=[],traffic=[]} = prepareData(input);
    const ordersMap = new Map();
    for (const order of orders) {const id=String(order.customerId || order.customer_id || '');if(!ordersMap.has(id))ordersMap.set(id,[]);ordersMap.get(id).push(order);}
    const excludedData = customers.filter(customer=>levelOf(customer)==='L12.2').length;
    const records = customers.filter(customer=>levelOf(customer)!=='L12.2').map(customer=>{
      const cf=customer.customFields || {}, createdMs=timestampMs(customer.createdAt || customer.created_at), date=new Date(createdMs+7*3600000);
      const hour=Number.isFinite(createdMs)?date.getUTCHours():null;
      const network=String(fieldValue(customer,'network_type','connectionType') || '');
      const isCellular=[true,1,'1','true'].includes(customer.is_4g ?? cf.is_4g) || /4g|5g|lte|cellular/i.test(network);
      const crmProvince=fieldValue(customer,'province','tinh_thanh','city'), ipProvince=customer.ipProvince || cf.ip_province || customer.ip_location?.province;
      const provinceFromCellularIp=(!crmProvince && Boolean(ipProvince) && isCellular) || /IP\s*4G/i.test(String(crmProvince || ''));
      const hourLabel=hour===null?'Chưa rõ':hour>=20&&hour<=22?'20:00 - 22:00':hour>=6&&hour<12?'06:00 - 11:59':hour>=12&&hour<18?'12:00 - 17:59':hour>=18&&hour<20?'18:00 - 19:59':'23:00 - 05:59';
      return {raw:customer,conn:evaluateConnectionStatus(customer),interested:isInterestedCustomer(customer),converted:isConvertedCustomer(customer,ordersMap),
        revenue:(ordersMap.get(String(customer.id))||[]).reduce((sum,order)=>sum+orderCollected(order),0),deposit:Math.max(0,numeric(fieldValue(customer,'deposit_amount'))),depositCurrency:String(fieldValue(customer,'deposit_currency')||'VND').toUpperCase(),
        carrier:detectCarrier(customer.phone),device:detectDeviceAndOs(customer),isCellular,provinceFromCellularIp,
        networkType:isCellular?'4G / Di động':/wifi|wi-fi|cáp|cable/i.test(network)?'Wifi / Cáp':'Chưa rõ',
        province:normalizeProvince(crmProvince || ipProvince,provinceFromCellularIp),source:customer.source || customer.landingPageName || 'Chưa rõ',
        campaign:customer.campaign || cf.campaign || 'Chưa gắn Camp',adContent:fieldValue(customer,'utm_content','ad_title','ad_id') || customer.campaign || 'Chưa gắn content',
        hour,dayOfWeek:Number.isFinite(createdMs)?['Chủ nhật','Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7'][date.getUTCDay()]:'Chưa rõ',timeFrame:hourLabel,
        ageRange:ageRangeForCustomer(customer),gender:fieldValue(customer,'gender') || 'Chưa nhập',job:fieldValue(customer,'job') || 'Chưa nhập',
        capitalRange:fieldValue(customer,'capital_range') || 'Chưa nhập',experience:fieldValue(customer,'experience') || 'Chưa nhập',marketInterest:fieldValue(customer,'market_interest') || 'Chưa nhập',
        mainInterest:fieldValue(customer,'main_interest') || 'Chưa nhập',mainObjection:fieldValue(customer,'main_objection') || 'Chưa nhập',saleName:customer.saleName || customer.sale || 'Chưa gán Sale',
        callDelayMinutes:Number.isFinite(timestampMs(customer.first_call_at))&&Number.isFinite(createdMs)&&timestampMs(customer.first_call_at)>=createdMs?(timestampMs(customer.first_call_at)-createdMs)/60000:null};
    });
    const totalData=records.length,uncalledData=records.filter(row=>row.conn.isUncalled).length,unknownData=records.filter(row=>row.conn.isUnknown).length;
    const connectedData=records.filter(row=>row.conn.isConnected).length,notConnectedData=records.filter(row=>row.conn.status==='NOT_CONNECTED').length,calledData=connectedData+notConnectedData;
    const connectionRate=calledData?connectedData/calledData*100:0,totalInterested=records.filter(row=>row.interested).length,totalConverted=records.filter(row=>row.converted).length;
    const totalRevenue=records.reduce((sum,row)=>sum+row.revenue,0),totalDeposit=records.filter(row=>row.depositCurrency==='VND').reduce((sum,row)=>sum+row.deposit,0),avgConvertRate=totalData?totalConverted/totalData*100:0;
    function groupDimension(extract,label) {
      const groups=new Map();
      for(const row of records){const key=String(extract(row)||'Chưa rõ');const g=groups.get(key)||{key,name:key,total:0,uncalled:0,called:0,connected:0,interested:0,converted:0,revenue:0,deposit:0,callDelays:[]};g.total++;if(row.conn.isUncalled)g.uncalled++;if(['CONNECTED','NOT_CONNECTED'].includes(row.conn.status))g.called++;if(row.conn.isConnected)g.connected++;if(row.interested)g.interested++;if(row.converted)g.converted++;g.revenue+=row.revenue;if(row.depositCurrency==='VND')g.deposit+=row.deposit;if(row.callDelayMinutes!==null)g.callDelays.push(row.callDelayMinutes);groups.set(key,g);}
      return [...groups.values()].map(g=>{const connRate=g.called?g.connected/g.called*100:0,indexRatio=connectionRate?connRate/connectionRate:1,isSmallSample=g.total<10;return {...g,dimensionName:label,connRate,convRate:g.total?g.converted/g.total*100:0,isSmallSample,indexRatio,deltaPct:connectionRate?(connRate-connectionRate)/connectionRate*100:0,badge:isSmallSample?'SMALL_SAMPLE':indexRatio>=1.2?'SUPERIOR':indexRatio<=0.8?'INFERIOR':'NORMAL',avgCallMinutes:g.callDelays.length?g.callDelays.reduce((a,b)=>a+b,0)/g.callDelays.length:null};}).sort((a,b)=>b.converted-a.converted || b.connected-a.connected || b.total-a.total);
    }
    const extractors={sources:[r=>r.source,'Nguồn'],os:[r=>r.device.os,'Hệ điều hành'],deviceBrands:[r=>r.device.brand,'Hãng máy'],iphoneModels:[r=>r.device.os==='iOS'?r.device.model:null,'Dòng iPhone'],carriers:[r=>r.carrier,'Nhà mạng (ước tính theo đầu số)'],networkTypes:[r=>r.networkType,'Mạng'],provinces:[r=>r.province,'Tỉnh/TP'],ageRanges:[r=>r.ageRange,'Tuổi'],genders:[r=>r.gender,'Giới tính'],jobs:[r=>r.job,'Nghề'],capitalRanges:[r=>r.capitalRange,'Vốn'],experiences:[r=>r.experience,'Kinh nghiệm'],marketInterests:[r=>r.marketInterest,'Thị trường'],mainInterests:[r=>r.mainInterest,'Mục tiêu'],mainObjections:[r=>r.mainObjection,'Rào cản'],timeFrames:[r=>r.timeFrame,'Khung giờ đăng ký'],daysOfWeek:[r=>r.dayOfWeek,'Thứ đăng ký'],sales:[r=>r.saleName,'Sale phụ trách'],levels:[r=>levelOf(r.raw)||'Chưa chọn','Level'],courses:[r=>{const value=fieldValue(r.raw,'course');return Array.isArray(value)?value.join(', '):value;},'Khóa']};
    const dimensions=Object.fromEntries(Object.entries(extractors).map(([name,[extract,label]])=>[name,groupDimension(extract,label)]));
    dimensions.iphoneModels=dimensions.iphoneModels.filter(row=>row.key!=='Chưa rõ');
    for(const key of new Set(customers.flatMap(customer=>Object.keys(customer.customFields || {})))){
      if(['callStatus','customerLevel','customerClass','device_info','utm_content'].includes(key))continue;
      dimensions['custom:'+key]=groupDimension(row=>{const value=row.raw.customFields?.[key];return Array.isArray(value)?value.join(', '):typeof value==='object'?null:value;},key);
    }
    const spendByContent=new Map(),adMetadata=new Map();
    for(const row of [...websites,...traffic]){const key=row.utm_content || row.adContent || row.ad_id;const rawSpend=row.spend ?? row.adSpend ?? row.cost;const spend=Number(rawSpend);if(key&&rawSpend!==null&&rawSpend!==undefined&&rawSpend!==''&&Number.isFinite(spend)&&spend>=0)spendByContent.set(String(key),(spendByContent.get(String(key))||0)+spend);if(key)adMetadata.set(String(key),{title:row.ad_title || row.title || String(key),body:row.ad_body || row.body || row.content || ''});}
    const contentGroups=groupDimension(row=>row.adContent,'Content').map(group=>{const spend=spendByContent.get(group.key),spendAvailable=spend!==undefined;return {...group,...(adMetadata.get(group.key)||{title:group.name,body:''}),estimatedSpend:spendAvailable?spend:null,spendAvailable,cplConnected:spendAvailable&&group.connected?spend/group.connected:null,cplDeposit:spendAvailable&&group.converted?spend/group.converted:null,roi:spendAvailable&&spend>0?group.revenue/spend:null};}).sort((a,b)=>b.deposit-a.deposit || b.converted-a.converted || b.connected-a.connected);
    const facebookDemographics=traffic.filter(row=>String(row.provider || '').toUpperCase()==='FACEBOOK'&&row.aggregate===true&&(row.age || row.age_range || row.gender || row.province));
    const summary={totalData,uncalledData,unknownData,excludedData,calledData,connectedData,notConnectedData,connectionRate,totalInterested,totalConverted,totalRevenue,totalDeposit,avgConnRate:connectionRate,avgConvertRate};
    const depositsByCurrency=Object.create(null);for(const row of records)if(row.deposit>0)depositsByCurrency[row.depositCurrency]=(depositsByCurrency[row.depositCurrency]||0)+row.deposit;
    return {...summary,depositsByCurrency,overview:summary,dimensions,contentGroups,facebookDemographics,records,aiInsight:generateAiInsight({...summary,dimensions,contentGroups})};
  }
  function analyzeStaffRanking(input) {
    const data=analyzeData(input||{}), groups=new Map();
    for(const r of data.records){const key=String(r.raw.saleId||r.raw.sale_id||r.raw.assignedTo||r.raw.assigned_to||r.saleName||r.raw.sale||'Unassigned');const g=groups.get(key)||{sale:key,total:0,called:0,connected:0,converted:0,note:0,delays:[]};g.total++;if(!r.conn.isUncalled&&!r.conn.isUnknown&&!r.conn.isExcluded)g.called++;if(r.conn.isConnected)g.connected++;if(r.converted)g.converted++;if((r.raw.notes||[]).length)g.note++;if(r.callDelayMinutes!=null)g.delays.push(r.callDelayMinutes);groups.set(key,g);}
    return [...groups.values()].map(g=>{const cr=g.called?g.connected/g.called*100:null,vr=g.total?g.converted/g.total*100:null,sp=g.delays.length?g.delays.reduce((a,b)=>a+b,0)/g.delays.length:null,score=g.total<10?null:(cr==null&&vr==null?null:Math.round(((cr||0)*.45+(vr||0)*.45+(sp==null?0:Math.max(0,100-sp/1440*100)*.1))*10)/10);return Object.assign(g,{connection_rate:cr,conversion_rate:vr,note_coverage:g.total?g.note/g.total*100:0,avg_processing_minutes:sp==null?null:Math.round(sp),score,confidence:g.total<10?'Small sample':'Reference sample'});}).sort((a,b)=>(b.score==null?-1:b.score)-(a.score==null?-1:a.score)).map((r,i)=>Object.assign(r,{rank:i+1}));
  }

  function generateAiInsight(data) {
    const {calledData,connectedData,connectionRate,totalConverted,dimensions,contentGroups}=data;
    const eligible=rows=>(rows||[]).filter(row=>row.total>=10&&row.converted>0&&!/chưa|khác|IP 4G/i.test(row.key)).sort((a,b)=>b.deposit-a.deposit || b.converted-a.converted);
    const province=eligible(dimensions.provinces)[0],age=eligible(dimensions.ageRanges)[0],job=eligible(dimensions.jobs)[0],device=eligible(dimensions.os)[0];
    const top=contentGroups.find(row=>row.key!=='Chưa gắn content'),objection=dimensions.mainObjections.find(row=>!['Không có','Chưa nhập','Chưa rõ'].includes(row.key));
    return {generatedAt:new Date().toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}),
      summaryHeadline:`Kết nối ${connectedData}/${calledData} data có kết quả gọi (${connectionRate.toFixed(1)}%). Ghi nhận ${totalConverted} khách có bằng chứng chốt/nạp.`,
      personaInsight:[province&&`Tỉnh có nhiều khách chốt: ${province.name}.`,age&&`Nhóm tuổi: ${age.name}.`,job&&`Nghề: ${job.name}.`,device&&`Hệ điều hành: ${device.name}.`].filter(Boolean).join(' ') || 'Chưa đủ mẫu từ 10 khách có thông tin chân dung để kết luận. Vị trí suy ra từ IP 4G không dùng để kết luận nơi sống; giờ đăng ký không đại diện cho giờ nghe máy.',
      contentInsight:top?`Content "${top.name}": ${top.connected} kết nối, ${top.converted} chốt/nạp.${top.cplConnected!==null?` CPL kết nối ${top.cplConnected.toLocaleString('vi-VN')} đ.`:' Chưa có chi phí QC thật hoặc chưa có kết nối nên chưa tính CPL.'}${top.isSmallSample?' Mẫu nhỏ, chưa kết luận hiệu quả.':''}`:'Chưa có dữ liệu quảng cáo/content để xếp hạng.',
      objectionInsight:objection?`Rào cản ghi trong CRM: "${objection.name}" (${objection.total} khách).${objection.isSmallSample?' Mẫu nhỏ, cần thêm dữ liệu.':''}`:'Chưa có dữ liệu rào cản trong CRM.',
      actionableRecommendations:['Điền đầy đủ chân dung khi khách lên L2; không suy đoán tuổi từ dữ liệu Facebook tổng hợp.','So sánh tốc độ gọi thực tế của Sale với mốc 15 phút bằng first_call_at.','Đồng bộ chi phí và nội dung quảng cáo thật trước khi quyết định ngân sách.','Xem riêng data chưa gọi, data chưa rõ và Level trùng để không làm sai tỷ lệ kết nối.']};
  }

  const hubState = {
    activeTab: 'funnel',
    activePersona: 'sources',
    timeFilter: 'all',
    fromDate: '',
    toDate: '',
    source: '',
    connection: '',
    page: 1,
    searchQuery: '',
    botCommandOutput: null
  };

  // Tạo và nhúng CSS giao diện cho Marketing Hub
  function ensureStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('marketingHubStyles')) return;
    const style = document.createElement('style');
    style.id = 'marketingHubStyles';
    style.textContent = `
      .mkt-container { min-width:0; max-width:100%; box-sizing:border-box; padding: 20px 24px 48px; color: var(--text-main, #0f172a); font-family: var(--font-sans, system-ui, sans-serif); }
      .mkt-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
      .mkt-badge-role { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 9999px; background: rgba(37,99,235,0.12); color: #2563eb; font-weight: 700; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 6px; }
      .mkt-title { font-size: 22px; font-weight: 800; color: var(--text-main, #0f172a); margin: 0; line-height: 1.3; }
      .mkt-subtitle { color: var(--text-muted, #64748b); font-size: 13px; margin-top: 4px; }
      .mkt-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

      /* Bento KPI Grid */
      .mkt-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%,240px), 1fr)); gap: 16px; margin-bottom: 24px; }
      .mkt-kpi-card { background: var(--bg-surface, #ffffff); border: 1px solid var(--border, #e2e8f0); border-radius: 8px; padding: 18px 20px; display: flex; flex-direction: column; justify-content: space-between; position: relative; overflow: hidden; }
      .mkt-kpi-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .mkt-kpi-label { font-size: 12px; font-weight: 700; color: var(--text-muted, #64748b); text-transform: uppercase; letter-spacing: 0.5px; }
      .mkt-kpi-icon { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
      .mkt-kpi-val { font-size: 26px; font-weight: 800; color: var(--text-main, #0f172a); font-family: var(--font-mono, monospace); line-height: 1.2; }
      .mkt-kpi-sub { margin-top: 8px; font-size: 11.5px; color: var(--text-muted, #64748b); display: flex; align-items: center; gap: 6px; }
      .mkt-kpi-sub strong { color: var(--text-main, #0f172a); font-weight: 700; }
      .mkt-kpi-bar { height: 6px; border-radius: 9999px; background: var(--bg-subtle, #f1f5f9); margin-top: 10px; overflow: hidden; }
      .mkt-kpi-bar-inner { height: 100%; border-radius: 9999px; background: #2563eb; transition: width 0.4s ease; }

      /* Tab Navigation */
      .mkt-nav-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--border, #e2e8f0); margin-bottom: 20px; overflow-x: auto; padding-bottom: 2px; }
      .mkt-tab-btn { background: transparent; border: none; padding: 10px 16px; border-radius: 8px 8px 0 0; font-size: 13px; font-weight: 700; color: var(--text-muted, #64748b); cursor: pointer; display: flex; align-items: center; gap: 8px; white-space: nowrap; transition: all 0.15s; border-bottom: 2px solid transparent; margin-bottom: -1px; }
      .mkt-tab-btn:hover { color: var(--text-main, #0f172a); background: var(--bg-subtle, #f8fafc); }
      .mkt-tab-btn.active { color: #2563eb; border-bottom-color: #2563eb; background: var(--bg-surface, #ffffff); }

      /* Sub Tabs */
      .mkt-subtabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; padding: 4px; background: var(--bg-subtle, #f1f5f9); border-radius: 10px; width: fit-content; }
      .mkt-subtab-btn { background: transparent; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; color: var(--text-muted, #64748b); cursor: pointer; transition: all 0.15s; }
      .mkt-subtab-btn:hover { color: var(--text-main, #0f172a); }
      .mkt-subtab-btn.active { background: var(--bg-surface, #ffffff); color: #2563eb; font-weight: 700; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

      /* Table View */
      .mkt-table-card { min-width:0; background: var(--bg-surface, #ffffff); border-top: 1px solid var(--border, #e2e8f0); border-bottom: 1px solid var(--border, #e2e8f0); overflow: hidden; margin-bottom: 24px; }
      .mkt-table-head { padding: 14px 18px; border-bottom: 1px solid var(--border, #e2e8f0); display: flex; justify-content: space-between; align-items: center; background: var(--bg-subtle, #f8fafc); }
      .mkt-table-title { font-size: 14px; font-weight: 700; color: var(--text-main, #0f172a); }
      .mkt-table-wrap { overflow-x: auto; max-width: 100%; }
      .mkt-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12.5px; }
      .mkt-table th { padding: 11px 16px; background: var(--bg-subtle, #f8fafc); color: var(--text-muted, #64748b); font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border, #e2e8f0); white-space: nowrap; }
      .mkt-table td { padding: 12px 16px; border-bottom: 1px solid var(--border-light, #f1f5f9); color: var(--text-main, #0f172a); vertical-align: middle; }
      .mkt-table tr:hover td { background: var(--bg-subtle, #f8fafc); }

      /* Badges & Indicators */
      .mkt-badge-up { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; background: #ecfdf5; color: #059669; font-weight: 700; font-size: 11px; font-family: var(--font-mono, monospace); }
      .mkt-badge-down { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; background: #fef2f2; color: #dc2626; font-weight: 700; font-size: 11px; font-family: var(--font-mono, monospace); }
      .mkt-badge-neutral { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; background: #f1f5f9; color: #64748b; font-weight: 600; font-size: 11px; }
      .mkt-badge-sample { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 4px; background: #fef3c7; color: #b45309; font-size: 10px; font-weight: 700; }
      .mkt-pill-tag { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: var(--bg-subtle, #f1f5f9); color: var(--text-main, #334155); }
      .mkt-pill-gold { background: #fef9c3; color: #854d0e; font-weight: 700; border: 1px solid #fde047; }
      .mkt-pill-cell { background: #fee2e2; color: #991b1b; font-size: 10px; font-weight: 700; }

      /* AI Insight Card */
      .mkt-ai-card { background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 1px solid #cbd5e1; border-radius: 16px; padding: 22px 24px; margin-bottom: 24px; box-shadow: 0 4px 16px rgba(0,0,0,0.04); position: relative; }
      [data-theme="dark"] .mkt-ai-card { background: linear-gradient(135deg, #111827 0%, #1f2937 100%); border-color: #374151; }
      .mkt-ai-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
      .mkt-ai-tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 9999px; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #ffffff; font-size: 11px; font-weight: 800; letter-spacing: 0.5px; }
      .mkt-ai-quote { font-size: 15px; font-weight: 700; color: var(--text-main, #0f172a); line-height: 1.5; margin-bottom: 16px; padding-left: 14px; border-left: 4px solid #2563eb; }
      .mkt-ai-section { margin-bottom: 14px; }
      .mkt-ai-sectitle { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #2563eb; margin-bottom: 5px; }
      .mkt-ai-text { font-size: 13px; color: var(--text-main, #334155); line-height: 1.6; margin: 0; }
      .mkt-ai-recs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%,280px), 1fr)); gap: 12px; margin-top: 14px; }
      .mkt-ai-rec-box { background: var(--bg-surface, #ffffff); border: 1px solid var(--border, #e2e8f0); border-radius: 10px; padding: 12px 14px; display: flex; gap: 10px; align-items: flex-start; }
      .mkt-ai-rec-num { width: 22px; height: 22px; border-radius: 50%; background: #2563eb; color: #fff; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

      /* Bot quick command bar */
      .mkt-bot-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border, #e2e8f0); }
      .mkt-bot-cmd { background: var(--bg-surface, #ffffff); border: 1px solid var(--border, #cbd5e1); padding: 5px 12px; border-radius: 6px; font-family: var(--font-mono, monospace); font-size: 12px; font-weight: 700; color: #2563eb; cursor: pointer; transition: all 0.15s; }
      .mkt-bot-cmd:hover { background: #2563eb; color: #ffffff; border-color: #2563eb; }

      /* API Docs Box */
      .mkt-code-box { background: #0f172a; color: #f8fafc; border-radius: 10px; padding: 14px 16px; font-family: var(--font-mono, monospace); font-size: 12px; line-height: 1.5; overflow-x: auto; margin-top: 10px; border: 1px solid #1e293b; }
      .mkt-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: all 0.15s; border: 1px solid transparent; }
      .mkt-btn-primary { background: #2563eb; color: #ffffff; }
      .mkt-btn-primary:hover { background: #1d4ed8; }
      .mkt-btn-secondary { background: var(--bg-surface, #ffffff); border-color: var(--border, #cbd5e1); color: var(--text-main, #334155); }
      .mkt-btn-secondary:hover { background: var(--bg-subtle, #f1f5f9); }
      .mkt-container input,.mkt-container select {max-width:100%;box-sizing:border-box}
      .mkt-api-view .mkt-code-box {border-radius:4px}
      .mkt-container,.mkt-container * {letter-spacing:0!important}
      .mkt-kpi-sub {flex-wrap:wrap}
      .mkt-header>div {min-width:0}
      .mkt-ai-card {border:0;border-radius:0;background:transparent;box-shadow:none;padding:18px 0}
      .mkt-ai-rec-box {border-radius:8px}
      .mkt-btn:disabled {opacity:.5;cursor:default}
      @media(max-width:600px){.mkt-container{padding:12px 8px 30px}.mkt-table-head{gap:10px;flex-wrap:wrap}.mkt-ai-card{padding:16px}.mkt-title{font-size:19px}}
    `;
    document.head.appendChild(style);
  }

  // Hàm render giao diện chính cho Marketing Hub
  function csvCell(value) { const text=String(value ?? '').replace(/^[\s]*[=+@-]/, match=>"'"+match); return '"' + text.replace(/"/g, '""') + '"'; }
  function downloadCsv(analysis, tab, persona) {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
    const rows = analysis.records.map(row => [row.raw.name, row.raw.phone, row.source, row.saleName, row.province, row.ageRange, row.gender, row.job, row.conn.label, row.conn.detail, row.raw.updatedAt || row.raw.updated_at]);
    const header = ['Tên', 'Điện thoại', 'Nguồn', 'Sale', 'Tỉnh/TP', 'Tuổi', 'Giới tính', 'Nghề', 'Kết nối', 'Chi tiết', 'Cập nhật'];
    const csv = '\ufeff' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = 'marketing-crm-' + String(tab || persona || 'data') + '.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function render(container, rawData, options = {}) {
    ensureStyles();
    if (hubState.accountId !== options.accountId) { hubState.accountId = options.accountId; hubState.botCommandOutput = null; }
    const host = typeof container === 'string' ? document.getElementById(container) : container;
    if (!host) return;

    // Chuẩn hóa input
    let customers = [];
    let orders = [];
    let websites = [];
    let traffic = [];
    if (Array.isArray(rawData)) {
      customers = rawData;
    } else if (rawData && typeof rawData === 'object') {
      customers = Array.isArray(rawData.customers) ? rawData.customers : [];
      orders = Array.isArray(rawData.orders) ? rawData.orders : [];
      websites = Array.isArray(rawData.websites) ? rawData.websites : [];
      traffic = Array.isArray(rawData.traffic) ? rawData.traffic : [];
    }

    // Lọc theo updatedAt để Marketing có thể xem nhanh dữ liệu gần đây.
    const nowMs = Date.now();
    const cutoffMs = hubState.timeFilter === '7d' ? nowMs - 7 * 24 * 60 * 60 * 1000 : hubState.timeFilter === '30d' ? nowMs - 30 * 24 * 60 * 60 * 1000 : null;
    if (cutoffMs) customers = customers.filter(customer => {
      const raw = String(customer.updatedAt || customer.updated_at || customer.createdAt || customer.created_at || '').replace(' ', 'T');
      const ms = Date.parse(/[zZ]|[+-][0-9]{2}:?[0-9]{2}$/.test(raw) ? raw : raw + '+07:00');
      return Number.isFinite(ms) && ms >= cutoffMs;
    });

    const sources = [...new Set(customers.map(customer => customer.source || 'Chưa rõ'))].sort();
    const fullInput = prepareData({ ...(Array.isArray(rawData) ? {} : rawData || {}), customers, orders, websites, traffic });
    customers = fullInput.customers.filter(customer => {
      const ms = timestampMs(customer.updatedAt || customer.updated_at || customer.createdAt || customer.created_at);
      if (hubState.fromDate && (!Number.isFinite(ms) || ms < timestampMs(hubState.fromDate))) return false;
      if (hubState.toDate && (!Number.isFinite(ms) || ms >= timestampMs(hubState.toDate) + 86400000)) return false;
      if (hubState.source && (customer.source || 'Chưa rõ') !== hubState.source) return false;
      if (hubState.connection && evaluateConnectionStatus(customer).status !== hubState.connection) return false;
      const search = hubState.searchQuery.trim().toLowerCase();
      return !search || [customer.name, customer.phone, customer.saleName, customer.note, ...(customer.notes || []).map(note=>note.content || note.text || ''), ...Object.values(customer.customFields || {})].join(' ').toLowerCase().includes(search);
    });
    const analysis = analyzeData({ ...fullInput, customers });
    const { totalData, uncalledData, unknownData, excludedData, calledData, connectedData, notConnectedData, connectionRate, totalInterested, totalConverted, totalRevenue, totalDeposit, dimensions, contentGroups, aiInsight, records, facebookDemographics, depositsByCurrency } = analysis;

    hubState.page = Math.max(1,Math.min(hubState.page,Math.max(1,Math.ceil(records.length/50))));
    // Helpers format
    const fmtNum = n => Number(n || 0).toLocaleString('vi-VN');
    const fmtPct = n => Number(n || 0).toFixed(1) + '%';
    const fmtMoney = n => Number(n || 0).toLocaleString('vi-VN') + ' đ';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

    // Xây dựng Header
    const headerHtml = `
      <div class="mkt-header">
        <div>
          <span class="mkt-badge-role">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
            Tài khoản Marketing · Dữ liệu CRM
          </span>
          <h1 class="mkt-title">Marketing Hub · Chân dung khách hàng</h1>
          <p class="mkt-subtitle">Dữ liệu đồng bộ từ CRM chính · Phân loại kết nối khách hàng · Chân dung đa chiều ▲▼ · Hiệu quả Content &amp; CPL</p>
        </div>
        <div class="mkt-actions">
          <label class="mkt-btn mkt-btn-secondary" style="gap:6px"><span>Khoảng thời gian</span><select id="mktTimeFilter" style="border:0;background:transparent;font-weight:700;color:inherit;outline:0"><option value="all" ${hubState.timeFilter === 'all' ? 'selected' : ''}>Tất cả</option><option value="7d" ${hubState.timeFilter === '7d' ? 'selected' : ''}>7 ngày</option><option value="30d" ${hubState.timeFilter === '30d' ? 'selected' : ''}>30 ngày</option></select></label>
          <button type="button" class="mkt-btn mkt-btn-secondary" id="mktBtnRefresh">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
            Làm mới CRM
          </button>
          <button type="button" class="mkt-btn mkt-btn-secondary" id="mktExportCsv">Xuất CSV</button>
          <button type="button" class="mkt-btn mkt-btn-primary" id="mktBtnRunAi">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path><path d="M12 2a10 10 0 0 1 10 10h-10V2z"></path><path d="M12 12L2.5 7.5"></path></svg>
            Tạo insight CRM
          </button>
        </div>
      </div>
    `;

    // Xây dựng 4 Bento KPI
    const kpiHtml = `
      <div style="font-size:12px;color:#64748b;margin-bottom:12px">Chưa rõ kết quả gọi: <b>${fmtNum(unknownData)}</b> · Trùng L12.2 loại thống kê: <b>${fmtNum(excludedData)}</b>. Hai nhóm này không tính vào tỷ lệ kết nối. Nhà mạng là ước tính theo đầu số; số chuyển mạng có thể khác.</div>
      <div class="mkt-kpi-grid">
        <!-- KPI 1 -->
        <div class="mkt-kpi-card">
          <div class="mkt-kpi-top">
            <span class="mkt-kpi-label">Tổng Data Nạp CRM</span>
            <div class="mkt-kpi-icon" style="background:#eff6ff;color:#2563eb">📥</div>
          </div>
          <div class="mkt-kpi-val">${fmtNum(totalData)}</div>
          <div class="mkt-kpi-sub">
            <span>Đã gọi: <strong>${fmtNum(calledData)}</strong></span>
            <span>·</span>
            <span>Chưa gọi: <strong style="color:#d97706">${fmtNum(uncalledData)}</strong></span>
          </div>
          <div class="mkt-kpi-bar">
            <div class="mkt-kpi-bar-inner" style="width:${totalData > 0 ? (calledData / totalData * 100) : 0}%;background:#2563eb"></div>
          </div>
        </div>

        <!-- KPI 2 -->
        <div class="mkt-kpi-card">
          <div class="mkt-kpi-top">
            <span class="mkt-kpi-label">Tỷ Lệ Kết Nối Thực Tế</span>
            <div class="mkt-kpi-icon" style="background:#ecfdf5;color:#059669">📞</div>
          </div>
          <div class="mkt-kpi-val" style="color:#059669">${fmtPct(connectionRate)}</div>
          <div class="mkt-kpi-sub">
            <span>Kết nối: <strong style="color:#059669">${fmtNum(connectedData)}</strong></span>
            <span>·</span>
            <span>Không kết nối: <strong style="color:#dc2626">${fmtNum(notConnectedData)}</strong></span>
          </div>
          <div class="mkt-kpi-bar">
            <div class="mkt-kpi-bar-inner" style="width:${connectionRate}%;background:#059669"></div>
          </div>
        </div>

        <!-- KPI 3 -->
        <div class="mkt-kpi-card">
          <div class="mkt-kpi-top">
            <span class="mkt-kpi-label">Khách Quan Tâm &amp; Chốt</span>
            <div class="mkt-kpi-icon" style="background:#fef3c7;color:#d97706">🎯</div>
          </div>
          <div class="mkt-kpi-val" style="color:#d97706">${fmtNum(totalInterested)} <small style="font-size:14px;color:#64748b">/ ${fmtNum(totalConverted)} chốt</small></div>
          <div class="mkt-kpi-sub">
            <span>Quan tâm (L2+): <strong>${fmtNum(totalInterested)}</strong></span>
            <span>·</span>
            <span>Chốt / nạp: <strong>${fmtNum(totalConverted)}</strong> (${fmtPct(totalData > 0 ? (totalConverted / totalData * 100) : 0)})</span>
          </div>
          <div class="mkt-kpi-bar">
            <div class="mkt-kpi-bar-inner" style="width:${totalData > 0 ? (totalInterested / totalData * 100) : 0}%;background:#d97706"></div>
          </div>
        </div>

        <!-- KPI 4 -->
        <div class="mkt-kpi-card">
          <div class="mkt-kpi-top">
            <span class="mkt-kpi-label">Doanh Thu Từ Nguồn MKT</span>
            <div class="mkt-kpi-icon" style="background:#f3e8ff;color:#7c3aed">💰</div>
          </div>
          <div class="mkt-kpi-val" style="color:#7c3aed;font-size:22px">${fmtMoney(totalRevenue)}</div>
          <div class="mkt-kpi-sub">
            <span>Tổng vốn nạp ghi nhận: <strong>${esc(Object.entries(depositsByCurrency).map(([currency,amount])=>fmtNum(amount)+' '+currency).join(' · ') || 'Chưa ghi vốn nạp')}</strong></span>
          </div>
          <div class="mkt-kpi-bar">
            <div class="mkt-kpi-bar-inner" style="width:100%;background:#7c3aed"></div>
          </div>
        </div>
      </div>
    `;

    // 6 Tabs điều hướng
    const tabsList = [
      { id: 'funnel', label: '1. Phễu & Trạng Thái Gọi', icon: '📊' },
      { id: 'persona', label: '2. Chân Dung KH (▲▼)', icon: '👤' },
      { id: 'content', label: '3. Content & QC Hiệu Quả', icon: '🎯' },
      { id: 'facebook', label: '4. FB Nhân Khẩu Học', icon: '📱' },
      { id: 'ai_insight', label: '5. Insight khách hàng', icon: '🤖' },
      { id: 'api_dev', label: '6. Tích Hợp API Dev CRM', icon: '⚡' },
      { id: 'staff_ranking', label: '7. Staff ranking', icon: 'S' },
      { id: 'customer_ai', label: '8. Customer note AI', icon: 'A' }
    ];

    const navTabsHtml = `
      <div class="mkt-nav-tabs">
        ${tabsList.map(t => `
          <button type="button" class="mkt-tab-btn ${hubState.activeTab === t.id ? 'active' : ''}" data-mkt-tab="${t.id}">
            <span>${t.icon}</span>
            <span>${t.label}</span>
          </button>
        `).join('')}
      </div>
    `;

    // Nội dung Tab 1: Phễu & Trạng Thái Gọi
    function renderFunnelView() {
      // Nhóm lý do không kết nối
      const notConnReasons = {};
      records.filter(r => r.conn.status === 'NOT_CONNECTED').forEach(r => {
        const reason = r.conn.detail || 'Không rõ lý do';
        notConnReasons[reason] = (notConnReasons[reason] || 0) + 1;
      });

      return `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;margin-bottom:20px">
          <!-- Cột Chưa gọi -->
          <div class="mkt-table-card">
            <div class="mkt-table-head" style="background:#fffbeb">
              <span class="mkt-table-title" style="color:#b45309">🟡 CHƯA GỌI (${fmtNum(uncalledData)})</span>
              <span style="font-size:11px;color:#b45309;font-weight:600">Tách riêng, không tính vào tỷ lệ kết nối</span>
            </div>
            <div style="padding:16px">
              <p style="font-size:12.5px;color:#64748b;margin:0 0 12px">Data mới nạp chưa có Sale gọi hoặc đang chờ phân phối. Đảm bảo tỷ lệ kết nối không bị sai lệch.</p>
              <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:6px">Data mới chờ tiếp cận:</div>
              ${records.filter(r => r.conn.isUncalled).slice(0, 5).map(r => `
                <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px">
                  <span><strong>${esc(r.raw.name || 'Khách')}</strong> (${esc(r.raw.phone)})</span>
                  <span class="mkt-pill-tag">${esc(r.source)}</span>
                </div>
              `).join('') || '<div style="color:#94a3b8;font-size:12px">Không có data chờ gọi.</div>'}
            </div>
          </div>

          <!-- Cột Kết nối được -->
          <div class="mkt-table-card">
            <div class="mkt-table-head" style="background:#ecfdf5">
              <span class="mkt-table-title" style="color:#059669">🟢 KẾT NỐI ĐƯỢC (${fmtNum(connectedData)})</span>
              <span style="font-size:11px;color:#059669;font-weight:700">${fmtPct(connectionRate)} trên data đã gọi</span>
            </div>
            <div style="padding:16px">
              <p style="font-size:12.5px;color:#64748b;margin:0 0 12px">Khách nghe máy, tiếp nhận thông tin, tương tác trao đổi hoặc đã đồng ý kết bạn Zalo/Telegram.</p>
              <div style="font-size:12px;font-weight:700;color:#059669;margin-bottom:6px">Khách kết nối nổi bật:</div>
              ${records.filter(r => r.conn.isConnected).slice(0, 5).map(r => `
                <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px">
                  <span><strong>${esc(r.raw.name)}</strong> · ${esc(r.raw.phone)}</span>
                  <span class="mkt-badge-up">${r.interested ? 'Quan tâm (L2+)' : 'Đã nghe'}</span>
                </div>
              `).join('') || '<div style="color:#94a3b8;font-size:12px">Chưa có data kết nối.</div>'}
            </div>
          </div>

          <!-- Cột Không kết nối -->
          <div class="mkt-table-card">
            <div class="mkt-table-head" style="background:#fef2f2">
              <span class="mkt-table-title" style="color:#dc2626">🔴 KHÔNG KẾT NỐI (${fmtNum(notConnectedData)})</span>
              <span style="font-size:11px;color:#dc2626;font-weight:700">${fmtPct(calledData > 0 ? (notConnectedData / calledData * 100) : 0)}</span>
            </div>
            <div style="padding:16px">
              <p style="font-size:12.5px;color:#64748b;margin:0 0 12px">Phân bổ lý do không kết nối được:</p>
              ${Object.entries(notConnReasons).map(([reason, count]) => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px">
                  <span style="color:#475569">${esc(reason)}</span>
                  <span class="mkt-badge-down">${count} lượt</span>
                </div>
              `).join('') || '<div style="color:#94a3b8;font-size:12px">Không có data rớt cuộc gọi.</div>'}
            </div>
          </div>
        </div>

        <!-- Bảng danh sách data chi tiết -->
        <div class="mkt-table-card">
          <div class="mkt-table-head">
            <span class="mkt-table-title">DANH SÁCH DATA KHÁCH HÀNG &amp; TRẠNG THÁI KẾT NỐI CHI TIẾT</span>
            <span style="font-size:12px;color:#64748b">Hiển thị ${records.length} khách</span>
          </div>
          <div class="mkt-table-wrap">
            <table class="mkt-table">
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Số điện thoại</th>
                  <th>Nguồn / Camp</th>
                  <th>Thiết bị &amp; Mạng</th>
                  <th>Tỉnh / TP</th>
                  <th>Sale phụ trách</th>
                  <th>Phân loại kết nối</th>
                  <th>Ghi chú / Call status</th>
                </tr>
              </thead>
              <tbody>
                ${records.slice((hubState.page - 1) * 50, hubState.page * 50).map(r => `
                  <tr>
                    <td><strong>${esc(r.raw.name || 'Chưa tên')}</strong></td>
                    <td style="font-family:var(--font-mono,monospace)">${esc(r.raw.phone || '—')} <span style="font-size:10px;color:#64748b">(${esc(r.carrier)})</span></td>
                    <td><span class="mkt-pill-tag">${esc(r.source)}</span></td>
                    <td>
                      <div>${esc(r.device.os)} · ${esc(r.device.model)}</div>
                      <div style="font-size:10.5px;color:#64748b">${esc(r.networkType)}</div>
                    </td>
                    <td>
                      ${esc(r.province)}
                      ${r.provinceFromCellularIp ? '<span class="mkt-pill-cell" title="Vị trí lấy từ IP 4G trạm BTS">(IP 4G)</span>' : ''}
                    </td>
                    <td>${esc(r.saleName)}</td>
                    <td>
                      ${r.conn.isUncalled ? '<span class="mkt-badge-sample">Chưa gọi</span>' : r.conn.isConnected ? '<span class="mkt-badge-up">Kết nối được</span>' : r.conn.isUnknown ? '<span class="mkt-badge-sample">Chưa rõ</span>' : '<span class="mkt-badge-down">Không kết nối</span>'}
                    </td>
                    <td style="max-width:220px;font-size:11.5px;color:#475569">${esc(r.conn.detail || r.raw.note || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Nội dung Tab 2: Chân Dung Khách Hàng (Persona ▲▼)
    function renderPersonaView() {
      const personaOptions = [
        { id: 'sources', label: 'Nguồn & Landing Page' },
        { id: 'sales', label: 'Sale & tốc độ gọi' },
        { id: 'levels', label: 'Phễu Level' },
        { id: 'courses', label: 'Khóa quan tâm' },
        { id: 'mainInterests', label: 'Điều quan tâm' },
        { id: 'os', label: 'Hệ điều hành' },
        { id: 'deviceBrands', label: 'Hãng máy' },
        { id: 'iphoneModels', label: 'Dòng iPhone' },
        { id: 'carriers', label: 'Nhà mạng viễn thông' },
        { id: 'networkTypes', label: '4G vs Wifi' },
        { id: 'provinces', label: '34 Tỉnh / Thành 2025' },
        { id: 'ageRanges', label: 'Độ tuổi' },
        { id: 'genders', label: 'Giới tính' },
        { id: 'jobs', label: 'Nghề nghiệp' },
        { id: 'timeFrames', label: 'Khung giờ' },
        { id: 'daysOfWeek', label: 'Thứ trong tuần' },
        { id: 'capitalRanges', label: 'Vốn dự kiến' },
        { id: 'experiences', label: 'Kinh nghiệm' },
        { id: 'marketInterests', label: 'Thị trường' },
        { id: 'mainObjections', label: 'Rào cản từ chối' },
        ...Object.keys(dimensions).filter(id => id.startsWith('custom:')).map(id => ({id, label: 'Trường CRM · ' + id.slice(7)}))
      ];

      const currentDimension = dimensions[hubState.activePersona] || dimensions.sources;

      return `
        <!-- Sub-tabs chọn chiều phân tích -->
        <div class="mkt-subtabs">
          ${personaOptions.map(opt => `
            <button type="button" class="mkt-subtab-btn ${hubState.activePersona === opt.id ? 'active' : ''}" data-mkt-persona="${esc(opt.id)}">
              ${esc(opt.label)}
            </button>
          `).join('')}
        </div>

        ${hubState.activePersona === 'provinces' ? `
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:12.5px;color:#1e40af">
            <strong>💡 Quy tắc nhận diện Tỉnh/TP:</strong> Ưu tiên lấy từ địa chỉ khách cung cấp trong CRM. Các data nhận diện qua IP 4G thường hiển thị vị trí trạm BTS nhà mạng (Hà Nội / TP.HCM) nên được gắn nhãn <code>(IP 4G)</code> và Insight sẽ không kết luận khu vực sinh sống từ nhóm này.
          </div>
        ` : ''}

        ${hubState.activePersona === 'timeFrames' ? `
          <div style="background:#fef9c3;border:1px solid #fde047;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:12.5px;color:#854d0e">
            <strong>Khung giờ đăng ký:</strong> Lấy từ giờ data vào CRM theo múi giờ Việt Nam. Giờ đăng ký không chứng minh giờ khách nghe máy; cần lịch sử cuộc gọi để kết luận.
          </div>
        ` : ''}

        <!-- Bảng Persona Đa Chiều -->
        <div class="mkt-table-card">
          <div class="mkt-table-head">
            <span class="mkt-table-title">CHÂN DUNG KHÁCH HÀNG: ${esc(personaOptions.find(o => o.id === hubState.activePersona)?.label.toUpperCase())}</span>
            <span style="font-size:12px;color:#64748b">Tỷ lệ kết nối TB: <strong>${fmtPct(connectionRate)}</strong> · Tỷ lệ chốt TB: <strong>${fmtPct(totalData > 0 ? (totalConverted / totalData * 100) : 0)}</strong></span>
          </div>
          <div class="mkt-table-wrap">
            <table class="mkt-table">
              <thead>
                <tr>
                  <th>Nhóm phân tích</th>
                  <th style="text-align:right">Tổng Data</th>
                  <th style="text-align:right">Đã gọi</th>
                  <th style="text-align:right">Kết nối được</th>
                  <th style="text-align:right">Tỷ lệ kết nối</th>
                  <th style="text-align:right">Quan tâm (L2+)</th>
                  <th style="text-align:right">Chốt / Nạp</th>
                  <th style="text-align:right">Doanh thu</th><th style="text-align:right">Vốn nạp VND</th>
                  <th style="text-align:center">So với TB (▲▼)</th>
                </tr>
              </thead>
              <tbody>
                ${currentDimension.map(row => {
                  let badgeHtml = '<span class="mkt-badge-neutral">Chuẩn</span>';
                  if (row.isSmallSample) {
                    badgeHtml = '<span class="mkt-badge-sample" title="Dưới 10 data, mẫu nhỏ chưa kết luận">Mẫu nhỏ (&lt;10)</span>';
                  } else if (row.badge === 'SUPERIOR') {
                    badgeHtml = `<span class="mkt-badge-up" title="Cao hơn 20% so với trung bình">▲ +${row.deltaPct.toFixed(1)}%</span>`;
                  } else if (row.badge === 'INFERIOR') {
                    badgeHtml = `<span class="mkt-badge-down" title="Thấp hơn 20% so với trung bình">▼ ${row.deltaPct.toFixed(1)}%</span>`;
                  }

                  const isHighlightGold = false;

                  return `
                    <tr style="${isHighlightGold ? 'background:#fefce8' : ''}">
                      <td>
                        <strong>${esc(row.name)}</strong>
                        ${hubState.activePersona === 'sales' ? '<small style="display:block">Gọi lần đầu TB: ' + (row.avgCallMinutes == null ? 'Chưa ghi giờ gọi' : fmtNum(row.avgCallMinutes) + ' phút') + '</small>' : ''}
                        ${isHighlightGold ? ' <span class="mkt-pill-gold">⭐ Khung vàng</span>' : ''}
                        ${row.name.includes('(IP 4G)') ? ' <span class="mkt-pill-cell">(IP 4G)</span>' : ''}
                      </td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace)">${fmtNum(row.total)}</td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace)">${fmtNum(row.called)}</td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace)">${fmtNum(row.connected)}</td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace);font-weight:700;color:${row.connRate >= connectionRate ? '#059669' : '#dc2626'}">
                        ${fmtPct(row.connRate)}
                      </td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace)">${fmtNum(row.interested)}</td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace);font-weight:700;color:#d97706">${fmtNum(row.converted)}</td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace)">${fmtMoney(row.revenue)}</td><td style="text-align:right">${fmtMoney(row.deposit)}</td>
                      <td style="text-align:center">${badgeHtml}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Nội dung Tab 3: Content & QC Hiệu Quả
    function renderContentView() {
      return `
        <div class="mkt-table-card">
          <div class="mkt-table-head">
            <span class="mkt-table-title">XẾP HẠNG CONTENT &amp; CHIẾN DỊCH QUẢNG CÁO HIỆU QUẢ</span>
            <span style="font-size:12px;color:#64748b">Đo lường kết nối/chốt từ CRM; chi phí chỉ hiện khi đã đồng bộ chi phí QC thật</span>
          </div>
          <div class="mkt-table-wrap">
            <table class="mkt-table">
              <thead>
                <tr>
                  <th style="width:40px">Top</th>
                  <th>Tiêu đề / Mẫu Quảng Cáo</th>
                  <th style="text-align:right">Tổng Data</th>
                  <th style="text-align:right">Kết nối được</th>
                  <th style="text-align:right">Tỷ lệ kết nối</th>
                  <th style="text-align:right">Khách chốt</th>
                  <th style="text-align:right">Chi phí QC thật</th>
                  <th style="text-align:right">CPL Kết Nối</th><th style="text-align:right">CPL Chốt</th><th style="text-align:right">Vốn nạp VND</th>
                  <th style="text-align:right">Doanh thu QC</th>
                  <th>Đánh giá</th>
                </tr>
              </thead>
              <tbody>
                ${contentGroups.map((ad, idx) => {
                  const rankIcon = idx === 0 ? '🥇 #1' : idx === 1 ? '🥈 #2' : idx === 2 ? '🥉 #3' : `#${idx + 1}`;
                  return `
                    <tr>
                      <td style="font-weight:800;color:${idx === 0 ? '#d97706' : '#64748b'}">${rankIcon}</td>
                      <td><strong>${esc(ad.title || ad.name)}</strong><small style="display:block;max-width:280px;white-space:normal">${esc(ad.body)}</small></td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace)">${fmtNum(ad.total)}</td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace);font-weight:700;color:#059669">${fmtNum(ad.connected)}</td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace)">${fmtPct(ad.connRate)}</td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace);font-weight:700;color:#d97706">${fmtNum(ad.converted)}</td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace)">${ad.spendAvailable ? fmtMoney(ad.estimatedSpend) : 'Chưa có chi phí QC'}</td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace);font-weight:700;color:#2563eb">${ad.spendAvailable && ad.cplConnected != null ? fmtMoney(ad.cplConnected) : '—'}</td><td style="text-align:right">${ad.cplDeposit != null ? fmtMoney(ad.cplDeposit) : '—'}</td><td style="text-align:right">${fmtMoney(ad.deposit)}</td>
                      <td style="text-align:right;font-family:var(--font-mono,monospace)">${fmtMoney(ad.revenue)}</td>
                      <td>
                        ${ad.isSmallSample ? '<span class="mkt-badge-sample">Mẫu nhỏ (&lt;10)</span>' : ad.converted > 0 ? '<span class="mkt-badge-up">Có chuyển đổi</span>' : ad.connected >= 2 ? '<span class="mkt-badge-neutral">Tốt</span>' : '<span class="mkt-badge-down">Cần tối ưu</span>'}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Nội dung Tab 4: Facebook Nhân Khẩu Học
    function renderFacebookView() {
      if (facebookDemographics.length) return `<div class="mkt-table-card"><div class="mkt-table-head"><span class="mkt-table-title">FACEBOOK ADS · SỐ TỔNG THEO QUẢNG CÁO</span></div><p style="padding:0 16px;font-size:12px">Số liệu tổng hợp từ nguồn Facebook, không gắn tuổi hay giới tính cho từng khách CRM. Bộ lọc khách CRM không áp dụng cho số tổng Facebook.</p><div class="mkt-table-wrap"><table class="mkt-table"><thead><tr><th>Quảng cáo</th><th>Tuổi</th><th>Giới tính</th><th>Tỉnh/TP</th><th>Hiển thị</th><th>Tiếp cận</th><th>Lead FB</th></tr></thead><tbody>${facebookDemographics.map(row=>`<tr><td>${esc(row.ad_title || row.ad_id || row.utm_content || 'Chưa gắn QC')}</td><td>${esc(row.age || row.age_range || '—')}</td><td>${esc(row.gender || '—')}</td><td>${esc(row.province || '—')}</td><td>${row.impressions == null ? '—' : fmtNum(row.impressions)}</td><td>${row.reach == null ? '—' : fmtNum(row.reach)}</td><td>${row.leads == null ? '—' : fmtNum(row.leads)}</td></tr>`).join('')}</tbody></table></div></div>`;
      return `
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 16px;margin-bottom:16px;color:#9a3412;font-size:12.5px"><strong>Chưa có dữ liệu tổng hợp từ Facebook Ads.</strong> Các nhóm bên dưới là chân dung ước tính từ CRM, không đại diện cho số liệu Facebook báo cáo theo quảng cáo.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px">
          <!-- Chỉ hiển thị số tổng Facebook khi có nguồn Facebook Ads thật -->
          <div class="mkt-table-card">
            <div class="mkt-table-head">
              <span class="mkt-table-title">PHÂN BỔ ĐỘ TUỔI · CRM THAM KHẢO</span>
            </div>
            <div style="padding:16px">
              ${dimensions.ageRanges.map(a => `
                <div style="margin-bottom:12px">
                  <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
                    <span>${esc(a.name)}</span>
                    <span><strong>${a.total} data</strong> (${fmtPct(totalData > 0 ? (a.total / totalData * 100) : 0)})</span>
                  </div>
                  <div class="mkt-kpi-bar">
                    <div class="mkt-kpi-bar-inner" style="width:${totalData > 0 ? (a.total / totalData * 100) : 0}%;background:#2563eb"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Giới tính -->
          <div class="mkt-table-card">
            <div class="mkt-table-head">
              <span class="mkt-table-title">PHÂN BỔ GIỚI TÍNH · CRM THAM KHẢO</span>
            </div>
            <div style="padding:16px">
              ${dimensions.genders.map(g => `
                <div style="margin-bottom:12px">
                  <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
                    <span>${esc(g.name)}</span>
                    <span><strong>${g.total} data</strong> (${fmtPct(totalData > 0 ? (g.total / totalData * 100) : 0)})</span>
                  </div>
                  <div class="mkt-kpi-bar">
                    <div class="mkt-kpi-bar-inner" style="width:${totalData > 0 ? (g.total / totalData * 100) : 0}%;background:${g.key === 'Nam' ? '#0284c7' : '#ec4899'}"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    // Nội dung Tab 5: AI Insight Khách Hàng
    function renderAiInsightView() {
      return `
        <div class="mkt-ai-card">
          <div class="mkt-ai-header">
            <span class="mkt-ai-tag">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
              INSIGHT TỰ ĐỘNG TỪ DỮ LIỆU CRM
            </span>
            <span style="font-size:11.5px;color:#64748b">Cập nhật: <strong>${esc(aiInsight.generatedAt)}</strong></span>
          </div>

          <div class="mkt-ai-quote">
            "${esc(aiInsight.summaryHeadline)}"
          </div>

          <div class="mkt-ai-section">
            <div class="mkt-ai-sectitle">1. Nhận định Chân dung khách hàng nạp tiền</div>
            <p class="mkt-ai-text">${esc(aiInsight.personaInsight)}</p>
          </div>

          <div class="mkt-ai-section">
            <div class="mkt-ai-sectitle">2. Đánh giá Content &amp; Quảng cáo</div>
            <p class="mkt-ai-text">${esc(aiInsight.contentInsight)}</p>
          </div>

          <div class="mkt-ai-section">
            <div class="mkt-ai-sectitle">3. Rào cản tâm lý chính khi tiếp cận</div>
            <p class="mkt-ai-text">${esc(aiInsight.objectionInsight)}</p>
          </div>

          <div class="mkt-ai-section" style="margin-top:18px">
            <div class="mkt-ai-sectitle">4. Khuyến nghị hành động tối ưu cho tuần tới</div>
            <div class="mkt-ai-recs">
              ${aiInsight.actionableRecommendations.map((rec, i) => `
                <div class="mkt-ai-rec-box">
                  <div class="mkt-ai-rec-num">${i + 1}</div>
                  <div style="font-size:12.5px;color:#334155;line-height:1.5">${esc(rec)}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Thanh lệnh nhanh mô phỏng bot Telegram -->
          <div class="mkt-bot-bar">
            <span style="font-size:12px;font-weight:700;color:#64748b">Lệnh tra cứu nhanh:</span>
            <button type="button" class="mkt-bot-cmd" data-bot-cmd="/insight">/insight</button>
            <button type="button" class="mkt-bot-cmd" data-bot-cmd="/chandung">/chandung</button>
            <button type="button" class="mkt-bot-cmd" data-bot-cmd="/content">/content</button>
          </div>

          ${hubState.botCommandOutput ? `
            <div style="margin-top:14px;padding:14px;background:#ffffff;border:1px solid #bfdbfe;border-radius:10px;font-size:13px;color:#1e3a8a">
              <div style="font-weight:800;margin-bottom:6px">Phản hồi lệnh ${esc(hubState.botCommandOutput.command)}:</div>
              <div style="white-space:pre-wrap;line-height:1.6">${esc(hubState.botCommandOutput.text)}</div>
            </div>
          ` : ''}
        </div>
      `;
    }

    const demoApi=options.demo===true;
    const apiBase=typeof location!=='undefined'?location.origin:'';
    // Nội dung Tab 6: Tích Hợp API Dev CRM
    function renderApiDevView() {
      return `
        <div class="mkt-api-view" style="padding:22px 0">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
            <div>
              <h3 style="margin:0;font-size:16px;color:#0f172a">API CRM CHO DEV &amp; GOOGLE APPS SCRIPT</h3>
              <p style="margin:4px 0 0;font-size:12.5px;color:#64748b">Đặc tả API GET có xác thực API Key trả về danh sách khách hàng đầy đủ trường để kết nối Persona &amp; Dashboard.</p>
            </div>
            <button type="button" class="mkt-btn mkt-btn-primary" id="mktBtnTestApiLive">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              Gửi Test API Ngay
            </button>
          </div>

          <div style="margin-bottom:18px">
            <h4 style="font-size:13px;color:#1e40af;margin-bottom:6px">1. Cấu hình Google Apps Script / Thuộc tính tập lệnh (Script Properties):</h4>
            <div class="mkt-code-box">
CRM_EXPORT_URL = ${esc(apiBase)}/api/leads/export
CRM_LOOKUP_URL = ${esc(apiBase)}/api/customer
CRM_API_KEY    = ${demoApi?'crm_secret_marketing_key_2026':'&lt;khóa riêng do Admin cấu hình&gt;'}
CRM_AUTH_HEADER = x-api-key
CRM_TEST_PHONE = ${esc(records[0]?.raw.phone || '&lt;SĐT có thật trong CRM&gt;')}
CRM_EXTRA_FIELDS = course,capital_range,experience,market_interest,main_interest,main_objection,tinh_trang_nhan_tai_lieu
            </div>
          </div>

          <div style="margin-bottom:18px">
            <h4 style="font-size:13px;color:#1e40af;margin-bottom:6px">2. Endpoint xuất danh sách khách có phân trang và lọc:</h4>
            <div class="mkt-code-box">
GET /api/leads/export?since=2026-01-01&page=1&limit=50
Headers:
  x-api-key: ${demoApi?'crm_secret_marketing_key_2026':'&lt;CRM_API_KEY&gt;'}
            </div>
          </div>

          <div style="margin-bottom:18px">
            <h4 style="font-size:13px;color:#1e40af;margin-bottom:6px">3. Endpoint tra cứu 1 khách hàng theo Số Điện Thoại:</h4>
            <div class="mkt-code-box">
GET /api/customer?phone=0987654321
Headers:
  x-api-key: ${demoApi?'crm_secret_marketing_key_2026':'&lt;CRM_API_KEY&gt;'}
            </div>
          </div>

          <label style="display:block;margin:12px 0">API key dùng kiểm tra <input id="mktApiKey" type="password" autocomplete="off" value="${demoApi?'crm_secret_marketing_key_2026':''}" placeholder="Nhập CRM_API_KEY do Admin cấp"></label>
          <div id="mktApiLiveResult" style="display:none;margin-top:16px">
            <div style="font-weight:700;font-size:13px;margin-bottom:6px;color:#059669">✅ Kết quả phản hồi thực tế từ API máy chủ:</div>
            <pre class="mkt-code-box" id="mktApiLivePre" style="max-height:240px;overflow-y:auto"></pre>
          </div>
        </div>
      `;
    }

    function renderStaffRankingView() { const rows=analyzeStaffRanking(rawData); let html='<div class=\"mkt-table-card\"><div class=\"mkt-table-head\"><span class=\"mkt-table-title\">STAFF RANKING</span></div><p style=\"padding:12px 18px;font-size:12px;color:#475569\">Metrics: connection, conversion, note coverage and first-call processing time. Small samples are flagged.</p><div class=\"mkt-table-wrap\"><table class=\"mkt-table\"><thead><tr><th>Rank</th><th>Sale</th><th>Data</th><th>Connect</th><th>Convert</th><th>Notes</th><th>Minutes</th><th>Score</th><th>Confidence</th></tr></thead><tbody>'; rows.forEach(function(r){html+='<tr><td>#'+r.rank+'</td><td><strong>'+esc(r.sale)+'</strong></td><td>'+fmtNum(r.total)+'</td><td>'+(r.connection_rate==null?'?':fmtPct(r.connection_rate))+'</td><td>'+(r.conversion_rate==null?'?':fmtPct(r.conversion_rate))+'</td><td>'+fmtPct(r.note_coverage)+'</td><td>'+(r.avg_processing_minutes==null?'?':fmtNum(r.avg_processing_minutes))+'</td><td>'+(r.score==null?'?':r.score)+'</td><td>'+esc(r.confidence)+'</td></tr>';}); return html+'</tbody></table></div></div>'; }
    function renderCustomerAiView() { let html='<div class=\"mkt-table-card\"><div class=\"mkt-table-head\"><span class=\"mkt-table-title\">CUSTOMER NOTE ANALYSIS</span></div><div class=\"mkt-table-wrap\"><table class=\"mkt-table\"><thead><tr><th>Customer</th><th>Sale</th><th>Connection</th><th>Interest</th><th>Last note</th><th>AI endpoint</th></tr></thead><tbody>'; records.slice(0,50).forEach(function(r){const note=(r.raw.notes||[]).slice(-1)[0];html+='<tr><td><strong>'+esc(r.raw.name||'Unknown')+'</strong><small style=\"display:block\">'+esc(r.raw.id)+'</small></td><td>'+esc(r.saleName)+'</td><td>'+esc(r.conn.label)+'</td><td>'+(r.interested?'Yes':'Unknown')+'</td><td style=\"max-width:320px;white-space:normal\">'+esc(note?.content||r.conn.detail||'No note')+'</td><td><code>/api/marketing/customer-analysis?customer_id='+encodeURIComponent(r.raw.id)+'&amp;ai=1</code></td></tr>';}); return html+'</tbody></table></div></div>'; }
    // Render toàn bộ Hub vào Host
    let activeContentHtml = '';
    if (hubState.activeTab === 'funnel') activeContentHtml = renderFunnelView();
    else if (hubState.activeTab === 'persona') activeContentHtml = renderPersonaView();
    else if (hubState.activeTab === 'content') activeContentHtml = renderContentView();
    else if (hubState.activeTab === 'facebook') activeContentHtml = renderFacebookView();
    else if (hubState.activeTab === 'ai_insight') activeContentHtml = renderAiInsightView();
    else if (hubState.activeTab === 'api_dev') activeContentHtml = renderApiDevView();
    else if (hubState.activeTab === 'staff_ranking') activeContentHtml = renderStaffRankingView();
    else if (hubState.activeTab === 'customer_ai') activeContentHtml = renderCustomerAiView();

    host.innerHTML = `
      <div class="mkt-container">
        ${headerHtml}
        <div class="mkt-actions" style="margin-bottom:18px"><input id="mktSearch" type="search" placeholder="Tìm tên, SĐT, Sale, ghi chú" value="${esc(hubState.searchQuery)}" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px"><select id="mktSource" class="mkt-btn mkt-btn-secondary"><option value="">Tất cả nguồn</option>${sources.map(source => `<option value="${esc(source)}" ${source === hubState.source ? 'selected' : ''}>${esc(source)}</option>`).join('')} </select><select id="mktConnection" class="mkt-btn mkt-btn-secondary">${[['','Tất cả kết nối'],['CONNECTED','Kết nối được'],['NOT_CONNECTED','Không kết nối'],['UNCONNECTED_YET','Chưa gọi'],['UNKNOWN','Chưa rõ']].map(([id,label])=>`<option value="${id}" ${hubState.connection===id?'selected':''}>${label}</option>`).join('')} </select><label>Từ ngày <input type="date" id="mktFrom" value="${esc(hubState.fromDate)}"></label><label>Đến ngày <input type="date" id="mktTo" value="${esc(hubState.toDate)}"></label></div>
        ${kpiHtml}
        ${navTabsHtml}
        <div id="mktTabBody">
          ${activeContentHtml}
          ${hubState.activeTab==='funnel' ? '<div class="mkt-actions"><button class="mkt-btn mkt-btn-secondary" id="mktPrev" '+(hubState.page<=1?'disabled':'')+'>Trang trước</button><span>Trang '+hubState.page+' / '+Math.max(1,Math.ceil(records.length/50))+' · 50 khách/trang</span><button class="mkt-btn mkt-btn-secondary" id="mktNext" '+(hubState.page*50>=records.length?'disabled':'')+'>Trang sau</button></div>' : ''}
        </div>
      </div>
    `;

    // Gắn Event Handlers
    for (const [id,key] of [['mktSearch','searchQuery'],['mktSource','source'],['mktConnection','connection'],['mktFrom','fromDate'],['mktTo','toDate']]) { const node=host.querySelector('#'+id); if(node)node.onchange=()=>{hubState[key]=node.value;hubState.page=1;render(host,rawData,options);}; }
    const searchInput=host.querySelector('#mktSearch');if(searchInput)searchInput.oninput=()=>{const at=searchInput.selectionStart;hubState.searchQuery=searchInput.value;hubState.page=1;render(host,rawData,options);const fresh=host.querySelector('#mktSearch');fresh.focus();try{fresh.setSelectionRange(at,at);}catch{}};
    const prev=host.querySelector('#mktPrev'),next=host.querySelector('#mktNext');
    if(prev)prev.onclick=()=>{hubState.page--;render(host,rawData,options);};if(next)next.onclick=()=>{hubState.page++;render(host,rawData,options);};
    const exportButton=host.querySelector('#mktExportCsv');if(exportButton)exportButton.onclick=()=>downloadCsv(analysis,hubState.activeTab,hubState.activePersona);
    const timeFilter = host.querySelector('#mktTimeFilter');
    if (timeFilter) timeFilter.onchange = () => { hubState.timeFilter = timeFilter.value; hubState.page = 1; render(host, rawData, options); };

    // Đổi tab chính
    host.querySelectorAll('[data-mkt-tab]').forEach(btn => {
      btn.onclick = () => {
        hubState.activeTab = btn.dataset.mktTab;
        render(host, rawData, options);
      };
    });

    // Đổi tab con Persona
    host.querySelectorAll('[data-mkt-persona]').forEach(btn => {
      btn.onclick = () => {
        hubState.activePersona = btn.dataset.mktPersona;
        render(host, rawData, options);
      };
    });

    // Nút Refresh
    const refreshBtn = host.querySelector('#mktBtnRefresh');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        if (typeof options.onRefresh === 'function') options.onRefresh();
        else window.location.reload();
      };
    }

    // Nút Run AI
    const runAiBtn = host.querySelector('#mktBtnRunAi');
    if (runAiBtn) {
      runAiBtn.onclick = () => {
        hubState.activeTab = 'ai_insight';
        render(host, rawData, options);
      };
    }

    // Lệnh nhanh Bot
    host.querySelectorAll('[data-bot-cmd]').forEach(btn => {
      btn.onclick = () => {
        const cmd = btn.dataset.botCmd;
        let text = '';
        if (cmd === '/insight') {
          text = aiInsight.summaryHeadline + '\n\n' + aiInsight.personaInsight;
        } else if (cmd === '/chandung') {
          text = aiInsight.summaryHeadline + '\n\n' + aiInsight.personaInsight;
        } else if (cmd === '/content') {
          const top = contentGroups[0];
          text = top ? `Top 1 Content: "${top.name}" mang về ${top.connected} kết nối (${top.connRate.toFixed(1)}%), ${top.cplConnected != null ? 'CPL kết nối ' + top.cplConnected.toLocaleString('vi-VN') + ' đ.' : 'chưa tính được CPL kết nối.'}` : 'Chưa có đủ dữ liệu content.';
        }
        hubState.botCommandOutput = { command: cmd, text };
        render(host, rawData, options);
      };
    });

    // Test API live
    const testApiBtn = host.querySelector('#mktBtnTestApiLive');
    if (testApiBtn) {
      testApiBtn.onclick = async () => {
        testApiBtn.disabled = true;
        testApiBtn.textContent = 'Đang gọi API...';
        try {
          const res = await fetch('/api/leads/export?limit=3', {
            headers: { 'x-api-key': host.querySelector('#mktApiKey')?.value.trim() || '' }
          });
          const json = await res.json();
          if (!res.ok) throw Error(json.error || 'API trả lỗi ' + res.status);
          const pre = host.querySelector('#mktApiLivePre');
          const box = host.querySelector('#mktApiLiveResult');
          if (pre && box) {
            box.style.display = 'block';
            pre.textContent = JSON.stringify(json, null, 2);
          }
        } catch (err) {
          alert('Lỗi gọi API: ' + err.message);
        } finally {
          testApiBtn.disabled = false;
          testApiBtn.textContent = 'Gửi Test API Ngay';
        }
      };
    }
  }

  return {
    PROVINCES_34,
    prepareData,
    timestampMs,
    fieldValue,
    levelOf,
    orderCollected,
    detectCarrier,
    detectDeviceAndOs,
    normalizeProvince,
    evaluateConnectionStatus,
    isInterestedCustomer,
    isConvertedCustomer,
    analyzeData,
    generateAiInsight,
    analyzeStaffRanking,
    render
  };
});

