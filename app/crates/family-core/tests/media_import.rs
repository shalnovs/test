use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use family_core::Engine;
use serde_json::{json, Value};
use tempfile::TempDir;

fn payload(raw: &str, filename: &str) -> Value {
    json!({"base64":B64.encode(raw),"filename":filename,"title":filename,"mime":"image/jpeg","kind":"photo","thumbnail":B64.encode("original thumbnail")})
}
fn setup() -> (TempDir, Engine, Value, String) {
    let dir = TempDir::new().unwrap();
    let mut engine = Engine::open(dir.path()).unwrap();
    let p = payload("original photograph", "first.jpg");
    let id = engine.call("add_media", p.clone()).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    (dir, engine, p, id)
}

#[test]
fn preview_and_unconfirmed_import_are_read_only_even_after_renaming() {
    let (_dir, mut e, mut p, id) = setup();
    p["filename"] = json!("renamed.jpg");
    let before = e.call("load", json!({})).unwrap();
    let preview = e.call("check_media", p.clone()).unwrap();
    assert_eq!(preview["duplicates"][0]["id"], id);
    let result = e.call("add_media", p).unwrap();
    assert_eq!(result["needs_confirmation"], true);
    assert_eq!(before, e.call("load", json!({})).unwrap());
}

#[test]
fn new_content_with_same_filename_imports_without_confirmation() {
    let (_dir, mut e, _, id) = setup();
    let p = payload("different photograph", "first.jpg");
    assert_eq!(
        e.call("check_media", p.clone()).unwrap()["duplicates"],
        json!([])
    );
    let added = e.call("add_media", p.clone()).unwrap();
    assert_ne!(added["id"], id);
    // The next file in the same multi-file upload is checked against the updated archive.
    assert_eq!(e.call("add_media", p).unwrap()["needs_confirmation"], true);
}

#[test]
fn explicit_reuse_preserves_marks_metadata_and_history() {
    let (_dir, mut e, mut p, id) = setup();
    e.call(
        "save",
        json!({"kind":"people","record":{"id":"p","given_name":"Иван"}}),
    )
    .unwrap();
    e.call("save", json!({"kind":"tags","record":{"id":"tag","person_id":"p","media_id":id,"x":0.1,"y":0.1,"w":0.2,"h":0.2}})).unwrap();
    e.call(
        "save",
        json!({"kind":"media","record":{"id":id,"comment":"Подпись","date":"2000-01-01"}}),
    )
    .unwrap();
    let before = e.call("load", json!({})).unwrap();
    assert_eq!(
        e.call("check_media", p.clone()).unwrap()["duplicates"][0]["marked_count"],
        1
    );
    p["duplicate_action"] = json!("use");
    p["duplicate_id"] = json!(id);
    assert_eq!(
        e.call("add_media", p).unwrap(),
        json!({"id":id,"reused":true})
    );
    assert_eq!(before, e.call("load", json!({})).unwrap());
}

#[test]
fn confirmed_copy_is_separate_undoable_and_does_not_replace_shared_files() {
    let (dir, mut e, mut p, id) = setup();
    let original = e.data().unwrap();
    let media = original["media"][&id].clone();
    let file = dir.path().join(media["file"].as_str().unwrap());
    let thumb = dir.path().join(media["thumb"].as_str().unwrap());
    let original_file = std::fs::read(&file).unwrap();
    let original_thumb = std::fs::read(&thumb).unwrap();
    p["duplicate_action"] = json!("copy");
    p["duplicate_id"] = json!(id);
    p["thumbnail"] = json!(B64.encode("different thumbnail"));
    let copy = e.call("add_media", p).unwrap();
    assert_ne!(copy["id"], id);
    assert_eq!(e.data().unwrap()["media"].len(), 2);
    assert_eq!(std::fs::read(&file).unwrap(), original_file);
    assert_eq!(std::fs::read(&thumb).unwrap(), original_thumb);
    let h = e.call("load", json!({})).unwrap()["history"][0]["id"].clone();
    e.call("undo", json!({"id":h})).unwrap();
    assert_eq!(original, e.data().unwrap());
}

#[test]
fn trash_and_document_matches_require_an_explicit_restore_decision() {
    let (_dir, mut e, mut p, id) = setup();
    e.call(
        "save",
        json!({"kind":"media","record":{"id":id,"kind":"document","comment":"Описание"}}),
    )
    .unwrap();
    e.call(
        "trash_items",
        json!({"kind":"media","ids":[id],"confirm_marked":true}),
    )
    .unwrap();
    let before = e.data().unwrap();
    let check = e.call("check_media", p.clone()).unwrap();
    assert_eq!(check["duplicates"][0]["kind"], "document");
    assert!(check["duplicates"][0]["trashed_at"].is_string());
    assert_eq!(
        e.call("add_media", p.clone()).unwrap()["needs_confirmation"],
        true
    );
    p["duplicate_id"] = json!(id);
    p["duplicate_action"] = json!("use");
    assert!(e.call("add_media", p.clone()).is_err());
    assert_eq!(before, e.data().unwrap());
    p["duplicate_action"] = json!("restore");
    assert_eq!(e.call("add_media", p).unwrap()["restored"], true);
    let view = e.call("load", json!({})).unwrap();
    assert_eq!(view["data"]["media"][0]["id"], id);
    assert_eq!(view["data"]["media"][0]["comment"], "Описание");
    assert_eq!(view["trash"]["media"], json!([]));
}

#[test]
fn confirmation_is_bound_to_the_actual_duplicate_and_archive() {
    let (_dir, mut e, mut p, id) = setup();
    let before = e.call("load", json!({})).unwrap();
    p["duplicate_action"] = json!("copy");
    p["duplicate_id"] = json!("wrong");
    assert!(e.call("add_media", p.clone()).is_err());
    p["duplicate_id"] = json!(id);
    p["tree_id"] = json!("another archive");
    assert!(e.call("check_media", p.clone()).is_err());
    assert!(e.call("add_media", p).is_err());
    assert_eq!(before, e.call("load", json!({})).unwrap());
}
