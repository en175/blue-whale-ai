package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

@Getter
@Setter
@Accessors(chain = true)
@TableName("cost_reservations")
public class CostReservation extends BaseEntity {
    private Long generationJobId;
    private Long userId;
    private Long projectId;
    private String actionIdentity;
    private String actionType;
    private String provider;
    private Long reservedAmountFen;
    private Long actualAmountFen;
    private String status;
    private String priceCatalogVersion;
    private String exchangeRateVersion;
    private String modelPolicyVersion;
    private String costRuleVersion;
}
