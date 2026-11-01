"""Publish Stake books from measured trajectories of the original Expert physics."""

from __future__ import annotations

import argparse
import importlib.util
import json
from fractions import Fraction
from functools import reduce
from math import gcd
from pathlib import Path
from typing import Any

TARGET_RTP = Fraction(967, 1000)
POWERS = (70, 75, 80, 85, 90, 95, 100)
DRAINS = ("center", "left-gutter", "right-gutter")


def theoretical_return() -> Fraction:
    return TARGET_RTP


def balance_weights(payouts: list[int], weights: list[int]) -> list[int]:
    """Keep all shots, adjusting sampling probabilities to exact 96.7% return."""
    target = TARGET_RTP * 100
    error = target.denominator * sum(
        p * w for p, w in zip(payouts, weights, strict=True)
    ) - target.numerator * sum(weights)
    if error == 0:
        return weights.copy()
    anchor = payouts.index(min(payouts) if error > 0 else max(payouts))
    coefficient = target.denominator * payouts[anchor] - target.numerator
    if coefficient == 0 or (coefficient > 0) == (error > 0):
        raise ValueError("Payouts do not bracket the target return")
    result = [w * abs(coefficient) for w in weights]
    result[anchor] += abs(error)
    common = reduce(gcd, result)
    return [w // common for w in result]


def award_for(points: int) -> int:
    """Fixed award in hundredths of the stake, independent of the sampled round."""
    if points <= 0:
        raise ValueError("An award must have positive points")
    return max(10, ((points + 125) // 250) * 10)


def make_event(trace: dict[str, Any]) -> dict[str, Any]:
    measured = trace["path"]
    if (
        trace.get("ruleVersion") != 3
        or not trace["played"]
        or trace["drain"] not in DRAINS
        or measured[-1]["y"] <= 2388
    ):
        raise ValueError("Only a natural divider-table drain is publishable")
    bank = Fraction()
    score = 0
    path = []
    for index, sample in enumerate(measured):
        previous_bank = bank
        points = 0
        for operation in sample["ops"]:
            if operation["kind"] == "award":
                amount = award_for(operation["points"])
                if operation["amount"] != amount:
                    raise ValueError("Award price changed between rounds")
                bank += amount
                points += operation["points"]
            elif operation["kind"] == "halve":
                if operation["bumper"] not in (0, 1):
                    raise ValueError("Unknown divider bumper")
                bank /= 2
            elif operation["kind"] == "settle":
                if index != len(measured) - 1:
                    raise ValueError("Early settlement")
                rounded = (
                    (bank.numerator + 10 * bank.denominator - 1) // (10 * bank.denominator)
                ) * 10
                if operation["amount"] != rounded:
                    raise ValueError("Invalid payout rounding")
                bank = Fraction(rounded)
            else:
                raise ValueError("Unknown credit operation")
        if sample["score"] - score != points or sample["bank"] != float(bank):
            raise ValueError("Physics credit ledger mismatch")
        score = sample["score"]
        action = (
            "drain"
            if index == len(measured) - 1
            else "halve"
            if any(op["kind"] == "halve" for op in sample["ops"])
            else "bonus"
            if points
            else "travel"
        )
        path.append(dict(sample, reward=float(bank - previous_bank), action=action))
    if bank.denominator != 1 or bank.numerator % 10:
        raise ValueError("Final bank must match the exact RGS payout resolution")
    approach = next(p for p in reversed(measured) if 1800 <= p["y"] < 1970)
    drain = (
        "left-gutter"
        if approach["x"] < 150
        else "right-gutter"
        if approach["x"] > 1390
        else "center"
    )
    return dict(
        index=0,
        type="pinball",
        version=3,
        multiplier=int(bank),
        power=trace["power"],
        seed=trace["seed"],
        physics="247-expert-dividers-v1",
        step=2,
        drain=drain,
        path=path,
    )


def generate(sdk: Path, output: Path, demo: Path, traces_file: Path) -> None:
    spec = importlib.util.spec_from_file_location("stake_books", sdk / "src/state/books.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Stake Math SDK not found")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    import zstandard

    traces = json.loads(traces_file.read_text(encoding="utf-8"))
    output.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, list[dict[str, Any]]] = {"modes": []}
    demo_outcomes: list[dict[str, Any]] = []
    demo_weights = []
    summary = []
    for power in POWERS:
        candidates = sorted((t for t in traces if t["power"] == power), key=lambda t: t["score"])
        if len(candidates) < 2:
            raise ValueError(f"Expected verified physics traces for power {power}")
        mode = f"POWER_{power}"
        books = []
        lookup = []
        events = [make_event(trace) for trace in candidates]
        weights = balance_weights(
            [event["multiplier"] for event in events],
            [1] * len(candidates),
        )
        actual_return = Fraction(
            sum(
                event["multiplier"] * weight for event, weight in zip(events, weights, strict=True)
            ),
            100 * sum(weights),
        )
        if actual_return != theoretical_return():
            raise ValueError("Published weights do not match target RTP")
        for book_id, event in enumerate(events):
            multiplier = event["multiplier"]
            weight = weights[book_id]
            book = module.Book(book_id, "pinball-fixed-awards-and-dividers")
            book.payout_multiplier = multiplier / 100
            book.basegame_wins = multiplier / 100
            book.add_event(event)
            books.append(book.to_json())
            lookup.append(f"{book_id},{weight},{multiplier}\n")
            demo_outcomes.append(dict(betID=book_id, active=False, mode=mode, state=[event]))
            demo_weights.append(weight)
        book_name = f"books_{mode}.jsonl.zst"
        lookup_name = f"lookUpTable_{mode}_0.csv"
        raw = "".join(json.dumps(b, separators=(",", ":")) + "\n" for b in books).encode()
        (output / book_name).write_bytes(zstandard.ZstdCompressor(level=10).compress(raw))
        (output / lookup_name).write_text("".join(lookup), encoding="utf-8")
        manifest["modes"].append(dict(name=mode, cost=1.0, events=book_name, weights=lookup_name))
        summary.append(
            dict(
                mode=mode,
                books=len(books),
                rtp=str(actual_return),
                drains=sorted({b["events"][0]["drain"] for b in books}),
            )
        )
    (output / "index.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    demo.parent.mkdir(parents=True, exist_ok=True)
    demo.write_text(
        json.dumps(dict(outcomes=demo_outcomes, weights=demo_weights), separators=(",", ":")),
        encoding="utf-8",
    )
    report = dict(
        modes=summary,
        maxWin=max(round_data["state"][0]["multiplier"] for round_data in demo_outcomes) / 100,
        cost=1,
        powerAffectsPhysics=True,
        powerAffectsOdds=True,
        sampling="Fixed award prices, exact halve operations, and exact 96.7% RTP in every mode",
    )
    (output.parent / "pinball-report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    rules = dict(
        version=3,
        awardUnitPoints=250,
        awardUnitMultiplier=10,
        settlementIncrement=10,
        maxMultiplier=max(round_data["state"][0]["multiplier"] for round_data in demo_outcomes),
        dividerPositions=[dict(x=690, y=1190), dict(x=1030, y=1390)],
        rtp=0.967,
    )
    (demo.parent.parent / "src/game/credit-rules.json").write_text(
        json.dumps(rules, indent=2), encoding="utf-8"
    )
    print(json.dumps(report))


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk", type=Path, default=root / ".reference/math-sdk")
    parser.add_argument("--output", type=Path, default=root / "game_math/library/publish_files")
    parser.add_argument("--demo", type=Path, default=root / "public/demo-books.json")
    parser.add_argument("--traces", type=Path, default=root / "game_math/physics-traces.json")
    args = parser.parse_args()
    generate(args.sdk, args.output, args.demo, args.traces)
