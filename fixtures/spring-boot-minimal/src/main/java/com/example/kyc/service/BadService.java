package com.example.kyc.service;

import java.util.Map;

import org.springframework.stereotype.Service;

/** Seeded violation: an untyped payload (SC-TYPE). Used by stackcrew end-to-end tests. */
@Service
public class BadService {

    private Map<String, Object> payload;

    public Map<String, Object> payload() {
        return payload;
    }
}
