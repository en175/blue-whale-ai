package com.bluewhale.billing.ledger;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 预扣预留的持久化（《计费逻辑详细设计》§2.4）。
 *
 * <p>{@code allocations} 以 JSON 列存储。**列里的内容不参与 SQL 条件**——
 * 它是一份「当时怎么分的」快照，读取方只有 Java 一侧，所以用 JSON 而不是拆表：
 * 拆表会让每次预扣多插 N 行明细，收益只是一次根本不会发生的按明细查询。
 */
@Repository
public class ReservationRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper = new ObjectMapper();

    public ReservationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private final RowMapper<Reservation> mapper0 = (rs, rowNum) -> new Reservation(
            rs.getLong("id"),
            rs.getLong("generation_job_id"),
            rs.getLong("user_id"),
            rs.getLong("reserved_credits"),
            rs.getObject("actual_credits") == null ? null : rs.getLong("actual_credits"),
            Reservation.Status.of(rs.getString("status")),
            readAllocations(rs.getString("allocations")),
            rs.getInt("catalog_version"),
            rs.getString("release_note"));

    private static final String COLUMNS =
            "id, generation_job_id, user_id, reserved_credits, actual_credits, status, "
                    + "allocations, catalog_version, release_note";

    /**
     * 建预留。幂等键是 {@code uk_reservation__job}（job_id 唯一）——
     * 同一个 job 不可能有两条预留，重复预扣靠它拦下。
     */
    public long insert(long jobId, long userId, long reservedCredits,
                       int catalogVersion, List<Allocation> allocations) {
        jdbc.update("INSERT INTO billing_cost_reservations "
                        + "(generation_job_id, user_id, reserved_credits, status, allocations, catalog_version) "
                        + "VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)",
                jobId, userId, reservedCredits, Reservation.Status.HELD.key(),
                writeAllocations(allocations), catalogVersion);
        return jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
    }

    public Optional<Reservation> findByJobId(long jobId) {
        var rows = jdbc.query(
                "SELECT " + COLUMNS + " FROM billing_cost_reservations WHERE generation_job_id = ?",
                mapper0, jobId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /**
     * 取出并**锁住**该 job 的预留。
     *
     * <p>结算与返还是两条并发路径（任务完成回调 vs 超时兜底扫描），都可能同时到达。
     * 没有这把行锁，两者会各自读到 {@code held}，各自解冻一次——同一笔钱退两遍。
     */
    public Reservation lockByJobId(long jobId) {
        var rows = jdbc.query(
                "SELECT " + COLUMNS + " FROM billing_cost_reservations "
                        + "WHERE generation_job_id = ? FOR UPDATE",
                mapper0, jobId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public void markSettled(long jobId, long actualCredits) {
        jdbc.update("UPDATE billing_cost_reservations "
                        + "SET status = ?, actual_credits = ?, version = version + 1 "
                        + "WHERE generation_job_id = ?",
                Reservation.Status.SETTLED.key(), actualCredits, jobId);
    }

    public void markReleased(long jobId, String releaseNote) {
        jdbc.update("UPDATE billing_cost_reservations "
                        + "SET status = ?, actual_credits = 0, release_note = ?, version = version + 1 "
                        + "WHERE generation_job_id = ?",
                Reservation.Status.RELEASED.key(), releaseNote, jobId);
    }

    private String writeAllocations(List<Allocation> allocations) {
        try {
            return mapper.writeValueAsString(allocations);
        } catch (Exception e) {
            // 分配明细都是 long，序列化不可能失败；真失败说明是致命的编码问题
            throw new IllegalStateException("预扣分配明细无法序列化", e);
        }
    }

    private List<Allocation> readAllocations(String json) {
        try {
            return mapper.readValue(json, new TypeReference<List<Allocation>>() {});
        } catch (Exception e) {
            // ⚠️ 刻意不「读不出来就当空」：空分配会让结算解冻不到任何批次，
            //    冻结量永久留在账户上。宁可当场炸，也不要静默错账。
            throw new IllegalStateException("预扣分配明细无法解析：" + json, e);
        }
    }
}
