package com.bluewhale.billing.infrastructure.persistence.mapper;

import com.bluewhale.billing.infrastructure.persistence.row.TransactionRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface TransactionMapper {

    List<TransactionRow> selectPage(@Param("userId") Long userId,
                                    @Param("typeFilter") List<String> typeFilter,
                                    @Param("createdFrom") LocalDateTime createdFrom,
                                    @Param("createdTo") LocalDateTime createdTo,
                                    @Param("generationJobIds") List<Long> generationJobIds,
                                    @Param("offset") long offset,
                                    @Param("limit") int limit);

    long countPage(@Param("userId") Long userId,
                   @Param("typeFilter") List<String> typeFilter,
                   @Param("createdFrom") LocalDateTime createdFrom,
                   @Param("createdTo") LocalDateTime createdTo,
                   @Param("generationJobIds") List<Long> generationJobIds);
}
