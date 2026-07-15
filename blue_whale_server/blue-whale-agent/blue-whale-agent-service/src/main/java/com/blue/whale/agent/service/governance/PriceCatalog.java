package com.blue.whale.agent.service.governance;

import java.util.Map;
import java.util.Optional;

@FunctionalInterface
public interface PriceCatalog {
    Optional<PriceQuote> quote(String actionType, Map<String, Object> arguments);
}
