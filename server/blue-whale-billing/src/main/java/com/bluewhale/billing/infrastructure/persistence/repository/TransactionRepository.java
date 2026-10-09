package com.bluewhale.billing.infrastructure.persistence.repository;

import com.bluewhale.billing.application.view.TransactionView;
import com.bluewhale.billing.infrastructure.persistence.mapper.TransactionMapper;
import com.bluewhale.billing.infrastructure.persistence.row.TransactionRow;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public class TransactionRepository {

    private final TransactionMapper mapper;

    public TransactionRepository(TransactionMapper mapper) {
        this.mapper = mapper;
    }

    public TransactionView.Page listPage(Long userId, List<String> typeFilter,
                                         LocalDateTime createdFrom, LocalDateTime createdTo,
                                         List<Long> generationJobIds, int size, int page) {
        List<String> filter = typeFilter == null || typeFilter.isEmpty() ? null : List.copyOf(typeFilter);
        List<Long> jobIds = generationJobIds == null || generationJobIds.isEmpty()
                ? null
                : List.copyOf(generationJobIds);

        long offset = (long) (Math.max(page, 1) - 1) * size;

        List<TransactionRow> rows = mapper.selectPage(userId, filter,
                createdFrom, createdTo, jobIds, offset, size);
        long total = mapper.countPage(userId, filter, createdFrom, createdTo, jobIds);

        return new TransactionView.Page(
                rows.stream().map(TransactionRepository::toView).toList(),
                total);
    }

    private static TransactionView toView(TransactionRow row) {
        return new TransactionView(
                row.getTxId(),
                row.getUserId() == null ? 0L : row.getUserId(),
                row.getType(),
                row.getDirection(),
                row.getTitle(),
                row.getAmount(),
                row.getReservedCredits(),
                row.getGenerationJobId(),
                row.getStatus(),
                row.getCreatedAt(),
                row.getSettledAt(),
                row.getLotSource(),
                row.getLotCreatedAt());
    }
}
