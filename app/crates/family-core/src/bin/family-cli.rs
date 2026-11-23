use std::io::{self, BufRead, Write};
fn main() {
    let root = std::env::args().nth(1).expect("data directory");
    let mut engine = family_core::Engine::open(root).expect("open database");
    let places = std::env::args()
        .nth(2)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../assets/places.sqlite")
        });
    for line in io::stdin().lock().lines() {
        let line = match line {
            Ok(x) => x,
            Err(_) => break,
        };
        let result = (|| {
            let v: serde_json::Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
            if v["op"] == "search_places" {
                return family_core::geography::search_places(
                    &places,
                    v["payload"]["query"].as_str().unwrap_or(""),
                );
            }
            engine.call(v["op"].as_str().unwrap_or(""), v["payload"].clone())
        })();
        let response = match result {
            Ok(v) => serde_json::json!({"ok":true,"result":v}),
            Err(e) => serde_json::json!({"ok":false,"error":e}),
        };
        println!("{response}");
        io::stdout().flush().ok();
    }
}
