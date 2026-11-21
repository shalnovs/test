use family_core::{initialize_seed, Engine};
use serde_json::json;
use tempfile::TempDir;
#[test]
fn first_install_copies_seed_and_preserves_later_edits() {
    let tmp = TempDir::new().unwrap();
    let seed = tmp.path().join("seed");
    let target = tmp.path().join("installed");
    {
        let mut engine = Engine::open(&seed).unwrap();
        engine
            .call(
                "save",
                json!({"kind":"people","record":{"id":"p","given_name":"Иван"}}),
            )
            .unwrap();
        engine
            .call(
                "add_media",
                json!({"filename":"source.txt","mime":"text/plain","base64":"aGVsbG8="}),
            )
            .unwrap();
    }
    assert!(initialize_seed(&target, &seed).unwrap());
    {
        let mut engine = Engine::open(&target).unwrap();
        assert_eq!(engine.data().unwrap()["people"].len(), 1);
        assert_eq!(engine.data().unwrap()["media"].len(), 1);
        engine
            .call(
                "save",
                json!({"kind":"people","record":{"id":"p","given_name":"Иван изменённый"}}),
            )
            .unwrap();
    }
    assert!(!initialize_seed(&target, &seed).unwrap());
    let engine = Engine::open(&target).unwrap();
    assert_eq!(
        engine.data().unwrap()["people"]["p"]["given_name"],
        "Иван изменённый"
    );
}
#[test]
fn initialization_does_not_replace_unrelated_files() {
    let tmp = TempDir::new().unwrap();
    let seed = tmp.path().join("seed");
    let target = tmp.path().join("installed");
    {
        let _engine = Engine::open(&seed).unwrap();
    }
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("keep.txt"), "Сохранить").unwrap();
    assert!(initialize_seed(&target, &seed).is_err());
    assert_eq!(
        std::fs::read_to_string(target.join("keep.txt")).unwrap(),
        "Сохранить"
    );
}
