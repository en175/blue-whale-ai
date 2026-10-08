package com.bluewhale.billing.adapter.outbound.persistence.mapper;

import com.bluewhale.billing.adapter.outbound.persistence.row.TransactionRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TransactionMapper {

    List<TransactionRow> selectPage(@Param("userId") Long userId,
                                    @Param("typeFilter") List<String> typeFilter,
                                    @Param("offset") long offset,
                                    @Param("limit") int limit);

    long countPage(@Param("userId") Long userId,
                   @Param("typeFilter") List<String> typeFilter);
}
