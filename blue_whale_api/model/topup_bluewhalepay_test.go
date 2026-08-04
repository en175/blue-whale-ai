package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestWayCodeToPaymentMethod 覆盖 wayCode 前缀→渠道族的映射与未知值兜底（ADR-0065）。
func TestWayCodeToPaymentMethod(t *testing.T) {
	cases := []struct {
		wayCode string
		want    string
	}{
		{"ALI_QR", PaymentMethodAlipay},
		{"ALI_JSAPI", PaymentMethodAlipay},
		{"ALI_PC", PaymentMethodAlipay},
		{"WX_NATIVE", PaymentMethodWxpay},
		{"WX_JSAPI", PaymentMethodWxpay},
		{"", PaymentMethodBlueWhalePay},
		{"UNKNOWN", PaymentMethodBlueWhalePay},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, WayCodeToPaymentMethod(c.wayCode), "wayCode=%q", c.wayCode)
	}
}

// TestReconcilePaymentMethodFromIfCode 覆盖回调 ifCode 权威校正：已知渠道族覆盖、
// 一致保持、未知 ifCode 保持现值（ADR-0065）。
func TestReconcilePaymentMethodFromIfCode(t *testing.T) {
	cases := []struct {
		current string
		ifCode  string
		want    string
	}{
		// 已知 ifCode 与建单不一致 → 覆盖（回调权威）
		{"bluewhalepay", "alipay", "alipay"},
		{"alipay", "wxpay", "wxpay"},
		// 一致 → 保持
		{"alipay", "alipay", "alipay"},
		// 未知 / 空 ifCode → 保持现值（防未知渠道写脏）
		{"bluewhalepay", "ysfpay", "bluewhalepay"},
		{"alipay", "", "alipay"},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, ReconcilePaymentMethodFromIfCode(c.current, c.ifCode), "current=%q ifCode=%q", c.current, c.ifCode)
	}
}

// TestRechargeBlueWhalePayCorrectsPaymentMethodFromIfCode 验证回调 ifCode 在校正通道内
// 覆盖建单渠道，并随 pending→success 原子过渡持久化 + 按量入账（ADR-0065）。
func TestRechargeBlueWhalePayCorrectsPaymentMethodFromIfCode(t *testing.T) {
	truncateTables(t)

	require.NoError(t, DB.Create(&User{
		Id:       91001,
		Username: "bwp_recharge_test",
		Status:   common.UserStatusEnabled,
		Quota:    0,
	}).Error)

	tradeNo := "BWP91001test"
	require.NoError(t, DB.Create(&TopUp{
		UserId:          91001,
		Amount:          10,
		Money:           10.0,
		TradeNo:         tradeNo,
		PaymentMethod:   PaymentMethodAlipay, // 建单渠道：支付宝
		PaymentProvider: PaymentProviderBlueWhalePay,
		CreateTime:      common.GetTimestamp(),
		Status:          common.TopUpStatusPending,
	}).Error)

	// 回调 ifCode=wxpay（与建单 alipay 不一致）→ 应覆盖为 wxpay
	require.NoError(t, RechargeBlueWhalePay(tradeNo, "1.2.3.4", PaymentMethodWxpay))

	topUp := GetTopUpByTradeNo(tradeNo)
	require.NotNil(t, topUp)
	assert.Equal(t, common.TopUpStatusSuccess, topUp.Status)
	assert.Equal(t, PaymentMethodWxpay, topUp.PaymentMethod)

	var user User
	require.NoError(t, DB.Where("id = ?", 91001).First(&user).Error)
	assert.Equal(t, int(float64(10)*common.QuotaPerUnit), user.Quota)
}

// TestRechargeBlueWhalePaySkipsReconcileOnAlreadySuccess 验证已成功订单走幂等返回：
// 不再重复入账、也不回写 payment_method（校正只在 pending→success 首次过渡生效，ADR-0065）。
func TestRechargeBlueWhalePaySkipsReconcileOnAlreadySuccess(t *testing.T) {
	truncateTables(t)

	require.NoError(t, DB.Create(&User{
		Id:       91002,
		Username: "bwp_recharge_idempotent",
		Status:   common.UserStatusEnabled,
		Quota:    0,
	}).Error)

	tradeNo := "BWP91002test"
	require.NoError(t, DB.Create(&TopUp{
		UserId:          91002,
		Amount:          10,
		Money:           10.0,
		TradeNo:         tradeNo,
		PaymentMethod:   PaymentMethodAlipay,
		PaymentProvider: PaymentProviderBlueWhalePay,
		CreateTime:      common.GetTimestamp(),
		CompleteTime:    common.GetTimestamp(),
		Status:          common.TopUpStatusSuccess, // 已是成功单
	}).Error)

	// 已成功订单再次回调：即使 ifCode 不同也应幂等返回，不改渠道、不入账
	require.NoError(t, RechargeBlueWhalePay(tradeNo, "1.2.3.4", PaymentMethodWxpay))

	topUp := GetTopUpByTradeNo(tradeNo)
	require.NotNil(t, topUp)
	assert.Equal(t, common.TopUpStatusSuccess, topUp.Status)
	assert.Equal(t, PaymentMethodAlipay, topUp.PaymentMethod) // 渠道未被回写

	var user User
	require.NoError(t, DB.Where("id = ?", 91002).First(&user).Error)
	assert.Equal(t, 0, user.Quota) // quota 未重复入账
}
