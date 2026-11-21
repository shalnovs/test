use std::io::{self, BufRead, Write};
fn main() {
    let root = std::env::args().nth(1).expect("data directory");
    let mut engine = family_core::Engine::open(root).expect("open database");
    for line in io::stdin().lock().lines() {
        let line = match line {
            Ok(x) => x,
            Err(_) => break,
        };
        let result = (|| {
            let v: serde_json::Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
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
