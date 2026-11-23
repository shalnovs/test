use family_core::Engine;
use serde_json::{json, Value};
use tempfile::TempDir;
fn save(e: &mut Engine, kind: &str, record: Value) {
    e.call("save", json!({"kind":kind,"record":record}))
        .unwrap();
}
fn setup() -> (TempDir, Engine) {
    let dir = TempDir::new().unwrap();
    let mut e = Engine::open(dir.path()).unwrap();
    save(&mut e, "people", json!({"id":"p","given_name":"Анна"}));
    (dir, e)
}
fn media(e: &mut Engine, id: &str) {
    save(
        e,
        "media",
        json!({"id":id,"title":id,"kind":"photo","mime":"image/jpeg","sha256":"same","file":"media/sample.jpg","thumb":"thumbs/sample.jpg"}),
    );
    std::fs::write(e.root.join("media/sample.jpg"), b"sample").unwrap();
    std::fs::write(e.root.join("thumbs/sample.jpg"), b"thumb").unwrap();
}
fn trash(e: &mut Engine, kind: &str, ids: Value) {
    e.call(
        "trash_items",
        json!({"kind":kind,"ids":ids,"confirm_marked":true}),
    )
    .unwrap();
}
fn purge(e: &mut Engine, kind: &str, ids: Value) -> Value {
    e.call(
        "purge_items",
        json!({"kind":kind,"ids":ids,"confirm_permanent":true}),
    )
    .unwrap()
}
#[test]
fn purge_requires_trash_and_explicit_confirmation_and_validates_whole_selection() {
    let (_dir, mut e) = setup();
    media(&mut e, "a");
    media(&mut e, "b");
    let initial = e.data().unwrap();
    assert!(e
        .call(
            "purge_items",
            json!({"kind":"media","ids":["a"],"confirm_permanent":true})
        )
        .is_err());
    assert_eq!(e.data().unwrap(), initial);
    trash(&mut e, "media", json!(["a"]));
    let before = e.data().unwrap();
    assert!(e
        .call("purge_items", json!({"kind":"media","ids":["a"]}))
        .is_err());
    assert!(e
        .call(
            "purge_items",
            json!({"kind":"media","ids":["a","b"],"confirm_permanent":true})
        )
        .is_err());
    assert_eq!(e.data().unwrap(), before);
    assert!(e.root.join("media/sample.jpg").exists());
}
#[test]
fn deleting_media_removes_files_links_cache_and_never_resurrects_through_history() {
    let (_dir, mut e) = setup();
    media(&mut e, "m");
    save(
        &mut e,
        "tags",
        json!({"id":"t","media_id":"m","person_id":"p"}),
    );
    save(&mut e, "people", json!({"id":"p","avatar_id":"m"}));
    save(
        &mut e,
        "events",
        json!({"id":"event","title":"Встреча","media_ids":["m"],"cover_media_id":"m"}),
    );
    trash(&mut e, "media", json!(["m"]));
    let preview = e
        .call("purge_preview", json!({"kind":"media","ids":["m"]}))
        .unwrap();
    assert_eq!(preview["people"][0]["id"], "p");
    assert_eq!(preview["tags"], 1);
    save(
        &mut e,
        "people",
        json!({"id":"p","autobiography":"Позднее дополнение"}),
    );
    let result = purge(&mut e, "media", json!(["m"]));
    assert_eq!(result["pending_files"], 0);
    assert!(!e.root.join("media/sample.jpg").exists());
    assert!(!e.root.join("thumbs/sample.jpg").exists());
    let d = e.data().unwrap();
    assert!(d["media"].is_empty());
    assert!(d["tags"].is_empty());
    assert_eq!(d["people"]["p"]["avatar_id"], "");
    assert_eq!(d["events"]["event"]["media_ids"], json!([]));
    let mut undo_count = 0;
    loop {
        let state = e.call("load", json!({})).unwrap();
        let Some(history) = state["history"]
            .as_array()
            .unwrap()
            .iter()
            .find(|h| h["can_undo"] == true)
        else {
            break;
        };
        e.call("undo", json!({"id":history["id"]})).unwrap();
        undo_count += 1;
        assert!(!e.data().unwrap()["media"].contains_key("m"));
        assert!(undo_count < 30);
    }
    assert!(undo_count > 3);
}
#[test]
fn purging_duplicate_keeps_shared_files_and_moves_all_relationships_to_keeper() {
    let (_dir, mut e) = setup();
    media(&mut e, "a");
    media(&mut e, "b");
    save(
        &mut e,
        "tags",
        json!({"id":"t","media_id":"b","person_id":"p"}),
    );
    save(&mut e, "people", json!({"id":"p","avatar_id":"b"}));
    save(
        &mut e,
        "events",
        json!({"id":"event","title":"Встреча","media_ids":["a","b"],"cover_media_id":"b"}),
    );
    e.call(
        "merge_duplicates",
        json!({"kind":"media","keep_id":"a","ids":["b"],"confirm_marked":true}),
    )
    .unwrap();
    let result = purge(&mut e, "media", json!(["b"]));
    assert_eq!(result["shared_files"], 2);
    let d = e.data().unwrap();
    assert_eq!(d["tags"]["t"]["media_id"], "a");
    assert_eq!(d["people"]["p"]["avatar_id"], "a");
    assert_eq!(d["events"]["event"]["media_ids"], json!(["a"]));
    assert_eq!(d["events"]["event"]["cover_media_id"], "a");
    assert!(e.root.join("media/sample.jpg").exists());
    family_core::validate(&d).unwrap();
}
#[test]
fn shared_files_are_retained_for_other_trashed_materials() {
    let (_dir, mut e) = setup();
    media(&mut e, "a");
    media(&mut e, "b");
    trash(&mut e, "media", json!(["a", "b"]));
    purge(&mut e, "media", json!(["a"]));
    assert!(e.root.join("media/sample.jpg").exists());
    purge(&mut e, "media", json!(["b"]));
    assert!(!e.root.join("media/sample.jpg").exists());
}
#[test]
fn text_and_its_links_are_removed_but_people_survive() {
    let (_dir, mut e) = setup();
    save(
        &mut e,
        "texts",
        json!({"id":"t","title":"Воспоминания","content":{"type":"doc","content":[]}}),
    );
    save(
        &mut e,
        "text_links",
        json!({"id":"l","text_id":"t","person_id":"p"}),
    );
    trash(&mut e, "texts", json!(["t"]));
    purge(&mut e, "texts", json!(["t"]));
    let d = e.data().unwrap();
    assert!(d["texts"].is_empty());
    assert!(d["text_links"].is_empty());
    assert!(d["people"].contains_key("p"));
}
#[test]
fn unsafe_paths_are_rejected_before_any_data_changes() {
    let (dir, mut e) = setup();
    save(
        &mut e,
        "media",
        json!({"id":"bad","title":"bad","file":"media/../../outside.jpg"}),
    );
    trash(&mut e, "media", json!(["bad"]));
    let before = e.data().unwrap();
    assert!(e
        .call(
            "purge_items",
            json!({"kind":"media","ids":["bad"],"confirm_permanent":true})
        )
        .is_err());
    assert_eq!(before, e.data().unwrap());
    assert!(dir.path().join("family.sqlite").exists());
}
#[cfg(windows)]
#[test]
fn locked_files_are_queued_and_retried_after_reopening() {
    use std::os::windows::fs::OpenOptionsExt;
    let (dir, mut e) = setup();
    media(&mut e, "m");
    trash(&mut e, "media", json!(["m"]));
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(3)
        .open(dir.path().join("media/sample.jpg"))
        .unwrap();
    let result = purge(&mut e, "media", json!(["m"]));
    assert_eq!(result["pending_files"], 1);
    assert!(dir.path().join("media/sample.jpg").exists());
    drop(lock);
    drop(e);
    let _e = Engine::open(dir.path()).unwrap();
    assert!(!dir.path().join("media/sample.jpg").exists());
}
