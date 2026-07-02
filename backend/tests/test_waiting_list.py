"""Waiting list core helpers."""
from waiting_list_core import build_summary


def test_build_summary_counts():
    entries = [
        {"status": "waiting"},
        {"status": "booked"},
        {"status": "cancelled"},
        {"status": "expired"},
    ]
    summary = build_summary(entries)
    assert summary["total"] == 4
    assert summary["booked"] == 1
    assert summary["cancelled"] == 1
    assert summary["conversion_rate"] == 25.0
