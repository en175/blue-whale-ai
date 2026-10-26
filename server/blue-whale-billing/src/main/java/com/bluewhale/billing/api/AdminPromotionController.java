package com.bluewhale.billing.api;

import com.bluewhale.billing.application.PromotionAdminService;
import com.bluewhale.billing.application.command.PromotionUpsertCommand;
import com.bluewhale.billing.application.view.PromotionView;
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
@RequestMapping("/admin/promotions")
@ConditionalOnProperty(name = "billing.admin.enabled", havingValue = "true")
public class AdminPromotionController {

    private final PromotionAdminService service;

    public AdminPromotionController(PromotionAdminService service) {
        this.service = service;
    }

    @GetMapping
    public List<PromotionView> list(@RequestParam(name = "status", required = false) String status) {
        return service.list(status);
    }

    @PostMapping
    public PromotionView create(@RequestParam(name = "operator", defaultValue = "admin") String operator,
                                @RequestBody PromotionUpsertCommand command) {
        return service.create(command, operator);
    }

    @PutMapping("/{id}")
    public PromotionView update(@PathVariable long id, @RequestBody PromotionUpsertCommand command) {
        return service.update(id, command);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable long id) {
        service.delete(id);
        return Map.of("id", id, "deleted", true);
    }
}
