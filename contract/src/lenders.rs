// query-lenders — NO PII leaves the enclave. We send only the selective-disclosure
// assertions the user consented to (e.g. "income >= threshold", "no defaults 24mo")
// plus the agent's identity, and collect indicative offers.
//
// SKELETON: wire real lender hosts once the contract builds against host bindings.
// The `http` interface here is the no-PII path (compare to `application.rs`).

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct QueryInput {
    requested_amount: u64,
    term_months: u32,
}

#[derive(Serialize)]
struct Offer {
    lender_id: String,
    lender_name: String,
    apr: f64,
    max_amount: u64,
    term_months: u32,
    proof_ref: String,
}

#[derive(Serialize)]
struct QueryOutput {
    offers: Vec<Offer>,
}

pub fn query_lenders(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: QueryInput =
        serde_json::from_slice(input).map_err(|e| format!("bad query input: {e}"))?;

    // TODO(day3): replace stub with real host::interfaces::http calls to each
    // mock lender, sending only disclosure assertions (no PII). For now, return a
    // deterministic stub so the TS layer + agent loop can be built/tested first.
    let offers = vec![
        Offer {
            lender_id: "bank-a".into(),
            lender_name: "Aurora Bank".into(),
            apr: 6.9,
            max_amount: req.requested_amount,
            term_months: req.term_months,
            proof_ref: "sd:income_ge_80k,no_default_24mo".into(),
        },
        Offer {
            lender_id: "bank-b".into(),
            lender_name: "Meridian Credit".into(),
            apr: 7.4,
            max_amount: req.requested_amount,
            term_months: req.term_months,
            proof_ref: "sd:income_ge_80k,no_default_24mo".into(),
        },
    ];

    serde_json::to_vec(&QueryOutput { offers }).map_err(|e| e.to_string())
}
