"""Repair treatment/package gift cards wrongly marked redeemed at purchase.

Usage (from backend directory with app venv):
  python -m scripts.repair_gift_card_entitlements
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient

from gift_card_models import repair_entitlement_gift_cards


async def main() -> None:
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "clinicos")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    count = await repair_entitlement_gift_cards(db)
    print(f"Repaired {count} entitlement gift card(s).")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
