/* Shared totals and drill-down rows for the four accounting cards. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./order-payments.js'));
  else root.AccountingDetail=factory(root.OrderPayments);
})(typeof globalThis!=='undefined'?globalThis:this,function(payments){
  'use strict';
  const number=value=>Number(value)||0;
  const sum=(rows,key)=>rows.reduce((total,row)=>total+number(row[key]),0);
  const inPeriod=(date,period)=>period==='ALL'||String(date||'').slice(0,7)===period;
  function snapshot(input){
    const {period,orders=[],products=[],customers=[],members=[],personnel=[],expenses=[],groups=[]}=input;
    const byId=list=>new Map(list.map(item=>[String(item.id),item]));
    const productMap=byId(products),customerMap=byId(customers),memberMap=byId(members);
    const revenue=orders.flatMap(order=>payments.events(order).filter(event=>inPeriod(event.occurredAt,period)).map(event=>({
      date:event.occurredAt||'',code:order.code||order.id,customer:order.customerName||customerMap.get(String(order.customerId))?.name||'Khách hàng',
      product:order.productName||productMap.get(String(order.productId))?.name||'Sản phẩm đã ngừng sử dụng',
      kind:event.type==='REFUND'?'Hoàn tiền':event.kind==='DEPOSIT'?'Thu cọc':event.kind==='FULL'?'Thanh toán đủ':'Thu bổ sung',
      amount:event.amount,vat:event.vatAmount,net:event.netAmount
    }))).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const commissions=personnel.map(person=>{
      const finance=person.finance;
      return {name:person.name||person.id,role:{LV1:'Manager',LV2:'Leader',LV3:'Sale'}[person.roleLevel]||memberMap.get(String(person.id))?.role||'Nhân sự',
        lot:number(finance.hhLot)+number(finance.hhDownline),sale:number(finance.hhSaleProducts),trainer:number(finance.hhTrainer),
        leader:number(finance.hhLeaderCourse),bonus:number(finance.bonus),amount:number(finance.netIncome)};
    }).filter(row=>['lot','sale','trainer','leader','bonus','amount'].some(key=>row[key]!==0)).sort((a,b)=>b.amount-a.amount);
    const operating=expenses.filter(item=>inPeriod(item.month||item.date,period)).map(item=>({
      date:item.date||item.month||'',title:item.title||'Khoản chi',category:item.category||'Khác',
      payer:item.payer||memberMap.get(String(item.payerId))?.name||'Admin',note:item.note||'—',amount:number(item.amount)
    })).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const totalRevenue=sum(revenue,'net'),totalCommission=sum(commissions,'amount'),totalExpense=sum(operating,'amount');
    const profit=groups.filter(group=>number(group.totalRevenue)!==0).map(group=>({
      section:'Doanh thu',title:group.name+(group.cohortKey?' · '+group.cohortKey:''),note:group.categoryLabel||'Sản phẩm / dịch vụ',amount:number(group.totalRevenue)
    }));
    // Keep the P&L complete even when product grouping has not yet been synchronized.
    const revenueDifference=totalRevenue-sum(profit,'amount');
    if(revenueDifference)profit.push({section:'Doanh thu',title:'Thực thu khác',note:'Trước VAT',amount:revenueDifference});
    for(const [key,title] of [['lot','Hoa hồng lot & tuyến dưới'],['sale','Hoa hồng bán sản phẩm'],['trainer','Hoa hồng đào tạo'],['leader','Hoa hồng quản lý'],['bonus','Thưởng KPI']]){
      const amount=sum(commissions,key);if(amount)profit.push({section:'Hoa hồng',title,note:'Chi phí nhân sự',amount:-amount});
    }
    const expenseCategories=new Map();
    for(const row of operating)expenseCategories.set(row.category,(expenseCategories.get(row.category)||0)+row.amount);
    for(const [category,amount] of expenseCategories)profit.push({section:'Vận hành',title:category,note:operating.filter(row=>row.category===category).length+' khoản chi',amount:-amount});
    return {period,revenue,commissions,operating,profit,totalRevenue,totalCommission,totalExpense,netProfit:totalRevenue-totalCommission-totalExpense,
      cash:sum(revenue,'amount'),vat:sum(revenue,'vat'),margin:totalRevenue?(totalRevenue-totalCommission-totalExpense)/totalRevenue*100:0};
  }
  function table(snapshot,type){
    const definitions={
      revenue:{title:'Chi tiết doanh thu',description:'Các lần thu tiền và hoàn tiền trong kỳ. Doanh thu tính trước VAT.',rows:snapshot.revenue,total:snapshot.totalRevenue,amountKey:'net',columns:[['date','Ngày'],['code','Mã đơn'],['customer','Khách hàng'],['product','Sản phẩm'],['kind','Loại'],['amount','Thực thu',true],['vat','VAT',true],['net','Trước VAT',true]]},
      commission:{title:'Chi tiết chi phí hoa hồng',description:'Theo nhân sự: lot, bán sản phẩm, đào tạo, quản lý và thưởng. Hoa hồng sản phẩm chỉ ghi nhận khi đã xuất VAT.',rows:snapshot.commissions,total:snapshot.totalCommission,amountKey:'amount',columns:[['name','Nhân sự'],['role','Vai trò'],['lot','Lot & tuyến dưới',true],['sale','Bán sản phẩm',true],['trainer','Đào tạo',true],['leader','Quản lý',true],['bonus','Thưởng',true],['amount','Tổng',true]]},
      expense:{title:'Chi tiết chi phí vận hành',description:'Toàn bộ khoản chi trong kỳ, gồm cả các khoản đang ẩn bởi bộ lọc của sổ chi phí.',rows:snapshot.operating,total:snapshot.totalExpense,amountKey:'amount',columns:[['date','Ngày chi'],['title','Khoản chi'],['category','Danh mục'],['payer','Người chi / duyệt'],['note','Ghi chú'],['amount','Số tiền',true]]},
      profit:{title:'Chi tiết lợi nhuận ròng',description:'Doanh thu trước VAT − chi phí hoa hồng − chi phí vận hành. Số dương là thu, số âm là chi.',rows:snapshot.profit,total:snapshot.netProfit,amountKey:'amount',columns:[['section','Nhóm'],['title','Khoản mục'],['note','Diễn giải'],['amount','Thu / chi',true]]}
    };
    if(!definitions[type])throw Error('Unknown accounting detail');
    return definitions[type];
  }
  function filter(table,query){
    const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
    const text=normalize(query).trim();
    return text?table.rows.filter(row=>table.columns.some(([key])=>normalize(row[key]).includes(text))):table.rows;
  }
  return {snapshot,table,filter,sum};
});
