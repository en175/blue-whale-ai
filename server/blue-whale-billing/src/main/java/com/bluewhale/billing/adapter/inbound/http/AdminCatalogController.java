package com.bluewhale.billing.adapter.inbound.http;

import com.bluewhale.billing.application.CatalogHolder;
import com.bluewhale.billing.application.CatalogPublisher;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/admin/catalogs")
@ConditionalOnProperty(name = "billing.admin.enabled", havingValue = "true")
public class AdminCatalogController {

    private final CatalogPublisher publisher;
    private final CatalogHolder holder;

    public AdminCatalogController(CatalogPublisher publisher, CatalogHolder holder) {
        this.publisher = publisher;
        this.holder = holder;
    }

    @PostMapping
    public Map<String, Object> publish(@RequestBody String documentJson,
                                       @RequestParam(defaultValue = "admin") String publishedBy,
                                       @RequestParam(defaultValue = "") String note) {
        int version = publisher.publish(documentJson, publishedBy, note);
        return Map.of(
                "catalogVersion", version,
                "documentHash", holder.currentDocumentHash(),
                "creditsPerYuan", holder.currentCreditsPerYuan());
    }
}
