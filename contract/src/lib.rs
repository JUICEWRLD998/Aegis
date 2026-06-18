// Aegis banking TEE contract — wit-bindgen entry point + Guest dispatch.
//
// Mirrors the structure of Terminal-3/z-tenant-flight. The private banking logic
// runs INSIDE the enclave; PII for outbound calls is resolved by the host from
// {{profile.*}} placeholders and never enters this WASM.

wit_bindgen::generate!({
    world: "tenant-banking",
    path: "wit",
    additional_derives: [serde::Deserialize, serde::Serialize],
    generate_all,
});

mod lenders;
mod application;

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::tenant_banking::contracts::Guest for Component {
    fn query_lenders(
        req: exports::z::tenant_banking::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let input = req.input.ok_or("query-lenders: missing input")?;
        lenders::query_lenders(&input)
    }

    fn submit_application(
        req: exports::z::tenant_banking::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let input = req.input.ok_or("submit-application: missing input")?;
        application::submit_application(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);
