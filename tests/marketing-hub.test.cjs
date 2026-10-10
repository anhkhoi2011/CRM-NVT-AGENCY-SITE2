'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MarketingHub = require('../marketing-hub.js');

test('MarketingHub engine - Nhận diện nhà mạng viễn thông chính xác', () => {
  assert.equal(MarketingHub.detectCarrier('0981234567'), 'Viettel');
  assert.equal(MarketingHub.detectCarrier('0912345678'), 'VinaPhone (VNPT)');
  assert.equal(MarketingHub.detectCarrier('0903456789'), 'MobiFone');
  assert.equal(MarketingHub.detectCarrier('0923456789'), 'Vietnamobile');
  assert.equal(MarketingHub.detectCarrier('84988112233'), 'Viettel');
});

test('MarketingHub engine - Chuẩn hóa tỉnh thành và phân biệt IP 4G', () => {
  assert.equal(MarketingHub.normalizeProvince('HN', false), 'Hà Nội');
  assert.equal(MarketingHub.normalizeProvince('TP HCM', false), 'TP. Hồ Chí Minh');
  assert.equal(MarketingHub.normalizeProvince('DN', false), 'Đà Nẵng');
  // Khi không có tỉnh trong CRM và dùng IP 4G trạm BTS
  assert.equal(MarketingHub.normalizeProvince('', true), 'Chưa rõ (IP 4G)');
});

test('MarketingHub engine - Phân loại đúng 3 trạng thái: Chưa gọi, Kết nối được, Không kết nối', () => {
  // 1. Chưa gọi
  const uncalled = MarketingHub.evaluateConnectionStatus({
    customFields: { callStatus: 'Chưa gọi' },
    note: ''
  });
  assert.equal(uncalled.isUncalled, true);
  assert.equal(uncalled.isConnected, false);

  // 2. Không kết nối (thuê bao)
  const notConn = MarketingHub.evaluateConnectionStatus({
    customFields: { callStatus: 'Thuê bao' },
    note: ''
  });
  assert.equal(notConn.isUncalled, false);
  assert.equal(notConn.isConnected, false);

  // 3. Kết nối được (nghe máy, quan tâm)
  const connected = MarketingHub.evaluateConnectionStatus({
    customFields: { callStatus: 'Đã nghe', customerLevel: 'L2' },
    note: 'Khách quan tâm đầu tư vàng'
  });
  assert.equal(connected.isUncalled, false);
  assert.equal(connected.isConnected, true);
});

test('MarketingHub engine - analyzeData tính toán tỷ lệ kết nối loại trừ data Chưa gọi', () => {
  const sampleCustomers = [
    { id: '1', name: 'A', phone: '0981111111', customFields: { callStatus: 'Chưa gọi' } }, // Chưa gọi
    { id: '2', name: 'B', phone: '0982222222', customFields: { callStatus: 'Đã nghe' } },   // Kết nối
    { id: '3', name: 'C', phone: '0983333333', customFields: { callStatus: 'Thuê bao' } }  // Không kết nối
  ];

  const analysis = MarketingHub.analyzeData({ customers: sampleCustomers });
  assert.equal(analysis.totalData, 3);
  assert.equal(analysis.uncalledData, 1);
  assert.equal(analysis.calledData, 2);
  assert.equal(analysis.connectedData, 1);
  // Tỷ lệ kết nối = 1 / 2 = 50% (không phải 1 / 3 = 33.3%)
  assert.equal(analysis.connectionRate, 50);
});

test('MarketingHub engine - Tự động sinh báo cáo AI Insight đầy đủ', () => {
  const sampleCustomers = [
    { id: '1', name: 'VIP', phone: '0981111111', customFields: { callStatus: 'Đã nghe', customerLevel: 'L5', age_range: '35–44', province: 'Hà Nội' } }
  ];
  const analysis = MarketingHub.analyzeData({ customers: sampleCustomers });
  assert.ok(analysis.aiInsight);
  assert.ok(analysis.aiInsight.summaryHeadline.length > 0);
  assert.ok(analysis.aiInsight.actionableRecommendations.length >= 3);
});


test('MarketingHub engine - dùng danh sách 34 tỉnh sau sáp nhập và ánh xạ tên cũ', () => {
  assert.equal(MarketingHub.PROVINCES_34.length, 34);
  assert.equal(MarketingHub.PROVINCES_34.includes('Bình Dương'), false);
  assert.equal(MarketingHub.normalizeProvince('Bình Dương'), 'TP. Hồ Chí Minh');
  assert.equal(MarketingHub.normalizeProvince('Quảng Nam'), 'Đà Nẵng');
});

test('MarketingHub engine - không bịa chi phí quảng cáo khi chưa có spend thật', () => {
  const analysis = MarketingHub.analyzeData({ customers: [{ id: '1', phone: '0900000001', source: 'Facebook Ads', campaign: 'C1', customFields: { callStatus: 'Đã nghe', customerLevel: 'L2', utm_content: 'AD-1' } }] });
  assert.equal(analysis.contentGroups[0].spendAvailable, false);
  assert.equal(analysis.contentGroups[0].estimatedSpend, null);
  assert.equal(analysis.contentGroups[0].cplConnected, null);
});

test('MarketingHub engine - Level sau kết nối vẫn thuộc nhóm kết nối', () => {
  const result = MarketingHub.evaluateConnectionStatus({ customFields: { customerLevel: 'L4.2' }, note: '' });
  assert.equal(result.isConnected, true);
  assert.equal(result.isUncalled, false);
});


test('MarketingHub engine - L5 tạo tài khoản chưa tính là nạp và L12.2 bị loại', () => {
  const analysis = MarketingHub.analyzeData({ customers: [
    { id: 'l5', phone: '0901111111', customFields: { callStatus: 'Đã nghe', customerLevel: 'L5' } },
    { id: 'dup', phone: '0902222222', customFields: { callStatus: 'Đã nghe', customerLevel: 'L12.2' } }
  ] });
  assert.equal(analysis.totalData, 1);
  assert.equal(analysis.excludedData, 1);
  assert.equal(analysis.totalConverted, 0);
});

test('MarketingHub engine - ghi chú CRM và first_call_at được dùng để đo kết nối/tốc độ gọi', () => {
  const analysis = MarketingHub.analyzeData({
    customers: [{ id: 'c1', phone: '0903333333', createdAt: '2026-10-01 10:00', first_call_at: '2026-10-01 10:12', customFields: { customerLevel: 'L1' } }],
    notes: [{ customerId: 'c1', text: 'Đã trao đổi và nhận contact', at: '2026-10-01 10:12' }]
  });
  assert.equal(analysis.connectedData, 1);
  assert.equal(Math.round(analysis.records[0].callDelayMinutes), 12);
});
