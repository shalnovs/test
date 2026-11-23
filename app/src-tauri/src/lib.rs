use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::Manager;
struct AppState {
    engine: Arc<Mutex<family_core::Engine>>,
    settings: Option<PathBuf>,
    places: PathBuf,
}
#[tauri::command]
async fn archive(
    state: tauri::State<'_, AppState>,
    op: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let shared = state.engine.clone();
    let settings = state.settings.clone();
    let places = state.places.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if op == "search_places" {
            return family_core::geography::search_places(
                &places,
                payload["query"].as_str().unwrap_or(""),
            );
        }
        let mut engine = shared.lock().map_err(|e| e.to_string())?;
        let result = engine.call(&op, payload)?;
        if op == "switch_library" {
            if let Some(path) = &settings {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                std::fs::write(
                    path,
                    serde_json::to_vec(&engine.root).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let portable = std::env::current_exe()?.parent().unwrap().join("data");
            let settings = if portable.exists() {
                portable.parent().unwrap().join("last-archive.json")
            } else {
                app.path().app_config_dir()?.join("last-archive.json")
            };
            let remembered = std::fs::read(&settings)
                .ok()
                .and_then(|raw| serde_json::from_slice::<PathBuf>(&raw).ok())
                .filter(|p| p.join("family.sqlite").is_file());
            let isolated = std::env::var_os("FAMILY_DATA_DIR");
            let root = if let Some(p) = &isolated {
                std::path::PathBuf::from(p)
            } else if let Some(p) = remembered {
                p
            } else if portable.exists() {
                portable
            } else {
                app.path().app_data_dir()?.join("data")
            };
            family_core::initialize_seed(&root, &app.path().resource_dir()?.join("seed"))
                .map_err(std::io::Error::other)?;
            let engine = family_core::Engine::open(root).map_err(std::io::Error::other)?;
            app.manage(AppState {
                engine: Arc::new(Mutex::new(engine)),
                places: {
                    let sibling = std::env::current_exe()?
                        .parent()
                        .unwrap()
                        .join("places.sqlite");
                    if sibling.is_file() {
                        sibling
                    } else {
                        app.path().resource_dir()?.join("places.sqlite")
                    }
                },
                settings: if isolated.is_some() {
                    None
                } else {
                    Some(settings)
                },
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![archive])
        .run(tauri::generate_context!())
        .expect("Ошибка запуска семейного архива");
}
