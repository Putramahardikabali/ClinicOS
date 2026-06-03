"""Default commission rule seeding."""
import asyncio

from commissions import DEFAULT_TREATMENT_COMMISSION_RULE, ensure_default_commission_rules


class FakeCollection:
    def __init__(self):
        self.docs = []

    async def find_one(self, flt, projection=None):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in flt.items()):
                return dict(doc)
        return None

    async def update_one(self, flt, update):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in flt.items()):
                doc.update(update.get("$set", {}))
                return type("R", (), {"matched_count": 1})()
        return type("R", (), {"matched_count": 0})()

    async def insert_one(self, doc):
        self.docs.append(dict(doc))


class FakeDb:
    def __init__(self):
        self.commission_rules = FakeCollection()


def test_ensure_default_commission_rule_inserts_once():
    async def run():
        db = FakeDb()
        await ensure_default_commission_rules(db, "clinic-1")
        assert len(db.commission_rules.docs) == 1
        doc = db.commission_rules.docs[0]
        assert doc["rule_name"] == DEFAULT_TREATMENT_COMMISSION_RULE["rule_name"]
        assert doc["applies_to_role"] == "therapist"
        assert doc["priority"] == 999

        await ensure_default_commission_rules(db, "clinic-1")
        assert len(db.commission_rules.docs) == 1
        assert db.commission_rules.docs[0]["calculation_basis"] == "net"

    asyncio.run(run())
