use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self, Write};
use std::process::Command;
use std::time::SystemTime;

#[derive(Serialize, Deserialize, Debug, Clone)]
struct Acceleration {
    #[serde(skip_serializing_if = "Option::is_none")]
    txid: Option<String>,

    #[serde(rename = "feeDelta")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fee_delta: Option<i64>,

    #[serde(rename = "eventType")]
    event_type: String,

    #[serde(default)]
    pools: Vec<u32>,

    #[serde(rename = "effectiveVsize")]
    #[serde(default)]
    effective_vsize: u32,

    #[serde(rename = "effectiveFee")]
    #[serde(default)]
    effective_fee: u32,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    added: Option<u64>,

    #[serde(rename = "loggedAt")]
    logged_at: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct AccelerationData {
    accelerations: Vec<Acceleration>,
}

fn main() -> io::Result<()> {
    let json_path = "acceleration-logs.json";
    let log_path = "results.log";

    let json_content = fs::read_to_string(json_path)?;
    let mut data: AccelerationData = serde_json::from_str(&json_content)?;

    let mut remaining_accelerations = Vec::new();
    let mut log_entries = Vec::new();
    let mut had_failure = false;

    for accel in data.accelerations {
        if (accel.event_type == "legacy" || accel.event_type == "added")
            && accel.txid.is_some()
            && accel.fee_delta.is_some()
        {
            let fee_delta = accel.fee_delta.unwrap();
            let txid = accel.txid.as_ref().unwrap();
            let command = format!(
                "bitcoin-cli -rpcwallet=cormorant prioritisetransaction \"{txid}\" 0.0 {fee_delta}"
            );

            match Command::new("sh").arg("-c").arg(&command).output() {
                Ok(output) if output.status.success() => {
                    let log_entry = format!(
                        "{}: Success - txid: {}, fee_delta: {}\n",
                        get_timestamp(),
                        txid,
                        fee_delta
                    );
                    log_entries.push(log_entry);
                }
                Ok(output) => {
                    had_failure = true;
                    let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    let log_entry = format!(
                        "{}: Failed - txid: {}, fee_delta: {}, error: {}\n",
                        get_timestamp(),
                        txid,
                        fee_delta,
                        error
                    );
                    log_entries.push(log_entry);
                    remaining_accelerations.push(accel.clone());
                }
                Err(e) => {
                    had_failure = true;
                    let log_entry = format!(
                        "{}: Failed - txid: {}, fee_delta: {}, error: {}\n",
                        get_timestamp(),
                        txid,
                        fee_delta,
                        e
                    );
                    log_entries.push(log_entry);
                    remaining_accelerations.push(accel.clone());
                }
            }
        } else {
            remaining_accelerations.push(accel.clone());
        }
    }

    let mut log_file = File::options().create(true).append(true).open(log_path)?;
    for entry in log_entries {
        log_file.write_all(entry.as_bytes())?;
    }

    if !had_failure {
        data.accelerations = remaining_accelerations;
        let updated_json = serde_json::to_string_pretty(&data)?;
        fs::write(json_path, updated_json)?;
    }

    Ok(())
}

fn get_timestamp() -> String {
    let now = SystemTime::now();
    let datetime: DateTime<Utc> = now.into();
    datetime.format("%Y-%m-%d %H:%M:%S UTC").to_string()
}
