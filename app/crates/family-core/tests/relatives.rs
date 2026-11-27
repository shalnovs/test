use family_core::Engine;
use serde_json::json;
use tempfile::TempDir;
fn setup() -> (TempDir, Engine, String) {
    let d = TempDir::new().unwrap();
    let mut e = Engine::open(d.path()).unwrap();
    e.call(
        "save",
        json!({"kind":"people","record":{"id":"root","given_name":"Иван","gender":"M"}}),
    )
    .unwrap();
    let tree = e.call("load", json!({})).unwrap()["tree_id"]
        .as_str()
        .unwrap()
        .to_owned();
    (d, e, tree)
}
#[test]
fn person_and_relationship_are_created_and_undone_as_one_operation() {
    let (_d, mut e, t) = setup();
    let before = e.data().unwrap();
    let result=e.call("save_relative",json!({"tree_id":t,"root_id":"root","relation":"mother","new_person":{"given_name":"Мария","gender":"F","birth_date":"1950"}})).unwrap();
    let data = e.data().unwrap();
    assert_eq!(data["people"].len(), 2);
    let r = data["relationships"].values().next().unwrap();
    assert_eq!(r["role"], "mother");
    assert_eq!(r["from_id"], result["id"]);
    assert_eq!(r["to_id"], "root");
    let h = e.call("load", json!({})).unwrap()["history"][0]["id"].clone();
    e.call("undo", json!({"id":h})).unwrap();
    assert_eq!(e.data().unwrap(), before);
}
#[test]
fn existing_child_uses_the_correct_direction_and_duplicate_is_rejected() {
    let (_d, mut e, t) = setup();
    e.call(
        "save",
        json!({"kind":"people","record":{"id":"child","given_name":"Анна"}}),
    )
    .unwrap();
    let request = json!({"tree_id":t,"root_id":"root","relation":"child","target_id":"child"});
    e.call("save_relative", request.clone()).unwrap();
    let before = e.data().unwrap();
    let r = before["relationships"].values().next().unwrap();
    assert_eq!(r["from_id"], "root");
    assert_eq!(r["role"], "father");
    assert!(e.call("save_relative", request).is_err());
    assert_eq!(e.data().unwrap(), before);
    assert!(e
        .call(
            "save_relative",
            json!({"tree_id":t,"root_id":"child","relation":"child","target_id":"root"})
        )
        .is_err());
    assert_eq!(e.data().unwrap(), before);
}
#[test]
fn invalid_creation_never_leaves_an_orphan_person() {
    let (_d, mut e, t) = setup();
    let before = e.data().unwrap();
    for patch in [
        json!({"new_person":{}}),
        json!({"new_person":{"given_name":"Тест","birth_date":"1950-02-30"}}),
        json!({"new_person":{"given_name":"Тест","birth_date":"2000","death_date":"1999"}}),
        json!({"tree_id":"different"}),
        json!({"target_id":"root","new_person":null}),
    ] {
        let mut request = json!({"tree_id":t,"root_id":"root","relation":"mother","new_person":{"given_name":"Тест"}});
        for (key, v) in patch.as_object().unwrap() {
            request[key] = v.clone();
        }
        assert!(e.call("save_relative", request).is_err());
        assert_eq!(e.data().unwrap(), before);
    }
}
#[test]
fn marriage_date_is_saved_only_for_partner() {
    let (_d, mut e, t) = setup();
    let result=e.call("save_relative",json!({"tree_id":t,"root_id":"root","relation":"partner","start_date":"2001-05","new_person":{"given_name":"Мария"}})).unwrap();
    let d = e.data().unwrap();
    assert_eq!(
        d["relationships"][result["relationship_id"].as_str().unwrap()]["start_date"],
        "2001-05"
    );
}
