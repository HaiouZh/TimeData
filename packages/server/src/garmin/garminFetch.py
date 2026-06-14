#!/usr/bin/env python3
"""Garmin data fetcher for TimeData server.

Outputs JSON to stdout. Errors/logs to stderr.
Designed to be called as subprocess from garminService.ts.

Usage:
  python3 garminFetch.py --email user@example.com --password secret \
    --is-cn --start 2026-01-01 --end 2026-01-31 --token-dir /app/data/garmin_tokens
"""
import argparse
import datetime as dt
import json
import sys
import uuid
from pathlib import Path


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def round_or_none(value, digits=0):
    if value is None or value == "":
        return None
    try:
        rounded = round(float(value), digits)
    except (TypeError, ValueError):
        return None
    return int(rounded) if digits == 0 else rounded


def format_time_from_millis(value):
    if not value:
        return ""
    instant = dt.datetime.fromtimestamp(value / 1000, dt.timezone.utc)
    return f"{instant.hour:02d}:{instant.minute:02d}"


def format_time_from_activity(value):
    if not value:
        return ""
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            instant = dt.datetime.strptime(value[:19], fmt)
            return f"{instant.hour:02d}:{instant.minute:02d}"
        except ValueError:
            pass
    return ""


def normalize_stride_m(value):
    stride = round_or_none(value, 2)
    if stride is None:
        return None
    return round(stride / 100, 2) if stride > 10 else stride


def is_running_activity(activity):
    raw_type = activity.get("activityType")
    type_key = ""
    if isinstance(raw_type, dict):
        type_key = str(raw_type.get("typeKey") or raw_type.get("typeId") or "")
    elif raw_type:
        type_key = str(raw_type)
    else:
        dto = activity.get("activityTypeDTO")
        if isinstance(dto, dict):
            type_key = str(dto.get("typeKey") or dto.get("typeId") or "")
    lowered = type_key.lower()
    return "run" in lowered or "running" in lowered


def activity_city(activity):
    location = activity.get("locationName") or activity.get("city") or ""
    if location:
        return location
    event = activity.get("event")
    if isinstance(event, dict):
        return event.get("city", "") or ""
    return ""


