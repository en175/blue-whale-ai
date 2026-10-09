package com.bluewhale.billing.api;

import com.bluewhale.billing.application.MemberDiscountAdminService;
import com.bluewhale.billing.application.command.MemberDiscountUpsertCommand;
import com.bluewhale.billing.application.view.MemberDiscountView;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/admin/member-discounts")
@ConditionalOnProperty(name = "billing.admin.enabled", havingValue = "true")
public class AdminMemberDiscountController {

    private final MemberDiscountAdminService service;

    public AdminMemberDiscountController(MemberDiscountAdminService service) {
        this.service = service;
    }

    @GetMapping
    public List<MemberDiscountView> list(@RequestParam(name = "tier", required = false) String tier,
                                         @RequestParam(name = "status", required = false) String status) {
        return service.list(tier, status);
    }

    @PostMapping
    public MemberDiscountView create(@RequestBody MemberDiscountUpsertCommand command) {
        return service.create(command);
    }

    @PutMapping("/{id}")
    public MemberDiscountView update(@PathVariable long id,
                                     @RequestBody MemberDiscountUpsertCommand command) {
        return service.update(id, command);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable long id) {
        service.delete(id);
        return Map.of("id", id, "deleted", true);
    }
}
