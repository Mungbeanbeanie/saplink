#pragma once

#include "packet_schema.h"

// Contract B (alerts) transport. Contract A (readings) stays inline in
// combo_main.cpp's wifiUp()/post() -- this class is not a rewrite of that,
// just the alert-plane counterpart plan.md's Phase 3 calls for.
class CloudClient {
 public:
  bool begin();
  bool postAlert(const PacketSchema &pkt);

  // DIVERGES from plan.md's literal `bool pollPendingAlert(PacketSchema& out)`:
  // adds an `alert_id` out-param. PacketSchema is Contract B's wire payload
  // (node_id/event_type/voltage_mv/threshold_mv/timestamp_ms) -- it carries no
  // row identity, so without this, ackAlert() below would have no id to ack.
  // See plan.md Phase 3's note for the full explanation.
  bool pollPendingAlert(PacketSchema &out, int &alert_id);

  bool ackAlert(int alert_id);
};