def deterministic_id(domain, date_str):
    """Generate a stable UUID for a given domain+date, so re-fetching
    the same day produces the same id and triggers an upsert instead
    of a unique-constraint violation."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"timedata:{domain}:{date_str}"))


def build_heart_rate(date_str, data, now):
    if not data:
        return None
    values = []
    for item in data.get("heartRateValues") or []:
        if isinstance(item, list) and len(item) >= 2:
            v = round_or_none(item[1])
            if v is not None and v > 0:
                values.append(v)
    avg = round(sum(values) / len(values)) if values else None
    rec = {
        "restingHeartRate": round_or_none(data.get("restingHeartRate")),
        "minHeartRate": round_or_none(data.get("minHeartRate")),
        "maxHeartRate": round_or_none(data.get("maxHeartRate")),
        "avgHeartRate": avg,
        "last7DaysAvgRestingHeartRate": round_or_none(
            data.get("lastSevenDaysAvgRestingHeartRate")
        ),
    }
    if all(v is None for v in rec.values()):
        return None
    return {
        "id": deterministic_id("health_heart_rate", date_str),
        "date": date_str,
        **rec,
        "createdAt": now,
        "updatedAt": now,
    }


def find_hrv_7day_average(hrv_data):
    """Recursively search for a 7-day average field in Garmin HRV response.
    The Garmin API response structure changes over time, so we search
    by keyword patterns rather than hardcoded paths."""
    def walk(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                low = k.lower()
                if any(t in low for t in ("7", "seven", "week")) and any(
                    t in low for t in ("avg", "average")
                ):
                    r = round_or_none(v)
                    if r is not None:
                        return r
                result = walk(v)
                if result is not None:
                    return result
        elif isinstance(obj, list):
            for item in obj:
                result = walk(item)
                if result is not None:
                    return result
        return None

    return walk(hrv_data or {})


def build_hrv(date_str, data, now):
    summary = data.get("hrvSummary") if data else None
    value = round_or_none(summary.get("lastNightAvg")) if summary else None
    if value is None:
        value = find_hrv_7day_average(data)
        if value is not None:
            log(f"[{date_str}] HRV: using 7-day avg fallback = {value}")
    if value is None:
        return None
    return {
        "id": deterministic_id("health_hrv", date_str),
        "date": date_str,
        "hrvMs": value,
        "createdAt": now,
        "updatedAt": now,
    }


def build_sleep(date_str, data, now):
    info = data.get("dailySleepDTO") if data else None
    if not info:
        return None
    sleep_start = format_time_from_millis(info.get("sleepStartTimestampLocal"))
    wake_time = format_time_from_millis(info.get("sleepEndTimestampLocal"))
    if not sleep_start and not wake_time:
        return None
    return {
        "id": deterministic_id("health_sleep", date_str),
        "date": date_str,
        "sleepStart": sleep_start or "00:00",
        "wakeTime": wake_time or "00:00",
        "adjustmentHours": 0,
        "createdAt": now,
        "updatedAt": now,
    }


def build_stress(date_str, summary, now):
    if not summary:
        return None
    value = round_or_none(summary.get("averageStressLevel"))
    if value is None:
        return None
    return {
        "id": deterministic_id("health_stress", date_str),
        "date": date_str,
        "stress": value,
        "createdAt": now,
        "updatedAt": now,
    }


def build_run(date_str, activity, now):
    start_time = format_time_from_activity(
        activity.get("startTimeLocal", "")
    ) or "00:00"
    distance_m = activity.get("distance")
    duration_s = activity.get("duration")
    return {
        "id": f"{date_str}T{start_time}",
        "date": date_str,
        "startTime": start_time,
        "distanceKm": round_or_none(float(distance_m) / 1000, 2)
        if distance_m
        else None,
        "durationSeconds": round_or_none(duration_s),
        "averageHeartRate": round_or_none(activity.get("averageHR")),
        "averageCadence": round_or_none(
            activity.get("averageRunningCadenceInStepsPerMinute"), 1
        ),
        "averageStrideM": normalize_stride_m(activity.get("avgStrideLength")),
        "averageVerticalRatioPercent": round_or_none(
            activity.get("avgVerticalRatio"), 2
        ),
        "averageVerticalOscillationCm": round_or_none(
            activity.get("avgVerticalOscillation"), 1
        ),
        "averageGroundContactMs": round_or_none(
            activity.get("avgGroundContactTime")
        ),
        "type": "",
        "city": str(activity_city(activity) or ""),
        "createdAt": now,
        "updatedAt": now,
    }


def main():
    parser = argparse.ArgumentParser(description="Fetch Garmin health data")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--is-cn", action="store_true", default=True)
    parser.add_argument("--no-cn", dest="is_cn", action="store_false")
    parser.add_argument("--start", required=True, help="YYYY-MM-DD")
    parser.add_argument("--end", required=True, help="YYYY-MM-DD")
    parser.add_argument("--token-dir", default="/app/data/garmin_tokens")
    args = parser.parse_args()

    from garminconnect import Garmin

    token_dir = Path(args.token_dir)
    token_dir.mkdir(parents=True, exist_ok=True)

    log(f"Logging in to Garmin (CN={args.is_cn})...")
    client = Garmin(args.email, args.password, is_cn=args.is_cn)
    try:
        client.login(str(token_dir))
    except Exception:
        log("Token login failed, trying credentials...")
        client.login()
        client.garth.dump(str(token_dir))
    log("Login successful.")

    start = dt.date.fromisoformat(args.start)
    end = dt.date.fromisoformat(args.end)
    result = {
        "health_heart_rate": [],
        "health_hrv": [],
        "health_sleep": [],
        "health_stress": [],
        "runs": [],
    }

    current = start
    while current <= end:
        ds = current.isoformat()
        now = dt.datetime.now(dt.timezone.utc).isoformat()

        try:
            rec = build_heart_rate(ds, client.get_heart_rates(ds), now)
            if rec:
                result["health_heart_rate"].append(rec)
        except Exception as e:
            log(f"[{ds}] heart_rate error: {e}")
        try:
            rec = build_hrv(ds, client.get_hrv_data(ds), now)
            if rec:
                result["health_hrv"].append(rec)
        except Exception as e:
            log(f"[{ds}] hrv error: {e}")
        try:
            rec = build_sleep(ds, client.get_sleep_data(ds), now)
            if rec:
                result["health_sleep"].append(rec)
        except Exception as e:
            log(f"[{ds}] sleep error: {e}")
        try:
            rec = build_stress(ds, client.get_user_summary(ds), now)
            if rec:
                result["health_stress"].append(rec)
        except Exception as e:
            log(f"[{ds}] stress error: {e}")
        try:
            activities = (
                client.get_activities_by_date(ds, ds, "running") or []
            )
            for act in activities:
                if is_running_activity(act):
                    result["runs"].append(build_run(ds, act, now))
        except Exception as e:
            log(f"[{ds}] runs error: {e}")

        counts = ", ".join(f"{k}:{len(v)}" for k, v in result.items())
        log(f"{ds} done | running totals: {counts}")
        current += dt.timedelta(days=1)

    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
