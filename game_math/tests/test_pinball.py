"""Verify fixed bonus prices, exact division and the actual Stake publication files."""

import json
from fractions import Fraction
from pathlib import Path

import pytest
import zstandard

from game_math.pinball import POWERS, award_for, balance_weights, make_event, theoretical_return

ROOT = Path(__file__).resolve().parents[2]
LIBRARY = ROOT / "game_math/library/publish_files"


def test_every_published_path_is_measured_native_physics_with_the_same_credit_operations() -> None:
    traces = json.loads((ROOT / "game_math/physics-traces.json").read_text())
    demo = json.loads((ROOT / "public/demo-books.json").read_text())
    by_key = {(t["power"], t["seed"]): t for t in traces}
    for round_data in demo["outcomes"]:
        event = round_data["state"][0]
        trace = by_key[event["power"], event["seed"]]
        assert event == make_event(trace)
        for recorded, measured in zip(event["path"], trace["path"], strict=True):
            for key in ("t", "x", "y", "floor", "left", "right", "score", "bank", "ops"):
                assert recorded[key] == measured[key]
        assert event["path"][-1]["y"] > 2388
        assert event["path"][-1]["bank"] == event["multiplier"]


def test_every_mode_upload_lookup_and_demo_have_identical_payouts_weights_and_exact_rtp() -> None:
    manifest = json.loads((LIBRARY / "index.json").read_text())
    demo = json.loads((ROOT / "public/demo-books.json").read_text())
    assert len(manifest["modes"]) == len(POWERS)
    decompressor = zstandard.ZstdDecompressor()
    for mode in manifest["modes"]:
        raw = decompressor.decompress((LIBRARY / mode["events"]).read_bytes())
        books = [json.loads(line) for line in raw.splitlines()]
        lookup = [
            tuple(map(int, line.split(",")))
            for line in (LIBRARY / mode["weights"]).read_text().splitlines()
        ]
        assert len(books) == len(lookup) >= 14
        paid = weight = 0
        for book, (book_id, frequency, payout) in zip(books, lookup, strict=True):
            assert book["id"] == book_id
            assert book["payoutMultiplier"] == payout == book["events"][0]["multiplier"]
            assert payout % 10 == 0 and frequency > 0
            index = next(
                i
                for i, r in enumerate(demo["outcomes"])
                if r["mode"] == mode["name"] and r["betID"] == book_id
            )
            assert demo["outcomes"][index]["state"] == book["events"]
            assert demo["weights"][index] == frequency
            paid += frequency * payout
            weight += frequency
        assert Fraction(paid, weight * 100) == theoretical_return() == Fraction(967, 1000)
        assert mode["cost"] == 1


def test_every_award_has_a_constant_price_and_dividers_halve_the_current_bank_exactly() -> None:
    demo = json.loads((ROOT / "public/demo-books.json").read_text())
    prices: dict[int, set[int]] = {}
    hits = set()
    genuine_reductions = 0
    bonuses = 0
    for round_data in demo["outcomes"]:
        bank = Fraction()
        for index, point in enumerate(round_data["state"][0]["path"]):
            for operation in point["ops"]:
                if operation["kind"] == "award":
                    value = award_for(operation["points"])
                    assert operation["amount"] == value > 0
                    prices.setdefault(operation["points"], set()).add(value)
                    bank += value
                    bonuses += operation["points"] >= 10000
                elif operation["kind"] == "halve":
                    previous = bank
                    bank /= 2
                    assert bank * 2 == previous
                    genuine_reductions += previous > 0
                    hits.add(operation["bumper"])
                else:
                    assert index == len(round_data["state"][0]["path"]) - 1
                    assert bank <= operation["amount"] < bank + 10
                    bank = Fraction(operation["amount"])
            assert float(bank) == point["bank"]
    assert prices[1000] == {40}
    assert prices[10000] == {400}
    assert all(len(values) == 1 for values in prices.values())
    assert hits == {0, 1} and genuine_reductions > 0 and bonuses > 0


def test_incomplete_physics_cannot_be_converted_to_a_loss() -> None:
    with pytest.raises(ValueError, match="natural divider-table drain"):
        make_event(dict(played=True, drain=None, path=[dict(y=1200)]))


def test_weight_calibration_only_changes_sampling_not_bonus_prices() -> None:
    payouts = [40, 80, 100, 200, 620]
    weights = balance_weights(payouts, [1] * len(payouts))
    assert Fraction(
        sum(p * w for p, w in zip(payouts, weights, strict=True)), 100 * sum(weights)
    ) == Fraction(967, 1000)
    assert all(w > 0 for w in weights)
