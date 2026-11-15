//! RFC 3339 timestamps in UTC with millisecond precision, the form the Event
//! Contract v1 normalizes to. No time zone database is needed: the Collector
//! only ever formats UTC.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Formats a point in time as `YYYY-MM-DDTHH:MM:SS.mmmZ`.
pub fn rfc3339_utc(at: SystemTime) -> String {
    let since_epoch = at.duration_since(UNIX_EPOCH).unwrap_or(Duration::ZERO);
    format_unix_millis(since_epoch.as_millis() as i64)
}

/// Formats whole seconds since the Unix epoch (as `/proc/stat` reports boot time).
pub fn rfc3339_from_unix_seconds(seconds: u64) -> String {
    format_unix_millis((seconds as i64).saturating_mul(1000))
}

fn format_unix_millis(millis: i64) -> String {
    let days = millis.div_euclid(86_400_000);
    let ms_of_day = millis.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let hour = ms_of_day / 3_600_000;
    let minute = (ms_of_day / 60_000) % 60;
    let second = (ms_of_day / 1000) % 60;
    let milli = ms_of_day % 1000;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}Z")
}

/// Proleptic Gregorian date of a day count since 1970-01-01 (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_the_epoch_and_known_instants_in_utc() {
        assert_eq!(rfc3339_from_unix_seconds(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(rfc3339_from_unix_seconds(1_794_765_139), "2026-11-15T17:52:19.000Z");
        assert_eq!(rfc3339_from_unix_seconds(951_782_400), "2000-02-29T00:00:00.000Z");
        assert_eq!(rfc3339_from_unix_seconds(4_107_542_399), "2100-02-28T23:59:59.000Z");
    }

    #[test]
    fn keeps_milliseconds() {
        let at = UNIX_EPOCH + Duration::from_millis(1_794_765_139_123);
        assert_eq!(rfc3339_utc(at), "2026-11-15T17:52:19.123Z");
    }

    #[test]
    fn output_has_the_contract_shape() {
        let text = rfc3339_utc(SystemTime::now());
        assert_eq!(text.len(), 24);
        assert!(text.ends_with('Z'));
        assert_eq!(&text[10..11], "T");
    }
}
