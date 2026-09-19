#pragma once

#include <cstdint>

// Contract B (see .claude/plan.md's "Locked contracts") -- the alert control
// plane, not yet wired to any backend route. Contract A (readings) is
// separate and already live; this file has no bearing on it.

enum class EventType : uint8_t {
  VP_SPIKE = 0,
  REPLAY_TRIGGER = 1,
};

struct PacketSchema {
  uint8_t node_id;
  EventType event_type;
  float voltage_mv;
  float threshold_mv;
  uint32_t timestamp_ms;
};

// JSON field values (must match whatever Pydantic model Phase 5's alert
// routes end up using, exactly, once that's designed).
inline const char *eventTypeToString(EventType t) {
  return t == EventType::VP_SPIKE ? "VP_SPIKE" : "REPLAY_TRIGGER";
}
