// submit-application — the PII-carrying path. We NEVER read the user's PII here.
// Outbound request uses `http-with-placeholders`; the host substitutes
// {{profile.*}} from the user's profile inside the enclave, just before egress.
//
// SKELETON: the placeholder body below shows the privacy pattern. Real lender
// endpoint + field mapping wired on Day 3 once the contract builds.

use serde::Deserialize;

#[derive(Deserialize)]
struct SubmitInput {
    lender_id: String,
    offer_id: String,
    amount: u64,
    term_months: u32,
}

pub fn submit_application(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: SubmitInput =
        serde_json::from_slice(input).map_err(|e| format!("bad submit input: {e}"))?;

    // The application body the lender receives. Note: the only real values we hold
    // are non-sensitive references (amount, term, opaque ids). Every PII field is a
    // placeholder resolved host-side — plaintext PII never enters this WASM.
    //
    // let order_body = json!({
    //   "lender": req.lender_id,
    //   "offer":  req.offer_id,
    //   "amount": req.amount,
    //   "term_months": req.term_months,
    //   "applicant": {
    //     "first_name":     "{{profile.first_name}}",
    //     "last_name":      "{{profile.last_name}}",
    //     "date_of_birth":  "{{profile.date_of_birth}}",
    //     "email":          "{{profile.verified_contacts.email.value}}",
    //     "annual_income":  "{{profile.annual_income}}",
    //     "employment":     "{{profile.employment_status}}",
    //   }
    // });
    //
    // let resp = hwp::call(&hwp::Request {
    //   method: hwp::Verb::Post,
    //   url: format!("{LENDER_BASE}/applications"),
    //   headers: Some(lender_headers(&api_key)),
    //   payload: Some(serde_json::to_vec(&order_body).map_err(|e| e.to_string())?),
    // }).map_err(|e| format_http_error(e))?;

    let stub = serde_json::json!({
        "status": "submitted",
        "reference_id": format!("APP-{}-{}", req.lender_id, req.offer_id),
        "amount": req.amount,
        "term_months": req.term_months,
    });
    serde_json::to_vec(&stub).map_err(|e| e.to_string())
}
